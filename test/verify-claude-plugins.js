#!/usr/bin/env node
/** Claude Code plugin MCP servers are discovered from the documented plugin layout, graded, and never edited (D-2). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const fix = require('../src/cli/fix');
const plugins = require('../src/cli/discovery/claudePlugins');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function makeHome(root) {
  const home = path.join(root, 'home');
  const cache = path.join(home, '.claude', 'plugins', 'cache', 'acme');
  const deploy = path.join(cache, 'deploy-tools', '1.2.0');
  const notes = path.join(cache, 'notes', '0.1.0');
  const quiet = path.join(cache, 'quiet', '2.0.0');
  write(path.join(home, '.claude.json'), { mcpServers: { db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] } } });
  write(path.join(home, '.claude', 'settings.json'), { enabledPlugins: { 'deploy-tools@acme': true, 'notes@acme': false } });
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'deploy-tools@acme': [{ scope: 'user', installPath: deploy, version: '1.2.0' }],
      'notes@acme': [{ scope: 'user', installPath: notes, version: '0.1.0' }],
      'quiet@acme': [{ scope: 'project', installPath: quiet, version: '2.0.0' }],
      'broken@acme': [{ scope: 'user', installPath: 'relative/path', version: '1.0.0' }],
    },
  });
  write(path.join(deploy, '.mcp.json'), { mcpServers: { db: { command: '${CLAUDE_PLUGIN_ROOT}/bin/db', args: ['--write'], env: { DB_TOKEN: 'PLUGINSECRETVALUE' } } } });
  write(path.join(deploy, '.claude-plugin', 'plugin.json'), { name: 'deploy-tools', mcpServers: { api: { url: 'https://api.example.test/mcp' } } });
  write(path.join(notes, '.claude-plugin', 'plugin.json'), { name: 'notes', mcpServers: './mcp/servers.json' });
  write(path.join(quiet, '.claude-plugin', 'plugin.json'), { name: 'quiet', defaultEnabled: false, mcpServers: { fetcher: { command: 'uvx', args: ['mcp-server-fetch'] } } });
  return { home, deploy, notes, quiet };
}

function runCli(args, home, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--only', 'claude-code', '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', CLAUDE_CODE_PLUGIN_CACHE_DIR: '', ...env } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function snapshot(dir) {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = fs.readFileSync(p, 'utf8'); } };
  walk(dir);
  return out;
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-plugins-'));
  const fx = makeHome(root);
  const { home } = fx;
  const descriptor = fix.descriptorsFor({ home, cwd: home, platform: 'darwin' }).find(d => d.clientKey === 'claude-code');

  section('Discovery reads the documented plugin layout');
  const { servers, files } = fix.readClient(descriptor, home);
  const labels = servers.map(s => s.label).sort();
  ok('plugin servers register as plugin:<name>:<server> next to the user server of the same name', JSON.stringify(labels) === JSON.stringify(['db', 'plugin:deploy-tools:api', 'plugin:deploy-tools:db', 'plugin:quiet:fetcher']), labels.join(', '));
  ok('a prefixed label is not reported as a rename', files.every(f => !f.renamed));
  ok('plugin entries carry their plugin and are marked read-only', servers.filter(s => s.label.startsWith('plugin:')).every(s => s.readOnly === true) && !servers.find(s => s.label === 'db').readOnly);
  const enablement = Object.fromEntries(files.filter(f => f.plugin).map(f => [f.plugin.id, f.plugin.enablement]));
  ok('enablement is recorded from enabledPlugins, and from defaultEnabled when unset', enablement['deploy-tools@acme'].state === 'enabled' && enablement['deploy-tools@acme'].source === 'user' && enablement['notes@acme'].state === 'disabled' && enablement['quiet@acme'].state === 'disabled' && enablement['quiet@acme'].source === 'default');
  const notesManifest = files.find(f => f.path === path.join(fx.notes, '.claude-plugin', 'plugin.json'));
  ok('mcpServers given as a file path is unreadable with a reason, never silently empty', notesManifest.status === 'unreadable' && /does not read yet/.test(notesManifest.reason), notesManifest.reason);
  // QA-001: a skipped record may hold servers, so the index is unreadable evidence while the readable installs are still scanned.
  ok('an install record with a relative installPath is counted and makes the index unreadable', descriptor.pluginIndex.status === 'unreadable' && descriptor.pluginIndex.reason === 'unsupported install record shape' && descriptor.pluginIndex.installs === 3 && descriptor.pluginIndex.skipped === 1);

  section('The scan grades plugin servers and keeps their secrets and paths out of the export');
  const exportFile = path.join(root, 'scan.json');
  const scan = runCli(['scan', '--json', exportFile, '--quiet'], home);
  const exported = fs.existsSync(exportFile) ? read(exportFile) : null;
  const names = exported ? exported.inventory.real.mcpServers.map(s => s.name).sort() : [];
  ok('the export lists every discovered server', JSON.stringify(names) === JSON.stringify(labels), names.join(', '));
  ok('a plugin server is graded like any other (the fetch server reaches the web)', exported && exported.inventory.real.mcpServers.find(s => s.name === 'plugin:quiet:fetcher').capabilities.length > 0);
  ok('the unreadable plugin.json makes the scan incomplete (exit 4)', scan.code === 4, `exit ${scan.code}`);
  const serialized = JSON.stringify(exported);
  ok('a plugin env value never appears in the export', exported && !serialized.includes('PLUGINSECRETVALUE'));
  const client = exported && exported.discovery.clients.find(c => c.clientKey === 'claude-code');
  ok('plugin file and index paths are ~-relative', client && client.files.filter(f => f.plugin || f.kind === 'plugin-index').length === 7 && client.files.every(f => f.path.startsWith('~/')) && !serialized.includes(home));

  section('Boppi never edits a plugin file');
  const before = snapshot(path.join(home, '.claude', 'plugins'));
  ok('locateServer returns nothing for a plugin server and still finds the user server', fix.locateServer(descriptor, 'plugin:deploy-tools:db', home) === null && fix.locateServer(descriptor, 'db', home) !== null);
  const fixRun = runCli(['fix', '--server', 'plugin:deploy-tools:db', '--yes'], home);
  ok('boppi fix exits 2 and says to disable the plugin', fixRun.code === 2 && fixRun.stderr.includes('claude plugin disable deploy-tools@acme') && fixRun.stderr.includes('boppi verify'), fixRun.stderr.slice(0, 300));
  ok('no plugin file changed and no backup was written', JSON.stringify(snapshot(path.join(home, '.claude', 'plugins'))) === JSON.stringify(before) && !fs.existsSync(path.join(home, '.boppi', 'backups')));
  const remedy = plugins.pluginRemedy(client, 'plugin:quiet:fetcher');
  ok('pluginRemedy names the plugin id from the scanned entries', remedy && remedy.plugin === 'quiet@acme' && plugins.pluginRemedy(client, 'db') === null);

  section('Install records Boppi cannot read are visible, not ignored');
  for (const [label, content, reason] of [['invalid JSON', '{ not json', 'invalid JSON'], ['an unexpected shape', JSON.stringify([{ installPath: fx.deploy }]), 'unsupported install record shape']]) {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-plugins-bad-'));
    write(path.join(other, '.claude', 'plugins', 'installed_plugins.json'), content);
    const { index, files: pluginEntries } = plugins.pluginFiles({ home: other, cwd: other });
    ok(`${label} in installed_plugins.json is unreadable with "${reason}" and adds no servers`, index.status === 'unreadable' && index.reason === reason && pluginEntries.length === 0);
    const run = runCli(['scan', '--quiet'], other);
    ok(`a scan with ${label} in the index reports incomplete coverage (exit 4)`, run.code === 4, `exit ${run.code}`);
  }

  section('Without plugins nothing changes');
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-plugins-none-'));
  write(path.join(plain, '.claude.json'), { mcpServers: { db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] } } });
  const plainDescriptor = fix.descriptorsFor({ home: plain, cwd: plain, platform: 'darwin' }).find(d => d.clientKey === 'claude-code');
  ok('no plugins root means the same two config files and no index entry', plainDescriptor.files.length === 2 && plainDescriptor.pluginIndex.status === 'not_found');
  const plainExport = path.join(plain, 'scan.json');
  const plainRun = runCli(['scan', '--json', plainExport, '--quiet'], plain);
  ok('a scan without plugins completes and lists no plugin entries', plainRun.code !== 4 && read(plainExport).discovery.clients.find(c => c.clientKey === 'claude-code').files.every(f => !f.plugin && f.kind !== 'plugin-index'), `exit ${plainRun.code}`);

  section('CLAUDE_CODE_PLUGIN_CACHE_DIR moves the plugins root');
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-plugins-moved-'));
  fs.cpSync(path.join(home, '.claude', 'plugins'), path.join(moved, 'plugins'), { recursive: true });
  const movedIndex = plugins.pluginFiles({ home: plain, cwd: plain, pluginRoot: path.join(moved, 'plugins') }).index;
  ok('the index is read from the override root', movedIndex.installs === 3 && movedIndex.path === path.join(moved, 'plugins', 'installed_plugins.json'));
  const envRun = runCli(['scan', '--json', path.join(plain, 'env.json'), '--quiet'], plain, { CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(moved, 'plugins') });
  const envNames = read(path.join(plain, 'env.json')).inventory.real.mcpServers.map(s => s.name);
  ok('the CLI honors the environment variable', envRun.code !== null && envNames.includes('plugin:deploy-tools:api'), envNames.join(', '));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
