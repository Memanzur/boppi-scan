/**
 * Just-in-time server grants, device side (BOPPI_JIT_PERMISSION_DESIGN.md
 * sections 2, 3, 7, 8). A workspace admin approves a catalog server entry
 * for one client file on this machine for a bounded time; this module adds
 * exactly that entry through the safe-write path, keeps a local lease with
 * the absolute expiry, and removes the entry when the lease ends, offline.
 *
 * Lease store <home>/.boppi/jit-leases.json, owner-only, replaced through a
 * temp file and a rename under locks/jit-leases.lock:
 *   { schemaVersion, latestSeenAt, leases: [Lease] }
 * `file` in a lease is a local path and never leaves the machine.
 * latestSeenAt is the latest device clock any store write saw, so a clock
 * turned back never extends a lease.
 *
 * Lock order is always the config file's lock, then the store lock.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fix = require('./fix');
const scanner = require('../engine/localMcpScanner');

const SCHEMA_VERSION = 1;
const HARD_CAP_MS = 8 * 60 * 60 * 1000;
const CLOSED_KEEP = 64;
const EMPTY_HASH = fix.sha256(Buffer.alloc(0));
const NONCE = /^[A-Za-z0-9_-]{8,128}$/;
const SERVER_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const CONTROL = /[\u0000-\u001f\u007f]/;
const CLIENTS = Object.freeze(['claude-desktop', 'claude-code', 'cursor']);

/**
 * applying  claimed; the entry may or may not be written yet (a crash can stop anywhere)
 * active    written and read back with the bound entry hash
 * failed    refused or not written; the file is as it was; the applied report may still be owed
 * reverted  the entry is gone from the file; the revoked report is owed
 * closed    the workspace took the revoked report; kept as history so the gate knows the name
 */
const LEASE_STATES = Object.freeze(['applying', 'active', 'failed', 'reverted', 'closed']);
const HOLDS_ENTRY = new Set(['applying', 'active']);
const REVOKING = new Set(['revoking', 'revocation_unverified']);

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const iso = ms => new Date(ms).toISOString();

function storeFile(home) { return path.join(home, '.boppi', 'jit-leases.json'); }

/** sha256 over the command and its arguments, one per line, as the workspace computes it. */
function entryHash(entry) { return fix.sha256(Buffer.from([entry.command, ...entry.args].join('\n'), 'utf8')); }

/** The `{ command, args }` part of a config entry, or null when it is not that shape. */
function entryOf(value) {
  if (!isObject(value) || typeof value.command !== 'string' || !Array.isArray(value.args) || !value.args.every(a => typeof a === 'string')) return null;
  return { command: value.command, args: value.args };
}

function validLease(lease) {
  return isObject(lease) && LEASE_STATES.includes(lease.state)
    && ['grantId', 'nonce', 'client', 'targetFile', 'file', 'server', 'entryHash', 'expiresAt', 'localExpiresAt'].every(key => typeof lease[key] === 'string')
    && !Number.isNaN(Date.parse(lease.localExpiresAt));
}

const emptyStore = () => ({ schemaVersion: SCHEMA_VERSION, latestSeenAt: iso(0), leases: [] });

/** { ok: true, exists, store } or { ok: false, reason }. A missing store is an empty one; anything else that is not a valid store is refused and never overwritten. */
function readStore(home) {
  const opened = fix.openRegular(storeFile(home));
  if (!opened.regularFile) return opened.failureCode === 'file_missing' ? { ok: true, exists: false, store: emptyStore() } : { ok: false, reason: opened.failureCode };
  let raw;
  try { raw = JSON.parse(opened.bytes.toString('utf8')); } catch (_) { return { ok: false, reason: 'invalid JSON' }; }
  if (!isObject(raw) || raw.schemaVersion !== SCHEMA_VERSION || Number.isNaN(Date.parse(raw.latestSeenAt)) || !Array.isArray(raw.leases) || !raw.leases.every(validLease)) return { ok: false, reason: 'unsupported shape' };
  return { ok: true, exists: true, store: raw };
}

/** The device's "now": never earlier than a time a store write already saw. */
function effectiveNow(store, clock) { return Math.max(clock, Date.parse(store.latestSeenAt) || 0); }

