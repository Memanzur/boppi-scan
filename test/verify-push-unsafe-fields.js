#!/usr/bin/env node
/**
 * push refuses a body that could carry a secret (QA-003). An export edited by
 * hand can put a token where boppi wrote an id, a name or an envelope value;
 * the re-sanitizers cover names and metadata, and this guard covers every id
 * and every outgoing string and key. A planted synthetic token in any of them
 * stops push --file before a dry run prints the body or a request is made,
 * and the refusal names the field, never the value. Unedited exports and live
 * scans still push.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const TOKEN = `ghp_${'A1b2C3d4'.repeat(4)}Zz99`; // synthetic, GitHub-shaped
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-push-unsafe-')));
const home = path.join(root, 'home');
fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
fs.mkdirSync(path.join(home, 'docs'));
fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
  files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
} }));
const env = { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_TOKEN: 'bpc_synthetic_test_token_value_0000' };
const cli = args => spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', env });
const exportFile = path.join(root, 'scan.json');
cli(['scan', '--json', exportFile]);
const original = JSON.parse(fs.readFileSync(exportFile, 'utf8'));

const real = doc => doc.inventory.real;
const PLANTS = {
  'agent id': doc => { real(doc).agents[0].id = TOKEN; },
  'MCP server id': doc => { real(doc).mcpServers[0].id = TOKEN; },
  'permission id': doc => { real(doc).permissions[0].id = TOKEN; },
  'a server\'s agent reference': doc => { real(doc).mcpServers[0].agentId = TOKEN; },
  'a permission\'s server reference': doc => { real(doc).permissions[0].integrationId = TOKEN; },
  'a permission attribute key': doc => { real(doc).permissions[0].attributes = { [TOKEN]: 'x' }; },
  'built-in residual agent id': doc => { doc.builtinResidual = [{ agentId: TOKEN, clientKey: 'cursor', exposureKeys: ['EP-A:x'], tools: ['Bash'] }]; },
  'built-in residual exposure key': doc => { doc.builtinResidual = [{ agentId: real(doc).agents[0].id, clientKey: 'cursor', exposureKeys: [`EP-A:${TOKEN}`], tools: ['Bash'] }]; },
};

section('a planted token in any id or outgoing field is refused before anything is printed');
for (const [label, plant] of Object.entries(PLANTS)) {
  const doc = JSON.parse(JSON.stringify(original));
  plant(doc);
  const file = path.join(root, `edited-${label.replace(/\W+/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = cli(['push', '--file', file, '--dry-run', '--url', 'http://127.0.0.1:9']);
  ok(`${label}: exit 2, refused, the token appears nowhere in the output`, r.status === 2 && r.stderr.includes('refused before sending') && !(r.stdout + r.stderr).includes(TOKEN.slice(4, 20)), `exit ${r.status}: ${r.stderr.trim().slice(0, 160)}`);
}

section('a token in a field the re-sanitizer already scrubs is redacted, not refused');
{
  const doc = JSON.parse(JSON.stringify(original));
  real(doc).mcpServers[0].exposedTools = [TOKEN];
  const file = path.join(root, 'edited-tool.json');
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = cli(['push', '--file', file, '--dry-run', '--url', 'http://127.0.0.1:9']);
  ok('a server tool name: exit 0 with the value redacted and the token absent', r.status === 0 && r.stdout.includes('[redacted-sensitive-value]') && !(r.stdout + r.stderr).includes(TOKEN.slice(4, 20)), `exit ${r.status}`);
}

section('controls');
{
  const r = cli(['push', '--file', exportFile, '--dry-run', '--url', 'http://127.0.0.1:9']);
  ok('the unedited export still maps (exit 0)', r.status === 0 && r.stdout.includes('Dry run:'), r.stderr.trim());
  const live = cli(['push', '--dry-run', '--url', 'http://127.0.0.1:9']);
  ok('a live scan still maps (exit 0)', live.status === 0 && live.stdout.includes('Dry run:'), live.stderr.trim());
}

section('a real push of an edited export makes no request');
(async () => {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ingested":0}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const doc = JSON.parse(JSON.stringify(original));
  PLANTS['agent id'](doc);
  const file = path.join(root, 'edited-send.json');
  fs.writeFileSync(file, JSON.stringify(doc));
  const run = args => new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { env });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
  const refused = await run(['push', '--file', file, '--url', url]);
  ok('exit 2 and the workspace received nothing', refused.code === 2 && requests === 0 && !refused.out.includes(TOKEN.slice(4, 20)), `exit ${refused.code}, ${requests} request(s)`);
  const sent = await run(['push', '--file', exportFile, '--url', url]);
  ok('control: the unedited export is sent', sent.code === 0 && requests >= 1, `exit ${sent.code}, ${requests} request(s)`);
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
