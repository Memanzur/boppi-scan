#!/usr/bin/env node
/** Just-in-time grants on the device: lease store, apply and revert on the safe-write path, offline expiry, crash recovery, the connect run cycle against a fake workspace, and the dark Claude Code gate. */
'use strict';
process.env.BOPPI_SCAN_PLATFORM = 'darwin';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cli = require('../src/cli/boppi');
const connect = require('../src/cli/connect');
const jit = require('../src/cli/jit');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-jit-'));
const NET_LOG = path.join(ROOT, 'net.log');
const PRELOAD = path.join(ROOT, 'no-network.js');
fs.writeFileSync(PRELOAD, `
'use strict';
const fs = require('fs');
function refuse(kind) { fs.appendFileSync(${JSON.stringify(NET_LOG)}, kind + '\\n'); throw new Error('network attempt (' + kind + ') blocked'); }
require('net').Socket.prototype.connect = function () { refuse('net.Socket.connect'); };
require('dns').lookup = function () { refuse('dns.lookup'); };
globalThis.fetch = async function () { refuse('fetch'); };
`);

const ENTRY = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] };
const MIN = 60 * 1000;
let homeCount = 0;

function makeHome() {
  const home = path.join(ROOT, `home-${++homeCount}`);
  const project = path.join(home, 'project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { existing: { command: 'uvx', args: ['mcp-server-fetch'] } } }, null, 2));
  fs.writeFileSync(path.join(home, '.boppi-pairing-placeholder'), '');
  fs.mkdirSync(path.join(home, '.boppi'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, '.boppi', 'connector.json'), JSON.stringify({ schemaVersion: 1, url: 'https://workspace.example', deviceId: 'dev-1', organizationId: 'org-1', credential: 'bpd_' + 'a'.repeat(64), credentialExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), workspaceName: 'Test Workspace', deviceName: 'test' }), { mode: 0o600 });
  return { home, project, config: path.join(home, '.claude.json'), store: path.join(home, '.boppi', 'jit-leases.json') };
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const servers = h => readJson(h.config).mcpServers;
const leases = h => readJson(h.store).leases;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** The workspace routes in memory, answering as section 7 of the design says. */
function fakeCloud({ jitMissing = false } = {}) {
  const cloud = { requests: [], grants: new Map(), targets: [], now: () => Date.now(), offline: false };
  cloud.byRoute = route => cloud.requests.filter(r => r.route === route);
  cloud.grant = ({ server = 'github', entry = ENTRY, durationSeconds = 3600, state = 'approved', client = 'claude-code', binding = {} } = {}) => {
    const target = cloud.targets.find(t => t.client === client);
    if (!target) throw new Error('no target offered yet');
    const id = crypto.randomUUID();
    const approvedAt = cloud.now();
    cloud.grants.set(id, {
      id, state, approvedAt: new Date(approvedAt).toISOString(), expiresAt: new Date(approvedAt + durationSeconds * 1000).toISOString(), endedAt: null, nonce: null,
      binding: { organizationId: 'org-1', deviceId: 'dev-1', client, project: target.project, targetFile: target.targetFile, server, catalogId: 'cat-1', entry, entryHash: jit.entryHash(entry), durationSeconds, requestedBy: 'user-requester-1', renewalOf: null, ...binding },
    });
    return id;
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  cloud.fetch = async (url, init) => {
    if (cloud.offline) throw Object.assign(new Error('fetch failed'), { cause: { message: 'getaddrinfo ENOTFOUND' } });
    const route = new URL(url).pathname.replace('/api/connector/', '');
    const body = JSON.parse(init.body);
    cloud.requests.push({ route, body });
    if (cloud.refuse && cloud.refuse(route)) return reply(401, { error: 'device_revoked' });
    const g = body.grantId ? cloud.grants.get(body.grantId) : null;
    const serverNow = new Date(cloud.now()).toISOString();
    if (g && ['approved', 'applying', 'active'].includes(g.state) && Date.parse(g.expiresAt) <= cloud.now()) g.state = g.state === 'approved' ? 'lapsed' : 'revoking';
    if (route === 'poll') return reply(200, { proposals: [] });
    if (jitMissing && route.startsWith('jit/')) return reply(404, { error: 'not_found' });
    if (route === 'jit/poll') {
      cloud.targets = body.targets;
      for (const grant of cloud.grants.values()) if (['approved', 'applying', 'active'].includes(grant.state) && Date.parse(grant.expiresAt) <= cloud.now()) grant.state = grant.state === 'approved' ? 'lapsed' : 'revoking';
      return reply(200, { serverNow, grants: [...cloud.grants.values()].filter(x => ['approved', 'applying', 'active', 'revoking', 'revocation_unverified'].includes(x.state)).map(x => ({ id: x.id, state: x.state, binding: x.binding, approvedAt: x.approvedAt, expiresAt: x.expiresAt, endedAt: x.endedAt })) });
    }
    if (route === 'jit/claim') {
      if (!g || g.state !== 'approved') return reply(409, { error: 'wrong_state' });
      g.state = 'applying'; g.nonce = crypto.randomBytes(16).toString('hex');
      return reply(200, { state: 'applying', nonce: g.nonce, expiresAt: g.expiresAt, serverNow });
    }
    if (route === 'jit/applied') {
      if (!g || g.nonce !== body.nonce) return reply(409, { error: 'nonce_mismatch' });
      if (g.state === 'revoking') return reply(200, { state: 'revoking' });
      if (g.state !== 'applying') return reply(409, { error: 'wrong_state' });
      g.state = body.failureCode ? 'failed' : body.entryHash === g.binding.entryHash ? 'active' : 'failed';
      g.applied = body;
      return reply(200, { state: g.state });
    }
    if (route === 'jit/revoked') {
      if (!g || g.nonce !== body.nonce) return reply(409, { error: 'nonce_mismatch' });
      if (!['applying', 'active', 'revoking', 'revocation_unverified'].includes(g.state)) return reply(409, { error: 'wrong_state' });
      if (body.serverPresent || body.configHash !== body.revertedHash) return reply(409, { error: 'not_verified' });
      g.state = 'revoked'; g.revoked = body;
      return reply(200, { state: 'revoked' });
    }
    return reply(404, { error: 'not_found' });
  };
  return cloud;
}

/** One `connect run --once` in this process, against the fake workspace, with stdout and stderr captured. */
async function cycle(h, cloud, { yes = true, tty = false, confirm = async () => true, now = null, extra = [] } = {}) {
  const options = cli.parseArgs(['connect', 'run', '--once', '--home', h.home, '--cwd', h.project, '--history-file', path.join(h.home, 'history.json'), ...(yes ? ['--yes'] : []), ...extra]);
  const captured = { stdout: '', stderr: '' };
  const write = { out: process.stdout.write, err: process.stderr.write, tty: process.stdin.isTTY };
  process.stdout.write = chunk => { captured.stdout += chunk; return true; };
  process.stderr.write = chunk => { captured.stderr += chunk; return true; };
  process.stdin.isTTY = tty;
  try {
    captured.code = await connect.runConnect(options, { performScan: cli.performScan, confirm, version: cli.VERSION, fetchImpl: cloud.fetch, ...(now ? { now } : {}) });
  } finally {
    process.stdout.write = write.out; process.stderr.write = write.err; process.stdin.isTTY = write.tty;
  }
  return captured;
}

function runCli(args, { input = null, network = false } = {}) {
  return new Promise(resolve => {
    fs.rmSync(NET_LOG, { force: true });
    const child = spawn(process.execPath, [...(network ? [] : ['--require', PRELOAD]), CLI, ...args], { env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_NO_UPDATE_NOTICE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.end(input === null ? undefined : input);
    child.on('close', code => resolve({ code, stdout, stderr, attempts: fs.existsSync(NET_LOG) ? fs.readFileSync(NET_LOG, 'utf8').split('\n').filter(Boolean) : [] }));
  });
}

/** Rewrite a lease in place, as a crash or a clock would leave it. */
function editStore(h, change) {
  const store = readJson(h.store);
  change(store);
  fs.writeFileSync(h.store, JSON.stringify(store, null, 2), { mode: 0o600 });
}

const hookPayload = (tool, event = 'PreToolUse') => JSON.stringify({ hook_event_name: event, tool_name: tool, session_id: 's-1', tool_use_id: 'u-1', cwd: '/tmp', tool_input: { q: 'x' } });
const gateOn = h => runCli(['settings', '--set', 'jitGate=on', '--home', h.home]);

async function main() {
  section('pure parts: entry hash, local expiry, binding check');
  ok('entry hash is sha256 of command and args joined by newlines', jit.entryHash(ENTRY) === sha(['npx', '-y', '@modelcontextprotocol/server-github'].join('\n')));
  const t0 = Date.parse('2026-10-29T12:00:00Z');
  ok('local expiry takes the device-measured remaining time when the device clock is behind', jit.localExpiry({ expiresAt: '2026-10-29T13:00:00Z', serverNow: '2026-10-29T12:00:00Z', deviceNow: t0 - 10 * MIN }) === new Date(t0 + 50 * MIN).toISOString());
  ok('local expiry takes the workspace expiry when the device clock is ahead', jit.localExpiry({ expiresAt: '2026-10-29T13:00:00Z', serverNow: '2026-10-29T12:00:00Z', deviceNow: t0 + 10 * MIN }) === '2026-10-29T13:00:00.000Z');
  ok('local expiry is capped at 8 hours after the claim', jit.localExpiry({ expiresAt: '2026-10-30T12:00:00Z', serverNow: '2026-10-29T12:00:00Z', deviceNow: t0 }) === new Date(t0 + 8 * 60 * MIN).toISOString());
  const good = { client: 'claude-code', server: 'github', project: 'p', targetFile: 't', entry: ENTRY, entryHash: jit.entryHash(ENTRY) };
  ok('a binding with the bound hash is valid', jit.validBinding(good));
  ok('a binding whose entry differs from its hash, carries env, or names __proto__ is refused', !jit.validBinding({ ...good, entry: { ...ENTRY, args: ['x'] } }) && !jit.validBinding({ ...good, entry: { ...ENTRY, env: { T: 'v' } } }) && !jit.validBinding({ ...good, server: '__proto__' }) && !jit.validBinding({ ...good, entry: { command: 'npx', args: ['a\nb'] }, entryHash: jit.entryHash({ command: 'npx', args: ['a\nb'] }) }));

  section('apply with local confirmation, entry hash, lease file');
  let h = makeHome();
  let cloud = fakeCloud();
  let first = await cycle(h, cloud);
  const sent = cloud.byRoute('jit/poll')[0].body;
  ok('connect run offers the Claude Code user file as a target: fingerprints, hash, entry names, no path', first.code === 0 && sent.targets.length === 1 && sent.targets[0].client === 'claude-code' && JSON.stringify(sent.targets[0].servers) === '["existing"]' && sent.targets[0].configHash === sha(fs.readFileSync(h.config)) && !JSON.stringify(sent).includes(h.home) && sent.versions && Object.keys(sent.targets[0]).sort().join() === 'client,computedAt,configHash,project,servers,targetFile');
  let id = cloud.grant();
  const original = fs.readFileSync(h.config);
  const waiting = await cycle(h, cloud, { yes: false });
  ok('without a terminal and without --yes the grant waits: shown, not claimed, file untouched', waiting.stdout.includes('waiting: no terminal') && cloud.byRoute('jit/claim').length === 0 && fs.readFileSync(h.config).equals(original));
  ok('the confirmation shows server, command, args, expiry and requester', waiting.stdout.includes('add "github" to claude-code') && waiting.stdout.includes(JSON.stringify(ENTRY)) && waiting.stdout.includes(cloud.grants.get(id).expiresAt) && waiting.stdout.includes('user-requester-1'));
  const declined = await cycle(h, cloud, { yes: false, tty: true, confirm: async () => false });
  ok('declined at the terminal: not claimed, file untouched', declined.stdout.includes('not applied here') && cloud.byRoute('jit/claim').length === 0 && fs.readFileSync(h.config).equals(original));
  const confirmed = await cycle(h, cloud, { yes: false, tty: true, confirm: async () => true });
  const after = readJson(h.config);
  ok('confirmed at the terminal: claimed, entry added exactly as { command, args }, other keys kept', cloud.byRoute('jit/claim').length === 1 && JSON.stringify(after.mcpServers.github) === JSON.stringify(ENTRY) && after.numStartups === 3 && after.mcpServers.existing.command === 'uvx');
  const appliedBody = cloud.byRoute('jit/applied')[0].body;
  ok('applied report carries the read-back entry hash, the hash before and after the write, and the nonce', appliedBody.entryHash === jit.entryHash(ENTRY) && appliedBody.hashAtWrite === sha(original) && appliedBody.appliedHash === sha(fs.readFileSync(h.config)) && appliedBody.nonce === cloud.grants.get(id).nonce && cloud.grants.get(id).state === 'active');
  ok('applied report sends only the contract fields', Object.keys(appliedBody).sort().join() === 'appliedHash,entryHash,grantId,hashAtWrite,nonce');
  let lease = leases(h)[0];
  ok('the lease is active with the local path, entry hash and a local expiry no later than the workspace one', lease.state === 'active' && lease.file === h.config && lease.entryHash === jit.entryHash(ENTRY) && Date.parse(lease.localExpiresAt) <= Date.parse(cloud.grants.get(id).expiresAt) && confirmed.code === 0);
  ok('lease store is mode 0600 in a 0700 directory', (fs.statSync(h.store).mode & 0o777) === 0o600 && (fs.statSync(path.dirname(h.store)).mode & 0o777) === 0o700);
  ok('lease store writes leave no temp file behind (temp file + rename)', fs.readdirSync(path.dirname(h.store)).filter(f => f.startsWith('jit-leases.json.')).length === 0);
  const manifest = readJson(path.join(h.home, '.boppi', 'backups', 'index.json')).entries;
  ok('a backup of the original bytes and a jit_grant manifest entry are recorded', manifest.some(e => e.action === 'jit_grant' && e.grantId === id && fs.readFileSync(e.backup).equals(original)));
  const again = await cycle(h, cloud);
  ok('the next cycle does not apply or report again', cloud.byRoute('jit/claim').length === 1 && cloud.byRoute('jit/applied').length === 1 && again.code === 0);
  const status = await runCli(['connect', 'status', '--home', h.home]);
  ok('connect status lists the lease (server, client, state, local expiry) and no credential, offline', status.code === 0 && /"github"\s+claude-code\s+active/.test(status.stdout) && status.stdout.includes(lease.localExpiresAt) && !status.stdout.includes('bpd_') && status.attempts.length === 0);

  section('atomic lease write');
  const stamp = fs.statSync(h.store).ino;
  jit.putLease(h.home, Date.now(), { ...lease, grantId: 'g-extra', state: 'closed' });
  ok('the store is replaced by rename (new inode), never edited in place', fs.statSync(h.store).ino !== stamp && leases(h).length === 2);
  editStore(h, s => { s.leases = s.leases.filter(l => l.grantId !== 'g-extra'); });

  section('refusal when the name already exists');
  const h2 = makeHome();
  const cloud2 = fakeCloud();
  await cycle(h2, cloud2);
  const clash = cloud2.grant({ server: 'existing' });
  const before2 = fs.readFileSync(h2.config);
  const clashed = await cycle(h2, cloud2);
  ok('a grant for a name already in the file waits and is never claimed', clashed.stdout.includes('waiting: "existing" is already in that claude-code configuration') && cloud2.byRoute('jit/claim').length === 0 && fs.readFileSync(h2.config).equals(before2));
  const direct = jit.applyGrant({ home: h2.home, lease: { grantId: 'g-direct', nonce: 'n'.repeat(16), client: 'claude-code', targetFile: 'path_direct', file: h2.config, server: 'existing', entryHash: jit.entryHash(ENTRY), expiresAt: new Date(Date.now() + 3600000).toISOString(), localExpiresAt: new Date(Date.now() + 3600000).toISOString() }, entry: ENTRY });
  ok('applyGrant itself refuses an existing name (name_exists) and writes no lease and no byte', !direct.ok && direct.failureCode === 'name_exists' && fs.readFileSync(h2.config).equals(before2) && !fs.existsSync(h2.store));
  fs.chmodSync(h2.home, 0o555);
  const unwritable = jit.applyGrant({ home: h2.home, lease: { grantId: 'g-ro', nonce: 'n'.repeat(16), client: 'claude-code', targetFile: 'path_ro', file: h2.config, server: 'github', entryHash: jit.entryHash(ENTRY), expiresAt: new Date(Date.now() + 3600000).toISOString(), localExpiresAt: new Date(Date.now() + 3600000).toISOString() }, entry: ENTRY });
  fs.chmodSync(h2.home, 0o755);
  ok('a config write that fails leaves the file as it was and a failed lease, which proves the lease was written before the config', !unwritable.ok && unwritable.failureCode === 'permission_denied' && fs.readFileSync(h2.config).equals(before2) && fs.existsSync(h2.store) && (leases(h2).find(l => l.grantId === 'g-ro') || {}).state === 'failed');
  cloud2.grants.get(clash).state = 'cancelled';

  section('entry hash check');
  const h3 = makeHome();
  const cloud3 = fakeCloud();
  await cycle(h3, cloud3);
  const forged = cloud3.grant({ binding: { entryHash: jit.entryHash({ command: 'npx', args: ['-y', 'something-else'] }) } });
  const forgedRun = await cycle(h3, cloud3);
  ok('a binding whose entry does not match its hash is refused before the claim', forgedRun.stdout.includes(`${forged}  refused (invalid_binding)`) && cloud3.byRoute('jit/claim').length === 0 && !servers(h3).github);
  cloud3.grants.get(forged).state = 'cancelled';
  const other = cloud3.grant({ binding: { targetFile: 'path_' + '0'.repeat(32) } });
  const otherRun = await cycle(h3, cloud3);
  ok('a binding for a file this device did not offer is refused as not_offered', otherRun.stdout.includes(`${other}  refused (not_offered)`) && cloud3.byRoute('jit/claim').length === 0);
  cloud3.grants.get(other).state = 'cancelled';
  const tampered = makeHome();
  const tamperedLease = { grantId: 'g-tamper', nonce: 'n'.repeat(16), client: 'claude-code', targetFile: 'path_tamper', file: tampered.config, server: 'github', entryHash: jit.entryHash({ command: 'npx', args: ['other'] }), expiresAt: new Date(Date.now() + 3600000).toISOString(), localExpiresAt: new Date(Date.now() + 3600000).toISOString() };
  const tamperedBefore = fs.readFileSync(tampered.config);
  const mismatch = jit.applyGrant({ home: tampered.home, lease: tamperedLease, entry: ENTRY });
  ok('a read-back entry whose hash differs from the bound one is undone (validation_failed), file restored, lease failed', !mismatch.ok && mismatch.failureCode === 'validation_failed' && fs.readFileSync(tampered.config).equals(tamperedBefore) && leases(tampered)[0].state === 'failed');

  section('expiry while offline: any boppi invocation reverts');
  editStore(h, s => { s.leases[0].localExpiresAt = new Date(Date.now() - 1000).toISOString(); });
  const offline = await runCli(['settings', '--home', h.home]);
  lease = leases(h)[0];
  ok('boppi settings (no network at all) removes the expired entry and keeps the others', offline.code === 0 && offline.attempts.length === 0 && !servers(h).github && servers(h).existing && readJson(h.config).numStartups === 3);
  ok('it says so in one stderr line that names the server, not a file', offline.stderr.split('\n').filter(l => l.startsWith('boppi:')).length === 1 && offline.stderr.includes('"github" (claude-code)') && !offline.stderr.includes(h.home));
  ok('the lease is reverted with the hash of the file after the removal', lease.state === 'reverted' && lease.revertedHash === sha(fs.readFileSync(h.config)));
  const quiet = await runCli(['settings', '--home', h.home]);
  ok('the next invocation is quiet: nothing left to revert', quiet.code === 0 && !quiet.stderr.includes('boppi:'));

  section('recovery: back online, the removal is reported from a rescan and the lease closes');
  const back = await cycle(h, cloud);
  const revokedBody = cloud.byRoute('jit/revoked')[0] && cloud.byRoute('jit/revoked')[0].body;
  ok('jit/revoked carries the nonce, reverted hash, current hash, serverPresent false from the rescan, and versions', revokedBody && revokedBody.nonce === lease.nonce && revokedBody.revertedHash === lease.revertedHash && revokedBody.configHash === lease.revertedHash && revokedBody.serverPresent === false && revokedBody.versions && typeof revokedBody.scannedAt === 'string');
  ok('the workspace marks it revoked and the lease becomes closed history', cloud.grants.get(id).state === 'revoked' && leases(h)[0].state === 'closed' && back.code === 0);
  await cycle(h, cloud);
  ok('a closed lease is not reported again', cloud.byRoute('jit/revoked').length === 1);

  section('clock rollback does not extend a lease');
  const h4 = makeHome();
  const cloud4 = fakeCloud();
  await cycle(h4, cloud4);
  const id4 = cloud4.grant();
  await cycle(h4, cloud4);
  const l4 = leases(h4)[0];
  const expiry = Date.parse(l4.localExpiresAt);
  editStore(h4, s => { s.latestSeenAt = new Date(expiry + 1000).toISOString(); });
  const rolledBack = expiry - 30 * MIN;
  ok('gate (unit): with the clock turned back below a time already seen, the lease is not live', jit.gateDecision(h4.home, 'mcp__github__search', rolledBack) !== null);
  const rb = jit.enforceLeases(h4.home, rolledBack);
  ok('enforceLeases with the clock turned back still reverts, since now is max(clock, latestSeenAt)', rb.reverted.length === 1 && !servers(h4).github);
  ok('latestSeenAt never moves backwards', Date.parse(readJson(h4.store).latestSeenAt) >= expiry + 1000);
  await cycle(h4, cloud4);
  ok('and the revert is reported and verified', cloud4.grants.get(id4).state === 'revoked' && leases(h4)[0].state === 'closed');

  section('crash mid-apply');
  const h5 = makeHome();
  const cloud5 = fakeCloud();
  await cycle(h5, cloud5);
  const id5 = cloud5.grant();
  await cycle(h5, cloud5);
  editStore(h5, s => { Object.assign(s.leases[0], { state: 'applying', appliedReported: false, appliedHash: null }); });
  cloud5.grants.get(id5).state = 'applying';
  const resumed = await cycle(h5, cloud5);
  ok('lease applying with the entry written: the next cycle finds it and reports applied', resumed.stdout.includes('stopped before reporting') && cloud5.grants.get(id5).state === 'active' && leases(h5)[0].state === 'active');
  editStore(h5, s => { Object.assign(s.leases[0], { state: 'applying', localExpiresAt: new Date(Date.now() - 1000).toISOString() }); });
  const crashed = await runCli(['scan', '--home', h5.home, '--cwd', h5.project, '--history-file', path.join(h5.home, 'h.json')]);
  ok('lease applying, entry written, process died, expiry passed: the next invocation reverts and says so', !servers(h5).github && crashed.stderr.includes('removed expired just-in-time access to "github"') && leases(h5)[0].state === 'reverted' && crashed.attempts.length === 0);
  await cycle(h5, cloud5);
  ok('the next connect run reports it and the workspace verifies', cloud5.grants.get(id5).state === 'revoked' && leases(h5)[0].state === 'closed');
  const h5b = makeHome();
  const userOwn = { command: 'node', args: ['my-own-github.js'] };
  const cfg = readJson(h5b.config); cfg.mcpServers.github = userOwn; fs.writeFileSync(h5b.config, JSON.stringify(cfg, null, 2));
  jit.putLease(h5b.home, Date.now(), { grantId: 'g-applying', nonce: 'n'.repeat(16), client: 'claude-code', targetFile: 'path_x', file: h5b.config, server: 'github', entryHash: jit.entryHash(ENTRY), expiresAt: new Date(Date.now() - 1000).toISOString(), localExpiresAt: new Date(Date.now() - 1000).toISOString(), state: 'applying' });
  jit.enforceLeases(h5b.home);
  ok('a lease still applying never removes an entry that is not its own (crash before the write)', JSON.stringify(servers(h5b).github) === JSON.stringify(userOwn) && leases(h5b)[0].state === 'reverted');

  section('crash mid-revert');
  const h6 = makeHome();
  const cloud6 = fakeCloud();
  await cycle(h6, cloud6);
  const id6 = cloud6.grant();
  await cycle(h6, cloud6);
  const c6 = readJson(h6.config); delete c6.mcpServers.github; fs.writeFileSync(h6.config, JSON.stringify(c6, null, 2));
  editStore(h6, s => { s.leases[0].localExpiresAt = new Date(Date.now() - 1000).toISOString(); });
  const half = await runCli(['settings', '--home', h6.home]);
  ok('entry removed but lease still active: the next invocation marks it reverted (already absent), quietly', leases(h6)[0].state === 'reverted' && leases(h6)[0].revertedHash === sha(fs.readFileSync(h6.config)) && !half.stderr.includes('could not'));
  await cycle(h6, cloud6);
  ok('and the revocation is reported and verified', cloud6.grants.get(id6).state === 'revoked');
  const h7 = makeHome();
  const cloud7 = fakeCloud();
  await cycle(h7, cloud7);
  const id7 = cloud7.grant();
  await cycle(h7, cloud7);
  editStore(h7, s => { Object.assign(s.leases[0], { state: 'reverted', revertedHash: 'f'.repeat(64) }); });
  const reverse = await runCli(['settings', '--home', h7.home]);
  ok('the reverse (lease reverted, entry still in the file): the next invocation removes the entry', !servers(h7).github && reverse.stderr.includes('"github"'));
  await cycle(h7, cloud7);
  ok('and reports the hash of the file it actually wrote, which the workspace verifies', cloud7.grants.get(id7).state === 'revoked' && cloud7.byRoute('jit/revoked')[0].body.revertedHash === sha(fs.readFileSync(h7.config)));

  section('A device the workspace refuses removes its granted entries');
  for (const [label, refuse] of [['every route refused (device revoked or person deprovisioned)', () => true], ['only jit/poll refused', route => route === 'jit/poll']]) {
    const hr = makeHome();
    const cloudR = fakeCloud();
    await cycle(hr, cloudR);
    const idR = cloudR.grant();
    await cycle(hr, cloudR);
    const held = JSON.stringify(servers(hr).github) === JSON.stringify(ENTRY);
    cloudR.refuse = refuse;
    const refused = await cycle(hr, cloudR);
    ok(`${label}: the granted entry is removed in the same run and the lease is reverted`, held && !servers(hr).github && leases(hr).find(l => l.grantId === idR).state !== 'active' && refused.stdout.includes('no longer accepts this device'));
    ok(`${label}: the run still reports the refusal`, refused.code !== 0);
  }

  section('Cloud revoking triggers an immediate revert');
  const h8 = makeHome();
  const cloud8 = fakeCloud();
  await cycle(h8, cloud8);
  const id8 = cloud8.grant();
  await cycle(h8, cloud8);
  cloud8.grants.get(id8).state = 'revoking';
  const revoking = await cycle(h8, cloud8);
  ok('a grant the workspace is revoking is removed in the same cycle and reported', !servers(h8).github && revoking.stdout.includes('the workspace is revoking it (revoking)') && cloud8.grants.get(id8).state === 'revoked' && leases(h8)[0].state === 'closed');
  const id8b = cloud8.grant();
  await cycle(h8, cloud8);
  cloud8.grants.delete(id8b);
  const unlisted = await cycle(h8, cloud8);
  ok('a local lease the workspace no longer lists is reverted', !servers(h8).github && unlisted.stdout.includes('no longer lists it') && leases(h8).find(l => l.grantId === id8b).state !== 'active');
  const id8c = cloud8.grant();
  await cycle(h8, cloud8);
  const renewal = await runCli(['settings', '--home', h8.home]);
  ok('an earlier reverted lease for the same name never removes the entry a later grant applied', JSON.stringify(servers(h8).github) === JSON.stringify(ENTRY) && !renewal.stderr.includes('boppi:'));
  const blocked = await runCli(['uninstall', '--yes', '--home', h8.home, '--cwd', h8.project]);
  ok('uninstall stops while a grant is configured and points at revert-grants', blocked.code === 2 && blocked.stdout.includes('"github" in claude-code') && blocked.stdout.includes('boppi connect revert-grants') && fs.existsSync(h8.store) && servers(h8).github);
  const kill = await runCli(['connect', 'revert-grants', '--home', h8.home]);
  ok('connect revert-grants reverts every live lease now, offline', kill.code === 0 && kill.attempts.length === 0 && !servers(h8).github && leases(h8).find(l => l.grantId === id8c).state === 'reverted' && kill.stdout.includes('Reverted 1'));
  const killAgain = await runCli(['connect', 'revert-grants', '--home', h8.home]);
  ok('revert-grants is idempotent', killAgain.code === 0 && killAgain.stdout.includes('nothing to revert'));
  const removed = await runCli(['uninstall', '--yes', '--home', h8.home, '--cwd', h8.project]);
  ok('after the revert, uninstall proceeds (the grant backups do not hold it up)', removed.code === 0 && !fs.existsSync(path.join(h8.home, '.boppi')));

  section('the workspace expiry ends a grant while it is applied');
  const h9 = makeHome();
  const cloud9 = fakeCloud();
  let fakeNow = Date.now();
  cloud9.now = () => fakeNow;
  await cycle(h9, cloud9, { now: () => fakeNow });
  const id9 = cloud9.grant({ durationSeconds: 120 });
  await cycle(h9, cloud9, { now: () => fakeNow });
  ok('a two-minute grant is applied', servers(h9).github && leases(h9)[0].state === 'active');
  fakeNow += 3 * MIN;
  await cycle(h9, cloud9, { now: () => fakeNow });
  ok('three minutes later the cycle reverts it before polling and the workspace verifies', !servers(h9).github && cloud9.grants.get(id9).state === 'revoked' && leases(h9)[0].state === 'closed');

  section('older workspace without jit routes');
  const h10 = makeHome();
  const old = fakeCloud({ jitMissing: true });
  const oldRun = await cycle(h10, old);
  ok('404 on jit/poll prints one line and the remediation cycle still succeeds', oldRun.code === 0 && old.byRoute('poll').length === 1 && oldRun.stdout.split('\n').filter(l => l.includes('HTTP 404')).length === 1 && !oldRun.stderr.includes('jit'));
  const unreachable = fakeCloud();
  await cycle(h10, unreachable);
  unreachable.offline = true;
  const down = await cycle(h10, unreachable);
  ok('an unreachable workspace exits 5 and changes nothing', down.code === 5);

  section('watch: revert at the local expiry between polls');
  const h11 = makeHome();
  const cloud11 = fakeCloud();
  await cycle(h11, cloud11);
  cloud11.grant({ durationSeconds: 3600 });
  await cycle(h11, cloud11);
  editStore(h11, s => { s.leases[0].localExpiresAt = new Date(Date.now() + 1500).toISOString(); });
  const watch = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--require', PRELOAD, CLI, 'connect', 'run', '--watch', '--interval', '600', '--home', h11.home, '--cwd', h11.project, '--history-file', path.join(h11.home, 'h.json')], { env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_NO_UPDATE_NOTICE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stdout += d; });
    child.stdin.end();
    const started = Date.now();
    const timer = setInterval(() => {
      if (!readJson(h11.config).mcpServers.github || Date.now() - started > 15000) { clearInterval(timer); setTimeout(() => { child.kill('SIGINT'); }, 200); resolve({ elapsed: Date.now() - started, stdout }); }
    }, 100);
  });
  ok('connect run --watch, with the workspace unreachable, removes the entry within about a second of the local expiry', !servers(h11).github && watch.elapsed < 6000 && leases(h11)[0].state === 'reverted');

  section('dark gate in boppi hook');
  const g = makeHome();
  const cg = fakeCloud();
  await cycle(g, cg);
  cg.grant();
  await cycle(g, cg);
  const off = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search') });
  ok('gate off (default): observe-only, nothing on stdout, exit 0, the event is recorded', off.code === 0 && off.stdout === '' && fs.readFileSync(path.join(g.home, '.boppi', 'events.jsonl'), 'utf8').includes('"server":"github"'));
  editStore(g, s => { s.leases[0].localExpiresAt = new Date(Date.now() - 1000).toISOString(); });
  const offExpired = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search') });
  ok('gate off: even an expired lease is not judged, and the hook does not revert (hook skips enforcement)', offExpired.stdout === '' && offExpired.code === 0 && servers(g).github);
  await gateOn(g);
  ok('settings accept jitGate=on and store a boolean', readJson(path.join(g.home, '.boppi', 'settings.json')).jitGate === true);
  const denied = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search') });
  let decision = null;
  try { decision = JSON.parse(denied.stdout); } catch (_) { /* checked below */ }
  ok('gate on, expired lease: the Claude Code deny JSON on stdout, exit 0', denied.code === 0 && decision && decision.hookSpecificOutput.hookEventName === 'PreToolUse' && decision.hookSpecificOutput.permissionDecision === 'deny' && decision.hookSpecificOutput.permissionDecisionReason.includes('"github"') && Object.keys(decision).join() === 'hookSpecificOutput' && Object.keys(decision.hookSpecificOutput).sort().join() === 'hookEventName,permissionDecision,permissionDecisionReason');
  ok('the deny reason names no path', !denied.stdout.includes(g.home));
  const post = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search', 'PostToolUse') });
  ok('gate on: a PostToolUse event is never answered with a decision', post.stdout === '' && post.code === 0);
  const nonJit = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__existing__fetch') });
  ok('gate on: a server that is not JIT-managed passes untouched', nonJit.stdout === '' && nonJit.code === 0);
  const builtin = await runCli(['hook', '--home', g.home], { input: hookPayload('Bash') });
  ok('gate on: a built-in tool passes untouched', builtin.stdout === '' && builtin.code === 0);
  editStore(g, s => { Object.assign(s.leases[0], { state: 'active', localExpiresAt: new Date(Date.now() + 3600000).toISOString() }); });
  const live = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search') });
  ok('gate on, live lease: allowed (nothing on stdout)', live.stdout === '' && live.code === 0);
  editStore(g, s => { s.leases[0].state = 'closed'; });
  const closed = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search') });
  ok('gate on, only a closed lease (server still JIT-managed): denied', closed.stdout.includes('"permissionDecision":"deny"'));
  fs.writeFileSync(path.join(g.home, '.boppi', 'hook.disabled'), 'x');
  const disabled = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__github__search') });
  ok('gate on with capture disabled: still denies (capture and gate are separate)', disabled.stdout.includes('"permissionDecision":"deny"'));
  fs.rmSync(path.join(g.home, '.boppi', 'hook.disabled'));
  fs.writeFileSync(g.store, '{ not json');
  const corrupt = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__existing__fetch') });
  ok('gate on, corrupt lease store: every MCP call is denied (fail closed)', corrupt.code === 0 && corrupt.stdout.includes('"permissionDecision":"deny"') && corrupt.stdout.includes('unreadable'));
  const corruptBuiltin = await runCli(['hook', '--home', g.home], { input: hookPayload('Read') });
  ok('corrupt store: built-in tools still pass', corruptBuiltin.stdout === '');
  const corruptCmd = await runCli(['settings', '--home', g.home]);
  ok('corrupt store: a normal command still runs, says so in one line, and never overwrites the store', corruptCmd.code === 0 && corruptCmd.stderr.includes('lease store is unreadable') && fs.readFileSync(g.store, 'utf8') === '{ not json');
  const corruptRevert = await runCli(['connect', 'revert-grants', '--home', g.home]);
  ok('corrupt store: revert-grants refuses with exit 3 and touches nothing', corruptRevert.code === 3 && fs.readFileSync(g.store, 'utf8') === '{ not json');
  fs.rmSync(g.store);
  fs.symlinkSync(path.join(g.home, '.claude.json'), g.store);
  const linked = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__existing__fetch') });
  ok('gate on, lease store replaced by a symlink: fails closed', linked.stdout.includes('"permissionDecision":"deny"'));
  fs.rmSync(g.store);
  const none = await runCli(['hook', '--home', g.home], { input: hookPayload('mcp__existing__fetch') });
  ok('gate on, no lease store at all: nothing is JIT-managed, every call passes', none.stdout === '' && none.code === 0);

  section('bounded history');
  const h12 = makeHome();
  for (let i = 0; i < 70; i++) jit.putLease(h12.home, Date.now(), { grantId: `g-${i}`, nonce: 'n'.repeat(16), client: 'claude-code', targetFile: 'path_x', file: h12.config, server: `s${i}`, entryHash: 'x', expiresAt: new Date().toISOString(), localExpiresAt: new Date().toISOString(), state: 'closed' });
  ok(`closed leases are kept as bounded history (last ${jit.CLOSED_KEEP})`, leases(h12).length === jit.CLOSED_KEEP && leases(h12)[0].grantId === 'g-6');

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(ROOT, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
