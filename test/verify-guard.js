#!/usr/bin/env node
/** boppi guard runs a command only when the policy passes, and never through a shell. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const SECRET = 'sk-ant-guardplaintextvalue123456';
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')], env: { OPENAI_API_KEY: SECRET } },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  return home;
}

function runCli(args, home, cwd, extraEnv = {}) {
  const separator = args.indexOf('--');
  const head = separator === -1 ? args : args.slice(0, separator);
  const tail = separator === -1 ? [] : args.slice(separator);
  return spawnSync(process.execPath, [CLI, ...head, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json'), ...tail], {
    encoding: 'utf8',
    env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', ...extraEnv },
  });
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-guard-'));
  const home = makeHome(root);
  const cwd = path.join(root, 'project');
  fs.mkdirSync(cwd, { recursive: true });
  const marker = path.join(root, 'ran.txt');
  const command = [process.execPath, '-e', 'require("fs").writeFileSync(process.env.BOPPI_GUARD_MARKER, "ran"); process.exit(7)'];

  section('help and arguments');
  const help = runCli(['guard', '--help'], home, cwd);
  ok('guard --help exits 0 and names the wrapper', help.status === 0 && help.stdout.includes('boppi guard -- <command>') && help.stdout.includes('policy guard passes'));
  const bare = runCli(['guard'], home, cwd);
  ok('guard without a policy exits 2 and does not scan as a success', bare.status === 2 && /requires a policy/.test(bare.stderr) && !fs.existsSync(marker));
  const empty = runCli(['guard', '--policy', path.join(cwd, 'missing.json'), '--'], home, cwd);
  ok('guard -- with no command exits 2', empty.status === 2 && /requires a command/.test(empty.stderr));
  const scanDash = runCli(['scan', '--', 'echo'], home, cwd);
  ok('-- is rejected on scan', scanDash.status === 2 && /only valid with boppi guard/.test(scanDash.stderr));

  section('a failing policy does not run the command');
  const deny = path.join(cwd, 'deny.json');
  fs.writeFileSync(deny, JSON.stringify({ denyServers: ['filesystem'] }));
  const blocked = runCli(['guard', '--policy', deny, '--', ...command], home, cwd, { BOPPI_GUARD_MARKER: marker });
  ok('a denied server exits 1', blocked.status === 1 && blocked.stdout.includes('POL-DENY-SERVER') && blocked.stderr.includes('was not run'));
  ok('the wrapped command did not run', !fs.existsSync(marker));
  ok('the planted secret value is not printed', !blocked.stdout.includes(SECRET) && !blocked.stderr.includes(SECRET));

  section('a passing policy runs the command');
  const allow = path.join(cwd, 'allow.json');
  fs.writeFileSync(allow, JSON.stringify({ allowServers: ['filesystem', 'fetch', 'mcp-server'] }));
  const allowed = runCli(['guard', '--policy', allow, '--', ...command], home, cwd, { BOPPI_GUARD_MARKER: marker });
  ok('the command exit code is returned', allowed.status === 7);
  ok('the command ran after the guard passed', fs.readFileSync(marker, 'utf8') === 'ran' && allowed.stdout.includes('POLICY  passed'));

  section('dry-run does not run the command');
  fs.rmSync(marker);
  const dry = runCli(['guard', '--dry-run', '--policy', allow, '--', ...command], home, cwd, { BOPPI_GUARD_MARKER: marker });
  ok('dry-run exits 0 and names the command', dry.status === 0 && dry.stdout.includes('Would run:') && dry.stdout.includes(process.execPath));
  ok('dry-run does not run the command', !fs.existsSync(marker));

  section('a check with no wrapped command');
  const check = runCli(['guard', '--policy', allow], home, cwd);
  ok('a passing guard with no command exits 0', check.status === 0 && check.stdout.includes('No command was wrapped'));

  section('an incomplete scan does not run the command');
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-guard-broken-'));
  const brokenHome = path.join(brokenRoot, 'home');
  const brokenCwd = path.join(brokenRoot, 'project');
  const brokenConfigDir = path.join(brokenHome, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(brokenConfigDir, { recursive: true });
  fs.mkdirSync(brokenCwd, { recursive: true });
  const brokenConfig = path.join(brokenConfigDir, 'claude_desktop_config.json');
  const brokenMarker = path.join(brokenRoot, 'ran.txt');
  const brokenDeny = path.join(brokenCwd, 'deny.json');
  fs.writeFileSync(brokenDeny, JSON.stringify({ denyServers: ['filesystem'] }));
  const wrapped = [process.execPath, '-e', 'require("fs").writeFileSync(process.env.BOPPI_GUARD_MARKER, "ran")'];

  function makeUnreadable(file) {
    fs.writeFileSync(file, JSON.stringify({
      mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', brokenHome] } },
    }));
    fs.chmodSync(file, 0o000);
    try {
      fs.readFileSync(file);
      fs.chmodSync(file, 0o644);
      fs.rmSync(file);
      fs.mkdirSync(file);
    } catch (error) {
      if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    }
  }
  function restoreConfig(file) {
    try { fs.chmodSync(file, 0o644); } catch (_) { /* a directory has no mode we need */ }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) fs.rmdirSync(file);
  }

  makeUnreadable(brokenConfig);
  const unreadable = runCli(['guard', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  ok('an unreadable config exits 4 and does not run the command', unreadable.status === 4 && /Scan incomplete:/.test(unreadable.stderr) && unreadable.stderr.includes('Claude Desktop') && !fs.existsSync(brokenMarker) && !unreadable.stdout.includes('POLICY  passed') && !unreadable.stdout.includes('Would run:'));
  restoreConfig(brokenConfig);

  fs.writeFileSync(brokenConfig, '{ not json');
  const malformed = runCli(['guard', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  ok('malformed JSON exits 4 and does not run the command', malformed.status === 4 && /Scan incomplete:/.test(malformed.stderr) && malformed.stderr.includes('Claude Desktop') && !fs.existsSync(brokenMarker) && !malformed.stdout.includes('POLICY  passed'));

  fs.writeFileSync(brokenConfig, '{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] } ');
  const deniedBroken = runCli(['guard', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  const deniedScan = runCli(['scan', '--policy', brokenDeny, '--quiet'], brokenHome, brokenCwd);
  ok('a denied server inside a broken config exits 4 and does not run the command', deniedBroken.status === 4 && deniedScan.status === 4 && /Scan incomplete:/.test(deniedBroken.stderr) && !fs.existsSync(brokenMarker) && !deniedBroken.stdout.includes('POLICY  passed') && !deniedBroken.stdout.includes('RAN'));
  const dryBroken = runCli(['guard', '--dry-run', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  ok('dry-run on an incomplete scan exits 4 and does not run the command', dryBroken.status === 4 && !fs.existsSync(brokenMarker) && !dryBroken.stdout.includes('Would run:') && /Scan incomplete:/.test(dryBroken.stderr));

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(brokenRoot, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
