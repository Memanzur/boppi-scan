/**
 * boppi watch --push: send the sanitized inventory to a workspace when, and
 * only when, the posture changed. Off unless the --push flag is given
 * (founder decision D-21). The body is the one boppi push sends
 * (push.prepareIngest); this module adds the change digest, an owner-only
 * outbox under <home>/.boppi/watch-push/, retries with backoff, and the stop
 * on a refused token. Documentation: docs/monitoring/WATCH_PUSH.md.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const push = require('./push');
const { openNoFollow, renameRetry, exclusiveLock } = require('./platform');

const QUEUE_CAPS = Object.freeze({ entries: 20, ageMs: 24 * 60 * 60 * 1000, bytes: 8 * 1024 * 1024 });
const BACKOFF = Object.freeze({ baseMs: 2000, capMs: 5 * 60 * 1000, onceRetries: 2, onceDelayMs: 500 });
const PRIVACY_LINE = 'Only sanitized inventory metadata is sent: no secret values, file contents, or raw paths.';

const storeDir = home => path.join(home, '.boppi', 'watch-push');

/** Sorted-key JSON, so the digest does not depend on property order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The posture digest: the body as sent, minus its timestamp, so a rescan of unchanged configs digests the same. */
function digestOf(body) {
  const { snapshot_at: _at, ...rest } = body;
  return `sha256:${crypto.createHash('sha256').update(canonical(rest)).digest('hex')}`;
}

/** Which collector a stored digest belongs to on a shared origin: a one-way tag of the token, never the token. */
function tokenTag(token) { return crypto.createHash('sha256').update(`boppi-watch-push-token\0${token}`).digest('hex').slice(0, 16); }

/** What a response means for the entry that was sent. */
function classify(result) {
  if (result.ok) return 'sent';
  if (result.networkError) return 'retry';
  if (result.status === 401 || result.status === 403) return 'revoked';
  if (result.status === 429 || result.status >= 500) return 'retry';
  return 'drop';
}

/**
 * Wait before retry number `attempt` (1-based): exponential from baseMs with
 * jitter between half and all of the step, capped at capMs. A server's
 * Retry-After (or the body's retryAfterSeconds) wins, scaled by baseMs / 2000
 * so the test-only BOPPI_WATCH_PUSH_BACKOFF_MS shortens it too.
 */
function retryDelay(attempt, { baseMs = BACKOFF.baseMs, capMs = BACKOFF.capMs, retryAfterSeconds, random = Math.random } = {}) {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.round(retryAfterSeconds * 1000 * (baseMs / BACKOFF.baseMs));
  const step = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.round(step / 2 + random() * (step / 2));
}

/** Entries kept under the caps, oldest dropped first, with why each dropped one went. */
function applyCaps(entries, now) {
  const kept = [];
  const dropped = [];
  for (const entry of entries) {
    if (now - Date.parse(entry.queuedAt) > QUEUE_CAPS.ageMs) dropped.push({ entry, why: 'older than 24 hours' });
    else kept.push(entry);
  }
  while (kept.length > QUEUE_CAPS.entries) dropped.push({ entry: kept.shift(), why: `more than ${QUEUE_CAPS.entries} queued` });
  let bytes = kept.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0);
  while (kept.length && bytes > QUEUE_CAPS.bytes) {
    const entry = kept.shift();
    bytes -= Buffer.byteLength(JSON.stringify(entry));
    dropped.push({ entry, why: 'queue over 8 MB' });
  }
  return { kept, dropped };
}

const refuse = (code, message) => Object.assign(new Error(message), { code });

/** The store directory, created owner-only; a symbolic link or non-directory in its place is refused. */
function ensureDir(home) {
  const dir = storeDir(home);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()) throw refuse('ELOOP', `${dir} is not a directory (a symbolic link or file is in its place)`);
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  return dir;
}

