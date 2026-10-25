#!/usr/bin/env node
/** Verify suite for the root-cause + what-if remediation engine (rootCauseEngine.js). */
'use strict';
const path = require('path');
const root = p => path.join(__dirname, '..', 'src', 'engine', p);
const models = require(root('models'));
const graphMod = require(root('securityGraph'));
const pathsMod = require(root('exposurePathEngine'));
const rc = require(root('rootCauseEngine'));
const simulate = require(path.join(__dirname, '..', 'src', 'cli', 'simulate'));

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const SOURCE = { id: 'test', type: 'test', evidenceClass: 'observed', name: 'Test evidence', observedAt: '2026-01-01T00:00:00.000Z', evidenceRef: 'unit test' };
const now = '2026-01-01T00:00:00.000Z';
function agent(id, name, type = 'coding_agent') {
  return models.createAgent({ id: `agent-${id}`, providerAgentId: id, name, vendor: 'Test', type, status: 'active', confidence: 0.9, source: SOURCE, createdAt: now, updatedAt: now });
}
function permission(agentId, category, raw, weight = 2) {
  return models.createPermission({ agentId, rawPermission: raw, normalizedCategory: category, accessLevel: 'broad', riskWeight: weight, normalizationConfidence: 0.9, normalizationReason: 'test', source: SOURCE, createdAt: now, updatedAt: now });
}
function mcp(agentId, name, capabilities, trust = 'unknown') {
  return models.createMCPServer({ id: `mcp-${agentId}-${name}`, serverId: `${agentId}:${name}`, agentId, name, capabilities, exposedTools: [], trustStatus: trust, confidence: 0.9, source: SOURCE, createdAt: now, updatedAt: now });
}
function buildFrom(inv) { return graphMod.buildGraph({ integrations: [], permissions: [], mcpServers: [], ...inv }); }
const keysOf = pathList => pathList.map(p => p.exposureKey).sort();

function inventoryFromFixture(file, source = 'claude-desktop') {
  const raw = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'));
  return simulate.clientInventory({ mergedServers: raw.mcpServers, clientKey: source, label: file, source, configPath: `/fixtures/${file}`, observedAt: now, home: '/nonexistent' });
}
/** The graph nodes a remove_server config edit takes away: the server and every permission derived from it. */
function serverRemovalSet(inventory, serverName) {
  const server = inventory.mcpServers.find(m => m.name === serverName);
  return new Set([server.id, ...inventory.permissions.filter(p => p.integrationId === server.id).map(p => p.id)]);
}

