#!/usr/bin/env node
/**
 * The Agent side of the version handshake: every request to a workspace
 * (push, events push, every connector route) carries Boppi-Agent-Version and
 * user-agent boppi-cli/<version>; the connector poll body carries versions;
 * an HTTP 426 agent_outdated answer prints the workspace's sentence plus an
 * upgrade line and exits non-zero, and a looping connect run stops. Drives the
 * real CLI against an in-process HTTP workspace on 127.0.0.1.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const hook = require('../src/cli/hook');
const connect = require('../src/cli/connect');
const agentRequest = require('../src/cli/agentRequest');
const VERSION = require('../package.json').version;

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const MINIMUM = '9.0.0';
const SENTENCE = `This Boppi Agent is ${VERSION}; this workspace requires ${MINIMUM} or newer. Install the current Agent from <origin>/dashboard/get-agent, or run npx boppi@${MINIMUM}.`;
const FAR = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

function makeHome(root, name) {
  const home = path.join(root, name);
  const dir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] } } }));
  return home;
}

function okBody(route, body) {
  if (route === '/api/ingest') return { ingested: (body.records || []).length, requestId: 'req-ok' };
  if (route === '/api/events') return { accepted: body.events.length, received: body.events.length, requestId: 'req-ok' };
  if (route === '/api/connector/pair') return { deviceId: 'dev-1', organizationId: 'org-1', credential: `bpd_${'a'.repeat(64)}`, credentialExpiresAt: FAR, workspaceName: 'Handshake test' };
  if (route === '/api/connector/rotate') return { credential: `bpd_${'b'.repeat(64)}`, credentialExpiresAt: FAR };
  if (route === '/api/connector/poll') return { proposals: [] };
  return {};
}

function outdatedBody(route) {
  if (route.startsWith('/api/connector/')) return { error: 'agent_outdated', message: SENTENCE, minimumVersion: MINIMUM, agentVersion: VERSION };
  return { error: SENTENCE, code: 'agent_outdated', minimumVersion: MINIMUM, agentVersion: VERSION, requestId: 'req-426' };
}

function startWorkspace() {
  const state = { mode: 'ok', requests: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch (_) { /* empty */ }
      state.requests.push({ url: req.url, headers: req.headers, body });
      const headers = { 'content-type': 'application/json', 'boppi-agent-minimum': state.mode === 'outdated' ? MINIMUM : '0.4.0' };
      if (state.mode === 'outdated') { res.writeHead(426, headers); res.end(JSON.stringify(outdatedBody(req.url))); return; }
      res.writeHead(200, headers);
      res.end(JSON.stringify(okBody(req.url, body)));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) })));
}