/** The earlier of the workspace expiry and the device-measured remaining time, capped at 8 hours after the claim. */
function localExpiry({ expiresAt, serverNow, deviceNow }) {
  const server = Date.parse(expiresAt);
  const remaining = server - Date.parse(serverNow);
  const measured = Number.isFinite(remaining) ? deviceNow + remaining : server;
  return iso(Math.min(server, measured, deviceNow + HARD_CAP_MS));
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/**
 * Read, change and write the store under its lock; change(store) mutates
 * in place. Throws when the store is unreadable (it is never replaced
 * blindly) or the lock stays busy for two seconds.
 */
function mutateStore(home, clock, change) {
  let release = null;
  for (let attempt = 0; attempt < 100 && !release; attempt++) {
    release = fix.acquireLock(home, 'jit-leases');
    if (!release) sleepSync(20);
  }
  if (!release) throw new Error('lease_store_busy');
  try {
    const read = readStore(home);
    if (!read.ok) throw new Error(`lease_store_unreadable: ${read.reason}`);
    const store = read.store;
    const result = change(store);
    store.latestSeenAt = iso(effectiveNow(store, clock));
    const closed = store.leases.filter(l => l.state === 'closed');
    const drop = new Set(closed.slice(0, Math.max(0, closed.length - CLOSED_KEEP)));
    store.leases = store.leases.filter(l => !drop.has(l));
    fs.mkdirSync(path.dirname(storeFile(home)), { recursive: true, mode: 0o700 });
    fix.writeAtomic(storeFile(home), JSON.stringify(store, null, 2) + '\n', 0o600);
    return result;
  } finally { release(); }
}

function putLease(home, clock, lease) {
  mutateStore(home, clock, store => {
    store.leases = store.leases.filter(l => l.grantId !== lease.grantId);
    store.leases.push(lease);
  });
}

function updateLease(home, clock, grantId, patch) {
  return mutateStore(home, clock, store => {
    const lease = store.leases.find(l => l.grantId === grantId);
    if (lease) Object.assign(lease, patch);
    return lease ? { ...lease } : null;
  });
}

function dropLease(home, clock, grantId) {
  mutateStore(home, clock, store => { store.leases = store.leases.filter(l => l.grantId !== grantId); });
}

function leaseNamed(home, grantId) {
  const read = readStore(home);
  return read.ok ? read.store.leases.find(l => l.grantId === grantId) || null : null;
}

/** Whether a binding names an entry this device can write: known client, a plain name, a command and string arguments without control characters, exactly { command, args }, and the hash the workspace bound. */
function validBinding(binding) {
  if (!isObject(binding) || !CLIENTS.includes(binding.client)) return false;
  if (typeof binding.server !== 'string' || !SERVER_NAME.test(binding.server) || FORBIDDEN_NAMES.has(binding.server)) return false;
  const entry = entryOf(binding.entry);
  if (!entry || !entry.command || entry.command.length > 1024 || CONTROL.test(entry.command) || entry.args.length > 64 || entry.args.some(a => a.length > 4096 || CONTROL.test(a))) return false;
  if (Object.keys(binding.entry).some(key => key !== 'command' && key !== 'args')) return false;
  return binding.entryHash === entryHash(entry) && typeof binding.project === 'string' && typeof binding.targetFile === 'string';
}

/** The user-scope file of each client, as a scan with these options reads it. */
function userScopeFiles(options) {
  return fix.descriptorsFor(options).filter(d => CLIENTS.includes(d.clientKey)).map(d => {
    const file = d.files.find(f => f.scope === 'user');
    return file ? { client: d.clientKey, file: path.resolve(file.path) } : null;
  }).filter(Boolean);
}

/** One target per client user-scope file that is a regular file holding a JSON object, with its local path kept beside the wire fields. */
function targets(options, computedAt) {
  const project = scanner.pathFingerprint(path.resolve(options.cwd));
  const out = [];
  for (const { client, file } of userScopeFiles(options)) {
    const opened = fix.openRegular(file);
    if (!opened.regularFile) continue;
    let json;
    try { json = JSON.parse(opened.bytes.toString('utf8')); } catch (_) { continue; }
    if (!isObject(json) || (hasOwn(json, 'mcpServers') && !isObject(json.mcpServers))) continue;
    out.push({ client, project, targetFile: scanner.pathFingerprint(file), configHash: fix.sha256(opened.bytes), servers: Object.keys(json.mcpServers || {}).slice(0, 128), computedAt, file });
  }
  return out;
}

const writeCode = error => (error.code === 'EACCES' || error.code === 'EPERM' ? 'permission_denied' : 'other');

/**
 * Write one claimed grant: lock the file, reopen it without following a
 * link, refuse a name already there, record the lease as `applying`, back
 * up, add exactly { command, args } at top-level mcpServers, write
 * atomically, read back and compare the entry hash, record the manifest
 * entry, mark the lease `active`. On any failure the file is as it was and
 * the lease, when one was written, is `failed`.
 */
function applyGrant({ home, clock = Date.now(), lease, entry }) {
  const release = fix.acquireLock(home, lease.targetFile);
  if (!release) return { ok: false, failureCode: 'lock_busy', hashAtWrite: EMPTY_HASH };
  let leaseWritten = false;
  const fail = (failureCode, hashAtWrite = EMPTY_HASH) => {
    if (leaseWritten) { try { updateLease(home, clock, lease.grantId, { state: 'failed', failureCode }); } catch (_) { /* stays applying; the next cycle reports it */ } }
    return { ok: false, failureCode, hashAtWrite };
  };
  try {
    const opened = fix.openRegular(lease.file);
    if (!opened.regularFile) return fail(opened.failureCode);
    const hashAtWrite = fix.sha256(opened.bytes);
    let json;
    try { json = JSON.parse(opened.bytes.toString('utf8')); } catch (_) { return fail('other', hashAtWrite); }
    if (!isObject(json) || (hasOwn(json, 'mcpServers') && !isObject(json.mcpServers))) return fail('other', hashAtWrite);
    if (hasOwn(json, 'mcpServers') && hasOwn(json.mcpServers, lease.server)) return fail('name_exists', hashAtWrite);
    try { putLease(home, clock, { ...lease, state: 'applying', hashAtWrite }); } catch (_) { return fail('lease_store', hashAtWrite); }
    leaseWritten = true;
    let backup;
    try { backup = fix.writeBackup({ file: lease.file, home, now: iso(clock), bytes: opened.bytes }); } catch (_) { return fail('backup_failed', hashAtWrite); }
    if (!hasOwn(json, 'mcpServers')) json.mcpServers = {};
    json.mcpServers[lease.server] = { command: entry.command, args: [...entry.args] };
    try { fix.writeAtomic(lease.file, JSON.stringify(json, null, 2) + '\n', opened.mode); } catch (error) {
      fs.rmSync(backup, { force: true });
      return fail(writeCode(error), hashAtWrite);
    }
    const written = fix.openRegular(lease.file);
    let readBack = null;
    try { readBack = written.regularFile ? entryOf(JSON.parse(written.bytes.toString('utf8')).mcpServers[lease.server]) : null; } catch (_) { /* compared below */ }
    if (!readBack || entryHash(readBack) !== lease.entryHash) {
      try { fix.writeAtomic(lease.file, opened.bytes, opened.mode); } catch (_) { /* revert removes the entry by name */ }
      fs.rmSync(backup, { force: true });
      return fail('validation_failed', hashAtWrite);
    }
    const appliedHash = fix.sha256(written.bytes);
    let manifestEntry = null;
    try {
      manifestEntry = fix.appendManifestEntry(home, { createdAt: iso(clock), action: 'jit_grant', backup, original: lease.file, clientKey: lease.client, server: lease.server, keyPath: ['mcpServers', lease.server], grantId: lease.grantId, backupHash: hashAtWrite, appliedHash });
    } catch (_) { /* the grant is written and leased, which is all revert needs */ }
    try { updateLease(home, clock, lease.grantId, { state: 'active', appliedHash, appliedAt: iso(clock) }); } catch (_) { /* stays applying; the next cycle finds the entry and reports it */ }
    return { ok: true, hashAtWrite, appliedHash, entryHash: lease.entryHash, backup, manifestId: manifestEntry && manifestEntry.id };
  } catch (_) {
    return fail('other');
  } finally { release(); }
}

/** The parsed file and whether the lease's name is in its top-level mcpServers. */
function inspect(file, server) {
  const opened = fix.openRegular(file);
  if (!opened.regularFile) return { opened, present: false };
  try {
    const json = JSON.parse(opened.bytes.toString('utf8'));
    const servers = isObject(json) && isObject(json.mcpServers) ? json.mcpServers : null;
    return { opened, json, servers, present: !!servers && hasOwn(servers, server) };
  } catch (_) { return { opened, invalid: true, present: false }; }
}

/**
 * Remove a lease's entry by name and mark the lease reverted with the hash
 * of the file after the removal. Idempotent: an entry already gone is
 * reverted. A lease still `applying` removes only an entry carrying its own
 * hash, since its write may never have happened. Returns
 * { ok, revertedHash, removed } or { ok: false, failureCode }; a failure
 * keeps the lease as it was.
 */
function revertLease(home, lease, clock = Date.now()) {
  const release = fix.acquireLock(home, lease.targetFile);
  if (!release) return { ok: false, failureCode: 'lock_busy' };
  try {
    const before = inspect(lease.file, lease.server);
    if (!before.opened.regularFile && before.opened.failureCode !== 'file_missing') return { ok: false, failureCode: before.opened.failureCode };
    if (before.invalid) return { ok: false, failureCode: 'invalid_json' };
    const entry = before.present ? entryOf(before.servers[lease.server]) : null;
    const ours = before.present && (lease.state !== 'applying' || (entry && entryHash(entry) === lease.entryHash));
    let revertedHash = before.opened.regularFile ? fix.sha256(before.opened.bytes) : EMPTY_HASH;
    if (ours) {
      delete before.servers[lease.server];
      try { fix.writeAtomic(lease.file, JSON.stringify(before.json, null, 2) + '\n', before.opened.mode); } catch (error) { return { ok: false, failureCode: writeCode(error) }; }
      const after = inspect(lease.file, lease.server);
      if (!after.opened.regularFile || after.invalid || after.present) return { ok: false, failureCode: 'validation_failed' };
      revertedHash = fix.sha256(after.opened.bytes);
      try { fix.appendManifestEntry(home, { createdAt: iso(clock), action: 'jit_revert', original: lease.file, clientKey: lease.client, server: lease.server, grantId: lease.grantId, backupHash: fix.sha256(before.opened.bytes), appliedHash: revertedHash }); } catch (_) { /* audit only */ }
    }
    try { updateLease(home, clock, lease.grantId, { state: 'reverted', revertedHash, revertedAt: iso(clock) }); } catch (_) { return { ok: false, failureCode: 'lease_store' }; }
    return { ok: true, revertedHash, removed: ours };
  } finally { release(); }
}

/** Whether a reverted lease's entry is back in its file and no other lease holds that name there now (a renewal applied after it). */
function cameBack(leases, lease) {
  if (lease.state !== 'reverted' || leases.some(l => l !== lease && HOLDS_ENTRY.has(l.state) && l.file === lease.file && l.server === lease.server)) return false;
  return inspect(lease.file, lease.server).present;
}

/**
 * Revert every lease that should no longer hold an entry: leases past their
 * local expiry (every holding lease with `all`), and reverted leases whose
 * entry is back in the file. No network. Never throws.
 * Returns { reverted: [lease], failed: [{ lease, failureCode }], storeError }.
 */
function enforceLeases(home, clock = Date.now(), { all = false } = {}) {
  const result = { reverted: [], failed: [], storeError: null };
  let read;
  try { read = readStore(home); } catch (error) { result.storeError = error.message; return result; }
  if (!read.ok) { result.storeError = read.reason; return result; }
  if (!read.exists) return result;
  const now = effectiveNow(read.store, clock);
  const due = read.store.leases.filter(l => (HOLDS_ENTRY.has(l.state) && (all || Date.parse(l.localExpiresAt) <= now)) || cameBack(read.store.leases, l));
  for (const lease of due) {
    let outcome;
    // A reverted lease whose entry came back removes it by name, like an active one.
    try { outcome = revertLease(home, lease.state === 'reverted' ? { ...lease, state: 'active' } : lease, clock); } catch (_) { outcome = { ok: false, failureCode: 'other' }; }
    if (outcome.ok) result.reverted.push({ ...lease, state: 'reverted', revertedHash: outcome.revertedHash, removed: outcome.removed });
    else result.failed.push({ lease, failureCode: outcome.failureCode });
  }
  if (!due.length && read.store.leases.some(l => HOLDS_ENTRY.has(l.state))) {
    try { mutateStore(home, clock, () => {}); } catch (_) { /* the clock guard advances on the next write */ }
  }
  return result;
}

/** One stderr line for a normal command, or null when nothing happened. It names servers and clients, never a file. */
function enforcementLine(result) {
  const parts = [];
  if (result.storeError) parts.push(`the just-in-time lease store is unreadable (${result.storeError}); expired grants cannot be removed until it is repaired`);
  const removed = result.reverted.filter(l => l.removed);
  if (removed.length) parts.push(`removed expired just-in-time access to ${removed.map(l => `"${l.server}" (${l.client})`).join(', ')}; a client already running keeps it until restart; boppi connect run reports it to the workspace`);
  if (result.failed.length) parts.push(`could not remove expired just-in-time access to ${result.failed.map(f => `"${f.lease.server}" (${f.lease.client}, ${f.failureCode})`).join(', ')}; the lease is kept and retried on the next boppi command`);
  return parts.length ? `boppi: ${parts.join('; ')}` : null;
}

/**
 * The gate's answer for one PreToolUse tool name: null to allow, or the
 * reason to deny. Only MCP tools are judged. A server is JIT-managed when a
 * lease names it for Claude Code (a failed apply never wrote it, so it does
 * not count); it is allowed only while one of its leases is active and
 * unexpired. A store that exists but cannot be read denies every MCP call.
 */
function gateDecision(home, toolName, clock = Date.now()) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null;
  let read;
  try { read = readStore(home); } catch (_) { read = { ok: false }; }
  if (!read.ok) return 'Boppi just-in-time gate: the local lease store is unreadable, so every MCP tool call is refused until it is repaired. Run boppi connect status.';
  const managed = read.store.leases.filter(l => l.client === 'claude-code' && l.state !== 'failed' && toolName.startsWith(`mcp__${l.server}__`));
  if (!managed.length) return null;
  const server = managed.map(l => l.server).sort((a, b) => b.length - a.length)[0];
  const now = effectiveNow(read.store, clock);
  if (managed.some(l => l.server === server && l.state === 'active' && Date.parse(l.localExpiresAt) > now)) return null;
  return `Boppi just-in-time gate: the MCP server "${server}" has no live grant on this machine (it expired, was revoked, or was never applied). Request access again in the Boppi workspace.`;
}

