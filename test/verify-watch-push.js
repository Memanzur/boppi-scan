#!/usr/bin/env node
/**
 * boppi watch --push against a stand-in ingest server on 127.0.0.1, on
 * synthetic homes only: same body as push --dry-run, push only on change,
 * debounce, offline queue and flush, refused token, 409/422 drops, backoff,
 * crash safety of the owner-only queue, caps, and no network without --push.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ownerOnly, hasMode, symlinkOrSkip } = require('./helpers/platform');
const { traced, rescanned } = require('./helpers/watch-scans');
const watchPush = require('../src/cli/watchPush');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const TOKEN = 'bpc_watchpush_fixture_token_0001';
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n${name}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENV = { BOPPI_TOKEN: '', BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_WATCH_PUSH_BACKOFF_MS: '20', BOPPI_NO_UPDATE_NOTICE: '1' };

/** A stand-in ingest endpoint: records every POST; respond(n, body) scripts the answer. */
function ingest() {
  const self = { requests: [], heartbeats: [], heartbeatStatus: 200, respond: () => ({ status: 200 }), port: 0, server: null };
  self.listen = (port = 0) => new Promise((resolve, reject) => {
    self.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', d => { raw += d; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        if (req.url.endsWith('/heartbeat')) {
          self.heartbeats.push({ authorization: req.headers.authorization, url: req.url, body });
          res.writeHead(self.heartbeatStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: self.heartbeatStatus === 200 }));
          return;
        }
        const n = self.requests.push({ authorization: req.headers.authorization, url: req.url, body });
        const { status = 200, json, headers = {} } = self.respond(n, body) || {};
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(json || (status === 200 ? { ingested: body.records.length, snapshotId: `snap-${n}`, requestId: `req-${n}` } : { error: 'scripted failure', requestId: `req-${n}` })));
      });
    });
    self.server.once('error', reject);
    self.server.listen(port, '127.0.0.1', () => { self.port = self.server.address().port; resolve(); });
  });
  self.close = () => new Promise(resolve => { self.server.closeAllConnections(); self.server.close(() => resolve()); });
  self.url = () => `http://127.0.0.1:${self.port}`;
  return self;
}

function makeHome(root, name) {
  const home = path.join(root, name);
  const desktopDir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(desktopDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { files: { command: 'node', args: ['files.js'] } } }));
  setServers(home, ['notes']);
  return home;
}
const claudeJson = home => path.join(home, '.claude.json');
const configText = names => JSON.stringify({ mcpServers: Object.fromEntries(names.map(n => [n, { command: 'node', args: [`${n}.js`] }])) });
function setServers(home, names) { fs.writeFileSync(claudeJson(home), configText(names)); }
const queueFile = home => path.join(watchPush.storeDir(home), 'queue.json');
const readQueue = home => (fs.existsSync(queueFile(home)) ? JSON.parse(fs.readFileSync(queueFile(home), 'utf8')).entries : []);
const readLog = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const pushes = file => readLog(file).filter(e => e.kind === 'push');
const serverNames = body => body.records.filter(r => r.kind === 'mcp_server').map(r => r.name).sort();

