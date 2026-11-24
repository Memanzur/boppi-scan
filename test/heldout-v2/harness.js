#!/usr/bin/env node
/**
 * Sealed scorer for test/heldout-v2/cases.json.
 * Prints precision, recall, and p95 by severity. Never prints a case id,
 * a rationale, or a per-case diff. Not part of npm test.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performScan } = require('../../src/cli/boppi');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'];
const RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function materialize(home, entry) {
  const cwd = path.join(home, 'work', 'repo');
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.mkdirSync(path.join(home, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'notes'), { recursive: true });
  for (const [rel, content] of Object.entries(entry.files || {})) {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = String(content).split('{{HOME}}').join(home).split('{{CWD}}').join(cwd);
    fs.writeFileSync(file, text);
  }
  return cwd;
}

function highest(scan) {
  let best = 'none';
  const findings = scan.inventory && Array.isArray(scan.inventory.findings) ? scan.inventory.findings : [];
  for (const finding of findings) {
    if (finding.status && finding.status !== 'open') continue;
    const severity = String(finding.severity || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(RANK, severity)) return null;
    if (RANK[severity] > RANK[best]) best = severity;
  }
  for (const item of scan.paths || []) {
    const severity = String(item.severity || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(RANK, severity)) return null;
    if (RANK[severity] > RANK[best]) best = severity;
  }
  return best;
}

function ratio(hit, total) {
  if (!total) return null;
  return hit / total;
}

function formatRatio(value, hit, total) {
  if (value == null) return `n/a (0/${total})`;
  return `${value.toFixed(3)} (${hit}/${total})`;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
  const cases = manifest.cases || [];
  const predicted = [];
  const times = [];
  let failures = 0;

  for (const entry of cases) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-h2-'));
    try {
      const cwd = materialize(home, entry);
      const started = process.hrtime.bigint();
      const scan = await performScan({
        home,
        cwd,
        platform: 'linux',
        config: null,
        overlay: null,
        only: null,
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (!scan || scan.failed || (scan.incomplete && scan.incomplete.length)) {
        failures += 1;
        continue;
      }
      const label = highest(scan);
      if (!label) {
        failures += 1;
        continue;
      }
      predicted.push(label);
      times.push(elapsedMs);
    } catch (_) {
      failures += 1;
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  if (failures || predicted.length !== cases.length) {
    process.stdout.write(`scan failures ${failures}\n`);
    process.exitCode = 2;
    return;
  }

  console.log(`heldout-v2 cases ${cases.length}`);
  let criticalRecall = null;
  for (const severity of SEVERITIES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < cases.length; i += 1) {
      const expected = cases[i].expectedHighest;
      const guess = predicted[i];
      if (guess === severity && expected === severity) tp += 1;
      else if (guess === severity) fp += 1;
      else if (expected === severity) fn += 1;
    }
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    if (severity === 'critical') criticalRecall = recall;
    console.log(`${severity} precision ${formatRatio(precision, tp, tp + fp)} recall ${formatRatio(recall, tp, tp + fn)}`);
  }

  let planted = 0;
  let plantedHit = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const combos = cases[i].expectedCriticalCombos || [];
    if (!combos.length) continue;
    planted += 1;
    if (predicted[i] === 'critical') plantedHit += 1;
  }
  const comboRecall = ratio(plantedHit, planted);
  console.log(`critical combo recall ${formatRatio(comboRecall, plantedHit, planted)}`);

  const p95 = percentile(times.slice().sort((a, b) => a - b), 0.95);
  console.log(`p95 scan ${p95.toFixed(2)} ms (n ${times.length})`);
  const bar = criticalRecall != null && criticalRecall >= 0.8 ? 'met' : 'not met';
  console.log(`critical recall bar 0.80: ${bar}`);
}

main().catch(() => {
  process.stdout.write('scan failures 1\n');
  process.exitCode = 2;
});
