/**
 * MCP servers that installed Claude Code plugins declare. Inspect-only: files
 * are read, nothing is started, and Boppi never edits a plugin file (the
 * plugin cache is rewritten on update; the remedy is disabling the plugin).
 *
 * Documented layout (code.claude.com/docs/en/plugins/loading, plugins-reference,
 * mcp): the plugins root is ~/.claude/plugins unless CLAUDE_CODE_PLUGIN_CACHE_DIR
 * is set; `installed_plugins.json` there records each install with its scope,
 * installPath and version; a plugin declares servers under `mcpServers` in
 * `.mcp.json` at its root and inline in `.claude-plugin/plugin.json`; the server
 * registers as `plugin:<plugin-name>:<server>`, where the name is the manifest
 * name; `enabledPlugins` in the settings files turns a plugin id
 * (`<name>@<marketplace>`) on or off.
 *
 * Not read: plugins synced from claude.ai, `--plugin-dir` and skills-directory
 * plugins, and `mcpServers` given as a file path, an .mcpb/.dxt bundle or a URL
 * (that plugin.json is recorded unreadable, so the gap is visible).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { claudeConfigDir, comparable, parseJson } = require('../platform');

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const NAME = /^[^\s@:/\\]{1,128}$/;

function readJson(file) {
  try { return parseJson(fs.readFileSync(file)); } catch (_) { return undefined; }
}

/**
 * The install records, as [{ id, scope, installPath, version }]. `entry` is
 * the coverage line for installed_plugins.json itself. A shape Boppi does not
 * recognize is unreadable rather than guessed at, so no install goes missing silently.
 */
function readInstalls(root) {
  const file = path.join(root, 'installed_plugins.json');
  const entry = { path: file, scope: 'user', kind: 'plugin-index', status: 'not_found', installs: 0 };
  if (!fs.existsSync(file)) return { entry, installs: [] };
  const doc = readJson(file);
  const byId = isObject(doc) && isObject(doc.plugins) ? doc.plugins : null;
  if (!byId) return { entry: { ...entry, status: 'unreadable', reason: doc === undefined ? 'invalid JSON' : 'unsupported install record shape' }, installs: [] };
  const installs = [];
  let skipped = 0;
  for (const [id, value] of Object.entries(byId)) {
    for (const record of Array.isArray(value) ? value : [value]) {
      const installPath = isObject(record) && typeof record.installPath === 'string' ? record.installPath : null;
      if (!installPath || !path.isAbsolute(installPath) || !NAME.test(id.split('@')[0] || '')) { skipped++; continue; }
      installs.push({ id, scope: typeof record.scope === 'string' ? record.scope : null, installPath: path.resolve(installPath), version: typeof record.version === 'string' ? record.version : null });
    }
  }
  // A record Boppi cannot read may hold servers, so the index is not complete evidence: keep the readable installs, but report the file
  // unreadable so the scan is incomplete and a push merges instead of replacing (an omitted plugin must never read as removed).
  if (skipped) return { entry: { ...entry, status: 'unreadable', reason: 'unsupported install record shape', installs: installs.length, skipped }, installs };
  return { entry: { ...entry, status: 'found', installs: installs.length }, installs };
}

/** enabledPlugins from the user, project and local settings files, later files winning, as Claude Code merges them. Managed settings are not read here. */
function enabledPlugins({ home, cwd }) {
  const out = new Map(), seen = new Set();
  for (const [file, source] of [[path.join(claudeConfigDir(home), 'settings.json'), 'user'], [path.join(cwd, '.claude', 'settings.json'), 'project'], [path.join(cwd, '.claude', 'settings.local.json'), 'local']]) {
    // Scanning from the home folder makes the user and project file the same file; it counts once, as user.
    if (seen.has(comparable(file))) continue;
    seen.add(comparable(file));
    const doc = readJson(file);
    if (!isObject(doc) || !isObject(doc.enabledPlugins)) continue;
    for (const [id, value] of Object.entries(doc.enabledPlugins)) if (typeof value === 'boolean') out.set(id, { enabled: value, source });
  }
  return out;
}

/**
 * Config-file descriptors for every installed plugin (its .mcp.json and
 * plugin.json), in the readClient shape, plus the index coverage entry.
 * Each file is readOnly and carries the plugin it belongs to.
 */
function pluginFiles({ home, cwd, pluginRoot = null }) {
  const root = path.resolve(pluginRoot || path.join(claudeConfigDir(home), 'plugins'));
  const { entry, installs } = readInstalls(root);
  const enabled = enabledPlugins({ home, cwd });
  const files = [];
  for (const install of installs) {
    const manifestFile = path.join(install.installPath, '.claude-plugin', 'plugin.json');
    const manifest = readJson(manifestFile);
    const name = isObject(manifest) && typeof manifest.name === 'string' && NAME.test(manifest.name) ? manifest.name : install.id.split('@')[0];
    const setting = enabled.get(install.id);
    const plugin = {
      id: install.id, name, version: install.version, installScope: install.scope,
      enablement: setting ? { state: setting.enabled ? 'enabled' : 'disabled', source: setting.source }
        : { state: isObject(manifest) && manifest.defaultEnabled === false ? 'disabled' : 'enabled', source: 'default' },
    };
    const block = { keyPath: ['mcpServers'], scope: 'plugin', labelPrefix: `plugin:${name}:` };
    files.push({ path: path.join(install.installPath, '.mcp.json'), scope: 'plugin', readOnly: true, plugin, blocks: [block] });
    files.push({ path: manifestFile, scope: 'plugin', readOnly: true, plugin, pluginManifest: true, blocks: [block] });
  }
  return { index: entry, files };
}

/** { file, reason } when a scanned server comes from a plugin, so fix and plan can say what to do instead; else null. */
function pluginRemedy(client, label) {
  const holder = (client && client.files || []).find(f => f.status === 'found' && f.plugin && (f.servers || []).includes(label));
  if (!holder) return null;
  return { file: holder.path, plugin: holder.plugin.id, reason: `It comes from the Claude Code plugin ${holder.plugin.id}, and Boppi does not edit plugin files. Disable the plugin instead (claude plugin disable ${holder.plugin.id}, or "enabledPlugins": { "${holder.plugin.id}": false } in your settings), then rerun boppi verify.` };
}

module.exports = { readInstalls, enabledPlugins, pluginFiles, pluginRemedy };
