/**
 * Keyed path fingerprints: path_ + the first 128 bits of HMAC-SHA256 under the
 * per-machine key, in lowercase hex. Releases through 0.4.0 keyed them as
 * FNV-1a over the key and the path (models.stableId('path', [key, path])).
 * FNV-1a is invertible, so one such fingerprint let anyone forge the
 * fingerprint of every path under it without the key (AGR-01). The legacy
 * form is computed only to recognize local state those releases wrote.
 */
'use strict';
const crypto = require('crypto');
const models = require('../engine/models');
const scanner = require('../engine/localMcpScanner');

const FORMAT = 'hmac-sha256-128';
let key = '';

function hmacFingerprint(secret, value) { return `path_${crypto.createHmac('sha256', secret).update(`path|${value}`).digest('hex').slice(0, 32)}`; }

function useKey(secret) {
  key = secret;
  scanner.setFingerprinter(value => hmacFingerprint(secret, value));
}

function legacy(value) { return key && typeof value === 'string' && value.trim() ? models.stableId('path', [key, value.trim()]) : null; }

/** 'current' or 'legacy' when a stored fingerprint names this path, else null. */
function formatOf(fingerprint, value) {
  if (typeof fingerprint !== 'string') return null;
  if (fingerprint === scanner.pathFingerprint(value)) return 'current';
  return fingerprint === legacy(value) ? 'legacy' : null;
}

function inFormat(format, value) { return format === 'legacy' ? legacy(value) : scanner.pathFingerprint(value); }

/** The agent id a release with legacy fingerprints gave this scanned client. */
function legacyAgentId(client) { return client.primaryPath ? scanner.localAgentId(client.source, legacy(client.primaryPath)) : null; }

/** An earlier export with each client's legacy agent id (and so its exposure keys) rewritten to the current one. */
function upgradeExport(previous, clients) {
  let text = JSON.stringify(previous);
  for (const client of clients) {
    const old = client.agentId && legacyAgentId(client);
    if (old && old !== client.agentId) text = text.split(old).join(client.agentId);
  }
  return JSON.parse(text);
}

module.exports = { FORMAT, hmacFingerprint, useKey, legacy, formatOf, inFormat, legacyAgentId, upgradeExport };
