#!/usr/bin/env node
/* Security graph builder checks: deterministic, evidence-honest, provider-neutral. */
'use strict';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'engine');
const models = require(path.join(root, 'models'));
const graphlib = require(path.join(root, 'securityGraph'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }

const NOW = '2026-08-07T12:00:00.000Z';
const importedSource = { id: 'src-oauth', type: 'oauth', name: 'Imported OAuth', observedAt: NOW };
const browserSource = { id: 'src-browser', type: 'browser', name: 'Browser observation', observedAt: NOW };
const fixtureSource = { id: 'src-fixture', type: 'fixture', name: 'Sample data', observedAt: NOW };

function agent(over = {}) {
  return models.createAgent({ name: 'Claude', type: 'ai_application', vendor: 'Anthropic', source: importedSource, confidence: 0.9, createdAt: NOW, ...over });
}
function permission(agentId, category, over = {}) {
  return models.createPermission({ agentId, normalizedCategory: category, rawPermission: over.rawPermission || category, accessLevel: 'read', normalizationConfidence: 0.9, normalizationReason: 'test', source: importedSource, createdAt: NOW, ...over });
}

// ── Deterministic node and edge generation ───────────────────────────────────
test('deterministic node and edge generation (identical inventory, identical graph)', () => {
  const a = agent({ owner: 'Melody', deviceId: 'laptop-1' });
  const inventory = { agents: [a], integrations: [], permissions: [permission(a.id, 'access_customer_data')], mcpServers: [] };
  const g1 = graphlib.buildGraph(inventory);
  const g2 = graphlib.buildGraph(inventory);
  assert.strictEqual(JSON.stringify(g1), JSON.stringify(g2));
});

test('input order does not change the logical graph', () => {
  const a = agent();
  const p1 = permission(a.id, 'access_customer_data');
  const p2 = permission(a.id, 'send_external_message', { rawPermission: 'slack send' });
  const g1 = graphlib.buildGraph({ agents: [a], permissions: [p1, p2], integrations: [], mcpServers: [] });
  const g2 = graphlib.buildGraph({ agents: [a], permissions: [p2, p1], integrations: [], mcpServers: [] });
  assert.deepStrictEqual(g1.nodes.map(n => n.id), g2.nodes.map(n => n.id));
  assert.deepStrictEqual(g1.edges.map(e => e.id), g2.edges.map(e => e.id));
});

test('duplicate records produce one node and one edge', () => {
  const a = agent();
  const p = permission(a.id, 'access_customer_data');
  const g = graphlib.buildGraph({ agents: [a, a], permissions: [p, p], integrations: [], mcpServers: [] });
  assert.strictEqual(g.nodes.filter(n => n.id === a.id).length, 1);
  assert.strictEqual(g.edges.filter(e => e.toEntityId === p.id).length, 1);
  const edge = g.edges.find(e => e.toEntityId === p.id);
  assert.deepStrictEqual(edge.metadata.evidenceRecordIds, [p.id]);
});

// ── Provenance and evidence classes ──────────────────────────────────────────
test('every edge preserves provenance and evidence class', () => {
  const a = agent();
  const g = graphlib.buildGraph({ agents: [a], permissions: [permission(a.id, 'read_files')], integrations: [], mcpServers: [] });
  assert.ok(g.edges.length >= 2);
  for (const edge of g.edges) {
    assert.ok(edge.source && edge.source.id, `edge ${edge.relationshipType} missing source`);
    assert.ok(['observed', 'imported', 'fixture', 'inferred'].includes(edge.evidenceClass));
    assert.ok(Array.isArray(edge.metadata.evidenceRecordIds) && edge.metadata.evidenceRecordIds.length > 0);
    assert.ok(edge.firstSeenAt && edge.lastSeenAt);
  }
});

test('browser observation creates usage nodes only, never permission or capability edges', () => {
  const observed = models.createAgent({ name: 'ChatGPT', type: 'browser_ai_tool', owner: 'Melody', source: browserSource, observationCount: 4, createdAt: NOW });
  const g = graphlib.buildGraph({ agents: [observed], integrations: [], permissions: [], mcpServers: [] });
  assert.deepStrictEqual([...new Set(g.edges.map(e => e.relationshipType))], ['user_uses_agent']);
  assert.ok(!g.nodes.some(n => ['permission', 'capability', 'data_category', 'credential_reference'].includes(n.entityType)));
});

// ── OAuth and MCP relationship generation ────────────────────────────────────
test('OAuth relationships: agent → integration → permission → data', () => {
  const a = agent();
  const integration = models.createIntegration({ agentId: a.id, provider: 'google', connectionType: 'oauth', source: importedSource, createdAt: NOW });
  const p = permission(a.id, 'access_customer_data', { integrationId: integration.id, rawPermission: 'crm.readonly' });
  const g = graphlib.buildGraph({ agents: [a], integrations: [integration], permissions: [p], mcpServers: [] });
  const types = g.edges.map(e => e.relationshipType);
  assert.ok(types.includes('agent_connects_to_integration'));
  assert.ok(types.includes('integration_grants_permission'));
  assert.ok(types.includes('permission_grants_data_access'));
  assert.ok(!types.includes('agent_has_permission'), 'integration-granted permission must not also attach directly to the agent');
  const integrationNode = g.nodes.find(n => n.id === integration.id);
  assert.strictEqual(integrationNode.entityType, 'oauth_grant');
});

test('MCP relationships: server, tools, normalized capabilities, credential references', () => {
  const a = agent();
  const server = models.createMCPServer({
    agentId: a.id, name: 'filesystem-mcp', trustStatus: 'unverified', confidence: 0.8,
    exposedTools: ['read_file', 'run_command'], capabilities: ['shell_access', 'network_access'],
    credentialReferences: ['AWS_KEY_REF'], source: importedSource, createdAt: NOW,
  });
  const g = graphlib.buildGraph({ agents: [a], integrations: [], permissions: [], mcpServers: [server] });
  const types = new Set(g.edges.map(e => e.relationshipType));
  assert.ok(types.has('agent_connects_to_mcp'));
  assert.ok(types.has('mcp_exposes_tool'));
  assert.ok(types.has('mcp_grants_capability'));
  assert.ok(types.has('mcp_references_credential'));
  assert.strictEqual(g.nodes.filter(n => n.entityType === 'tool').length, 2);
  const serverNode = g.nodes.find(n => n.id === server.id);
  assert.strictEqual(serverNode.metadata.trustStatus, 'unverified');
  const shellCap = g.nodes.find(n => n.entityType === 'capability' && n.metadata.category === 'run_shell_commands');
  assert.ok(shellCap, 'shell_access must normalize to run_shell_commands');
});

test('unknown categories create no graph reach', () => {
  const a = agent();
  const p = permission(a.id, 'unknown', { rawPermission: 'mystery.scope' });
  const g = graphlib.buildGraph({ agents: [a], permissions: [p], integrations: [], mcpServers: [] });
  assert.ok(!g.nodes.some(n => ['capability', 'data_category', 'credential_reference', 'production_system'].includes(n.entityType)));
});

test('external-facing capabilities reach a per-agent external destination', () => {
  const a = agent();
  const b = agent({ name: 'Other agent', providerAgentId: 'other-1' });
  const g = graphlib.buildGraph({ agents: [a, b], permissions: [permission(a.id, 'send_external_message', { rawPermission: 'slack send' })], integrations: [], mcpServers: [] });
  const destinations = g.nodes.filter(n => n.entityType === 'external_destination');
  assert.strictEqual(destinations.length, 1, 'destination node is scoped to the evidenced agent only');
  const edge = g.edges.find(e => e.relationshipType === 'capability_reaches_external_destination');
  assert.ok(edge);
});

test('derived capability nodes never leak between agents', () => {
  const a = agent({ providerAgentId: 'agent-a' });
  const b = agent({ name: 'Gemini', providerAgentId: 'agent-b' });
  const g = graphlib.buildGraph({
    agents: [a, b], integrations: [], mcpServers: [],
    permissions: [permission(a.id, 'run_shell_commands', { rawPermission: 'shell' }), permission(b.id, 'run_shell_commands', { rawPermission: 'shell' })],
  });
  const caps = g.nodes.filter(n => n.entityType === 'capability' && n.metadata.category === 'run_shell_commands');
  assert.strictEqual(caps.length, 2, 'each agent gets its own capability node');
});

// ── Sample / real separation ─────────────────────────────────────────────────
test('sample records are tagged sample and never real', () => {
  const sample = models.createAgent({ name: 'Sample bot', type: 'ai_agent', source: fixtureSource, createdAt: NOW });
  const g = graphlib.buildGraph({ agents: [sample], permissions: [permission(sample.id, 'access_customer_data', { source: fixtureSource })], integrations: [], mcpServers: [] });
  assert.ok(g.nodes.every(n => n.dataset === 'sample'));
  assert.ok(g.edges.every(e => e.dataset === 'sample'));
});

// ── No secret material in the graph ──────────────────────────────────────────
test('graph JSON contains no secret-shaped values and no forbidden keys', () => {
  const a = agent({ owner: 'Melody' });
  const server = models.createMCPServer({ agentId: a.id, name: 'db-mcp', capabilities: ['shell'], credentialReferences: ['DB_CRED_NAME'], environmentVariableNames: ['DB_HOST'], source: importedSource, createdAt: NOW });
  const g = graphlib.buildGraph({ agents: [a], integrations: [], permissions: [permission(a.id, 'access_credentials', { rawPermission: 'keychain' })], mcpServers: [server] });
  const json = JSON.stringify(g);
  assert.doesNotMatch(json, /-----BEGIN|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-/);
  assert.doesNotMatch(json, /"(password|privateKey|apiToken|clientSecret)"/);
});

test('secret-bearing records are rejected before they can reach the graph', () => {
  assert.throws(() => models.createMCPServer({ agentId: 'a', name: 'bad', arguments: ['api_key=sk-abcdefghijklmnop'], source: importedSource }), /secret/i);
});

console.log(`Security graph checks: ${passed} passed, 0 failed`);
