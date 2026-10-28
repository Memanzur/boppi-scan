/**
 * Claude Code settings evidence beyond permission rules: which MCP servers the
 * settings enable or disable, how many hooks are configured, and the
 * machine-wide (managed) policy. Inspect-only: nothing here starts a server or
 * runs a hook, and no command text, matcher, rule text, or URL pattern is kept.
 *
 * Documented keys (code.claude.com/docs/en/settings, mcp, managed-settings,
 * managed-mcp; verified in the control plane's INTEGRATION_SURFACES_2026-10-24):
 * `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`
 * in any settings file; `hooks` blocks; managed `managed-settings.json`,
 * `managed-settings.d/*.json` and `managed-mcp.json`; managed-only locks
 * `allowManagedMcpServersOnly`, `allowManagedPermissionRulesOnly`,
 * `allowManagedHooksOnly`, `disableAllHooks`, `allowedMcpServers`,
 * `deniedMcpServers`, `permissions.disableBypassPermissionsMode`; and
 * `enabledMcpServers` / `disabledMcpServers` under `projects[cwd]` in ~/.claude.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MANAGED_DIR = Object.freeze({ darwin: '/Library/Application Support/ClaudeCode', linux: '/etc/claude-code', win32: 'C:\\Program Files\\ClaudeCode' });
const LOCKS = Object.freeze(['allowManagedMcpServersOnly', 'allowManagedPermissionRulesOnly', 'allowManagedHooksOnly', 'disableAllHooks']);
const BOPPI_HOOK = /\bboppi(?:\.js)?\s+hook\b/;
const STATES = Object.freeze(['enabled', 'needs_approval', 'disabled', 'unknown']);
const NOT_READ = 'Settings delivered by an MDM profile, the Windows registry, or server-managed policy are not read.';

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const nameList = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.length <= 200) : [];
const boolOrNull = v => typeof v === 'boolean' ? v : null;

/** Where this platform keeps managed settings. `override` exists for fixtures only. */
function managedDir(platform, override) { return override || MANAGED_DIR[platform] || null; }

/**
 * Managed settings locations, lowest precedence first: the main file, then the
 * drop-in directory in name order, then managed-mcp.json (not a settings file,
 * read for presence and server count only).
 */
function managedLocations({ platform, managedDir: override }) {
  const dir = managedDir(platform, override);
  if (!dir) return [];
  // The platform's own joiner, so a Windows location stays a Windows path when the platform is overridden in tests.
  const join = override ? path.join : platform === 'win32' ? path.win32.join : path.posix.join;
  const out = [{ path: join(dir, 'managed-settings.json'), scope: 'managed', kind: 'settings' }];
  const dropIn = join(dir, 'managed-settings.d');
  let names = [];
  try { names = fs.readdirSync(dropIn).filter(name => name.endsWith('.json')).sort(); } catch { names = []; }
  for (const name of names) out.push({ path: join(dropIn, name), scope: 'managed', kind: 'settings' });
  out.push({ path: join(dir, 'managed-mcp.json'), scope: 'managed', kind: 'managed-mcp' });
  return out;
}

/** Hook counts from one settings document. Command text and matchers are never kept. */
function hooksEvidence(block) {
  const out = { handlers: 0, events: 0, byEvent: {}, boppiCollector: false, malformed: false };
  if (block === undefined) return out;
  if (!isObject(block)) return { ...out, malformed: true };
  for (const [event, matchers] of Object.entries(block)) {
    if (!/^[A-Za-z]{1,40}$/.test(event) || !Array.isArray(matchers)) { out.malformed = true; continue; }
    let count = 0;
    for (const matcher of matchers) {
      if (!isObject(matcher)) { out.malformed = true; continue; }
      const handlers = Array.isArray(matcher.hooks) ? matcher.hooks : [];
      if (!Array.isArray(matcher.hooks)) out.malformed = true;
      for (const handler of handlers) {
        if (!isObject(handler)) { out.malformed = true; continue; }
        count += 1;
        if (typeof handler.command === 'string' && BOPPI_HOOK.test(handler.command)) out.boppiCollector = true;
      }
    }
    out.byEvent[event] = count;
    out.handlers += count;
    out.events += 1;
  }
  return out;
}

