/**
 * Locator for OpenAI Codex CLI configuration. Inspect-only, like every other
 * locator: files are read and counted, nothing is started.
 *
 * Documented surface (learn.chatgpt.com config-reference, hooks, and
 * managed-configuration; summarized in the control plane's
 * INTEGRATION_SURFACES_2026-10-24): `~/.codex/config.toml` (user) and the
 * trusted project's `<cwd>/.codex/config.toml`; MCP servers as
 * `[mcp_servers.<name>]` tables with `command`, `args`, `env`, `url`,
 * `bearer_token_env_var`, `enabled`, `enabled_tools`, `disabled_tools`;
 * top-level `approval_policy` and `sandbox_mode`; hooks in `~/.codex/hooks.json`,
 * `<cwd>/.codex/hooks.json`, or an inline `[hooks]` table; managed
 * requirements at `/etc/codex/requirements.toml` (Windows fallback
 * `~/.codex/managed_config.toml`).
 *
 * What is recorded: the common server shape the engine grades (command,
 * args, env, url), `enabled = false` as a disabled state, the documented
 * values of `approval_policy` and `sandbox_mode` (recorded, not graded: no
 * rubric row reads them), hook counts, and the presence and allow-list
 * counts of the managed file. Never recorded: command text of a hook, an
 * environment value, a token, or a path under the home directory.
 *
 * `BOPPI_CODEX_MANAGED_DIR` moves the managed location for fixtures only,
 * mirroring `BOPPI_MANAGED_SETTINGS_DIR` for Claude Code.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const toml = require('./toml');
const hooksModule = require('./hooks');

const MANAGED_DIR = Object.freeze({ darwin: '/etc/codex', linux: '/etc/codex' });
const APPROVAL_POLICIES = Object.freeze(['on-request', 'never', 'granular']);
const SANDBOX_MODES = Object.freeze(['read-only', 'workspace-write', 'danger-full-access']);
const STATES = Object.freeze(['enabled', 'disabled', 'unknown']);
const NOT_READ = 'Requirements delivered by an MDM profile or cloud-managed policy are not read.';
const MANUAL_EDIT = 'Boppi does not edit TOML files yet; remove the [mcp_servers.<name>] table by hand and rerun boppi verify.';

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const stringList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
/** A documented enum value, 'unrecognized' for any other string (the text is not kept), null when absent. */
const enumOf = (value, allowed) => (value === undefined ? null : typeof value === 'string' && allowed.includes(value) ? value : 'unrecognized');

/** The managed requirements file for this platform; `override` exists for fixtures only. */
function managedFiles({ home, platform, managedDir: override = null }) {
  if (override) return [{ path: path.join(override, 'requirements.toml'), scope: 'managed', kind: 'managed', format: 'toml' }];
  if (platform === 'win32') return [{ path: path.win32.join(home, '.codex', 'managed_config.toml'), scope: 'managed', kind: 'managed', format: 'toml' }];
  const dir = MANAGED_DIR[platform];
  return dir ? [{ path: path.posix.join(dir, 'requirements.toml'), scope: 'managed', kind: 'managed', format: 'toml' }] : [];
}

function hookFiles({ home, cwd }) {
  return [
    { path: path.join(home, '.codex', 'hooks.json'), scope: 'user', kind: 'hooks' },
    { path: path.join(cwd, '.codex', 'hooks.json'), scope: 'project', kind: 'hooks' },
  ];
}

/**
 * `mcp_servers` mapped onto the shape the other locators produce, so the
 * engine grades a Codex server exactly like a Cursor one. `bearer_token_env_var`
 * names the variable Codex sends as a bearer token; it joins the env names
 * (names only, the engine never reads a value) so the credential reference
 * is visible. `enabled`, `enabled_tools`, and `disabled_tools` are policy,
 * read by fileEvidence.
 */
function serverShape(entry) {
  if (!isObject(entry)) return null;
  const server = {};
  if (typeof entry.command === 'string') server.command = entry.command;
  if (Array.isArray(entry.args)) server.args = entry.args.map(v => (typeof v === 'string' ? v : String(v)));
  if (typeof entry.url === 'string') server.url = entry.url;
  const env = isObject(entry.env) ? { ...entry.env } : {};
  if (typeof entry.bearer_token_env_var === 'string' && entry.bearer_token_env_var) env[entry.bearer_token_env_var] = null;
  if (Object.keys(env).length) server.env = env;
  if (typeof entry.cwd === 'string') server.cwd = entry.cwd;
  return server;
}

/** Every mcp_servers table of a document in the common shape. */
function serversOf(doc) {
  const table = isObject(doc) && isObject(doc.mcp_servers) ? doc.mcp_servers : {};
  return Object.fromEntries(Object.entries(table).map(([name, entry]) => [name, serverShape(entry)]).filter(([, server]) => server));
}

