#!/usr/bin/env node
/** Runs every verify suite in a child process; exits non-zero if any fails. */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const SUITES = [
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
];

let failures = 0;
for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failures++;
    console.error(`FAILED: ${suite} (exit ${result.status})`);
  }
}

console.log(`\n${SUITES.length - failures} of ${SUITES.length} suites passed`);
process.exitCode = failures ? 1 : 0;
