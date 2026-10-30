#!/usr/bin/env node
/** Verify suite for scan-to-scan changes: paths compare by exposure key, and a widened grant reads as a more severe path, not as churn. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-history-severity-'));
try {
  const home = path.join(root, 'home');
  const config = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const historyFile = path.join(root, 'history.json');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.mkdirSync(path.join(home, 'docs'));
  const write = dir => fs.writeFileSync(config, JSON.stringify({ mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', dir] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  } }));
  const scan = () => spawnSync(process.execPath, [CLI, 'scan', '--home', home, '--cwd', home, '--no-color', '--history-file', historyFile], { encoding: 'utf8' }).stdout;
  const latest = () => JSON.parse(fs.readFileSync(historyFile, 'utf8')).at(-1);

  write(path.join(home, 'docs'));
  scan();
  const first = latest();
  ok('history records each exposure key with its severity', Object.keys(first.keySeverities).length === first.exposureKeys.length && first.exposureKeys.length > 0);

  write(home);
  const out = scan();
  const widened = latest().changes;
  ok('widening a directory grant reports no new and no resolved path', widened.newPaths === 0 && widened.resolvedPaths === 0);
  ok('widening a directory grant reports one more severe path', widened.moreSevere === 1 && widened.lessSevere === 0);
  ok('the terminal report says the path became more severe', /0 new exposure paths · 0 resolved\/no longer present · 1 more severe/.test(out));

  write(path.join(home, 'docs'));
  scan();
  ok('narrowing it again reports one less severe path', latest().changes.lessSevere === 1 && latest().changes.moreSevere === 0);

  fs.writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } } }));
  scan();
  const removed = latest().changes;
  ok('removing the servers behind a path reports it resolved', removed.resolvedPaths > 0 && removed.newPaths === 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