(function main() {
  // An agent with a clean data-exfiltration toxic combination (EP-A):
  // sensitive file read + external API reach. Removing either capability breaks it.
  const a = agent('exfil', 'ExfilAgent');
  const exfilInv = { agents: [a], permissions: [permission(a.id, 'read_files', 'drive full'), permission(a.id, 'call_external_api', 'http')] };
  const exfilGraph = buildFrom(exfilInv);
  const exfilPaths = pathsMod.findPaths(exfilGraph);

  section('Baseline path finding (sanity)');
  ok('the toxic combination produces at least one exposure path', exfilPaths.length >= 1);
  ok('the path is a data-exfiltration template', exfilPaths.some(p => p.templateId === 'EP-A'));

  section('simulateNodeRemoval is pure and correct');
  const someNode = exfilGraph.nodes.find(n => n.entityType === 'capability');
  const reduced = rc.simulateNodeRemoval(exfilGraph, new Set([someNode.id]));
  ok('removal returns a graph missing the node', !reduced.nodes.some(n => n.id === someNode.id));
  ok('removal drops the node\'s incident edges', !reduced.edges.some(e => e.fromEntityId === someNode.id || e.toEntityId === someNode.id));
  ok('removal does not mutate the original graph', exfilGraph.nodes.some(n => n.id === someNode.id));
  ok('accepts an array as well as a Set', rc.simulateNodeRemoval(exfilGraph, [someNode.id]).nodes.length === exfilGraph.nodes.length - 1);

  section('clusterRootCauses: verified elimination counts');
  const cluster = rc.clusterRootCauses(exfilGraph, exfilPaths);
  ok('reports the true total path count', cluster.totalPaths === exfilPaths.length);
  ok('finds at least one root cause', cluster.causes.length >= 1);
  const top = cluster.causes[0];
  ok('a root cause carries a remediation string', typeof top.remediation === 'string' && top.remediation.length > 0);
  ok('a root cause carries a severity breakdown', top.eliminatedSeverity && typeof top.eliminatedSeverity.critical === 'number');
  ok('only remediable element types are proposed', cluster.causes.every(c => rc.REMEDIABLE.includes(c.entityType)));
  ok('the agent itself is never proposed as a root cause', !cluster.causes.some(c => c.entityType.includes('agent')));

  section('Elimination claims are provable (removing the cause re-runs clean)');
  let allClaimsHold = true;
  for (const cause of cluster.causes) {
    const after = pathsMod.findPaths(rc.simulateNodeRemoval(exfilGraph, new Set([cause.nodeId])));
    const afterKeys = new Set(keysOf(after));
    const actuallyEliminated = exfilPaths.filter(p => !afterKeys.has(p.exposureKey)).map(p => p.exposureKey).sort();
    if (JSON.stringify(actuallyEliminated) !== JSON.stringify(cause.eliminatedExposureKeys)) allClaimsHold = false;
    if (cause.eliminatedCount !== cause.eliminatedExposureKeys.length) allClaimsHold = false;
  }
  ok('every "breaks N" claim matches an independent re-simulation by exposure key', allClaimsHold);
  ok('empty graph yields zero causes, not a crash', rc.clusterRootCauses(buildFrom({ agents: [] }), []).causes.length === 0);

  section('Root-cause clustering: one fix breaks many paths');
  // A shared external-API capability that feeds two independent sensitive-data paths.
  const b = agent('multi', 'MultiAgent');
  const multiInv = {
    agents: [b],
    permissions: [
      permission(b.id, 'read_files', 'drive full'),
      permission(b.id, 'access_customer_data', 'crm'),
      permission(b.id, 'call_external_api', 'http'),
    ],
  };
  const multiGraph = buildFrom(multiInv);
  const multiPaths = pathsMod.findPaths(multiGraph);
  const multiCluster = rc.clusterRootCauses(multiGraph, multiPaths);
  const externalCause = multiCluster.causes.find(c => c.label.includes('call external api') || (c.remediation.includes('call_external_api')));
  ok('the shared external-reach capability is identified as a root cause', !!externalCause);
  ok('removing the shared capability breaks more than one path when multiple exist', multiPaths.length < 2 || (multiCluster.causes[0].eliminatedCount >= 1));

  section('recommendRemediationPlan: correct cover');
  const plan = rc.recommendRemediationPlan(exfilGraph, exfilPaths);
  ok('the plan breaks all targeted paths', plan.breaksAll === true && plan.residualExposureKeys.length === 0);
  ok('the plan has at least one step', plan.steps.length >= 1);
  // Verify the plan by actually removing every step's node and re-running.
  const planNodes = new Set(plan.steps.map(s => s.nodeId));
  const afterPlan = pathsMod.findPaths(rc.simulateNodeRemoval(exfilGraph, planNodes));
  const afterPlanKeys = new Set(keysOf(afterPlan));
  ok('re-running after applying the whole plan leaves no targeted exposure', exfilPaths.every(p => !afterPlanKeys.has(p.exposureKey)));

  section('severityFloor targeting');
  const highOnlyPlan = rc.recommendRemediationPlan(exfilGraph, exfilPaths, { severityFloor: 'critical' });
  const criticalCount = exfilPaths.filter(p => p.severity === 'critical').length;
  ok('a critical severityFloor targets only critical paths', highOnlyPlan.targetedPaths === criticalCount);

  section('Determinism');
  const c1 = JSON.stringify(rc.clusterRootCauses(multiGraph, multiPaths).causes.map(c => c.nodeId));
  const c2 = JSON.stringify(rc.clusterRootCauses(buildFrom(multiInv), pathsMod.findPaths(buildFrom(multiInv))).causes.map(c => c.nodeId));
  ok('identical evidence yields an identical root-cause ranking', c1 === c2);

  section('Reroute fixture: a second route to the same exposure is not an elimination');
  const reroute = inventoryFromFixture('reroute.json');
  const rerouteGraph = buildFrom(reroute);
  const reroutePaths = pathsMod.findPaths(rerouteGraph);
  ok('fixture yields exactly one EP-A exposure', reroutePaths.length === 1 && reroutePaths[0].templateId === 'EP-A');
  const withoutFetch = pathsMod.findPaths(rc.simulateNodeRemoval(rerouteGraph, serverRemovalSet(reroute, 'fetch')));
  ok('removing fetch changes the route id (the defect an id comparison cannot see)', withoutFetch.length === 1 && withoutFetch[0].id !== reroutePaths[0].id);
  ok('removing fetch eliminates 0 exposures', JSON.stringify(keysOf(withoutFetch)) === JSON.stringify(keysOf(reroutePaths)));
  const withoutFilesystem = pathsMod.findPaths(rc.simulateNodeRemoval(rerouteGraph, serverRemovalSet(reroute, 'filesystem')));
  ok('removing filesystem eliminates 1 exposure', withoutFilesystem.length === 0);
  const rerouteCluster = rc.clusterRootCauses(rerouteGraph, reroutePaths);
  ok('the fetch server is not reported as a root cause', !rerouteCluster.causes.some(c => c.entityType === 'mcp_server' && c.label.includes('"fetch"')));
  ok('every reported cause names the exposure key it eliminates', rerouteCluster.causes.every(c => c.eliminatedExposureKeys.length === c.eliminatedCount && c.eliminatedExposureKeys.every(k => rerouteCluster.totalExposureKeys.includes(k))));

  section('Built-in grants are never proposed as config edits');
  // Claude Code with Bash and WebFetch allowed in settings (basis builtin) plus one server holding a credential.
  // EP-B (credential + shell + api) needs the server; EP-E (untrusted content -> shell) survives every server removal.
  const builtinAttrs = { basis: 'builtin', gate: 'unprompted', settingsRead: true };
  function builtinPermission(agentId, category, raw, attributes) {
    return models.createPermission({ agentId, rawPermission: raw, normalizedCategory: category, accessLevel: 'unprompted', riskWeight: 2, normalizationConfidence: 0.9, normalizationReason: 'test', source: SOURCE, attributes, createdAt: now, updatedAt: now });
  }
  function builtinFixture(attributes) {
    const b = agent('builtin', 'Claude Code');
    const gh = mcp(b.id, 'gh', ['credential_access', 'network_access']);
    const inv = {
      agents: [b],
      mcpServers: [gh],
      permissions: [
        builtinPermission(b.id, 'run_shell_commands', 'Claude Code built-in shell access (Bash)', attributes),
        builtinPermission(b.id, 'untrusted_external_content', 'Claude Code built-in web fetch (WebFetch)', attributes),
        builtinPermission(b.id, 'call_external_api', 'Claude Code built-in web fetch (WebFetch)', attributes),
      ],
    };
    return { inv, graph: buildFrom(inv) };
  }
  const builtin = builtinFixture(builtinAttrs);
  const builtinPaths = pathsMod.findPaths(builtin.graph);
  ok('fixture yields EP-E through built-in tools and EP-B through the server', builtinPaths.some(p => p.templateId === 'EP-E') && builtinPaths.some(p => p.templateId === 'EP-B'));
  const builtinCluster = rc.clusterRootCauses(builtin.graph, builtinPaths);
  ok('no built-in permission is proposed as a root cause', !builtinCluster.causes.some(c => c.entityType === 'permission' && /built-in/.test(c.label)));
  ok('no capability a built-in grant holds is proposed (shell, untrusted content, external api)', !builtinCluster.causes.some(c => c.entityType === 'capability' && /(run shell commands|untrusted external content|call external api)/.test(c.label)));
  ok('the server that holds the credential is still a root cause', builtinCluster.causes.some(c => c.entityType === 'mcp_server' && c.label.includes('"gh"')));
  ok('the held nodes are reported so a renderer can say why they were not proposed', builtinCluster.builtinHeldNodeIds.length >= 3 && builtinCluster.builtinHeldNodeIds.every(id => builtin.graph.nodes.some(n => n.id === id)));
  const builtinPlan = rc.recommendRemediationPlan(builtin.graph, builtinPaths, { severityFloor: 'high' });
  ok('the plan admits it cannot break the built-in-held path', builtinPlan.breaksAll === false && builtinPlan.residualExposureKeys.some(k => k.startsWith('EP-E:')));
  ok('the plan never steps on a built-in-held node', builtinPlan.steps.every(step => !builtinCluster.builtinHeldNodeIds.includes(step.nodeId)));
  const configured = builtinFixture({ basis: 'configured' });
  const configuredCluster = rc.clusterRootCauses(configured.graph, pathsMod.findPaths(configured.graph));
  ok('the same grants with a configured basis stay proposable (the exclusion is basis-driven)', configuredCluster.builtinHeldNodeIds.length === 0 && configuredCluster.causes.some(c => c.entityType === 'capability' && /run shell commands/.test(c.label)));
  const emptyCluster = rc.clusterRootCauses(exfilGraph, exfilPaths);
  ok('a graph without built-in grants reports no held nodes', Array.isArray(emptyCluster.builtinHeldNodeIds) && emptyCluster.builtinHeldNodeIds.length === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
