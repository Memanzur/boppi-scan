#!/usr/bin/env node
/* Exposure-path engine checks: template matching, bounds, honesty, prioritization. */
'use strict';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'engine');
const models = require(path.join(root, 'models'));
const graphlib = require(path.join(root, 'securityGraph'));
const engine = require(path.join(root, 'exposurePathEngine'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }

const NOW = '2026-08-07T12:00:00.000Z';
const importedSource = { id: 'src-oauth', type: 'oauth', name: 'Imported OAuth', observedAt: NOW };
const fixtureSource = { id: 'src-fixture', type: 'fixture', name: 'Sample data', observedAt: NOW };

function agent(over = {}) {
  return models.createAgent({ name: over.name || 'Claude', type: 'ai_application', vendor: 'Anthropic', source: importedSource, confidence: 0.9, createdAt: NOW, ...over });
}
function permission(agentId, category, over = {}) {
  return models.createPermission({ agentId, normalizedCategory: category, rawPermission: over.rawPermission || category, accessLevel: 'read', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, ...over });
}
function graphFor(permCategories, over = {}) {
  const a = agent(over.agent || {});
  const inventory = {
    agents: [a],
    integrations: [],
    permissions: permCategories.map(c => permission(a.id, c, over.permission || {})),
    mcpServers: (over.mcpServers || []).map(s => models.createMCPServer({ agentId: a.id, source: importedSource, createdAt: NOW, ...s })),
  };
  return { agent: a, graph: graphlib.buildGraph(inventory) };
}

// ── Determinism ─────────────────────────────────────────────────────────────
test('the chosen route does not depend on record id order', () => {
  // Two servers, each granting one readable source and one network grant: two equal-length EP-A routes.
  const build = () => graphFor([], { mcpServers: [] });
  const a = agent();
  const source = (name, category) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: `${name} (${category})`, accessLevel: 'read', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW });
  const inventory = { agents: [a], integrations: [], mcpServers: [], permissions: [source('alpha', 'read_files'), source('alpha', 'call_external_api'), source('beta', 'read_files'), source('beta', 'call_external_api')] };
  const graph = graphlib.buildGraph(inventory);
  // Same graph with every id rewritten so that the ids sort in the opposite order; labels are untouched.
  const ids = [...new Set(graph.nodes.map(n => n.id).concat(graph.edges.map(e => e.id)))].sort();
  const flipped = new Map(ids.map((id, i) => [id, `z${String(ids.length - i).padStart(6, '0')}`]));
  const re = id => flipped.get(id) || id;
  const mirrored = {
    nodes: graph.nodes.map(n => ({ ...n, id: re(n.id) })),
    edges: graph.edges.map(e => ({ ...e, id: re(e.id), fromEntityId: re(e.fromEntityId), toEntityId: re(e.toEntityId) })),
  };
  const chainOf = g => engine.findPaths(g).filter(p => p.templateId === 'EP-A').map(p => p.nodes.map(n => n.label).join(' -> '));
  assert.ok(chainOf(graph).length === 1, 'one EP-A path');
  assert.deepStrictEqual(chainOf(mirrored), chainOf(graph), 'the same route must be chosen whatever the ids sort like');
  assert.ok(chainOf(graph)[0].includes('alpha'), 'ties fall to the label that sorts first');
  void build;
});

test('blast radius walks the same label-ordered adjacency and never throws for an agent', () => {
  const { agent: a, graph } = graphFor(['read_files', 'call_external_api', 'access_credentials']);
  const radius = engine.blastRadius(graph, a.id);
  assert.ok(radius && typeof radius === 'object');
  assert.throws(() => engine.blastRadius(graph, 'nope'), /unknown agent/);
});

// ── Critical templates ───────────────────────────────────────────────────────
test('critical data-exfiltration path (sensitive data + external communication)', () => {
  const { graph } = graphFor(['access_customer_data', 'send_external_message']);
  const paths = engine.findPaths(graph);
  const exfil = paths.find(p => p.category === 'data_exfiltration');
  assert.ok(exfil, 'EP-A must fire');
  assert.strictEqual(exfil.severity, 'critical');
  assert.ok(exfil.nodes.some(n => n.entityType === 'data_category'));
  assert.ok(exfil.nodes.some(n => n.entityType === 'external_destination'));
  assert.ok(exfil.edges.length >= 3);
  assert.ok(exfil.evidenceCount >= 1);
});

