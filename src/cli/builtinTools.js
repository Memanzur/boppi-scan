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

// prompts: true means the tool asks before each use unless a rule or mode
// says otherwise; false means it never asks (Read inside the working tree);
// null means the client keeps that setting where this scanner cannot read it.
const BUILTIN_TOOLS = Object.freeze({
  'claude-code': Object.freeze([
    Object.freeze({ tool: 'Bash', capability: 'shell_access', prompts: true }),
    Object.freeze({ tool: 'Read', capability: 'filesystem_access', prompts: false }),
    Object.freeze({ tool: 'Edit', capability: 'filesystem_access', prompts: true }),
    Object.freeze({ tool: 'Write', capability: 'filesystem_access', prompts: true }),
  ]),
  cursor: Object.freeze([
    Object.freeze({ tool: 'terminal', capability: 'shell_access', prompts: null }),
    Object.freeze({ tool: 'file edits', capability: 'filesystem_access', prompts: null }),
  ]),
});
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const UNPROMPTED_MODES = new Set(['bypassPermissions', 'dontAsk']);
const GATE_RANK = Object.freeze({ unprompted: 3, prompted: 2, unknown: 1, denied: 0 });
const CAPABILITY_LABEL = Object.freeze({ shell_access: 'shell access', filesystem_access: 'file access' });
const CAPABILITY_VERB = Object.freeze({ shell_access: 'runs shell commands', filesystem_access: 'reads and writes files' });
const RISK_WEIGHT = Object.freeze({ shell_access: 3, filesystem_access: 2 });
const CATEGORY = Object.freeze({ shell_access: 'run_shell_commands', filesystem_access: 'read_files' });
const UNREADABLE_SETTING = 'prompting not checked (the client keeps this setting outside readable configuration)';

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
      }
    }
    entries.push(entry);
  }
  return { entries, merged };
}

/**
 * Grade one built-in tool. `settings` is the merged rules, null when no
 * settings file exists (the client's defaults apply), or undefined when the
 * scan did not read settings at all.
 */
function gradeTool(spec, settings) {
  if (spec.prompts === null) return { gate: 'unknown', reason: UNREADABLE_SETTING };
  if (spec.prompts === false) return { gate: 'unprompted', reason: 'never prompts' };
  if (settings === undefined) return { gate: 'unknown', reason: 'prompting not checked (permission settings were not read in this scan)' };
  if (!settings) return { gate: 'prompted', reason: 'asks before each use (no permission settings file; client default)' };
  if (settings.deny.some(rule => coversWholeTool(rule, spec.tool))) return { gate: 'denied', reason: 'denied by a settings deny rule' };
  if (settings.ask.some(rule => coversWholeTool(rule, spec.tool))) return { gate: 'prompted', reason: 'asks before each use (settings ask rule)' };
  if (UNPROMPTED_MODES.has(settings.mode)) return { gate: 'unprompted', reason: `never prompts (defaultMode ${settings.mode} in ${settings.modeScope} settings)` };
  if (settings.allow.some(rule => coversWholeTool(rule, spec.tool))) return { gate: 'unprompted', reason: 'never prompts (a settings allow rule covers the whole tool)' };
  if (EDIT_TOOLS.has(spec.tool) && settings.mode === 'acceptEdits') return { gate: 'unprompted', reason: `never prompts (defaultMode acceptEdits in ${settings.modeScope} settings)` };
  const scoped = settings.allow.filter(rule => namesTool(rule, spec.tool)).length;
  return { gate: 'prompted', reason: scoped ? `asks before each use except ${scoped} allowed pattern${scoped === 1 ? '' : 's'}` : 'asks before each use' };
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
  return { grants, denied };
}

/**
 * Everything a scan records about one client's built-in tools. `settingsFiles`
 * null means this scan does not read permission settings (explicit --config
 * mode, or a client without readable settings).
 */
function describeBuiltin(clientKey, settingsFiles) {
  const read = Array.isArray(settingsFiles) && settingsFiles.length > 0;
  const { entries, merged } = read ? readPermissionSettings(settingsFiles) : { entries: [], merged: null };
  const settings = read
    ? { read: true, found: !!merged, mode: merged ? merged.mode : null, modeScope: merged ? merged.modeScope : null, files: entries }
    : { read: false, found: false, mode: null, modeScope: null, files: [] };
  return { clientKey, ...builtinGrants(clientKey, read ? merged : undefined), settings };
}

function hasBuiltinTools(clientKey) { return (BUILTIN_TOOLS[clientKey] || []).length > 0; }

/** One permission record per built-in grant, attached to the agent itself (no integration). */
function builtinPermissions(agent, builtin, observedAt) {
  if (!builtin || !Array.isArray(builtin.grants)) return [];
  return builtin.grants.map(grant => {
    const toolNames = grant.tools.map(t => t.tool);
    const toolPhrase = `${joinNames(toolNames)} tool${toolNames.length === 1 ? '' : 's'}`;
    return models.createPermission({
      agentId: agent.id,
      rawPermission: `${agent.name} built-in ${grant.label} (${toolNames.join(', ')})`,
      normalizedCategory: CATEGORY[grant.capability],
      accessLevel: grant.gate,
      riskWeight: RISK_WEIGHT[grant.capability] || 1,
      normalizationConfidence: 0.9,
      normalizationReason: `${agent.name} ${CAPABILITY_VERB[grant.capability]} through its built-in ${toolPhrase}; no MCP server is involved. Permission settings: ${grant.summary}.`,
      source: {
        ...agent.source,
        id: `builtin:${builtin.clientKey}:${grant.capability}`,
        type: 'builtin-tool',
        name: `${agent.name} built-in tools`,
        evidenceClass: 'observed',
        evidenceRef: builtin.settings && builtin.settings.found ? 'client built-in tool table and permission settings' : 'client built-in tool table',
      },
      createdAt: observedAt,
      updatedAt: observedAt,
    });
  });
}

const BUILTIN_SOURCE = /^builtin:[^:]+:([a-z_]+)$/;
/** Capability ids an agent holds through its own tools, read back from the normalized inventory. */
function builtinCapabilities(inventory, agentId) {
  return [...new Set((inventory.permissions || [])
    .filter(p => p.agentId === agentId && p.source && p.source.type === 'builtin-tool')
    .map(p => (BUILTIN_SOURCE.exec(p.source.id || '') || [])[1])
    .filter(Boolean))].sort();
}

module.exports = { BUILTIN_TOOLS, claudeCodeSettingsFiles, readPermissionSettings, gradeTool, builtinGrants, describeBuiltin, hasBuiltinTools, builtinPermissions, builtinCapabilities, coversWholeTool, parseRule };
