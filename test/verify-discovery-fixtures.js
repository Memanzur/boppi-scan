#!/usr/bin/env node
/**
 * Drives each synthetic stdio MCP fixture with a test-only client (initialize,
 * initialized, paged tools/list) and freezes the projection Boppi would keep.
 * BOPPI_FREEZE=1 rewrites the expected files; otherwise they must match.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const projection = require('../src/cli/discovery/projection');
const { createRecorder, ALLOWED_METHODS } = require('../src/cli/discovery/recorder');

const DIR = path.join(__dirname, 'fixtures', 'mcp-servers');
const EXPECTED = path.join(DIR, 'expected');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }

/** Test-only driver: the smallest client that can exercise a fixture. The product session (P3-3) replaces it. */
function drive(fixture, args = [], options = {}) {
  return new Promise(resolve => {
    const recorder = createRecorder();
    const child = spawn(process.execPath, [path.join(DIR, `${fixture}.js`), ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
    const pages = [];
    const events = [];
    let nextId = 1, pending = new Map(), buffer = '', stderr = '', partial = null, done = false, exitCode = null;
    const timer = setTimeout(() => finish('timeout'), options.timeoutMs || 3000);
    const send = message => { recorder.sent(message); child.stdin.write(JSON.stringify(message) + '\n'); };
    const request = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }); });
    function finish(reason) {
      if (done) return; done = true; clearTimeout(timer);
      if (reason === 'timeout') { partial = 'timeout'; for (const id of pending.keys()) send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }); }
      child.stdin.end();
      const kill = setTimeout(() => child.kill('SIGTERM'), 300);
      child.on('exit', code => { clearTimeout(kill); exitCode = code; resolve({ pages, events, recorder, stderr, partial, exitCode, init: events.find(e => e.kind === 'initialize') }); });
    }
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (Buffer.byteLength(line) > projection.LIMITS.lineBytes) { recorder.receivedLine(line, null); events.push({ kind: 'oversized-line' }); continue; }
        let parsed = null;
        try { parsed = JSON.parse(line); } catch { parsed = null; }
        recorder.receivedLine(line, parsed);
        if (!parsed || typeof parsed !== 'object') continue;
        if (parsed.method && parsed.id === undefined) { events.push({ kind: 'notification', method: parsed.method }); continue; }
        const res = pending.get(parsed.id);
        if (res) { pending.delete(parsed.id); res(parsed); }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', () => finish('error'));
    (async () => {
      const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'boppi-discovery-test', version: '0' } });
      events.push({ kind: 'initialize', result: init.result || null, error: init.error || null });
      if (init.error) return finish('rejected');
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      let cursor;
      for (let page = 0; page < projection.LIMITS.pages; page += 1) {
        const reply = await request('tools/list', cursor ? { cursor } : undefined);
        if (reply.error) { events.push({ kind: 'list-error', code: reply.error.code }); break; }
        pages.push(reply.result);
        if (options.relistOnChange) await new Promise(r => setTimeout(r, 50));
        if (options.relistOnChange && events.some(e => e.method === 'notifications/tools/list_changed') && !options.relisted) { options.relisted = true; cursor = undefined; continue; }
        cursor = reply.result && reply.result.nextCursor;
        if (!cursor) break;
      }
      finish('done');
    })();
  });
}

function projectionOf(run) {
  const init = run.init ? (run.init.error ? { accepted: false, reason: `initialize error ${run.init.error.code}: ${projection.cleanText(run.init.error.message, 80)}` } : projection.projectInitialize(run.init.result)) : { accepted: false, reason: 'no initialize result' };
  const list = projection.projectToolList(run.pages, { partial: run.partial });
  return { initialize: init, list, notifications: run.recorder.dump().received.notifications, listError: run.events.find(e => e.kind === 'list-error') ? run.events.find(e => e.kind === 'list-error').code : null, oversizedLines: run.events.filter(e => e.kind === 'oversized-line').length, ignoredLines: run.recorder.dump().received.ignored };
}

function compare(name, actual) {
  const file = path.join(EXPECTED, `${name}.json`);
  const text = JSON.stringify(actual, null, 2) + '\n';
  if (process.env.BOPPI_FREEZE) { fs.writeFileSync(file, text); ok(`${name}: projection frozen`, true); return; }
  ok(`${name}: projection matches the frozen expectation`, fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text, fs.existsSync(file) ? 'differs' : 'missing');
}