test('critical credential-exposure path (credential + execution + network)', () => {
  const { graph } = graphFor(['access_credentials', 'execute_code', 'call_external_api']);
  const paths = engine.findPaths(graph);
  const cred = paths.find(p => p.category === 'credential_exposure');
  assert.ok(cred, 'EP-B must fire');
  assert.strictEqual(cred.severity, 'critical');
  assert.strictEqual(cred.impactEntityId, cred.nodes.find(n => n.entityType === 'credential_reference').id);
});

test('software supply-chain path (source modification + production)', () => {
  const { graph } = graphFor(['modify_source_code', 'access_production_system'], { agent: { name: 'Cursor', type: 'coding_agent' } });
  const paths = engine.findPaths(graph);
  const supply = paths.find(p => p.category === 'software_supply_chain');
  assert.ok(supply, 'EP-C must fire');
  assert.strictEqual(supply.severity, 'high', 'a bare production permission with no tool evidence is one step below the template');
  assert.ok(supply.nodes.some(n => n.entityType === 'production_system'));
});

test('supply-chain exposure requires an explicitly unverified MCP', () => {
  const unverified = graphFor(['access_customer_data'], { mcpServers: [{ name: 'mcp-a', trustStatus: 'unverified', confidence: 0.8 }] });
  assert.ok(engine.findPaths(unverified.graph).some(p => p.category === 'supply_chain_exposure'), 'unverified MCP + sensitive data must fire EP-D');
  const unknown = graphFor(['access_customer_data'], { mcpServers: [{ name: 'mcp-b', trustStatus: 'unknown', confidence: 0.8 }] });
  assert.ok(!engine.findPaths(unknown.graph).some(p => p.category === 'supply_chain_exposure'), 'unknown trust is uncertainty, not a path');
});

test('privilege path (untrusted content + privileged capability)', () => {
  const { graph } = graphFor(['untrusted_external_content', 'run_shell_commands']);
  const paths = engine.findPaths(graph);
  assert.ok(paths.some(p => p.category === 'privilege'));
});

test('impersonation path (email read + email send + browser content)', () => {
  const { graph } = graphFor(['read_email', 'send_email', 'browse_internet']);
  const paths = engine.findPaths(graph);
  assert.ok(paths.some(p => p.category === 'impersonation'));
});

// ── Honesty and false-positive control ───────────────────────────────────────
test('no false path from unrelated permissions', () => {
  const { graph } = graphFor(['read_calendar', 'make_purchase']);
  assert.deepStrictEqual(engine.findPaths(graph), []);
});

test('browser observation alone yields no paths', () => {
  const observed = models.createAgent({ name: 'ChatGPT', type: 'browser_ai_tool', source: { id: 's', type: 'browser', name: 'Browser', observedAt: NOW }, createdAt: NOW });
  const graph = graphlib.buildGraph({ agents: [observed], integrations: [], permissions: [], mcpServers: [] });
  assert.deepStrictEqual(engine.findPaths(graph), []);
});

test('path language stays potential, never claims an attack occurred', () => {
  const { graph } = graphFor(['access_customer_data', 'send_external_message']);
  const json = JSON.stringify(engine.findPaths(graph)).toLowerCase();
  assert.ok(json.includes('potential'));
  assert.doesNotMatch(json, /was exfiltrated|attack occurred|data was stolen|confirmed attack/);
  assert.ok(json.includes('not an execution trace'));
});

test('path objects expose only sanitized evidence metadata', () => {
  const { graph } = graphFor(['access_customer_data', 'send_external_message']);
  const [p] = engine.findPaths(graph);
  for (const source of p.evidence) assert.deepStrictEqual(Object.keys(source).sort(), ['evidenceClass', 'id', 'name', 'type']);
  for (const edge of p.edges) assert.deepStrictEqual(Object.keys(edge).sort(), ['confidence', 'evidenceClass', 'fromEntityId', 'id', 'relationshipType', 'stale', 'toEntityId']);
});

