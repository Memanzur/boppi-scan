#!/usr/bin/env node
/** Evidence layers (P8-1): 23 mixed-evidence fixtures through the real scan. Every observed claim links to stored events, layers never merge, alternate routes never read as closure, and versions are visible. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hook = require('../src/cli/hook');
const discover = require('../src/cli/discovery/discover');
const models = require('../src/engine/models');
const riskRubric = require('../src/engine/riskRubric');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'evidence', 'cases.json'), 'utf8')).cases;
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }

const ENTRY = { risky: { command: 'node', args: ['shell.js', '--allow-shell'], env: { GITHUB_TOKEN: 'ghp_fixture0000000000000000000000000000' } }, plain: { command: 'node', args: ['notes.js'] } };
const CONFIG_FILE = { 'claude-code': home => path.join(home, '.claude.json'), 'claude-desktop': home => path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), cursor: home => path.join(home, '.cursor', 'mcp.json') };
const DESKTOP_DIR = home => path.join(home, 'Library', 'Application Support', 'Claude');
const at = daysAgo => new Date(Date.now() - (daysAgo || 0) * 86400000 - 60000).toISOString();
const fingerprint = value => `fp-${value.length}`;

function buildHome(root, testCase) {
  const home = path.join(root, testCase.id, 'home');
  fs.mkdirSync(DESKTOP_DIR(home), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const entries = servers => Object.fromEntries(Object.entries(servers).map(([name, kind]) => [name, { ...ENTRY[kind], args: [...ENTRY[kind].args] }]));
  for (const [client, servers] of Object.entries(testCase.clients)) {
    fs.writeFileSync(CONFIG_FILE[client](home), JSON.stringify({ mcpServers: entries(servers) }));
    if (client === 'claude-code' && testCase.projectServers) fs.writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: entries(testCase.projectServers) }));
  }
  for (const event of testCase.events || []) {
    const payload = { hook_event_name: 'PreToolUse', tool_name: `mcp__${event.server}__${event.tool}`, session_id: `session-${event.session}`, cwd: home, mcp_server: { name: event.server, source: 'user' } };
    if (event.invocation) payload.tool_use_id = `toolu_${event.session}_${event.invocation}`;
    const when = at(event.daysAgo);
    hook.append(home, hook.toRecord(payload, { now: when, fingerprint }), 3650);
    if (event.outcome === 'invoked-only' || event.outcome === 'unknown') continue;
    const post = event.outcome === 'denied' ? { ...payload, hook_event_name: 'PermissionDenied', reason: 'x' }
      : event.outcome === 'failed' ? { ...payload, hook_event_name: 'PostToolUseFailure', error: 'x' }
      : { ...payload, hook_event_name: 'PostToolUse', tool_response: {} };
    hook.append(home, hook.toRecord(post, { now: when, fingerprint }), 3650);
    if (event.duplicate) hook.append(home, hook.toRecord(post, { now: when, fingerprint }), 3650);
  }
  if (testCase.torn) fs.appendFileSync(hook.eventsFile(home), '{"schema":2,"id":"torn","at":"2026-');
  for (const d of testCase.discovery || []) {
    const entry = { ...ENTRY[testCase.clients[d.client][d.server]], args: [...ENTRY[testCase.clients[d.client][d.server]].args] };
    const hashed = d.forEntryArgs ? { ...entry, args: d.forEntryArgs } : entry;
    discover.writeCache(home, { schemaVersion: discover.CACHE_SCHEMA_VERSION, serverId: discover.serverIdOf({ source: d.client }, d.server, entry), client: d.client, server: d.server, launch: { command: 'node' }, entryHash: discover.entryHash(hashed), discoveredAt: at(d.daysAgo || 1), maxAgeDays: discover.MAX_AGE_DAYS, protocolVersion: '2025-11-25', serverInfo: { name: 'fixture' }, listChanged: false, list: { tools: d.tools.map(name => ({ name })), counts: { kept: d.tools.length, pages: 1, rejected: 0, duplicates: 0 }, partial: false }, methods: ['initialize', 'notifications/initialized', 'tools/list'] });
  }
  if (testCase.history) {
    fs.mkdirSync(path.join(home, '.boppi'), { recursive: true });
    fs.writeFileSync(path.join(home, '.boppi', 'history.json'), JSON.stringify([{ schemaVersion: 1, scannedAt: at(2), scannerVersion: '0.0.0', engineVersion: testCase.history.engineVersion, exposureKeys: [], severityCounts: {} }]));
  }
  return home;
}

function runScan(home, testCase, jsonFile) {
  const args = [CLI, 'scan', '--json', jsonFile, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, '.boppi', 'history.json')];
  if (testCase.only) args.push('--only', testCase.only);
  if (testCase.explicitConfig) args.push('--config', CONFIG_FILE['claude-code'](home), '--source', 'claude-code');
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-evidence-'));
  for (const testCase of CASES) {
    console.log(`\n${testCase.id} ${testCase.title}`);
    const home = buildHome(root, testCase);
    const jsonFile = path.join(root, `${testCase.id}.json`);
    const run = runScan(home, testCase, jsonFile);
    const exported = run.status === 0 || fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile, 'utf8')) : null;
    const layers = exported && exported.evidenceLayers;
    ok('scan ran and exported evidence layers', exported && layers && Array.isArray(layers.servers) && Array.isArray(layers.paths));
    if (!layers) continue;
    const byKey = new Map(layers.servers.map(s => [`${s.client}/${s.name}`, s]));
    const e = testCase.expect;
    ok('every server carries the four layers and every path is possible reach from the configured layer', layers.servers.every(s => ['configured', 'advertised', 'observed', 'hypothesis'].every(k => s.layers[k] && s.layers[k].status)) && layers.paths.every(p => p.layers.configured.status === 'possible_reach'));
    ok('every observed claim links to stored events and never asserts effects', layers.servers.filter(s => s.layers.observed.status === 'observed').every(s => s.layers.observed.callKeys.length > 0 && s.layers.observed.callKeys.every(k => /^[0-9a-f-]+:[0-9a-f-]+$/.test(k)) && /not what it did/.test(s.layers.observed.uncertainty)));
    ok('the layers note says they never merge', /never merge/.test(layers.note));
    for (const [key, status] of Object.entries(e.observed || {})) ok(`${key} observed layer is ${status}`, byKey.get(key) && byKey.get(key).layers.observed.status === status);
    for (const [key, n] of Object.entries(e.calls || {})) ok(`${key} has ${n} observed calls`, byKey.get(key) && (byKey.get(key).layers.observed.calls || 0) === n);
    for (const [key, n] of Object.entries(e.sessions || {})) ok(`${key} spans ${n} sessions`, byKey.get(key) && byKey.get(key).layers.observed.sessions === n);
    for (const [key, outcomes] of Object.entries(e.outcomes || {})) ok(`${key} outcomes ${JSON.stringify(outcomes)}`, byKey.get(key) && Object.entries(outcomes).every(([o, n]) => (byKey.get(key).layers.observed.outcomes || {})[o] === n));
    for (const [key, text] of Object.entries(e.coverageIncludes || {})) ok(`${key} coverage mentions "${text}"`, byKey.get(key) && String(byKey.get(key).layers.observed.coverage).includes(text));
    for (const [key, status] of Object.entries(e.advertised || {})) ok(`${key} advertised layer is ${status}`, byKey.get(key) && byKey.get(key).layers.advertised.status === status);
    if ('advertisedBasisPresent' in e) ok(`permissions with basis advertised ${e.advertisedBasisPresent ? 'exist' : 'do not exist'}`, exported.inventory.real.permissions.some(p => p.attributes && p.attributes.basis === 'advertised') === e.advertisedBasisPresent);
    if (e.unmatchedObserved) ok(`unmatched observed servers: ${e.unmatchedObserved.join(', ')}`, e.unmatchedObserved.every(name => layers.unmatchedObserved.some(u => u.server === name)) && layers.unmatchedObserved.every(u => /not in the current Claude Code configuration/.test(u.note)));
    if (e.coverageObserved) ok(`observed coverage says "${e.coverageObserved}"`, layers.coverage.observed === e.coverageObserved);
    if (e.coverageConfigured) ok(`configured coverage is ${e.coverageConfigured}`, layers.coverage.configured === e.coverageConfigured);
    if (e.clientsAbsent) ok(`clients absent: ${e.clientsAbsent.join(', ')}`, e.clientsAbsent.every(c => !layers.servers.some(s => s.client === c)));
    if (e.pathsMin) ok(`at least ${e.pathsMin} path with servers on it`, layers.paths.length >= e.pathsMin && layers.paths.some(p => p.servers.length > 0));
    if (e.pathsObserved) ok(`paths observed layer is ${e.pathsObserved}`, layers.paths.length > 0 && layers.paths.some(p => p.servers.length) && layers.paths.filter(p => p.servers.length).every(p => p.layers.observed.status === e.pathsObserved));
    if (e.hypothesis) ok('hypothesis layer is not available and says why', layers.servers.every(s => s.layers.hypothesis.status === e.hypothesis && /Phase 7/.test(s.layers.hypothesis.note)));
    if (e.versionsCurrent) ok('versions name the current engine, rubric, and events schema', layers.versions.engine === models.ENGINE_VERSION && layers.versions.rubric === riskRubric.RUBRIC_VERSION && layers.versions.eventsSchema === hook.SCHEMA);
    if (e.historyOldVersionKept) {
      const history = JSON.parse(fs.readFileSync(path.join(home, '.boppi', 'history.json'), 'utf8'));
      ok('the old baseline stays in history with its engine version and the new entry carries the current one', history.length === 2 && history[0].engineVersion === testCase.history.engineVersion && history[1].engineVersion === models.ENGINE_VERSION);
    }
    if (e.observedByBaseName) for (const [name, status] of Object.entries(e.observedByBaseName)) ok(`every server named ${name} (any scope suffix) is ${status}`, layers.servers.filter(s => s.name.startsWith(name)).length >= 2 && layers.servers.filter(s => s.name.startsWith(name)).every(s => s.layers.observed.status === status));
    if (e.ambiguous) for (const key of e.ambiguous) ok(`${key} observed layer is ambiguous and credits no calls`, byKey.get(key) && byKey.get(key).layers.observed.status === 'ambiguous' && byKey.get(key).layers.observed.calls === 0);
    if (e.alternateRoute) {
      const prediction = (exported.predictions || []).find(p => p.client && p.client.key === e.alternateRoute.client && p.edit && p.edit.action === 'remove_server' && p.edit.server === e.alternateRoute.remove);
      ok(`removing ${e.alternateRoute.remove} while an equivalent server remains closes no path (predictedEliminated empty, surviving keys kept)`, prediction && prediction.predictedEliminated.length === 0 && prediction.predictedSurviving.length > 0);
    }
  }
  if (process.env.BOPPI_KEEP_FIXTURES) console.log(`kept ${root}`); else fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
