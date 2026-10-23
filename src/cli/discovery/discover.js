/**
 * `boppi discover`: one consented stdio discovery of one configured MCP
 * server. Prints exactly what will be launched and sent, asks, runs the
 * session, stores the projection under ~/.boppi/discovery, and never touches
 * a passive scan's code path. See docs/phase3/DISCOVERY_SPIKE.md sections 3,
 * 4, 6, and 8. The four section-12 decisions are applied as recommended
 * until the founder decides: package-fetching launchers are refused outright,
 * descriptions are kept as 160-character excerpts, remote servers are not
 * supported, and a stored list is labelled stale after seven days.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const models = require('../../engine/models');
const scanner = require('../../engine/localMcpScanner');
const session = require('./session');
const { ALLOWED_METHODS } = require('./recorder');

const CACHE_SCHEMA_VERSION = 1;
const MAX_AGE_DAYS = 7;
const NEVER_SENT = Object.freeze(['tools/call', 'resources/read', 'prompts/get', 'sampling/createMessage', 'elicitation/create']);

function discoveryDir(home) { return path.join(home, '.boppi', 'discovery'); }
function cachePath(home, serverId) { return path.join(discoveryDir(home), `${serverId}.json`); }
function lockPath(home, serverId) { return path.join(discoveryDir(home), `.lock-${serverId}`); }
function ensureDir(home) { fs.mkdirSync(discoveryDir(home), { recursive: true, mode: 0o700 }); }

/** The configuration entry as a stable hash, so a passive scan can tell when the stored list no longer matches the entry it came from. */
function entryHash(entry) { return crypto.createHash('sha256').update(JSON.stringify(canonical(entry))).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function serverIdOf(client, serverName, entry) {
  return models.stableId('mcp-server', [client.source, serverName, (entry && (entry.command || entry.url || entry.endpoint)) || '']);
}

/** The launch as the consent text and the cache show it: the scan's own sanitizers, never a value from `env`. */
function sanitizedLaunch(plan, entry) {
  return {
    command: scanner.sanitizeCommand(plan.command),
    args: scanner.sanitizeArguments(plan.args),
    cwd: plan.cwd,
    envNames: plan.envNames,
    credentialReferences: scanner.sanitizeEnv(entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env) ? entry.env : null).credentialReferences,
  };
}

function consentText({ client, serverName, launch }) {
  const envLine = launch.envNames.length
    ? `  env:      ${launch.envNames.length} variable${launch.envNames.length === 1 ? '' : 's'} from the entry (${launch.envNames.join(', ')}); the process receives their values, Boppi never prints or stores them`
    : '  env:      none set by the entry; the process inherits PATH, HOME, TMPDIR, and locale only';
  return [
    `BOPPI · DISCOVER  "${serverName}" from ${client.label}`,
    `  launch:   ${launch.command}${launch.args.length ? ' ' + launch.args.join(' ') : ''}`,
    `  cwd:      ${launch.cwd}`,
    envLine,
    `  sends:    ${ALLOWED_METHODS.slice(0, 3).join(', ')} (paged), and notifications/cancelled if a request times out; nothing else`,
    `  never:    ${NEVER_SENT.join(', ')}`,
    '  stores:   tool names, titles, parameter names, annotations, and a 160-character description excerpt; never a parameter value, a default, or an example',
    '  effects:  starting the program itself may have effects Boppi cannot see (a server can act on start). Boppi makes that visible, not safe.',
    `  shutdown: stdin closed, then SIGTERM after 2 s, then SIGKILL after 2 s more; time limits ${session.TIMEOUTS.initializeMs / 1000} s to initialize, ${session.TIMEOUTS.pageMs / 1000} s per page, ${session.TIMEOUTS.sessionMs / 1000} s in all`,
  ].join('\n');
}

function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }

/** One discovery of a given server at a time across Boppi processes. Returns a release function, or null when another live process holds the lock. */
function acquireLock(home, serverId) {
  ensureDir(home);
  const file = lockPath(home, serverId);
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (held && Number.isInteger(held.pid) && held.pid !== process.pid && processAlive(held.pid)) return null;
  } catch { /* no lock or unreadable: replace it */ }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
  return () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
}

function writeCache(home, record) {
  ensureDir(home);
  const file = cachePath(home, record.serverId);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on platforms without modes */ }
  return file;
}

