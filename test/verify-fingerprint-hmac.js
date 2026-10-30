#!/usr/bin/env node
/**
 * AGR-01: keyed path fingerprints are HMAC-SHA256, path_ + 32 hex. The red
 * team's FNV-1a length extension (one fingerprint of a folder forges the
 * fingerprint of any path under it, without the key) must fail.
 */
'use strict';
const crypto = require('crypto');
const models = require('../src/engine/models');
const scanner = require('../src/engine/localMcpScanner');
const fingerprint = require('../src/cli/fingerprint');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

/** The red team's attack (fp-recover.js): peel the known tail off each FNV-1a half, then hash forward over a relative path. */
const PRIME = 16777619;
let INV = 1; for (let i = 0; i < 5; i++) INV = Math.imul(INV, 2 - Math.imul(PRIME, INV)); INV >>>= 0;
const invert = (out, text) => { let h = out >>> 0; for (let i = text.length - 1; i >= 0; i--) { h = Math.imul(h, INV) >>> 0; h = (h ^ text.charCodeAt(i)) >>> 0; } return h; };
const forward = (state, text) => { let h = state; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, PRIME); } return (h >>> 0).toString(16).padStart(8, '0'); };
function forger(folderFingerprint) {
  const after = [invert(parseInt(folderFingerprint.slice(5, 13), 16), '"]'), invert(parseInt(folderFingerprint.slice(13, 21), 16), '"]')];
  return relative => `path_${forward(after[0], `${relative}"]`)}${forward(after[1], `${relative}"]`)}`;
}

const HOME = '/Users/alice';
const UNDER = ['/code/acme-api', '/.ssh', '/Documents/taxes-2025', '/.claude.json'];

section('the forgery fails against HMAC fingerprints');
{
  const key = crypto.randomBytes(32).toString('hex');
  fingerprint.useKey(key);
  const legacy = value => models.stableId('path', [key, value]);
  const legacyUnder = forger(legacy(HOME));
  ok('control: the attack still forges every legacy FNV fingerprint without the key', UNDER.every(rel => legacyUnder(rel) === legacy(HOME + rel)));
  const under = forger(scanner.pathFingerprint(HOME));
  for (const rel of UNDER) {
    const truth = scanner.pathFingerprint(HOME + rel);
    ok(`~${rel} is not forged, in full or as a prefix`, under(rel) !== truth && !truth.startsWith(under(rel)));
  }
  const project = scanner.pathFingerprint(`${HOME}/code/acme-api`);
  ok('a guessed project name is not confirmed', ['/code/acme-web', '/code/acme-api', '/src/infra'].every(guess => under(guess) !== project && !project.startsWith(under(guess))));
}

section('format and keying');
{
  const keyA = crypto.randomBytes(32).toString('hex');
  const keyB = crypto.randomBytes(32).toString('hex');
  fingerprint.useKey(keyA);
  const a1 = scanner.pathFingerprint('/Users/alice/code/acme-api');
  const a2 = scanner.pathFingerprint('  /Users/alice/code/acme-api ');
  ok('the output is exactly path_ + 32 lowercase hex', /^path_[0-9a-f]{32}$/.test(a1), a1);
  ok('it is HMAC-SHA256 of "path|<path>" under the key, first 128 bits', a1 === `path_${crypto.createHmac('sha256', keyA).update('path|/Users/alice/code/acme-api').digest('hex').slice(0, 32)}`);
  ok('same key and path give the same fingerprint (surrounding space trimmed)', a1 === a2 && a1 === scanner.pathFingerprint('/Users/alice/code/acme-api'));
  ok('different paths give different fingerprints', a1 !== scanner.pathFingerprint('/Users/alice/code/acme-web'));
  fingerprint.useKey(keyB);
  ok('a different key gives a different fingerprint', scanner.pathFingerprint('/Users/alice/code/acme-api') !== a1);
  const once = scanner.sanitizeArguments(['/Users/alice/docs', '--root=/srv/data']);
  ok('a keyed fingerprint in an argument is not mistaken for a secret on a second pass', JSON.stringify(scanner.sanitizeArguments(once)) === JSON.stringify(once) && /^--root=path_[0-9a-f]{32}$/.test(once[1]), once.join(' '));
  scanner.setFingerprinter(null);
  ok('without an injected fingerprinter the engine falls back to the unkeyed form', scanner.pathFingerprint('/Users/alice') === models.stableId('path', ['/Users/alice']) && /^path_[0-9a-f]{16}$/.test(scanner.pathFingerprint('/Users/alice')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
