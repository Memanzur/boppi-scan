#!/usr/bin/env node
/* Config edit checks: the raw-config rescan and the inventory-level applyEdit agree on every fixture. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const configEdit = require('../src/engine/configEdit');
const simulate = require('../src/cli/simulate');

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }

const NOW = '2026-01-01T00:00:00.000Z';
const FIXTURES = path.join(__dirname, 'fixtures');
function loadFixture(file) { return JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')); }
function contextFor(file) {
  return { clientKey: 'claude-desktop', label: file, source: 'claude-desktop', configPath: `/fixtures/${file}`, observedAt: NOW, home: '/nonexistent' };
}

test('applyEdit is pure and removes the server with every permission derived from it', () => {
  const inventory = simulate.clientInventory({ ...contextFor('reroute.json'), mergedServers: loadFixture('reroute.json').mcpServers });
  const server = inventory.mcpServers.find(s => s.name === 'filesystem');
  const owned = inventory.permissions.filter(p => p.integrationId === server.id);
  assert.ok(owned.length > 0, 'filesystem owns at least one derived permission');
  const after = configEdit.applyEdit(inventory, { action: 'remove_server', agentId: server.agentId, serverId: server.id });
  assert.ok(!after.mcpServers.some(s => s.id === server.id));
  assert.ok(!after.permissions.some(p => p.integrationId === server.id));
  assert.strictEqual(after.permissions.length, inventory.permissions.length - owned.length, 'only that server\'s permissions are removed');
  assert.strictEqual(inventory.mcpServers.length, 3, 'the input inventory is untouched');
  assert.throws(() => configEdit.applyEdit(inventory, { action: 'remove_server', agentId: server.agentId, serverId: 'mcp_missing' }), /not in the inventory/);
  assert.throws(() => configEdit.applyEdit(inventory, { action: 'rename_server', agentId: server.agentId, serverId: server.id }), /unsupported action/);
});

test('raw-config rescan and applyEdit give identical eliminated and survived sets on every fixture', () => {
  const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 2, 'at least two fixtures exist');
  let edits = 0;
  for (const file of files) {
    const raw = loadFixture(file);
    const context = contextFor(file);
    const inventory = simulate.clientInventory({ ...context, mergedServers: raw.mcpServers });
    const before = simulate.exposureKeysOf(inventory);
    for (const server of inventory.mcpServers) {
      const viaConfig = simulate.simulateConfigEdit({ rawConfig: raw, agentContext: context, edit: { action: 'remove_server', server: server.name } });
      const viaInventory = simulate.diffKeys(before, simulate.exposureKeysOf(configEdit.applyEdit(inventory, { action: 'remove_server', agentId: server.agentId, serverId: server.id })));
      assert.deepStrictEqual(viaConfig.before.exposureKeys, before, `${file}/${server.name}: same baseline`);
      assert.deepStrictEqual(viaConfig.eliminated, viaInventory.eliminated, `${file}/${server.name}: eliminated`);
      assert.deepStrictEqual(viaConfig.survived, viaInventory.survived, `${file}/${server.name}: survived`);
      assert.deepStrictEqual(viaConfig.appeared, viaInventory.appeared, `${file}/${server.name}: appeared`);
      edits += 1;
    }
  }
  assert.ok(edits >= 6, `exercised ${edits} edits`);
});

test('dup-evidence: one remove_server edit on filesystem eliminates the EP-A exposure', () => {
  const raw = loadFixture('dup-evidence.json');
  const result = simulate.simulateConfigEdit({ rawConfig: raw, agentContext: contextFor('dup-evidence.json'), edit: { action: 'remove_server', server: 'filesystem' } });
  assert.strictEqual(result.before.exposureKeys.length, 1);
  assert.match(result.before.exposureKeys[0], /^EP-A:/);
  assert.deepStrictEqual(result.eliminated, result.before.exposureKeys);
  assert.deepStrictEqual(result.after.exposureKeys, []);
});

test('reroute: removing fetch eliminates nothing because slack still reaches the destination', () => {
  const raw = loadFixture('reroute.json');
  const result = simulate.simulateConfigEdit({ rawConfig: raw, agentContext: contextFor('reroute.json'), edit: { action: 'remove_server', server: 'fetch' } });
  assert.deepStrictEqual(result.eliminated, []);
  assert.deepStrictEqual(result.survived, result.before.exposureKeys);
});

test('simulateConfigEdit rejects an edit for a server that is not in the config', () => {
  assert.throws(() => simulate.simulateConfigEdit({ rawConfig: loadFixture('reroute.json'), agentContext: contextFor('reroute.json'), edit: { action: 'remove_server', server: 'nope' } }), /not in the config/);
});

console.log(`Config edit checks: ${passed} passed, 0 failed`);
