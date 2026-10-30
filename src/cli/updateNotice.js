/**
 * Update notice from the workspace's advertised minimum Agent version.
 *
 * Every answer from a workspace's Agent routes (ingest, events, connector)
 * carries a Boppi-Agent-Minimum header, refusals included. The Agent reads it
 * from responses it already receives, never asks npm or any other host, and
 * keeps the last value per workspace origin in <home>/.boppi/update-notice.json
 * (owner-only). The notice is printed from that file, so it also shows on
 * commands that make no request at all, and it disappears once the installed
 * version catches up or the workspace stops asking. A notice never blocks a
 * command or changes its exit code. NO_UPDATE_NOTIFIER or
 * BOPPI_NO_UPDATE_NOTICE silences it.
 *
 *   update-notice.json  { workspaces: { [origin]: { minimum, seenAt } } }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { renameRetry } = require('./platform');
const agentRequest = require('./agentRequest');

const HEADER = 'boppi-agent-minimum';
const RELEASE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const INSTALLED = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const WORKSPACES_MAX = 16;

function noticeFile(home) { return path.join(home, '.boppi', 'update-notice.json'); }

/** True when `installed` is older than `minimum`. A prerelease of the minimum counts as older; an unreadable installed version never asks for an update. */
function isOlder(installed, minimum) {
  const have = INSTALLED.exec(String(installed));
  const want = RELEASE.exec(String(minimum));
  if (!have || !want) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(have[i]) !== Number(want[i])) return Number(have[i]) < Number(want[i]);
  }
  return String(installed).split('+')[0].includes('-');
}

function load(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(noticeFile(home), 'utf8'));
    if (raw && typeof raw.workspaces === 'object' && raw.workspaces && !Array.isArray(raw.workspaces)) return raw;
  } catch (_) { /* missing or unreadable: no notice */ }
  return { workspaces: {} };
}

function save(home, state) {
  const file = noticeFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameRetry(temp, file);
}

/**
 * Record what one workspace answer said. A valid header replaces the stored
 * value; an answer without the header clears it (that workspace no longer
 * asks); a malformed header changes nothing.
 */
function observe(home, url, headers, now = new Date()) {
  let origin;
  try { origin = new URL(String(url)).origin; } catch (_) { return; }
  const value = headers && typeof headers.get === 'function' ? headers.get(HEADER) : null;
  if (value !== null && value !== undefined && !RELEASE.test(String(value).trim())) return;
  const state = load(home);
  const current = state.workspaces[origin];
  if (value === null || value === undefined) {
    if (!current) return;
    delete state.workspaces[origin];
  } else {
    const minimum = String(value).trim();
    if (current && current.minimum === minimum) return;
    state.workspaces[origin] = { minimum, seenAt: now.toISOString() };
    const origins = Object.keys(state.workspaces).sort((a, b) => String(state.workspaces[b].seenAt).localeCompare(String(state.workspaces[a].seenAt)));
    for (const stale of origins.slice(WORKSPACES_MAX)) delete state.workspaces[stale];
  }
  save(home, state);
}

/** fetchImpl that also records the header from every answer. Recording never fails the request. */
function watching(home, fetchImpl) {
  if (typeof fetchImpl !== 'function') return fetchImpl;
  return async (url, init) => {
    const response = await fetchImpl(url, init);
    try { observe(home, url, response && response.headers); } catch (_) { /* read-only home: no notice, same request */ }
    return response;
  };
}

/** The notice for the highest stored minimum above `installed`, or null. Reads one local file. */
function pending(home, installed, env = process.env) {
  if (env.NO_UPDATE_NOTIFIER || env.BOPPI_NO_UPDATE_NOTICE) return null;
  let highest = null;
  for (const [origin, entry] of Object.entries(load(home).workspaces)) {
    if (!entry || !RELEASE.test(String(entry.minimum)) || !isOlder(installed, entry.minimum)) continue;
    if (!highest || isOlder(highest.minimum, entry.minimum)) highest = { origin, minimum: entry.minimum };
  }
  if (!highest) return null;
  return `Update: ${highest.origin} asks for Boppi ${highest.minimum} or newer; this is ${installed}. ${agentRequest.upgradeLine(highest.origin, highest.minimum)}`;
}

const announced = new Set();

/** Write the pending notice once per process. Returns true when something was written. */
function announce(home, installed, write = line => process.stderr.write(line + '\n')) {
  const notice = pending(home, installed);
  if (!notice || announced.has(notice)) return false;
  announced.add(notice);
  write(notice);
  return true;
}

module.exports = { HEADER, noticeFile, isOlder, observe, watching, pending, announce };