/** Everything one config.toml says beyond the server entries: policy values, disabled servers, tool filters, inline hooks. Values only. */
function fileEvidence(doc) {
  const root = isObject(doc) ? doc : {};
  const table = isObject(root.mcp_servers) ? root.mcp_servers : {};
  const disabled = [];
  let toolFilters = 0;
  let malformed = !isObject(doc) || (root.mcp_servers !== undefined && !isObject(root.mcp_servers));
  for (const [name, entry] of Object.entries(table)) {
    if (!isObject(entry)) { malformed = true; continue; }
    if (entry.enabled === false) disabled.push(name);
    else if (entry.enabled !== undefined && entry.enabled !== true) malformed = true;
    if (stringList(entry.enabled_tools).length || stringList(entry.disabled_tools).length) toolFilters += 1;
  }
  // A value outside the documented set is recorded as 'unrecognized'; the text itself is not kept.
  const policy = { approvalPolicy: enumOf(root.approval_policy, APPROVAL_POLICIES), sandboxMode: enumOf(root.sandbox_mode, SANDBOX_MODES) };
  const hooks = hooksModule.countHooks(root.hooks);
  return { policy, disabledServers: disabled, toolFilters, hooks, malformed: malformed || hooks.malformed };
}

/** Presence and allow-list counts of the managed requirements file. Entries of its allow lists are enum values or server names; only counts and enum values are kept. */
function managedEvidence(file) {
  const entry = { path: path.resolve(file.path), scope: 'managed', kind: 'managed', format: 'toml', status: 'not_found', serverCount: 0 };
  if (!fs.existsSync(entry.path)) return { entry, allowlist: null };
  let allowlist = null;
  try {
    const doc = toml.parse(fs.readFileSync(entry.path, 'utf8'));
    entry.status = 'found';
    const approval = Array.isArray(doc.allowed_approval_policies) ? doc.allowed_approval_policies.map(v => enumOf(v, APPROVAL_POLICIES)) : null;
    const sandboxes = Array.isArray(doc.allowed_sandbox_modes) ? doc.allowed_sandbox_modes.map(v => enumOf(v, SANDBOX_MODES)) : Array.isArray(doc.allowed_permission_profiles) ? doc.allowed_permission_profiles.map(() => 'profile') : null;
    const servers = isObject(doc.mcp_servers) ? Object.keys(doc.mcp_servers) : Array.isArray(doc.mcp_servers) ? doc.mcp_servers.filter(v => typeof v === 'string') : null;
    allowlist = servers;
    entry.requirements = {
      allowedApprovalPolicies: approval,
      allowedSandboxModes: sandboxes,
      mcpAllowlist: servers ? servers.length : null,
      allowManagedHooksOnly: typeof doc.allow_managed_hooks_only === 'boolean' ? doc.allow_managed_hooks_only : null,
      managedHooks: hooksModule.countHooks(doc.hooks).handlers,
    };
  } catch (error) {
    entry.status = 'unreadable';
    entry.reason = error.code === 'EACCES' || error.code === 'EPERM' ? 'permission denied' : error.code === 'EISDIR' ? 'this is a directory, not a config file' : 'invalid TOML';
  }
  return { entry, allowlist };
}

const baseName = key => key.replace(/ \((user|project)\)$/, '');

/**
 * Enablement of every discovered server, under the same shape Claude Code's
 * mcpPolicy uses (state, reason, basis). `files` are the client's config
 * entries after discovery (each with `servers` and `disabledServers`);
 * `managed` is managedEvidence(); `unreadable` counts every file of this
 * client that could not be read.
 */
function enablement({ mergedServers, files, managed, unreadable }) {
  const disabledBy = new Map();
  const scopeOf = new Map();
  for (const file of files) {
    for (const key of file.servers || []) { scopeOf.set(key, file.scope); if ((file.disabledServers || []).includes(baseName(key))) disabledBy.set(key, file.scope); }
  }
  const counts = Object.fromEntries(STATES.map(s => [s, 0]));
  const servers = Object.keys(mergedServers).map(key => {
    let verdict;
    if (managed.entry.status === 'unreadable') verdict = { state: 'unknown', reason: 'the managed requirements file exists but could not be read', basis: 'documented' };
    else if (unreadable) verdict = { state: 'unknown', reason: 'a Codex CLI file could not be read, so the enablement rules are incomplete', basis: 'documented' };
    else if (managed.allowlist && !managed.allowlist.includes(baseName(key))) verdict = { state: 'disabled', reason: 'the managed requirements mcp_servers allowlist does not name this server', basis: 'documented' };
    else if (disabledBy.has(key)) verdict = { state: 'disabled', reason: `enabled = false in the ${disabledBy.get(key)} config.toml`, basis: 'documented' };
    else verdict = { state: 'enabled', reason: 'configured and not disabled by any setting Boppi read', basis: 'documented' };
    counts[verdict.state] += 1;
    return { name: key, scope: scopeOf.get(key) || 'user', ...verdict };
  });
  return { servers, counts };
}

/** Last file to set a value wins: the project file is read after the user file, as Codex applies it. */
function effectivePolicy(files) {
  const out = { approvalPolicy: null, sandboxMode: null, approvalScope: null, sandboxScope: null };
  for (const file of files) {
    if (file.status !== 'found' || !file.policy) continue;
    if (file.policy.approvalPolicy !== null) { out.approvalPolicy = file.policy.approvalPolicy; out.approvalScope = file.scope; }
    if (file.policy.sandboxMode !== null) { out.sandboxMode = file.policy.sandboxMode; out.sandboxScope = file.scope; }
  }
  return out;
}