function renderLeases(home, clock = Date.now()) {
  const read = readStore(home);
  if (!read.ok) return [`  jit grants: the lease store is unreadable (${read.reason}); nothing can be applied or reverted until it is repaired`];
  if (!read.store.leases.length) return ['  jit grants: none on this machine'];
  const now = effectiveNow(read.store, clock);
  return [`  jit grants: ${read.store.leases.length} lease(s); an entry is removed at its local expiry by the next boppi command, offline`,
    ...read.store.leases.map(l => {
      const left = Date.parse(l.localExpiresAt) - now;
      const when = !HOLDS_ENTRY.has(l.state) ? `local expiry was ${l.localExpiresAt}` : left > 0 ? `local expiry ${l.localExpiresAt} (in ${Math.ceil(left / 60000)} min)` : `expired ${l.localExpiresAt}; removed by the next boppi command`;
      return `    "${l.server}"  ${l.client.padEnd(14)} ${l.state.padEnd(8)}  ${when}`;
    })];
}

/**
 * The just-in-time part of one `connect run` cycle. post(route, body) is
 * the connector's request with this device's credential; describe(route,
 * result) words a failure. Returns the number of problems.
 */
async function runCycle({ options, pairing, deps, post, describe, out, err, versions, scan }) {
  const home = options.home;
  const clock = () => (deps.now ? deps.now() : Date.now());
  const say = (lease, text) => `  jit ${lease.grantId}  "${lease.server}" on ${lease.client}: ${text}`;
  let problems = 0;

  const enforced = enforceLeases(home, clock());
  for (const lease of enforced.reverted) out(say(lease, 'local lease expired; entry removed from the configuration (a client already running keeps it until restart)'));
  for (const { lease, failureCode } of enforced.failed) { problems++; err(say(lease, `expired but not removed (${failureCode}); the lease is kept`)); }
  if (enforced.storeError) { err(`  jit: the lease store is unreadable (${enforced.storeError}); no grant is applied or reverted until it is repaired`); return problems + 1; }

  const offered = targets(options, scan.startedAt);
  const polled = await post('jit/poll', { targets: offered.map(({ file, ...wire }) => wire), versions });
  if (polled.status === 404) { out('  jit: this workspace does not offer just-in-time grants (HTTP 404 on jit/poll); skipped'); return problems; }
  if (!polled.ok) { err(`  jit: ${describe('jit/poll', polled)}`); return problems + 1; }
  const serverNow = typeof polled.body.serverNow === 'string' && !Number.isNaN(Date.parse(polled.body.serverNow)) ? polled.body.serverNow : null;
  const grants = Array.isArray(polled.body.grants) ? polled.body.grants.filter(g => isObject(g) && typeof g.id === 'string' && typeof g.state === 'string') : [];
  const listed = new Map(grants.map(g => [g.id, g]));
  out(`  jit: ${offered.length} target file(s) offered (fingerprints, hashes, entry names; no paths), ${grants.length} grant(s) listed`);
  const leases = () => { const read = readStore(home); return read.ok ? read.store.leases : []; };

  const revertNow = (lease, why) => {
    const outcome = revertLease(home, lease, clock());
    if (outcome.ok) out(say(lease, `${why}; entry ${outcome.removed ? 'removed from' : 'already absent from'} the configuration (a client already running keeps it until restart)`));
    else { problems++; err(say(lease, `${why}, but not removed (${outcome.failureCode}); the lease is kept and retried`)); }
  };

  /** active stands; anything else the workspace answers means the entry must go; wrong_state means the workspace already took the report. */
  const reportApplied = async (lease, body) => {
    const answer = await post('jit/applied', { grantId: lease.grantId, nonce: lease.nonce, ...body });
    if (answer.networkError) { problems++; err(say(lease, `applied report: ${describe('jit/applied', answer)}; sent again on the next run`)); return; }
    const wrongState = answer.status === 409 && answer.body && answer.body.error === 'wrong_state';
    if (body.failureCode) {
      const current = leaseNamed(home, lease.grantId);
      // Ended while applying: nothing was written, but the workspace waits for a revocation report, so the lease becomes reverted with the file as it is.
      if (answer.ok && answer.body.state === 'revoking' && current) revertNow({ ...current, state: 'applying' }, 'ended while applying');
      else if (answer.ok || wrongState) { try { dropLease(home, clock(), lease.grantId); } catch (_) { /* reported again */ } }
      else { problems++; err(say(lease, `failure report: ${describe('jit/applied', answer)}`)); }
      return;
    }
    if ((answer.ok && answer.body.state === 'active') || wrongState) {
      updateLease(home, clock(), lease.grantId, { appliedReported: true });
      out(say(lease, `applied report taken; workspace state ${answer.body.state || answer.body.error}`));
      return;
    }
    if (answer.ok) { updateLease(home, clock(), lease.grantId, { appliedReported: true }); revertNow(leaseNamed(home, lease.grantId) || lease, `the workspace answered ${answer.body.state}`); return; }
    problems++; err(say(lease, `applied report: ${describe('jit/applied', answer)}`));
  };

  for (const lease of leases()) {
    const grant = listed.get(lease.grantId);
    if (HOLDS_ENTRY.has(lease.state) && (!grant || REVOKING.has(grant.state))) { revertNow(lease, grant ? `the workspace is revoking it (${grant.state})` : 'the workspace no longer lists it'); continue; }
    if (lease.state === 'failed') { await reportApplied(lease, { hashAtWrite: lease.hashAtWrite || EMPTY_HASH, failureCode: lease.failureCode || 'other' }); continue; }
    if (lease.state === 'applying') {
      const now = inspect(lease.file, lease.server);
      const entry = now.present ? entryOf(now.servers[lease.server]) : null;
      if (entry && entryHash(entry) === lease.entryHash) {
        const active = updateLease(home, clock(), lease.grantId, { state: 'active', appliedHash: fix.sha256(now.opened.bytes), appliedAt: iso(clock()) });
        out(say(lease, 'an earlier run wrote the entry and stopped before reporting it; reporting now'));
        await reportApplied(active, { hashAtWrite: lease.hashAtWrite || EMPTY_HASH, appliedHash: active.appliedHash, entryHash: lease.entryHash });
      } else {
        updateLease(home, clock(), lease.grantId, { state: 'failed', failureCode: 'other' });
        await reportApplied(lease, { hashAtWrite: lease.hashAtWrite || EMPTY_HASH, failureCode: 'other' });
      }
      continue;
    }
    if (lease.state === 'active' && !lease.appliedReported) await reportApplied(lease, { hashAtWrite: lease.hashAtWrite || EMPTY_HASH, appliedHash: lease.appliedHash, entryHash: lease.entryHash });
  }

  for (const grant of grants.filter(g => g.state === 'approved')) {
    problems += await applyApproved({ grant, options, pairing, deps, post, describe, out, err, offered, serverNow, clock, reportApplied, leases, versions });
  }

  const owed = leases().filter(l => l.state === 'reverted');
  if (!owed.length) return problems;
  for (const lease of owed) if (cameBack(leases(), lease)) revertNow({ ...lease, state: 'active' }, 'the entry was back in the configuration after its revert');
  const after = await deps.performScan(options);
  if (after.failed) { err(`  jit: rescan failed (${after.failed}); revocation reports are sent on the next run`); return problems + 1; }
  for (const lease of leases().filter(l => l.state === 'reverted')) {
    const client = after.discovery.clients.find(c => c.clientKey === lease.client);
    const serverPresent = !!(client && client.mergedServers && hasOwn(client.mergedServers, lease.server));
    const opened = fix.openRegular(lease.file);
    const configHash = opened.regularFile ? fix.sha256(opened.bytes) : EMPTY_HASH;
    const answer = await post('jit/revoked', { grantId: lease.grantId, nonce: lease.nonce, revertedHash: lease.revertedHash, scannedAt: after.startedAt, configHash, serverPresent, versions });
    const wrongState = answer.status === 409 && answer.body && answer.body.error === 'wrong_state';
    if ((answer.ok && answer.body.state === 'revoked') || wrongState) {
      updateLease(home, clock(), lease.grantId, { state: 'closed', closedAt: iso(clock()) });
      out(say(lease, `removal reported from a rescan (server ${serverPresent ? 'still present' : 'absent'} in this client); workspace state ${answer.body.state || answer.body.error}`));
    } else { problems++; err(say(lease, `revocation report: ${describe('jit/revoked', answer)}${serverPresent ? '; the rescan still finds the server in this client' : ''}; sent again on the next run`)); }
  }
  return problems;
}

