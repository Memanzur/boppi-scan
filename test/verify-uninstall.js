#!/usr/bin/env node
/**
 * boppi uninstall removes <home>/.boppi after confirmation and nothing else:
 * state written by real commands is listed and removed, fix backups need
 * --include-backups, no confirmation means no change, a linked ~/.boppi is
 * refused, and Claude Code settings are only read, never edited, while every
 * `boppi hook` entry in them is reported with its location.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const uninstall = require('../src/cli/uninstall');
const updateNotice = require('../src/cli/updateNotice');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home, { cwd = home, input = '', env = {} } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--no-color'], { env: { ...process.env, BOPPI_TOKEN: '', ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

/** sha256 of every file under dir by relative path, so "unchanged" means byte-identical. */
function snapshot(dir) {
  const out = {};
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return JSON.stringify(out);
}

function makeHome(root, name) {
  const home = path.join(root, name);
  const dir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
    fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch'] },
  } }));
  return home;
}

const HOOK_SNIPPET = { hooks: { PreToolUse: [{ matcher: 'mcp__.*', hooks: [{ type: 'command', command: 'boppi hook', timeout: 5 }] }], PostToolUse: [{ matcher: 'mcp__.*', hooks: [{ type: 'command', command: 'echo unrelated' }, { type: 'command', command: '/usr/local/bin/boppi hook', timeout: 5 }] }] } };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-uninstall-'));

  section('State written by real commands is listed, then removed after --yes');
  const home = makeHome(root, 'home');
  await runCli(['scan'], home);
  await runCli(['settings', '--set', 'telemetry=off'], home);
  await runCli(['hook'], home, { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__filesystem__read_file', tool_input: {}, session_id: 's1' }) });
  await runCli(['demo'], home);
  updateNotice.observe(home, 'https://w.example/api/ingest', { get: () => '9.0.0' });
  fs.writeFileSync(path.join(home, '.boppi', 'connector.json'), JSON.stringify({ url: 'https://w.example', deviceId: 'dev-1', credential: 'bpd_secret_value_never_printed', deviceName: 'laptop' }), { mode: 0o600 });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const userSettings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(userSettings, JSON.stringify(HOOK_SNIPPET, null, 2));
  const settingsBefore = fs.readFileSync(userSettings);
  const stored = fs.readdirSync(path.join(home, '.boppi')).sort();
  ok('setup: real commands wrote history, events, demo, update notice and pairing', ['history.json', 'demo', 'update-notice.json', 'connector.json'].every(name => stored.includes(name)) && stored.some(name => name.startsWith('events')), stored.join(','));

  const before = snapshot(path.join(home, '.boppi'));
  const dry = await runCli(['uninstall', '--dry-run'], home);
  ok('--dry-run lists every top-level entry and exits 0', dry.code === 0 && stored.every(name => dry.stdout.includes(name)) && dry.stdout.includes('Dry run: nothing removed.'), dry.stdout);
  ok('--dry-run changes nothing', snapshot(path.join(home, '.boppi')) === before);
  ok('entries are explained (history, pairing, update notice)', dry.stdout.includes('scan history') && dry.stdout.includes('workspace pairing and device credential') && dry.stdout.includes('update notice'));
  ok('the pairing line names the workspace, says it is not contacted, and points at connect unpair', dry.stdout.includes('https://w.example') && dry.stdout.includes('without contacting it') && dry.stdout.includes('Run boppi connect unpair first') && dry.stdout.includes('until revoked on the Collectors page'));
  ok('the device credential is never printed', !dry.stdout.includes('bpd_secret_value_never_printed') && !dry.stderr.includes('bpd_secret_value_never_printed'));
  ok('both `boppi hook` entries are reported with file and location; the unrelated hook is not', dry.stdout.includes(`${userSettings}  hooks.PreToolUse[0].hooks[0]  "boppi hook"`) && dry.stdout.includes('hooks.PostToolUse[0].hooks[1]  "/usr/local/bin/boppi hook"') && !dry.stdout.includes('echo unrelated'));
  ok('it says how to remove the program itself', dry.stdout.includes('npm uninstall -g boppi'));

  const unconfirmed = await runCli(['uninstall'], home);
  ok('without a terminal and without --yes nothing is removed (exit 2)', unconfirmed.code === 2 && unconfirmed.stderr.includes('Pass --yes') && snapshot(path.join(home, '.boppi')) === before);

  const removed = await runCli(['uninstall', '--yes'], home);
  ok('--yes removes ~/.boppi and exits 0', removed.code === 0 && !fs.existsSync(path.join(home, '.boppi')), removed.stderr);
  ok('the summary repeats how many hook entries are left to remove', removed.stdout.includes('Remove the 2 hook entries listed above.'));
  ok('Claude Code settings are byte-identical afterwards', fs.readFileSync(userSettings).equals(settingsBefore));
  ok('nothing outside ~/.boppi was removed (the client config is still there)', fs.existsSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')));
  ok('the update notice step after the command does not recreate ~/.boppi', !fs.existsSync(path.join(home, '.boppi')));
  const again = await runCli(['uninstall', '--yes'], home);
  ok('a second run has nothing to remove and exits 0', again.code === 0 && again.stdout.includes('does not exist; nothing stored here to remove.'));

  section('Backups of fixes still applied hold uninstall; rolled-back ones do not');
  const fixed = makeHome(root, 'fixed-home');
  const applied = await runCli(['fix', '--server', 'fetch', '--yes'], fixed);
  const backupDir = path.join(fixed, '.boppi', 'backups');
  ok('setup: a real fix left a backup', applied.code === 0 && fs.existsSync(backupDir) && fs.readdirSync(backupDir).length > 0, applied.stderr);
  const fixId = JSON.parse(fs.readFileSync(path.join(backupDir, 'index.json'), 'utf8')).entries.find(e => e.action === 'remove_server').id;
  const withBackups = snapshot(path.join(fixed, '.boppi'));
  const keep = await runCli(['uninstall', '--yes'], fixed);
  ok('with a fix still applied it stops (exit 2) and changes nothing', keep.code === 2 && keep.stdout.includes('stops here: 1 fix is still applied') && keep.stderr.includes('--include-backups') && snapshot(path.join(fixed, '.boppi')) === withBackups);
  ok('it names the exact rollback command for that fix', keep.stdout.includes(`fetch in `) && keep.stdout.includes(`boppi rollback --id ${fixId}`));
  const restored = await runCli(['rollback', '--id', fixId, '--yes'], fixed);
  ok('setup: that rollback restores the file', restored.code === 0 && restored.stdout.includes('Restored.'), restored.stderr);
  const after = await runCli(['uninstall', '--yes'], fixed);
  ok('after the rollback, uninstall removes everything without --include-backups', after.code === 0 && after.stdout.includes('backups of fixes already rolled back') && !fs.existsSync(path.join(fixed, '.boppi')), after.stderr);

  // The connector records backups under the resolved home (/private/tmp on macOS); --home may name a link to it.
  const realHome = makeHome(root, 'real-home');
  const aliasHome = path.join(root, 'alias-home');
  fs.symlinkSync(realHome, aliasHome);
  const viaReal = await runCli(['fix', '--server', 'fetch', '--yes'], realHome);
  const realId = JSON.parse(fs.readFileSync(path.join(realHome, '.boppi', 'backups', 'index.json'), 'utf8')).entries.find(e => e.action === 'remove_server').id;
  const realBack = await runCli(['rollback', '--id', realId, '--yes'], realHome);
  ok('setup: fix and rollback recorded under the real home path', viaReal.code === 0 && realBack.code === 0, viaReal.stderr + realBack.stderr);
  const viaAlias = await runCli(['uninstall', '--yes'], aliasHome);
  ok('uninstall through a linked home still sees the rolled-back backup as recorded', viaAlias.code === 0 && !viaAlias.stdout.includes('a backup no fix record names') && !fs.existsSync(path.join(realHome, '.boppi')), viaAlias.stdout);

  const forced = makeHome(root, 'forced-home');
  ok('setup: a second home with a fix applied', (await runCli(['fix', '--server', 'fetch', '--yes'], forced)).code === 0);
  const all = await runCli(['uninstall', '--yes', '--include-backups'], forced);
  ok('--include-backups removes a live fix\'s backup and says rollback can no longer restore it', all.code === 0 && all.stdout.includes('boppi rollback cannot restore it') && !fs.existsSync(path.join(forced, '.boppi')));

  const stray = makeHome(root, 'stray-home');
  fs.mkdirSync(path.join(stray, '.boppi', 'backups'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stray, '.boppi', 'backups', 'claude_desktop_config.json.0123456789ab.2026-10-28T00-00-00-000Z.bak'), '{}', { mode: 0o600 });
  const strayRun = await runCli(['uninstall', '--yes'], stray);
  ok('a backup no fix record names is treated as live (no manifest to prove otherwise)', strayRun.code === 2 && strayRun.stdout.includes('a backup no fix record names') && fs.existsSync(path.join(stray, '.boppi')));
  const misplaced = await runCli(['scan', '--include-backups'], fixed);
  ok('--include-backups is refused on other commands', misplaced.code === 2 && misplaced.stderr.includes('only accepted with uninstall'));

  section('Interactive confirmation');
  const asked = makeHome(root, 'asked-home');
  fs.mkdirSync(path.join(asked, '.boppi'));
  fs.writeFileSync(path.join(asked, '.boppi', 'history.json'), '{}');
  const tty = process.stdin.isTTY;
  const write = process.stdout.write;
  process.stdin.isTTY = true;
  process.stdout.write = () => true;
  let question = '';
  const declined = await uninstall.runUninstall({ home: asked, cwd: asked }, { confirm: async q => { question = q; return false; } });
  const accepted = await (async () => { const before = fs.existsSync(path.join(asked, '.boppi')); const code = await uninstall.runUninstall({ home: asked, cwd: asked }, { confirm: async () => true }); return { before, code }; })();
  process.stdout.write = write;
  process.stdin.isTTY = tty;
  ok('a declined prompt keeps everything (exit 2)', declined === 2 && question.includes('.boppi') && accepted.before);
  ok('a confirmed prompt removes it', accepted.code === 0 && !fs.existsSync(path.join(asked, '.boppi')));

  section('Links, other files and hook detection');
  const linked = path.join(root, 'linked-home');
  const target = path.join(root, 'elsewhere');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
  fs.mkdirSync(linked);
  fs.symlinkSync(target, path.join(linked, '.boppi'));
  const refused = await runCli(['uninstall', '--yes'], linked);
  ok('a linked ~/.boppi is refused (exit 2) and its target is untouched', refused.code === 2 && refused.stderr.includes('not a plain directory') && fs.readFileSync(path.join(target, 'keep.txt'), 'utf8') === 'keep' && fs.lstatSync(path.join(linked, '.boppi')).isSymbolicLink());

  const project = path.join(root, 'project');
  const projectHome = makeHome(root, 'project-home');
  fs.mkdirSync(path.join(projectHome, '.boppi'));
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { PermissionDenied: [{ hooks: [{ type: 'command', command: 'node /opt/boppi/bin/boppi.js hook' }] }] } }));
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), '{ "hooks": { broken json mentioning boppi hook');
  const outside = path.join(root, 'custom-history.json');
  const projectRun = await runCli(['uninstall', '--dry-run', '--history-file', outside], projectHome, { cwd: project });
  ok('project settings.local.json entries are found', projectRun.stdout.includes('settings.local.json  hooks.PermissionDenied[0].hooks[0]  "node /opt/boppi/bin/boppi.js hook"'), projectRun.stdout);
  ok('an unparsable settings file that mentions boppi is flagged for a manual check', projectRun.stdout.includes(`could not parse ${path.join(project, '.claude', 'settings.json')}`));
  ok('a --history-file outside ~/.boppi is named as not touched', projectRun.stdout.includes(`not touched: --history-file ${outside}`));
  const matches = ['boppi hook', 'npx boppi hook', '"/Users/x/bin/boppi" hook', 'C:\\tools\\boppi.cmd hook --x'];
  const misses = ['boppi-hooker', 'myboppi hook', 'echo boppi hooks', 'boppi scan', 'hook boppi'];
  ok('hook matcher: boppi hook in its usual spellings', matches.every(c => uninstall.BOPPI_HOOK.test(c)), matches.filter(c => !uninstall.BOPPI_HOOK.test(c)).join(' | '));
  ok('hook matcher: lookalikes are not reported', misses.every(c => !uninstall.BOPPI_HOOK.test(c)), misses.filter(c => uninstall.BOPPI_HOOK.test(c)).join(' | '));
  const none = path.join(root, 'none-home');
  fs.mkdirSync(none);
  const nothing = await runCli(['uninstall'], none);
  ok('with no ~/.boppi it exits 0 and creates nothing', nothing.code === 0 && !fs.existsSync(path.join(none, '.boppi')));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