// ── Determinism, bounds, staleness ───────────────────────────────────────────
test('deterministic path IDs across repeated runs', () => {
  const { graph } = graphFor(['access_credentials', 'execute_code', 'call_external_api', 'access_customer_data', 'send_external_message']);
  const run1 = engine.findPaths(graph).map(p => p.id);
  const run2 = engine.findPaths(graph).map(p => p.id);
  assert.deepStrictEqual(run1, run2);
  assert.ok(run1.length >= 2);
});

test('repeated scans with identical evidence keep identical paths', () => {
  const build = () => {
    const a = agent({ providerAgentId: 'stable-agent' });
    return graphlib.buildGraph({ agents: [a], integrations: [], permissions: [permission(a.id, 'access_customer_data'), permission(a.id, 'send_external_message')], mcpServers: [] });
  };
  assert.deepStrictEqual(engine.findPaths(build()).map(p => p.id), engine.findPaths(build()).map(p => p.id));
});

test('cycle-safe traversal terminates', () => {
  const nodes = [
    { id: 'agent-x', entityType: 'ai_agent', label: 'X', confidence: 0.9, stale: false, dataset: 'real', metadata: {} },
    { id: 'n1', entityType: 'permission', label: 'p', confidence: 0.9, stale: false, dataset: 'real', metadata: {} },
  ];
  const mkEdge = (from, to) => ({ id: `e-${from}-${to}`, fromEntityId: from, toEntityId: to, fromEntityType: 'unknown', toEntityType: 'unknown', relationshipType: 'agent_has_permission', evidenceClass: 'imported', confidence: 0.9, stale: false, dataset: 'real', source: { id: 's', type: 't', name: 'n', evidenceClass: 'imported' }, firstSeenAt: NOW, lastSeenAt: NOW, metadata: {} });
  const graph = { schemaVersion: 1, nodes, edges: [mkEdge('agent-x', 'n1'), mkEdge('n1', 'agent-x')] };
  assert.deepStrictEqual(engine.findPaths(graph), []);
});

test('traversal depth is bounded', () => {
  const nodes = [{ id: 'agent-x', entityType: 'ai_agent', label: 'X', confidence: 0.9, stale: false, dataset: 'real', metadata: {} }];
  const edges = [];
  let prev = 'agent-x';
  for (let i = 0; i < engine.MAX_DEPTH + 2; i++) {
    const id = `hop-${i}`;
    nodes.push({ id, entityType: 'permission', label: id, confidence: 0.9, stale: false, dataset: 'real', metadata: {} });
    edges.push({ id: `e-${prev}-${id}`, fromEntityId: prev, toEntityId: id, fromEntityType: 'unknown', toEntityType: 'unknown', relationshipType: 'agent_has_permission', evidenceClass: 'imported', confidence: 0.9, stale: false, dataset: 'real', source: { id: 's', type: 't', name: 'n', evidenceClass: 'imported' }, firstSeenAt: NOW, lastSeenAt: NOW, metadata: {} });
    prev = id;
  }
  // Terminal nodes deeper than MAX_DEPTH: sensitive data + external destination.
  nodes.push({ id: 'deep-data', entityType: 'data_category', label: 'deep', confidence: 0.9, stale: false, dataset: 'real', metadata: { sensitive: true } });
  nodes.push({ id: 'deep-dest', entityType: 'external_destination', label: 'dest', confidence: 0.9, stale: false, dataset: 'real', metadata: {} });
  edges.push({ id: `e-${prev}-deep-data`, fromEntityId: prev, toEntityId: 'deep-data', fromEntityType: 'unknown', toEntityType: 'data_category', relationshipType: 'permission_grants_data_access', evidenceClass: 'imported', confidence: 0.9, stale: false, dataset: 'real', source: { id: 's', type: 't', name: 'n', evidenceClass: 'imported' }, firstSeenAt: NOW, lastSeenAt: NOW, metadata: {} });
  edges.push({ id: `e-${prev}-deep-dest`, fromEntityId: prev, toEntityId: 'deep-dest', fromEntityType: 'unknown', toEntityType: 'external_destination', relationshipType: 'capability_reaches_external_destination', evidenceClass: 'imported', confidence: 0.9, stale: false, dataset: 'real', source: { id: 's', type: 't', name: 'n', evidenceClass: 'imported' }, firstSeenAt: NOW, lastSeenAt: NOW, metadata: {} });
  assert.deepStrictEqual(engine.findPaths({ schemaVersion: 1, nodes, edges }), [], 'entities beyond the depth bound are unreachable');
});

