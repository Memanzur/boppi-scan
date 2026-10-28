#!/usr/bin/env node
/**
 * The offline update notice (D-6): the Agent learns the workspace's minimum
 * version from the Boppi-Agent-Minimum header on answers it already gets,
 * stores it per workspace, and prints the notice from that file on later
 * commands, including ones that make no request. It never changes an exit
 * code, never speaks from a hook, and never contacts any other host.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const updateNotice = require('../src/cli/updateNotice');
const { VERSION } = require('../src/cli/boppi');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home, env = {}, input = '') {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { env: { ...process.env, BOPPI_TOKEN: '', NO_UPDATE_NOTIFIER: '', BOPPI_NO_UPDATE_NOTICE: '', ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function makeHome(root, name) {
  const home = path.join(root, name);
  const dir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] } } }));
  return home;
}

/** A stand-in workspace; `answer.minimum` is the header to send (null sends none), `answer.status` the HTTP status. */
function startWorkspace(answer) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push(req.url);
      const headers = { 'content-type': 'application/json' };
      if (answer.minimum !== null) headers['boppi-agent-minimum'] = answer.minimum;
      res.writeHead(answer.status, headers);
      let records = 0;
      try { records = JSON.parse(body).records.length; } catch (_) { /* not an ingest body */ }
      res.end(JSON.stringify(answer.status === 200 ? { ingested: records, requestId: 'req-1' } : { error: 'invalid_request', requestId: 'req-2' }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(r => server.close(r)) })));
}

