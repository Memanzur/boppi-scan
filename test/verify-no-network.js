#!/usr/bin/env node
/** Every command except a real push must run with no socket, DNS lookup, fetch, or child process. Proven by preloading hooks that record and refuse each attempt. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }

const PRELOAD = `
'use strict';
const fs = require('fs');
const log = process.env.BOPPI_NET_LOG;
function refuse(kind) { fs.appendFileSync(log, kind + '\\n'); throw new Error('network attempt (' + kind + ') blocked by verify-no-network'); }
const net = require('net');
net.Socket.prototype.connect = function () { refuse('net.Socket.connect'); };
const dns = require('dns');
dns.lookup = function () { refuse('dns.lookup'); };
if (dns.promises) dns.promises.lookup = async function () { refuse('dns.promises.lookup'); };
for (const mod of ['http', 'https']) { const m = require(mod); m.request = function () { refuse(mod + '.request'); }; m.get = function () { refuse(mod + '.get'); }; }
globalThis.fetch = async function () { refuse('fetch'); };
const cp = require('child_process');
for (const fn of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) cp[fn] = function () { refuse('child_process.' + fn); };
`;

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      shell: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } } }));
  return home;
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-no-network-'));
  const home = makeHome(root);
  const preload = path.join(root, 'preload.js');
  fs.writeFileSync(preload, PRELOAD);
  const log = path.join(root, 'attempts.log');
  const history = path.join(root, 'history.json');
  const exportPath = path.join(root, 'export.json');

  function run(args, extraEnv = {}, input) {
    fs.writeFileSync(log, '');
    const result = spawnSync(process.execPath, ['--require', preload, CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', history], {
      encoding: 'utf8', input, env: { ...process.env, BOPPI_NET_LOG: log, BOPPI_SCAN_PLATFORM: 'darwin', ...extraEnv },
    });
    return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '', attempts: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
  }

  const scan = run(['scan', '--json', exportPath, '--html', path.join(root, 'report.html')]);
  ok('scan completes with the hooks installed', scan.code === 0 && scan.stdout.includes('INVENTORY'));
  ok('scan opens no socket, DNS lookup, or fetch', scan.attempts.length === 0);
  ok('scan still finds exposure paths, so the hooks did not disable the engine', /\d+ exposure paths? \(\d+ critical\)/.test(scan.stdout) && !scan.stdout.includes('0 exposure paths'));

  for (const command of ['agents', 'paths', 'history']) {
    const result = run([command]);
    ok(`${command} exits 0 with no network attempt`, result.code === 0 && result.attempts.length === 0);
  }

  const verify = run(['verify', exportPath]);
  ok('verify rescans with no network attempt', verify.code === 0 && verify.attempts.length === 0);

  const dry = run(['push', '--dry-run', '--url', 'http://127.0.0.1:1']);
  ok('push --dry-run prints the payload and makes no network attempt', dry.code === 0 && dry.stdout.includes('"records"') && dry.attempts.length === 0);
  for (const args of [['plan', '--diff'], ['demo', '--html', path.join(root, 'demo.html')], ['settings'], ['hook', '--print-config']]) {
    const result = run(args);
    ok(`${args[0]} runs without network access`, result.code === 0 && result.attempts.length === 0);
  }
  const captured = run(['hook'], {}, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__fetch__fetch', tool_input: 'PRIVATE INPUT' }));
  ok('actual hook capture uses no network and writes no stdout', captured.code === 0 && captured.attempts.length === 0 && captured.stdout === '');
  const fixed = run(['fix', '--server', 'fetch', '--yes']);
  ok('supported local fix uses no network', fixed.code === 0 && fixed.attempts.length === 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(home, '.boppi', 'backups', 'index.json'), 'utf8'));
  const restored = run(['rollback', '--id', manifest.entries[0].id, '--yes']);
  ok('supported rollback uses no network', restored.code === 0 && restored.attempts.length === 0);

  const real = run(['push', '--token', 'bpc_test_token_value', '--url', 'http://127.0.0.1:1']);
  ok('a real push does reach the network hook, so the hooks are live (positive control)', real.attempts.length > 0 && real.attempts.every(a => a === 'fetch'));
  ok('a real push is the only command that attempted the network', real.code !== 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