test('total path count is bounded', () => {
  const agents = [];
  const permissions = [];
  for (let i = 0; i < engine.MAX_PATHS + 50; i++) {
    const a = agent({ name: `Agent ${i}`, providerAgentId: `bulk-${i}`, type: 'coding_agent' });
    agents.push(a);
    permissions.push(permission(a.id, 'modify_source_code', { rawPermission: `repo-${i} write` }));
    permissions.push(permission(a.id, 'access_production_system', { rawPermission: `prod-${i}` }));
  }
  const graph = graphlib.buildGraph({ agents, integrations: [], permissions, mcpServers: [] });
  const paths = engine.findPaths(graph);
  assert.ok(paths.length <= engine.MAX_PATHS, `expected <= ${engine.MAX_PATHS}, got ${paths.length}`);
});

test('stale evidence marks the path stale and reduces confidence', () => {
  const fresh = graphFor(['access_customer_data', 'send_external_message']);
  const stale = graphFor(['access_customer_data', 'send_external_message'], { agent: { stale: true } });
  const freshPath = engine.findPaths(fresh.graph).find(p => p.category === 'data_exfiltration');
  const stalePath = engine.findPaths(stale.graph).find(p => p.category === 'data_exfiltration');
  assert.strictEqual(stalePath.stale, true);
  assert.ok(stalePath.confidence < freshPath.confidence);
});

test('low-confidence evidence downgrades severity below critical', () => {
  const { graph } = graphFor(['access_customer_data', 'send_external_message'], { permission: { normalizationConfidence: 0.35 } });
  const p = engine.findPaths(graph).find(x => x.category === 'data_exfiltration');
  assert.ok(p, 'path still exists');
  assert.strictEqual(p.baseSeverity, 'critical');
  assert.strictEqual(p.severity, 'high', 'low confidence must not produce a critical path');
});

// ── Rubric: evidence strength sets the priority ──────────────────────────────
test('every path carries a versioned assessment with facts, assumptions, unknowns, and no likelihood claim', () => {
  const { graph } = graphFor(['access_customer_data', 'send_external_message']);
  const p = engine.findPaths(graph).find(x => x.category === 'data_exfiltration');
  assert.strictEqual(p.assessment.rubricVersion, engine.RUBRIC_VERSION);
  assert.strictEqual(p.assessment.impact, 'critical');
  assert.strictEqual(p.assessment.priority, p.severity);
  assert.strictEqual(p.assessment.likelihood, 'not assessed');
  assert.ok(p.assessment.facts.length >= 2 && p.assessment.branches.length === 2);
  assert.ok(p.assessment.unknowns.some(u => /no tool call, data transfer, or attack was observed/.test(u)));
});

test('generic file access with no scope evidence is assumed sensitive: two steps below the template', () => {
  const a = agent();
  const perm = (category, attributes, raw) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: raw || category, accessLevel: 'broad', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, attributes });
  const build = fileAttributes => graphlib.buildGraph({ agents: [a], integrations: [], mcpServers: [], permissions: [perm('read_files', fileAttributes, 'files'), perm('call_external_api', { basis: 'catalog' }, 'api')] });
  const priority = g => engine.findPaths(g).find(x => x.templateId === 'EP-A').severity;
  assert.strictEqual(priority(build({ basis: 'configured' })), 'medium', 'unknown scope is assumed');
  assert.strictEqual(priority(build({ basis: 'configured', scope: 'other' })), 'medium', 'one ordinary folder is assumed');
  assert.strictEqual(priority(build({ basis: 'configured', scope: 'source' })), 'high', 'a source tree is potential');
  assert.strictEqual(priority(build({ basis: 'configured', scope: 'home' })), 'critical', 'the home directory is established');
  assert.strictEqual(priority(build({ basis: 'configured', scope: 'secrets' })), 'critical', 'a secrets folder is established');
  const assumed = engine.findPaths(build({ basis: 'configured' })).find(x => x.templateId === 'EP-A').assessment;
  assert.strictEqual(assumed.weakestBranch, 'sensitiveData');
  assert.ok(assumed.unknowns.some(u => /whether any are sensitive, was not established/.test(u)));
});