/** Show, confirm, claim, apply and report one approved grant. Returns the number of problems (0 or 1). */
async function applyApproved({ grant, options, pairing, deps, post, describe, out, err, offered, serverNow, clock, reportApplied, leases, versions }) {
  const b = grant.binding;
  const label = `  jit ${grant.id}`;
  if (!validBinding(b) || (b.deviceId && b.deviceId !== pairing.deviceId)) { out(`${label}  refused (invalid_binding): the grant does not name a plain { command, args } entry for this device; not claimed, nothing written`); return 0; }
  const target = offered.find(t => t.client === b.client && t.project === b.project && t.targetFile === b.targetFile);
  if (!target) { out(`${label}  refused (not_offered): "${b.server}" on ${b.client} is not bound to a file this device offered from this folder; not claimed, nothing written`); return 0; }
  if (leases().some(l => l.grantId === grant.id)) return 0;
  if (target.servers.includes(b.server) || leases().some(l => l.targetFile === b.targetFile && l.server === b.server && HOLDS_ENTRY.has(l.state))) {
    out(`${label}  waiting: "${b.server}" is already in that ${b.client} configuration (or an earlier grant still holds it); not claimed until it is gone`);
    return 0;
  }
  const expiresAt = typeof grant.expiresAt === 'string' ? grant.expiresAt : null;
  if (expiresAt && Date.parse(expiresAt) <= clock()) { out(`${label}  expired at ${expiresAt}; not claiming`); return 0; }
  out(`\n${label}  approved${grant.approvedAt ? ` at ${grant.approvedAt}` : ''} in ${pairing.workspaceName || 'the workspace'}: add "${b.server}" to ${b.client}, requested by ${b.requestedBy || 'unknown'}`);
  out(`    entry:   ${JSON.stringify({ command: b.entry.command, args: b.entry.args })}`);
  out(`    file:    ${target.file}`);
  out(`    until:   ${expiresAt || 'the workspace expiry'} at the latest; then removed even offline, by the next boppi command or connect run --watch`);
  out('    removal is from the configuration: a client already running keeps the server until it restarts');
  if (options.yes) out('    local confirmation skipped (--yes)');
  else if (!process.stdin.isTTY) { out('    waiting: no terminal to confirm on; the grant stays approved in the workspace. Run boppi connect run in a terminal, or pass --yes.'); return 0; }
  else if (!(await deps.confirm('    Add this server for that time? [y/N] '))) { out('    not applied here; the grant stays approved until it expires or is revoked.'); return 0; }

  const claimed = await post('jit/claim', { grantId: grant.id, versions });
  if (!claimed.ok) { err(`    claim: ${describe('jit/claim', claimed)}`); return 1; }
  const c = claimed.body;
  if (typeof c.nonce !== 'string' || !NONCE.test(c.nonce) || Number.isNaN(Date.parse(c.expiresAt))) { out('    the workspace answered the claim without a usable nonce or expiry; nothing written'); return 1; }
  const read = readStore(options.home);
  const deviceNow = read.ok ? effectiveNow(read.store, clock()) : clock();
  const lease = {
    grantId: grant.id, nonce: c.nonce, client: b.client, targetFile: b.targetFile, file: target.file, server: b.server, entryHash: b.entryHash,
    expiresAt: c.expiresAt, localExpiresAt: localExpiry({ expiresAt: c.expiresAt, serverNow: c.serverNow || serverNow, deviceNow }), claimedAt: iso(deviceNow),
    state: 'applying', hashAtWrite: null, appliedHash: null, revertedHash: null, appliedAt: null, revertedAt: null, appliedReported: false,
  };
  const applied = applyGrant({ home: options.home, clock: clock(), lease, entry: b.entry });
  if (applied.ok) {
    out(`    applied locally: backup ${applied.backup}${applied.manifestId ? `; manifest ${applied.manifestId}` : ''}; local expiry ${lease.localExpiresAt}`);
    await reportApplied(lease, { hashAtWrite: applied.hashAtWrite, appliedHash: applied.appliedHash, entryHash: applied.entryHash });
    return 0;
  }
  out(`    not written (${applied.failureCode}); the file is as it was`);
  // Keep the nonce until the failure is reported, so a lost answer is sent again.
  if (!leaseNamed(options.home, grant.id)) { try { putLease(options.home, clock(), { ...lease, state: 'failed', failureCode: applied.failureCode, hashAtWrite: applied.hashAtWrite }); } catch (_) { /* reported now or never */ } }
  await reportApplied(lease, { hashAtWrite: applied.hashAtWrite, failureCode: applied.failureCode });
  return 0;
}

