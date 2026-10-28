#!/usr/bin/env node
/** boppi events push: whitelisted metadata, explicit send, honest result lines, and no network in --dry-run. Drives the real CLI against an in-process HTTP mock. */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const hook = require('../src/cli/hook');
const events = require('../src/cli/events');

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const fingerprint = () => 'path_0123456789abcdef';
const now = new Date().toISOString();

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-events-push-'));
  const payload = { hook_event_name: 'PreToolUse', tool_name: 'mcp__github__create_issue', session_id: 'session-1', tool_use_id: 'call-1', cwd: '/Users/someone/project', mcp_server: { source: 'project' }, tool_input: { command: 'rm -rf /' } };
  hook.append(home, hook.toRecord(payload, { now, fingerprint }), 30);
  hook.append(home, hook.toRecord({ ...payload, hook_event_name: 'PostToolUse', duration_ms: 120, tool_response: { ok: true } }, { now, fingerprint }), 30);
  hook.append(home, { schema: 2, id: 'not-a-digest', at: now, event: 'PreToolUse', kind: 'mcp', server: 's', tool: 't', outcome: 'invoked', extraKey: 'planted' }, 30);

  const { events: entries, skipped } = events.toPayload(events.readEvents(home, { sinceDays: 30 }).records);
  ok('two well-formed records become payload entries; the malformed id is skipped', entries.length === 2 && skipped === 1);
  ok('every entry carries only the push keys', entries.every(e => Object.keys(e).every(k => events.PUSH_KEYS.includes(k))));
  const text = JSON.stringify(entries);
  ok('no path, tool input or raw session id is in the payload', !text.includes('/Users') && !text.includes('rm -rf') && !text.includes('session-1') && !text.includes('call-1'));
  ok('the payload keeps server, tool, outcome and duration', entries[1].server === 'github' && entries[1].tool === 'create_issue' && entries[1].outcome === 'ok' && entries[1].durationMs === 120);

  const received = [];
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      if (mode === 'unconsented') { res.writeHead(403); res.end(JSON.stringify({ error: 'This collector has no activity sync consent.', code: 'events_consent_required', requestId: 'req-1' })); return; }
      if (mode === 'bad') { res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid or revoked collector token.', requestId: 'req-2' })); return; }
      res.end(JSON.stringify({ accepted: 1, received: received[received.length - 1].body.events.length, requestId: 'req-3' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  /** Async so the in-process mock can answer while the CLI runs. stdin is closed: no terminal, no prompt. */
  const exec = (args, env = {}) => new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, BOPPI_TOKEN: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const run = args => exec([...args, '--home', home]);

  const dry = await run(['events', 'push', '--dry-run', '--url', url]);
  ok('--dry-run prints the payload and the destination without sending', dry.status === 0 && received.length === 0 && dry.stdout.includes('"events"') && dry.stderr.includes('nothing was sent'));
  ok('--dry-run output names the skipped record count', JSON.parse(dry.stdout).skipped === 1);

  const sent = await run(['events', 'push', '--url', url, '--token', 'bpc_test_token']);
  ok('a real push posts to /api/events with the bearer token', received.length === 1 && received[0].url === '/api/events' && received[0].auth === 'Bearer bpc_test_token');
  ok('the request body is exactly { events }', Object.keys(received[0].body).join() === 'events' && received[0].body.events.length === 2);
  ok('the result line reports sent, new and already-there counts and where to review', sent.status === 0 && sent.stdout.includes('sent 2 events') && sent.stdout.includes('1 new, 1 already there') && sent.stdout.includes('Activity page'));

  mode = 'unconsented';
  const refused = await run(['events', 'push', '--url', url, '--token', 'bpc_test_token']);
  ok('a 403 without consent exits 5 and explains who can allow activity sync', refused.status === 5 && refused.stderr.includes('HTTP 403') && refused.stderr.includes('Collectors page') && refused.stderr.includes('inventory sync consent does not cover activity'));
  mode = 'bad';
  const rejected = await run(['events', 'push', '--url', url, '--token', 'bpc_test_token']);
  ok('a rejected token exits 5 with the token hint', rejected.status === 5 && rejected.stderr.includes('HTTP 401') && rejected.stderr.includes('Collectors page'));

  const noToken = await run(['events', 'push', '--url', url]);
  ok('without a terminal or token the command refuses before any network', noToken.status === 2 && noToken.stderr.includes('events push needs a collector token'));

  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-events-empty-'));
  const empty = await exec(['events', 'push', '--url', url, '--token', 'x', '--home', emptyHome]);
  ok('a home with no events sends nothing and says so', empty.status === 0 && empty.stdout.includes('nothing to send') && received.length === 3);

  const badUrl = await run(['events', 'push', '--dry-run', '--url', 'http://example.com']);
  ok('a non-local http URL is refused like push', badUrl.status === 2 && badUrl.stderr.includes('https'));
  ok('the events URL is derived from the workspace origin', events.eventsUrl('https://app.boppi.io/api/ingest').toString() === 'https://app.boppi.io/api/events');

  server.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(emptyHome, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
