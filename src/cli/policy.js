/**
 * Policy guard: a small JSON file that says what an agent configuration may
 * not contain. Evaluated locally against the same inventory and paths the
 * report shows; no proxy, no runtime hook. A violation is a fact about the
 * configuration, so it is deterministic and reproducible.
 *
 * File shape (every key optional):
 * {
 *   "version": 1,
 *   "failOn": "high",                               // any path or finding at or above this severity
 *   "denyServers": ["desktop-commander", "/shell/i"], // name or command matching; "/re/flags" is a regex
 *   "allowServers": ["filesystem", "github"],        // when present, anything else is a violation
 *   "denyCapabilities": ["shell_access"],            // any server granting one of these
 *   "denyCombinations": [["credential_access", "network_access"]], // an agent holding all of them
 *   "requireKnownCapabilities": true                 // a server with no inferred capability is a violation
 * }
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SEVERITY_RANK = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const KEYS = new Set(['version', 'failOn', 'denyServers', 'allowServers', 'denyCapabilities', 'denyCombinations', 'requireKnownCapabilities']);
const DEFAULT_FILE = 'boppi.policy.json';

function fail(message) { throw new Error(`Policy: ${message}`); }

function stringList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && v.length)) fail(`${name} must be a list of non-empty strings`);
  return value;
}

/** "/re/flags" becomes a RegExp; anything else matches case-insensitively as a substring of the name or command. */
function matcher(pattern) {
  const m = pattern.match(/^\/(.+)\/([a-z]*)$/);
  if (m) {
    try { const re = new RegExp(m[1], m[2]); return text => re.test(text); } catch (_) { fail(`invalid regular expression ${pattern}`); }
  }
  const needle = pattern.toLowerCase();
  return text => text.toLowerCase().includes(needle);
}

