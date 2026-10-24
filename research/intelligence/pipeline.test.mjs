import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { observe, propose, evaluate, review, publish, canonical, verifyBundle, receive, rollbackReceipt, rollback, validateCandidate, digest } from './pipeline.mjs';
import { demonstrate } from './demo.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const candidate = propose(observe(fixtures.development));
const evaluation = evaluate(candidate, fixtures);
const reviewer = crypto.generateKeyPairSync('ed25519');
const publisher = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const trust = { reviewer: reviewer.publicKey, publisher: publisher.publicKey };
const receipt = review(evaluation, 'approve-shadow-experiment', reviewer.privateKey);
const bundle = version => publish(candidate, fixtures, receipt, version, reviewer.publicKey, publisher.privateKey);

test('minimized synthetic observations reject private data, uncontrolled subjects and duplicate fixture splits', () => {
  assert.throws(() => observe([{ ...fixtures.development[0], prompt: 'SYNTHETIC_PRIVATE_CANARY' }]));
  assert.throws(() => observe([{ ...fixtures.development[0], subject: 'https://secret.example/token' }]));
  const poisoned = copy(fixtures); poisoned.heldOut[0].id = poisoned.development[0].id;
  assert.throws(() => evaluate(candidate, poisoned));
  assert(!JSON.stringify(observe(fixtures.development)).includes('SYNTHETIC_PRIVATE_CANARY'));
});

test('proposal stays inactive and cannot include code, unsupported categories or evidence-free rules', () => {
  for (const mutate of [c => { c.status = 'validated'; }, c => { c.rules[0].evidence = []; }, c => { c.rules[0].script = 'process.exit()'; }, c => { c.rules[0].capability = 'superuser'; }, c => c.rules.push(c.rules[0])]) {
    const poisoned = copy(candidate); mutate(poisoned); assert.throws(() => validateCandidate(poisoned));
  }
});

test('evaluation reports frozen held-out denominators and exact expected outcomes', () => {
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.positiveCases, 4); assert.equal(evaluation.negativeCases, 4);
  assert.equal(evaluation.truePositive, 4); assert.equal(evaluation.precisionDenominator, 4); assert.equal(evaluation.recallDenominator, 4);
  assert(evaluation.scannerVersion && evaluation.engineVersion && evaluation.rubricVersion);
  assert.equal(evaluation.outcomes.length, 8);
  assert.equal(evaluation.falsePositive, 0); assert.equal(evaluation.falseNegative, 0);
  assert.equal(evaluation.fixturesDigest, digest(fixtures));
});

test('false negatives and poisoned provenance fail without tuning the held-out labels', () => {
  const missing = copy(candidate); missing.rules.pop();
  assert.equal(evaluate(missing, fixtures).passed, false);
  const fabricated = copy(candidate); fabricated.rules[0].capability = 'execute_code';
  assert.throws(() => evaluate(fabricated, fixtures));
  const falsePositive = copy(fixtures); falsePositive.heldOut[0].capabilities = [];
  assert.equal(evaluate(candidate, falsePositive).passed, false);
  assert.throws(() => review(evaluate(missing, fixtures), 'approve-shadow-experiment', reviewer.privateKey));
});

test('a missing, declined or wrong-key review cannot authorize distribution', () => {
  assert.throws(() => publish(candidate, fixtures, null, '0.0.1', trust.reviewer, publisher.privateKey));
  assert.throws(() => review(evaluation, 'decline', reviewer.privateKey));
  const forged = review(evaluation, 'approve-shadow-experiment', stranger.privateKey);
  assert.throws(() => publish(candidate, fixtures, forged, '0.0.1', trust.reviewer, publisher.privateKey));
});

test('separately trusted signatures bind candidate, evaluation, engine/rubric and review', () => {
  const valid = bundle('0.0.1');
  assert.equal(verifyBundle(valid, fixtures, trust).productionApproved, false);
  assert.throws(() => verifyBundle(valid, fixtures, { ...trust, publisher: stranger.publicKey }));
  for (const mutate of [b => { b.body.candidate.status = 'validated'; }, b => { b.body.evaluation.passed = false; }, b => { b.body.version = '9.0.0'; }, b => { b.body.review.body.productionApproved = true; }, b => { b.signature = 'invalid'; }]) {
    const corrupted = copy(valid); mutate(corrupted); assert.throws(() => verifyBundle(corrupted, fixtures, trust));
  }
  const changedOracle = copy(fixtures); changedOracle.heldOut[0].capabilities = [];
  assert.throws(() => verifyBundle(valid, changedOracle, trust));
});

test('a publisher signature alone cannot forge evaluation results or replace the reviewer', () => {
  for (const mutate of [b => { b.body.evaluation.truePositive = 999; }, b => { b.body.review.signature = review(evaluation, 'approve-shadow-experiment', stranger.privateKey).signature; }]) {
    const forged = copy(bundle('0.0.1')); mutate(forged);
    forged.signature = crypto.sign(null, Buffer.from(canonical(forged.body)), publisher.privateKey).toString('base64');
    assert.throws(() => verifyBundle(forged, fixtures, trust));
  }
});

test('receiver emits only experimental overlays and rejects downgrade/same-version replacement', () => {
  const first = receive(bundle('0.0.1'), fixtures, trust);
  assert.equal(first.mode, 'shadow'); assert(first.overlay.claims.every(c => c.status === 'experimental'));
  assert.throws(() => receive(bundle('0.0.1'), fixtures, trust, first));
  assert.throws(() => receive(bundle('0.0.0'), fixtures, trust, first));
  const second = receive(bundle('0.0.2'), fixtures, trust, first);
  assert.equal(second.selectedVersion, '0.0.2');
});

test('rollback requires a bound reviewer signature, preserves the high-water mark and refuses replay', () => {
  const first = bundle('0.0.1'), second = bundle('0.0.2');
  const state = receive(second, fixtures, trust, receive(first, fixtures, trust));
  const approval = rollbackReceipt(state, first, reviewer.privateKey);
  const restored = rollback(state, first, fixtures, trust, approval);
  assert.equal(restored.selectedVersion, '0.0.1'); assert.equal(restored.highestVersion, '0.0.2');
  assert.throws(() => receive(second, fixtures, trust, restored));
  assert.throws(() => rollback(restored, first, fixtures, trust, approval));
  assert.throws(() => rollback(state, first, fixtures, trust, rollbackReceipt(state, first, stranger.privateKey)));
  assert.throws(() => rollback(state, second, fixtures, trust, approval));
});

test('real scanner consumes the distributed overlay only in shadow, with no permission or grade changes', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-intelligence-proof-'));
  try {
    const result = demonstrate(output);
    assert.equal(result.activeRules, 0); assert.equal(result.shadowClaims, 2);
    assert.equal(result.permissionsUnchanged, true); assert.equal(result.exposurePathsUnchanged, true);
    assert.equal(result.selectedVersionAfterRollback, '0.0.1');
    assert(!fs.readdirSync(output).some(name => /private|secret/i.test(name)));
    assert.throws(() => demonstrate(output)); // wx never overwrites an earlier artifact.
    for (const name of ['observations.json', 'bundle-0.0.1.json', 'fixture-trust-public-keys.json']) assert.equal(fs.statSync(path.join(output,name)).mode & 0o077, 0);
  } finally { fs.rmSync(output, { recursive:true, force:true }); }
});
