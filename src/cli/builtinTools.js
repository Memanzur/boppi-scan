/**
 * The agent's own tools. Claude Code and Cursor run shell commands and read
 * and write files without any MCP server, so a scan that reads only
 * mcpServers misses the most privileged capabilities on the machine. This
 * module holds the per-client table of those built-in tools and, for Claude
 * Code, grades each one from the permission settings files as unprompted,
 * prompted, or denied. Only grades and rule counts leave this module: allow
 * and deny rules can name commands and paths, so the rule text is never kept.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const models = require('../engine/models');
const toolCategories = require('./toolCategories');

// prompts: true means the tool asks before each use unless a rule or mode
// says otherwise; false means it never asks (Read inside the working tree);
// null means the client keeps that setting where this scanner cannot read it.
const BUILTIN_TOOLS = Object.freeze({
  'claude-code': Object.freeze([
    Object.freeze({ tool: 'Bash', capability: 'shell_access', prompts: true }),
    Object.freeze({ tool: 'Read', capability: 'filesystem_access', prompts: false }),
    Object.freeze({ tool: 'Edit', capability: 'filesystem_access', prompts: true }),
    Object.freeze({ tool: 'Write', capability: 'filesystem_access', prompts: true }),
    Object.freeze({ tool: 'WebFetch', capability: 'web_fetch', prompts: true }),
    Object.freeze({ tool: 'WebSearch', capability: 'web_search', prompts: true }),
  ]),
  cursor: Object.freeze([
    Object.freeze({ tool: 'terminal', capability: 'shell_access', prompts: null }),
    Object.freeze({ tool: 'file edits', capability: 'filesystem_access', prompts: null }),
  ]),
});
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const UNPROMPTED_MODES = new Set(['bypassPermissions', 'dontAsk']);
const GATE_RANK = Object.freeze({ unprompted: 3, prompted: 2, unknown: 1, denied: 0 });
const CAPABILITY_LABEL = Object.freeze({ shell_access: 'shell access', filesystem_access: 'file access', web_fetch: 'web fetch', web_search: 'web search' });
const CAPABILITY_VERB = Object.freeze({ shell_access: 'runs shell commands', filesystem_access: 'reads and writes files', web_fetch: 'fetches web pages', web_search: 'searches the web' });
const RISK_WEIGHT = Object.freeze({ shell_access: 3, filesystem_access: 2, web_fetch: 2, web_search: 1 });
// Each web tool is its own grant, so a rule written for one is never asserted about the other (rubric 1.0.3).
// WebFetch reaches a destination the model chooses and returns its content: an external destination and untrusted content.
// WebSearch returns untrusted content; a search query is not treated as a destination the model can deliver data to.
const CATEGORIES = Object.freeze({ shell_access: ['run_shell_commands'], filesystem_access: ['read_files'], web_fetch: ['call_external_api', 'untrusted_external_content'], web_search: ['untrusted_external_content'] });
const UNREADABLE_SETTING = 'prompting not checked (the client keeps this setting outside readable configuration)';
const UNREADABLE_FILE = 'prompting not checked (a permission settings file could not be read)';
// Read inside the working folder never asks; outside it the client asks first.
const READ_DEFAULT = 'never prompts inside the working folder (asks elsewhere)';
const WORKING_SCOPE_LABEL = Object.freeze({
  home: 'the working folder is the home directory', system: 'the working folder is a system-wide directory',
  secrets: 'the working folder is a dotfile or secrets folder', source: 'the working folder is a source tree', other: 'the working folder is an ordinary folder',
});

/** Claude Code permission settings files, lowest precedence first. Managed (machine-wide) settings are not read. */
function claudeCodeSettingsFiles({ home, cwd }) {
  return [
    { path: path.join(home, '.claude', 'settings.json'), scope: 'user' },
    { path: path.join(cwd, '.claude', 'settings.json'), scope: 'project' },
    { path: path.join(cwd, '.claude', 'settings.local.json'), scope: 'local' },
  ];
}

function stringList(value) { return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; }