/** The managed allow/deny entries kept only for matching in this process; the export sees counts. */
function managedRules(list) {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return { count: 0, malformed: true, entries: [] };
  const entries = list.filter(isObject).map(entry => ({
    serverName: typeof entry.serverName === 'string' ? entry.serverName : null,
    serverUrl: typeof entry.serverUrl === 'string' ? entry.serverUrl : null,
    serverCommand: Array.isArray(entry.serverCommand) && entry.serverCommand.every(v => typeof v === 'string') ? entry.serverCommand : null,
  }));
  return { count: entries.length, malformed: entries.length !== list.length, entries };
}

/**
 * Everything one parsed settings document says about MCP enablement, hooks and
 * managed locks. `stored` is what the entry carries (counts, names, booleans);
 * `rules` stays in memory for matching.
 */
function fileEvidence(json, scope) {
  const doc = isObject(json) ? json : {};
  const hooks = hooksEvidence(doc.hooks);
  const mcp = {
    enableAllProjectMcpServers: boolOrNull(doc.enableAllProjectMcpServers),
    enabledMcpjsonServers: nameList(doc.enabledMcpjsonServers),
    disabledMcpjsonServers: nameList(doc.disabledMcpjsonServers),
    malformed: ['enableAllProjectMcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers'].some(key => doc[key] !== undefined && (key === 'enableAllProjectMcpServers' ? typeof doc[key] !== 'boolean' : !Array.isArray(doc[key]) || doc[key].some(v => typeof v !== 'string'))),
  };
  const stored = { mcp, hooks };
  const rules = { allowed: null, denied: null };
  if (scope === 'managed') {
    const locks = Object.fromEntries(LOCKS.map(key => [key, boolOrNull(doc[key])]));
    const permissions = isObject(doc.permissions) ? doc.permissions : {};
    stored.locks = locks;
    stored.disableBypassPermissionsMode = permissions.disableBypassPermissionsMode === 'disable';
    rules.allowed = managedRules(doc.allowedMcpServers);
    rules.denied = managedRules(doc.deniedMcpServers);
    stored.managedMcpRules = { allowed: rules.allowed ? rules.allowed.count : null, denied: rules.denied ? rules.denied.count : null };
  }
  return { stored, rules };
}

/** Presence and server count of managed-mcp.json; its entries are not added to the inventory. */
function managedMcpEvidence(file) {
  const entry = { path: path.resolve(file.path), scope: 'managed', kind: 'managed-mcp', status: 'not_found', serverCount: 0 };
  if (!fs.existsSync(entry.path)) return entry;
  try {
    const json = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
    entry.status = 'found';
    entry.serverCount = isObject(json) && isObject(json.mcpServers) ? Object.keys(json.mcpServers).length : 0;
  } catch (error) {
    entry.status = 'unreadable';
    entry.reason = error.code === 'EACCES' || error.code === 'EPERM' ? 'permission denied' : error.code === 'EISDIR' ? 'this is a directory, not a config file' : 'invalid JSON';
  }
  return entry;
}

/** Only the documented per-project enablement keys from ~/.claude.json; server names only. */
function projectPolicy(json, cwd) {
  const project = isObject(json) && isObject(json.projects) && isObject(json.projects[cwd]) ? json.projects[cwd] : {};
  return {
    enabledMcpServers: nameList(project.enabledMcpServers),
    disabledMcpServers: nameList(project.disabledMcpServers),
    enabledMcpjsonServers: nameList(project.enabledMcpjsonServers),
    disabledMcpjsonServers: nameList(project.disabledMcpjsonServers),
    enableAllProjectMcpServers: boolOrNull(project.enableAllProjectMcpServers),
  };
}

