#!/usr/bin/env node
/**
 * Runs every verify suite in a child process; exits non-zero if any fails.
 * Each result is saved to .test-state/run-all.json as soon as the suite
 * ends, with a fingerprint of bin/, src/, test/ and research/. After an
 * interruption, --resume skips suites that already passed on the same
 * fingerprint; --only a.js,b.js runs a subset.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, '.test-state', 'run-all.json');
const args = process.argv.slice(2);
const resume = args.includes('--resume');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? new Set((args[onlyAt + 1] || '').split(',').filter(Boolean)) : null;

/** One hash over every file the suites can load, so a saved pass is reused only for identical code. */
function fingerprint() {
  const hash = crypto.createHash('sha256');
  const walk = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file);
      else hash.update(path.relative(ROOT, file)).update('\0').update(fs.readFileSync(file)).update('\0');
    }
  };
  for (const dir of ['bin', 'src', 'test', 'research']) if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
  return hash.digest('hex');
}

function loadState(print) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (state.fingerprint === print) return state;
  } catch (_) { /* no usable state */ }
  return { fingerprint: print, results: {} };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  const temp = `${STATE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(temp, STATE);
}

const SUITES = [
  'verify-brand-design.js',
  'verify-catalog.js',
  'verify-monitoring.js',
  'verify-demo.js',
  'verify-demo-client.js',
  'verify-cli-scan.js',
  'verify-builtin-tools.js',
  'verify-recognition.js',
  'verify-unknown-servers.js',
  'verify-tool-reach.js',
  'verify-security-graph.js',
  'verify-stable-ids.js',
  'verify-exposure-paths.js',
  'verify-root-cause.js',
  'verify-config-edit.js',
  'verify-predictions.js',
  'verify-agent-security-event-integrity.js',
  'verify-overlay.js',
  'verify-push.js',
  'verify-events-push.js',
  'verify-connector.js',
  'verify-no-network.js',
  'verify-plan-fix.js',
  'verify-policy-sarif.js',
  'verify-interactive-report.js',
  'verify-rubric-corpus.js',
  'verify-discovery-fixtures.js',
  'verify-platform-rules.js', 'verify-discover.js', 'verify-watch.js', 'verify-hook-collector.js', 'verify-evidence-layers.js', 'verify-traversal-budget.js',
  'verify-ask.js', '../research/intelligence/pipeline.test.mjs', '../research/intelligence/heldout.test.mjs',
  'verify-live-check-fixture.js', 'verify-report-a11y.js', 'verify-review-findings.js', 'verify-beta-blockers.js', 'verify-config-shapes.js',
  'verify-same-name-servers.js', 'verify-safe-writes.js', 'verify-overlay-bundle.js', 'verify-claude-plugins.js', 'verify-config-facts.js', 'verify-windows-paths.js', 'verify-action-pin.js', 'verify-update-notice.js', 'verify-uninstall.js', 'verify-secret-redaction.js', 'verify-narrow-scope.js', 'verify-discovery-integrity.js', 'verify-push-unsafe-fields.js', 'verify-push-scope.js', 'verify-capability-loss-wording.js', 'verify-overlay-epochs.js', 'verify-evidence-labels.js',
  'verify-fingerprint-hmac.js',
];

const print = fingerprint();
const state = loadState(print);
const selected = SUITES.filter(suite => !only || only.has(suite) || only.has(path.basename(suite)));
let failures = 0, skipped = 0;
for (const suite of selected) {
  if (resume && state.results[suite] && state.results[suite].status === 0) {
    skipped++;
    console.log(`\n=== ${suite} === passed earlier on this code (${state.results[suite].finishedAt}), skipped`);
    continue;
  }
  console.log(`\n=== ${suite} ===`);
  // Fixtures use the macOS config layout; the platform override keeps the suites identical on Linux and Windows runners.
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  state.results[suite] = { status: result.status, finishedAt: new Date().toISOString() };
  saveState(state);
  if (result.status !== 0) {
    failures++;
    console.error(`FAILED: ${suite} (exit ${result.status})`);
  }
}

console.log(`\n${selected.length - failures} of ${selected.length} suites passed${skipped ? ` (${skipped} reused from an earlier run on identical code)` : ''}`);
process.exitCode = failures ? 1 : 0;