/** `Tool` or `Tool(specifier)`. */
function parseRule(rule) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([\s\S]*)\))?\s*$/.exec(rule);
  return match ? { tool: match[1], specifier: match[2] == null ? null : match[2].trim() } : null;
}
function coversWholeTool(rule, tool) {
  const parsed = parseRule(rule);
  return !!parsed && parsed.tool === tool && (parsed.specifier === null || /^\*?(?::\*)?$/.test(parsed.specifier));
}
function namesTool(rule, tool) {
  const parsed = parseRule(rule);
  return !!parsed && parsed.tool === tool;
}

/**
 * Read the settings files that exist and merge their permission blocks. The
 * last file that sets defaultMode wins; allow, deny, and ask lists are
 * unioned, which matches how a deny in any file applies everywhere. Returns
 * one discovery entry per file (counts only, never rule text) and the merged
 * rules, or merged null when no file was found.
 */
function readPermissionSettings(files) {
  const entries = [];
  const seen = new Set();
  let merged = null;
  let unreadable = 0;
  for (const file of files) {
    const resolved = path.resolve(file.path);
    if (seen.has(resolved)) continue; // user and project settings are the same file when the scan runs from home
    seen.add(resolved);
    const entry = { path: resolved, scope: file.scope, kind: 'settings', status: 'not_found', serverCount: 0 };
    if (fs.existsSync(resolved)) {
      try {
        const json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        const block = json && typeof json.permissions === 'object' && json.permissions && !Array.isArray(json.permissions) ? json.permissions : {};
        const allow = stringList(block.allow);
        const deny = stringList(block.deny);
        const ask = stringList(block.ask);
        const mode = typeof block.defaultMode === 'string' ? block.defaultMode : null;
        merged = merged || { allow: [], deny: [], ask: [], mode: null, modeScope: null };
        merged.allow.push(...allow);
        merged.deny.push(...deny);
        merged.ask.push(...ask);
        if (mode) { merged.mode = mode; merged.modeScope = file.scope; }
        entry.status = 'found';
        entry.rules = { allow: allow.length, deny: deny.length, ask: ask.length, mode };
      } catch (error) {
        entry.status = 'unreadable';
        entry.reason = error.code === 'EACCES' || error.code === 'EPERM' ? 'permission denied'
          : error.code === 'EISDIR' ? 'this is a directory, not a settings file'
          : 'invalid JSON';
        unreadable += 1;
      }
    }
    entries.push(entry);
  }
  // A file that could not be read may hold a deny or a mode; nothing graded from the others is complete.
  if (unreadable) merged = { ...(merged || { allow: [], deny: [], ask: [], mode: null, modeScope: null }), unreadable };
  return { entries, merged };
}

/**
 * Grade one built-in tool. `settings` is the merged rules, null when no
 * settings file exists (the client's defaults apply), or undefined when the
 * scan did not read settings at all. A deny rule is checked before any
 * default, so an explicitly denied Read is denied even though Read never
 * prompts; a rule that names the tool with a specifier (a path or command
 * pattern) does not change the grade but is counted.
 */
function gradeTool(spec, settings) {
  if (spec.prompts === null) return { gate: 'unknown', reason: UNREADABLE_SETTING };
  if (settings === undefined) return { gate: 'unknown', reason: 'prompting not checked (permission settings were not read in this scan)' };
  if (settings && settings.deny.some(rule => coversWholeTool(rule, spec.tool))) return { gate: 'denied', reason: 'denied by a settings deny rule' };
  if (settings && settings.unreadable) return { gate: 'unknown', reason: UNREADABLE_FILE };
  const scopedDeny = settings ? settings.deny.filter(rule => namesTool(rule, spec.tool) && !coversWholeTool(rule, spec.tool)).length : 0;
  const except = scopedDeny ? ` except ${scopedDeny} denied pattern${scopedDeny === 1 ? '' : 's'}` : '';
  if (spec.prompts === false) return { gate: 'unprompted', reason: `${READ_DEFAULT}${except}` };
  if (!settings) return { gate: 'prompted', reason: 'asks before each use (no permission settings file; client default)' };
  if (settings.ask.some(rule => coversWholeTool(rule, spec.tool))) return { gate: 'prompted', reason: `asks before each use (settings ask rule)${except}` };
  if (UNPROMPTED_MODES.has(settings.mode)) return { gate: 'unprompted', reason: `never prompts (defaultMode ${settings.mode} in ${settings.modeScope} settings)${except}` };
  if (settings.allow.some(rule => coversWholeTool(rule, spec.tool))) return { gate: 'unprompted', reason: `never prompts (a settings allow rule covers the whole tool)${except}` };
  if (EDIT_TOOLS.has(spec.tool) && settings.mode === 'acceptEdits') return { gate: 'unprompted', reason: `never prompts (defaultMode acceptEdits in ${settings.modeScope} settings)${except}` };
  const scoped = settings.allow.filter(rule => namesTool(rule, spec.tool)).length;
  const allowed = scoped ? ` except ${scoped} allowed pattern${scoped === 1 ? '' : 's'}` : '';
  return { gate: 'prompted', reason: `asks before each use${allowed}${except}` };
}

