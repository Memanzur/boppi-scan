#!/usr/bin/env node
/* Checks hash-linked Agent Security event integrity and legacy handling. */
'use strict';
const assert = require('assert');
const integrity = require('../src/engine/eventIntegrity');
const storageApi = require('../src/engine/agentSecurityStorage');

async function main() {
  const events = [
    { schemaVersion:1, type:'agent_security_scan_started', timestamp:'2026-08-01T00:00:00.000Z', scanId:'scan_1' },
    { schemaVersion:1, type:'agent_discovered', timestamp:'2026-08-01T00:00:01.000Z', agentId:'agent_1' },
  ];
  const sealed = await integrity.sealEvents(events);
  assert.strictEqual(sealed.length, 2);
  assert.strictEqual(sealed[0].integrity.algorithm, 'SHA-256');
  assert.strictEqual(sealed[0].sequence, 0);
  assert.strictEqual(sealed[1].previousHash, sealed[0].integrity.hash);
  assert.deepStrictEqual(await integrity.verifyEvents(sealed), { valid:true, legacy:false, reason:null, checked:2, headHash:sealed[1].integrity.hash });
  const tampered = JSON.parse(JSON.stringify(sealed));
  tampered[0].agentId = 'tampered';
  assert.strictEqual((await integrity.verifyEvents(tampered)).reason, 'event_hash_mismatch');
  const reordered = [sealed[1], sealed[0]];
  assert.strictEqual((await integrity.verifyEvents(reordered)).reason, 'chain_link_mismatch');
  assert.strictEqual((await integrity.verifyEvents(events)).legacy, true);
  const storage = storageApi.createStorage(storageApi.memoryAdapter());
  const committed = await storage.commit({ events, real:{agents:[],integrations:[],permissions:[],mcpServers:[],findings:[]}, sample:{agents:[],integrations:[],permissions:[],mcpServers:[],findings:[]} });
  assert.strictEqual(committed.eventIntegrity.valid, true);
  const loaded = await storage.load();
  assert.strictEqual(loaded.eventIntegrity.valid, true);
  assert.strictEqual(loaded.events[0].integrity.version, 1);
  const recoveryEvents = await integrity.sealEvents([{ type:'known_good', timestamp:'2026-08-01T00:00:00.000Z' }]);
  const recoveryAdapter = storageApi.memoryAdapter({
    [storageApi.KEYS.STATE]: { events:[{ type:'tampered', integrity:{ version:1, algorithm:'SHA-256', hash:'bad' } }] },
    [storageApi.KEYS.LAST_GOOD]: { events:recoveryEvents, real:{agents:[],integrations:[],permissions:[],mcpServers:[],findings:[]}, sample:{agents:[],integrations:[],permissions:[],mcpServers:[],findings:[]} },
  });
  const recovered = await storageApi.createStorage(recoveryAdapter).load();
  assert.strictEqual(recovered.recoveredFromCorruptState, true);
  assert.strictEqual(recovered.events[0].type, 'known_good');
  assert.strictEqual(recovered.eventIntegrity.valid, true);
  console.log('Agent Security event integrity checks: 13 passed, 0 failed');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
