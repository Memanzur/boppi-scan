#!/usr/bin/env node
/** boppi plan compares every candidate fix without writing; boppi fix applies one removal with a backup and grades it. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root) {
  const home = path.join(root, 'home');
  const docs = path.join(home, 'docs');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    theme: 'keep-me',
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', docs] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      '1password': { command: 'npx', args: ['-y', '@1password/mcp'], env: { OP_TOKEN: 'SUPERSECRETVALUE' } },
      shell: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
    },
  }, null, 2));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    numStartups: 3,
    mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
    projects: { [home]: { mcpServers: { 'project-fetch': { command: 'uvx', args: ['mcp-server-fetch'] } }, allowedTools: ['Bash'] } },
  }, null, 2));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } } }, null, 2));
  return home;
}

function runCli(args, home, extra = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' }, ...extra });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-plan-fix-'));
  const home = makeHome(root);
  const desktopConfig = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

  section('plan');
  const plan = runCli(['plan', '--json', path.join(root, 'plan.json')], home);
  ok('plan exits 0 and prints the comparison table', plan.code === 0 && plan.stdout.includes('CANDIDATE FIXES') && plan.stdout.includes('agent loses'));
  ok('plan lists removals and moves with their counts', /remove "fetch" from Claude Desktop\s+\d+\/\d+/.test(plan.stdout) && /move "fetch" from Claude Desktop to (Claude Code|Cursor)/.test(plan.stdout));
  ok('plan names the file and key for each edit', plan.stdout.includes(`in ${desktopConfig}: delete the key mcpServers."fetch"`));
  ok('plan shows the smallest removal set', plan.stdout.includes('SMALLEST SET'));
  ok('plan writes the export and changes no config', fs.existsSync(path.join(root, 'plan.json')) && fs.readFileSync(desktopConfig, 'utf8').includes('"fetch"'));
  ok('plan never prints secret values', !plan.stdout.includes('SUPERSECRETVALUE'));

  section('fix refuses without approval');
  const original = fs.readFileSync(desktopConfig, 'utf8');
  const noYes = runCli(['fix', '--server', 'fetch'], home, { stdio: ['pipe', 'pipe', 'pipe'] });
  ok('fix without --yes and without a terminal exits 2 and changes nothing', noYes.code === 2 && noYes.stderr.includes('--yes') && fs.readFileSync(desktopConfig, 'utf8') === original);
  ok('fix previews the file, what breaks, and what the agent loses', noYes.stdout.includes(`file:    ${desktopConfig}`) && /breaks:\s+\d+ of \d+/.test(noYes.stdout) && noYes.stdout.includes('loses:'));
  const unknown = runCli(['fix', '--server', 'nope', '--yes'], home);
  ok('fix with an unknown server exits 2', unknown.code === 2 && unknown.stderr.includes('no scanned'));
  const ambiguous = runCli(['fix', '--server', 'fetch', '--client', 'beos', '--yes'], home);
  ok('fix with an unknown --client exits 2', ambiguous.code === 2);

  section('fix applies one removal and grades it');
  const applied = runCli(['fix', '--server', 'fetch', '--yes'], home);
  const after = JSON.parse(fs.readFileSync(desktopConfig, 'utf8'));
  ok('fix exits 0 when the prediction is CONFIRMED', applied.code === 0 && applied.stdout.includes('CONFIRMED'));
  ok('the server is gone and the rest of the file is intact', !after.mcpServers.fetch && after.mcpServers.filesystem && after.theme === 'keep-me');
  const backups = fs.readdirSync(path.join(home, '.boppi', 'backups')).filter(file => file.endsWith('.bak'));
  ok('a backup of the original file was written with owner-only permissions', backups.length === 1 && fs.readFileSync(path.join(home, '.boppi', 'backups', backups[0]), 'utf8') === original && (fs.statSync(path.join(home, '.boppi', 'backups', backups[0])).mode & 0o777) === 0o600);
  const exports = fs.readdirSync(home).filter(f => f.startsWith('boppi-fix-') && f.endsWith('.json'));
  ok('the predictions used were saved next to the scan for later verify runs', exports.length === 1 && Array.isArray(JSON.parse(fs.readFileSync(path.join(home, exports[0]), 'utf8')).predictions));
  ok('the fix output never prints secret values', !applied.stdout.includes('SUPERSECRETVALUE') && !applied.stderr.includes('SUPERSECRETVALUE'));

  section('fix reaches a project-scoped Claude Code server');
  const code = runCli(['fix', '--server', 'project-fetch', '--yes'], home);
  const claudeJson = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  ok('the project-scoped entry is removed from projects[cwd].mcpServers only', code.code === 0 && !claudeJson.projects[home].mcpServers['project-fetch'] && claudeJson.mcpServers.github && claudeJson.projects[home].allowedTools[0] === 'Bash' && claudeJson.numStartups === 3);

  section('fix on a server outside every path');
  const quiet = runCli(['fix', '--server', 'github', '--yes'], home);
  ok('a server with no modeled exposure can still be removed, and the output says nothing was modeled', quiet.code === 0 && quiet.stdout.includes('no exposure path'));

  section('history records verified reduction');
  const history = runCli(['history'], home);
  ok('history shows verified exposure reduction with the confirmed count', /VERIFIED EXPOSURE REDUCTION\s+\d+ exposure paths? confirmed eliminated/.test(history.stdout) && history.stdout.includes('verify ·'));
  const { verifiedReduction } = require('../src/cli/boppi');
  const entries = JSON.parse(fs.readFileSync(path.join(home, 'history.json'), 'utf8'));
  const reduction = verifiedReduction(entries);
  ok('every confirmed exposure is still absent from the latest scan', reduction.confirmed > 0 && reduction.stillClosed === reduction.confirmed && reduction.reopened === 0);

  section('rollback preserves newer work and verifies backup integrity');
  const manifest = JSON.parse(fs.readFileSync(path.join(home, '.boppi', 'backups', 'index.json'), 'utf8'));
  const fetchFix = manifest.entries.find(entry => entry.server === 'fetch');
  const fixedBytes = fs.readFileSync(desktopConfig, 'utf8');
  fs.writeFileSync(desktopConfig, fixedBytes + '\n');
  const conflict = runCli(['rollback', '--id', fetchFix.id, '--yes'], home);
  ok('rollback refuses to overwrite config changes made after the fix', conflict.code === 2 && conflict.stderr.includes('changed after this fix') && fs.readFileSync(desktopConfig, 'utf8') === fixedBytes + '\n');
  fs.writeFileSync(desktopConfig, fixedBytes);
  const backupBytes = fs.readFileSync(fetchFix.backup);
  fs.appendFileSync(fetchFix.backup, '\n');
  const tampered = runCli(['rollback', '--id', fetchFix.id, '--yes'], home);
  ok('rollback refuses a changed backup', tampered.code === 2 && tampered.stderr.includes('integrity') && fs.readFileSync(desktopConfig, 'utf8') === fixedBytes);
  fs.writeFileSync(fetchFix.backup, backupBytes);
  const restored = runCli(['rollback', '--id', fetchFix.id, '--yes'], home);
  ok('unchanged backup restores exact original bytes and rescans', restored.code === 0 && restored.stdout.includes('Rescan:') && fs.readFileSync(desktopConfig, 'utf8') === original);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
