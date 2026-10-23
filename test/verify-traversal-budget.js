#!/usr/bin/env node
/* Traversal budget (Phase 8): every cap the path engine applies is visible in the traversal record, a complete search says so, and the reference large graph analyzes under budget. */
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', 'src', 'engine');
const models = require(path.join(root, 'models'));
const graphlib = require(path.join(root, 'securityGraph'));
const engine = require(path.join(root, 'exposurePathEngine'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }
const NOW = '2026-10-23T00:00:00.000Z';
const source = { id: 'src-fixture', type: 'fixture', name: 'Sample data', observedAt: NOW };
const agent = name => models.createAgent({ name, type: 'ai_application', vendor: 'Test', source, confidence: 0.9, createdAt: NOW });
const permission = (agentId, category, raw) => models.createPermission({ agentId, normalizedCategory: category, rawPermission: raw || category, accessLevel: 'read', normalizationConfidence: 0.9, normalizationReason: 'test', source, createdAt: NOW });

test('a small graph is complete, lists the budget, and findPaths equals analyze().paths', () => {
  const a = agent('Small');
  const graph = graphlib.buildGraph({ agents: [a], integrations: [], permissions: [permission(a.id, 'access_customer_data'), permission(a.id, 'send_external_message')], mcpServers: [] });
  const result = engine.analyze(graph);
  assert.strictEqual(result.traversal.complete, true);
  assert.deepStrictEqual(result.traversal.truncated, []);
  assert.deepStrictEqual(result.traversal.budget, { maxDepth: engine.MAX_DEPTH, maxVisitedPerAgent: engine.MAX_VISITED, maxPaths: engine.MAX_PATHS });
  assert.strictEqual(result.traversal.agents, 1);
  assert.strictEqual(result.traversal.agentsSearched, 1);
  assert.deepStrictEqual(engine.findPaths(graph), result.paths);
  assert.strictEqual(result.paths.length, 1);
});

test('an agent with more reachable edges than the visited cap is reported truncated by agent id', () => {
  const a = agent('Wide');
  const permissions = Array.from({ length: engine.MAX_VISITED + 100 }, (_, i) => permission(a.id, 'read_files', `file read ${i}`));
  const graph = graphlib.buildGraph({ agents: [a], integrations: [], permissions, mcpServers: [] });
  const result = engine.analyze(graph);
  assert.strictEqual(result.traversal.complete, false);
  const hit = result.traversal.truncated.find(t => t.cap === 'visited');
  assert.ok(hit, 'visited cap recorded');
  assert.strictEqual(hit.agentId, a.id);
  assert.strictEqual(hit.limit, engine.MAX_VISITED);
  assert.ok(/not examined/.test(hit.note));
});

test('more satisfiable paths than the path cap stops at the cap and says which agents were not searched', () => {
  const agents = Array.from({ length: engine.MAX_PATHS + 5 }, (_, i) => agent(`Agent ${String(i).padStart(3, '0')}`));
  const permissions = agents.flatMap(a => [permission(a.id, 'access_customer_data'), permission(a.id, 'send_external_message')]);
  const graph = graphlib.buildGraph({ agents, integrations: [], permissions, mcpServers: [] });
  const result = engine.analyze(graph);
  assert.strictEqual(result.paths.length, engine.MAX_PATHS);
  assert.strictEqual(result.traversal.complete, false);
  const skipped = result.traversal.truncated.filter(t => t.cap === 'paths' && t.agentId);
  assert.strictEqual(skipped.length, 5, 'each unsearched agent is named');
  assert.strictEqual(result.traversal.agentsSearched, engine.MAX_PATHS);
  assert.strictEqual(result.traversal.agents, engine.MAX_PATHS + 5);
});

test('a chain longer than the depth cap is reported truncated and the nodes beyond it are not reached', () => {
  const nodes = [{ id: 'agent', entityType: 'ai_application', label: 'Deep', confidence: 0.9 }];
  const edges = [];
  for (let i = 1; i <= engine.MAX_DEPTH + 2; i++) {
    nodes.push({ id: `n${i}`, entityType: 'permission', label: `n${i}`, confidence: 0.9, metadata: { category: 'read_files' } });
    edges.push({ id: `e${i}`, fromEntityId: i === 1 ? 'agent' : `n${i - 1}`, toEntityId: `n${i}`, relationshipType: 'agent_has_permission', confidence: 0.9, evidenceClass: 'fixture' });
  }
  const result = engine.analyze({ schemaVersion: 1, nodes, edges });
  assert.strictEqual(result.traversal.complete, false);
  const hit = result.traversal.truncated.find(t => t.cap === 'depth');
  assert.ok(hit && hit.agentId === 'agent' && hit.limit === engine.MAX_DEPTH);
});

test('the reference large graph (at least 1,000 nodes and 5,000 edges) analyzes completely with p95 under the two-second target', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'large-graph-bench.js'), '--runs', '10'], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.ok(report.graph.nodes >= 1000 && report.graph.edges >= 5000, `graph ${report.graph.nodes} nodes ${report.graph.edges} edges`);
  assert.strictEqual(report.traversal.complete, true);
  assert.ok(report.analyzeMs.p95 < 2000, `p95 ${report.analyzeMs.p95} ms`);
  console.log(`  ${report.graph.nodes} nodes, ${report.graph.edges} edges, p95 ${report.analyzeMs.p95} ms on ${report.machine.cpu}`);
});

console.log(`Traversal budget checks: ${passed} passed, 0 failed`);
