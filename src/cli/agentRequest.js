/**
 * What every Agent request to a workspace carries, and what the Agent says
 * when a workspace refuses it as too old.
 *
 * push (/api/ingest), events push (/api/events) and every /api/connector/*
 * route build their headers here, so the version handshake cannot drift
 * between commands:
 *   Boppi-Agent-Version: <package.json version>
 *   user-agent: boppi-cli/<version>
 * A workspace answers an Agent below its minimum with HTTP 426 and
 * agent_outdated (ingest and events: body.code, body.error is the sentence;
 * connector: body.error is the code, body.message the sentence). This is a
 * compatibility signal, not a security control: any client can claim any
 * version.
 */
'use strict';

const VERSION = require('../../package.json').version;
const USER_AGENT = `boppi-cli/${VERSION}`;
const RELEASE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const OUTDATED_STATUS = 426;
const OUTDATED_CODE = 'agent_outdated';

/** Request headers for one Agent request to a workspace. `extra` adds authorization. */
function agentHeaders(extra = {}) {
  return { 'content-type': 'application/json', 'user-agent': USER_AGENT, 'Boppi-Agent-Version': VERSION, ...extra };
}

/** True inside the standalone executable (Node single executable application), false under node or npx. */
function isStandalone() {
  try { return require('node:sea').isSea(); } catch (_) { return false; }
}

/**
 * The one line telling the user how to get an Agent the workspace accepts.
 * The standalone executable is replaced by rerunning the installer from the
 * workspace's Get the Agent page; an npm install is pointed at the exact
 * minimum, never at a tag (npm's latest can be older than a workspace's minimum).
 */
function upgradeLine(origin, minimum, standalone = isStandalone()) {
  const page = origin ? `${origin}/dashboard/get-agent` : 'your workspace\'s Get the Agent page';
  if (standalone) return `Rerun the installer from ${page} to replace this Agent.`;
  if (minimum && RELEASE.test(String(minimum))) return `Run: npx boppi@${minimum} (or install the current Agent from ${page}).`;
  return `Install the current Agent from ${page}.`;
}

/** For an agent_outdated refusal: the server's sentence plus the upgrade line. Null for any other answer. */
function describeOutdated(result) {
  if (!result || result.status !== OUTDATED_STATUS) return null;
  const body = result.body || {};
  if (body.code !== OUTDATED_CODE && body.error !== OUTDATED_CODE) return null;
  const sentence = typeof body.message === 'string' ? body.message : (typeof body.error === 'string' && body.error !== OUTDATED_CODE ? body.error : 'This workspace requires a newer Boppi Agent.');
  return `${sentence}\n${upgradeLine(result.origin || null, body.minimumVersion)}`;
}

module.exports = { VERSION, USER_AGENT, OUTDATED_STATUS, OUTDATED_CODE, agentHeaders, isStandalone, upgradeLine, describeOutdated };
