/**
 * What a first run can say when a machine has AI tools but no MCP servers.
 * Every line is backed by a file or directory that was present. Missing
 * settings are not described as safe.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { editorUser } = require('./discovery/catalog');
const { hygieneFrom } = require('./discovery/claudePermissions');

const SAMPLE_URL = 'https://beta.boppi.io';

const EDITOR_EXTENSIONS = Object.freeze([
  { prefix: 'github.copilot-', label: 'GitHub Copilot' },
  { prefix: 'github.copilot-chat-', label: 'GitHub Copilot Chat' },
  { prefix: 'continue.continue-', label: 'Continue' },
  { prefix: 'saoudrizwan.claude-dev-', label: 'Cline' },
  { prefix: 'rooveterinaryinc.roo-cline-', label: 'Roo Code' },
]);

const EDITORS = Object.freeze(['Code', 'Code - Insiders', 'Cursor', 'Windsurf']);

function isDir(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (_) { return false; }
}

/** VS Code-family extensions by directory prefix. The extension package is not read. */
function editorExtensions(home, platform) {
  const found = [];
  for (const product of EDITORS) {
    const dir = path.join(editorUser(home, platform, product), 'extensions');
    if (!isDir(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_) { continue; }
    for (const spec of EDITOR_EXTENSIONS) {
      if (entries.some(name => name.startsWith(spec.prefix))) {
        found.push({ name: spec.label, detail: `extension installed in ${product}` });
      }
    }
  }
  return found;
}

function appBundles(home, platform) {
  if (platform !== 'darwin') return [];
  const roots = [path.join(home, 'Applications')];
  try {
    if (path.resolve(home) === path.resolve(os.homedir())) roots.push('/Applications');
  } catch (_) { /* ignore */ }
  const bundles = [
    ['Cursor.app', 'Cursor'],
    ['Visual Studio Code.app', 'VS Code'],
    ['Windsurf.app', 'Windsurf'],
    ['Zed.app', 'Zed'],
  ];
  const found = [];
  for (const [bundle, label] of bundles) {
    if (roots.some(root => isDir(path.join(root, bundle)))) found.push({ name: label, detail: 'app installed' });
  }
  return found;
}

function dirSignals(home) {
  const checks = [
    [path.join(home, '.cursor'), 'Cursor', 'Cursor data directory present, no MCP config read'],
    [path.join(home, '.gemini'), 'Gemini CLI', 'config directory present'],
    [path.join(home, '.codex'), 'Codex CLI', 'config directory present'],
    [path.join(home, '.ollama'), 'Ollama', 'model directory present'],
  ];
  return checks.filter(([dir]) => isDir(dir)).map(([, name, detail]) => ({ name, detail }));
}

function clientPresent(client) {
  if (client.clientKey === 'provider-keys' || client.clientKey === 'browsers') return null;
  if (client.presenceOnly) {
    if (!client.installed) return null;
    return { name: client.label, detail: 'installed' };
  }
  if (client.inventoryOnly) {
    const count = (client.installs || []).length;
    if (!count) return null;
    return { name: client.label, detail: `${count} extension${count === 1 ? '' : 's'}` };
  }
  const found = (client.files || []).filter(file => file.status === 'found' && file.format !== 'text');
  if (!found.length) return null;
  const servers = found.reduce((sum, file) => sum + (file.serverCount || 0), 0);
  const detail = servers ? `${servers} MCP server${servers === 1 ? '' : 's'}` : 'config present, no MCP servers';
  return { name: client.label, detail };
}

function checkedCounts(discovery) {
  const clients = discovery.clients || [];
  const tools = clients.filter(client => client.clientKey !== 'provider-keys').length;
  const configLocations = clients.reduce((sum, client) => sum + (client.files || []).length, 0);
  return { tools, configLocations };
}

function goods(discovery, claudeSettings) {
  const lines = [];
  const presentConfigs = (discovery.clients || []).filter(client => !client.presenceOnly && !client.inventoryOnly && client.clientKey !== 'provider-keys');
  const read = presentConfigs.filter(client => (client.files || []).some(file => file.status === 'found' && file.format !== 'text'));
  const withServers = read.filter(client => (client.files || []).some(file => file.status === 'found' && file.serverCount > 0));
  if (read.length && !withServers.length) lines.push('No MCP servers are configured in the tool configs that were read.');
  const keys = (discovery.clients || []).find(client => client.clientKey === 'provider-keys');
  if (keys && !(keys.credentialNames || []).length) lines.push('No provider key names were found in the environment or the checked dotfiles.');
  const sawSettings = (claudeSettings || []).some(item => !item.unreadable);
  const bypass = (claudeSettings || []).some(item => item.mode === 'bypassPermissions' || item.mode === 'dontAsk');
  if (sawSettings && !bypass) lines.push('Claude Code settings were read and are not set to bypass permission prompts.');
  return lines;
}

function autoApproveFindings(discovery) {
  const findings = [];
  for (const client of discovery.clients || []) {
    if (client.clientKey !== 'cline' && client.clientKey !== 'roo') continue;
    for (const [name, server] of Object.entries(client.mergedServers || {})) {
      const count = server && server.autoApproveCount;
      if (!count) continue;
      findings.push({
        severity: 'medium',
        tool: client.label,
        sentence: `${client.label} auto-approves ${count} tool${count === 1 ? '' : 's'} on the ${name} server.`,
      });
    }
  }
  return findings;
}

function verdict(security, found, hygiene) {
  if (security.risks && security.risks.length) return security.risks[0].sentence;
  if (hygiene.length) return `No exposure paths. ${hygiene[0].sentence}`;
  if (!found.length) return 'No risky AI access found.';
  const names = found.slice(0, 3).map(item => item.name).join(' and ');
  const noServers = found.every(item => /no MCP servers/.test(item.detail));
  if (noServers) return `No risky AI access found. ${names} ${found.length === 1 ? 'is' : 'are'} installed with no MCP servers.`;
  return 'No risky AI access found.';
}

function nextSteps(hasPaths) {
  if (hasPaths) return [`boppi scan --html boppi-report.html`];
  return [
    `See a worked example at ${SAMPLE_URL}`,
    'boppi scan --html boppi-report.html',
    'boppi scan --verbose',
  ];
}

function buildFirstRun(report, platform) {
  const discovery = { clients: report.discovery || [] };
  const fromClients = discovery.clients.map(clientPresent).filter(Boolean);
  const extra = [...appBundles(report.home, platform), ...dirSignals(report.home), ...editorExtensions(report.home, platform)];
  const seen = new Set(fromClients.map(item => item.name));
  const found = fromClients.slice();
  for (const item of extra) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    found.push(item);
  }
  const claudeSettings = report.claudeSettings || [];
  const hygiene = [...hygieneFrom(claudeSettings), ...autoApproveFindings(discovery)];
  const security = report.securityReport || { risks: [], score: 100, grade: 'A' };
  const hasPaths = (security.risks || []).length > 0;
  const checked = checkedCounts(discovery);
  return {
    verdict: verdict(security, found, hygiene),
    found: found.slice(0, 16),
    good: hasPaths ? [] : goods(discovery, claudeSettings),
    hygiene,
    checked: { ...checked, present: found.length },
    next: nextSteps(hasPaths),
    disclaimer: 'Local scan only. Key values and file contents were not collected. boppi scan --verbose lists every file and the coverage limits.',
  };
}

module.exports = { buildFirstRun, SAMPLE_URL, EDITOR_EXTENSIONS };
