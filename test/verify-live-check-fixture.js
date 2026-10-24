#!/usr/bin/env node
/** The live-check fixture answers tools/call with the three outcomes the hook collector must distinguish. */
'use strict';
const path = require('path');
const { spawn } = require('child_process');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }

function session() {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'mcp-servers', 'live-check.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LIVE_CHECK_DELAY_MS: '300' } });
  const pending = new Map();
  let buffer = '', nextId = 1;
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let parsed; try { parsed = JSON.parse(line); } catch { continue; }
      const res = pending.get(parsed.id);
      if (res) { pending.delete(parsed.id); res(parsed); }
    }
  });
  const request = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n'); });
  const notify = method => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { request, notify, stop: () => child.kill(), close: () => new Promise(res => { child.on('exit', res); child.stdin.end(); }) };
}

(async function main() {
  const s = session();
  const watchdog = setTimeout(() => {
    console.error('Live-check fixture did not finish within 10 seconds.');
    s.stop();
    process.exitCode = 1;
  }, 10000);
  const init = await s.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verify', version: '0' } });
  ok('initialize names the fixture', init.result && init.result.serverInfo.name === 'live-check');
  s.notify('notifications/initialized');
  const list = await s.request('tools/list');
  ok('tools/list offers ok_tool, error_tool, slow_tool and nothing else', list.result && list.result.tools.map(t => t.name).join(',') === 'ok_tool,error_tool,slow_tool');
  const okCall = await s.request('tools/call', { name: 'ok_tool', arguments: {} });
  ok('ok_tool returns a result without isError', okCall.result && okCall.result.isError === undefined && /ran/.test(okCall.result.content[0].text));
  const errCall = await s.request('tools/call', { name: 'error_tool', arguments: {} });
  ok('error_tool returns a result with isError true', errCall.result && errCall.result.isError === true);
  const started = Date.now();
  const slow = await s.request('tools/call', { name: 'slow_tool', arguments: {} });
  ok('slow_tool answers after the configured delay', slow.result && Date.now() - started >= 250);
  const unknown = await s.request('tools/call', { name: 'nope', arguments: {} });
  ok('an unknown tool is a JSON-RPC error, not a result', unknown.error && unknown.error.code === -32602);
  const code = await s.close();
  ok('the fixture exits when stdin closes', code === 0);
  clearTimeout(watchdog);
  console.log(`\nLive-check fixture: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
