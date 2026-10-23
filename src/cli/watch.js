/**
 * Foreground configuration watcher. Rescans with the passive scanner when a
 * watched configuration or settings file changes, or on a timer, and prints
 * what changed in the evidence. Nothing is installed and nothing leaves the
 * machine. Retirement rules: docs/phase4/WATCH_DESIGN.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fix = require('./fix');

const DEBOUNCE_MS = 500;
const GRACE_MS = 2000;
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function fileHash(file) { try { return fix.fileHash(file); } catch { return null; } }

/** Every file the scan would read for the watched clients, plus the parent directories to watch. */
function targets(options) {
  const wanted = options.only ? new Set(options.only) : null;
  const files = [];
  for (const descriptor of fix.descriptorsFor(options)) {
    if (wanted && !wanted.has(descriptor.clientKey)) continue;
    for (const file of descriptor.files) files.push({ path: path.resolve(file.path), clientKey: descriptor.clientKey, kind: 'config' });
    for (const file of descriptor.settingsFiles || []) files.push({ path: path.resolve(file.path), clientKey: descriptor.clientKey, kind: 'settings' });
  }
  const unique = [...new Map(files.map(f => [f.path, f])).values()];
  const directories = [...new Set(unique.map(f => path.dirname(f.path)))].filter(dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
  return { files: unique, directories };
}

/** The evidence a summary compares: per client its files (config and permission settings), servers, and paths. */
function stateOf(scan, wantedClients) {
  const clients = {};
  const clientList = Array.isArray(scan.discovery) ? scan.discovery : (scan.discovery && scan.discovery.clients) || [];
  for (const client of clientList) {
    if (wantedClients && !wantedClients.has(client.clientKey)) continue;
    const agentId = client.agentId || null;
    clients[client.clientKey] = {
      label: client.label,
      scanError: client.scanError || null,
      files: Object.fromEntries((client.files || []).map(f => [f.path, { status: f.status, reason: f.reason || null, hash: f.status === 'found' || f.status === 'unreadable' ? fileHash(f.path) : null }])),
      servers: (scan.inventory.mcpServers || []).filter(s => s.agentId === agentId).map(s => s.name).sort(),
      paths: Object.fromEntries((scan.paths || []).filter(p => p.agentId === agentId).map(p => [p.exposureKey, p.severity])),
    };
  }
  return { at: scan.startedAt, clients };
}

/** Why a file's bytes changed, from Boppi's own fix manifest; anything Boppi did not write is "changed outside Boppi". */
function causeOf(home, file, hash) {
  if (!hash) return 'changed outside Boppi';
  const entries = fix.readManifest(home).entries.filter(e => e.original === file);
  const applied = entries.find(e => e.action === 'remove_server' && e.appliedHash === hash);
  if (applied) return `changed by boppi fix ${applied.id}`;
  const restored = entries.find(e => e.action === 'remove_server' && e.backupHash === hash);
  if (restored && entries.some(e => e.action === 'rollback' && e.restoredFrom === restored.id)) return 'restored by boppi rollback';
  return 'changed outside Boppi';
}

/**
 * Compare the last accepted state with a fresh scan under the retirement
 * rules. Returns { accepted, hold: [...], summary } where `accepted` is the
 * state to keep (per client, the new one or the held one) and `hold` lists
 * clients whose new state was not accepted and why.
 */
function reconcile(previous, next, { home, grace }) {
  const accepted = { at: next.at, clients: {} };
  const hold = [];
  const changes = [];
  for (const [key, now] of Object.entries(next.clients)) {
    const before = previous ? previous.clients[key] : null;
    if (!before) { accepted.clients[key] = now; continue; }
    const vanished = Object.entries(before.files).filter(([file, state]) => state.status === 'found' && now.files[file] && now.files[file].status !== 'found');
    if (now.scanError) { hold.push({ client: key, label: now.label, reason: `not analyzed: ${now.scanError}` }); accepted.clients[key] = before; continue; }
    if (vanished.length && !grace) {
      hold.push({ client: key, label: now.label, reason: `holding: ${vanished.map(([file, state]) => `${file} ${now.files[file].status === 'unreadable' ? 'unreadable' : 'missing'}`).join(', ')} (an editor may be writing it); rescanning in ${GRACE_MS / 1000} s`, transient: true });
      accepted.clients[key] = before;
      continue;
    }
    const unreadable = vanished.filter(([file]) => now.files[file].status === 'unreadable');
    if (unreadable.length) {
      hold.push({ client: key, label: now.label, reason: `stale: ${unreadable.map(([file]) => `${file} unreadable (${now.files[file].reason || 'unknown reason'})`).join(', ')}; the last readable state is kept and no closure is reported from it` });
      accepted.clients[key] = before;
      continue;
    }
    accepted.clients[key] = now;
    const change = diffClient(key, before, now, { home, deleted: vanished.map(([file]) => file) });
    if (change) changes.push(change);
  }
  return { accepted, hold, changes };
}

function diffClient(key, before, now, { home, deleted }) {
  const files = [];
  for (const [file, state] of Object.entries(now.files)) {
    const old = before.files[file];
    if (deleted.includes(file)) { files.push({ file, cause: 'file deleted' }); continue; }
    if (!old || old.status !== state.status) { files.push({ file, cause: state.status === 'found' && (!old || old.status === 'not_found') ? 'file created' : `now ${state.status}` }); continue; }
    if (old.hash !== state.hash) files.push({ file, cause: causeOf(home, file, state.hash) });
  }
  const serversAdded = now.servers.filter(s => !before.servers.includes(s));
  const serversRemoved = before.servers.filter(s => !now.servers.includes(s));
  const opened = Object.keys(now.paths).filter(k => !(k in before.paths)).map(k => ({ key: k, severity: now.paths[k] }));
  const closed = Object.keys(before.paths).filter(k => !(k in now.paths)).map(k => ({ key: k, severity: before.paths[k] }));
  const raised = [], lowered = [];
  for (const k of Object.keys(now.paths)) {
    if (!(k in before.paths) || before.paths[k] === now.paths[k]) continue;
    (SEVERITY_RANK[now.paths[k]] > SEVERITY_RANK[before.paths[k]] ? raised : lowered).push({ key: k, from: before.paths[k], to: now.paths[k] });
  }
  const evidenceChanged = serversAdded.length || serversRemoved.length || opened.length || closed.length || raised.length || lowered.length;
  if (!files.length && !evidenceChanged) return null;
  return { client: key, label: now.label, files, serversAdded, serversRemoved, opened, closed, raised, lowered, sameEvidence: !evidenceChanged };
}

const pathLabel = key => key.split(':')[0];
function renderChange(change, at) {
  const lines = [`[${at}] CHANGE  ${change.label}`];
  for (const f of change.files) lines.push(`  file:     ${f.file} (${f.cause})`);
  if (change.sameEvidence) { lines.push('  evidence: rewritten, same servers and paths'); return lines; }
  if (change.serversAdded.length) lines.push(`  servers:  added ${change.serversAdded.join(', ')}`);
  if (change.serversRemoved.length) lines.push(`  servers:  removed ${change.serversRemoved.join(', ')}`);
  for (const p of change.opened) lines.push(`  opened:   ${pathLabel(p.key)} ${p.severity}`);
  for (const p of change.closed) lines.push(`  closed:   ${pathLabel(p.key)} ${p.severity} (observed by rescan, not a verified fix; boppi verify grades a prediction)`);
  for (const p of change.raised) lines.push(`  raised:   ${pathLabel(p.key)} ${p.from} to ${p.to}`);
  for (const p of change.lowered) lines.push(`  lowered:  ${pathLabel(p.key)} ${p.from} to ${p.to}`);
  return lines;
}

function baselineLines(state, target, options) {
  const clients = Object.values(state.clients);
  const servers = clients.reduce((n, c) => n + c.servers.length, 0);
  const paths = clients.reduce((n, c) => n + Object.keys(c.paths).length, 0);
  return [
    `BOPPI · WATCH  ${clients.length} client${clients.length === 1 ? '' : 's'}${options.only ? ` (--only ${options.only.join(',')})` : ''} · ${target.files.length} files in ${target.directories.length} watched director${target.directories.length === 1 ? 'y' : 'ies'} · rescan every ${options.interval} s${options.duration ? ` for ${options.duration} s` : ''}`,
    `  baseline: ${servers} MCP server${servers === 1 ? '' : 's'}, ${paths} exposure path${paths === 1 ? '' : 's'} at ${state.at}`,
    '  foreground only: nothing is installed, nothing leaves this machine; Ctrl-C stops. A closed path here is an observation, not a verified fix.',
  ];
}

/** The command. deps: performScan(options), writeHistory(scan, file). */
async function runWatch(options, deps) {
  const out = text => process.stdout.write(text + '\n');
  const wanted = options.only ? new Set(options.only) : null;
  const target = targets(options);
  const log = options.log ? fs.openSync(options.log, 'a', 0o600) : null;
  const record = entry => { if (log !== null) fs.writeSync(log, JSON.stringify(entry) + '\n'); };

  const first = await deps.performScan(options);
  if (first.failed) { process.stderr.write(`watch: scan failed: ${first.failed}\n`); return first.exitCode || 3; }
  let accepted = stateOf(first, wanted);
  for (const line of baselineLines(accepted, target, options)) out(line);
  record({ kind: 'baseline', at: accepted.at, clients: Object.keys(accepted.clients), files: target.files.map(f => f.path), directories: target.directories });
  if (options.once) { if (log !== null) fs.closeSync(log); return 0; }

  let running = false, again = false, againGrace = false, graceTimer = null, debounceTimer = null, stopped = false;
  const rescan = async (why, grace = false) => {
    if (running) { again = true; againGrace = againGrace || grace; return; }
    running = true;
    try {
      const scan = await deps.performScan(options);
      if (scan.failed) { out(`[${new Date().toISOString()}] rescan failed: ${scan.failed}`); return; }
      const next = stateOf(scan, wanted);
      const result = reconcile(accepted, next, { home: options.home, grace });
      accepted = result.accepted;
      for (const h of result.hold) {
        out(`[${next.at}] HOLD    ${h.label}: ${h.reason}`);
        record({ kind: 'hold', at: next.at, client: h.client, reason: h.reason, transient: !!h.transient });
        if (h.transient && !graceTimer) graceTimer = setTimeout(() => { graceTimer = null; rescan('grace', true); }, GRACE_MS);
      }
      for (const change of result.changes) {
        for (const line of renderChange(change, next.at)) out(line);
        record({ kind: 'change', at: next.at, why, ...change });
      }
      if (result.changes.some(c => !c.sameEvidence)) { try { deps.writeHistory(scan, options.historyFile); } catch { /* read-only home */ } }
    } finally {
      running = false;
      if (again) { const withGrace = againGrace; again = false; againGrace = false; rescan('queued', withGrace); }
    }
  };

  const watchers = [];
  for (const dir of target.directories) {
    try {
      const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
        const changed = filename ? path.join(dir, String(filename)) : null;
        if (changed && !target.files.some(f => f.path === changed)) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => rescan('file event'), DEBOUNCE_MS);
      });
      watcher.on('error', () => { /* the periodic rescan covers a watcher that died */ });
      watchers.push(watcher);
    } catch { /* unwatchable directory; the periodic rescan covers it */ }
  }
  const timer = setInterval(() => rescan('periodic'), Math.max(1, options.interval) * 1000);

  return new Promise(resolve => {
    const stop = reason => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer); clearTimeout(debounceTimer); clearTimeout(graceTimer);
      for (const w of watchers) { try { w.close(); } catch { /* closed */ } }
      out(`[${new Date().toISOString()}] stopped (${reason}); nothing was installed and nothing left this machine`);
      record({ kind: 'stopped', at: new Date().toISOString(), reason });
      if (log !== null) fs.closeSync(log);
      resolve(0);
    };
    process.once('SIGINT', () => stop('Ctrl-C'));
    process.once('SIGTERM', () => stop('SIGTERM'));
    if (options.duration) setTimeout(() => stop(`${options.duration} s elapsed`), options.duration * 1000);
  });
}

module.exports = { DEBOUNCE_MS, GRACE_MS, targets, stateOf, causeOf, reconcile, diffClient, renderChange, runWatch };