/** DISCOVERY status text for a found config.toml beyond its server count. */
function configStatus(file) {
  const parts = [];
  const p = file.policy || {};
  if (p.approvalPolicy) parts.push(`approval ${p.approvalPolicy}`);
  if (p.sandboxMode) parts.push(`sandbox ${p.sandboxMode}`);
  if (parts.length) parts.push('recorded, not graded');
  if (file.disabledServers && file.disabledServers.length) parts.push(`${file.disabledServers.length} server${file.disabledServers.length === 1 ? '' : 's'} disabled`);
  if (file.hooks && file.hooks.handlers) parts.push(`${file.hooks.handlers} inline hook handler${file.hooks.handlers === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** DISCOVERY status text for the managed requirements entry. */
function managedStatus(file) {
  const r = file.requirements || {};
  const parts = [];
  if (r.allowedApprovalPolicies) parts.push(`allowed approval policies: ${r.allowedApprovalPolicies.join(', ') || 'none'}`);
  if (r.allowedSandboxModes) parts.push(`allowed sandbox modes: ${r.allowedSandboxModes.join(', ') || 'none'}`);
  if (r.mcpAllowlist !== null && r.mcpAllowlist !== undefined) parts.push(`MCP allowlist: ${r.mcpAllowlist} server${r.mcpAllowlist === 1 ? '' : 's'}`);
  if (r.allowManagedHooksOnly === true) parts.push('managed hooks only');
  return `managed requirements (${parts.length ? parts.join(' · ') : 'no restrictions read'})`;
}

function locate({ home, cwd, platform, codexManagedDir = null }) {
  const configFile = (file, scope) => ({ path: file, scope, format: 'toml', blocks: [{ keyPath: ['mcp_servers'], scope }], map: serverShape, evidence: fileEvidence });
  const inspectFiles = [...hookFiles({ home, cwd }), ...managedFiles({ home, platform, managedDir: codexManagedDir })];
  return {
    clientKey: 'codex',
    label: 'Codex CLI',
    source: 'codex',
    manualEdit: MANUAL_EDIT,
    files: [configFile(path.join(home, '.codex', 'config.toml'), 'user'), configFile(path.join(cwd, '.codex', 'config.toml'), 'project')],
    // Read by watch and by inspect(); not permission settings, so they are never handed to the built-in tool grader.
    inspectFiles,
    /**
     * Called by discovery after the config files were read. Returns the hook
     * and managed file entries plus the client's mcpPolicy: enablement,
     * hook counts (inline and files), managed presence, and the policy values.
     */
    inspect(client) {
      const configs = client.files.filter(f => !f.kind);
      const inline = configs.reduce((total, f) => hooksModule.addCounts(total, f.hooks || hooksModule.emptyCounts()), hooksModule.emptyCounts());
      const { entries: hookEntries, hooks: fileHooks } = hooksModule.readHookFiles(inspectFiles.filter(f => f.kind === 'hooks'));
      const managed = inspectFiles.filter(f => f.kind === 'managed').map(managedEvidence)[0] || { entry: null, allowlist: null };
      const files = [...hookEntries, ...(managed.entry ? [managed.entry] : [])];
      const unreadable = [...configs, ...files].filter(f => f.status === 'unreadable').length;
      const hooks = { ...hooksModule.addCounts({ ...inline, byEvent: { ...inline.byEvent } }, fileHooks), files: fileHooks.files + configs.filter(f => f.hooks && f.hooks.handlers).length, inline: inline.handlers, unreadable: fileHooks.unreadable };
      const r = managed.entry && managed.entry.requirements;
      const mcpPolicy = {
        ...enablement({ mergedServers: client.mergedServers, files: configs, managed: managed.entry ? managed : { entry: { status: 'not_found' }, allowlist: null }, unreadable }),
        hooks,
        managed: { checked: managed.entry ? 1 : 0, found: !!managed.entry && managed.entry.status === 'found', locks: r && r.allowManagedHooksOnly ? ['allow_managed_hooks_only'] : [], allowedApprovalPolicies: r ? r.allowedApprovalPolicies : null, allowedSandboxModes: r ? r.allowedSandboxModes : null, mcpAllowlist: r ? r.mcpAllowlist : null, notRead: NOT_READ },
        policy: { ...effectivePolicy(configs), graded: false, note: 'recorded, not graded: no rubric row reads approval_policy or sandbox_mode (founder decision pending)' },
        complete: unreadable === 0,
      };
      return { files, mcpPolicy };
    },
  };
}

module.exports = { MANAGED_DIR, APPROVAL_POLICIES, SANDBOX_MODES, STATES, NOT_READ, MANUAL_EDIT, managedFiles, hookFiles, serverShape, serversOf, fileEvidence, managedEvidence, enablement, effectivePolicy, configStatus, managedStatus, locate };
