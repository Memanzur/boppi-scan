#!/usr/bin/env node
/**
 * Discovery never drops a server silently (QA-002, QA-001).
 *
 * Server names are the user's: "__proto__", "constructor", "toString" and
 * friends stay ordinary servers in every client and in plugins, through the
 * scan, the push body and boppi fix. A Claude Code plugin index with any
 * record Boppi cannot read makes the scan incomplete (exit 4) and the push a
 * merge, keeps the readable plugins, and leaves verification unresolved
 * instead of reading the unread plugin as removed. Synthetic homes only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-discovery-integrity-')));
const run = (home, args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_TOKEN: 'bpc_synthetic_test_token_value_0000', ...env } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const scanJson = (home, extra = []) => {
  const out = path.join(home, 'scan.json');
  const r = run(home, ['scan', '--json', out, ...extra]);
  return { ...r, json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
};
const pushBody = (home, extra = []) => {
  const r = run(home, ['push', '--dry-run', '--url', 'http://127.0.0.1:9', ...extra]);
  return { ...r, body: JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)) };
};
const names = scan => scan.json.inventory.real.mcpServers.map(s => s.name);

// Each prototype-sensitive name carries a distinct grant, so a dropped one is visible as a missing capability, not just a missing name.
// Built with JSON.parse: in an object literal even a quoted '__proto__' key sets the prototype instead of adding an entry.
const TRICKY = JSON.parse(JSON.stringify({
  PROTO: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/'] },
  constructor: { command: 'uvx', args: ['mcp-server-fetch'] },
  toString: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  hasOwnProperty: { command: 'uvx', args: ['mcp-server-time'] },
  valueOf: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
}).replace('"PROTO"', '"__proto__"'));
const serverMapText = () => JSON.stringify(TRICKY);
const EXPECTED = Object.keys(TRICKY).sort();

section('QA-002: prototype-sensitive server names stay servers in every client');
for (const [label, write] of [
  ['Cursor', home => { fs.mkdirSync(path.join(home, '.cursor'), { recursive: true }); fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), `{"mcpServers":${serverMapText()}}`); }],
  ['Claude Desktop', home => { const dir = path.join(home, 'Library', 'Application Support', 'Claude'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), `{"mcpServers":${serverMapText()}}`); }],
  ['Claude Code user scope', home => fs.writeFileSync(path.join(home, '.claude.json'), `{"mcpServers":${serverMapText()}}`)],
  ['Claude Code project scope', home => fs.writeFileSync(path.join(home, '.claude.json'), `{"projects":{${JSON.stringify(home)}:{"mcpServers":${serverMapText()}}}}`)],
]) {
  const home = path.join(root, `names-${label.replace(/\W+/g, '-')}`);
  fs.mkdirSync(home, { recursive: true });
  write(home);
  const scan = scanJson(home);
  const seen = scan.json ? names(scan).sort() : [];
  ok(`${label}: all five servers are in the inventory`, JSON.stringify(seen) === JSON.stringify(EXPECTED), seen.join(','));
  const proto = scan.json && scan.json.inventory.real.mcpServers.find(s => s.name === '__proto__');
  ok(`${label}: "__proto__" keeps its whole-disk filesystem grant and opens a path`, proto && proto.capabilities.includes('filesystem_access') && scan.json.exposurePaths.length > 0, proto && proto.capabilities.join(','));
  const body = pushBody(home).body;
  const pushed = body.records.filter(r => r.kind === 'mcp_server').map(r => r.name).sort();
  ok(`${label}: all five reach the push body`, JSON.stringify(pushed) === JSON.stringify(EXPECTED), pushed.join(','));
}

section('QA-002: boppi fix edits a "__proto__" entry like any other');
{
  const home = path.join(root, 'fix-proto');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const file = path.join(home, '.cursor', 'mcp.json');
  const original = `{"keep":"me","mcpServers":${serverMapText()}}`;
  fs.writeFileSync(file, original);
  const preview = run(home, ['fix', '--server', '__proto__']);
  ok('the preview names the key and writes nothing', preview.code === 2 && preview.stdout.includes('key:     mcpServers."__proto__"') && fs.readFileSync(file, 'utf8') === original, preview.stderr.trim() || preview.stdout.slice(0, 200));
  const applied = run(home, ['fix', '--server', '__proto__', '--yes']);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = Object.keys(after.mcpServers).sort();
  ok('applied: only "__proto__" is gone, the other four and unrelated keys stay', applied.code !== 2 && JSON.stringify(keys) === JSON.stringify(EXPECTED.filter(k => k !== '__proto__')) && after.keep === 'me', `${applied.code} ${keys.join(',')}`);
}

section('QA-002: a plugin server named "__proto__" is scanned');
function pluginHome(name, records, servers) {
  const home = path.join(root, name);
  const plugins = path.join(home, '.claude', 'plugins');
  const install = path.join(plugins, 'cache', 'good');
  fs.mkdirSync(path.join(install, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(install, '.mcp.json'), `{"mcpServers":${servers}}`);
  fs.writeFileSync(path.join(install, '.claude-plugin', 'plugin.json'), '{"name":"good"}');
  fs.writeFileSync(path.join(home, '.claude.json'), '{}');
  fs.mkdirSync(path.join(home, 'docs'));
  const writeIndex = recs => fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: recs(install) }));
  writeIndex(records);
  return { home, writeIndex, install };
}
{
  const { home } = pluginHome('plugin-proto', install => ({ 'good@qa': [{ scope: 'user', installPath: install, version: '1.0.0' }] }), `{"__proto__":${JSON.stringify(TRICKY.__proto__)}}`);
  const scan = scanJson(home);
  ok('plugin:good:__proto__ is in the inventory with its grant', scan.json && scan.json.inventory.real.mcpServers.some(s => s.name === 'plugin:good:__proto__' && s.capabilities.includes('filesystem_access')), scan.json && names(scan).join(','));
}

section('QA-001: an install record Boppi cannot read makes discovery incomplete');
const goodServers = home => `{"files":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem",${JSON.stringify(path.join(home, 'docs'))}]},"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}`;
const valid = install => ({ 'good@qa': [{ scope: 'user', installPath: install, version: '1.0.0' }] });
const broken = { scope: 'user', installPath: 'relative/path', version: '1.0.0' };
for (const [label, records, expectGood] of [
  ['a valid record beside a relative installPath', install => ({ ...valid(install), 'broken@qa': [broken] }), true],
  ['a valid record beside an invalid plugin name', install => ({ ...valid(install), '../evil@qa': [{ scope: 'user', installPath: install, version: '1.0.0' }] }), true],
  ['a second, unreadable record under the valid id', install => ({ 'good@qa': [{ scope: 'user', installPath: install, version: '1.0.0' }, { scope: 'project' }] }), true],
  ['only invalid records', () => ({ 'broken@qa': [broken] }), false],
]) {
  const home = path.join(root, `index-${label.replace(/\W+/g, '-')}`);
  fs.mkdirSync(home, { recursive: true });
  const fixture = pluginHome(path.relative(root, home), records, '{}');
  fs.writeFileSync(path.join(fixture.install, '.mcp.json'), `{"mcpServers":${goodServers(fixture.home)}}`);
  const scan = scanJson(fixture.home);
  ok(`${label}: scan exits 4`, scan.code === 4, `exit ${scan.code}`);
  ok(`${label}: readable plugins are still scanned`, expectGood ? names(scan).includes('plugin:good:fetch') : !names(scan).some(n => n.startsWith('plugin:')), names(scan).join(','));
  const push = pushBody(fixture.home);
  const code = push.body.coverage.clients.find(c => c.key === 'claude-code');
  ok(`${label}: full-scope push merges, never replaces`, push.body.coverage.scope === 'full' && push.body.snapshot !== true && code && code.status === 'unreadable', JSON.stringify(code));
  ok(`${label}: the push names a fixed reason, never a path`, code && code.reason === 'configuration could not be analyzed' && !JSON.stringify(push.body.coverage).includes(fixture.home), code && code.reason);
}
{
  const fixture = pluginHome('index-control', valid, '{}');
  fs.writeFileSync(path.join(fixture.install, '.mcp.json'), `{"mcpServers":${goodServers(fixture.home)}}`);
  const scan = scanJson(fixture.home);
  const push = pushBody(fixture.home);
  ok('control: a fully readable index scans complete and pushes a snapshot', scan.code === 0 && push.body.snapshot === true, `exit ${scan.code}, snapshot ${push.body.snapshot}`);

  section('QA-001: a plugin hidden by an unreadable record is not verified absent');
  const before = path.join(fixture.home, 'before.json');
  run(fixture.home, ['scan', '--json', before]);
  const predictions = JSON.parse(fs.readFileSync(before, 'utf8')).predictions.filter(p => p.client.key === 'claude-code');
  ok('the baseline predicts removals for the plugin servers', predictions.length > 0, String(predictions.length));
  // The same install, now recorded with a relative path: Boppi cannot read it, so its servers drop out of the rescan.
  fixture.writeIndex(() => ({ 'good@qa': [{ scope: 'user', installPath: 'cache/good', version: '1.0.0' }] }));
  const graded = run(fixture.home, ['verify', before]);
  const rows = graded.stdout.split('\n').filter(line => /^(CONFIRMED|PARTIAL|CONTRADICTED|UNRESOLVED)\s/.test(line));
  ok('every claude-code prediction stays UNRESOLVED, none CONFIRMED', rows.length >= predictions.length && rows.every(line => line.startsWith('UNRESOLVED')) && !graded.stdout.includes('CONFIRMED  Claude Code'), rows.join(' | ') || graded.stdout.slice(-300));
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
