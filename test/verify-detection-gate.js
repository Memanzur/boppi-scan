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
const { unwrapLaunch, commandStem } = require('../src/cli/discovery/secrets');

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
const referencePackages = [
  ['memory', '@modelcontextprotocol/server-memory'],
  ['sequential-thinking', '@modelcontextprotocol/server-sequential-thinking'],
  ['time', '@modelcontextprotocol/server-time'],
  ['everything', '@modelcontextprotocol/server-everything'],
];
for (const [name, pkg] of referencePackages) {
  const inferred = inferCapabilities(name, { command: 'npx', args: ['-y', pkg] }, { home });
  const catalogHit = inferred.inferences.some(item => item.grade === 'allowlist' && item.label !== 'directory arguments' && item.label !== 'remote MCP server');
  ok(`${name} is a known catalog reference server`, catalogHit && !inferred.capabilities.includes('network_access') && !inferred.capabilities.includes('shell_access') && !inferred.capabilities.includes('credential_access'));
}
const timeLatest = inferCapabilities('clock', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-time@latest'] }, { home });
const timeExact = inferCapabilities('clock', { command: 'uvx', args: ['mcp-server-time==0.6.3'] }, { home });
ok('official time stays known with @latest and an exact == pin', [timeLatest, timeExact].every(inferred => inferred.inferences.some(item => item.grade === 'allowlist' && item.label === 'time') && !inferred.capabilities.includes('network_access')));
const evilEverything = inferCapabilities('demo', { command: 'npx', args: ['-y', '@evil/server-everything'] }, { home });
const evilMemory = inferCapabilities('demo', { command: 'npx', args: ['-y', '@evil/server-memory'] }, { home });
const namedMemory = inferCapabilities('memory', { command: 'node', args: ['server.js'] }, { home });
const namedEverything = inferCapabilities('everything', { command: 'npx', args: ['-y', 'mcp-server-fetch'] }, { home });
const allowHit = inferred => inferred.inferences.some(item => item.grade === 'allowlist' && (item.label === 'everything' || item.label === 'memory'));
ok('@evil/server-everything and @evil/server-memory stay off the official allowlist', !allowHit(evilEverything) && !allowHit(evilMemory));
ok('a server merely named memory or everything is not the official server', !allowHit(namedMemory) && !allowHit(namedEverything));
ok('a server named everything still keeps the fetch package capabilities', namedEverything.capabilities.includes('network_access') && namedEverything.capabilities.includes('untrusted_external_content'));
const decoy = inferCapabilities('decoy', { command: 'node', args: ['evil.js', '@modelcontextprotocol/server-everything'] }, { home });
ok('a decoy official package argument is not an allowlist hit', !decoy.inferences.some(item => item.grade === 'allowlist' && item.label === 'everything'));
const nodeFetch = inferCapabilities('nodeFetch', { command: 'node', args: ['evil.js', 'mcp-server-fetch'] }, { home });
const nodeFiles = inferCapabilities('nodeFiles', { command: 'node', args: ['evil.js', '@modelcontextprotocol/server-filesystem'] }, { home });
ok('node evil.js does not inherit the official fetch or filesystem allowlist', !nodeFetch.inferences.some(item => item.grade === 'allowlist') && !nodeFiles.inferences.some(item => item.grade === 'allowlist'));
const wrapped = [
  ['cmd', ['/c', 'node', 'evil.js', '@modelcontextprotocol/server-filesystem']],
  ['C:\\Windows\\System32\\cmd.exe', ['/c', 'node', 'evil.js', 'mcp-server-fetch']],
  ['cmd', ['/k', 'node', 'evil.js', 'mcp-server-fetch']],
  ['sh', ['-c', 'node evil.js mcp-server-fetch']],
  ['bash', ['-c', 'node evil.js mcp-server-fetch']],
  ['zsh', ['-c', 'node evil.js mcp-server-fetch']],
  ['dash', ['-c', 'node evil.js mcp-server-fetch']],
  ['powershell', ['-Command', 'node evil.js mcp-server-fetch']],
  ['pwsh', ['-File', 'evil.ps1', 'mcp-server-fetch']],
  ['env', ['FOO=bar', 'node', 'evil.js', 'mcp-server-fetch']],
  ['sudo', ['-u', 'root', 'node', 'evil.js', 'mcp-server-fetch']],
  ['doas', ['node', 'evil.js', 'mcp-server-fetch']],
  ['nice', ['-n', '10', 'node', 'evil.js', 'mcp-server-fetch']],
  ['nohup', ['node', 'evil.js', 'mcp-server-fetch']],
  ['time', ['-p', 'node', 'evil.js', 'mcp-server-fetch']],
  ['wsl', ['-e', 'node', 'evil.js', 'mcp-server-fetch']],
  ['start', ['/b', 'node', 'evil.js', 'mcp-server-fetch']],
];
for (const [command, wrapArgs] of wrapped) {
  const inferred = inferCapabilities('wrapped', { command, args: wrapArgs }, { home });
  ok(`${command} wrapper does not allowlist the inner script package`, !inferred.inferences.some(item => item.grade === 'allowlist'));
}
const viaNpx = inferCapabilities('via', { command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem'] }, { home });
ok('cmd /c npx still allowlists the filesystem server', viaNpx.inferences.some(item => item.grade === 'allowlist' && item.label === 'filesystem'));
const npxExec = inferCapabilities('execd', { command: 'npx', args: ['exec', '@modelcontextprotocol/server-filesystem'] }, { home });
ok('npx exec launches the filesystem package', npxExec.inferences.some(item => item.grade === 'allowlist' && item.label === 'filesystem'));
const ambiguous = inferCapabilities('ambiguous', { command: 'sh', args: ['-c', 'npx -y mcp-server-fetch && curl evil.example'] }, { home });
ok('a shell pipeline is not allowlisted', !ambiguous.inferences.some(item => item.grade === 'allowlist'));
const repro = unwrapLaunch('cmd', ['/c', 'npx -y mcp-server-fetch@latest']);
ok('cmd /c keeps the package when it is the last token of a string', !repro.ambiguous && repro.command === 'npx' && repro.args[repro.args.length - 1] === 'mcp-server-fetch@latest');
const quotedSpace = unwrapLaunch('cmd', ['/c', 'npx -y "my package"']);
ok('a quoted space is not treated as a finished split', quotedSpace.ambiguous === true);
const openQuote = unwrapLaunch('sh', ['-c', 'npx -y "mcp-server-fetch@latest']);
ok('an unmatched quote stays incomplete', openQuote.ambiguous === true);
const shellForms = [
  ['cmd /c', text => ['cmd', ['/c', text]]],
  ['cmd /s /c', text => ['cmd', ['/s', '/c', `"${text.trim()}"`]]],
  ['bash -c', text => ['bash', ['-c', text]]],
  ['bash -lc', text => ['bash', ['-lc', text]]],
  ['sh -c', text => ['sh', ['-c', text]]],
  ['zsh -c', text => ['zsh', ['-c', text]]],
  ['pwsh -Command', text => ['pwsh', ['-Command', text]]],
  ['env -S', text => ['env', ['-S', text]]],
];
const shellTexts = [
  ['last', 'npx -y mcp-server-fetch@latest'],
  ['middle', 'npx -y mcp-server-fetch@latest --offline'],
  ['trailing', 'npx -y mcp-server-fetch@latest   '],
];
for (const [label, wrap] of shellForms) {
  for (const [place, text] of shellTexts) {
    const [command, wrapArgs] = wrap(text);
    const launch = unwrapLaunch(command, wrapArgs);
    const inferred = inferCapabilities('probe', { command, args: wrapArgs }, { home });
    const allow = inferred.inferences.some(item => item.grade === 'allowlist' && item.label === 'fetch');
    ok(`${label} ${place} token keeps mcp-server-fetch and allowlists fetch`, !launch.ambiguous && launch.command === 'npx' && launch.args.includes('mcp-server-fetch@latest') && allow);
  }
}
function shellVerdict(command, args) {
  const launch = unwrapLaunch(command, args);
  const inferred = inferCapabilities('probe', { command, args }, { home });
  const labels = inferred.inferences.filter(item => item.grade === 'allowlist').map(item => item.label).sort();
  return JSON.stringify({
    ambiguous: !!launch.ambiguous,
    command: launch.ambiguous ? '' : commandStem(launch.command),
    args: launch.ambiguous ? [] : launch.args,
    labels,
  });
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
const sampleWords = ['npx', '-y', '--offline', 'mcp-server-fetch@latest', '@modelcontextprotocol/server-filesystem', 'extra', 'pkg-name', 'node', 'evil.js'];
const random = mulberry32(0xC0FFEE);
let propertyMisses = 0;
for (let sample = 0; sample < 40; sample++) {
  const count = 1 + Math.floor(random() * 4);
  const tokens = [];
  for (let i = 0; i < count; i++) tokens.push(sampleWords[Math.floor(random() * sampleWords.length)]);
  const inner = tokens.join(' ');
  const bare = shellVerdict(tokens[0], tokens.slice(1));
  const wrapped = [
    ['cmd', ['/c', inner]],
    ['cmd', ['/c', `${inner}   `]],
    ['cmd', ['/s', '/c', `"${inner}"`]],
    ['bash', ['-c', inner]],
    ['bash', ['-lc', `${inner}  `]],
    ['sh', ['-c', inner]],
    ['zsh', ['-c', inner]],
    ['pwsh', ['-Command', inner]],
    ['env', ['-S', inner]],
    ['cmd', ['/c', ...tokens]],
    ['bash', ['-c', ...tokens]],
    ['sh', ['-c', ...tokens]],
  ];
  for (const [command, wrapArgs] of wrapped) {
    if (shellVerdict(command, wrapArgs) !== bare) propertyMisses += 1;
  }
}
ok('string form and array form produce the same verdict', propertyMisses === 0);
for (const command of ['python3.11', 'python3.11rc1', 'python3.13t', 'python3', 'node22', 'node.exe', 'node.cmd', 'nodejs', '/usr/bin/node.exe', 'bun.exe', 'deno', 'pythonw', 'py', 'C:\\Program Files\\nodejs\\node.cmd']) {
  const inferred = inferCapabilities('tool', { command, args: ['evil.js', '@modelcontextprotocol/server-filesystem'] }, { home });
  ok(`${command} does not allowlist a script's later package`, !inferred.inferences.some(item => item.grade === 'allowlist'));
}

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