/** Write text to file atomically: an O_EXCL 0600 temp file in the same folder, fsync, rename over the target, fsync the folder. */
function writeAtomic(file, text) {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fd = openNoFollow(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { renameRetry(temp, file); } catch (error) { try { fs.unlinkSync(temp); } catch { /* already gone */ } throw error; }
  try { const dirFd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); } } catch { /* folder fsync is unsupported on some platforms */ }
}

/**
 * Read a store file (queue.json or state.json). Missing is null. A symbolic
 * link throws ELOOP. Unparsable or wrongly shaped content is moved aside to
 * <name>.corrupt-<timestamp> (owner-only) and reported through warn, then
 * read as null. Leftover temp files of earlier runs are removed.
 */
function readStore(home, name, isValid, warn) {
  const dir = ensureDir(home);
  for (const leftover of fs.readdirSync(dir).filter(f => f.startsWith(`${name}.tmp-`))) {
    try { fs.unlinkSync(path.join(dir, leftover)); } catch { /* another cleanup won */ }
  }
  const file = path.join(dir, name);
  let fd;
  try { fd = openNoFollow(file, fs.constants.O_RDONLY); } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw refuse('ELOOP', `${file} is a symbolic link; Boppi does not read or write through links. Remove it and start again.`);
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(fd, 'utf8')); } catch { parsed = undefined; } finally { fs.closeSync(fd); }
  if (parsed !== undefined && isValid(parsed)) return parsed;
  const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameRetry(file, aside);
  if (process.platform !== 'win32') fs.chmodSync(aside, 0o600);
  warn(`${file} could not be read as a Boppi ${name}; moved it aside to ${aside} and started with an empty one.`);
  return null;
}

const ENTRY_KEYS = ['id', 'origin', 'digest', 'queuedAt'];
const validQueue = q => q && q.schemaVersion === 1 && Array.isArray(q.entries)
  && q.entries.every(e => e && ENTRY_KEYS.every(k => typeof e[k] === 'string') && Number.isFinite(Date.parse(e.queuedAt)) && e.body && typeof e.body === 'object' && Array.isArray(e.body.records));
const validState = s => s && s.schemaVersion === 1 && s.pushed && typeof s.pushed === 'object' && !Array.isArray(s.pushed);

/**
 * One watch --push per home: the queue and sent digests are read once at
 * start and written whole, so a second session would overwrite the first's.
 * Returns a release function; throws EBUSY naming the live holder.
 */
function lockSession(home) {
  const file = path.join(ensureDir(home), 'session.lock');
  const release = exclusiveLock(file);
  if (release) return release;
  let holder = null;
  try { holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* still being written */ }
  const who = holder && Number.isInteger(holder.pid) ? ` (process ${holder.pid}, started ${holder.startedAt})` : '';
  throw refuse('EBUSY', `another boppi watch --push${who} is already using ${storeDir(home)}. Only one runs per home at a time: stop it first, or let it keep pushing.`);
}

function loadQueue(home, warn) { return (readStore(home, 'queue.json', validQueue, warn) || { entries: [] }).entries; }
function saveQueue(home, entries) { writeAtomic(path.join(ensureDir(home), 'queue.json'), JSON.stringify({ schemaVersion: 1, entries }) + '\n'); }
function loadState(home, warn) { return (readStore(home, 'state.json', validState, warn) || { pushed: {} }).pushed; }
function saveState(home, pushed) { writeAtomic(path.join(ensureDir(home), 'state.json'), JSON.stringify({ schemaVersion: 1, pushed }) + '\n'); }

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The push side of one watch session. offer(prepared) is called with each
 * accepted scan's prepareIngest result; it pushes only a changed posture.
 * Every changed body is written to the outbox before it is sent, so a crash
 * mid-send replays it on the next start. Sends are serialized; entries go
 * oldest first and only to the origin of this session.
 *
 * deps: out(line), err(line), record(logEntry), onRevoked(), fetchImpl,
 * now(), random(). once: a couple of quick retries, then leave the entry queued.
 */
