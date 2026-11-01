/**
 * boppi watch: repeat a local scan and push in the foreground until Ctrl+C.
 *
 * This is not a resident agent and it does not protect the machine. Each cycle
 * is the same scan-and-push as `boppi push`, then a pause. The interval is
 * sent as expected_interval_seconds so the workspace can tell a quiet watcher
 * from a machine that stopped. Local history is never part of that payload.
 */
'use strict';

const DEFAULT_INTERVAL_SECONDS = 15 * 60;
const MIN_INTERVAL_SECONDS = 60;

function parseInterval(input) {
  if (input === undefined || input === null || input === '') return DEFAULT_INTERVAL_SECONDS;
  const text = String(input).trim().toLowerCase();
  const match = /^(\d+)([smh])?$/.exec(text);
  if (!match) throw new Error('--interval must be seconds (900) or a duration like 60s, 15m, or 1h');
  const count = Number(match[1]);
  const unit = match[2] || 's';
  const seconds = count * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
  if (!Number.isSafeInteger(seconds)) throw new Error('--interval is too large');
  if (seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`--interval is too short (${seconds}s). The minimum is ${MIN_INTERVAL_SECONDS}s; the default is 15m.`);
  }
  return seconds;
}

function formatInterval(seconds) {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

/** Pause that resolves early when `signal` aborts, so Ctrl+C does not wait out the interval. */
function delay(ms, signal) {
  return new Promise(resolve => {
    if (signal && signal.aborted) { resolve(); return; }
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `runOnce`, then sleep, until `signal` aborts. The first cycle starts
 * immediately. Aborting during a cycle lets that cycle finish; the loop does
 * not start another one, and it does not sleep after the signal aborts.
 */
async function repeat({ intervalSeconds, runOnce, sleep = delay, signal }) {
  let cycles = 0;
  for (;;) {
    if (signal && signal.aborted) break;
    await runOnce();
    cycles += 1;
    if (signal && signal.aborted) break;
    await sleep(intervalSeconds * 1000, signal);
    if (signal && signal.aborted) break;
  }
  return { cycles };
}

function intro(intervalSeconds) {
  return [
    `BOPPI · WATCH  scanning every ${formatInterval(intervalSeconds)} until Ctrl+C`,
    'Each cycle scans local MCP configuration and sends that scan\'s sanitized inventory.',
    'This does not protect the machine, observe agent activity, or block anything.',
    'Local history (~/.boppi/history.json) stays on this machine and is not uploaded.',
  ].join('\n');
}

module.exports = {
  DEFAULT_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  parseInterval,
  formatInterval,
  delay,
  repeat,
  intro,
};