function readCache(home, serverId) {
  try { return JSON.parse(fs.readFileSync(cachePath(home, serverId), 'utf8')); } catch { return null; }
}

/** Whether a stored list still describes the given entry: same entry hash and younger than the age limit. */
function cacheStatus(record, entry, now = Date.now()) {
  if (!record || record.schemaVersion !== CACHE_SCHEMA_VERSION) return { usable: false, reason: 'no stored list' };
  if (record.entryHash !== entryHash(entry)) return { usable: false, reason: 'advertised list is stale (configuration changed)' };
  const age = now - Date.parse(record.discoveredAt);
  if (!(age >= 0) || age > (record.maxAgeDays || MAX_AGE_DAYS) * 86400000) return { usable: false, reason: `advertised list is stale (older than ${record.maxAgeDays || MAX_AGE_DAYS} days)` };
  return { usable: true, reason: null };
}

function forget(home, { serverId, all }) {
  const dir = discoveryDir(home);
  if (all) {
    if (!fs.existsSync(dir)) return { removed: 0 };
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) fs.unlinkSync(path.join(dir, f));
    return { removed: files.length };
  }
  const file = cachePath(home, serverId);
  if (!fs.existsSync(file)) return { removed: 0 };
  fs.unlinkSync(file);
  return { removed: 1 };
}

function locate(clients, options) {
  const holders = clients.filter(c => c.primaryPath && Object.prototype.hasOwnProperty.call(c.mergedServers, options.server));
  const candidates = options.clientKey ? holders.filter(c => c.clientKey === options.clientKey) : holders;
  if (!candidates.length) return { error: `no scanned ${options.clientKey ? `${options.clientKey} ` : ''}configuration has a server named "${options.server}". boppi scan lists the names.` };
  if (candidates.length > 1) return { error: `"${options.server}" exists in ${candidates.map(c => c.clientKey).join(' and ')}; pass --client to choose.` };
  return { client: candidates[0] };
}

/** Project-scoped entries run from the scanned working folder, every other entry from the home directory. */
function workingDirectoryFor(client, serverName, options) {
  const holder = (client.files || []).find(f => (f.servers || []).includes(serverName));
  return holder && ['project', 'local'].includes(holder.scope) ? options.cwd : options.home;
}

function summaryLines(result, serverName, cacheFile) {
  const lines = [];
  if (result.outcome === 'discovered') {
    const { counts } = result.list;
    const names = result.list.tools.slice(0, 8).map(t => t.name);
    lines.push(`DISCOVERED  ${counts.kept} tool${counts.kept === 1 ? '' : 's'} advertised by "${serverName}" in ${counts.pages} page${counts.pages === 1 ? '' : 's'}${result.list.partial ? ` (partial: ${result.list.partialReason})` : ''}${counts.rejected ? `, ${counts.rejected} entr${counts.rejected === 1 ? 'y' : 'ies'} rejected as malformed` : ''}${counts.duplicates ? `, ${counts.duplicates} duplicate name${counts.duplicates === 1 ? '' : 's'}` : ''}`);
    if (names.length) lines.push(`  tools:    ${names.join(', ')}${counts.kept > names.length ? `, +${counts.kept - names.length} more` : ''}`);
    if (result.initialize.serverInfo && result.initialize.serverInfo.name) lines.push(`  server:   ${result.initialize.serverInfo.name}${result.initialize.serverInfo.version ? ` ${result.initialize.serverInfo.version}` : ''} (protocol ${result.initialize.protocolVersion})`);
    if (result.listChangedDuringSession) lines.push('  note:     the server announced a changed tool list during the session; the list was fetched again');
    lines.push('  grade:    advertised, not verified. A tool list says what the server offers, not what it was seen to do; the next scan labels these tools as advertised.');
    lines.push(`  stored:   ${cacheFile} (owner-only), valid for ${MAX_AGE_DAYS} days or until the entry changes; boppi discover --forget --server "${serverName}" removes it`);
  } else if (result.outcome === 'rejected') {
    lines.push(`REJECTED    "${serverName}" did not complete discovery: ${result.reason}`);
    lines.push('  nothing was stored; the scan keeps treating this server by its configuration alone');
  } else {
    lines.push(`FAILED      "${serverName}" could not be started: ${result.reason}`);
  }
  const proc = result.process;
  if (proc) lines.push(`  process:  ${proc.pid ? `pid ${proc.pid}, ` : ''}${proc.mayStillBeRunning ? 'STILL RUNNING after SIGKILL; check it yourself' : proc.forced ? `ended by ${proc.forced}` : 'exited on its own'}${proc.stderrLines ? `, ${proc.stderrLines} stderr line${proc.stderrLines === 1 ? '' : 's'} ignored` : ''}, ${result.durationMs} ms`);
  lines.push(`  sent:     ${result.methods.join(', ')}${result.violations.length ? ` (VIOLATION: ${result.violations.join(', ')})` : ''}`);
  return lines;
}

