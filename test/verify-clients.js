#!/usr/bin/env node
/** New-client discovery: parsers, paths, a fake-home scan, and redaction. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const parse = require('../src/cli/discovery/parse');
const catalog = require('../src/cli/discovery/catalog');
const presence = require('../src/cli/discovery/presence');
const projects = require('../src/cli/discovery/projects');
const secrets = require('../src/cli/discovery/secrets');
const push = require('../src/cli/push');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const FIX = path.join(__dirname, 'fixtures', 'clients');
const SECRET = 'sk-ant-plaintexttestvalue123456';
const DOT_SECRET = 'sk-ant-dotenvplaintextvalue123456';
const AWS_SECRET = 'AKIAplaintexttestvalue123456';

let passed = 0, failed = 0;
function ok(name, condition) {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

function read(name) { return fs.readFileSync(path.join(FIX, name), 'utf8'); }

(function parsers() {
  section('Parsers against fixtures');
  const settings = parse.vscodeServers(parse.parseJsonc(read('vscode-settings.jsonc')));
  ok('VS Code settings mcp key yields the filesystem server', settings.filesystem && settings.filesystem.command === 'npx');
  const mcp = parse.vscodeServers(JSON.parse(read('vscode-mcp.json')));
  ok('VS Code mcp.json uses the servers key', mcp.fetch && mcp.fetch.url === 'https://example.test/mcp');
  const cline = parse.mapServers(JSON.parse(read('cline.json')).mcpServers);
  ok('a disabled Cline server is not a grant', cline.filesystem && cline.fetch && !cline['turned-off'] && cline.filesystem.tools.includes('read_file'));
  const cont = parse.continueServers(read('continue.yaml'));
  ok('Continue YAML list is keyed by name and skips enabled: false', cont.filesystem && cont.fetch && !cont['turned-off'] && cont.filesystem.args.includes('@modelcontextprotocol/server-filesystem'));
  const zed = parse.zedServers(parse.parseJsonc(read('zed.jsonc')));
  ok('Zed context_servers survive JSONC comments and trailing commas', zed.filesystem && zed.fetch.url.startsWith('https://'));
  const gemini = parse.mapServers(JSON.parse(read('gemini.json')).mcpServers);
  ok('Gemini httpUrl is the server endpoint', gemini.fetch.url === 'https://example.test/mcp');
  const codex = parse.codexServers(read('codex.toml'));
  ok('Codex TOML tables parse and enabled=false is skipped', codex.filesystem && codex.fetch && !codex['turned-off'] && codex.filesystem.command === 'npx');
  const goose = parse.gooseServers(read('goose.yaml'));
  ok('Goose developer extension is file and shell, and a disabled extension is skipped', goose.developer.capabilities.includes('filesystem_access') && goose.developer.capabilities.includes('shell_access') && goose.fetch.url && !goose['turned-off']);
  const wind = JSON.parse(read('windsurf.json')).mcpServers.fetch;
  ok('an env value that looks like a key is flagged by name only', secrets.inlineCredentialLabels(wind).includes('OPENAI_API_KEY') && !secrets.inlineCredentialLabels({ env: { OPENAI_API_KEY: '${OPENAI_API_KEY}' } }).length);
  const header = secrets.inlineCredentialLabels(JSON.parse(read('lmstudio.json')).mcpServers.fetch);
  ok('a bearer header is flagged as a header name, not the value', header.includes('header:Authorization') && !header.join(' ').includes(SECRET));
  const dot = secrets.namesInText(read('zshrc.txt'));
  ok('dotfile scan keeps set names and drops empty or placeholder values', dot.includes('ANTHROPIC_API_KEY') && !dot.includes('GROQ_API_KEY') && !dot.includes('MISTRAL_API_KEY'));
  const aws = secrets.namesInText(read('aws-credentials.txt'), { ini: true });
  ok('AWS credentials file reports the canonical key names', aws.includes('AWS_ACCESS_KEY_ID') && aws.includes('AWS_SECRET_ACCESS_KEY') && !aws.join(' ').includes(AWS_SECRET));
})();

(function paths() {
  section('Documented config paths');
  const home = path.join('/tmp', 'boppi-path-home');
  const linux = catalog.locateAll({ home, cwd: path.join(home, 'proj'), platform: 'linux' });
  const byKey = list => Object.fromEntries(list.map(d => [d.clientKey, d.files.map(f => f.path)]));
  const linuxFiles = byKey(linux);
  ok('linux Zed settings are ~/.config/zed/settings.json', linuxFiles.zed.includes(path.join(home, '.config', 'zed', 'settings.json')));
  ok('linux VS Code user mcp.json is under ~/.config/Code/User', linuxFiles.vscode.includes(path.join(home, '.config', 'Code', 'User', 'mcp.json')));
  ok('linux Cline globalStorage uses the claude-dev extension id', linuxFiles.cline.some(f => f.endsWith(path.join('Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'))));
  ok('linux Roo reads mcp_settings.json', linuxFiles.roo.some(f => f.endsWith(path.join('rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'))));
  ok('linux Goose config is ~/.config/goose/config.yaml', linuxFiles.goose.includes(path.join(home, '.config', 'goose', 'config.yaml')));
  ok('Gemini, Codex, Amazon Q, Junie, and LM Studio use their home paths',
    linuxFiles['gemini-cli'].includes(path.join(home, '.gemini', 'settings.json'))
    && linuxFiles.codex.includes(path.join(home, '.codex', 'config.toml'))
    && linuxFiles['amazon-q'].includes(path.join(home, '.aws', 'amazonq', 'mcp.json'))
    && linuxFiles['amazon-q'].includes(path.join(home, '.aws', 'amazonq', 'default.json'))
    && linuxFiles.jetbrains.includes(path.join(home, '.junie', 'mcp', 'mcp.json'))
    && linuxFiles.lmstudio.includes(path.join(home, '.lmstudio', 'mcp.json')));
  ok('Windsurf reads the codeium path and the documented Devin path',
    linuxFiles.windsurf.includes(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'))
    && linuxFiles.windsurf.includes(path.join(home, '.config', 'devin', 'mcp_config.json')));

  const previousAppData = process.env.APPDATA;
  const previousLocal = process.env.LOCALAPPDATA;
  process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
  process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  const win = byKey(catalog.locateAll({ home, cwd: path.join(home, 'proj'), platform: 'win32' }));
  if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
  if (previousLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previousLocal;
  ok('windows VS Code mcp.json is under %APPDATA%\\Code\\User', win.vscode.includes(path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')));
  ok('windows Goose config is %APPDATA%\\Block\\goose\\config\\config.yaml', win.goose.includes(path.join(home, 'AppData', 'Roaming', 'Block', 'goose', 'config', 'config.yaml')));
  ok('windows Zed settings are under %APPDATA%\\Zed', win.zed.includes(path.join(home, 'AppData', 'Roaming', 'Zed', 'settings.json')));

  const mac = byKey(catalog.locateAll({ home, cwd: path.join(home, 'proj'), platform: 'darwin' }));
  ok('macOS Claude-style editor paths stay under Application Support', mac.vscode.includes(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')) && mac.zed.includes(path.join(home, 'Library', 'Application Support', 'Zed', 'settings.json')));
  ok('workspace .vscode/mcp.json is the VS Code project file', mac.vscode.includes(path.join(home, 'proj', '.vscode', 'mcp.json')));
})();

function writeFixture(file, name) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIX, name), file);
}

function makeHome(root) {
  const home = path.join(root, 'home');
  const app = path.join(home, 'Library', 'Application Support');
  writeFixture(path.join(app, 'Code', 'User', 'settings.json'), 'vscode-settings.jsonc');
  writeFixture(path.join(app, 'Code', 'User', 'mcp.json'), 'vscode-mcp.json');
  writeFixture(path.join(home, '.copilot', 'mcp-config.json'), 'copilot.json');
  writeFixture(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'windsurf.json');
  writeFixture(path.join(app, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'), 'cline.json');
  writeFixture(path.join(app, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'), 'roo.json');
  writeFixture(path.join(home, '.continue', 'config.yaml'), 'continue.yaml');
  writeFixture(path.join(app, 'Zed', 'settings.json'), 'zed.jsonc');
  writeFixture(path.join(home, '.gemini', 'settings.json'), 'gemini.json');
  writeFixture(path.join(home, '.codex', 'config.toml'), 'codex.toml');
  writeFixture(path.join(home, '.aws', 'amazonq', 'mcp.json'), 'amazonq.json');
  writeFixture(path.join(home, '.junie', 'mcp', 'mcp.json'), 'junie.json');
  writeFixture(path.join(home, '.config', 'goose', 'config.yaml'), 'goose.yaml');
  writeFixture(path.join(home, '.lmstudio', 'mcp.json'), 'lmstudio.json');
  writeFixture(path.join(home, 'Projects', 'app', '.mcp.json'), 'project-mcp.json');
  writeFixture(path.join(home, 'Projects', 'app', '.cursor', 'mcp.json'), 'project-cursor.json');
  writeFixture(path.join(home, 'Projects', 'org', 'nested', '.mcp.json'), 'project-mcp.json');
  writeFixture(path.join(home, 'Projects', 'a', 'b', 'c', '.mcp.json'), 'trap.json');
  writeFixture(path.join(home, 'Projects', 'app', 'node_modules', 'pkg', '.mcp.json'), 'trap.json');
  fs.mkdirSync(path.join(home, 'Applications', 'ChatGPT.app'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Google', 'Chrome', 'Default', 'Extensions', 'hehggadaopoacecdllhhajmbjkdcmajg', '1.0'), { recursive: true });
  writeFixture(path.join(home, '.zshrc'), 'zshrc.txt');
  writeFixture(path.join(home, '.aws', 'credentials'), 'aws-credentials.txt');
  return home;
}

(function scan() {
  section('End-to-end scan of a fake home');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-clients-'));
  const home = makeHome(root);
  const hits = projects.walkProjectConfigs(home);
  ok('project walk finds .mcp.json and .cursor/mcp.json and skips node_modules and depth 3',
    hits.some(h => h.path.endsWith(path.join('Projects', 'app', '.mcp.json')))
    && hits.some(h => h.path.endsWith(path.join('Projects', 'org', 'nested', '.mcp.json')))
    && hits.some(h => h.kind === 'cursor')
    && !hits.some(h => h.path.includes('node_modules') || h.path.includes(`${path.sep}c${path.sep}`)));

  const extensions = presence.discoverExtensions(home, 'darwin');
  ok('Chrome extension id is detected without reading the extension', extensions.installs.some(i => i.agentName === 'ChatGPT (Chrome)' && i.vendor === 'OpenAI'));

  const jsonPath = path.join(root, 'export.json');
  const started = Date.now();
  const result = spawnSync(process.execPath, [CLI, 'scan', '--verbose', '--json', jsonPath, '--home', home, '--cwd', home, '--platform', 'darwin', '--no-color', '--history-file', path.join(root, 'history.json')], { encoding: 'utf8' });
  const wall = Date.now() - started;
  if (result.status !== 0) console.log(result.stderr || result.stdout);
  ok('scan exits 0', result.status === 0);
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  ok('a full fake-home scan finishes in under 5s', wall < 5000);

  const agents = exported.inventory.real.agents;
  const names = new Set(agents.map(a => a.name));
  const major = ['VS Code', 'GitHub Copilot', 'Windsurf', 'Cline', 'Roo Code', 'Continue', 'Zed', 'Gemini CLI', 'Codex CLI', 'Amazon Q', 'JetBrains', 'Goose', 'LM Studio', 'Claude Code', 'Cursor'];
  ok('every config client becomes an agent', major.every(name => names.has(name)));
  ok('desktop app and browser extension are inventory agents', names.has('ChatGPT') && names.has('ChatGPT (Chrome)'));
  ok('provider key names become an agent', names.has('Provider keys'));
  const critical = new Set(exported.exposurePaths.filter(p => p.severity === 'critical').map(p => p.agentName));
  ok('each config client has a critical exposure path', major.every(name => critical.has(name)));
  ok('the critical paths include data exfiltration', exported.exposurePaths.some(p => p.templateId === 'EP-A' && p.agentName === 'VS Code') && exported.exposurePaths.some(p => p.templateId === 'EP-A' && p.agentName === 'Goose'));
  ok('a disabled server and a skipped tree are not servers', !result.stdout.includes('turned-off') && !result.stdout.includes('should-not-see'));
  ok('plaintext credential is flagged and the value is absent', result.stdout.includes('plaintext in config') && result.stdout.includes('OPENAI_API_KEY') && !result.stdout.includes(SECRET) && !result.stdout.includes(DOT_SECRET) && !result.stdout.includes(AWS_SECRET));
  const serialized = JSON.stringify(exported);
  ok('the export redacts secret values and the raw home path', !serialized.includes(SECRET) && !serialized.includes(DOT_SECRET) && !serialized.includes(AWS_SECRET) && !serialized.includes(home));
  ok('credential names and their locations are in the export', exported.credentialNames.some(e => e.name === 'ANTHROPIC_API_KEY' && e.where.includes('~/.zshrc')) && exported.credentialNames.some(e => e.name === 'AWS_ACCESS_KEY_ID' && e.where.includes('~/.aws/credentials')) && !exported.credentialNames.some(e => e.name === 'GROQ_API_KEY' || e.name === 'MISTRAL_API_KEY'));
  const records = push.toRecords(exported.inventory.real);
  const kinds = new Set(records.map(r => r.kind));
  ok('ingest records stay on the existing kinds', [...kinds].every(k => ['agent', 'integration', 'permission', 'mcp_server'].includes(k)) && records.some(r => r.kind === 'agent' && r.name === 'VS Code' && r.metadata.type === 'coding_agent') && records.some(r => r.kind === 'mcp_server' && r.metadata.capabilities.includes('filesystem_access')) && records.some(r => r.kind === 'permission' && r.metadata.category === 'access_credentials'));
  ok('pushed records do not contain secret values', !JSON.stringify(records).includes(SECRET) && !JSON.stringify(records).includes(DOT_SECRET));
  ok('discovery lists the files it read as ~ paths, including a dotfile and not node_modules', exported.discovery.filesRead.some(f => f.includes('mcp_config.json')) && exported.discovery.filesRead.includes('~/.zshrc') && !exported.discovery.filesRead.some(f => f.includes('node_modules')));
  ok('the terminal report names the new clients', ['VS Code', 'Windsurf', 'Cline', 'Codex CLI', 'Goose', 'ChatGPT (Chrome)'].every(label => result.stdout.includes(label)));
  fs.rmSync(root, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