test('a prompt, an unknown prompt, or a name-only inference each cost one step; a deny leaves no grant', () => {
  const a = agent({ name: 'Claude Code', type: 'coding_agent' });
  const perm = (category, attributes, raw) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: raw || category, accessLevel: 'broad', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, attributes });
  const build = shell => graphlib.buildGraph({ agents: [a], integrations: [], mcpServers: [], permissions: [perm('untrusted_external_content', { basis: 'catalog' }, 'fetch'), perm('run_shell_commands', shell, 'Bash')] });
  const priority = g => engine.findPaths(g).find(x => x.templateId === 'EP-E').severity;
  assert.strictEqual(priority(build({ basis: 'builtin', gate: 'unprompted' })), 'high');
  assert.strictEqual(priority(build({ basis: 'builtin', gate: 'prompted' })), 'medium');
  assert.strictEqual(priority(build({ basis: 'builtin', gate: 'unknown' })), 'medium');
  assert.strictEqual(priority(build({ basis: 'inferred' })), 'medium');
  const prompted = engine.findPaths(build({ basis: 'builtin', gate: 'prompted' })).find(x => x.templateId === 'EP-E').assessment;
  assert.ok(prompted.assumptions.some(t => /asks before each use/.test(t)));
  assert.ok(prompted.unknowns.some(t => /managed \(machine-wide\) permission settings were not read/.test(t)));
});

test('production write access is graded by the environment the configuration names', () => {
  const a = agent();
  const perm = (category, attributes, raw) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: raw || category, accessLevel: 'broad', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, attributes });
  const build = prod => graphlib.buildGraph({ agents: [a], integrations: [], mcpServers: [], permissions: [perm('modify_source_code', { basis: 'catalog' }, 'github'), perm('access_production_system', prod, 'k8s')] });
  const priority = g => engine.findPaths(g).find(x => x.templateId === 'EP-C').severity;
  assert.strictEqual(priority(build({ basis: 'catalog', writeAccess: true, environment: 'production' })), 'critical');
  assert.strictEqual(priority(build({ basis: 'catalog', writeAccess: true, environment: 'unknown' })), 'high');
  assert.strictEqual(priority(build({ basis: 'catalog', writeAccess: true, environment: 'non_production' })), 'high', 'a non-production name is a one-step assumption, not a two-step fact');
  const staging = engine.findPaths(build({ basis: 'catalog', writeAccess: true, environment: 'non_production' })).find(x => x.templateId === 'EP-C').assessment;
  assert.ok(staging.assumptions.some(t => /names a non-production environment/.test(t)));
  assert.strictEqual(priority(build({})), 'high', 'a contract that names production without tool or environment evidence is potential, not established');
  const bare = engine.findPaths(build({})).find(x => x.templateId === 'EP-C').assessment;
  assert.ok(bare.unknowns.some(u => /no tool list showed what it can change/.test(u)));
});

test('a credential known only by a variable name is potential; a secrets-folder scope is established', () => {
  const a = agent();
  const perm = (category, attributes, raw) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: raw || category, accessLevel: 'broad', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, attributes });
  const build = cred => graphlib.buildGraph({ agents: [a], integrations: [], mcpServers: [], permissions: [perm('access_credentials', cred, 'creds'), perm('run_shell_commands', { basis: 'catalog' }, 'shell'), perm('call_external_api', { basis: 'catalog' }, 'api')] });
  const priority = g => engine.findPaths(g).find(x => x.templateId === 'EP-B').severity;
  assert.strictEqual(priority(build({ basis: 'configured', credentialKind: 'environment_name' })), 'high');
  assert.strictEqual(priority(build({ basis: 'configured', scope: 'secrets' })), 'critical');
  assert.strictEqual(priority(build({ basis: 'inferred', credentialKind: 'capability' })), 'high');
});

