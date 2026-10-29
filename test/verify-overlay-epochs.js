#!/usr/bin/env node
/**
 * Signed overlay bundles: reset epochs and evaluation evidence (QA-005, QA-013).
 *
 * QA-005: reset keeps bundle files on disk, so a file is not proof that this
 * receiver accepted it. A rollback target must have been accepted since the
 * last reset, and a receipt used before a reset stays used after it.
 * QA-013: signatures authenticate authors, not numbers. An unsupported policy,
 * malformed counters or a `passed: true` the counters do not meet are refused
 * even when both signatures are good. Ephemeral keys and temp homes only.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bundles = require('../src/cli/overlayBundle');
const { ENGINE_VERSION } = require('../src/engine/models');
const { RUBRIC_VERSION } = require('../src/engine/riskRubric');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const publisher = crypto.generateKeyPairSync('ed25519'), reviewer = crypto.generateKeyPairSync('ed25519');
const pem = key => key.export({ type: 'spki', format: 'pem' });
const sign = (value, key) => crypto.sign(null, Buffer.from(bundles.canonical(value)), key).toString('base64');
const EVALUATION = { policy: 'held-out-exact-v1', heldOutCases: 12, truePositive: 6, falsePositive: 0, falseNegative: 0, passed: true };
function makeBundle(version, evaluation = EVALUATION) {
  const claim = { subjectKind: 'npm_package', subject: '@acme/mcp-notes', subjectVersion: '1.2.3', capability: 'run_shell_commands', status: 'experimental', expiresAt: '2099-01-01T00:00:00Z', evidence: [{ kind: 'evaluation', ref: 'held-out:notes-1' }] };
  const body = { schemaVersion: 1, kind: 'boppi-overlay-bundle', mode: 'inactive', version, compatibility: { engineVersionMin: ENGINE_VERSION, rubricVersions: [RUBRIC_VERSION] }, claims: [claim], evaluation };
  const reviewBody = { kind: 'overlay-review', contentDigest: bundles.digest(bundles.contentOf(body)), decision: 'approve-shadow', productionApproved: false };
  body.review = { body: reviewBody, signature: sign(reviewBody, reviewer.privateKey) };
  return JSON.stringify({ body, signature: sign(body, publisher.privateKey) });
}
function receipt(fromDigest, toDigest, nonce = crypto.randomUUID()) {
  const body = { kind: 'overlay-rollback', fromDigest, toDigest, nonce, productionApproved: false };
  return JSON.stringify({ body, signature: sign(body, reviewer.privateKey) });
}
const reason = work => { try { work(); return null; } catch (error) { return error.reason || error.message; } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-overlay-epochs-'));
const trustFile = path.join(root, 'trust.json');
fs.writeFileSync(trustFile, JSON.stringify({ publisher: pem(publisher.publicKey), reviewer: pem(reviewer.publicKey) }));
const trust = bundles.loadTrust(trustFile);
const v1 = makeBundle('1.0.0'), v2 = makeBundle('2.0.0');

section('QA-005: a reset epoch decides what rollback may select');
{
  const home = path.join(root, 'epoch');
  const a = bundles.accept(home, v1, trust), b = bundles.accept(home, v2, trust);
  bundles.reset(home);
  bundles.accept(home, v2, trust);
  ok('after reset the v1 file is still on disk', fs.existsSync(bundles.storedPath(home, a.verified.digest)));
  const before = fs.readFileSync(bundles.statePath(home), 'utf8');
  ok('Codex sequence: accept v1, v2, reset, v2; rollback to v1 is refused', reason(() => bundles.rollback(home, receipt(b.verified.digest, a.verified.digest), trust)) === 'rollback_target_unverified');
  ok('the refusal changes nothing', fs.readFileSync(bundles.statePath(home), 'utf8') === before && bundles.readState(home).selectedVersion === '2.0.0');
  bundles.reset(home);
  bundles.accept(home, v1, trust); bundles.accept(home, v2, trust);
  const back = bundles.rollback(home, receipt(b.verified.digest, a.verified.digest), trust);
  ok('once v1 is accepted again in the new epoch, the rollback succeeds', back.state.selectedVersion === '1.0.0');
}
{
  const home = path.join(root, 'replay');
  const a = bundles.accept(home, v1, trust), b = bundles.accept(home, v2, trust);
  const used = receipt(b.verified.digest, a.verified.digest);
  bundles.rollback(home, used, trust);
  bundles.reset(home);
  bundles.accept(home, v1, trust); bundles.accept(home, v2, trust);
  ok('a receipt used before a reset is still refused after it', reason(() => bundles.rollback(home, used, trust)) === 'rollback_replay');
}
{
  const home = path.join(root, 'legacy');
  const a = bundles.accept(home, v1, trust), b = bundles.accept(home, v2, trust);
  const state = JSON.parse(fs.readFileSync(bundles.statePath(home), 'utf8'));
  delete state.accepted;
  fs.writeFileSync(bundles.statePath(home), JSON.stringify(state));
  ok('state written before this change, never reset: earlier bundles stay selectable', bundles.rollback(home, receipt(b.verified.digest, a.verified.digest), trust).state.selectedVersion === '1.0.0');
  const reset = JSON.parse(fs.readFileSync(bundles.statePath(home), 'utf8'));
  reset.resetAt = new Date().toISOString(); delete reset.accepted;
  fs.writeFileSync(bundles.statePath(home), JSON.stringify(reset));
  ok('state written before this change after a reset: nothing counts as accepted', bundles.readState(home).accepted.length === 0);
  const bad = JSON.parse(fs.readFileSync(bundles.statePath(home), 'utf8'));
  bad.accepted = ['not-a-digest'];
  fs.writeFileSync(bundles.statePath(home), JSON.stringify(bad));
  ok('a malformed accepted list is state_corrupt', reason(() => bundles.readState(home)) === 'state_corrupt');
}

section('QA-013: evaluation evidence is checked, signatures or not');
for (const [label, edit] of [
  ['policy null', { policy: null }],
  ['an unknown policy', { policy: 'whatever-v9' }],
  ['a prototype key as the policy', { policy: 'constructor' }],
  ['negative held-out cases', { heldOutCases: -1 }],
  ['zero held-out cases', { heldOutCases: 0 }],
  ['a string counter', { truePositive: 'unknown' }],
  ['a fractional counter', { falsePositive: 0.5 }],
  ['a huge counter', { falseNegative: 1e9 }],
  ['passed beside 999 false positives and negatives', { falsePositive: 999, falseNegative: 999 }],
  ['passed with no true positive', { truePositive: 0 }],
  ['passed false', { passed: false }],
  ['the full Codex example', { policy: null, heldOutCases: -1, truePositive: 'unknown', falsePositive: 999, falseNegative: 999 }],
]) {
  ok(`${label}: refused evaluation_invalid`, reason(() => bundles.verifyBundle(makeBundle('3.0.0', { ...EVALUATION, ...edit }), trust)) === 'evaluation_invalid');
}
ok('control: a valid signed shadow bundle is still accepted', bundles.verifyBundle(makeBundle('3.0.0'), trust).claims.every(c => c.status === 'experimental'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