/** Plain sentence for a grant's tools, grouped by what the settings say about them. */
function gateSentence(tools) {
  const groups = new Map();
  for (const tool of tools) {
    if (!groups.has(tool.reason)) groups.set(tool.reason, []);
    groups.get(tool.reason).push(tool.tool);
  }
  if (groups.size === 1) return tools[0].reason;
  return [...groups].map(([reason, names]) => `${joinNames(names)} ${reason.replace(/^asks/, names.length === 1 ? 'asks' : 'ask').replace(/^never prompts/, names.length === 1 ? 'never prompts' : 'never prompt')}`).join('; ');
}
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The built-in grants of one client: per capability, its tools with their
 * grades, and the capability's gate (the least gated tool wins, since one
 * unprompted tool is enough to use the capability). A capability whose every
 * tool is denied is reported under `denied` and creates no graph reach.
 */
function builtinGrants(clientKey, settings) {
  const specs = BUILTIN_TOOLS[clientKey] || [];
  const byCapability = new Map();
  for (const spec of specs) {
    if (!byCapability.has(spec.capability)) byCapability.set(spec.capability, []);
    byCapability.get(spec.capability).push({ tool: spec.tool, ...gradeTool(spec, settings) });
  }
  const grants = [];
  const denied = [];
  for (const [capability, tools] of byCapability) {
    const gate = tools.reduce((best, tool) => (GATE_RANK[tool.gate] > GATE_RANK[best] ? tool.gate : best), 'denied');
    const entry = { capability, label: CAPABILITY_LABEL[capability], tools, gate, summary: gateSentence(tools) };
    (gate === 'denied' ? denied : grants).push(entry);
  }
  // A deny on the file tools does not stop a shell from reading or writing those files; the shell keeps the file reach at its own gate.
  const shell = grants.find(g => g.capability === 'shell_access');
  const filesDenied = denied.find(g => g.capability === 'filesystem_access');
  if (shell && filesDenied) {
    filesDenied.summary = `${filesDenied.summary}; ${shell.label} (${shell.tools.map(t => t.tool).join(', ')}) can still read and write any file the user can`;
    grants.push({ capability: 'filesystem_access', label: `${CAPABILITY_LABEL.filesystem_access} through the shell`, tools: shell.tools, gate: shell.gate, viaShell: true, summary: `${filesDenied.tools.map(t => t.tool).join(', ')} denied, but ${shell.tools.map(t => t.tool).join(', ')} ${shell.gate === 'unprompted' ? 'never prompts' : shell.gate === 'prompted' ? 'asks before each use' : 'prompting not checked'} and reads any file the user can` });
  }
  return { grants, denied };
}

/**
 * Everything a scan records about one client's built-in tools. `settingsFiles`
 * null means this scan does not read permission settings (explicit --config
 * mode, or a client without readable settings). `context` carries the scan's
 * home and working folder so the file tools' unprompted scope can be graded
 * (a label, never the path). Managed (machine-wide) settings are never read
 * and the description says so.
 */