/** `boppi connect revert-grants`: revert every lease that holds an entry, now, offline. Exit code. */
function runRevertGrants(options, out, err) {
  const result = enforceLeases(options.home, Date.now(), { all: true });
  if (result.storeError) { err(`connect revert-grants: the lease store ${storeFile(options.home)} is unreadable (${result.storeError}); nothing reverted`); return 3; }
  for (const lease of result.reverted) out(`  "${lease.server}" on ${lease.client}: entry ${lease.removed ? 'removed from' : 'already absent from'} the configuration`);
  for (const { lease, failureCode } of result.failed) err(`  "${lease.server}" on ${lease.client}: not removed (${failureCode}); the lease is kept`);
  out(result.reverted.length || result.failed.length
    ? `Reverted ${result.reverted.length} just-in-time grant(s) on this machine${result.failed.length ? `; ${result.failed.length} could not be` : ''}. boppi connect run reports the removals to the workspace. A client already running keeps a removed server until it restarts.`
    : 'No just-in-time grant holds an entry on this machine; nothing to revert.');
  return result.failed.length ? 3 : 0;
}

/** The earliest local expiry among leases that hold an entry, in ms, or null. */
function nextExpiry(home) {
  const read = readStore(home);
  if (!read.ok) return null;
  const times = read.store.leases.filter(l => HOLDS_ENTRY.has(l.state)).map(l => Date.parse(l.localExpiresAt));
  return times.length ? Math.min(...times) : null;
}

module.exports = { SCHEMA_VERSION, LEASE_STATES, HARD_CAP_MS, CLOSED_KEEP, storeFile, readStore, entryHash, effectiveNow, localExpiry, validBinding, targets, applyGrant, revertLease, enforceLeases, enforcementLine, gateDecision, renderLeases, runCycle, runRevertGrants, nextExpiry, putLease };
