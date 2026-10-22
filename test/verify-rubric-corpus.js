#!/usr/bin/env node
/**
 * Labeled-corpus evaluation of the risk rubric. Every case in
 * test/fixtures/corpus/cases.json is scanned in a throwaway home and the
 * priority of each exposure template is compared with its frozen label.
 * Prints precision and recall with their denominators for the held-out and
 * training splits, lists every disagreement, and fails on any mismatch, any
 * critical label on a negative control, or a held-out gate below 90%.
 * `--report` prints the same tables without failing.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'corpus', 'cases.json'), 'utf8'));
const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const reportOnly = process.argv.includes('--report');

function configFile(client, home) {
  if (client === 'claude-desktop') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (client === 'claude-code') return path.join(home, '.claude.json');
  return path.join(home, '.cursor', 'mcp.json');
}
function expand(value, home) { return value === '~/' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value; }
function expandServers(servers, home) {
  return Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, { ...server, args: (server.args || []).map(a => expand(a, home)) }]));
}

function runCase(testCase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-corpus-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  for (const [dir, spec] of Object.entries(CORPUS.directories)) {
    const resolved = expand(dir, home);
    fs.mkdirSync(resolved, { recursive: true });
    if (spec.source) fs.mkdirSync(path.join(resolved, '.git'), { recursive: true });
  }
  const project = expand('~/work/app', home);
  const cwd = testCase.cwd === 'project' ? project : home;
  const file = configFile(testCase.client, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = { mcpServers: expandServers(testCase.config.mcpServers, home) };
  if (testCase.client === 'claude-code') body.projects = {};
  fs.writeFileSync(file, JSON.stringify(body));
  if (testCase.client === 'claude-code' && testCase.settings) {
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, testCase.settings === 'broken' ? '{ not json' : JSON.stringify(testCase.settings));
  }
  const out = path.join(root, 'scan.json');
  const run = spawnSync(process.execPath, [CLI, 'scan', '--only', testCase.client, '--json', out, '--quiet', '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(root, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  let exported = null;
  try { exported = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { /* ungradable */ }
  fs.rmSync(root, { recursive: true, force: true });
  if (!exported) return { gradable: false, exitCode: run.status, stderr: (run.stderr || '').slice(0, 300) };
  const observed = {};
  for (const p of exported.exposurePaths || []) observed[p.templateId] = p.severity;
  const leaked = JSON.stringify(exported).includes(home);
  return { gradable: true, observed, leaked, paths: exported.exposurePaths || [] };
}

function grade(testCase, result) {
  const expected = testCase.expected;
  const templates = new Set([...Object.keys(expected), ...Object.keys(result.observed)]);
  const mismatches = [];
  for (const template of [...templates].sort()) {
    if (expected[template] !== result.observed[template]) mismatches.push(`${template}: expected ${expected[template] || 'absent'}, got ${result.observed[template] || 'absent'}`);
  }
  const unjustifiedCritical = testCase.kind === 'negative' && Object.values(result.observed).includes('critical');
  return { mismatches, unjustifiedCritical };
}

function metrics(rows) {
  const m = { criticalTP: 0, criticalFP: 0, criticalFN: 0, highTP: 0, highFN: 0, highFP: 0, exact: 0, cases: rows.length, ungradable: 0 };
  for (const row of rows) {
    if (!row.result.gradable) { m.ungradable += 1; continue; }
    if (!row.grade.mismatches.length) m.exact += 1;
    const expected = row.testCase.expected, observed = row.result.observed;
    for (const template of new Set([...Object.keys(expected), ...Object.keys(observed)])) {
      const e = expected[template], o = observed[template];
      if (o === 'critical') { if (e === 'critical') m.criticalTP += 1; else m.criticalFP += 1; }
      else if (e === 'critical') m.criticalFN += 1;
      const eHigh = RANK[e] >= 3, oHigh = RANK[o] >= 3;
      if (eHigh && oHigh) m.highTP += 1; else if (eHigh) m.highFN += 1; else if (oHigh) m.highFP += 1;
    }
  }
  const ratio = (a, b) => (b ? `${(100 * a / b).toFixed(1)}% (${a}/${b})` : 'unestablished (0 cases)');
  return {
    ...m,
    criticalPrecision: ratio(m.criticalTP, m.criticalTP + m.criticalFP),
    criticalRecall: ratio(m.criticalTP, m.criticalTP + m.criticalFN),
    highOrCriticalPrecision: ratio(m.highTP, m.highTP + m.highFP),
    highOrCriticalRecall: ratio(m.highTP, m.highTP + m.highFN),
    exactMatch: ratio(m.exact, m.cases - m.ungradable),
    gate: { criticalPrecision: m.criticalTP + m.criticalFP ? m.criticalTP / (m.criticalTP + m.criticalFP) : null, highOrCriticalRecall: m.highTP + m.highFN ? m.highTP / (m.highTP + m.highFN) : null },
  };
}