/**
 * The command. `deps.discover(options)` is the scanner's own client
 * discovery (no server is launched by it); `deps.confirm(question)` asks on
 * the terminal; `deps.version` is the scanner version sent in clientInfo.
 */
async function runDiscover(options, deps) {
  const out = text => process.stdout.write(text + '\n');
  const err = text => process.stderr.write(text + '\n');
  if (options.forget) {
    if (options.all) { const { removed } = forget(options.home, { all: true }); out(`Removed ${removed} stored tool list${removed === 1 ? '' : 's'} from ${discoveryDir(options.home)}.`); return 0; }
    const discovery = deps.discover(options);
    const located = locate(discovery.clients, { server: options.server, clientKey: options.clientKey });
    if (located.error) { err(`discover: ${located.error}`); return 2; }
    const serverId = serverIdOf(located.client, options.server, located.client.mergedServers[options.server]);
    const { removed } = forget(options.home, { serverId });
    out(removed ? `Removed the stored tool list for "${options.server}".` : `No stored tool list for "${options.server}".`);
    return 0;
  }

  const discovery = deps.discover(options);
  const located = locate(discovery.clients, { server: options.server, clientKey: options.clientKey });
  if (located.error) { err(`discover: ${located.error}`); return 2; }
  const client = located.client;
  const entry = client.mergedServers[options.server];
  const plan = session.launchPlan(entry, { cwd: workingDirectoryFor(client, options.server, options) });
  if (plan.refused) {
    err(`discover: not started: ${plan.refused}`);
    return 2;
  }
  const launch = sanitizedLaunch(plan, entry);
  out(consentText({ client, serverName: options.server, launch }));
  if (!options.yes) {
    if (!process.stdin.isTTY) { err('discover: not started. Pass --yes to start without a terminal confirmation.'); return 2; }
    const approved = await deps.confirm('Start this program now? [y/N] ');
    if (!approved) { out('Not started.'); return 2; }
  }

  const serverId = serverIdOf(client, options.server, entry);
  const release = acquireLock(options.home, serverId);
  if (!release) { err(`discover: another Boppi process is discovering "${options.server}" right now; try again when it finishes.`); return 2; }
  let result;
  try {
    const timeouts = options.discoveryTimeouts || undefined;
    result = await session.runSession(plan, { version: deps.version, timeouts });
  } finally {
    release();
  }

  let cacheFile = null;
  if (result.outcome === 'discovered') {
    cacheFile = writeCache(options.home, {
      schemaVersion: CACHE_SCHEMA_VERSION, serverId, client: client.clientKey, server: options.server,
      launch, entryHash: entryHash(entry), discoveredAt: new Date().toISOString(), maxAgeDays: MAX_AGE_DAYS,
      protocolVersion: result.initialize.protocolVersion, serverInfo: result.initialize.serverInfo, listChanged: result.listChangedDuringSession,
      list: result.list, methods: result.methods,
    });
  }
  if (options.record) {
    fs.writeFileSync(options.record, JSON.stringify({ schemaVersion: 1, kind: 'boppi-discovery-record', server: options.server, client: client.clientKey, outcome: result.outcome, methods: result.methods, violations: result.violations, record: result.record, process: result.process }, null, 2), { mode: 0o600 });
  }
  out('');
  for (const line of summaryLines(result, options.server, cacheFile)) out(line);
  if (result.violations.length) { err('discover: the recorder saw a method outside the allowed set; this is a Boppi bug, report it with the --record file'); return 3; }
  return result.outcome === 'discovered' ? 0 : result.outcome === 'rejected' ? 3 : 3;
}

module.exports = { CACHE_SCHEMA_VERSION, MAX_AGE_DAYS, NEVER_SENT, discoveryDir, cachePath, entryHash, serverIdOf, sanitizedLaunch, consentText, acquireLock, writeCache, readCache, cacheStatus, forget, locate, workingDirectoryFor, runDiscover };