function runCli(args, home, timeoutMs = 60000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { env: { ...process.env, BOPPI_TOKEN: '', NO_UPDATE_NOTIFIER: '1', BOPPI_SCAN_PLATFORM: 'darwin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

const carriesVersion = request => request.headers['boppi-agent-version'] === VERSION && request.headers['user-agent'] === `boppi-cli/${VERSION}`;

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-handshake-'));
  const ws = await startWorkspace();
  try {
    section('Headers on every route the CLI reaches');
    const home = makeHome(root, 'home');
    const now = new Date().toISOString();
    hook.append(home, hook.toRecord({ hook_event_name: 'PreToolUse', tool_name: 'mcp__github__create_issue', session_id: 's1', tool_use_id: 'c1', tool_input: {} }, { now, fingerprint: () => 'path_0123456789abcdef' }), 30);

    const pushed = await runCli(['push', '--url', ws.url, '--token', 'bpc_good'], home);
    ok('push succeeds', pushed.code === 0, pushed.stderr);
    const sent = await runCli(['events', 'push', '--url', ws.url, '--token', 'bpc_good'], home);
    ok('events push succeeds', sent.code === 0, sent.stderr);
    const paired = await runCli(['connect', 'pair', '--url', ws.url, '--code', 'PAIRCODE1'], home);
    ok('connect pair succeeds', paired.code === 0, paired.stderr);
    const ran = await runCli(['connect', 'run', '--once'], home);
    ok('connect run --once succeeds', ran.code === 0, ran.stderr);
    const rotated = await runCli(['connect', 'rotate'], home);
    ok('connect rotate succeeds', rotated.code === 0, rotated.stderr);
    const unpaired = await runCli(['connect', 'unpair'], home);
    ok('connect unpair succeeds', unpaired.code === 0, unpaired.stderr);

    const routes = [...new Set(ws.state.requests.map(r => r.url))].sort();
    ok('the CLI reached ingest, events, pair, poll, rotate and unpair', ['/api/connector/pair', '/api/connector/poll', '/api/connector/rotate', '/api/connector/unpair', '/api/events', '/api/ingest'].every(r => routes.includes(r)), routes.join(','));
    for (const route of routes) {
      const hits = ws.state.requests.filter(r => r.url === route);
      ok(`${route}: every request sends Boppi-Agent-Version ${VERSION} and user-agent boppi-cli/${VERSION}`, hits.length > 0 && hits.every(carriesVersion), JSON.stringify(hits.map(h => [h.headers['boppi-agent-version'], h.headers['user-agent']])));
    }
    const poll = ws.state.requests.find(r => r.url === '/api/connector/poll');
    ok('the poll body carries versions { scanner, engine, rubric } next to offers', poll && poll.body.versions && poll.body.versions.scanner === VERSION && typeof poll.body.versions.engine === 'string' && typeof poll.body.versions.rubric === 'string' && Array.isArray(poll.body.offers), poll && JSON.stringify(poll.body.versions));
    const authed = ws.state.requests.filter(r => r.url !== '/api/connector/pair');
    ok('authorization still travels where it did (the helper adds, never replaces)', authed.every(r => /^Bearer /.test(r.headers.authorization || '')) && !ws.state.requests.find(r => r.url === '/api/connector/pair').headers.authorization);

    section('Every connector route, through the one request helper');
    const seen = [];
    const fakeFetch = async (url, init) => { seen.push({ url, headers: init.headers }); return { ok: true, status: 200, headers: new Map(), json: async () => ({}) }; };
    for (const route of Object.keys(connect.ROUTES)) await connect.request({ url: 'https://w.example', credential: route === 'pair' ? null : 'bpd_x', route, body: {}, fetchImpl: fakeFetch });
    ok(`all ${Object.keys(connect.ROUTES).length} connector routes send the version header`, seen.length === Object.keys(connect.ROUTES).length && seen.every(s => s.headers['Boppi-Agent-Version'] === VERSION && s.headers['user-agent'] === `boppi-cli/${VERSION}`));

    section('HTTP 426 agent_outdated');
    ws.state.mode = 'outdated';
    const home2 = makeHome(root, 'home2');
    hook.append(home2, hook.toRecord({ hook_event_name: 'PreToolUse', tool_name: 'mcp__github__create_issue', session_id: 's1', tool_use_id: 'c1', tool_input: {} }, { now, fingerprint: () => 'path_0123456789abcdef' }), 30);
    const upgrade = `Run: npx boppi@${MINIMUM} (or install the current Agent from ${ws.url}/dashboard/get-agent).`;
    const p426 = await runCli(['push', '--url', ws.url, '--token', 'bpc_good'], home2);
    ok('push exits non-zero and prints the sentence and the upgrade line', p426.code === 5 && p426.stderr.includes(`Push rejected (HTTP 426): ${SENTENCE}`) && p426.stderr.includes(upgrade), p426.stderr);
    const e426 = await runCli(['events', 'push', '--url', ws.url, '--token', 'bpc_good'], home2);
    ok('events push exits non-zero and prints the sentence and the upgrade line', e426.code === 5 && e426.stderr.includes(SENTENCE) && e426.stderr.includes(upgrade), e426.stderr);
    const before = ws.state.requests.length;
    const c426 = await runCli(['connect', 'pair', '--url', ws.url, '--code', 'PAIRCODE2'], home2);
    ok('connect pair exits non-zero and prints the sentence and the upgrade line', c426.code === 5 && c426.stderr.includes('HTTP 426: agent_outdated') && c426.stderr.includes(SENTENCE) && c426.stderr.includes(upgrade), c426.stderr);
    ok('no 426 message tells anyone to npm install -g or use @latest', ![p426, e426, c426].some(r => /npm install -g|@latest/.test(r.stderr)));
    ok('the pair request carried the version so the workspace could refuse it first', carriesVersion(ws.state.requests[before]));

    ws.state.mode = 'ok';
    const home3 = makeHome(root, 'home3');
    ok('pairing for the run test', (await runCli(['connect', 'pair', '--url', ws.url, '--code', 'PAIRCODE3'], home3)).code === 0);
    ws.state.mode = 'outdated';
    const looped = await runCli(['connect', 'run', '--interval', '5'], home3, 60000);
    ok('a looping connect run stops with exit 5 instead of polling again', looped.code === 5 && looped.stderr.includes('requires a newer Agent') && looped.stderr.includes(upgrade), `code ${looped.code} signal ${looped.signal}: ${looped.stderr}`);

    section('Upgrade wording');
    ok('standalone executable: rerun the installer from the Get the Agent page', agentRequest.upgradeLine('https://w.example', '0.4.0', true) === 'Rerun the installer from https://w.example/dashboard/get-agent to replace this Agent.');
    ok('npm install: npx at the exact minimum', agentRequest.upgradeLine('https://w.example', '0.4.0', false).startsWith('Run: npx boppi@0.4.0 '));
    ok('a malformed minimum never becomes a command', agentRequest.upgradeLine('https://w.example', 'latest; rm -rf ~', false) === 'Install the current Agent from https://w.example/dashboard/get-agent.');
    ok('a 426 without agent_outdated is not described as outdated', agentRequest.describeOutdated({ status: 426, body: { error: 'other' } }) === null);
    ok('outside the executable isStandalone() is false', agentRequest.isStandalone() === false);
  } finally {
    await ws.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