function describeBuiltin(clientKey, settingsFiles, context = {}) {
  const read = Array.isArray(settingsFiles) && settingsFiles.length > 0;
  const { entries, merged } = read ? readPermissionSettings(settingsFiles) : { entries: [], merged: null };
  const settings = read
    ? { read: true, found: !!merged && !!(entries.some(e => e.status === 'found')), complete: !!merged ? !merged.unreadable : true, mode: merged ? merged.mode : null, modeScope: merged ? merged.modeScope : null, managedRead: false, files: entries }
    : { read: false, found: false, complete: false, mode: null, modeScope: null, managedRead: false, files: [] };
  const workingScope = context.cwd && hasBuiltinTools(clientKey) ? toolCategories.scopeOf(context.cwd, context.home) : null;
  return { clientKey, ...builtinGrants(clientKey, read ? merged : undefined), settings, workingScope, workingScopeLabel: workingScope ? WORKING_SCOPE_LABEL[workingScope] : null };
}

function hasBuiltinTools(clientKey) { return (BUILTIN_TOOLS[clientKey] || []).length > 0; }

/** One permission record per built-in grant, attached to the agent itself (no integration). */
function builtinPermissions(agent, builtin, observedAt) {
  if (!builtin || !Array.isArray(builtin.grants)) return [];
  return builtin.grants.flatMap(grant => (CATEGORIES[grant.capability] || []).map(category => {
    const toolNames = grant.tools.filter(t => t.gate !== 'denied').map(t => t.tool);
    const toolPhrase = `${joinNames(toolNames)} tool${toolNames.length === 1 ? '' : 's'}`;
    return models.createPermission({
      agentId: agent.id,
      rawPermission: `${agent.name} built-in ${grant.label} (${toolNames.join(', ')})`,
      normalizedCategory: category,
      accessLevel: grant.gate,
      riskWeight: RISK_WEIGHT[grant.capability] || 1,
      normalizationConfidence: 0.9,
      normalizationReason: `${agent.name} ${CAPABILITY_VERB[grant.capability]} through its built-in ${toolPhrase}; no MCP server is involved. Permission settings: ${grant.summary}.`,
      source: {
        ...agent.source,
        id: `builtin:${builtin.clientKey}:${grant.capability}:${category}`,
        type: 'builtin-tool',
        name: `${agent.name} built-in tools`,
        evidenceClass: 'observed',
        evidenceRef: builtin.settings && builtin.settings.found ? 'client built-in tool table and permission settings' : 'client built-in tool table',
      },
      attributes: {
        basis: 'builtin',
        gate: grant.gate,
        settingsRead: !!(builtin.settings && builtin.settings.read),
        settingsComplete: !!(builtin.settings && builtin.settings.complete),
        managedSettingsRead: false,
        ...(grant.viaShell ? { scope: 'home', scopeLabel: 'any file the user can read, through the shell' } : grant.capability === 'filesystem_access' && builtin.workingScope ? { scope: builtin.workingScope, scopeLabel: builtin.workingScopeLabel } : {}),
      },
      createdAt: observedAt,
      updatedAt: observedAt,
    });
  }));
}

const BUILTIN_SOURCE = /^builtin:[^:]+:([a-z_]+)(?::[a-z_]+)?$/;
/** Capability ids an agent holds through its own tools, read back from the normalized inventory. */
function builtinCapabilities(inventory, agentId) {
  return [...new Set((inventory.permissions || [])
    .filter(p => p.agentId === agentId && p.source && p.source.type === 'builtin-tool')
    .map(p => (BUILTIN_SOURCE.exec(p.source.id || '') || [])[1])
    .filter(Boolean))].sort();
}

const SETTINGS_DENY_HINT = Object.freeze({ 'claude-code': 'permissions.deny in ~/.claude/settings.json' });

/**
 * The built-in tools that keep the given exposure paths open: one entry per
 * agent whose chain runs through a built-in grant, with the names of the
 * tools that are not denied. `settingsHint` names where a deny rule goes only
 * when this scan read the client's settings; `settingsRead` says whether it did.
 */
