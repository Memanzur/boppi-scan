#!/usr/bin/env node
/* Stable identity checks: 64-bit ids, array order preserved, identical evidence gives identical ids. */
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
const source = { id: 'src-oauth', type: 'oauth', name: 'Imported OAuth', observedAt: NOW };

function inventory() {
  const a = models.createAgent({ name: 'Claude', type: 'ai_application', vendor: 'Anthropic', source, confidence: 0.9, createdAt: NOW });
  const permission = category => models.createPermission({ agentId: a.id, normalizedCategory: category, rawPermission: category, accessLevel: 'read', normalizationConfidence: 0.9, normalizationReason: 'test', source, createdAt: NOW });
  return { agents: [a], integrations: [], permissions: [permission('read_files'), permission('call_external_api')], mcpServers: [] };
}

test('ids are 64 bits rendered as 16 hex characters', () => {
  assert.match(models.stableId('edge', ['a', 'r', 'b']), /^edge_[0-9a-f]{16}$/);
});

test('an edge from A to B is not the edge from B to A', () => {
  assert.notStrictEqual(models.stableId('edge', ['a', 'r', 'b']), models.stableId('edge', ['b', 'r', 'a']));
});

test('object key order does not change identity', () => {
  assert.strictEqual(models.stableId('x', { b: 1, a: [1, 2] }), models.stableId('x', { a: [1, 2], b: 1 }));
});

test('two builds from identical evidence produce identical node, edge, and path ids', () => {
  const g1 = graphlib.buildGraph(inventory());
  const g2 = graphlib.buildGraph(inventory());
  assert.deepStrictEqual(g1.nodes.map(n => n.id), g2.nodes.map(n => n.id));
  assert.deepStrictEqual(g1.edges.map(e => e.id), g2.edges.map(e => e.id));
  const p1 = engine.findPaths(g1).map(p => p.id);
  const p2 = engine.findPaths(g2).map(p => p.id);
  assert.ok(p1.length > 0, 'fixture produces at least one path');
  assert.deepStrictEqual(p1, p2);
});

console.log(`Stable id checks: ${passed} passed, 0 failed`);
