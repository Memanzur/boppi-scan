#!/usr/bin/env node
/**
 * Verify suite for passive Claude Code settings discovery (master plan 5a(a)):
 * documented MCP enablement keys, hook counts, and managed (machine-wide)
 * settings. Every scan here runs under a preload that refuses child processes
 * and network access, so a hook or a server that ran would fail the suite.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ccSettings = require('../src/cli/claudeCodeSettings');
const builtinTools = require('../src/cli/builtinTools');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }

const PRELOAD = `
'use strict';
const fs = require('fs');
const log = process.env.BOPPI_EXEC_LOG;
function refuse(kind) { fs.appendFileSync(log, kind + '\\n'); throw new Error('execution attempt (' + kind + ') blocked by verify-claude-code-settings'); }
const net = require('net');
net.Socket.prototype.connect = function () { refuse('net.Socket.connect'); };
for (const mod of ['http', 'https']) { const m = require(mod); m.request = function () { refuse(mod + '.request'); }; m.get = function () { refuse(mod + '.get'); }; }
globalThis.fetch = async function () { refuse('fetch'); };
const cp = require('child_process');
for (const fn of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) cp[fn] = function () { refuse('child_process.' + fn); };
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-cc-settings-'));
const preload = path.join(root, 'preload.js');
fs.writeFileSync(preload, PRELOAD);
const execLog = path.join(root, 'attempts.log');

function run(args, { home, cwd = home, managedDir = null, env = {} }) {
  fs.writeFileSync(execLog, '');
  const result = spawnSync(process.execPath, ['--require', preload, CLI, ...args, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json')], {
    encoding: 'utf8',
    env: { ...process.env, BOPPI_EXEC_LOG: execLog, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_MANAGED_SETTINGS_DIR: managedDir || path.join(root, 'no-managed-dir'), ...env },
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '', attempts: fs.readFileSync(execLog, 'utf8').trim().split('\n').filter(Boolean) };
}
function exportOf(args, options) {
  const file = path.join(root, `export-${Math.random().toString(16).slice(2)}.json`);
  const html = file.replace(/\.json$/, '.html');
  const result = run([...args, '--json', file, '--html', html], options);
  // An unreadable settings file exits 4 (scan incomplete) but still writes the export, as every unreadable file always has.
  const exported = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return { result, exported, json: exported ? fs.readFileSync(file, 'utf8') : '', html: fs.existsSync(html) ? fs.readFileSync(html, 'utf8') : '' };
}
const clientOf = exported => exported.discovery.clients.find(c => c.clientKey === 'claude-code');
const stateOf = (exported, name) => { const s = clientOf(exported).mcpPolicy.servers.find(x => x.name === name); return s ? `${s.state}:${s.basis}` : 'missing'; };
const builtinOf = (exported, capability) => exported.inventory.real.permissions.find(p => p.source.type === 'builtin-tool' && p.source.id.split(':')[2] === capability);
const pathKeys = exported => exported.exposurePaths.map(p => p.exposureKey).sort().join('|');
const gates = exported => exported.inventory.real.permissions.filter(p => p.source.type === 'builtin-tool').map(p => `${p.source.id}=${p.accessLevel}`).sort().join('|');

const FETCH = { command: 'uvx', args: ['mcp-server-fetch'] };
const SLACK = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] };
const GITHUB = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] };
const HOOK_MARK = path.join(root, 'HOOK_RAN');

/** A home with a project: user servers in ~/.claude.json, project servers in .mcp.json. */
function makeHome(name, { claudeJson, mcpJson, userSettings, projectSettings, localSettings } = {}) {
  const home = path.join(root, name, 'home');
  const cwd = path.join(root, name, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  if (claudeJson) writeJson(path.join(home, '.claude.json'), typeof claudeJson === 'function' ? claudeJson(cwd) : claudeJson);
  if (mcpJson) writeJson(path.join(cwd, '.mcp.json'), mcpJson);
  if (userSettings) writeJson(path.join(home, '.claude', 'settings.json'), userSettings);
  if (projectSettings) writeJson(path.join(cwd, '.claude', 'settings.json'), projectSettings);
  if (localSettings) writeJson(path.join(cwd, '.claude', 'settings.local.json'), localSettings);
  return { home, cwd };
}
function makeManaged(name, { settings, dropIns = {}, mcp } = {}) {
  const dir = path.join(root, name, 'managed');
  fs.mkdirSync(dir, { recursive: true });
  if (settings !== undefined) writeJson(path.join(dir, 'managed-settings.json'), settings);
  for (const [file, value] of Object.entries(dropIns)) writeJson(path.join(dir, 'managed-settings.d', file), value);
  if (mcp !== undefined) writeJson(path.join(dir, 'managed-mcp.json'), mcp);
  return dir;
}

(function main() {
  section('Documented locations');
  const mac = ccSettings.managedLocations({ platform: 'darwin' }).map(f => f.path);
  const linux = ccSettings.managedLocations({ platform: 'linux' }).map(f => f.path);
  const win = ccSettings.managedLocations({ platform: 'win32' }).map(f => f.path);
  ok('macOS managed locations are the documented files', mac.join() === '/Library/Application Support/ClaudeCode/managed-settings.json,/Library/Application Support/ClaudeCode/managed-mcp.json');
  ok('Linux managed locations are the documented files', linux.join() === '/etc/claude-code/managed-settings.json,/etc/claude-code/managed-mcp.json');
  ok('Windows managed locations are under Program Files, not the legacy ProgramData path', win.join() === 'C:\\Program Files\\ClaudeCode\\managed-settings.json,C:\\Program Files\\ClaudeCode\\managed-mcp.json');
  const files = builtinTools.claudeCodeSettingsFiles({ home: '/h', cwd: '/h/p', platform: 'linux' });
  ok('managed settings come last in the settings list, so they take precedence in the merge', files.map(f => f.scope).join() === 'user,project,local,managed,managed');

  section('Positive: enablement, hooks, and a managed file on one install');
  const canaryHook = `touch ${HOOK_MARK} && echo CANARY_hook_cmd`;
  const positive = makeHome('positive', {
    claudeJson: cwd => ({
      mcpServers: { github: GITHUB, 'cmd-denied': { command: 'node', args: ['/srv/denied.js'] }, remote: { url: 'https://mcp.example.com/sse' } },
      projects: { [cwd]: { mcpServers: { 'local-fs': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', cwd] } }, disabledMcpServers: ['github'], enabledMcpjsonServers: ['fetch'] } },
    }),
    mcpJson: { mcpServers: { fetch: FETCH, slack: SLACK, gone: { command: 'npx', args: ['-y', 'x'] }, pending: { command: 'npx', args: ['-y', 'y'] } } },
    projectSettings: {
      permissions: { allow: ['Bash(CANARY_rule *)'] },
      disabledMcpjsonServers: ['gone'],
      hooks: {
        PreToolUse: [{ matcher: 'CANARY_matcher', hooks: [{ type: 'command', command: 'node /x/boppi.js hook' }] }],
        PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: canaryHook }, { type: 'prompt', prompt: 'CANARY_prompt' }] }],
      },
    },
  });
  const managedDir = makeManaged('positive', {
    settings: { permissions: { defaultMode: 'default', disableBypassPermissionsMode: 'disable', deny: ['WebFetch'] }, deniedMcpServers: [{ serverName: 'slack' }, { serverCommand: ['node', '/srv/denied.js'] }, { serverUrl: 'https://*.example.com/CANARY_pattern' }], allowManagedHooksOnly: true },
  });
  const pos = exportOf(['scan', '--only', 'claude-code'], { home: positive.home, cwd: positive.cwd, managedDir });
  ok('the scan exits 0 and starts no process', pos.result.code === 0 && pos.result.attempts.length === 0, pos.result.stderr.slice(0, 200) + pos.result.attempts.join(','));
  ok('no hook ran (the hook command would have left a marker file)', !fs.existsSync(HOOK_MARK));
  const policy = pos.exported ? clientOf(pos.exported).mcpPolicy : null;
  ok('a user server listed in disabledMcpServers for the project is disabled', stateOf(pos.exported, 'github') === 'disabled:documented');
  ok('a user server nothing disables is enabled', stateOf(pos.exported, 'local-fs') === 'enabled:documented');
  ok('a project server approved in ~/.claude.json is enabled with basis observed', stateOf(pos.exported, 'fetch') === 'enabled:observed');
  ok('a project server named by a managed deniedMcpServers rule is disabled', stateOf(pos.exported, 'slack') === 'disabled:documented');
  ok('a managed deny by exact serverCommand is disabled', stateOf(pos.exported, 'cmd-denied') === 'disabled:documented');
  ok('a managed deny with a wildcard URL leaves the URL server unknown', stateOf(pos.exported, 'remote') === 'unknown:documented' && policy.servers.find(s => s.name === 'remote').reason.includes('URL pattern'));
  ok('a project server listed in disabledMcpjsonServers is disabled', stateOf(pos.exported, 'gone') === 'disabled:documented');
  ok('an unlisted project server needs approval', stateOf(pos.exported, 'pending') === 'needs_approval:documented');
  ok('the counts add up', policy && JSON.stringify(policy.counts) === JSON.stringify({ enabled: 2, needs_approval: 1, disabled: 4, unknown: 1 }), JSON.stringify(policy && policy.counts));
  ok('hooks are counted per event, with the handler total and the Boppi collector flagged', policy && policy.hooks.handlers === 3 && policy.hooks.events === 2 && policy.hooks.byEvent.PreToolUse === 1 && policy.hooks.byEvent.PostToolUse === 2 && policy.hooks.boppiCollector === true && policy.hooks.files === 1 && policy.hooks.malformed === false);
  ok('the managed file is reported as found with its locks and rule counts', policy && policy.managed.found === true && policy.managed.checked === 2 && policy.managed.locks.join() === 'allowManagedHooksOnly' && policy.managed.rules.denied === 3 && policy.managed.rules.allowed === null && policy.managed.disableBypassPermissionsMode === true && policy.managed.mcpFile === 'not_found');
  ok('the managed deny rule grades WebFetch as denied', pos.exported && !builtinOf(pos.exported, 'web_fetch') && clientOf(pos.exported).builtin.denied.some(g => g.capability === 'web_fetch'));
  ok('settings report managedRead and the built-in permission carries managedSettingsRead', pos.exported && clientOf(pos.exported).builtin.settings.managedRead === true && builtinOf(pos.exported, 'shell_access').attributes.managedSettingsRead === true);
  const managedEntry = pos.exported && clientOf(pos.exported).files.find(f => f.scope === 'managed' && f.kind === 'settings');
  ok('the managed settings entry keeps counts and locks only', managedEntry && managedEntry.status === 'found' && managedEntry.rules.deny === 1 && managedEntry.locks.allowManagedHooksOnly === true && managedEntry.managedMcpRules.denied === 3 && !('entries' in managedEntry));
  ok('the terminal names the managed file, the hook count, and the settings sentence', pos.result.stdout.includes('managed permission settings (mode default · 1 deny · locks: allowManagedHooksOnly)') && pos.result.stdout.includes('3 hook handlers') && pos.result.stdout.includes('Settings read: Claude Code MCP servers by settings: 2 enabled, 1 awaiting approval, 4 disabled by settings, 1 unknown'));
  ok('the HTML coverage card carries the same sentence', pos.html.includes('Settings read:</b> Claude Code MCP servers by settings: 2 enabled, 1 awaiting approval, 4 disabled by settings, 1 unknown') && pos.html.includes('including the Boppi collector; none were run'));
  ok('disabled servers are still graded (every configured server stays in the inventory)', pos.exported && pos.exported.inventory.real.mcpServers.length === 8);

  section('Positive: precedence between settings scopes and managed locks');
  const prec = makeHome('precedence', {
    claudeJson: { mcpServers: {} },
    mcpJson: { mcpServers: { fetch: FETCH, slack: SLACK } },
    userSettings: { enableAllProjectMcpServers: true, permissions: { allow: ['Bash'], defaultMode: 'bypassPermissions' } },
    localSettings: { enableAllProjectMcpServers: false, enabledMcpjsonServers: ['slack'] },
  });
  const noLock = exportOf(['scan', '--only', 'claude-code'], { home: prec.home, cwd: prec.cwd });
  ok('a later scope turns enableAllProjectMcpServers off again (last value wins)', stateOf(noLock.exported, 'fetch') === 'needs_approval:documented');
  ok('enabledMcpjsonServers in local settings enables a project server', stateOf(noLock.exported, 'slack') === 'enabled:documented');
  ok('without a managed file the user bypass mode makes the shell unprompted', builtinOf(noLock.exported, 'shell_access').accessLevel === 'unprompted');
  const lockDir = makeManaged('precedence', { settings: { allowManagedPermissionRulesOnly: true, permissions: { disableBypassPermissionsMode: 'disable' } } });
  const locked = exportOf(['scan', '--only', 'claude-code'], { home: prec.home, cwd: prec.cwd, managedDir: lockDir });
  ok('allowManagedPermissionRulesOnly drops the user allow rule and disableBypassPermissionsMode drops the bypass mode, so the shell prompts', builtinOf(locked.exported, 'shell_access').accessLevel === 'prompted', builtinOf(locked.exported, 'shell_access').normalizationReason);
  const dropDir = makeManaged('dropins', { settings: {}, dropIns: { '10-policy.json': { permissions: { deny: ['WebSearch'] } }, 'notes.txt': 'ignored' }, mcp: { mcpServers: { corp: { url: 'https://mcp.corp.example/sse' } } } });
  const drop = exportOf(['scan', '--only', 'claude-code'], { home: prec.home, cwd: prec.cwd, managedDir: dropDir });
  const dropPolicy = clientOf(drop.exported).mcpPolicy;
  ok('managed-settings.d drop-ins are read in name order and counted', dropPolicy.managed.checked === 3 && clientOf(drop.exported).builtin.denied.some(g => g.capability === 'web_search'));
  ok('managed-mcp.json takes exclusive control: every other server is disabled and its own servers are counted, not graded', dropPolicy.managed.mcpFile === 'found' && dropPolicy.managed.mcpServerCount === 1 && dropPolicy.servers.every(s => s.state === 'disabled' && s.reason.includes('managed-mcp.json')) && drop.exported.inventory.real.mcpServers.length === 2);
  ok('the terminal explains the managed MCP policy entry', drop.result.stdout.includes('managed MCP policy (1 managed server; servers configured elsewhere are not loaded)'));

  section('Negative: no settings at all');
  const bare = makeHome('bare', { claudeJson: { mcpServers: { github: GITHUB } }, mcpJson: { mcpServers: { fetch: FETCH } } });
  const neg = exportOf(['scan', '--only', 'claude-code'], { home: bare.home, cwd: bare.cwd });
  const negPolicy = clientOf(neg.exported).mcpPolicy;
  ok('a user server is enabled and a project server needs approval', stateOf(neg.exported, 'github') === 'enabled:documented' && stateOf(neg.exported, 'fetch') === 'needs_approval:documented');
  ok('no hooks, no managed file, and the policy is complete', negPolicy.hooks.handlers === 0 && negPolicy.managed.found === false && negPolicy.managed.checked === 2 && negPolicy.complete === true);
  ok('the terminal collapses the missing managed locations into one line and says what was not read', neg.result.stdout.includes('managed settings: none found (2 locations checked)') && neg.result.stdout.includes('Hooks: none configured.') && neg.result.stdout.includes(ccSettings.NOT_READ));
  ok('managedRead stays false when no managed file exists', clientOf(neg.exported).builtin.settings.managedRead === false && builtinOf(neg.exported, 'shell_access').attributes.managedSettingsRead === false);
  const none = exportOf(['scan', '--only', 'claude-code'], { home: path.join(root, 'empty-home'), cwd: path.join(root, 'empty-home') });
  fs.mkdirSync(path.join(root, 'empty-home'), { recursive: true });
  ok('a machine without Claude Code has no settings sentence and no policy', none.result.code === 0 && !clientOf(none.exported).mcpPolicy && !none.result.stdout.includes('Settings read:'));
  const explicit = makeHome('explicit', { claudeJson: { mcpServers: { github: GITHUB } }, projectSettings: { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: canaryHook }] }] } } });
  const exp = exportOf(['scan', '--config', path.join(explicit.home, '.claude.json'), '--source', 'claude-code'], { home: explicit.home, cwd: explicit.cwd });
  ok('explicit --config mode reads no settings and reports no policy', exp.result.code === 0 && !exp.exported.discovery.clients[0].mcpPolicy && !exp.json.includes('CANARY'));

  section('Malformed configuration');
  const bad = makeHome('malformed', {
    claudeJson: cwd => ({ mcpServers: { github: GITHUB }, projects: { [cwd]: { disabledMcpServers: 'github', enabledMcpjsonServers: [{ name: 'fetch' }] } } }),
    mcpJson: { mcpServers: { fetch: FETCH, gone: SLACK } },
    projectSettings: { hooks: 'nope', enabledMcpjsonServers: 42, disabledMcpjsonServers: [1, null, 'gone'], enableAllProjectMcpServers: 'yes', permissions: { allow: 'Bash' } },
    localSettings: { hooks: { 'Pre Tool Use!': [], PreToolUse: [{ hooks: 'x' }, { hooks: [{ type: 'command', command: 'node /x/boppi.js hook' }, 'junk'] }], PostToolUse: 'nope' }, deniedMcpServers: 'ignored outside managed' },
  });
  const mal = exportOf(['scan', '--only', 'claude-code'], { home: bad.home, cwd: bad.cwd });
  const malPolicy = clientOf(mal.exported).mcpPolicy;
  ok('wrong-typed enablement keys are ignored and flagged, valid names in a mixed list still count', mal.result.code === 0 && stateOf(mal.exported, 'github') === 'enabled:documented' && stateOf(mal.exported, 'fetch') === 'needs_approval:documented' && stateOf(mal.exported, 'gone') === 'disabled:documented');
  const malEntries = clientOf(mal.exported).files.filter(f => f.kind === 'settings' && f.status === 'found');
  ok('each malformed block is flagged on its file entry without failing the scan', malEntries.length === 2 && malEntries[0].mcp.malformed === true && malEntries[0].hooks.malformed === true && malEntries[1].hooks.malformed === true);
  ok('well-formed handlers inside a partly malformed hooks block are still counted', malPolicy.hooks.handlers === 1 && malPolicy.hooks.byEvent.PreToolUse === 1 && malPolicy.hooks.boppiCollector === true && malPolicy.hooks.malformed === true);
  const brokenDir = makeManaged('broken', { settings: '{ not json', mcp: '{ not json either' });
  const broken = exportOf(['scan', '--only', 'claude-code'], { home: bad.home, cwd: bad.cwd, managedDir: brokenDir });
  const brokenPolicy = clientOf(broken.exported).mcpPolicy;
  ok('an unreadable managed file makes every enablement state unknown, the policy incomplete, and the scan exit 4 like any unreadable settings file', broken.result.code === 4 && broken.result.stderr.includes('Scan incomplete') && brokenPolicy.complete === false && brokenPolicy.servers.every(s => s.state === 'unknown'));
  ok('an unreadable managed file grades the built-in tools unknown, as any unreadable settings file does', builtinOf(broken.exported, 'shell_access').accessLevel === 'unknown' && clientOf(broken.exported).files.filter(f => f.scope === 'managed').every(f => f.status === 'unreadable' && f.reason === 'invalid JSON'));
  const unit = ccSettings.fileEvidence({ deniedMcpServers: 'x', allowedMcpServers: [1, { serverName: 'a' }], hooks: null, enabledMcpjsonServers: ['a', 2] }, 'managed');
  ok('fileEvidence tolerates every wrong type and reports counts only', unit.stored.managedMcpRules.denied === 0 && unit.stored.managedMcpRules.allowed === 1 && unit.rules.allowed.malformed === true && unit.stored.hooks.malformed === true && unit.stored.mcp.enabledMcpjsonServers.join() === 'a' && unit.stored.mcp.malformed === true);
  ok('fileEvidence on a non-object document is empty, not an error', ccSettings.fileEvidence(null, 'user').stored.hooks.handlers === 0 && ccSettings.fileEvidence([1, 2], 'user').stored.mcp.enableAllProjectMcpServers === null);

  section('Privacy: counts and names only');
  const surfaces = { export: pos.json, html: pos.html, terminal: pos.result.stdout };
  const dry = run(['push', '--dry-run', '--url', 'http://127.0.0.1:1'], { home: positive.home, cwd: positive.cwd, managedDir });
  surfaces.push = dry.stdout;
  for (const [name, text] of Object.entries(surfaces)) ok(`${name} carries no hook command, matcher, prompt, rule text, or URL pattern`, !/CANARY/.test(text), (text.match(/CANARY\w*/g) || []).join(','));
  ok('push --dry-run ran without a process or network attempt', dry.code === 0 && dry.attempts.length === 0);
  ok('the export fingerprints a managed file outside the documented location and never prints the fixture root', !pos.json.includes(root) && clientOf(pos.exported).files.find(f => f.scope === 'managed').path.startsWith('path_'));
  const macExport = exportOf(['scan', '--only', 'claude-code'], { home: bare.home, cwd: bare.cwd, env: { BOPPI_MANAGED_SETTINGS_DIR: '' } });
  ok('the documented managed location keeps its literal path (it names nothing personal)', clientOf(macExport.exported).files.some(f => f.scope === 'managed' && f.path === '/Library/Application Support/ClaudeCode/managed-settings.json'));
  ok('the push wire preview carries no hook, lock, or enablement detail (coverage is per-file status only)', dry.stdout.includes('"coverage"') && !/"byEvent"|"locks"|"mcpPolicy"|"enabledMcpjsonServers"/.test(dry.stdout));

  section('Compatibility: existing configurations grade the same');
  const classic = makeHome('classic', {
    claudeJson: { mcpServers: { github: GITHUB } },
    mcpJson: { mcpServers: { fetch: FETCH } },
    userSettings: { permissions: { allow: ['Bash(npm run *)'], deny: ['WebFetch'] } },
    localSettings: { permissions: { defaultMode: 'acceptEdits' } },
  });
  const a = exportOf(['scan', '--only', 'claude-code'], { home: classic.home, cwd: classic.cwd });
  const b = exportOf(['scan', '--only', 'claude-code'], { home: classic.home, cwd: classic.cwd, managedDir: makeManaged('classic-empty', {}) });
  ok('with no managed file the paths and built-in gates are identical whether or not a managed directory exists', pathKeys(a.exported) === pathKeys(b.exported) && gates(a.exported) === gates(b.exported) && a.exported.exposurePaths.length > 0);
  const classicEntries = clientOf(a.exported).files.filter(f => f.kind === 'settings');
  ok('settings entries keep their rule counts and gain empty enablement and hook evidence', classicEntries.filter(f => f.status === 'found').every(f => f.rules && f.mcp && f.hooks && f.hooks.handlers === 0 && !('locks' in f)) && classicEntries.find(f => f.scope === 'user').rules.deny === 1);
  ok('classic grades are unchanged: acceptEdits makes edits unprompted, the shell prompts, WebFetch is denied', builtinOf(a.exported, 'filesystem_access').accessLevel === 'unprompted' && builtinOf(a.exported, 'shell_access').accessLevel === 'prompted' && !builtinOf(a.exported, 'web_fetch'));
  ok('the legacy readPermissionSettings result shape still has entries and merged', (() => { const r = builtinTools.readPermissionSettings(builtinTools.claudeCodeSettingsFiles({ home: classic.home, cwd: classic.cwd, platform: 'darwin', managedDir: path.join(root, 'nope') })); return Array.isArray(r.entries) && r.merged.deny.length === 1 && r.merged.mode === 'acceptEdits' && r.merged.modeScope === 'local'; })());
  const sameDir = exportOf(['scan', '--only', 'claude-code'], { home: classic.home, cwd: classic.home });
  ok('scanning from the home folder still lists the shared settings file once', clientOf(sameDir.exported).files.filter(f => f.kind === 'settings' && f.scope !== 'managed').length === 2);
  ok('every state is one of the four documented values', [pos, noLock, locked, drop, neg, mal, broken, a].every(r => clientOf(r.exported).mcpPolicy.servers.every(s => ccSettings.STATES.includes(s.state))));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