/** 'match' when a managed rule names this server, 'pattern' when a rule uses a wildcard URL Boppi does not evaluate, else 'none'. */
function matchManaged(rules, name, server) {
  if (!rules || !rules.entries.length) return 'none';
  let pattern = false;
  for (const entry of rules.entries) {
    if (entry.serverName !== null && entry.serverName === name) return 'match';
    if (entry.serverCommand && server && typeof server.command === 'string') {
      const launched = [server.command, ...(Array.isArray(server.args) ? server.args : [])];
      if (launched.length === entry.serverCommand.length && launched.every((v, i) => v === entry.serverCommand[i])) return 'match';
    }
    if (entry.serverUrl !== null && server && typeof server.url === 'string') {
      if (entry.serverUrl.includes('*')) { pattern = true; continue; }
      if (server.url === entry.serverUrl) return 'match';
    }
  }
  return pattern ? 'pattern' : 'none';
}

const baseName = key => key.replace(/ \((user|project|local)\)$/, '');

/**
 * The enablement state of every discovered server for one Claude Code install.
 * `servers`: [{ name, scope, server }] from discovery (name may carry a scope suffix).
 * `policy`: the merged settings evidence from readPermissionSettings.
 * `project`: projectPolicy() from ~/.claude.json, or null when that file was not read.
 */
function enablement({ servers, policy, project }) {
  const out = [];
  const counts = Object.fromEntries(STATES.map(state => [state, 0]));
  const managed = policy ? policy.managed : null;
  const enableAll = policy && policy.enableAllProjectMcpServers !== null ? policy.enableAllProjectMcpServers : project && project.enableAllProjectMcpServers !== null ? project.enableAllProjectMcpServers : false;
  for (const { name: key, scope, server } of servers) {
    const name = baseName(key);
    let verdict;
    if (!policy || policy.unreadable) verdict = { state: 'unknown', reason: 'a settings file could not be read, so the enablement rules are incomplete', basis: 'documented' };
    else if (managed && managed.mcpFile === 'unreadable') verdict = { state: 'unknown', reason: 'managed-mcp.json exists but could not be read', basis: 'documented' };
    else if (managed && managed.mcpFile === 'found') verdict = { state: 'disabled', reason: 'managed-mcp.json is present, so servers configured outside it are not loaded', basis: 'documented' };
    else if (managed && managed.locks.allowManagedMcpServersOnly === true) verdict = { state: 'disabled', reason: 'managed settings allow only administrator-managed servers', basis: 'documented' };
    else if (managed && matchManaged(managed.denied, name, server) === 'match') verdict = { state: 'disabled', reason: 'a managed deniedMcpServers rule names this server', basis: 'documented' };
    else if (managed && matchManaged(managed.denied, name, server) === 'pattern') verdict = { state: 'unknown', reason: 'a managed deniedMcpServers rule uses a URL pattern Boppi does not evaluate', basis: 'documented' };
    else if (managed && managed.allowed && managed.allowed.entries.length && matchManaged(managed.allowed, name, server) !== 'match') verdict = matchManaged(managed.allowed, name, server) === 'pattern'
      ? { state: 'unknown', reason: 'a managed allowedMcpServers rule uses a URL pattern Boppi does not evaluate', basis: 'documented' }
      : { state: 'disabled', reason: 'managed allowedMcpServers does not name this server', basis: 'documented' };
    else if (project && project.disabledMcpServers.includes(name)) verdict = { state: 'disabled', reason: 'listed in disabledMcpServers for this project in ~/.claude.json', basis: 'documented' };
    else if (project && project.enabledMcpServers.includes(name)) verdict = { state: 'enabled', reason: 'listed in enabledMcpServers for this project in ~/.claude.json', basis: 'documented' };
    else if (scope === 'project') {
      if (policy.disabledMcpjsonServers.has(name)) verdict = { state: 'disabled', reason: 'listed in disabledMcpjsonServers in settings', basis: 'documented' };
      else if (project && project.disabledMcpjsonServers.includes(name)) verdict = { state: 'disabled', reason: 'listed in disabledMcpjsonServers for this project in ~/.claude.json', basis: 'observed' };
      else if (policy.enabledMcpjsonServers.has(name)) verdict = { state: 'enabled', reason: 'listed in enabledMcpjsonServers in settings', basis: 'documented' };
      else if (project && project.enabledMcpjsonServers.includes(name)) verdict = { state: 'enabled', reason: 'listed in enabledMcpjsonServers for this project in ~/.claude.json', basis: 'observed' };
      else if (enableAll) verdict = { state: 'enabled', reason: 'enableAllProjectMcpServers is true', basis: 'documented' };
      else verdict = { state: 'needs_approval', reason: 'Claude Code asks before using a project server; no setting records an approval', basis: 'documented' };
    } else verdict = { state: 'enabled', reason: 'configured by the user; no setting disables it', basis: 'documented' };
    counts[verdict.state] += 1;
    out.push({ name: key, scope, ...verdict });
  }
  return { servers: out, counts };
}

