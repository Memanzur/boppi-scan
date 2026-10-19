#!/usr/bin/env node
/** Runs every verify suite in a child process; exits non-zero if any fails. */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const SUITES = [
  'verify-catalog.js',
  'verify-cli-scan.js',
  'verify-security-graph.js',
  'verify-stable-ids.js',
  'verify-exposure-paths.js',
  'verify-root-cause.js',
  'verify-config-edit.js',
  'verify-predictions.js',
  'verify-agent-security-event-integrity.js',
  'verify-overlay.js',
  'verify-push.js',
  'verify-no-network.js',
  'verify-plan-fix.js',
  'verify-policy-sarif.js',
  'verify-interactive-report.js',
];

let failures = 0;
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  // Fixtures use the macOS config layout; the platform override keeps the suites identical on Linux and Windows runners.
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  if (result.status !== 0) {
    failures++;
    console.error(`FAILED: ${suite} (exit ${result.status})`);
  }
}

console.log(`\n${SUITES.length - failures} of ${SUITES.length} suites passed`);
process.exitCode = failures ? 1 : 0;