(async function main() {
  const canary = ['ghp_secretvalue_1234567890', '/Users/someone/.ssh/id_rsa', 'rm -rf /', 'alert(1)', 'ignore previous instructions', 'Ignore all previous instructions'];

  const paged = await drive('paged');
  const pagedView = projectionOf(paged);
  ok('paged: three pages and 40 tools, two with reach-table names', pagedView.list.counts.pages === 3 && pagedView.list.counts.kept === 40 && pagedView.list.tools.some(t => t.name === 'push_files') && pagedView.list.tools.some(t => t.name === 'get_file_contents'));
  ok('paged: parameter names become hints, never values', pagedView.list.tools[0].parameterHints.join() === 'path' && !JSON.stringify(pagedView).includes('"main"'));
  compare('paged', pagedView);

  const changed = await drive('list-changed', [], { relistOnChange: true });
  const changedView = projectionOf(changed);
  ok('list-changed: the notification is recorded and the relisted page carries the new tool', changedView.notifications.includes('notifications/tools/list_changed') && changedView.initialize.listChanged === true && changedView.list.tools.some(t => t.name === 'kubectl_apply'));
  compare('list-changed', changedView);

  const none = await drive('no-tools');
  const noneView = projectionOf(none);
  ok('no-tools: tools capability with an empty list, and instructions are dropped', noneView.initialize.toolsCapability === true && noneView.list.counts.kept === 0 && !JSON.stringify(noneView).includes('helpful assistant'));
  compare('no-tools', noneView);

  const malformed = await drive('malformed');
  const malformedView = projectionOf(malformed);
  ok('malformed: non-JSON lines are ignored and counted', malformedView.ignoredLines === 2 && malformedView.initialize.accepted === true);
  ok('malformed: bad names, missing names, non-objects, and bad schemas are rejected with reasons; a duplicate is flagged', malformedView.list.counts.rejected === 3 && malformedView.list.counts.duplicates === 1 && malformedView.list.tools.find(t => t.name === 'read_file').inputSchemaValid === false && malformedView.list.tools.find(t => t.name === 'search_code').inputSchemaValid === false);
  compare('malformed', malformedView);

  const oversized = await drive('oversized');
  const oversizedView = projectionOf(oversized);
  ok('oversized: a line over the bound is dropped, and only the first 500 tools of a page are kept, with a reason', oversizedView.oversizedLines === 1 && oversizedView.list.counts.kept === 500 && oversizedView.list.rejected.some(r => /2000 tools/.test(r.reason)));
  compare('oversized', oversizedView);

  const timeout = await drive('timeout', [], { timeoutMs: 400 });
  const timeoutView = projectionOf(timeout);
  ok('timeout: the pending tools/list is cancelled, the result is partial, and the server exits on stdin close', timeoutView.list.partial === true && timeout.recorder.methods().includes('notifications/cancelled') && /cancelled/.test(timeout.stderr) && timeout.exitCode === 0);
  compare('timeout', timeoutView);

  const rejectedVersion = await drive('auth-rejection', ['version']);
  const rejectedVersionView = projectionOf(rejectedVersion);
  ok('auth-rejection (version): an initialize error ends the session before any tools/list', rejectedVersionView.initialize.accepted === false && /initialize error -32602/.test(rejectedVersionView.initialize.reason) && !rejectedVersion.recorder.methods().includes('tools/list'));
  compare('auth-rejection-version', rejectedVersionView);
  const rejectedList = await drive('auth-rejection', ['list']);
  const rejectedListView = projectionOf(rejectedList);
  ok('auth-rejection (list): a tools/list error is recorded with its code and yields no tools', rejectedListView.listError === -32001 && rejectedListView.list.counts.kept === 0);
  compare('auth-rejection-list', rejectedListView);

  const hostile = await drive('hostile');
  const hostileView = projectionOf(hostile);
  const text = JSON.stringify(hostileView);
  ok('hostile: escape sequences and control characters are stripped from names and descriptions', !/\u001b|\u0007/.test(text) && hostileView.initialize.serverInfo.name === 'hostile-fixture');
  ok('hostile: schema defaults, examples, and consts never reach the projection', canary.slice(0, 3).every(c => !text.includes(c)));
  ok('hostile: markup is kept as inert text in a title, never rendered', hostileView.initialize.serverInfo.title === '<script>alert(1)</script>');
  ok('hostile: descriptions are truncated to the limit', hostileView.list.tools.find(t => t.name === 'get_file_contents').description.length <= projection.LIMITS.descriptionLength + 1);
  ok('hostile: a readOnlyHint is kept as an advertised annotation, not as a grade', hostileView.list.tools.find(t => t.name === 'delete_repository').annotations.readOnlyHint === true);
  ok('hostile: a schema nested past the depth bound is marked truncated', hostileView.list.tools.find(t => t.name === 'deep_schema').schemaTruncated === true);
  ok('hostile: credential-, path-, url-, and command-shaped parameter names become hints', hostileView.list.tools.find(t => t.name === 'get_file_contents').parameterHints.join() === 'command,credential,path,url');
  compare('hostile', hostileView);

  const runs = [paged, changed, none, malformed, oversized, timeout, rejectedVersion, rejectedList, hostile];
  ok('every session sent only initialize, initialized, tools/list, and cancelled', runs.every(r => r.recorder.violations().length === 0) && runs.every(r => r.recorder.methods().every(m => ALLOWED_METHODS.includes(m))));
  ok('no session ever sent tools/call', runs.every(r => !r.recorder.dump().sent.some(e => e.method === 'tools/call')));
  ok('every fixture process exited', runs.every(r => r.exitCode !== null));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