(function main() {
  const rows = CORPUS.cases.map(testCase => {
    const result = runCase(testCase);
    const graded = result.gradable ? grade(testCase, result) : { mismatches: ['ungradable'], unjustifiedCritical: false };
    return { testCase, result, grade: graded };
  });
  let failures = 0;
  console.log(`corpus: ${rows.length} cases (${CORPUS.cases.filter(c => c.kind === 'negative').length} negative, ${CORPUS.cases.filter(c => c.kind === 'limited').length} limited, ${CORPUS.cases.filter(c => c.kind === 'high_impact').length} high-impact; ${CORPUS.cases.filter(c => c.split === 'heldout').length} held out), labels frozen ${CORPUS.frozenAt}\n`);
  for (const row of rows) {
    const okRow = row.result.gradable && !row.grade.mismatches.length && !row.result.leaked;
    if (!okRow) failures += 1;
    const observed = Object.entries(row.result.observed || {}).map(([t, s]) => `${t}=${s}`).join(' ') || (row.result.gradable ? 'no path' : `ungradable (exit ${row.result.exitCode})`);
    console.log(`  ${okRow ? '✓' : '✗'} ${row.testCase.id.padEnd(40)} ${row.testCase.split.padEnd(8)} ${observed}${row.grade.mismatches.length ? `  [${row.grade.mismatches.join('; ')}]` : ''}${row.result.leaked ? '  [HOME PATH LEAKED]' : ''}`);
  }
  const unjustified = rows.filter(r => r.grade.unjustifiedCritical).map(r => r.testCase.id);
  for (const split of ['heldout', 'train']) {
    const m = metrics(rows.filter(r => r.testCase.split === split));
    console.log(`\n${split}: ${m.cases} cases, ${m.ungradable} ungradable`);
    console.log(`  exact match                 ${m.exactMatch}`);
    console.log(`  critical precision          ${m.criticalPrecision}`);
    console.log(`  critical recall             ${m.criticalRecall}`);
    console.log(`  high-or-critical precision  ${m.highOrCriticalPrecision}`);
    console.log(`  high-or-critical recall     ${m.highOrCriticalRecall}`);
    if (split === 'heldout') {
      if (m.gate.criticalPrecision !== null && m.gate.criticalPrecision < 0.9) { failures += 1; console.log('  GATE: held-out critical precision below 90%'); }
      if (m.gate.highOrCriticalRecall !== null && m.gate.highOrCriticalRecall < 0.9) { failures += 1; console.log('  GATE: held-out high-or-critical recall below 90%'); }
      if (m.gate.criticalPrecision === null) console.log('  note: no critical prediction in the held-out split; critical precision is unestablished');
    }
  }
  console.log(`\nunjustified critical on negative controls: ${unjustified.length}${unjustified.length ? ` (${unjustified.join(', ')})` : ''}`);
  if (unjustified.length) failures += unjustified.length;
  console.log(`\n${rows.length - rows.filter(r => r.grade.mismatches.length || r.result.leaked).length} of ${rows.length} cases match their labels`);
  process.exitCode = failures && !reportOnly ? 1 : 0;
})();
