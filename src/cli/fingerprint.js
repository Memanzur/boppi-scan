/**
 * Keyed path fingerprints: path_ + the first 128 bits of HMAC-SHA256 under the
 * per-machine key, in lowercase hex. Releases through 0.4.0 keyed them as
 * FNV-1a over the key and the path (models.stableId('path', [key, path])).
 * FNV-1a is invertible, so one such fingerprint let anyone forge the
 * fingerprint of every path under it without the key (AGR-01).
 */
'use strict';
const crypto = require('crypto');
const scanner = require('../engine/localMcpScanner');

function hmacFingerprint(secret, value) { return `path_${crypto.createHmac('sha256', secret).update(`path|${value}`).digest('hex').slice(0, 32)}`; }

function useKey(secret) { scanner.setFingerprinter(value => hmacFingerprint(secret, value)); }

module.exports = { hmacFingerprint, useKey };
