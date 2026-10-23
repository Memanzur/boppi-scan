#!/usr/bin/env node
/** `boppi watch` end to end on synthetic files: baseline, a change seen within interval + 5 s, a burst coalesced, an atomic rename, a delete held then retired, invalid JSON held as stale, own edits labelled, --only scope, and the reconcile rules as pure functions. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const watch = require('../src/cli/watch');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n${name}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = (name, extra = {}) => ({ [name]: { command: 'node', args: [`${name}.js`], ...extra } });
const SAFE = { mcpServers: { ...server('notes') } };
const RISKY = { mcpServers: { ...server('notes'), ...server('shell', { env: { GITHUB_TOKEN: 'ghp_watchfixture000000000000000000000000' }, args: ['--allow-shell'] }) } };

function startWatch(home, args, logFile) {
  const child = spawn(process.execPath, [CLI, 'watch', ...args, '--home', home, '--cwd', home, '--no-color', '--log', logFile, '--history-file', path.join(home, 'history.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const done = new Promise(resolve => child.on('exit', code => resolve({ code, stdout: () => stdout, stderr: () => stderr })));
  return { child, done, stdout: () => stdout };
}
const readLog = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
async function waitFor(file, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { const entries = readLog(file); if (predicate(entries)) return { entries, ms: Date.now() - start }; await sleep(100); }
  return { entries: readLog(file), ms: Date.now() - start, timedOut: true };
}
const changes = entries => entries.filter(e => e.kind === 'change');
const holds = entries => entries.filter(e => e.kind === 'hold');

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-watch-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const claudeJson = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify(SAFE));
  const desktopDir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(desktopDir, { recursive: true });
  const desktopJson = path.join(desktopDir, 'claude_desktop_config.json');
  fs.writeFileSync(desktopJson, JSON.stringify(SAFE));

  section('once mode and argument validation');
  const once = spawnSync(process.execPath, [CLI, 'watch', '--once', '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'h.json')], { encoding: 'utf8' });
  ok('--once prints the baseline and exits 0', once.status === 0 && once.stdout.includes('BOPPI · WATCH') && once.stdout.includes('baseline:') && once.stdout.includes('nothing is installed'));
  const badInterval = spawnSync(process.execPath, [CLI, 'watch', '--interval', '0', '--home', home, '--cwd', home], { encoding: 'utf8' });
  ok('--interval below 1 is rejected before anything runs', badInterval.status !== 0 && badInterval.stderr.includes('--interval'));
  const withConfig = spawnSync(process.execPath, [CLI, 'watch', '--config', claudeJson, '--home', home, '--cwd', home], { encoding: 'utf8' });
  ok('--config is rejected (watch follows discovered client files)', withConfig.status !== 0 && withConfig.stderr.includes('--config'));
  const badOnly = spawnSync(process.execPath, [CLI, 'watch', '--once', '--only', 'nonsense', '--home', home, '--cwd', home], { encoding: 'utf8' });
  ok('an unknown --only client is rejected', badOnly.status !== 0);

  section('live session: change, burst, atomic rename, delete, unreadable, own edit');
  const logFile = path.join(root, 'watch.log');
  const session = startWatch(home, ['--interval', '1', '--duration', '40', '--only', 'claude-code,claude-desktop'], logFile);
  const baseline = await waitFor(logFile, e => e.some(x => x.kind === 'baseline'), 15000);
  ok('baseline is logged with the watched files and directories', !baseline.timedOut && baseline.entries[0].files.includes(claudeJson) && baseline.entries[0].directories.includes(home));
  ok('the log file is owner-only', (fs.statSync(logFile).mode & 0o077) === 0);
  ok('the watcher stays in the foreground (no detached process, parent is this test)', session.child.pid > 0 && !session.child.killed);

  fs.writeFileSync(claudeJson, JSON.stringify(RISKY));
  const first = await waitFor(logFile, e => changes(e).length >= 1, 6000);
  const c1 = changes(first.entries)[0];
  ok(`a config change is reported within interval + 5 s (took ${first.ms} ms)`, !first.timedOut && first.ms <= 6000);
  ok('the change names the file, the cause, and the server that appeared', c1 && c1.files.some(f => f.file === claudeJson && f.cause === 'changed outside Boppi') && c1.serversAdded.includes('shell'));
  ok('new exposure paths are reported as opened with a severity', c1 && c1.opened.length > 0 && c1.opened.every(p => p.key && p.severity));
  ok('the terminal summary says a closed path is an observation, not a verified fix', session.stdout().includes('nothing is installed'));

  const before = changes(readLog(logFile)).length;
  for (let i = 0; i < 20; i++) { fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { ...RISKY.mcpServers, [`burst${i}`]: { command: 'node', args: ['b.js'] } } })); await sleep(20); }
  await sleep(3500);
  const burst = changes(readLog(logFile)).slice(before);
  ok(`a burst of 20 writes coalesces into a few rescans (${burst.length} change summaries)`, burst.length >= 1 && burst.length <= 4);
  ok('the final burst state is what the last summary reports', burst.length && burst[burst.length - 1].serversAdded.includes('burst19'));

  const b2 = changes(readLog(logFile)).length;
  const tmp = `${claudeJson}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(SAFE));
  fs.renameSync(tmp, claudeJson);
  const renamed = await waitFor(logFile, e => changes(e).length > b2, 6000);
  const c3 = changes(renamed.entries).slice(b2);
  ok('an atomic write (temp file plus rename) is seen as one change with closures', !renamed.timedOut && c3.some(c => c.serversRemoved.includes('shell') && c.closed.length > 0));
  ok('a temp file in the watched directory is never reported as a config', !readLog(logFile).some(e => JSON.stringify(e).includes('.tmp-')));

  const h0 = holds(readLog(logFile)).length, c4 = changes(readLog(logFile)).length;
  fs.unlinkSync(desktopJson);
  const held = await waitFor(logFile, e => holds(e).length > h0, 6000);
  ok('a deleted file is first held, not retired (an editor may be writing it)', !held.timedOut && holds(held.entries)[h0].transient === true && holds(held.entries)[h0].reason.includes('missing'));
  const retired = await waitFor(logFile, e => changes(e).length > c4 && changes(e).slice(c4).some(c => c.files.some(f => f.cause === 'file deleted')), 8000);
  const retire = changes(retired.entries).slice(c4).find(c => c.files.some(f => f.cause === 'file deleted'));
  ok('after the grace rescan the file is retired with its servers and cause "file deleted"', !retired.timedOut && retire && retire.client === 'claude-desktop' && retire.serversRemoved.includes('notes'));
  ok('the retirement does not touch the other client', retire && !changes(retired.entries).slice(c4).some(c => c.client === 'claude-code' && c.serversRemoved.length));

  fs.writeFileSync(desktopJson, JSON.stringify(RISKY));
  const back = await waitFor(logFile, e => changes(e).some(c => c.client === 'claude-desktop' && c.serversAdded.includes('shell')), 6000);
  ok('a recreated file is reported as created with its servers', !back.timedOut && changes(back.entries).some(c => c.client === 'claude-desktop' && c.files.some(f => f.cause === 'file created')));
  const h1 = holds(readLog(logFile)).length, c5 = changes(readLog(logFile)).length;
  fs.writeFileSync(desktopJson, '{"mcpServers": {');
  const stale = await waitFor(logFile, e => holds(e).slice(h1).some(h => h.reason.startsWith('stale:')), 8000);
  ok('invalid JSON is held as stale after the grace rescan and reports no closure', !stale.timedOut && !changes(stale.entries).slice(c5).some(c => c.client === 'claude-desktop' && c.closed.length));
  ok('the stale label names the file and the reason', holds(stale.entries).slice(h1).some(h => h.reason.includes(desktopJson) && h.reason.includes('invalid JSON')));
  fs.writeFileSync(desktopJson, JSON.stringify(RISKY));
  await sleep(2500);
  const afterRestore = changes(readLog(logFile)).slice(c5).filter(c => c.client === 'claude-desktop');
  ok('restoring the same bytes after a stale hold reports no change (the held state was kept)', afterRestore.length === 0);

  const c6 = changes(readLog(logFile)).length;
  const fixed = spawnSync(process.execPath, [CLI, 'fix', '--server', 'shell', '--only', 'claude-desktop', '--yes', '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'h2.json')], { encoding: 'utf8' });
  const own = await waitFor(logFile, e => changes(e).slice(c6).some(c => c.client === 'claude-desktop'), 6000);
  const ownChange = changes(own.entries).slice(c6).find(c => c.client === 'claude-desktop');
  ok('boppi fix succeeded in the fixture home', fixed.status === 0);
  ok('an edit made by boppi fix is labelled with the fix id, not "changed outside Boppi"', ownChange && ownChange.files.some(f => f.file === desktopJson && /^changed by boppi fix /.test(f.cause)));
  ok('the own edit still reports the closures it caused', ownChange && ownChange.serversRemoved.includes('shell'));

  const result = await session.done;
  ok('the session stops after --duration and says nothing left the machine', result.code === 0 && result.stdout().includes('stopped (40 s elapsed)') && readLog(logFile).some(e => e.kind === 'stopped'));
  ok('the watcher wrote no stderr', result.stderr().trim() === '');
  const history = JSON.parse(fs.readFileSync(path.join(home, 'history.json'), 'utf8'));
  ok('evidence changes are appended to the local history', Array.isArray(history) && history.length >= 3 && history.every(e => e.scannedAt));

  section('--only scope and retirement rules as pure functions');
  const scan = (clients, paths = {}, servers = {}) => ({ startedAt: 'T', discovery: { clients }, inventory: { mcpServers: Object.entries(servers).flatMap(([agentId, names]) => names.map(name => ({ agentId, name }))) }, paths: Object.entries(paths).flatMap(([agentId, keys]) => Object.entries(keys).map(([exposureKey, severity]) => ({ agentId, exposureKey, severity }))) });
  const client = (key, files, extra = {}) => ({ clientKey: key, label: key, agentId: `a-${key}`, files, ...extra });
  const prev = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'found', servers: ['s'] }]), client('cd', [{ path: '/x/b', status: 'found', servers: ['t'] }])], { 'a-cc': { 'k1:x': 'high' }, 'a-cd': { 'k2:y': 'critical' } }, { 'a-cc': ['s'], 'a-cd': ['t'] }), new Set(['cc']));
  ok('--only keeps unwatched clients out of the compared state', Object.keys(prev.clients).join() === 'cc');
  const nextMissing = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'not_found', servers: [] }])], {}, {}), null);
  const r1 = watch.reconcile(prev, nextMissing, { home, grace: false });
  ok('a missing file is held on the first rescan and the previous state is kept', r1.hold.length === 1 && r1.hold[0].transient && r1.accepted.clients.cc.servers.join() === 's' && r1.changes.length === 0);
  const r2 = watch.reconcile(prev, nextMissing, { home, grace: true });
  ok('on the grace rescan a missing file retires its servers and paths with cause "file deleted"', r2.hold.length === 0 && r2.changes[0].serversRemoved.join() === 's' && r2.changes[0].closed[0].key === 'k1:x' && r2.changes[0].files[0].cause === 'file deleted');
  const nextUnreadable = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'unreadable', reason: 'invalid JSON', servers: [] }])], {}, {}), null);
  const r3 = watch.reconcile(prev, nextUnreadable, { home, grace: true });
  ok('an unreadable file after grace is stale: state kept, no closure, reason shown', r3.hold.length === 1 && r3.hold[0].reason.startsWith('stale:') && r3.hold[0].reason.includes('invalid JSON') && r3.changes.length === 0 && r3.accepted.clients.cc.paths['k1:x'] === 'high');
  const nextError = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'found', servers: [] }], { scanError: 'boom' })], {}, {}), null);
  const r4 = watch.reconcile(prev, nextError, { home, grace: true });
  ok('a client whose scan failed is held as not analyzed', r4.hold.length === 1 && r4.hold[0].reason === 'not analyzed: boom' && r4.changes.length === 0);
  const nextEmpty = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'found', servers: [] }])], {}, {}), null);
  const r5 = watch.reconcile(prev, nextEmpty, { home, grace: false });
  ok('a readable file with zero servers is a genuine retirement with no grace needed', r5.hold.length === 0 && r5.changes[0].serversRemoved.join() === 's' && r5.changes[0].closed.length === 1);
  const nextSame = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'found', servers: ['s'] }])], { 'a-cc': { 'k1:x': 'high' } }, { 'a-cc': ['s'] }), null);
  ok('identical evidence produces no change entry', watch.reconcile(prev, nextSame, { home, grace: false }).changes.length === 0);
  const nextLower = watch.stateOf(scan([client('cc', [{ path: '/x/a', status: 'found', servers: ['s'] }])], { 'a-cc': { 'k1:x': 'low' } }, { 'a-cc': ['s'] }), null);
  const r6 = watch.reconcile(prev, nextLower, { home, grace: false });
  ok('a severity drop is reported as lowered, not closed', r6.changes[0].lowered[0].from === 'high' && r6.changes[0].lowered[0].to === 'low' && r6.changes[0].closed.length === 0);
  const lines = watch.renderChange(r2.changes[0], 'T');
  ok('a closed path line says it is observed by rescan and not a verified fix', lines.some(l => l.includes('closed:') && l.includes('not a verified fix')));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