function loadPolicy(file) {
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(`cannot read ${file}: ${error.message}`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail(`${file} must contain a JSON object`);
  for (const key of Object.keys(json)) if (!KEYS.has(key)) fail(`unknown key "${key}" in ${file}; known keys: ${[...KEYS].join(', ')}`);
  if (json.version !== undefined && json.version !== 1) fail(`unsupported version ${json.version}`);
  if (json.failOn !== undefined && !SEVERITY_RANK[json.failOn]) fail(`failOn must be one of ${Object.keys(SEVERITY_RANK).join(', ')}`);
  if (json.denyCombinations !== undefined && !(Array.isArray(json.denyCombinations) && json.denyCombinations.every(c => Array.isArray(c) && c.length >= 2 && c.every(v => typeof v === 'string' && v.length)))) fail('denyCombinations must be a list of lists of at least two capability names');
  if (json.requireKnownCapabilities !== undefined && typeof json.requireKnownCapabilities !== 'boolean') fail('requireKnownCapabilities must be true or false');
  return {
    file: path.resolve(file),
    failOn: json.failOn || null,
    denyServers: stringList(json.denyServers, 'denyServers').map(p => ({ pattern: p, test: matcher(p) })),
    allowServers: json.allowServers === undefined ? null : stringList(json.allowServers, 'allowServers').map(p => ({ pattern: p, test: matcher(p) })),
    denyCapabilities: stringList(json.denyCapabilities, 'denyCapabilities'),
    denyCombinations: (json.denyCombinations || []).map(c => [...new Set(c)].sort()),
    requireKnownCapabilities: !!json.requireKnownCapabilities,
  };
}

/** The policy file to use: the explicit one, else boppi.policy.json in cwd when it exists, else none. */
function discoverPolicy(explicit, cwd) {
  if (explicit) return path.resolve(explicit);
  const candidate = path.join(cwd, DEFAULT_FILE);
  return fs.existsSync(candidate) ? candidate : null;
}

function serverText(server) { return `${server.name} ${server.command || ''} ${(server.arguments || []).join(' ')} ${server.endpoint || ''}`; }

/** Violations from an inventory and its paths. Pure. */
function evaluatePolicy(policy, inventory, paths) {
  const violations = [];
  const agentName = id => (inventory.agents.find(a => a.id === id) || {}).name || id;
  const add = (ruleId, rule, severity, agentId, subject, title, detail) => violations.push({ ruleId, rule, severity, agentId, agentName: agentName(agentId), subject, title, detail });

  if (policy.failOn) {
    const floor = SEVERITY_RANK[policy.failOn];
    for (const p of paths) if ((SEVERITY_RANK[p.severity] || 0) >= floor) add('POL-SEVERITY', 'failOn', p.severity, p.agentId, p.exposureKey, `Exposure path at or above ${policy.failOn}`, `${p.label} (${p.templateId}) on ${p.agentName}.`);
    for (const f of inventory.findings || []) {
      if (['resolved', 'accepted_risk', 'false_positive'].includes(f.status)) continue;
      if ((SEVERITY_RANK[f.severity] || 0) >= floor) add('POL-SEVERITY', 'failOn', f.severity, f.agentId, f.id, `Finding at or above ${policy.failOn}`, `${f.title} (${f.ruleId}).`);
    }
  }
  for (const server of inventory.mcpServers || []) {
    const text = serverText(server);
    const denied = policy.denyServers.find(d => d.test(text));
    if (denied) add('POL-DENY-SERVER', 'denyServers', 'high', server.agentId, server.name, `Server "${server.name}" is denied`, `Matches denyServers pattern ${JSON.stringify(denied.pattern)}.`);
    if (policy.allowServers && !policy.allowServers.some(a => a.test(text))) add('POL-ALLOW-SERVER', 'allowServers', 'high', server.agentId, server.name, `Server "${server.name}" is not on the allow list`, `No allowServers pattern matches it.`);
    const deniedCapability = (server.capabilities || []).find(c => policy.denyCapabilities.includes(c));
    if (deniedCapability) add('POL-DENY-CAPABILITY', 'denyCapabilities', 'high', server.agentId, server.name, `Server "${server.name}" grants a denied capability`, `${deniedCapability} is in denyCapabilities.`);
    if (policy.requireKnownCapabilities && !(server.capabilities || []).length) add('POL-UNKNOWN-SERVER', 'requireKnownCapabilities', 'medium', server.agentId, server.name, `Server "${server.name}" has no inferred capability`, 'The policy requires every server to be recognized. Add it to the catalog or remove it.');
  }
  const byAgent = new Map();
  for (const server of inventory.mcpServers || []) {
    if (!byAgent.has(server.agentId)) byAgent.set(server.agentId, new Set());
    for (const c of server.capabilities || []) byAgent.get(server.agentId).add(c);
  }
  for (const combination of policy.denyCombinations) {
    for (const [agentId, capabilities] of byAgent) {
      if (combination.every(c => capabilities.has(c))) add('POL-DENY-COMBINATION', 'denyCombinations', 'critical', agentId, combination.join('+'), `Agent holds a denied capability combination`, `${agentName(agentId)} has ${combination.join(' and ')} across its servers.`);
    }
  }
  violations.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || a.ruleId.localeCompare(b.ruleId) || a.agentName.localeCompare(b.agentName) || a.subject.localeCompare(b.subject));
  return { file: policy.file, violations, passed: violations.length === 0 };
}

function renderPolicy(result, useColor) {
  const lines = [];
  const head = result.passed ? `POLICY  passed · ${result.file}` : `POLICY  ${result.violations.length} violation${result.violations.length === 1 ? '' : 's'} · ${result.file}`;
  lines.push(head);
  for (const v of result.violations) lines.push(`  ${v.severity.toUpperCase().padEnd(8)} ${v.ruleId.padEnd(22)} ${v.agentName.padEnd(16)} ${v.title}: ${v.detail}`);
  if (!result.violations.length) lines.push('  Every rule in the policy holds for the scanned configuration.');
  return lines.join('\n');
}

module.exports = { DEFAULT_FILE, loadPolicy, discoverPolicy, evaluatePolicy, renderPolicy };