function createPusher({ home, ingestUrl, token, once = false, baseMs = BACKOFF.baseMs }, deps) {
  const { out, err, record, onRevoked = () => {}, fetchImpl = globalThis.fetch, now = Date.now, random = Math.random } = deps;
  const origin = ingestUrl.origin;
  const workspace = push.workspaceUrl(ingestUrl);
  const stateKey = `${origin} ${tokenTag(token)}`;
  const stamp = () => new Date(now()).toISOString();
  let queue = [];
  let pushed = {};
  const fresh = new Set();
  const announcedQueued = new Set();
  let attempt = 0;
  let retryTimer = null;
  let flushing = null;
  let revoked = false;
  let unreachable = false;
  let unlock = null;

  const mine = () => queue.filter(entry => entry.origin === origin);
  const log = (outcome, entry, extra = {}) => record({ kind: 'push', at: stamp(), outcome, digest: entry ? entry.digest : null, ...extra, queued: mine().length });

  function persistQueue() {
    const { kept, dropped } = applyCaps(queue, now());
    queue = kept;
    for (const { entry, why } of dropped) {
      err(`watch: dropped a queued push from ${entry.queuedAt} for ${entry.origin} (${why}); the next change is pushed in full.`);
      if (entry.origin === origin) log('dropped', entry, { reason: why });
    }
    saveQueue(home, queue);
  }

  function open() {
    unlock = lockSession(home);
    queue = loadQueue(home, err);
    pushed = loadState(home, err);
    if (queue.length) persistQueue();
    const waiting = mine().length;
    if (waiting) out(`[${stamp()}] PUSH    ${plural(waiting, 'queued push')} from an earlier run will be sent to ${workspace} first`);
  }

  const reference = () => { const pending = mine(); return pending.length ? pending[pending.length - 1].digest : (pushed[stateKey] && pushed[stateKey].digest) || null; };

  async function sendOnce(entry) {
    let result = await push.postBody({ ingestUrl, token, body: entry.body, fetchImpl });
    for (let retry = 1; once && retry <= BACKOFF.onceRetries && classify(result) === 'retry'; retry++) {
      await new Promise(resolve => setTimeout(resolve, Math.min(baseMs, BACKOFF.onceDelayMs) * retry));
      result = await push.postBody({ ingestUrl, token, body: entry.body, fetchImpl });
    }
    return result;
  }

  async function drain() {
    for (;;) {
      if (revoked) return 'revoked';
      const entry = mine()[0];
      if (!entry) return 'ok';
      const result = await sendOnce(entry);
      const action = classify(result);
      if (action === 'sent') {
        pushed[stateKey] = { digest: entry.digest, at: stamp() };
        saveState(home, pushed);
        queue = queue.filter(e => e !== entry);
        persistQueue();
        attempt = 0;
        const snapshotId = result.body && typeof result.body.snapshotId === 'string' ? result.body.snapshotId : undefined;
        const outcome = fresh.has(entry.id) ? 'sent' : 'flushed';
        fresh.delete(entry.id);
        const records = entry.body.records.length;
        out(`[${stamp()}] PUSH    ${outcome} ${plural(records, 'record')} to ${workspace}${entry.body.snapshot ? ' as a full snapshot' : ' (merged, nothing removed)'}${outcome === 'flushed' ? ` (queued at ${entry.queuedAt})` : ''}. ${PRIVACY_LINE}`);
        log(outcome, entry, { status: result.status, ...(snapshotId ? { snapshotId } : {}) });
        continue;
      }
      if (action === 'revoked') {
        const discarded = mine().length;
        queue = queue.filter(e => e.origin !== origin);
        persistQueue();
        delete pushed[stateKey];
        saveState(home, pushed);
        revoked = true;
        err(`watch: the workspace at ${workspace} no longer accepts this collector token (HTTP ${result.status}: revoked or wrong). Create a new token on the Collectors page, then start boppi watch --push again.`);
        err(`watch: discarded ${plural(discarded, 'queued push')} for ${workspace}; with a new token they would go to whichever collector that token belongs to, so the next run sends a fresh scan instead.`);
        log('revoked', entry, { status: result.status, discarded });
        onRevoked();
        return 'revoked';
      }
      if (action === 'drop') {
        queue = queue.filter(e => e !== entry);
        persistQueue();
        fresh.delete(entry.id);
        err(`watch: dropped one push. ${push.describeFailure(result)}`);
        log('dropped', entry, { status: result.status, ...(result.body && result.body.code ? { code: result.body.code } : {}) });
        continue;
      }
      attempt++;
      fresh.delete(entry.id);
      if (once) unreachable = true;
      const reason = result.networkError ? `could not reach ${workspace}: ${result.networkError}` : `${workspace} answered HTTP ${result.status}`;
      const retryAfterSeconds = result.body && Number.isFinite(result.body.retryAfterSeconds) ? result.body.retryAfterSeconds : result.retryAfter;
      const wait = once ? null : retryDelay(attempt, { baseMs, retryAfterSeconds, random });
      if (!announcedQueued.has(entry.id)) {
        announcedQueued.add(entry.id);
        log('queued', entry, result.status ? { status: result.status } : {});
      }
      out(`[${stamp()}] PUSH    ${reason}; ${plural(mine().length, 'push')} queued in ${storeDir(home)}${wait === null ? ' for the next run' : `, retrying in ${Math.ceil(wait / 1000)} s`}`);
      if (wait !== null) retryTimer = setTimeout(() => { retryTimer = null; flush(); }, wait);
      return 'pending';
    }
  }

  /** Send queued entries for this origin, oldest first. Resolves to 'ok' | 'pending' | 'revoked'. */
  function flush() {
    if (revoked) return Promise.resolve('revoked');
    if (retryTimer || unreachable) return Promise.resolve('pending');
    if (!flushing) flushing = drain().finally(() => { flushing = null; });
    return flushing;
  }

  /**
   * Offer one accepted scan. Resolves to 'unchanged' | 'unsafe' | 'empty' |
   * the flush result. quiet: do not log an unchanged posture (a periodic
   * rescan that saw nothing new).
   */
  async function offer(prepared, { quiet = false } = {}) {
    if (revoked) return 'revoked';
    if (prepared.unsafe.length) {
      err(push.describeUnsafe(prepared.unsafe).replace(/^push:/, 'watch:'));
      record({ kind: 'push', at: stamp(), outcome: 'dropped', digest: null, reason: 'unsafe_fields', queued: mine().length });
      return 'unsafe';
    }
    if (!prepared.records.length) {
      if (!quiet) out(`[${stamp()}] PUSH    nothing to push: no AI agent configuration was found on this machine`);
      return 'empty';
    }
    const digest = digestOf(prepared.body);
    if (digest === reference()) {
      if (!quiet) {
        out(`[${stamp()}] PUSH    unchanged since the last push to ${workspace}; nothing sent`);
        record({ kind: 'push', at: stamp(), outcome: 'unchanged', digest, queued: mine().length });
      }
      return mine().length ? flush() : 'unchanged';
    }
    const entry = { id: crypto.randomUUID(), origin, digest, queuedAt: stamp(), body: prepared.body };
    queue.push(entry);
    fresh.add(entry.id);
    persistQueue();
    return flush();
  }

  function close() {
    clearTimeout(retryTimer); retryTimer = null;
    const release = unlock;
    unlock = null;
    // A send in flight still writes the queue when it settles, so the lock is held until then.
    if (release) { if (flushing) flushing.finally(release); else release(); }
  }

  return { open, offer, flush, close, workspace, pending: () => mine().length, isRevoked: () => revoked };
}

module.exports = { QUEUE_CAPS, BACKOFF, PRIVACY_LINE, storeDir, canonical, digestOf, tokenTag, classify, retryDelay, applyCaps, writeAtomic, readStore, lockSession, loadQueue, saveQueue, loadState, createPusher };
