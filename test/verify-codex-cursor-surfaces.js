#!/usr/bin/env node
/**
 * Verify suite for the passive Codex CLI and Cursor hooks surfaces (master
 * plan 5a(b)): the TOML reader, Codex config.toml servers and policy values,
 * hook counts for both clients, managed requirements presence, the
 * remediation refusal for TOML, and the privacy canaries. Every scan runs
 * under a preload that refuses child processes and network access, so a hook
 * or a server that ran would fail the suite.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const toml = require('../src/cli/discovery/toml');
const codex = require('../src/cli/discovery/codex');
const hooks = require('../src/cli/discovery/hooks');
const fix = require('../src/cli/fix');
const scanner = require('../src/engine/localMcpScanner');
const { filesHolding } = require('../src/cli/configFiles');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }

const PRELOAD = `
'use strict';
const fs = require('fs');
const log = process.env.BOPPI_EXEC_LOG;
function refuse(kind) { fs.appendFileSync(log, kind + '\\n'); throw new Error('execution attempt (' + kind + ') blocked by verify-codex-cursor-surfaces'); }
const net = require('net');
net.Socket.prototype.connect = function () { refuse('net.Socket.connect'); };
for (const mod of ['http', 'https']) { const m = require(mod); m.request = function () { refuse(mod + '.request'); }; m.get = function () { refuse(mod + '.get'); }; }
globalThis.fetch = async function () { refuse('fetch'); };
const cp = require('child_process');
for (const fn of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) cp[fn] = function () { refuse('child_process.' + fn); };
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-codex-cursor-'));
const preload = path.join(root, 'preload.js');
fs.writeFileSync(preload, PRELOAD);
const execLog = path.join(root, 'attempts.log');
const CANARY = 'BOPPI_5AB_CANARY';
const HOOK_MARK = path.join(root, 'HOOK_RAN');

function run(args, { home, cwd = home, codexManagedDir = null, cursorEnterpriseDir = null, env = {} }) {
  fs.writeFileSync(execLog, '');
  const result = spawnSync(process.execPath, ['--require', preload, CLI, ...args, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json')], {
    encoding: 'utf8',
    env: {
      ...process.env, BOPPI_EXEC_LOG: execLog, BOPPI_SCAN_PLATFORM: 'darwin',
      BOPPI_MANAGED_SETTINGS_DIR: path.join(root, 'no-managed-dir'),
      BOPPI_CODEX_MANAGED_DIR: codexManagedDir || path.join(root, 'no-codex-managed-dir'),
      BOPPI_CURSOR_ENTERPRISE_DIR: cursorEnterpriseDir || path.join(root, 'no-cursor-enterprise-dir'),
      ...env,
    },
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '', attempts: fs.readFileSync(execLog, 'utf8').trim().split('\n').filter(Boolean) };
}
function exportOf(args, options) {
  const file = path.join(root, `export-${Math.random().toString(16).slice(2)}.json`);
  const html = file.replace(/\.json$/, '.html');
  const sarif = file.replace(/\.json$/, '.sarif');
  const result = run([...args, '--json', file, '--html', html, '--sarif', sarif], options);
  const exported = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return { result, exported, file, json: exported ? fs.readFileSync(file, 'utf8') : '', html: fs.existsSync(html) ? fs.readFileSync(html, 'utf8') : '', sarif: fs.existsSync(sarif) ? fs.readFileSync(sarif, 'utf8') : '' };
}
const clientOf = (exported, key) => exported.discovery.clients.find(c => c.clientKey === key);
const stateOf = (exported, name) => { const s = clientOf(exported, 'codex').mcpPolicy.servers.find(x => x.name === name); return s ? `${s.state}:${s.basis}` : 'missing'; };
const serversOf = (exported, agentName) => exported.inventory.real.mcpServers.filter(s => exported.inventory.real.agents.find(a => a.id === s.agentId && a.name === agentName));

const USER_TOML = `# Codex CLI user configuration (fixture)
model = "o4-mini"
approval_policy = "never"
sandbox_mode = "danger-full-access"

[mcp_servers.fetch]
command = "uvx"
args = ["mcp-server-fetch"]

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/Users/${CANARY}_fsroot/Documents"]
env = { FS_TOKEN = "${CANARY}_envvalue" }

[mcp_servers.remote]
url = "https://mcp.example.com/sse"
bearer_token_env_var = "GITHUB_TOKEN"
enabled_tools = ["search", "read"]

[mcp_servers.off]
command = "npx"
args = ["-y", "some-disabled-server"]
enabled = false

[[hooks.PreToolUse]]
matcher = "${CANARY}_matcher"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "touch ${HOOK_MARK} && echo ${CANARY}_inline_hook"
`;
const PROJECT_TOML = `approval_policy = "on-request"
[mcp_servers.repo]
command = "npx"
args = ["-y", "mcp-server-kubernetes"]
`;
const codexHooksJson = tag => ({ hooks: { PreToolUse: [{ matcher: 'x', hooks: [{ type: 'command', command: `echo ${CANARY}_${tag}_1` }] }], PostToolUse: [{ hooks: [{ type: 'command', command: `echo ${CANARY}_${tag}_2` }, { type: 'command', command: `touch ${HOOK_MARK}` }] }] } });
const cursorHooksJson = (tag, events) => ({ version: 1, hooks: Object.fromEntries(events.map(([event, n]) => [event, Array.from({ length: n }, (_, i) => ({ command: `echo ${CANARY}_${tag}_${event}_${i}` }))])) });

/** A home and a project folder with the given files. */
function makeHome(name, files = {}) {
  const home = path.join(root, name, 'home');
  const cwd = path.join(root, name, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  for (const [rel, value] of Object.entries(files)) write(rel.startsWith('project/') ? path.join(cwd, rel.slice(8)) : path.join(home, rel), value);
  return { home, cwd };
}
function makeDir(name, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, value] of Object.entries(files)) write(path.join(dir, rel), value);
  return dir;
}