const noticeLines = text => text.split('\n').filter(line => line.startsWith('Update: '));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-update-notice-'));

  section('Version comparison');
  ok('0.4.0 is older than 0.5.0', updateNotice.isOlder('0.4.0', '0.5.0'));
  ok('0.10.0 is not older than 0.9.0 (numeric, not text, order)', !updateNotice.isOlder('0.10.0', '0.9.0'));
  ok('equal versions are not older', !updateNotice.isOlder('0.4.0', '0.4.0'));
  ok('a prerelease of the minimum is older', updateNotice.isOlder('0.4.0-rc.1', '0.4.0'));
  ok('build metadata alone is not a prerelease', !updateNotice.isOlder('0.4.0+build.7', '0.4.0'));
  ok('an unreadable installed version never asks for an update', !updateNotice.isOlder('dev', '9.0.0'));
  ok('a range or tag is never a minimum', !updateNotice.isOlder('0.4.0', '>=1.0.0') && !updateNotice.isOlder('0.4.0', 'latest'));

  section('A push learns the minimum and the next offline command repeats it');
  const home = makeHome(root, 'home');
  const higher = await startWorkspace({ minimum: '9.0.0', status: 200 });
  const pushed = await runCli(['push', '--url', higher.url, '--token', 'bpc_good'], home);
  await higher.close();
  ok('the push itself succeeds with exit 0', pushed.code === 0, `exit ${pushed.code}: ${pushed.stderr}`);
  ok('the notice names the workspace, both versions and the command, once, on stderr', noticeLines(pushed.stderr).length === 1 && noticeLines(pushed.stderr)[0] === `Update: ${higher.url} asks for Boppi 9.0.0 or newer; this is ${VERSION}. Run: npm install -g boppi@latest`, pushed.stderr);
  ok('stdout carries no notice', !pushed.stdout.includes('Update: '));
  ok('only the ingest route was contacted', higher.requests.length > 0 && higher.requests.every(url => url === '/api/ingest'), higher.requests.join(','));
  const file = updateNotice.noticeFile(home);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok('the store keeps origin, minimum and time only', JSON.stringify(Object.keys(stored.workspaces)) === JSON.stringify([higher.url]) && JSON.stringify(Object.keys(stored.workspaces[higher.url]).sort()) === '["minimum","seenAt"]' && stored.workspaces[higher.url].minimum === '9.0.0');
  ok('the store is owner-only', (fs.statSync(file).mode & 0o777) === 0o600, (fs.statSync(file).mode & 0o777).toString(8));
  const offline = await runCli(['connect', 'status'], home);
  ok('an offline command (workspace gone) still shows the notice with its usual exit code', offline.code === 0 && noticeLines(offline.stderr).length === 1 && offline.stderr.includes('9.0.0'), offline.stderr);
  const quiet = await runCli(['connect', 'status'], home, { NO_UPDATE_NOTIFIER: '1' });
  ok('NO_UPDATE_NOTIFIER silences it', quiet.code === 0 && noticeLines(quiet.stderr).length === 0);
  const quietBoppi = await runCli(['connect', 'status'], home, { BOPPI_NO_UPDATE_NOTICE: '1' });
  ok('BOPPI_NO_UPDATE_NOTICE silences it', noticeLines(quietBoppi.stderr).length === 0);
  const hooked = await runCli(['hook'], home, {}, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__filesystem__read_file', tool_input: {} }));
  ok('a hook never prints the notice (Claude Code reads hook output)', !hooked.stderr.includes('Update: ') && !hooked.stdout.includes('Update: '), hooked.stderr);

  const eventsHome = makeHome(root, 'events-home');
  await runCli(['hook'], eventsHome, {}, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__filesystem__read_file', tool_input: {}, session_id: 's1' }));
  const activity = await startWorkspace({ minimum: '9.3.0', status: 200 });
  const sent = await runCli(['events', 'push', '--url', activity.url, '--token', 'bpc_good'], eventsHome);
  await activity.close();
  ok('events push records it from the activity route', sent.code === 0 && noticeLines(sent.stderr).length === 1 && sent.stderr.includes('9.3.0') && JSON.stringify(activity.requests) === '["/api/events"]', `exit ${sent.code}: ${sent.stdout}${sent.stderr} ${activity.requests}`);

  section('Refusals carry it too, and the exit code does not change');
  const refusing = await startWorkspace({ minimum: '9.1.0', status: 401 });
  const refused = await runCli(['push', '--url', refusing.url, '--token', 'bpc_old'], home);
  const plainRefusing = await startWorkspace({ minimum: null, status: 401 });
  const plainHome = makeHome(root, 'plain-home');
  const plainRefused = await runCli(['push', '--url', plainRefusing.url, '--token', 'bpc_old'], plainHome);
  await refusing.close();
  await plainRefusing.close();
  ok('a refused push exits exactly as it does without the header', refused.code === plainRefused.code && refused.code !== 0, `${refused.code} vs ${plainRefused.code}`);
  ok('the refusal still records and shows the newer minimum', noticeLines(refused.stderr).length === 1 && refused.stderr.includes('9.1.0'));
  ok('without any header there is no notice and no store', noticeLines(plainRefused.stderr).length === 0 && !fs.existsSync(updateNotice.noticeFile(plainHome)));

  section('The connector records it from pairing answers');
  const pairing = await startWorkspace({ minimum: '9.2.0', status: 400 });
  const pairHome = makeHome(root, 'pair-home');
  const paired = await runCli(['connect', 'pair', '--url', pairing.url, '--code', 'ABCD-EFGH'], pairHome);
  await pairing.close();
  ok('a refused pairing still records the minimum', paired.code !== 0 && noticeLines(paired.stderr).length === 1 && paired.stderr.includes('9.2.0'), `exit ${paired.code}: ${paired.stderr}`);
  ok('only the pairing route was contacted', JSON.stringify(pairing.requests) === '["/api/connector/pair"]', pairing.requests.join(','));

  section('It goes away when the workspace stops asking');
  const caughtUp = await startWorkspace({ minimum: VERSION, status: 200 });
  const updatedHome = makeHome(root, 'caught-up-home');
  fs.mkdirSync(path.dirname(updateNotice.noticeFile(updatedHome)), { recursive: true });
  fs.writeFileSync(updateNotice.noticeFile(updatedHome), JSON.stringify({ workspaces: { [caughtUp.url]: { minimum: '9.0.0', seenAt: '2026-10-01T00:00:00.000Z' } } }));
  const equal = await runCli(['push', '--url', caughtUp.url, '--token', 'bpc_good'], updatedHome);
  await caughtUp.close();
  ok('a minimum equal to this version replaces the old one and prints nothing', equal.code === 0 && noticeLines(equal.stderr).length === 0 && JSON.parse(fs.readFileSync(updateNotice.noticeFile(updatedHome), 'utf8')).workspaces[caughtUp.url].minimum === VERSION, equal.stderr);
  const silent = await startWorkspace({ minimum: null, status: 200 });
  updateNotice.observe(updatedHome, `${silent.url}/api/ingest`, { get: () => '9.0.0' });
  ok('setup: a stored notice for the silent workspace', updateNotice.pending(updatedHome, VERSION, {}) !== null);
  const dropped = await runCli(['push', '--url', silent.url, '--token', 'bpc_good'], updatedHome);
  await silent.close();
  ok('an answer without the header clears that workspace', noticeLines(dropped.stderr).length === 0 && !(silent.url in JSON.parse(fs.readFileSync(updateNotice.noticeFile(updatedHome), 'utf8')).workspaces), dropped.stderr);

  section('Malformed values and broken stores change nothing');
  const odd = path.join(root, 'odd-home');
  updateNotice.observe(odd, 'https://w.example/api/ingest', { get: () => '9.0.0' });
  for (const bad of ['latest', '>=10.0.0', '10.0.0; rm -rf ~', '10.0', '\u001b[31m10.0.0']) updateNotice.observe(odd, 'https://w.example/api/ingest', { get: () => bad });
  ok('a malformed header keeps the last valid minimum', JSON.parse(fs.readFileSync(updateNotice.noticeFile(odd), 'utf8')).workspaces['https://w.example'].minimum === '9.0.0');
  updateNotice.observe(odd, 'https://other.example/api/connector/poll', { get: () => '11.0.0' });
  ok('with several workspaces the highest minimum wins', /other\.example asks for Boppi 11\.0\.0/.test(updateNotice.pending(odd, VERSION, {})));
  fs.writeFileSync(updateNotice.noticeFile(odd), '{not json');
  ok('a corrupt store means no notice, not a crash', updateNotice.pending(odd, VERSION, {}) === null);
  const corrupt = await runCli(['connect', 'status'], odd);
  ok('a command with a corrupt store keeps its exit code', corrupt.code === 0 && !corrupt.stderr.includes('unexpected error'));
  const readOnly = path.join(root, 'read-only-home');
  fs.mkdirSync(readOnly);
  fs.chmodSync(readOnly, 0o500);
  let threw = false;
  const answer = { headers: { get: () => '9.0.0' } };
  try { await updateNotice.watching(readOnly, async () => answer)('https://w.example/api/ingest', {}); } catch (_) { threw = true; }
  fs.chmodSync(readOnly, 0o700);
  ok('a read-only home does not fail the request', !threw);

  section('No other host');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'updateNotice.js'), 'utf8');
  ok('the notice module makes no request of its own', !/fetch\s*\(|require\('(https?|net|dns)'\)/.test(source.replace(/fetchImpl\(/g, '')));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
