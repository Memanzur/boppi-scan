/**
 * Lets a test wait for `boppi watch` to have rescanned, instead of sleeping
 * and hoping a rescan happened. Loaded in the watch child with --require and
 * BOPPI_TEST_SCAN_TRACE set, it appends a line to that file as each scan
 * starts. Rescans run one at a time, so once two scans have started after a
 * write, the first of them read the write and has finished: its changes,
 * holds and pushes are already logged.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TRACE_ENV = 'BOPPI_TEST_SCAN_TRACE';

if (process.env[TRACE_ENV]) {
  const watch = require(path.join(__dirname, '..', '..', 'src', 'cli', 'watch'));
  const runWatch = watch.runWatch;
  watch.runWatch = (options, deps) => runWatch(options, {
    ...deps,
    performScan: scanOptions => { fs.appendFileSync(process.env[TRACE_ENV], 'scan\n'); return deps.performScan(scanOptions); },
  });
}

const scansStarted = trace => (fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).length : 0);

/** Arguments and environment that make a spawned watch report its scans to `trace`. */
const traced = trace => ({ nodeArgs: ['--require', __filename], env: { [TRACE_ENV]: trace } });

/**
 * Call after a write: resolves true once a rescan that started after the
 * write has completed, false if that takes longer than timeoutMs (a hang
 * guard, not a timing assertion).
 */
async function rescanned(trace, { scans = 1, timeoutMs = 30000 } = {}) {
  const target = scansStarted(trace) + scans + 1;
  const deadline = Date.now() + timeoutMs;
  while (scansStarted(trace) < target) {
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
}

module.exports = { traced, rescanned, scansStarted };
