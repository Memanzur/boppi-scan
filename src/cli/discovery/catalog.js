/**
 * Locators for MCP clients beyond Claude Desktop, Claude Code, and Cursor.
 * Each path is the one that client's docs name. Paths we could not confirm
 * are commented at the call site and called out in the pull request.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const parse = require('./parse');
const projects = require('./projects');
const { isRealHome } = require('./presence');

function roaming(home, platform) {
  if (platform !== 'win32') return null;
  return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
}

function editorUser(home, platform, product) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', product, 'User');
  if (platform === 'win32') return path.join(roaming(home, platform), product, 'User');
  return path.join(home, '.config', product, 'User');
}

const EDITORS = Object.freeze(['Code', 'Code - Insiders', 'Cursor', 'Windsurf']);

function jsonFile(filePath, scope, extract, format = 'json') {
  return {
    path: filePath,
    scope,
    format,
    parse: format === 'jsonc' ? parse.parseJsonc : undefined,
    extract,
  };
}

function yamlFile(filePath, scope, extractText) {
  return { path: filePath, scope, format: 'yaml', parse: text => extractText(text), extract: value => value || {} };
}

function tomlFile(filePath, scope) {
  return { path: filePath, scope, format: 'toml', parse: parse.codexServers, extract: value => value || {} };
}

function vscode(ctx) {
  const { home, cwd, platform } = ctx;
  const files = [];
  for (const product of ['Code', 'Code - Insiders']) {
    const user = editorUser(home, platform, product);
    // 1.99–1.101 kept MCP under the settings.json "mcp" key. 1.102 moved user
    // servers to User/mcp.json. Both are read; VS Code still accepts the key.
    files.push(jsonFile(path.join(user, 'settings.json'), 'user', parse.vscodeServers, 'jsonc'));
    files.push(jsonFile(path.join(user, 'mcp.json'), 'user', parse.vscodeServers));
  }
  files.push(jsonFile(path.join(cwd, '.vscode', 'mcp.json'), 'project', parse.vscodeServers));
  return { clientKey: 'vscode', label: 'VS Code', source: 'vscode', files };
}

function copilot(ctx) {
  const { home, cwd } = ctx;
  let userFile = path.join(home, '.copilot', 'mcp-config.json');
  // VS Code's MCP reference: $COPILOT_HOME/mcp-config.json, else ~/.copilot/mcp-config.json.
  // The override is honored only when scanning the real home, so a fixture home stays hermetic.
  if (isRealHome(home) && process.env.COPILOT_HOME) userFile = path.join(process.env.COPILOT_HOME, 'mcp-config.json');
  return {
    clientKey: 'copilot',
    label: 'GitHub Copilot',
    source: 'copilot',
    files: [
      jsonFile(userFile, 'user', json => parse.mapServers(json.mcpServers || json.servers)),
      jsonFile(path.join(cwd, '.mcp.json'), 'project', json => parse.mapServers(json.mcpServers || json.servers)),
    ],
  };
}

function windsurf(ctx) {
  const { home, cwd, platform } = ctx;
  // Windsurf's published file is still ~/.codeium/windsurf/mcp_config.json
  // (https://code.visualstudio.com/docs/agents/reference/mcp-configuration lists it,
  // and Windsurf's own MCP docs use that path). Devin Desktop, the later name,
  // documents ~/.config/devin/mcp_config.json and %APPDATA%\devin\mcp_config.json.
  const devinUser = platform === 'win32'
    ? path.join(roaming(home, platform), 'devin', 'mcp_config.json')
    : path.join(home, '.config', 'devin', 'mcp_config.json');
  return {
    clientKey: 'windsurf',
    label: 'Windsurf',
    source: 'windsurf',
    files: [
      jsonFile(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'user', json => parse.mapServers(json.mcpServers)),
      jsonFile(devinUser, 'user', json => parse.mapServers(json.mcpServers)),
      jsonFile(path.join(cwd, '.devin', 'mcp_config.json'), 'project', json => parse.mapServers(json.mcpServers)),
    ],
  };
}

function extensionStorage(ctx, { clientKey, label, source, extensionId, filenames }) {
  const files = [];
  for (const product of EDITORS) {
    const settings = path.join(editorUser(ctx.home, ctx.platform, product), 'globalStorage', extensionId, 'settings');
    for (const filename of filenames) {
      files.push(jsonFile(path.join(settings, filename), 'user', json => parse.mapServers(json.mcpServers)));
    }
  }
  return { clientKey, label, source, files };
}

function cline(ctx) {
  // Cline's VS Code globalStorage file. The same extension id is used in
  // Cursor and Windsurf, which share the VS Code globalStorage layout.
  return extensionStorage(ctx, {
    clientKey: 'cline', label: 'Cline', source: 'cline',
    extensionId: 'saoudrizwan.claude-dev', filenames: ['cline_mcp_settings.json'],
  });
}

function roo(ctx) {
  // Roo renamed cline_mcp_settings.json to mcp_settings.json and migrates on
  // startup. Both names are read so an un-migrated profile still counts.
  return extensionStorage(ctx, {
    clientKey: 'roo', label: 'Roo Code', source: 'roo',
    extensionId: 'rooveterinaryinc.roo-cline', filenames: ['mcp_settings.json', 'cline_mcp_settings.json'],
  });
}

function listConfigFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return []; }
  return entries.filter(name => /\.(yaml|yml|json)$/i.test(name)).sort().slice(0, 40).map(name => path.join(dir, name));
}

function continueClient(ctx) {
  const { home, cwd } = ctx;
  const files = [
    yamlFile(path.join(home, '.continue', 'config.yaml'), 'user', parse.continueServers),
    jsonFile(path.join(home, '.continue', 'config.json'), 'user', json => parse.mapServers(json.mcpServers || (json.experimental && json.experimental.modelContextProtocolServers))),
    yamlFile(path.join(cwd, '.continue', 'config.yaml'), 'project', parse.continueServers),
  ];
  for (const file of [...listConfigFiles(path.join(home, '.continue', 'mcpServers')), ...listConfigFiles(path.join(cwd, '.continue', 'mcpServers'))]) {
    if (file.endsWith('.json')) files.push(jsonFile(file, 'project', json => parse.mapServers(json.mcpServers || json)));
    else files.push(yamlFile(file, 'project', parse.continueServers));
  }
  return { clientKey: 'continue', label: 'Continue', source: 'continue', files };
}

function zed(ctx) {
  const { home, cwd, platform } = ctx;
  // macOS and Linux paths are the ones Zed's configuring-zed docs open.
  // Windows is %APPDATA%\Zed\settings.json, the config dir Zed uses on Windows.
  const user = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Zed', 'settings.json')
    : platform === 'win32'
      ? path.join(roaming(home, platform), 'Zed', 'settings.json')
      : path.join(home, '.config', 'zed', 'settings.json');
  return {
    clientKey: 'zed',
    label: 'Zed',
    source: 'zed',
    files: [
      jsonFile(user, 'user', parse.zedServers, 'jsonc'),
      jsonFile(path.join(cwd, '.zed', 'settings.json'), 'project', parse.zedServers, 'jsonc'),
    ],
  };
}

function gemini(ctx) {
  // https://geminicli.com docs: user ~/.gemini/settings.json, project .gemini/settings.json, key mcpServers.
  const { home, cwd } = ctx;
  return {
    clientKey: 'gemini-cli',
    label: 'Gemini CLI',
    source: 'gemini-cli',
    files: [
      jsonFile(path.join(home, '.gemini', 'settings.json'), 'user', json => parse.mapServers(json.mcpServers)),
      jsonFile(path.join(cwd, '.gemini', 'settings.json'), 'project', json => parse.mapServers(json.mcpServers)),
    ],
  };
}

function codex(ctx) {
  const { home, cwd } = ctx;
  let user = path.join(home, '.codex', 'config.toml');
  if (isRealHome(home) && process.env.CODEX_HOME) user = path.join(process.env.CODEX_HOME, 'config.toml');
  return {
    clientKey: 'codex',
    label: 'Codex CLI',
    source: 'codex',
    files: [tomlFile(user, 'user'), tomlFile(path.join(cwd, '.codex', 'config.toml'), 'project')],
  };
}

function amazonQ(ctx) {
  // AWS docs: global ~/.aws/amazonq/default.json and legacy mcp.json;
  // workspace .amazonq/default.json and .amazonq/mcp.json.
  // The public page describes the GUI fields, not a full JSON schema. We read
  // mcpServers (and a top-level servers object) from those files.
  const { home, cwd } = ctx;
  const root = path.join(home, '.aws', 'amazonq');
  const extract = parse.amazonQServers;
  return {
    clientKey: 'amazon-q',
    label: 'Amazon Q',
    source: 'amazon-q',
    files: [
      jsonFile(path.join(root, 'default.json'), 'user', extract),
      jsonFile(path.join(root, 'mcp.json'), 'user', extract),
      jsonFile(path.join(cwd, '.amazonq', 'default.json'), 'project', extract),
      jsonFile(path.join(cwd, '.amazonq', 'mcp.json'), 'project', extract),
    ],
  };
}

function jetbrainsConfigRoot(home, platform) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'JetBrains');
  if (platform === 'win32') return path.join(roaming(home, platform), 'JetBrains');
  return path.join(home, '.config', 'JetBrains');
}

function jetbrains(ctx) {
  const { home, cwd, platform } = ctx;
  // Junie documents ~/.junie/mcp/mcp.json and <project>/.junie/mcp/mcp.json.
  // https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html
  const files = [
    jsonFile(path.join(home, '.junie', 'mcp', 'mcp.json'), 'user', json => parse.mapServers(json.mcpServers)),
    jsonFile(path.join(cwd, '.junie', 'mcp', 'mcp.json'), 'project', json => parse.mapServers(json.mcpServers)),
  ];
  // JetBrains AI Assistant's help page only documents the Settings UI, not a
  // file path. Integrators for 2025.2 report a shared AIAssistant/mcp.json,
  // and 2025.1 stored an imported mcp.json in each IDE config directory
  // (JetBrains/<Product><Version>/mcp.json). Both are checked; see the PR.
  const root = jetbrainsConfigRoot(home, platform);
  files.push(jsonFile(path.join(root, 'AIAssistant', 'mcp.json'), 'user', json => parse.mapServers(json.mcpServers)));
  if (fs.existsSync(root)) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { entries = []; }
    let added = 0;
    for (const entry of entries) {
      if (added >= 24) break;
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'AIAssistant') continue;
      files.push(jsonFile(path.join(root, entry.name, 'mcp.json'), 'user', json => parse.mapServers(json.mcpServers)));
      added += 1;
    }
  }
  return { clientKey: 'jetbrains', label: 'JetBrains', source: 'jetbrains', files };
}

function goose(ctx) {
  // https://block.github.io/goose/docs/guides/config-files
  // macOS/Linux ~/.config/goose/config.yaml
  // Windows %APPDATA%\Block\goose\config\config.yaml
  const { home, platform } = ctx;
  const file = platform === 'win32'
    ? path.join(roaming(home, platform), 'Block', 'goose', 'config', 'config.yaml')
    : path.join(home, '.config', 'goose', 'config.yaml');
  return { clientKey: 'goose', label: 'Goose', source: 'goose', files: [yamlFile(file, 'user', parse.gooseServers)] };
}

function lmstudio(ctx) {
  // LM Studio 0.3.17 blog: ~/.lmstudio/mcp.json, and %USERPROFILE%\.lmstudio\mcp.json on Windows.
  return {
    clientKey: 'lmstudio',
    label: 'LM Studio',
    source: 'lmstudio',
    files: [jsonFile(path.join(ctx.home, '.lmstudio', 'mcp.json'), 'user', json => parse.mapServers(json.mcpServers))],
  };
}

const LOCATORS = Object.freeze([
  vscode, copilot, windsurf, cline, roo, continueClient, zed, gemini, codex, amazonQ, jetbrains, goose, lmstudio,
]);

const EXTRA_ALIASES = Object.freeze({
  vscode: 'vscode', 'vs-code': 'vscode', 'vs code': 'vscode',
  copilot: 'copilot', 'copilot-cli': 'copilot', 'github-copilot': 'copilot',
  windsurf: 'windsurf', devin: 'windsurf',
  cline: 'cline',
  roo: 'roo', 'roo-code': 'roo',
  continue: 'continue',
  zed: 'zed',
  gemini: 'gemini-cli', 'gemini-cli': 'gemini-cli',
  codex: 'codex', 'codex-cli': 'codex',
  'amazon-q': 'amazon-q', amazonq: 'amazon-q', q: 'amazon-q',
  jetbrains: 'jetbrains', junie: 'jetbrains',
  goose: 'goose',
  lmstudio: 'lmstudio', 'lm-studio': 'lmstudio',
  'chatgpt-app': 'chatgpt-app', chatgpt: 'chatgpt-app',
  'claude-app': 'claude-app',
  'copilot-app': 'copilot-app',
  'perplexity-app': 'perplexity-app', perplexity: 'perplexity-app',
  'ollama-app': 'ollama-app', ollama: 'ollama-app',
  browsers: 'browsers', extensions: 'browsers',
  'provider-keys': 'provider-keys', credentials: 'provider-keys', keys: 'provider-keys',
});

function locateAll(ctx) {
  return LOCATORS.map(locate => locate(ctx));
}

function augmentProjectFiles(descriptors, home) {
  const hits = projects.walkProjectConfigs(home);
  const claude = descriptors.find(d => d.clientKey === 'claude-code');
  const cursor = descriptors.find(d => d.clientKey === 'cursor');
  const copilotClient = descriptors.find(d => d.clientKey === 'copilot');
  for (const hit of hits) {
    if (hit.kind === 'mcp') {
      const file = jsonFile(hit.path, 'project', json => parse.mapServers(json.mcpServers || json.servers));
      if (claude) claude.files.push(file);
      if (copilotClient) copilotClient.files.push({ ...file });
    } else if (hit.kind === 'cursor' && cursor) {
      cursor.files.push(jsonFile(hit.path, 'project', json => parse.mapServers(json.mcpServers)));
    }
  }
  return descriptors;
}

module.exports = { locateAll, augmentProjectFiles, EXTRA_ALIASES, LOCATORS, editorUser };