(function main() {
  section('TOML reader: the supported subset parses, everything else throws');
  const doc = toml.parse(USER_TOML);
  ok('tables, dotted arrays of tables, inline tables, arrays, strings, booleans parse into plain objects', doc.approval_policy === 'never' && doc.mcp_servers.off.enabled === false && doc.mcp_servers.filesystem.env.FS_TOKEN === `${CANARY}_envvalue` && doc.hooks.PreToolUse[0].hooks[0].type === 'command' && doc.mcp_servers.remote.enabled_tools.join() === 'search,read');
  const extra = toml.parse('a.b."c d" = 1_000\nf = -2.5e3\nml = """line one\nline two"""\nlit = \'C:\\path\'\n[t."q.k"]\nx = [ 1, 2,\n  3, # trailing\n]\n[[arr]]\nn = 1\n[[arr]]\nn = 2\n');
  ok('dotted and quoted keys, underscores, floats, multi-line and literal strings, multi-line arrays, arrays of tables', extra.a.b['c d'] === 1000 && extra.f === -2500 && extra.ml === 'line one\nline two' && extra.lit === 'C:\\path' && extra.t['q.k'].x.join() === '1,2,3' && extra.arr.map(e => e.n).join() === '1,2');
  const rejected = ['a = 1979-05-27', 'a = 07:32:00', 'a = 0x1F', 'a = inf', 'a = nan', 'a = "unterminated', 'a = 1\na = 2', '[t]\n[t]', 'a = { b = 1 }\na.c = 2', 'junk', 'a = [1, 2', 'a = 1 b = 2', '[t]\nx = 1\n[t.x]\ny = 2', 'a = "\\q"', '"a\nb" = 1'];
  const failures = rejected.filter(text => { try { toml.parse(text); return true; } catch (error) { return !(error instanceof toml.TomlError); } });
  ok('dates, times, prefixed integers, special floats, unterminated strings, duplicate keys, reopened tables, and stray text all throw TomlError', failures.length === 0, failures.join(' | '));
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'discovery', 'toml.js'), 'utf8');
  ok('the reader never evaluates text (no eval, Function, or vm)', !/\beval\s*\(|new Function|require\('vm'\)/.test(source));
  ok('a non-string input throws instead of guessing', (() => { try { toml.parse(null); return false; } catch (error) { return error instanceof toml.TomlError; } })());

  section('Documented locations and registration');
  ok('Codex managed requirements: /etc/codex on macOS and Linux, ~/.codex/managed_config.toml on Windows', codex.managedFiles({ home: '/h', platform: 'darwin' })[0].path === '/etc/codex/requirements.toml' && codex.managedFiles({ home: '/h', platform: 'linux' })[0].path === '/etc/codex/requirements.toml' && codex.managedFiles({ home: 'C:\\Users\\x', platform: 'win32' })[0].path === 'C:\\Users\\x\\.codex\\managed_config.toml');
  const cursorMac = hooks.cursorLocations({ home: '/h', cwd: '/h/p', platform: 'darwin' }).map(f => `${f.scope}:${f.path}`);
  ok('Cursor hooks: user, project, and the enterprise location per platform', cursorMac.join() === 'user:/h/.cursor/hooks.json,project:/h/p/.cursor/hooks.json,enterprise:/Library/Application Support/Cursor/hooks.json' && hooks.cursorLocations({ home: '/h', cwd: '/h', platform: 'linux' })[2].path === '/etc/cursor/hooks.json' && hooks.cursorLocations({ home: 'C:\\u', cwd: 'C:\\u', platform: 'win32' })[2].path === 'C:\\ProgramData\\Cursor\\hooks.json');
  ok('codex is a registered client and engine source', fix.CLIENTS.some(m => m.locate({ home: '/h', cwd: '/h', platform: 'darwin' }).clientKey === 'codex') && scanner.supportedSources.includes('codex'));
  ok('the Codex descriptor marks both config files as TOML and lists its hook and managed files for watch', (() => { const d = codex.locate({ home: '/h', cwd: '/h/p', platform: 'darwin' }); return d.files.every(f => f.format === 'toml') && d.inspectFiles.map(f => f.kind).join() === 'hooks,hooks,managed'; })());
  ok('watch follows the hook and managed files of both clients', (() => { const watch = require('../src/cli/watch'); const t = watch.targets({ home: '/h', cwd: '/h/p', platform: 'darwin' }); const paths = t.files.map(f => f.path); return ['/h/.codex/config.toml', '/h/p/.codex/config.toml', '/h/.codex/hooks.json', '/etc/codex/requirements.toml', '/h/.cursor/hooks.json', '/Library/Application Support/Cursor/hooks.json'].every(p => paths.includes(p)); })());

  section('Positive: Codex CLI user and project servers, policy values, hooks, managed presence');
  const positive = makeHome('positive', { '.codex/config.toml': USER_TOML, 'project/.codex/config.toml': PROJECT_TOML, '.codex/hooks.json': codexHooksJson('user') });
  const managedDir = makeDir('positive-managed', { 'requirements.toml': 'allowed_approval_policies = ["on-request", "never"]\nallowed_sandbox_modes = ["workspace-write"]\nallow_managed_hooks_only = true\n' });
  const pos = exportOf(['scan', '--only', 'codex'], { home: positive.home, cwd: positive.cwd, codexManagedDir: managedDir });
  const policy = pos.exported ? clientOf(pos.exported, 'codex').mcpPolicy : null;
  ok('the scan exits 0 and starts no process', pos.result.code === 0 && pos.result.attempts.length === 0, pos.result.stderr.slice(0, 200) + pos.result.attempts.join(','));
  ok('no hook ran (the hook command would have left a marker file)', !fs.existsSync(HOOK_MARK));
  ok('Codex CLI is one agent with every configured server graded, the disabled one included', serversOf(pos.exported, 'Codex CLI').length === 5 && pos.exported.inventory.real.agents.length === 1 && pos.exported.inventory.real.agents[0].vendor === 'OpenAI');
  ok('user and project servers are graded like any other client (filesystem plus fetch gives an exposure path)', pos.exported.exposurePaths.some(p => p.agentName === 'Codex CLI' && p.exposureKey.startsWith('EP-A:')) && serversOf(pos.exported, 'Codex CLI').find(s => s.name === 'filesystem').capabilities.includes('filesystem_access'));
  ok('enabled = false is a disabled state with a documented basis; the others are enabled', stateOf(pos.exported, 'off') === 'disabled:documented' && stateOf(pos.exported, 'fetch') === 'enabled:documented' && stateOf(pos.exported, 'repo') === 'enabled:documented' && policy.servers.find(s => s.name === 'repo').scope === 'project' && JSON.stringify(policy.counts) === JSON.stringify({ enabled: 4, disabled: 1, unknown: 0 }));
  ok('approval_policy and sandbox_mode are recorded with their scope and marked not graded (project value wins for approval)', policy.policy.approvalPolicy === 'on-request' && policy.policy.approvalScope === 'project' && policy.policy.sandboxMode === 'danger-full-access' && policy.policy.sandboxScope === 'user' && policy.policy.graded === false);
  ok('the policy values add no built-in grant, permission, or path (nothing is graded from them)', !pos.exported.inventory.real.permissions.some(p => p.source && p.source.type === 'builtin-tool') && !clientOf(pos.exported, 'codex').builtin);
  ok('hooks are counted from the inline [hooks] table and hooks.json, per event, with file counts', policy.hooks.handlers === 4 && policy.hooks.events === 2 && policy.hooks.byEvent.PreToolUse === 2 && policy.hooks.byEvent.PostToolUse === 2 && policy.hooks.inline === 1 && policy.hooks.files === 2 && policy.hooks.malformed === false);
  ok('the managed requirements file is reported as present with its allow lists and lock', policy.managed.found === true && policy.managed.checked === 1 && policy.managed.locks.join() === 'allow_managed_hooks_only' && policy.managed.allowedApprovalPolicies.join() === 'on-request,never' && policy.managed.allowedSandboxModes.join() === 'workspace-write' && policy.managed.mcpAllowlist === null && policy.complete === true);
  const userEntry = clientOf(pos.exported, 'codex').files.find(f => f.scope === 'user' && !f.kind);
  ok('the config file entry keeps values and counts only', userEntry && userEntry.format === 'toml' && userEntry.policy.approvalPolicy === 'never' && userEntry.disabledServers.join() === 'off' && userEntry.hooks.handlers === 1 && userEntry.toolFilters === 1 && !('mcp_servers' in userEntry));
  ok('bearer_token_env_var and env names surface as credential references, never values', (() => { const remote = serversOf(pos.exported, 'Codex CLI').find(s => s.name === 'remote'); const fsys = serversOf(pos.exported, 'Codex CLI').find(s => s.name === 'filesystem'); return remote.credentialReferences.join() === 'GITHUB_TOKEN' && remote.capabilities.includes('credential_access') && fsys.environmentVariableNames.join() === 'FS_TOKEN'; })());
  ok('the terminal lists each Codex file with its recorded values and the not-graded label', pos.result.stdout.includes('4 servers · approval never · sandbox danger-full-access · recorded, not graded · 1 server disabled · 1 inline hook handler') && pos.result.stdout.includes('hooks (3 handlers across 2 events)') && pos.result.stdout.includes('managed requirements (allowed approval policies: on-request, never · allowed sandbox modes: workspace-write · managed hooks only)'));
  const SENTENCE = 'Codex CLI MCP servers by settings: 4 enabled, 1 disabled by settings; every configured server is still graded (rubric 1.0.3 open question). Hooks: 4 handlers across 2 events (1 inline in config.toml); none were run. Managed settings: present (allow_managed_hooks_only). ' + codex.NOT_READ + ' Policy values: approval_policy on-request, sandbox_mode danger-full-access (recorded, not graded; configuration evidence, not observed behavior).';
  ok('the COVERAGE line states enablement, hooks, managed presence, and the policy values as recorded, not graded', pos.result.stdout.includes(`Settings read: ${SENTENCE}`), pos.result.stdout.split('\n').filter(l => l.includes('Settings read')).join(' / '));
  ok('the HTML coverage card carries the same sentence', pos.html.includes(`Settings read:</b> ${SENTENCE}`));
  ok('Codex is not claimed as monitored: every observed layer is not_monitored and the sentence says configuration evidence, not observed behavior', pos.exported.evidenceLayers.servers.length === 5 && pos.exported.evidenceLayers.servers.every(s => s.layers.observed.status === 'not_monitored') && SENTENCE.includes('configuration evidence, not observed behavior') && !/monitored|observed calls/.test(SENTENCE));
  const alias = run(['scan', '--only', 'codex-cli', '--quiet'], { home: positive.home, cwd: positive.cwd });
  ok('--only codex and --only codex-cli select the client; the summary counts one agent', alias.code === 0 && alias.stdout.includes('1 agent') && !pos.result.stdout.includes('Cursor'));
  const explicit = exportOf(['scan', '--config', path.join(positive.home, '.codex', 'config.toml'), '--source', 'codex'], { home: positive.home, cwd: positive.cwd });
  ok('an explicit --config scan of a .toml file with --source codex reads the servers and no policy', explicit.result.code === 0 && explicit.exported.discovery.clients[0].files[0].serverCount === 4 && !explicit.exported.discovery.clients[0].mcpPolicy && !explicit.json.includes(CANARY));

  section('Negative: no Codex files, and a Codex file with no servers');
  const bare = makeHome('bare');
  const none = exportOf(['scan'], { home: bare.home, cwd: bare.cwd });
  const noneClient = clientOf(none.exported, 'codex');
  ok('a machine without Codex lists both config locations as not found, reads no hooks or managed file, and prints no settings sentence', none.result.code === 0 && noneClient.files.length === 2 && noneClient.files.every(f => f.status === 'not_found') && !noneClient.mcpPolicy && !none.result.stdout.includes('Settings read:') && !none.exported.inventory.real.agents.some(a => a.name === 'Codex CLI'));
  const empty = makeHome('empty', { '.codex/config.toml': 'model = "o4-mini"\n' });
  const emp = exportOf(['scan', '--only', 'codex'], { home: empty.home, cwd: empty.cwd });
  const empPolicy = clientOf(emp.exported, 'codex').mcpPolicy;
  ok('a config.toml without mcp_servers is found with zero servers, complete, and no policy values', emp.result.code === 0 && clientOf(emp.exported, 'codex').files[0].serverCount === 0 && empPolicy.complete === true && empPolicy.counts.enabled === 0 && empPolicy.policy.approvalPolicy === null && emp.result.stdout.includes('Hooks: none configured.') && emp.result.stdout.includes('Managed settings: no file at 1 checked location.'));

  section('Malformed: TOML that does not parse fails closed');
  const broken = makeHome('broken', { '.codex/config.toml': USER_TOML, 'project/.codex/config.toml': PROJECT_TOML });
  // The prediction export is taken while both files parse; then the project file breaks and verify must withhold.
  const good = exportOf(['scan', '--only', 'codex'], { home: broken.home, cwd: broken.cwd });
  fs.writeFileSync(path.join(broken.cwd, '.codex', 'config.toml'), 'approval_policy = "never\n[mcp_servers.x\ncommand = ');
  const bad = exportOf(['scan', '--only', 'codex'], { home: broken.home, cwd: broken.cwd });
  const badClient = clientOf(bad.exported, 'codex');
  ok('the unparsable file is recorded unreadable with reason invalid TOML; nothing is guessed from it', badClient.files.find(f => f.scope === 'project' && !f.kind).status === 'unreadable' && badClient.files.find(f => f.scope === 'project' && !f.kind).reason === 'invalid TOML' && badClient.files.find(f => f.scope === 'project' && !f.kind).serverCount === 0);
  ok('the scan exits 4 and says Scan incomplete: Codex CLI', bad.result.code === 4 && bad.result.stderr.includes('Scan incomplete: Codex CLI'));
  ok('every enablement state is unknown and the policy is incomplete while a file is unreadable', badClient.mcpPolicy.complete === false && badClient.mcpPolicy.servers.every(s => s.state === 'unknown'));
  ok('the export taken before the break graded all five servers and predicted the project server\'s removal', good.exported && serversOf(good.exported, 'Codex CLI').length === 5 && good.exported.predictions.some(p => p.edit.server === 'repo'));
  const verifyRun = run(['verify', good.file, '--only', 'codex'], { home: broken.home, cwd: broken.cwd });
  const repoRows = verifyRun.stdout.split('\n').filter(l => l.includes('remove repo'));
  ok('verify withholds the vanished project server as UNRESOLVED evidence_incomplete instead of confirming a closure from an unreadable file', repoRows.length > 0 && repoRows.every(l => l.startsWith('UNRESOLVED') && l.includes('evidence_incomplete')) && !verifyRun.stdout.includes('CONFIRMED'), verifyRun.stdout.slice(0, 500));
  const push = run(['push', '--dry-run', '--url', 'http://127.0.0.1:1'], { home: broken.home, cwd: broken.cwd });
  ok('push --dry-run reports the client as unreadable with a fixed reason', push.code !== 0 || /"status": "unreadable"/.test(push.stdout), push.stdout.slice(0, 200));
  const badHooks = makeHome('bad-hooks', { '.codex/config.toml': USER_TOML, '.codex/hooks.json': '{ not json' });
  const bh = exportOf(['scan', '--only', 'codex'], { home: badHooks.home, cwd: badHooks.cwd });
  ok('an unreadable Codex hooks.json is recorded, the hook count is marked incomplete, and the scan exits 4', bh.result.code === 4 && clientOf(bh.exported, 'codex').files.find(f => f.kind === 'hooks' && f.scope === 'user').status === 'unreadable' && clientOf(bh.exported, 'codex').mcpPolicy.hooks.unreadable === 1 && bh.result.stdout.includes('hooks file could not be read, so the hook count is incomplete'));
  const badManaged = makeDir('bad-managed', { 'requirements.toml': 'allowed_sandbox_modes = [' });
  const bm = exportOf(['scan', '--only', 'codex'], { home: positive.home, cwd: positive.cwd, codexManagedDir: badManaged });
  ok('an unreadable managed requirements file makes every state unknown and the scan exit 4', bm.result.code === 4 && clientOf(bm.exported, 'codex').mcpPolicy.servers.every(s => s.state === 'unknown' && s.reason.includes('managed requirements')) && clientOf(bm.exported, 'codex').files.find(f => f.kind === 'managed').reason === 'invalid TOML');
  const allowDir = makeDir('allowlist-managed', { 'requirements.toml': '[mcp_servers.fetch]\n[mcp_servers.repo]\n' });
  const al = exportOf(['scan', '--only', 'codex'], { home: positive.home, cwd: positive.cwd, codexManagedDir: allowDir });
  ok('a managed mcp_servers allowlist disables every server it does not name', stateOf(al.exported, 'fetch') === 'enabled:documented' && stateOf(al.exported, 'repo') === 'enabled:documented' && stateOf(al.exported, 'filesystem') === 'disabled:documented' && clientOf(al.exported, 'codex').mcpPolicy.managed.mcpAllowlist === 2 && al.result.stdout.includes('MCP allowlist: 2 servers'));
  const odd = makeHome('odd', { '.codex/config.toml': 'approval_policy = "yolo"\n[mcp_servers]\nnot_a_table = 1\n[mcp_servers.a]\ncommand = "x"\nenabled = "yes"\n[hooks]\nPreToolUse = "nope"\n' });
  const od = exportOf(['scan', '--only', 'codex'], { home: odd.home, cwd: odd.cwd });
  const oddEntry = clientOf(od.exported, 'codex').files[0];
  ok('wrong-typed values are flagged malformed on the entry, an unknown enum is recorded as unrecognized (not its text), and the scan still exits 0', od.result.code === 0 && oddEntry.malformed === true && oddEntry.policy.approvalPolicy === 'unrecognized' && !od.json.includes('yolo') && oddEntry.serverCount === 1 && stateOf(od.exported, 'a') === 'enabled:documented');
  ok('fileEvidence on a non-object document is empty and flagged, never an error', codex.fileEvidence(null).malformed === true && codex.fileEvidence([1]).disabledServers.length === 0 && codex.serversOf(null) && Object.keys(codex.serversOf({ mcp_servers: { a: 1, b: { command: 'c', args: [1, 'x'] } } })).join() === 'b');

  section('Privacy: counts, enum values, and portable paths only');
  const surfaces = { 'export.json': pos.json, 'report.html': pos.html, 'report.sarif': pos.sarif, terminal: pos.result.stdout + pos.result.stderr };
  const dry = run(['push', '--dry-run', '--url', 'http://127.0.0.1:1'], { home: positive.home, cwd: positive.cwd, codexManagedDir: managedDir });
  surfaces['push --dry-run'] = dry.stdout + dry.stderr;
  const planDiff = run(['plan', '--diff'], { home: positive.home, cwd: positive.cwd, codexManagedDir: managedDir });
  surfaces['plan --diff'] = planDiff.stdout + planDiff.stderr;
  surfaces.history = fs.readFileSync(path.join(positive.home, 'history.json'), 'utf8');
  for (const [name, text] of Object.entries(surfaces)) ok(`${name} carries no hook command, matcher, env value, inline secret, or embedded home path`, !text.includes(CANARY), (text.match(new RegExp(`${CANARY}_[A-Za-z0-9_]+`, 'g')) || []).join(','));
  ok('push --dry-run and plan --diff ran without a process or network attempt', dry.code === 0 && dry.attempts.length === 0 && planDiff.code === 0 && planDiff.attempts.length === 0);
  ok('the export never prints the fixture root; home files are ~-relative and the overridden managed file is fingerprinted', !pos.json.includes(root) && !pos.html.includes(root) && !pos.sarif.includes(root) && clientOf(pos.exported, 'codex').files.find(f => f.scope === 'user' && !f.kind).path === '~/.codex/config.toml' && clientOf(pos.exported, 'codex').files.find(f => f.kind === 'managed').path.startsWith('path_'));
  const literal = exportOf(['scan', '--only', 'codex,cursor'], { home: empty.home, cwd: empty.cwd, env: { BOPPI_CODEX_MANAGED_DIR: '', BOPPI_CURSOR_ENTERPRISE_DIR: '' } });
  ok('the documented machine-wide Codex location keeps its literal path (it names nothing personal)', clientOf(literal.exported, 'codex').files.some(f => f.kind === 'managed' && f.path === '/etc/codex/requirements.toml' && f.status !== 'found'));
  ok('the push wire preview carries coverage per file only, no policy values or hook detail', dry.stdout.includes('"coverage"') && !/"byEvent"|"approvalPolicy"|"mcpPolicy"|"sandboxMode"|"requirements"/.test(dry.stdout));

  section('Remediation refuses to edit TOML and says what to do instead');
  const tomlFile = path.join(positive.home, '.codex', 'config.toml');
  const bytesBefore = fs.readFileSync(tomlFile);
  const fixRun = run(['fix', '--server', 'fetch', '--client', 'codex', '--yes'], { home: positive.home, cwd: positive.cwd, codexManagedDir: managedDir });
  ok('boppi fix exits 2 with the manual-edit message naming the file', fixRun.code === 2 && fixRun.stderr.includes('does not edit TOML files yet') && fixRun.stderr.includes('config.toml') && fixRun.stderr.includes('boppi verify'), fixRun.stderr.slice(0, 300));
  ok('the TOML file is byte-for-byte unchanged and no backup was written', Buffer.compare(fs.readFileSync(tomlFile), bytesBefore) === 0 && !fs.existsSync(path.join(positive.home, '.boppi', 'backups')) && fixRun.attempts.length === 0);
  ok('locateServer never returns a TOML file', fix.locateServer(codex.locate({ home: positive.home, cwd: positive.cwd, platform: 'darwin' }), 'fetch', positive.cwd) === null);
  ok('manualEdit names the TOML file and the reason from the client entries', (() => { const client = clientOf(good.exported, 'codex'); const m = fix.manualEdit({ files: client.files.map(f => ({ ...f, path: f.path })) }, codex.locate({ home: positive.home, cwd: positive.cwd, platform: 'darwin' }), 'fetch'); return m && m.file === '~/.codex/config.toml' && m.reason === codex.MANUAL_EDIT; })());
  const planRun = run(['plan'], { home: positive.home, cwd: positive.cwd, codexManagedDir: managedDir });
  ok('boppi plan phrases the Codex edit as a TOML table and points to a manual edit, never to boppi fix', planRun.code === 0 && planRun.stdout.includes('delete the table [mcp_servers."') && planRun.stdout.includes('edit the TOML file by hand') && !/then: boppi fix --server "\w+" --client codex/.test(planRun.stdout), planRun.stdout.split('\n').filter(l => /codex|TOML|table/.test(l)).join(' / '));
  ok('plan --diff reports the file as edit-by-hand instead of a diff', planDiff.stdout.includes('(edit by hand: Boppi does not edit TOML files yet'));
  ok('filesHolding ignores hook and managed entries so edit instructions name config files only', filesHolding(clientOf(pos.exported, 'codex'), 'fetch').join() === '~/.codex/config.toml');

  section('Cursor hooks: counts per location, malformed files, and no command text');
  const cursorHome = makeHome('cursor', {
    '.cursor/mcp.json': { mcpServers: { puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } } },
    '.cursor/hooks.json': cursorHooksJson('user', [['beforeShellExecution', 2], ['afterMCPExecution', 1]]),
    'project/.cursor/hooks.json': cursorHooksJson('project', [['beforeMCPExecution', 1]]),
  });
  const enterprise = makeDir('cursor-enterprise', { 'hooks.json': { ...cursorHooksJson('ent', [['beforeMCPExecution', 1], ['stop', 1]]), hooks: { beforeMCPExecution: [{ command: `echo ${CANARY}_ent` }, 'junk'], stop: 'nope' } } });
  const cur = exportOf(['scan', '--only', 'cursor'], { home: cursorHome.home, cwd: cursorHome.cwd, cursorEnterpriseDir: enterprise });
  const cursor = clientOf(cur.exported, 'cursor');
  ok('the scan exits 0, starts nothing, and no hook ran', cur.result.code === 0 && cur.result.attempts.length === 0 && !fs.existsSync(HOOK_MARK));
  ok('each hooks.json is an entry with counts and a scope; the config entries keep their shape', cursor.files.filter(f => f.kind === 'hooks').map(f => `${f.scope}:${f.status}:${f.hooks ? f.hooks.handlers : '-'}`).join() === 'user:found:3,project:found:1,enterprise:found:1' && cursor.files.filter(f => !f.kind).length === 2 && cursor.files.find(f => f.kind === 'hooks' && f.scope === 'user').version === 1);
  ok('the combined counts cover handlers, events, byEvent, malformed, and files (a malformed event is not counted)', cursor.hooks.handlers === 5 && cursor.hooks.events === 3 && cursor.hooks.byEvent.beforeShellExecution === 2 && cursor.hooks.byEvent.beforeMCPExecution === 2 && cursor.hooks.files === 3 && cursor.hooks.malformed === true && cursor.hooks.unreadable === 0);
  ok('the terminal lists each hooks file with counts and flags the malformed one', cur.result.stdout.includes('hooks (3 handlers across 2 events)') && cur.result.stdout.includes('hooks (1 handler across 1 event) · malformed entries skipped'));
  const CURSOR_SENTENCE = 'Cursor hooks: 5 handlers across 3 events in 3 files (malformed entries were skipped); none were run, and no command text was recorded.';
  ok('the COVERAGE line and HTML card state the Cursor hook counts', cur.result.stdout.includes(`Settings read: ${CURSOR_SENTENCE}`) && cur.html.includes(`Settings read:</b> ${CURSOR_SENTENCE}`), cur.result.stdout.split('\n').filter(l => l.includes('Settings read')).join(' / '));
  ok('Cursor built-in tools stay not checked: hooks add no grade', cur.exported.inventory.real.permissions.filter(p => p.source.type === 'builtin-tool').every(p => p.accessLevel === 'unknown'));
  for (const [name, text] of Object.entries({ 'export.json': cur.json, 'report.html': cur.html, 'report.sarif': cur.sarif, terminal: cur.result.stdout })) ok(`Cursor ${name} carries no hook command text`, !text.includes(CANARY), (text.match(new RegExp(`${CANARY}_[A-Za-z0-9_]+`, 'g')) || []).join(','));
  const curLiteral = exportOf(['scan', '--only', 'cursor'], { home: cursorHome.home, cwd: cursorHome.cwd, env: { BOPPI_CURSOR_ENTERPRISE_DIR: '' } });
  ok('the documented enterprise location keeps its literal path and the overridden one is fingerprinted', clientOf(curLiteral.exported, 'cursor').files.some(f => f.kind === 'hooks' && f.scope === 'enterprise' && f.path === '/Library/Application Support/Cursor/hooks.json') && cursor.files.find(f => f.scope === 'enterprise').path.startsWith('path_'));
  fs.writeFileSync(path.join(cursorHome.home, '.cursor', 'hooks.json'), '{ "version": 1, "hooks": ');
  const curBad = exportOf(['scan', '--only', 'cursor'], { home: cursorHome.home, cwd: cursorHome.cwd });
  ok('an unreadable Cursor hooks.json is recorded with reason invalid JSON, counted as incomplete, and the scan exits 4', curBad.result.code === 4 && curBad.result.stderr.includes('Scan incomplete: Cursor') && clientOf(curBad.exported, 'cursor').files.find(f => f.kind === 'hooks' && f.scope === 'user').reason === 'invalid JSON' && clientOf(curBad.exported, 'cursor').hooks.unreadable === 1 && curBad.result.stdout.includes('Cursor hooks: 1 hooks file could not be read, so the hook count is incomplete.'));
  const quiet = makeHome('cursor-quiet', { '.cursor/mcp.json': { mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } } });
  const cq = exportOf(['scan', '--only', 'cursor'], { home: quiet.home, cwd: quiet.cwd });
  ok('a Cursor install without hooks files lists the locations as not found and prints no settings sentence', cq.result.code === 0 && clientOf(cq.exported, 'cursor').files.filter(f => f.kind === 'hooks').every(f => f.status === 'not_found') && clientOf(cq.exported, 'cursor').hooks.files === 0 && !cq.result.stdout.includes('Settings read:'));
  ok('countHooks tolerates every wrong shape and counts only well-formed handlers', hooks.countHooks('x').malformed === true && hooks.countHooks({ 'bad event!': [] }).events === 0 && JSON.stringify(hooks.countHooks({ A: [{ command: 'c' }, { hooks: [{ type: 'command' }, 3] }, { hooks: 'x' }, 7] })) === JSON.stringify({ handlers: 2, events: 1, byEvent: { A: 2 }, malformed: true }));

  section('Compatibility: existing clients unchanged');
  const classic = makeHome('classic', { '.claude.json': { mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } } }, '.cursor/mcp.json': { mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } } });
  const cl = exportOf(['scan'], { home: classic.home, cwd: classic.cwd });
  ok('the Claude Code sentence keeps its wording and the Cursor client gains hook entries without changing its config entries', cl.result.stdout.includes('Settings read: Claude Code MCP servers by settings: 1 enabled.') && clientOf(cl.exported, 'cursor').files.filter(f => !f.kind).length === 2 && clientOf(cl.exported, 'cursor').files.filter(f => f.kind === 'hooks').length === 3);
  ok('four clients are listed and the Codex client is last, with every state in the documented set', cl.exported.discovery.clients.map(c => c.clientKey).join() === 'claude-desktop,claude-code,cursor,codex' && [pos, al, bm, bad, emp].every(r => clientOf(r.exported, 'codex').mcpPolicy.servers.every(s => codex.STATES.includes(s.state))));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