function builtinHoldings(report, exposureKeys) {
  const keys = new Set(exposureKeys || []);
  const permissions = new Map(((report.inventory && report.inventory.permissions) || []).map(p => [p.id, p]));
  const clientList = Array.isArray(report.discovery) ? report.discovery : (report.discovery && report.discovery.clients) || [];
  const clients = new Map(clientList.filter(c => c.agentId).map(c => [c.agentId, c]));
  const holdings = new Map();
  for (const path of report.paths || []) {
    if (!keys.has(path.exposureKey)) continue;
    const client = clients.get(path.agentId);
    if (!client || !client.builtin) continue;
    for (const node of path.nodes || []) {
      const permission = permissions.get(node.id);
      const match = permission && permission.source ? BUILTIN_SOURCE.exec(permission.source.id || '') : null;
      const grant = match && client.builtin.grants.find(g => g.capability === match[1] && !g.viaShell);
      if (!grant) continue;
      const category = permission.normalizedCategory || permission.category || null;
      const settingsRead = !!(client.builtin.settings && client.builtin.settings.read);
      if (!holdings.has(path.agentId)) holdings.set(path.agentId, { agentId: path.agentId, clientKey: client.clientKey, client: client.label, tools: new Set(), exposureKeys: new Set(), settingsRead, settingsHint: settingsRead ? SETTINGS_DENY_HINT[client.clientKey] || null : null });
      const holding = holdings.get(path.agentId);
      holding.exposureKeys.add(path.exposureKey);
      for (const tool of grant.tools) if (tool.gate !== 'denied' && !(category === 'read_files' && EDIT_TOOLS.has(tool.tool))) holding.tools.add(tool.tool);
    }
  }
  return [...holdings.values()].map(h => ({ ...h, tools: [...h.tools].sort(), exposureKeys: [...h.exposureKeys].sort() }));
}

const BUILTIN_EQUIVALENTS = Object.freeze({ web_fetch: ['network_access', 'untrusted_external_content'], web_search: ['untrusted_external_content'] });

/** Server capability ids the agent's own tools also cover. Whether a given server's loss is covered is decided by the caller (a server that carries a credential reaches something WebFetch cannot). */
function builtinCovers(inventory, agentId) {
  return [...new Set(builtinCapabilities(inventory, agentId).flatMap(c => [c, ...(BUILTIN_EQUIVALENTS[c] || [])]))].sort();
}

/**
 * Plain sentences for the paths an agent's built-in tools hold on their own,
 * from a rescan with every MCP server removed (see predict.builtinResidualForClient).
 * `keys` says which paths the caller is asking about: an agent whose residual
 * touches none of them gets no sentence, and an agent that does gets its whole
 * residual counted, so every surface states the same number. Boppi never edits settings.
 */
function builtinResidualSentences(residual, keys) {
  const wanted = new Set(keys || []);
  return (residual || []).map(entry => {
    if (!entry.exposureKeys.some(key => wanted.has(key))) return null;
    const count = entry.exposureKeys.length;
    const where = entry.settingsHint ? `Boppi never edits permission settings; a deny rule for a tool under ${entry.settingsHint} removes its grant, and the next scan shows the effect.`
      : entry.settingsRead === false && SETTINGS_DENY_HINT[entry.clientKey] ? `This scan did not read ${entry.client}'s permission settings (explicit --config mode), so whether these tools prompt is not checked here; a scan without --config reads them.`
      : `Boppi cannot read ${entry.client}'s permission settings, so this stays an unknown.`;
    const list = entry.exposureKeys.map(key => `${key.split(':')[0]} at ${entry.priorities[key]}`).join(', ');
    return `${count} path${count === 1 ? '' : 's'} would stay open on ${entry.client} with every MCP server removed, through its built-in tools (${entry.tools.join(', ')}): ${list}. ${where} Denying a core tool such as Read or Bash also changes how the agent works.`;
  }).filter(Boolean);
}

module.exports = { BUILTIN_TOOLS, claudeCodeSettingsFiles, readPermissionSettings, gradeTool, builtinGrants, describeBuiltin, hasBuiltinTools, builtinPermissions, builtinCapabilities, builtinCovers, builtinHoldings, builtinResidualSentences, coversWholeTool, parseRule };
