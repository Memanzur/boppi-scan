#!/usr/bin/env node
/** Automatic config fixes: backup, undo, dry run, and SARIF 2.1.0 shape. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const { chooseFixes, parseChoice, applyIssues, collectIssues } = require('../src/cli/autoFix');
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
  ok('--yes keeps the unknown server and the plaintext key, and leaves a pinned -y flag', cursor.mcpServers.mystery && cursor.mcpServers.fetch.env.OPENAI_API_KEY === SECRET && cursor.mcpServers.fetch.args.includes('-y'));
  ok('--yes says it skipped unknown servers and plaintext secrets', applied.stdout.includes('skipped') && applied.stdout.includes('unknown MCP server') && applied.stdout.includes('plaintext secret'));
  const narrowed = cursor.mcpServers.filesystem.args;
  const sameWork = (arg) => { try { return fs.realpathSync(arg) === fs.realpathSync(paths.work); } catch (_) { return false; } };
  ok('unpinned -y is removed and broad paths point at the working directory', !narrowed.includes('-y') && !narrowed.includes(paths.home) && !narrowed.includes('/') && narrowed.some(sameWork));
  const rescanPath = path.join(root, 'after-fix.json');
  const rescan = runCli(['scan', '--quiet', '--json', rescanPath], paths.home, paths.work);
  const rescanned = JSON.parse(fs.readFileSync(rescanPath, 'utf8'));
  ok('re-scan after fix --yes does not report the filesystem package as unpinned', rescan.code === 0 && !(rescanned.configFindings || []).some(finding => finding.ruleId === 'BOPPI-UNPINNED-PACKAGE' && /filesystem/.test(finding.title)));
  const cline = JSON.parse(fs.readFileSync(paths.clineConfig, 'utf8'));
  ok('autoApprove is cleared and the server remains', Array.isArray(cline.mcpServers.notes.autoApprove) && cline.mcpServers.notes.autoApprove.length === 0 && cline.mcpServers.notes.command === 'npx');
  const codex = fs.readFileSync(paths.codexConfig, 'utf8');
  ok('codex yolo settings are tightened and the server table remains', codex.includes('approval_policy = "on-request"') && codex.includes('sandbox_mode = "workspace-write"') && codex.includes('[mcp_servers.docs]') && !codex.includes('"never"') && !codex.includes('danger-full-access'));
  const ownerOnly = file => process.platform === 'win32' || (fs.statSync(file).mode & 0o777) === 0o600;
  ok('config files are owner-only after the mode fix', tracked.every(ownerOnly));
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.home, '.boppi', 'fix-undo.json'), 'utf8'));
  const backups = fs.readdirSync(path.join(paths.home, '.boppi', 'backups'));
  ok('a timestamped backup set was written with owner-only permissions', manifest.files.length === tracked.length && backups.length === tracked.length && manifest.files.every(entry => ownerOnly(entry.backup) && fs.readFileSync(entry.backup, 'utf8') === before.get(entry.original).text));
  ok('the cursor backup and the live config both still hold the secret after --yes', manifest.files.some(entry => fs.readFileSync(entry.backup, 'utf8').includes(SECRET)) && fs.readFileSync(paths.cursorConfig, 'utf8').includes(SECRET));
  ok('backup files are mode 600 and the backup directory is private', manifest.files.every(entry => ownerOnly(entry.backup)) && (process.platform === 'win32' || (fs.statSync(path.join(paths.home, '.boppi', 'backups')).mode & 0o077) === 0));

  const restored = runCli(['fix', '--undo'], paths.home, paths.work);
  ok('undo restores every file body and the previous mode', restored.code === 0 && restored.stdout.includes('Restored') && sameSnapshot(tracked, before));
  ok('undo puts the secret back in the restored config', fs.readFileSync(paths.cursorConfig, 'utf8').includes(SECRET));

  section('pin an unpinned package to the installed version, then re-scan');
  const pinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-pin-'));
  const pinHome = path.join(pinRoot, 'home');
  const pinWork = path.join(pinHome, 'work');
  fs.mkdirSync(path.join(pinHome, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(pinWork, 'node_modules', '@modelcontextprotocol', 'server-memory'), { recursive: true });
  fs.writeFileSync(path.join(pinWork, 'node_modules', '@modelcontextprotocol', 'server-memory', 'package.json'), JSON.stringify({ name: '@modelcontextprotocol/server-memory', version: '0.6.3' }));
  const pinConfig = path.join(pinHome, '.cursor', 'mcp.json');
  fs.writeFileSync(pinConfig, JSON.stringify({
    mcpServers: { memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  }, null, 2) + '\n');
  fs.chmodSync(pinConfig, 0o600);
  const pinFix = runCli(['fix', '--yes'], pinHome, pinWork);
  const pinned = JSON.parse(fs.readFileSync(pinConfig, 'utf8'));
  ok('fix --yes pins the package to the installed version and drops -y', pinFix.code === 0 && pinned.mcpServers.memory.args.length === 1 && pinned.mcpServers.memory.args[0] === '@modelcontextprotocol/server-memory@0.6.3');
  const pinRescanPath = path.join(pinRoot, 'rescan.json');
  const pinRescan = runCli(['scan', '--quiet', '--json', pinRescanPath], pinHome, pinWork);
  const pinExported = JSON.parse(fs.readFileSync(pinRescanPath, 'utf8'));
  ok('re-scan after the pin does not report the package as unpinned or unknown', pinRescan.code === 0 && !(pinExported.configFindings || []).some(finding => finding.ruleId === 'BOPPI-UNPINNED-PACKAGE' || finding.ruleId === 'BOPPI-UNKNOWN-SERVER'));
  fs.rmSync(pinRoot, { recursive: true, force: true });

  section('installer subcommands, exact pins, and arguments after the package');
  function installPkg(work, name, version) {
    const dir = path.join(work, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  }
  function stage(servers, versions) {
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-pin-form-'));
    const stageHome = path.join(stageRoot, 'home');
    const stageWork = path.join(stageHome, 'work');
    fs.mkdirSync(path.join(stageHome, '.cursor'), { recursive: true });
    fs.mkdirSync(stageWork, { recursive: true });
    for (const [name, version] of Object.entries(versions || {})) installPkg(stageWork, name, version);
    const file = path.join(stageHome, '.cursor', 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2) + '\n');
    fs.chmodSync(file, 0o600);
    return { root: stageRoot, home: stageHome, work: stageWork, file };
  }
  function issueList(staged) {
    return collectIssues({
      home: staged.home,
      cwd: staged.work,
      discovery: { clients: [{ label: 'Cursor', clientKey: 'cursor', files: [{ path: staged.file, status: 'found', format: 'json' }] }] },
      claudeSettings: [],
      credentialNames: [],
    });
  }
  function unpinnedTitles(staged) {
    return issueList(staged).filter(item => item.ruleId === 'BOPPI-UNPINNED-PACKAGE').map(item => item.title);
  }

  const npmExec = stage({
    fetch: { command: 'npm', args: ['exec', '--yes', 'mcp-server-fetch', '--package', 'leaked-value'] },
    alias: { command: 'npm', args: ['x', '--yes', 'mcp-server-fetch'] },
  }, { exec: '9.9.9', x: '7.7.7', 'mcp-server-fetch': '1.4.2', 'leaked-value': '8.8.8' });
  const npmTitles = unpinnedTitles(npmExec);
  ok('npm exec evaluates the package after the subcommand, not a later flag value', npmTitles.length === 2 && npmTitles.every(title => title.includes('mcp-server-fetch') && !title.includes('leaked-value') && !/\(exec\)/.test(title) && !/\(x\)/.test(title)));
  const npmFix = runCli(['fix', '--yes'], npmExec.home, npmExec.work);
  const npmArgs = JSON.parse(fs.readFileSync(npmExec.file, 'utf8')).mcpServers.fetch.args;
  const npmAlias = JSON.parse(fs.readFileSync(npmExec.file, 'utf8')).mcpServers.alias.args;
  ok('npm exec --yes pins mcp-server-fetch and leaves exec and the later flag', npmFix.code === 0 && npmArgs[0] === 'exec' && npmArgs.includes('mcp-server-fetch@1.4.2') && npmArgs.includes('leaked-value') && !npmArgs.some(arg => String(arg).startsWith('exec@') || String(arg).startsWith('leaked-value@')) && npmAlias[0] === 'x' && npmAlias.includes('mcp-server-fetch@1.4.2') && !npmAlias.some(arg => String(arg).startsWith('x@')));
  fs.rmSync(npmExec.root, { recursive: true, force: true });

  const yarnDlx = stage({
    fetch: { command: 'yarn', args: ['dlx', 'mcp-server-fetch@latest'] },
  }, { dlx: '8.8.8' });
  const yarnTitles = unpinnedTitles(yarnDlx);
  ok('yarn dlx does not treat dlx as the package name', yarnTitles.length === 1 && yarnTitles[0].includes('mcp-server-fetch') && !yarnTitles[0].includes('(dlx)') && !yarnTitles[0].includes('dlx@'));
  runCli(['fix', '--yes'], yarnDlx.home, yarnDlx.work);
  const yarnArgs = JSON.parse(fs.readFileSync(yarnDlx.file, 'utf8')).mcpServers.fetch.args;
  ok('yarn dlx is not rewritten to the installed dlx version', yarnArgs[0] === 'dlx' && yarnArgs[1] === 'mcp-server-fetch@latest');
  fs.rmSync(yarnDlx.root, { recursive: true, force: true });

  const pnpmDlx = stage({
    fetch: { command: 'pnpm', args: ['dlx', 'mcp-server-fetch'] },
  }, { 'mcp-server-fetch': '1.4.2' });
  const pnpmFix = runCli(['fix', '--yes'], pnpmDlx.home, pnpmDlx.work);
  const pnpmArgs = JSON.parse(fs.readFileSync(pnpmDlx.file, 'utf8')).mcpServers.fetch.args;
  ok('pnpm dlx pins the package after dlx', pnpmFix.code === 0 && pnpmArgs[0] === 'dlx' && pnpmArgs[1] === 'mcp-server-fetch@1.4.2');
  const pnpmRescan = path.join(pnpmDlx.root, 'rescan.json');
  const pnpmScan = runCli(['scan', '--quiet', '--json', pnpmRescan], pnpmDlx.home, pnpmDlx.work);
  const pnpmExported = JSON.parse(fs.readFileSync(pnpmRescan, 'utf8'));
  ok('pnpm dlx is not unpinned after the real package is pinned', pnpmScan.code === 0 && !(pnpmExported.configFindings || []).some(item => item.ruleId === 'BOPPI-UNPINNED-PACKAGE'));
  fs.rmSync(pnpmDlx.root, { recursive: true, force: true });

  const uvTool = stage({
    clock: { command: 'uv', args: ['tool', 'run', 'mcp-server-time'] },
    from: { command: 'uv', args: ['tool', 'run', '--from', 'mcp-server-time', 'extra-arg'] },
  }, { tool: '1.0.0', run: '1.0.0', 'mcp-server-time': '9.9.9' });
  const uvTitles = unpinnedTitles(uvTool);
  ok('uv tool run does not treat tool or run as the package', !uvTitles.some(title => title.includes('(tool)') || title.includes('(run)') || title.includes('extra-arg')));
  runCli(['fix', '--yes'], uvTool.home, uvTool.work);
  const uvJson = JSON.parse(fs.readFileSync(uvTool.file, 'utf8')).mcpServers;
  ok('uv tool run keeps the subcommand and does not pin from node_modules', uvJson.clock.args.join(' ') === 'tool run mcp-server-time' && uvJson.from.args.join(' ') === 'tool run --from mcp-server-time extra-arg');
  fs.rmSync(uvTool.root, { recursive: true, force: true });

  const uvxPin = stage({
    exact: { command: 'uvx', args: ['mcp-server-fetch==1.2.3'] },
    latest: { command: 'uvx', args: ['--yes', 'mcp-server-fetch@latest'] },
  }, { 'mcp-server-fetch': '3.1.0' });
  const uvxBefore = unpinnedTitles(uvxPin);
  ok('an exact == pin is not an unpinned package', !uvxBefore.some(title => title.includes('==1.2.3') || title.includes('mcp-server-fetch==')));
  runCli(['fix', '--yes'], uvxPin.home, uvxPin.work);
  const uvxJson = JSON.parse(fs.readFileSync(uvxPin.file, 'utf8')).mcpServers;
  ok('uvx == pins are not rewritten and uvx is not pinned from node_modules', uvxJson.exact.args.join(' ') === 'mcp-server-fetch==1.2.3' && uvxJson.latest.args.includes('mcp-server-fetch@latest') && !uvxJson.latest.args.some(arg => arg.includes('@3.1.0')));
  fs.rmSync(uvxPin.root, { recursive: true, force: true });

  const afterPkg = stage({
    fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch', '--package', 'leaked-value'] },
  }, { 'mcp-server-fetch': '1.4.2', 'leaked-value': '8.8.8' });
  const afterTitles = unpinnedTitles(afterPkg);
  ok('an argument after the package is not read as an installer flag', afterTitles.length === 1 && afterTitles[0].includes('mcp-server-fetch') && !afterTitles[0].includes('leaked-value'));
  runCli(['fix', '--yes'], afterPkg.home, afterPkg.work);
  const afterArgs = JSON.parse(fs.readFileSync(afterPkg.file, 'utf8')).mcpServers.fetch.args;
  ok('fix --yes pins the real package and keeps the later flag value', afterArgs.includes('mcp-server-fetch@1.4.2') && afterArgs.includes('--package') && afterArgs.includes('leaked-value') && !afterArgs.some(arg => String(arg).startsWith('leaked-value@')));
  fs.rmSync(afterPkg.root, { recursive: true, force: true });

  const afterDash = stage({
    npx: { command: 'npx', args: ['-y', '--', 'mcp-server-fetch@latest'] },
    npm: { command: 'npm', args: ['exec', '--yes', '--', 'mcp-server-fetch'] },
    npmx: { command: 'npm', args: ['x', '--', 'mcp-server-fetch@latest'] },
    yarn: { command: 'yarn', args: ['dlx', '--', 'mcp-server-fetch@latest'] },
    pnpm: { command: 'pnpm', args: ['dlx', '--', 'mcp-server-fetch'] },
  }, { 'mcp-server-fetch': '1.4.2' });
  const dashTitles = unpinnedTitles(afterDash);
  ok('a package after -- is still the unpinned package', dashTitles.length === 5 && dashTitles.every(title => title.includes('mcp-server-fetch') && !title.includes('(--)')));
  runCli(['fix', '--yes'], afterDash.home, afterDash.work);
  const dashJson = JSON.parse(fs.readFileSync(afterDash.file, 'utf8')).mcpServers;
  ok('fix --yes pins the package that follows --', ['npx', 'npm', 'npmx', 'yarn', 'pnpm'].every(name => dashJson[name].args.includes(name === 'npm' || name === 'pnpm' ? 'mcp-server-fetch@1.4.2' : 'mcp-server-fetch@1.4.2') && dashJson[name].args.includes('--')));
  fs.rmSync(afterDash.root, { recursive: true, force: true });

  const flagValue = stage({
    uv: { command: 'uvx', args: ['--python', '3.11', 'mcp-server-fetch@latest'] },
    cache: { command: 'npx', args: ['--cache', '/tmp/cache', 'mcp-server-fetch@latest'] },
    npmrc: { command: 'npm', args: ['exec', '--userconfig', '/tmp/npmrc', 'mcp-server-fetch'] },
  }, { 'mcp-server-fetch': '1.4.2' });
  const flagTitles = unpinnedTitles(flagValue);
  ok('a flag value is not the package name', flagTitles.length === 3 && flagTitles.every(title => title.includes('mcp-server-fetch') && !title.includes('3.11') && !title.includes('/tmp/cache') && !title.includes('/tmp/npmrc')));
  runCli(['fix', '--yes'], flagValue.home, flagValue.work);
  const flagJson = JSON.parse(fs.readFileSync(flagValue.file, 'utf8')).mcpServers;
  ok('npx --cache pins the real package and keeps the flag value', flagJson.cache.args.includes('--cache') && flagJson.cache.args.includes('/tmp/cache') && flagJson.cache.args.includes('mcp-server-fetch@1.4.2'));
  ok('npm exec --userconfig pins the real package and keeps the flag value', flagJson.npmrc.args[0] === 'exec' && flagJson.npmrc.args.includes('--userconfig') && flagJson.npmrc.args.includes('/tmp/npmrc') && flagJson.npmrc.args.includes('mcp-server-fetch@1.4.2'));
  ok('uvx --python does not treat 3.11 as the package and is not rewritten', flagJson.uv.args.join(' ') === '--python 3.11 mcp-server-fetch@latest');
  fs.rmSync(flagValue.root, { recursive: true, force: true });

  const { installerPackage } = require('../src/cli/discovery/secrets');
  ok('npx --no-fund does not swallow the package', installerPackage('npx', ['--no-fund', 'mcp-server-fetch@latest']).spec === 'mcp-server-fetch@latest');
  ok('uvx --no-progress does not swallow the package', installerPackage('uvx', ['--no-progress', 'mcp-server-fetch']).spec === 'mcp-server-fetch');
  ok('uvx -p consumes the python version and evaluates the package', installerPackage('uvx', ['-p', '3.11', 'mcp-server-fetch']).spec === 'mcp-server-fetch');
  const noFund = stage({
    fetch: { command: 'npx', args: ['--no-fund', 'mcp-server-fetch@latest'] },
  }, { 'mcp-server-fetch': '1.4.2' });
  const noFundTitles = unpinnedTitles(noFund);
  ok('npx --no-fund reports mcp-server-fetch, not the flag', noFundTitles.length === 1 && noFundTitles[0].includes('mcp-server-fetch') && !noFundTitles[0].includes('no-fund'));
  runCli(['fix', '--yes'], noFund.home, noFund.work);
  const noFundArgs = JSON.parse(fs.readFileSync(noFund.file, 'utf8')).mcpServers.fetch.args;
  ok('npx --no-fund pins the package and keeps the boolean flag', noFundArgs.includes('--no-fund') && noFundArgs.includes('mcp-server-fetch@1.4.2'));
  fs.rmSync(noFund.root, { recursive: true, force: true });

  const loglevel = stage({
    fetch: { command: 'npx', args: ['--loglevel', 'warn', 'mcp-server-fetch@latest'] },
    exec: { command: 'npm', args: ['exec', '--loglevel', 'warn', 'mcp-server-fetch@latest'] },
  }, { warn: '9.9.9' });
  runCli(['fix', '--yes'], loglevel.home, loglevel.work);
  const logJson = JSON.parse(fs.readFileSync(loglevel.file, 'utf8')).mcpServers;
  const logRescanPath = path.join(loglevel.root, 'rescan.json');
  const logRescan = runCli(['scan', '--quiet', '--json', logRescanPath], loglevel.home, loglevel.work);
  const logFindings = JSON.parse(fs.readFileSync(logRescanPath, 'utf8')).configFindings || [];
  ok('npx --loglevel does not pin the log level as the package', logJson.fetch.args.includes('--loglevel') && logJson.fetch.args.includes('warn') && logJson.fetch.args.includes('mcp-server-fetch@latest') && !logJson.fetch.args.some(arg => String(arg).startsWith('warn@')));
  ok('npm exec --loglevel does not pin the log level as the package', logJson.exec.args.includes('mcp-server-fetch@latest') && !logJson.exec.args.some(arg => String(arg).startsWith('warn@')));
  ok('a loglevel command is not a clean rescan while @latest still runs', logRescan.code === 0 && logFindings.some(item => item.ruleId === 'BOPPI-UNPINNED-PACKAGE' && /mcp-server-fetch/.test(item.title)));
  fs.rmSync(loglevel.root, { recursive: true, force: true });

  const ambiguous = stage({
    fetch: { command: 'npx', args: ['--not-a-real-npm-flag', 'warn', 'mcp-server-fetch@latest'] },
  }, { warn: '9.9.9' });
  const ambiguousParsed = installerPackage('npx', ['--not-a-real-npm-flag', 'warn', 'mcp-server-fetch@latest']);
  runCli(['fix', '--yes'], ambiguous.home, ambiguous.work);
  const ambiguousArgs = JSON.parse(fs.readFileSync(ambiguous.file, 'utf8')).mcpServers.fetch.args;
  const ambiguousRescan = path.join(ambiguous.root, 'rescan.json');
  runCli(['scan', '--quiet', '--json', ambiguousRescan], ambiguous.home, ambiguous.work);
  const ambiguousFindings = JSON.parse(fs.readFileSync(ambiguousRescan, 'utf8')).configFindings || [];
  ok('an unrecognized flag that disagrees with the launched package is not pinned', ambiguousParsed.ambiguous === true && ambiguousArgs.includes('warn') && ambiguousArgs.includes('mcp-server-fetch@latest') && !ambiguousArgs.some(arg => String(arg).startsWith('warn@')) && ambiguousFindings.some(item => item.ruleId === 'BOPPI-UNPINNED-PACKAGE'));
  fs.rmSync(ambiguous.root, { recursive: true, force: true });

  const shortFlag = stage({
    npm: { command: 'npm', args: ['exec', '-C', 'somepkg', 'mcp-server-fetch@latest'] },
    pnpm: { command: 'pnpm', args: ['dlx', '-C', 'somepkg', 'mcp-server-fetch@latest'] },
    unknown: { command: 'npx', args: ['-Z', 'somepkg', 'mcp-server-fetch@latest'] },
  }, { somepkg: '2.2.2', 'mcp-server-fetch': '1.4.2' });
  runCli(['fix', '--yes'], shortFlag.home, shortFlag.work);
  const shortJson = JSON.parse(fs.readFileSync(shortFlag.file, 'utf8')).mcpServers;
  const shortRescan = path.join(shortFlag.root, 'rescan.json');
  runCli(['scan', '--quiet', '--json', shortRescan], shortFlag.home, shortFlag.work);
  const shortFindings = JSON.parse(fs.readFileSync(shortRescan, 'utf8')).configFindings || [];
  ok('npm exec -C pins the launched package, not the prefix value', shortJson.npm.args.includes('-C') && shortJson.npm.args.includes('somepkg') && shortJson.npm.args.includes('mcp-server-fetch@1.4.2') && !shortJson.npm.args.some(arg => String(arg).startsWith('somepkg@')));
  ok('pnpm dlx -C pins the launched package, not the prefix value', shortJson.pnpm.args.includes('mcp-server-fetch@1.4.2') && !shortJson.pnpm.args.some(arg => String(arg).startsWith('somepkg@')));
  ok('an unrecognized short flag is not pinned and stays unpinned', shortJson.unknown.args.includes('somepkg') && !shortJson.unknown.args.some(arg => String(arg).startsWith('somepkg@')) && shortFindings.some(item => item.ruleId === 'BOPPI-UNPINNED-PACKAGE'));
  fs.rmSync(shortFlag.root, { recursive: true, force: true });

  const shim = stage({
    fetch: { command: 'C:\\Program Files\\nodejs\\npx.cmd', args: ['-y', 'mcp-server-fetch@latest'] },
    quoted: { command: '"C:\\Program Files\\nodejs\\npx.exe"', args: ['-y', 'mcp-server-fetch@latest'] },
  }, { 'mcp-server-fetch': '1.4.2' });
  runCli(['fix', '--yes'], shim.home, shim.work);
  const shimJson = JSON.parse(fs.readFileSync(shim.file, 'utf8')).mcpServers;
  ok('a Windows npx.cmd path pins the same package as npx', shimJson.fetch.command === 'C:\\Program Files\\nodejs\\npx.cmd' && shimJson.fetch.args.includes('mcp-server-fetch@1.4.2') && !shimJson.fetch.args.includes('-y'));
  ok('a quoted npx.exe path pins the same package as npx', shimJson.quoted.args.includes('mcp-server-fetch@1.4.2'));
  fs.rmSync(shim.root, { recursive: true, force: true });

  section('destructive fixes apply only when chosen');
  const chosenFile = path.join(root, 'chosen.json');
  fs.writeFileSync(chosenFile, JSON.stringify({ mcpServers: { fetch: { command: 'npx', args: ['pkg'], env: { OPENAI_API_KEY: SECRET, COOKIE_PATH: 'chocolate', API_KEY_FILE: '/tmp/keyfile' } } } }, null, 2) + '\n');
  applyIssues([{
    ruleId: 'BOPPI-PLAINTEXT-SECRET', fixId: 'plaintext:chosen', file: chosenFile, autoFixable: true, server: 'fetch', detail: { kind: 'env', name: 'OPENAI_API_KEY' },
  }], { home: paths.home, cwd: paths.work, now: '2026-01-01T00:00:00Z' });
  const chosenJson = JSON.parse(fs.readFileSync(chosenFile, 'utf8'));
  ok('a confirmed plaintext fix deletes the provider key and leaves name-only values', chosenJson.mcpServers.fetch.env.OPENAI_API_KEY == null && chosenJson.mcpServers.fetch.env.COOKIE_PATH === 'chocolate' && chosenJson.mcpServers.fetch.env.API_KEY_FILE === '/tmp/keyfile');

  section('symlinks, hard links, and a tampered backup set');
  const outside = path.join(root, 'outside.json');
  fs.writeFileSync(outside, JSON.stringify({ mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] } } }, null, 2) + '\n');
  const outsideBefore = fs.readFileSync(outside);
  const linkHome = path.join(root, 'link-home');
  fs.mkdirSync(path.join(linkHome, '.cursor'), { recursive: true });
  fs.symlinkSync(outside, path.join(linkHome, '.cursor', 'mcp.json'));
  const serverFix = runCli(['fix', '--server', 'filesystem', '--yes'], linkHome, paths.work);
  ok('fix --server refuses a symlink and does not change the target', serverFix.code === 2 && serverFix.stderr.includes('symlink') && fs.readFileSync(outside).equals(outsideBefore));

  const twin = path.join(root, 'twin.json');
  fs.writeFileSync(chosenFile, JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }, null, 2) + '\n');
  fs.linkSync(chosenFile, twin);
  const twinBefore = fs.readFileSync(twin);
  applyIssues([{
    ruleId: 'BOPPI-PERM-MODE', fixId: 'perm', file: chosenFile, autoFixable: true, detail: { from: 'bypassPermissions', to: 'default' },
  }], { home: paths.home, cwd: paths.work, now: '2026-01-01T00:00:01Z' });
  ok('a fix replaces the named file and leaves another hard link unchanged', fs.readFileSync(chosenFile, 'utf8').includes('"default"') && fs.readFileSync(twin).equals(twinBefore));

  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  const escapeHome = path.join(root, 'escape-home');
  fs.mkdirSync(path.join(escapeHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(escapeHome, '.boppi'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(escapeHome, '.boppi', 'backups'));
  fs.writeFileSync(path.join(escapeHome, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions', allow: ['Read'] } }, null, 2) + '\n');
  const escaped = runCli(['fix', '--yes'], escapeHome, paths.work);
  ok('a symlinked backup directory is refused', escaped.code !== 0 && fs.readdirSync(elsewhere).length === 0 && escaped.stderr.includes('symlink'));

  const manifestPath = path.join(paths.home, '.boppi', 'fix-undo.json');
  const poisonedTarget = path.join(root, 'should-not-exist.json');
  const saved = fs.readFileSync(manifestPath, 'utf8');
  const poisoned = JSON.parse(saved);
  poisoned.files[0].original = poisonedTarget;
  fs.writeFileSync(manifestPath, JSON.stringify(poisoned, null, 2));
  const poisonRun = runCli(['fix', '--undo'], paths.home, paths.work);
  ok('undo rejects a modified backup set and does not write the new path', poisonRun.code !== 0 && !fs.existsSync(poisonedTarget) && poisonRun.stderr.includes('modified'));
  fs.writeFileSync(manifestPath, saved);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