function cli(args, home, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { env: { ...process.env, ...ENV, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
const once = (server, home, log, extra = []) => cli(['watch', '--push', '--once', '--url', server.url(), '--token', TOKEN, '--log', log, ...extra], home);

function startWatch(server, home, log, extra = []) {
  const trace = `${log}.scans`;
  const { nodeArgs, env } = traced(trace);
  const child = spawn(process.execPath, [...nodeArgs, CLI, 'watch', '--push', '--interval', '1', '--duration', '600', '--url', server.url(), '--token', TOKEN, '--log', log, ...extra, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { env: { ...process.env, ...ENV, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const done = new Promise(resolve => child.on('exit', code => resolve(code)));
  return { child, done, trace, stdout: () => stdout, stderr: () => stderr };
}
async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (predicate()) return true; await sleep(100); }
  return predicate();
}
/** The promise's value, or 'timeout' after ms: a hang guard that does not keep the process alive once settled. */
async function within(promise, ms) {
  let timer;
  const result = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), ms); })]);
  clearTimeout(timer);
  return result;
}
const withoutTime = body => { const { snapshot_at: _at, ...rest } = body; return watchPush.canonical(rest); };

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-watch-push-'));
  const server = ingest();
  await server.listen();

  section('flags: --push is explicit and validated like push');
  const noToken = spawnSync(process.execPath, [CLI, 'watch', '--push', '--once', '--home', root], { encoding: 'utf8', input: '', env: { ...process.env, ...ENV } });
  ok('watch --push without a token and without a terminal is refused before anything runs', noToken.status === 2 && noToken.stderr.includes('watch --push needs a collector token'));
  const badUrl = spawnSync(process.execPath, [CLI, 'watch', '--push', '--once', '--token', TOKEN, '--url', 'http://example.com', '--home', root], { encoding: 'utf8', env: { ...process.env, ...ENV } });
  ok('a non-https workspace URL is refused (push.resolveIngestUrl)', badUrl.status === 2 && badUrl.stderr.includes('--url must use https'));
  const elsewhere = spawnSync(process.execPath, [CLI, 'scan', '--push', '--home', root], { encoding: 'utf8', env: { ...process.env, ...ENV } });
  ok('--push is refused on any command but watch', elsewhere.status === 2 && elsewhere.stderr.includes('--push is only accepted with watch'));
  ok('there is no environment switch that turns pushing on (D-21)', !fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'boppi.js'), 'utf8').match(/process\.env\.BOPPI_WATCH_PUSH(?!_BACKOFF_MS)/));

  section('no network without --push');
  const quiet = makeHome(root, 'quiet');
  const before = server.requests.length;
  const unpushed = await cli(['watch', '--once', '--url', server.url(), '--token', TOKEN], quiet);
  ok('watch --once with --url and --token but no --push sends nothing', unpushed.code === 0 && server.requests.length === before && unpushed.stdout.includes('nothing leaves this machine'));
  ok('and creates no push store', !fs.existsSync(watchPush.storeDir(quiet)));

  section('first push: same body as push --dry-run, full snapshot, owner-only store');
  const home = makeHome(root, 'home');
  const log = path.join(root, 'home.log');
  const first = await once(server, home, log);
  const sent = server.requests[server.requests.length - 1];
  ok('--once with no stored digest pushes and exits 0', first.code === 0 && server.requests.length === before + 1);
  ok('the request carries the collector token as a bearer header to /api/ingest', sent.authorization === `Bearer ${TOKEN}` && sent.url === '/api/ingest');
  ok('full discovery makes it a full snapshot', sent.body.snapshot === true && typeof sent.body.snapshot_at === 'string');
  const dry = spawnSync(process.execPath, [CLI, 'push', '--dry-run', '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', env: { ...process.env, ...ENV } });
  const dryBody = JSON.parse(dry.stdout.slice(0, dry.stdout.lastIndexOf('\nDry run:')));
  ok('the body equals what push --dry-run prints for the same home, minus snapshot_at', withoutTime(dryBody) === withoutTime(sent.body));
  ok('the banner says exactly what leaves instead of "nothing leaves this machine"', first.stdout.includes('--push is on') && first.stdout.includes('Only sanitized inventory metadata is sent: no secret values, file contents, or raw paths.') && !first.stdout.includes('nothing leaves this machine'));
  ok('the terminal line says what was sent and that only sanitized metadata goes', /PUSH {4}sent \d+ records to http:\/\/127\.0\.0\.1:\d+ as a full snapshot\. Only sanitized inventory metadata is sent/.test(first.stdout));
  const firstPush = pushes(log)[0];
  ok('the log has {kind:push, outcome:sent, digest, status, snapshotId, queued}', firstPush && firstPush.outcome === 'sent' && firstPush.digest === watchPush.digestOf(sent.body) && firstPush.status === 200 && firstPush.snapshotId === `snap-${server.requests.length}` && firstPush.queued === 0 && typeof firstPush.at === 'string');
  ok('the store folder is 0700 and its files 0600', hasMode(watchPush.storeDir(home), 0o700) && ownerOnly(queueFile(home)) && ownerOnly(path.join(watchPush.storeDir(home), 'state.json')));
  ok('no file in the store holds the token', fs.readdirSync(watchPush.storeDir(home)).every(f => !fs.readFileSync(path.join(watchPush.storeDir(home), f), 'utf8').includes(TOKEN)));

  section('no change, no push');
  const n0 = server.requests.length;
  setServers(home, ['notes']);
  const rewritten = await once(server, home, log);
  const now = new Date();
  fs.utimesSync(claudeJson(home), now, now);
  const touched = await once(server, home, log);
  ok('rewriting identical content and touching the file send nothing (--once twice)', rewritten.code === 0 && touched.code === 0 && server.requests.length === n0);
  ok('both runs log outcome unchanged with the stored digest', pushes(log).slice(-2).every(p => p.outcome === 'unchanged' && p.digest === firstPush.digest));

  section('long-running: restart, rewrite, touch, change, burst');
  const liveLog = path.join(root, 'live.log');
  const live = startWatch(server, home, liveLog);
  await waitFor(() => pushes(liveLog).length >= 1, 30000);
  ok('a restart with the same posture sends nothing at baseline', pushes(liveLog)[0] && pushes(liveLog)[0].outcome === 'unchanged' && server.requests.length === n0);
  setServers(home, ['notes']);
  fs.utimesSync(claudeJson(home), new Date(), new Date());
  const touchRescanned = await rescanned(live.trace);
  ok('a rewrite with identical servers and a touch during the session send nothing', touchRescanned && server.requests.length === n0);
  setServers(home, ['notes', 'shell']);
  const changeRescanned = await rescanned(live.trace, { scans: 2 });
  ok('a real change is pushed exactly once', changeRescanned && server.requests.length === n0 + 1 && serverNames(server.requests[n0].body).includes('shell'));
  const n1 = server.requests.length;
  for (let i = 0; i < 20; i++) { setServers(home, ['notes', 'shell', `burst${i}`]); await sleep(20); }
  const burstRescanned = await rescanned(live.trace);
  const burst = server.requests.slice(n1);
  ok(`a burst of 20 writes coalesces into a few pushes (${burst.length})`, burstRescanned && burst.length >= 1 && burst.length <= 5);
  ok('the last push carries the final state of the burst', burst.length && serverNames(burst[burst.length - 1].body).includes('burst19') && !serverNames(burst[burst.length - 1].body).includes('burst18'));
  const desktop = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const desktopText = fs.readFileSync(desktop, 'utf8');
  const n1b = server.requests.length;
  fs.writeFileSync(desktop, '{"mcpServers": {');
  await waitFor(() => readLog(liveLog).some(e => e.kind === 'hold' && e.reason.startsWith('stale:')), 30000);
  const heldRescanned = await rescanned(live.trace);
  ok('while a client is held (unreadable config) nothing is pushed, the history rule', heldRescanned && readLog(liveLog).some(e => e.kind === 'hold' && e.reason.startsWith('stale:')) && server.requests.length === n1b);
  fs.writeFileSync(desktop, desktopText);
  const restoreRescanned = await rescanned(live.trace);
  ok('restoring the held file sends nothing (the posture equals the last push)', restoreRescanned && server.requests.length === n1b);
  live.child.kill('SIGINT');
  ok('Ctrl-C ends the process with exit 0 well before --duration (the 600 s timer does not hold it open)', await within(live.done, 30000) === 0);
  ok('the stop line says only sanitized inventory metadata was sent', live.stdout().includes('only sanitized inventory metadata was sent, to'));

  section('offline: queue, then flush in order');
  const port = server.port;
  await server.close();
  setServers(home, ['notes', 'offline-a']);
  const off1 = await once(server, home, log);
  ok('an unreachable workspace makes --once exit 5', off1.code === 5);
  let queue = readQueue(home);
  ok('the queue holds the entry {id, origin, digest, queuedAt, body}', queue.length === 1 && queue[0].origin === `http://127.0.0.1:${port}` && /^sha256:[0-9a-f]{64}$/.test(queue[0].digest) && queue[0].id && queue[0].queuedAt && Array.isArray(queue[0].body.records));
  ok('the queue file is 0600 and holds no token', ownerOnly(queueFile(home)) && !fs.readFileSync(queueFile(home), 'utf8').includes(TOKEN) && !fs.readFileSync(queueFile(home), 'utf8').includes('Bearer'));
  ok('the log says queued with the queue length', pushes(log).slice(-1)[0].outcome === 'queued' && pushes(log).slice(-1)[0].queued === 1);
  ok('the terminal says where it waits', off1.stdout.includes('queued in') && off1.stdout.includes('for the next run'));
  setServers(home, ['notes', 'offline-b']);
  const off2 = await once(server, home, log);
  queue = readQueue(home);
  ok('a second change while offline queues a second entry, oldest first', off2.code === 5 && queue.length === 2 && serverNames(queue[0].body).includes('offline-a') && serverNames(queue[1].body).includes('offline-b'));
  await server.listen(port);
  const n2 = server.requests.length;
  const back = await once(server, home, log);
  const flushed = server.requests.slice(n2);
  ok('back online, --once flushes both entries in order and exits 0', back.code === 0 && flushed.length === 2 && flushed[0].body.snapshot_at === queue[0].body.snapshot_at && flushed[1].body.snapshot_at === queue[1].body.snapshot_at);
  ok('then reports the current posture unchanged (it equals the last flushed entry)', pushes(log).slice(-3).map(p => p.outcome).join() === 'flushed,flushed,unchanged');
  ok('the queue is empty afterwards', readQueue(home).length === 0);

  section('5xx then refused token (401): queue discarded, exit 6');
  server.respond = () => ({ status: 503 });
  setServers(home, ['notes', 'down']);
  const n3 = server.requests.length;
  const down = await once(server, home, log);
  ok('503 in --once: a couple of quick retries, then queued, exit 5', down.code === 5 && server.requests.length - n3 === 1 + watchPush.BACKOFF.onceRetries && readQueue(home).length === 1);
  server.respond = () => ({ status: 401, json: { error: 'Invalid or revoked collector token.' } });
  const refused = await once(server, home, log);
  ok('401 exits 6', refused.code === 6);
  ok('the message says the workspace no longer accepts the token and to create one on the Collectors page', refused.stderr.includes('no longer accepts this collector token') && refused.stderr.includes('revoked or wrong') && refused.stderr.includes('Collectors page'));
  ok('the queue for that origin is discarded and the count and reason are given', readQueue(home).length === 0 && refused.stderr.includes('discarded 1 queued push') && refused.stderr.includes('whichever collector'));
  ok('the log says revoked', pushes(log).slice(-1)[0].outcome === 'revoked' && pushes(log).slice(-1)[0].status === 401);

  section('refused token (403) in long-running mode stops the watcher');
  server.respond = () => ({ status: 200 });
  const revokeLog = path.join(root, 'revoke.log');
  const session = startWatch(server, home, revokeLog);
  await waitFor(() => pushes(revokeLog).length >= 1, 30000);
  ok('after a revoke the stored digest is cleared, so a new session pushes its baseline', pushes(revokeLog)[0] && pushes(revokeLog)[0].outcome === 'sent');
  server.respond = () => ({ status: 403, json: { error: 'Collector revoked.' } });
  setServers(home, ['notes', 'after-revoke']);
  const stoppedCode = await within(session.done, 30000);
  if (stoppedCode === 'timeout') session.child.kill('SIGKILL');
  ok('403 stops the session by itself with exit 6', stoppedCode === 6);
  const revokeEntries = readLog(revokeLog);
  ok('the log ends with push revoked then stopped', revokeEntries.slice(-2).map(e => e.kind === 'push' ? e.outcome : e.kind).join() === 'revoked,stopped');
  ok('the session says why on stderr', session.stderr().includes('no longer accepts this collector token'));
  ok('a session stopped by a refused token does not try to sign off', !readLog(revokeLog).slice(-1).some(e => e.kind === 'heartbeat' && e.mode === 'manual'));
  server.respond = () => ({ status: 200 });

  section('409 stale_snapshot and 422 drop the entry and continue');
  const dropHome = makeHome(root, 'drops');
  const dropLog = path.join(root, 'drops.log');
  const dropPort = server.port;
  await server.close();
  setServers(dropHome, ['a']); await once(server, dropHome, dropLog);
  setServers(dropHome, ['b']); await once(server, dropHome, dropLog);
  setServers(dropHome, ['c']); await once(server, dropHome, dropLog);
  await server.listen(dropPort);
  ok('three changes queued offline', readQueue(dropHome).length === 3);
  server.respond = (n, sentBody) => (serverNames(sentBody).includes('a') ? { status: 409, json: { error: 'A newer snapshot from this machine was already recorded.', code: 'stale_snapshot' } }
    : serverNames(sentBody).includes('b') ? { status: 422, json: { error: 'bad record shape' } } : { status: 200 });
  const dropRun = await once(server, dropHome, dropLog);
  const outcomes = pushes(dropLog).slice(-4).map(p => `${p.outcome}${p.status ? `:${p.status}` : ''}`).join();
  ok(`409 and 422 drop their entries without retry, the third is flushed (${outcomes})`, dropRun.code === 0 && outcomes === 'dropped:409,dropped:422,flushed:200,unchanged' && readQueue(dropHome).length === 0);
  ok('the drop note names the stale snapshot', dropRun.stderr.includes('dropped one push') && dropRun.stderr.includes('Push rejected (HTTP 409)'));
  server.respond = () => ({ status: 200 });

  section('backoff in long-running mode honors Retry-After, then flushes');
  const slowHome = makeHome(root, 'slow');
  const slowLog = path.join(root, 'slow.log');
  let calls = 0;
  server.respond = () => (++calls <= 2 ? { status: 429, headers: { 'retry-after': '1' }, json: { error: 'busy', code: 'rate_limited', retryAfterSeconds: 1 } } : { status: 200 });
  const slow = startWatch(server, slowHome, slowLog);
  await waitFor(() => pushes(slowLog).some(p => p.outcome === 'flushed'), 30000);
  slow.child.kill('SIGINT');
  await slow.done;
  ok('429 queues once, retries on the backoff timer, and flushes', pushes(slowLog).map(p => p.outcome).join() === 'queued,flushed' && calls === 3);
  ok('the terminal names the retry wait', slow.stdout().includes('retrying in'));
  server.respond = () => ({ status: 200 });

  section('crash safety of the queue file');
  const crashHome = makeHome(root, 'crash');
  const crashLog = path.join(root, 'crash.log');
  fs.mkdirSync(watchPush.storeDir(crashHome), { recursive: true });
  fs.writeFileSync(queueFile(crashHome), '{"schemaVersion":1,"entries":[{"id":');
  const corrupt = await once(server, crashHome, crashLog);
  const aside = fs.readdirSync(watchPush.storeDir(crashHome)).filter(f => f.startsWith('queue.json.corrupt-'));
  ok('a corrupt queue.json is moved aside with a clear warning and the run continues', corrupt.code === 0 && aside.length === 1 && corrupt.stderr.includes('moved it aside') && pushes(crashLog).slice(-1)[0].outcome === 'sent');
  ok('the moved-aside file is owner-only and keeps the bytes', ownerOnly(path.join(watchPush.storeDir(crashHome), aside[0])) && fs.readFileSync(path.join(watchPush.storeDir(crashHome), aside[0]), 'utf8').startsWith('{"schemaVersion":1'));
  ok('a fresh valid queue.json replaces it', Array.isArray(readQueue(crashHome)));
  const leftover = `${queueFile(crashHome)}.tmp-99999-deadbeef`;
  fs.writeFileSync(leftover, '{"schemaVersion":1,"entr');
  setServers(crashHome, ['notes', 'after-crash']);
  const withLeftover = await once(server, crashHome, crashLog);
  ok('a leftover truncated temp file is ignored, removed, and the push goes through', withLeftover.code === 0 && !fs.existsSync(leftover) && pushes(crashLog).slice(-1)[0].outcome === 'sent');
  fs.chmodSync(queueFile(crashHome), 0o644);
  const inode = fs.statSync(queueFile(crashHome)).ino;
  setServers(crashHome, ['notes', 'rename-check']);
  await once(server, crashHome, crashLog);
  ok('queue.json is replaced by rename (new inode) and is 0600 even after someone loosened it', fs.statSync(queueFile(crashHome)).ino !== inode && ownerOnly(queueFile(crashHome)));
  const outside = path.join(root, 'outside.json');
  fs.writeFileSync(outside, 'not boppi');
  fs.unlinkSync(queueFile(crashHome));
  if (symlinkOrSkip(outside, queueFile(crashHome), 'symlinked queue.json')) {
    const n4 = server.requests.length;
    const linked = await once(server, crashHome, crashLog);
    ok('a symlinked queue.json is refused with exit 2 and nothing is sent', linked.code === 2 && linked.stderr.includes('symbolic link') && server.requests.length === n4);
    ok('the link target is left untouched', fs.readFileSync(outside, 'utf8') === 'not boppi');
    fs.unlinkSync(queueFile(crashHome));
  }

  section('caps: count and age');
  const capHome = makeHome(root, 'caps');
  const capLog = path.join(root, 'caps.log');
  fs.mkdirSync(watchPush.storeDir(capHome), { recursive: true });
  const elsewhereOrigin = 'http://127.0.0.1:1';
  const entry = (i, ageMs) => ({ id: `e${i}`, origin: elsewhereOrigin, digest: `sha256:${String(i).padStart(64, '0')}`, queuedAt: new Date(Date.now() - ageMs).toISOString(), body: { records: [] } });
  const seeded = [entry(0, 25 * 3600e3), entry(1, 25 * 3600e3), ...Array.from({ length: 23 }, (_, i) => entry(i + 2, (30 - i) * 60e3))];
  fs.writeFileSync(queueFile(capHome), JSON.stringify({ schemaVersion: 1, entries: seeded }), { mode: 0o600 });
  const capped = await once(server, capHome, capLog);
  const kept = readQueue(capHome);
  ok('entries older than 24 hours are dropped and the run says so', capped.stderr.includes('older than 24 hours') && !kept.some(e => e.id === 'e0' || e.id === 'e1'));
  ok('at most 20 entries are kept across origins, oldest dropped first (this run\'s own push took one slot), and the run says so', kept.length === 19 && kept[0].id === 'e6' && kept[18].id === 'e24' && capped.stderr.includes('more than 20 queued'));
  ok('entries of another origin are kept but never sent here', capped.code === 0 && kept.every(e => e.origin === elsewhereOrigin) && server.requests.slice(-1)[0].body.snapshot === true);
  const big = { records: [{ pad: 'x'.repeat(3 * 1024 * 1024) }] };
  const bytes = watchPush.applyCaps([1, 2, 3].map(i => ({ ...entry(i, 1000), body: big })), Date.now());
  ok('the 8 MB cap drops the oldest entries until the queue fits', bytes.kept.length === 2 && bytes.dropped.length === 1 && bytes.dropped[0].entry.id === 'e1' && bytes.dropped[0].why === 'queue over 8 MB');

  section('unsafe bodies are never queued or sent');
  const unsafeHome = makeHome(root, 'unsafe');
  setServers(unsafeHome, ['ghp_0123456789abcdefghijklmnopqrstuvwxyzAB']);
  const n5 = server.requests.length;
  const unsafe = await once(server, unsafeHome, path.join(root, 'unsafe.log'));
  ok('a secret-shaped server name is refused before queueing: exit 2, nothing sent, nothing queued', unsafe.code === 2 && server.requests.length === n5 && unsafe.stderr.includes('watch: refused before sending') && readQueue(unsafeHome).length === 0);

  section('one watch --push per home: a second session is refused, a dead holder is recovered');
  {
    const lockHome = makeHome(root, 'locked');
    const lockLog = path.join(root, 'locked.log');
    const lockFile = path.join(watchPush.storeDir(lockHome), 'session.lock');
    const firstSession = startWatch(server, lockHome, lockLog);
    const baselinePushed = await waitFor(() => pushes(lockLog).length >= 1, 30000);
    ok('the running session holds an owner-only lock naming its process', fs.existsSync(lockFile) && ownerOnly(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === firstSession.child.pid);
    const queueBefore = fs.readFileSync(queueFile(lockHome), 'utf8');
    const n6 = server.requests.length;
    const second = await once(server, lockHome, path.join(root, 'locked-second.log'));
    ok('a second watch --push on the same home exits 2 before it scans or sends', second.code === 2 && server.requests.length === n6 && !second.stdout.includes('BOPPI · WATCH'));
    ok('and says which process holds the queue and what to do', second.stderr.includes(`another boppi watch --push (process ${firstSession.child.pid}`) && second.stderr.includes('Only one runs per home at a time'));
    ok("the second session leaves the first one's queue and lock untouched", baselinePushed && fs.readFileSync(queueFile(lockHome), 'utf8') === queueBefore && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === firstSession.child.pid);
    const otherHome = makeHome(root, 'unlocked');
    const elsewhere = await once(server, otherHome, path.join(root, 'unlocked.log'));
    ok('a session on another home is not blocked', elsewhere.code === 0);
    firstSession.child.kill('SIGTERM');
    const stoppedCode = await firstSession.done;
    ok('a stopped session releases the lock', stoppedCode === 0 && !fs.existsSync(lockFile));

    const killed = startWatch(server, lockHome, lockLog);
    await waitFor(() => killed.stdout().includes('BOPPI · WATCH'), 15000);
    killed.child.kill('SIGKILL');
    await killed.done;
    ok('a killed session leaves its lock behind', fs.existsSync(lockFile));
    const recovered = await once(server, lockHome, lockLog);
    ok('the next session takes over a lock whose process is gone', recovered.code === 0 && !recovered.stderr.includes('another boppi watch --push'));
    ok('and releases it when --once exits', !fs.existsSync(lockFile));

    fs.writeFileSync(lockFile, '', { mode: 0o600 });
    const settlingWindow = new Date(Date.now() + 60000);
    fs.utimesSync(lockFile, settlingWindow, settlingWindow);
    const settling = await once(server, lockHome, lockLog);
    ok('an empty lock still being written is respected', settling.code === 2 && settling.stderr.includes('another boppi watch --push is already using'));
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(lockFile, past, past);
    const afterCrash = await once(server, lockHome, lockLog);
    ok('an empty lock left by a crash is taken over', afterCrash.code === 0 && !fs.existsSync(lockFile));

    const racers = await Promise.all(Array.from({ length: 4 }, (_, i) => once(server, lockHome, path.join(root, `race-${i}.log`))));
    ok('four sessions racing on one home: at least one runs, the rest are refused with exit 2', racers.some(r => r.code === 0) && racers.every(r => r.code === 0 || (r.code === 2 && r.stderr.includes('another boppi watch --push'))));
    ok('the queue survives the race intact', Array.isArray(readQueue(lockHome)));
  }

  section('check-ins: continuous while watching, manual on a deliberate stop, nothing else sent');
  server.respond = () => ({ status: 200 });
  server.heartbeats.length = 0;
  const beatHome = makeHome(root, 'beat');
  const beatLog = path.join(root, 'beat.log');
  const oneShot = await once(server, beatHome, beatLog);
  ok('--once is a one-off push and sends no check-in', oneShot.code === 0 && server.heartbeats.length === 0);
  const timed = await cli(['watch', '--push', '--interval', '1', '--duration', '2', '--url', server.url(), '--token', TOKEN, '--log', beatLog], beatHome);
  const beats = server.heartbeats.slice();
  ok('a watching session checks in as continuous, then signs off as manual when it stops', timed.code === 0 && beats.map(b => b.body.mode).join() === 'continuous,manual');
  ok('a check-in goes to /api/ingest/heartbeat with the collector token', beats.every(b => b.url === '/api/ingest/heartbeat' && b.authorization === `Bearer ${TOKEN}`));
  ok('a check-in carries only the mode and its interval', beats.every(b => Object.keys(b.body).sort().join() === 'intervalSeconds,mode' && b.body.intervalSeconds === watchPush.HEARTBEAT_SECONDS));
  ok('check-ins are logged without the token', readLog(beatLog).filter(e => e.kind === 'heartbeat').length === 2 && !fs.readFileSync(beatLog, 'utf8').includes(TOKEN));
  server.heartbeats.length = 0;
  server.heartbeatStatus = 503;
  const failing = await cli(['watch', '--push', '--interval', '1', '--duration', '2', '--url', server.url(), '--token', TOKEN, '--log', beatLog], beatHome);
  server.heartbeatStatus = 200;
  ok('a failed check-in is reported once and the watcher keeps running', failing.code === 0 && (failing.stdout.match(/check-in failed \(HTTP 503\)/g) || []).length === 1 && failing.stdout.includes('stopped (2 s elapsed)'));
  ok('the failure says what the workspace will show', failing.stdout.includes('the workspace will show this machine as stopped until one succeeds'));
  server.heartbeats.length = 0;
  const unpushedBeat = await cli(['watch', '--interval', '1', '--duration', '1'], beatHome);
  ok('watch without --push never checks in', unpushedBeat.code === 0 && server.heartbeats.length === 0);
  ok('the heartbeat URL keeps the ingest origin and drops any query', watchPush.heartbeatUrl(new URL('https://app.example.test/api/ingest/?x=1')).toString() === 'https://app.example.test/api/ingest/heartbeat');

  section('pure rules');
  const body = { records: [{ kind: 'agent', b: 1, a: 2 }], snapshot: true, snapshot_at: 'T1' };
  ok('the digest ignores snapshot_at and key order', watchPush.digestOf(body) === watchPush.digestOf({ snapshot_at: 'T2', snapshot: true, records: [{ a: 2, kind: 'agent', b: 1 }] }));
  ok('the digest changes with the posture', watchPush.digestOf(body) !== watchPush.digestOf({ ...body, records: [] }));
  const table = [[{ ok: true, status: 200 }, 'sent'], [{ ok: false, networkError: 'ECONNREFUSED' }, 'retry'], [{ ok: false, status: 500 }, 'retry'], [{ ok: false, status: 503 }, 'retry'], [{ ok: false, status: 429 }, 'retry'], [{ ok: false, status: 401 }, 'revoked'], [{ ok: false, status: 403 }, 'revoked'], [{ ok: false, status: 409 }, 'drop'], [{ ok: false, status: 413 }, 'drop'], [{ ok: false, status: 422 }, 'drop'], [{ ok: false, status: 400 }, 'drop']];
  ok('responses classify as sent / retry / revoked / drop', table.every(([result, want]) => watchPush.classify(result) === want));
  const delays = [1, 2, 3, 4, 10, 20].map(a => watchPush.retryDelay(a, { random: () => 1 }));
  ok('backoff starts at 2 s, doubles, and caps at 5 minutes', delays.join() === '2000,4000,8000,16000,300000,300000');
  ok('jitter keeps each wait between half and all of the step', watchPush.retryDelay(3, { random: () => 0 }) === 4000 && watchPush.retryDelay(3, { random: () => 0.5 }) === 6000);
  ok('Retry-After wins over the backoff step', watchPush.retryDelay(1, { retryAfterSeconds: 137 }) === 137000);
  ok('the test-only base scales every wait', watchPush.retryDelay(1, { baseMs: 20, random: () => 1 }) === 20 && watchPush.retryDelay(1, { baseMs: 20, retryAfterSeconds: 1 }) === 10);

  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exit(1); });
