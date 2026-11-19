#!/usr/bin/env node
/** Automatic config fixes: backup, undo, dry run, and SARIF 2.1.0 shape. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const { chooseFixes, parseChoice } = require('../src/cli/autoFix');
const { validateSarif } = require('../src/cli/render/sarif');

let passed = 0, failed = 0;
function ok(name, condition) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

const SECRET = 'sk-thisisafakesecretvalue123456';

function makeHome(root) {
  const home = path.join(root, 'home');
  const work = path.join(home, 'work');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings'), { recursive: true });
  fs.mkdirSync(work, { recursive: true });

  const claudeSettings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(claudeSettings, JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions', allow: ['Bash', 'Read'] },
  }, null, 2) + '\n');

  const cursorConfig = path.join(home, '.cursor', 'mcp.json');
  fs.writeFileSync(cursorConfig, JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home, '/'] },
      fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch@1.2.3'], env: { OPENAI_API_KEY: SECRET } },
      mystery: { command: 'node', args: ['server.js'] },
    },
  }, null, 2) + '\n');
  fs.chmodSync(cursorConfig, 0o666);

  const clineConfig = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  fs.writeFileSync(clineConfig, JSON.stringify({
    mcpServers: {
      notes: {
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem@1.2.3', work],
        autoApprove: ['read_file', 'write_file'],
      },
    },
  }, null, 2) + '\n');

  const codexConfig = path.join(home, '.codex', 'config.toml');
  fs.writeFileSync(codexConfig, [
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    '',
    '[mcp_servers.docs]',
    'command = "npx"',
    'args = ["@modelcontextprotocol/server-filesystem@1.2.3"]',
    '',
  ].join('\n'));

  return { home, work, claudeSettings, cursorConfig, clineConfig, codexConfig };
}

function snapshot(files) {
  const out = new Map();
  for (const file of files) out.set(file, { text: fs.readFileSync(file, 'utf8'), mode: fs.statSync(file).mode & 0o777 });
  return out;
}

function sameSnapshot(files, before) {
  for (const file of files) {
    const current = { text: fs.readFileSync(file, 'utf8'), mode: fs.statSync(file).mode & 0o777 };
    const prior = before.get(file);
    if (current.text !== prior.text || current.mode !== prior.mode) return false;
  }
  return true;
}

function runCli(args, home, cwd, extra = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, '..', 'history.json')], {
    encoding: 'utf8',
    env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' },
    ...extra,
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

(async function main() {
  section('prompt');
  ok('blank, n, and skip all skip; y and all apply', ['', 'n', 'no', 's', 'skip', 'later'].every(value => parseChoice(value) === 'skip') && parseChoice('y') === 'yes' && parseChoice('ALL') === 'all');
  const scripted = ['n', 's', 'y', 'a'];
  const chosen = await chooseFixes(['A', 'B', 'C', 'D', 'E'].map(id => ({ id })), async () => scripted.shift());
  ok('n and skip leave a fix, y takes one, all takes the rest', chosen.map(item => item.id).join(',') === 'C,D,E');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-auto-fix-'));
  const paths = makeHome(root);
  const tracked = [paths.claudeSettings, paths.cursorConfig, paths.clineConfig, paths.codexConfig];
  const before = snapshot(tracked);

  section('undo, dry run, and a non-interactive refusal change nothing');
  const undoFirst = runCli(['fix', '--undo'], paths.home, paths.work);
  ok('undo with no backup set exits 2', undoFirst.code === 2 && undoFirst.stderr.includes('no backup set') && sameSnapshot(tracked, before));
  const dry = runCli(['fix', '--dry-run'], paths.home, paths.work);
  ok('dry run exits 0 and names every fixer', dry.code === 0 && dry.stdout.includes('Dry run') && [
    'BOPPI-PERM-MODE', 'BOPPI-UNSCOPED-SHELL', 'BOPPI-AUTO-APPROVE', 'BOPPI-PLAINTEXT-SECRET',
    'BOPPI-WORLD-READABLE', 'BOPPI-UNKNOWN-SERVER', 'BOPPI-UNPINNED-PACKAGE', 'BOPPI-BROAD-FILESYSTEM', 'BOPPI-YOLO-MODE',
  ].every(id => dry.stdout.includes(id)));
  ok('dry run shows a small diff and does not print the secret', dry.stdout.includes('- "defaultMode": "bypassPermissions"') && dry.stdout.includes('+ "defaultMode": "default"') && dry.stdout.includes('[redacted]') && !dry.stdout.includes(SECRET) && !dry.stderr.includes(SECRET));
  ok('dry run writes no backup and changes no file', !fs.existsSync(path.join(paths.home, '.boppi', 'fix-undo.json')) && !fs.existsSync(path.join(paths.home, '.boppi', 'backups')) && sameSnapshot(tracked, before));
  const refused = runCli(['fix'], paths.home, paths.work);
  ok('without --yes and without a terminal, fix exits 2 and changes nothing', refused.code === 2 && refused.stderr.includes('--yes') && sameSnapshot(tracked, before) && !refused.stdout.includes(SECRET));

  section('reports');
  const jsonPath = path.join(root, 'export.json');
  const sarifPath = path.join(root, 'report.sarif');
  const scan = runCli(['scan', '--format', 'sarif', '-o', sarifPath, '--json', jsonPath], paths.home, paths.work);
  ok('scan --format sarif -o writes the file and keeps the terminal quiet', scan.code === 0 && scan.stdout.includes(`SARIF report written to ${sarifPath}`) && !scan.stdout.includes('BOPPI'));
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const exportedText = JSON.stringify(exported);
  ok('json findings and config findings carry remediation', exported.inventory.real.findings.every(finding => finding.remediation && typeof finding.remediation.summary === 'string' && Array.isArray(finding.remediation.steps) && finding.remediation.steps.length > 0 && typeof finding.remediation.autoFixable === 'boolean' && typeof finding.remediation.fixId === 'string') && exported.configFindings.length > 0 && exported.configFindings.every(finding => finding.remediation && finding.remediation.fixId === finding.fixId && Array.isArray(finding.remediation.steps)));
  ok('json does not contain the secret or the home directory', !exportedText.includes(SECRET) && !exportedText.includes(paths.home));
  const sarifLog = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
  const sarifErrors = validateSarif(sarifLog);
  if (sarifErrors.length) console.log('  sarif problems: ' + sarifErrors.join('; '));
  ok('SARIF 2.1.0 validates and every result has a declared rule', sarifErrors.length === 0 && sarifLog.version === '2.1.0');
  const sarifText = JSON.stringify(sarifLog);
  ok('SARIF help text and remediation stay portable and free of the secret', sarifLog.runs[0].tool.driver.rules.every(rule => rule.help && rule.help.text && rule.properties.remediation) && !sarifText.includes(SECRET) && !sarifText.includes(paths.home));
  const stdoutSarif = runCli(['scan', '--quiet', '--format', 'sarif'], paths.home, paths.work);
  let stdoutLog = null;
  try { stdoutLog = JSON.parse(stdoutSarif.stdout); } catch (_) { stdoutLog = null; }
  ok('--format sarif without -o prints a valid log on stdout', stdoutSarif.code === 0 && stdoutLog && validateSarif(stdoutLog).length === 0);

  section('apply and undo');
  const applied = runCli(['fix', '--yes'], paths.home, paths.work);
  ok('fix --yes exits 0 and does not print the secret', applied.code === 0 && applied.stdout.includes('Applied') && !applied.stdout.includes(SECRET) && !applied.stderr.includes(SECRET));
  const settings = JSON.parse(fs.readFileSync(paths.claudeSettings, 'utf8'));
  ok('permission mode returns to default and unrestricted Bash is removed', settings.permissions.defaultMode === 'default' && settings.permissions.allow.length === 1 && settings.permissions.allow[0] === 'Read');
  const cursor = JSON.parse(fs.readFileSync(paths.cursorConfig, 'utf8'));
  ok('plaintext env key is gone, the pinned -y flag stays, and the unknown server is removed', !cursor.mcpServers.fetch.env.OPENAI_API_KEY && cursor.mcpServers.fetch.args.includes('-y') && !cursor.mcpServers.mystery);
  ok('unpinned -y is removed and broad paths point at the working directory', !cursor.mcpServers.filesystem.args.includes('-y') && !cursor.mcpServers.filesystem.args.includes(paths.home) && !cursor.mcpServers.filesystem.args.includes('/') && cursor.mcpServers.filesystem.args.includes(paths.work));
  const cline = JSON.parse(fs.readFileSync(paths.clineConfig, 'utf8'));
  ok('autoApprove is cleared and the server remains', Array.isArray(cline.mcpServers.notes.autoApprove) && cline.mcpServers.notes.autoApprove.length === 0 && cline.mcpServers.notes.command === 'npx');
  const codex = fs.readFileSync(paths.codexConfig, 'utf8');
  ok('codex yolo settings are tightened and the server table remains', codex.includes('approval_policy = "on-request"') && codex.includes('sandbox_mode = "workspace-write"') && codex.includes('[mcp_servers.docs]') && !codex.includes('"never"') && !codex.includes('danger-full-access'));
  ok('config files are owner-only after the mode fix', tracked.every(file => (fs.statSync(file).mode & 0o777) === 0o600));
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.home, '.boppi', 'fix-undo.json'), 'utf8'));
  const backups = fs.readdirSync(path.join(paths.home, '.boppi', 'backups'));
  ok('a timestamped backup set was written with owner-only permissions', manifest.files.length === tracked.length && backups.length === tracked.length && manifest.files.every(entry => (fs.statSync(entry.backup).mode & 0o777) === 0o600 && fs.readFileSync(entry.backup, 'utf8') === before.get(entry.original).text));
  ok('the cursor backup still holds the secret, so undo can restore it', manifest.files.some(entry => fs.readFileSync(entry.backup, 'utf8').includes(SECRET)) && !fs.readFileSync(paths.cursorConfig, 'utf8').includes(SECRET));

  const restored = runCli(['fix', '--undo'], paths.home, paths.work);
  ok('undo restores every file body and the previous mode', restored.code === 0 && restored.stdout.includes('Restored') && sameSnapshot(tracked, before));
  ok('the restored config contains the secret again and the fixed file had not', fs.readFileSync(paths.cursorConfig, 'utf8').includes(SECRET));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