test('the strongest grant on a branch wins, whatever its label sorts like', () => {
  const a = agent();
  const perm = (category, attributes, raw) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: raw, accessLevel: 'broad', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, attributes });
  const graph = graphlib.buildGraph({ agents: [a], integrations: [], mcpServers: [], permissions: [perm('read_files', { basis: 'configured' }, 'aaa-generic'), perm('read_files', { basis: 'configured', scope: 'home' }, 'zzz-home'), perm('call_external_api', { basis: 'catalog' }, 'api')] });
  const p = engine.findPaths(graph).find(x => x.templateId === 'EP-A');
  assert.strictEqual(p.severity, 'critical');
  assert.ok(p.assessment.facts.some(f => f.startsWith('zzz-home')), 'the established grant is cited');
});

test('the displayed chain runs through the grant the facts cite, not the first label', () => {
  const a = agent({ name: 'Claude Code', type: 'coding_agent' });
  const perm = (category, attributes, raw) => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: raw, accessLevel: 'broad', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, attributes });
  const graph = graphlib.buildGraph({ agents: [a], integrations: [], mcpServers: [], permissions: [perm('read_files', { basis: 'builtin', gate: 'unknown', scope: 'home', scopeLabel: 'the working folder is the whole home directory' }, 'Claude Code built-in file access'), perm('read_files', { basis: 'configured', scope: 'home' }, 'zz-filesystem'), perm('call_external_api', { basis: 'catalog' }, 'api')] });
  const p = engine.findPaths(graph).find(x => x.templateId === 'EP-A');
  const chainLabels = p.nodes.map(n => n.label);
  const cited = p.assessment.branches.find(b => b.name === 'sensitiveData').grantor;
  assert.ok(chainLabels.includes(cited), `the cited grant "${cited}" is on the chain ${chainLabels.join(' -> ')}`);
});

// ── Dataset separation and prioritization ────────────────────────────────────
test('sample inventory produces sample paths', () => {
  const a = models.createAgent({ name: 'Sample bot', type: 'ai_agent', source: fixtureSource, createdAt: NOW });
  const graph = graphlib.buildGraph({ agents: [a], integrations: [], permissions: [permission(a.id, 'access_customer_data', { source: fixtureSource }), permission(a.id, 'send_external_message', { source: fixtureSource, rawPermission: 'slack send' })], mcpServers: [] });
  const paths = engine.findPaths(graph);
  assert.ok(paths.length > 0);
  assert.ok(paths.every(p => p.dataset === 'sample'));
});

test('prioritization: counts, per-agent highest path, highest impact', () => {
  const a = agent({ name: 'Risky agent', providerAgentId: 'risky' });
  const b = agent({ name: 'Mail agent', providerAgentId: 'mail' });
  const graph = graphlib.buildGraph({
    agents: [a, b], integrations: [], mcpServers: [],
    permissions: [
      permission(a.id, 'access_credentials'), permission(a.id, 'execute_code'), permission(a.id, 'call_external_api'),
      permission(a.id, 'access_customer_data'), permission(a.id, 'send_external_message', { rawPermission: 'slack send' }),
      permission(b.id, 'read_email', { rawPermission: 'gmail.readonly' }), permission(b.id, 'send_email', { rawPermission: 'gmail.modify' }), permission(b.id, 'browse_internet', { rawPermission: 'web browsing' }),
    ],
  });
  const paths = engine.findPaths(graph);
  const summary = engine.prioritize(paths);
  assert.ok(summary.counts.critical >= 2, 'risky agent contributes critical paths');
  assert.strictEqual(summary.perAgent[0].agentName, 'Risky agent', 'per-agent rollup sorts by highest severity');
  assert.strictEqual(summary.perAgent[0].highestPath.severity, 'critical');
  assert.ok(summary.perAgent[0].highestImpact, 'highest-impact reachable asset is reported');
  assert.strictEqual(summary.perAgent[0].highestImpact.entityType, 'credential_reference', 'credential outranks external destination');
  const mail = summary.perAgent.find(x => x.agentName === 'Mail agent');
  assert.ok(mail && mail.pathCount >= 1);
});

console.log(`Exposure path checks: ${passed} passed, 0 failed`);
