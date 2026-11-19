#!/usr/bin/env node
/** Disabled servers, tool objects, substring grades, and the audit probe. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const parse = require('../src/cli/discovery/parse');
const cursor = require('../src/cli/discovery/cursor');
const claudeDesktop = require('../src/cli/discovery/claudeDesktop');
const { inferCapabilities } = require('../src/cli/knownServers');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0;
let failed = 0;
function ok(name, condition) {
  if (condition) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
}

const cursorExtract = cursor.locate({ home: '/home/example', cwd: '/work' }).files[0].extract;
const claudeExtract = claudeDesktop.locate({ home: '/home/example', platform: 'darwin' }).files[0].extract;
const disabled = {
  mcpServers: {
    live: { command: 'node', args: ['server.js'] },
    'disabled-shell': { command: 'bash', disabled: true },
    'enabled-off': { command: 'sh', enabled: false },
  },
};
const fromCursor = cursorExtract(disabled);
const fromClaude = claudeExtract(disabled);
ok('Cursor locator drops disabled and enabled false', fromCursor.live && !fromCursor['disabled-shell'] && !fromCursor['enabled-off']);
ok('Claude Desktop locator drops disabled and enabled false', fromClaude.live && !fromClaude['disabled-shell'] && !fromClaude['enabled-off']);

const tools = parse.mapServers({
  'custom-tools': {
    command: 'node',
    tools: [{ name: 'run_bash' }, { name: 'read_aws_credentials', description: 'reads keys' }, { id: 'post_slack_message' }],
  },
});
ok('tool objects become tool names', tools['custom-tools'] && tools['custom-tools'].tools.join(',') === 'run_bash,read_aws_credentials,post_slack_message');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-gate-'));
fs.mkdirSync(path.join(home, 'notes'), { recursive: true });
fs.mkdirSync(path.join(home, 'obsidian-vault'), { recursive: true });
const research = inferCapabilities('research-notes', { command: 'node', args: ['index.js'] }, { home });
const sandbox = inferCapabilities('sandbox-helper', { command: 'node', args: ['helper.js'] }, { home });
const vaultDir = inferCapabilities('obsidian', { command: 'npx', args: ['obsidian-mcp', path.join(home, 'obsidian-vault')] }, { home });
const custom = inferCapabilities('custom-tools', tools['custom-tools'], { home });
ok('research-notes does not gain network access', !research.capabilities.includes('network_access') && !research.capabilities.includes('untrusted_external_content'));
ok('sandbox-helper does not gain code execution', !sandbox.capabilities.includes('code_execution'));
ok('obsidian-vault directory is files and not credentials', vaultDir.capabilities.includes('filesystem_access') && !vaultDir.capabilities.includes('credential_access') && vaultDir.capabilityGrades.filesystem_access === 'observed');
ok('declared tool objects are observed capabilities', custom.capabilityGrades.shell_access === 'observed' && custom.capabilityGrades.credential_access === 'observed' && custom.capabilityGrades.messaging_send === 'observed');
const brave = inferCapabilities('brave', { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server@latest'] }, { home });
ok('versioned Brave Search package is network and untrusted content', brave.capabilities.includes('network_access') && brave.capabilities.includes('untrusted_external_content') && brave.capabilityGrades.network_access === 'allowlist');
const onepassword = inferCapabilities('secrets', { command: 'npx', args: ['-y', '1password-mcp@1.2.3'] }, { home });
ok('1password-mcp resolves after the version suffix is stripped', onepassword.capabilities.includes('credential_access') && onepassword.capabilityGrades.credential_access === 'allowlist');
const kube = inferCapabilities('cluster', { command: 'npx', args: ['-y', 'kubernetes-mcp-server@latest'] }, { home });
ok('kubernetes server is shell plus network', kube.capabilities.includes('shell_access') && kube.capabilities.includes('network_access'));
const commands = inferCapabilities('run', { command: 'npx', args: ['-y', 'mcp-server-commands==1.2.0'] }, { home });
ok('mcp-server-commands is shell after the == version is stripped', commands.capabilities.includes('shell_access'));
const { CATALOG } = require('../src/cli/mcpCatalog');
ok('catalog has at least 100 cited servers', CATALOG.length >= 100 && CATALOG.every(entry => typeof entry.citation === 'string' && entry.citation.startsWith('https://')));

fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
  mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'notes')] },
    shell: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
    playwright: { command: 'npx', args: ['-y', '@playwright/mcp'] },
    slack: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], env: { SLACK_BOT_TOKEN: 'present' } },
    'custom-tools': { command: 'node', tools: [{ name: 'run_bash' }, { name: 'read_aws_credentials' }, { name: 'post_slack_message' }] },
    'disabled-shell': { command: 'bash', disabled: true },
  },
}));
fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({
  mcpServers: {
    notes: { command: 'node', args: [path.join(home, 'notes')] },
    'research-notes': { command: 'node', args: ['index.js'] },
    'price-fetch': { command: 'node', args: ['prices.js'] },
    'sandbox-helper': { command: 'node', args: ['helper.js'] },
    obsidian: { command: 'npx', args: ['obsidian-mcp', path.join(home, 'obsidian-vault')] },
    'opaque-bin': { command: 'opaque-bin', args: ['shell,read_secrets,send_slack'] },
    'disabled-shell': { command: 'bash', disabled: true },
    'enabled-off': { command: 'sh', enabled: false },
    'localhost-bridge': { url: 'http://127.0.0.1:9/mcp' },
  },
}));

const jsonPath = path.join(home, 'export.json');
const scan = spawnSync(process.execPath, [CLI, 'scan', '--json', jsonPath, '--home', home, '--cwd', home, '--platform', 'darwin', '--quiet', '--no-color'], { encoding: 'utf8' });
ok('probe scan exits 0', scan.status === 0);
const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const servers = exported.inventory.real.mcpServers;
const byAgent = new Map(exported.inventory.real.agents.map(agent => [agent.id, agent.name]));
function named(agentName, serverName) {
  return servers.find(server => byAgent.get(server.agentId) === agentName && server.name === serverName);
}
ok('disabled shell is absent from both clients', !servers.some(server => server.name === 'disabled-shell' || server.name === 'enabled-off'));
const researchServer = named('Cursor', 'research-notes');
const sandboxServer = named('Cursor', 'sandbox-helper');
const obsidianServer = named('Cursor', 'obsidian');
const loopback = named('Cursor', 'localhost-bridge');
ok('scanned research-notes has no network capability', researchServer && !researchServer.capabilities.includes('network_access'));
ok('scanned sandbox-helper has no code execution', sandboxServer && !sandboxServer.capabilities.includes('code_execution'));
ok('scanned obsidian vault is not a credential server', obsidianServer && obsidianServer.capabilities.includes('filesystem_access') && !obsidianServer.capabilities.includes('credential_access'));
ok('loopback URL is not network access', loopback && !loopback.capabilities.includes('network_access'));
const customServer = named('Claude Desktop', 'custom-tools');
ok('custom tool names are kept and graded observed', customServer && customServer.exposedTools.includes('run_bash') && customServer.capabilityGrades.shell_access === 'observed');

const cursorAgent = exported.inventory.real.agents.find(agent => agent.name === 'Cursor');
const claudeAgent = exported.inventory.real.agents.find(agent => agent.name === 'Claude Desktop');
const cursorCriticalFindings = exported.inventory.real.findings.filter(finding => finding.agentId === cursorAgent.id && finding.severity === 'critical');
const cursorCriticalPaths = exported.exposurePaths.filter(item => item.agentId === cursorAgent.id && item.severity === 'critical');
const claudeCriticalFindings = exported.inventory.real.findings.filter(finding => finding.agentId === claudeAgent.id && finding.severity === 'critical');
ok('Cursor half of the audit probe has no critical finding or path', cursorCriticalFindings.length === 0 && cursorCriticalPaths.length === 0);
ok('Claude Desktop combo stays critical', claudeCriticalFindings.some(finding => finding.ruleId === 'AE-002' || finding.ruleId === 'AE-007'));
ok('export does not contain the planted token value', !JSON.stringify(exported).includes('SLACK_BOT_TOKEN_VALUE') && JSON.stringify(exported).includes('SLACK_BOT_TOKEN'));

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
