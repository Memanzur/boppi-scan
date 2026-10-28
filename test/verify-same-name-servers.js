#!/usr/bin/env node
/** A Claude Code server name used at user and local scope is two entries: both are scanned, and fix, rollback and the connector touch only the chosen one (T-3). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const fix = require('../src/cli/fix');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({
    numStartups: 3,
    mcpServers: {
      dup: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      'dup (local)': { command: 'uvx', args: ['mcp-server-time'] },
    },
    projects: { [home]: { allowedTools: ['Bash'], mcpServers: { dup: { command: 'uvx', args: ['mcp-server-fetch'], env: { FETCH_TOKEN: 'SUPERSECRETVALUE' } } } } },
  }, null, 2));
  return { home, file };
}

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--only', 'claude-code', '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-same-name-'));
  const { home, file } = makeHome(root);
  const original = fs.readFileSync(file, 'utf8');
  const descriptor = fix.descriptorsFor({ home, cwd: home, platform: 'darwin' }).find(d => d.clientKey === 'claude-code');

  section('discovery keeps every entry');
  {
    const { servers } = fix.readClient(descriptor, home);
    const byLabel = Object.fromEntries(servers.map(s => [s.label, s]));
    ok('three entries, three distinct labels', servers.length === 3 && new Set(servers.map(s => s.label)).size === 3);
    ok('the user entry keeps its name', byLabel.dup && JSON.stringify(byLabel.dup.keyPath) === JSON.stringify(['mcpServers', 'dup']));
    ok('a literal "dup (local)" at user scope keeps its own name', byLabel['dup (local)'] && JSON.stringify(byLabel['dup (local)'].keyPath) === JSON.stringify(['mcpServers', 'dup (local)']));
    ok('the local-scope collision gets a label that does not take an existing one', byLabel['dup (local 3)'] && JSON.stringify(byLabel['dup (local 3)'].keyPath) === JSON.stringify(['projects', home, 'mcpServers', 'dup']) && byLabel['dup (local 3)'].name === 'dup');
    const exportFile = path.join(root, 'scan.json');
    const scan = runCli(['scan', '--json', exportFile, '--quiet'], home);
    const names = fs.existsSync(exportFile) ? read(exportFile).inventory.real.mcpServers.map(s => s.name).sort() : [];
    ok('the scan export lists all three', scan.code !== null && JSON.stringify(names) === JSON.stringify(['dup', 'dup (local 3)', 'dup (local)']));
  }

  section('the preview shows only the chosen entry');
  {
    const preview = runCli(['fix', '--server', 'dup (local 3)'], home);
    ok('names the local-scope key path', preview.code === 2 && preview.stdout.includes(`projects[${JSON.stringify(home)}].mcpServers."dup"`));
    ok('does not name the user-scope key', !preview.stdout.includes('delete mcpServers."dup"') && !/^\s*mcpServers\."dup"/m.test(preview.stdout));
    ok('never prints the secret value', !preview.stdout.includes('SUPERSECRETVALUE') && !preview.stderr.includes('SUPERSECRETVALUE'));
    ok('changes nothing without approval', fs.readFileSync(file, 'utf8') === original);
  }

  section('fix removes exactly one entry and rollback restores it');
  {
    const applied = runCli(['fix', '--server', 'dup (local 3)', '--yes'], home);
    const after = read(file);
    ok('fix exits without error', applied.code === 0 || applied.code === 1);
    ok('the local-scope entry is gone', !Object.prototype.hasOwnProperty.call(after.projects[home].mcpServers, 'dup'));
    ok('both user-scope entries are untouched', JSON.stringify(after.mcpServers) === JSON.stringify(JSON.parse(original).mcpServers));
    ok('nothing else in the file changed', after.numStartups === 3 && JSON.stringify(after.projects[home].allowedTools) === '["Bash"]');
    const entry = read(path.join(home, '.boppi', 'backups', 'index.json')).entries.find(e => e.server === 'dup (local 3)');
    ok('the manifest records the exact key path', entry && JSON.stringify(entry.keyPath) === JSON.stringify(['projects', home, 'mcpServers', 'dup']));
    const restored = runCli(['rollback', '--id', entry.id, '--yes'], home);
    ok('rollback restores the original bytes', restored.code === 0 && fs.readFileSync(file, 'utf8') === original);
  }

  section('fixing the plain name leaves the local-scope entry');
  {
    runCli(['fix', '--server', 'dup', '--yes'], home);
    const after = read(file);
    ok('the user-scope "dup" is gone', !Object.prototype.hasOwnProperty.call(after.mcpServers, 'dup') && after.mcpServers['dup (local)']);
    ok('the local-scope "dup" is still there with its command', after.projects[home].mcpServers.dup && after.projects[home].mcpServers.dup.command === 'uvx');
  }

  section('a stale label refuses instead of hitting a different entry');
  {
    fs.writeFileSync(file, original);
    const located = fix.locateServer(descriptor, 'dup (local 3)', home);
    const changed = JSON.parse(original);
    delete changed.projects[home].mcpServers.dup;
    fs.writeFileSync(file, JSON.stringify(changed, null, 2));
    ok('the old label no longer resolves', fix.locateServer(descriptor, 'dup (local 3)', home) === null);
    ok('deleteAt on the stale key path reports nothing to delete', located && fix.deleteAt(changed, located.keyPath) === false);
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
