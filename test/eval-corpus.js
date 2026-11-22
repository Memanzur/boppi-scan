#!/usr/bin/env node
/**
 * Detection corpus. Prints precision and recall per severity, planted-combo
 * recall, and p95 scan time. Exits non-zero when the critical gate fails.
 * No network. Labels live in test/corpus/manifest.json.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const parse = require('../src/cli/discovery/parse');
const { clientInventory } = require('../src/cli/simulate');
const risk = require('../src/engine/agentRiskEngine');
const securityGraph = require('../src/engine/securityGraph');
const exposure = require('../src/engine/exposurePathEngine');

const heldout = require('./heldout/eval');

const MANIFEST = path.join(__dirname, 'corpus', 'manifest.json');
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const CRITICAL_PRECISION_MIN = 0.8;
const PLANTED_RECALL_MIN = 0.8;
const P95_MAX_MS = 5000;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function ratio(hit, total) {
  if (!total) return 1;
  return hit / total;
}

function scanCase(entry, home) {
  const servers = parse.mapServers(entry.servers);
  const started = process.hrtime.bigint();
  const inventory = clientInventory({
    mergedServers: servers,
    clientKey: entry.client || 'cursor',
    label: entry.client === 'claude-desktop' ? 'Claude Desktop' : 'Cursor',
    source: entry.client || 'cursor',
    configPath: path.join(home, `${entry.id}.json`),
    observedAt: '2026-11-19T00:00:00.000Z',
    home,
  });
  const agent = inventory.agents[0];
  const assessed = risk.assess(agent, inventory.permissions, inventory.mcpServers, { now: '2026-11-19T00:00:00.000Z' });
  const paths = exposure.findPaths(securityGraph.buildGraph({
    agents: inventory.agents,
    integrations: [],
    permissions: inventory.permissions,
    mcpServers: inventory.mcpServers,
  }));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const predicted = new Set();
  for (const finding of assessed.findings) {
    if (!finding.status || finding.status === 'open') predicted.add(finding.severity);
  }
  for (const item of paths) predicted.add(item.severity);
  return { elapsedMs, predicted, findings: assessed.findings, paths, servers: inventory.mcpServers };
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const cases = manifest.cases || [];
  const serverCount = cases.reduce((sum, entry) => sum + Object.keys(entry.servers || {}).length, 0);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-corpus-'));
  fs.mkdirSync(path.join(home, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(home, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'obsidian-vault'), { recursive: true });

  const rows = [];
  for (const entry of cases) {
    const result = scanCase(entry, home);
    rows.push({ entry, ...result });
  }
  fs.rmSync(home, { recursive: true, force: true });

  const labeled = severity => rows.filter(row => (row.entry.expectedSeverities || []).includes(severity));
  const predicted = severity => rows.filter(row => row.predicted.has(severity));

  console.log(`corpus cases ${cases.length} servers ${serverCount}`);
  const metrics = {};
  for (const severity of SEVERITIES) {
    const truth = new Set(labeled(severity).map(row => row.entry.id));
    const guess = predicted(severity);
    const tp = guess.filter(row => truth.has(row.entry.id)).length;
    const fp = guess.length - tp;
    const fn = [...truth].filter(id => !guess.some(row => row.entry.id === id)).length;
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    metrics[severity] = { precision, recall, tp, fp, fn };
    console.log(`${severity} precision ${precision.toFixed(3)} (${tp}/${tp + fp}) recall ${recall.toFixed(3)} (${tp}/${tp + fn})`);
  }

  const planted = rows.filter(row => row.entry.plantedCombo);
  const plantedHit = planted.filter(row => row.predicted.has('critical'));
  const plantedRecall = ratio(plantedHit.length, planted.length);
  console.log(`planted combo recall ${plantedRecall.toFixed(3)} (${plantedHit.length}/${planted.length})`);

  let criticalFindingTp = 0;
  let criticalFindingFp = 0;
  for (const row of rows) {
    const count = row.findings.filter(finding => finding.severity === 'critical' && (!finding.status || finding.status === 'open')).length
      + row.paths.filter(item => item.severity === 'critical').length;
    if ((row.entry.expectedSeverities || []).includes('critical')) criticalFindingTp += count;
    else criticalFindingFp += count;
  }
  const findingPrecision = ratio(criticalFindingTp, criticalFindingTp + criticalFindingFp);
  console.log(`critical finding precision ${findingPrecision.toFixed(3)} (${criticalFindingTp}/${criticalFindingTp + criticalFindingFp})`);

  const times = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  const p95 = percentile(times, 0.95);
  console.log(`p95 scan ${p95.toFixed(2)} ms (n ${times.length})`);

  const failures = [];
  if (serverCount < 100) failures.push(`corpus has ${serverCount} servers, need at least 100`);
  if (metrics.critical.precision < CRITICAL_PRECISION_MIN) {
    const fps = predicted('critical').filter(row => !(row.entry.expectedSeverities || []).includes('critical')).map(row => row.entry.id);
    failures.push(`critical precision ${metrics.critical.precision.toFixed(3)} is below ${CRITICAL_PRECISION_MIN}: ${fps.join(', ')}`);
  }
  if (plantedRecall < PLANTED_RECALL_MIN) {
    const missed = planted.filter(row => !row.predicted.has('critical')).map(row => row.entry.id);
    failures.push(`planted combo recall ${plantedRecall.toFixed(3)} is below ${PLANTED_RECALL_MIN}: ${missed.join(', ')}`);
  }
  if (p95 >= P95_MAX_MS) failures.push(`p95 ${p95.toFixed(2)} ms is not under ${P95_MAX_MS} ms`);

  const cursor = rows.find(row => row.entry.id === 'e0-cursor');
  const claude = rows.find(row => row.entry.id === 'e0-claude-desktop');
  if (!cursor) failures.push('missing e0-cursor');
  else if (cursor.predicted.has('critical')) failures.push(`e0-cursor is critical (${[...cursor.predicted].join(', ')})`);
  if (!claude) failures.push('missing e0-claude-desktop');
  else if (!claude.predicted.has('critical')) failures.push('e0-claude-desktop is not critical');

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('detection gate passed');
  }

  // Held-out scores are printed after the tuning corpus and do not change
  // its thresholds. A miss here fails the process so the result is visible.
  console.log('\n=== held-out ===');
  const held = heldout.report(path.join(__dirname, '..'));
  console.log(held.text);
  if (!held.ok) process.exitCode = 1;
}

main();