/**
 * One sentence for COVERAGE, or '' when there is nothing to say. The same
 * shape serves every client that records an mcpPolicy (Claude Code, Codex
 * CLI): server states, hook counts, managed policy, and any values that are
 * recorded without being graded.
 */
function coverageSentence(mcpPolicy, label = 'Claude Code') {
  if (!mcpPolicy) return '';
  const parts = [];
  const c = mcpPolicy.counts || {};
  const total = STATES.reduce((sum, state) => sum + (c[state] || 0), 0);
  if (total) {
    const bits = [];
    if (c.enabled) bits.push(`${c.enabled} enabled`);
    if (c.needs_approval) bits.push(`${c.needs_approval} awaiting approval`);
    if (c.disabled) bits.push(`${c.disabled} disabled by settings`);
    if (c.unknown) bits.push(`${c.unknown} unknown`);
    parts.push(`${label} MCP servers by settings: ${bits.join(', ')}${c.disabled || c.needs_approval || c.unknown ? '; every configured server is still graded (rubric 1.0.3 open question)' : ''}.`);
  }
  const hooks = mcpPolicy.hooks;
  if (hooks) {
    const where = hooks.inline ? ` (${hooks.inline} inline in config.toml)` : '';
    parts.push(hooks.handlers ? `Hooks: ${hooks.handlers} handler${hooks.handlers === 1 ? '' : 's'} across ${hooks.events} event${hooks.events === 1 ? '' : 's'}${where}${hooks.boppiCollector ? ', including the Boppi collector' : ''}; none were run.` : 'Hooks: none configured.');
    if (hooks.unreadable) parts.push(`${hooks.unreadable} hooks file${hooks.unreadable === 1 ? '' : 's'} could not be read, so the hook count is incomplete.`);
  }
  const managed = mcpPolicy.managed;
  const notRead = managed && managed.notRead ? managed.notRead : NOT_READ;
  if (managed) parts.push(managed.found ? `Managed settings: present (${managed.locks.join(', ') || 'no locks'}). ${notRead}` : `Managed settings: no file at ${managed.checked} checked location${managed.checked === 1 ? '' : 's'}. ${notRead}`);
  const policy = mcpPolicy.policy;
  if (policy && (policy.approvalPolicy || policy.sandboxMode)) {
    const values = [policy.approvalPolicy ? `approval_policy ${policy.approvalPolicy}` : '', policy.sandboxMode ? `sandbox_mode ${policy.sandboxMode}` : ''].filter(Boolean).join(', ');
    parts.push(`Policy values: ${values} (recorded, not graded; configuration evidence, not observed behavior).`);
  }
  return parts.join(' ');
}

module.exports = { MANAGED_DIR, LOCKS, STATES, NOT_READ, managedDir, managedLocations, fileEvidence, hooksEvidence, managedMcpEvidence, projectPolicy, enablement, matchManaged, coverageSentence };
