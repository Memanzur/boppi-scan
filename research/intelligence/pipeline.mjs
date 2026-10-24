/** Synthetic research protocol only. Never imported by the product CLI. */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { claimId } from '../capability-map/claims-schema.mjs';
const require = createRequire(import.meta.url);
const { CATEGORIES } = require('../../src/engine/permissionNormalizer');
const { ENGINE_VERSION } = require('../../src/engine/models');
const { RUBRIC_VERSION } = require('../../src/engine/riskRubric');
const { version: SCANNER_VERSION } = require('../../package.json');
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const SUBJECT = /^@boppi-fixtures\/[a-z][a-z0-9-]{0,63}$/;
const REF = /^(dev|held)-[a-z0-9-]{1,64}$/;
export const POLICY = Object.freeze({ version: 'synthetic-exact-v1', minPositive: 2, minNegative: 2, maxFalsePositive: 0, maxFalseNegative: 0 });

function insist(ok, reason) { if (!ok) throw new Error(reason); }
function keys(value, allowed) {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'object required');
  insist(Object.keys(value).every(k => allowed.includes(k)), 'unexpected field');
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  insist(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'unsupported signed value');
  insist(typeof value !== 'number' || Number.isFinite(value), 'non-finite value');
  return JSON.stringify(value);
}
export const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function sign(value, key) { insist(key.asymmetricKeyType === 'ed25519', 'Ed25519 required'); return crypto.sign(null, Buffer.from(canonical(value)), key).toString('base64'); }
function signed(value, signature, key) {
  insist(key?.asymmetricKeyType === 'ed25519' && typeof signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(signature), 'invalid signature encoding or key');
  insist(crypto.verify(null, Buffer.from(canonical(value)), key, Buffer.from(signature, 'base64')), 'signature refused');
}
function capabilities(values) {
  insist(Array.isArray(values) && values.length <= 25 && new Set(values).size === values.length && values.every(c => CATEGORIES.includes(c) && c !== 'unknown'), 'invalid capabilities');
}
function fixture(row) {
  keys(row, ['id', 'subject', 'version', 'capabilities']);
  insist(REF.test(row.id) && SUBJECT.test(row.subject) && VERSION.test(row.version), 'synthetic fixture identity required');
  capabilities(row.capabilities);
}
export function validateFixtures(fixtures) {
  keys(fixtures, ['schemaVersion', 'version', 'development', 'heldOut']);
  insist(fixtures.schemaVersion === 1 && fixtures.version === 'synthetic-v1', 'unknown fixture version');
  insist([fixtures.development, fixtures.heldOut].every(rows => Array.isArray(rows) && rows.length > 0 && rows.length <= 100), 'bounded fixture sets required');
  const ids = new Set();
  for (const row of [...fixtures.development, ...fixtures.heldOut]) { fixture(row); insist(!ids.has(row.id), 'fixture split overlap/duplicate'); ids.add(row.id); }
}

/** Only allowlisted synthetic fixture metadata is collected. No real scan import exists. */
export function observe(rows) {
  insist(Array.isArray(rows) && rows.length <= 100, 'bounded observations required');
  return { schemaVersion: 1, source: 'synthetic_fixture', scannerVersion: SCANNER_VERSION, engineVersion: ENGINE_VERSION, rubricVersion: RUBRIC_VERSION, records: rows.map(row => { fixture(row); return { ...row, capabilities: [...row.capabilities] }; }) };
}
export function propose(observations) {
  keys(observations, ['schemaVersion', 'source', 'scannerVersion', 'engineVersion', 'rubricVersion', 'records']);
  insist(observations.schemaVersion === 1 && observations.source === 'synthetic_fixture' && observations.scannerVersion === SCANNER_VERSION && observations.engineVersion === ENGINE_VERSION && observations.rubricVersion === RUBRIC_VERSION, 'unsupported observation provenance');
  const rules = new Map();
  for (const row of observe(observations.records).records) {
    for (const capability of row.capabilities) {
      const rule = { subjectKind: 'npm_package', subject: row.subject, subjectVersion: row.version, capability, evidence: [row.id] };
      const key = `${rule.subject}:${rule.subjectVersion}:${rule.capability}`;
      if (rules.has(key)) rules.get(key).evidence.push(row.id); else rules.set(key, rule);
    }
  }
  const candidate = { schemaVersion: 1, mode: 'synthetic-inactive', status: 'candidate', rules: [...rules.values()].sort((a, b) => canonical(a).localeCompare(canonical(b))) };
  validateCandidate(candidate);
  return candidate;
}
export function validateCandidate(candidate) {
  keys(candidate, ['schemaVersion', 'mode', 'status', 'rules']);
  insist(candidate.schemaVersion === 1 && candidate.mode === 'synthetic-inactive' && candidate.status === 'candidate', 'candidate must remain inactive');
  insist(Array.isArray(candidate.rules) && candidate.rules.length > 0 && candidate.rules.length <= 100, 'bounded candidate rules required');
  const identities = new Set();
  for (const rule of candidate.rules) {
    keys(rule, ['subjectKind', 'subject', 'subjectVersion', 'capability', 'evidence']);
    insist(rule.subjectKind === 'npm_package' && SUBJECT.test(rule.subject) && VERSION.test(rule.subjectVersion), 'only exact synthetic package versions supported');
    capabilities([rule.capability]);
    insist(Array.isArray(rule.evidence) && rule.evidence.length > 0 && rule.evidence.length <= 100 && rule.evidence.every(e => typeof e === 'string' && /^dev-[a-z0-9-]{1,64}$/.test(e)), 'development evidence required');
    const identity = [rule.subject, rule.subjectVersion, rule.capability].join(':');
    insist(!identities.has(identity), 'duplicate rule'); identities.add(identity);
  }
}

/** Labels come from the caller's frozen fixture set, never from the candidate. */
export function evaluate(candidate, fixtures) {
  validateFixtures(fixtures); validateCandidate(candidate);
  const development = new Map(fixtures.development.map(row => [row.id, row]));
  for (const rule of candidate.rules) for (const ref of rule.evidence) {
    const row = development.get(ref);
    insist(row && row.subject === rule.subject && row.version === rule.subjectVersion && row.capabilities.includes(rule.capability), 'unsubstantiated candidate evidence');
  }
  let tp = 0, fp = 0, fn = 0, positiveCases = 0, negativeCases = 0;
  const outcomes = [];
  for (const row of fixtures.heldOut) {
    const expected = new Set(row.capabilities);
    const predicted = new Set(candidate.rules.filter(r => r.subject === row.subject && r.subjectVersion === row.version).map(r => r.capability));
    if (expected.size) positiveCases++; else negativeCases++;
    for (const c of predicted) { if (expected.has(c)) tp++; else fp++; }
    for (const c of expected) if (!predicted.has(c)) fn++;
    outcomes.push({ fixtureId: row.id, falsePositive: [...predicted].filter(c => !expected.has(c)), falseNegative: [...expected].filter(c => !predicted.has(c)) });
  }
  return { schemaVersion: 1, candidateDigest: digest(candidate), fixturesDigest: digest(fixtures), policy: POLICY.version,
    scannerVersion: SCANNER_VERSION, engineVersion: ENGINE_VERSION, rubricVersion: RUBRIC_VERSION, outcomes, heldOutCases: fixtures.heldOut.length, positiveCases, negativeCases,
    truePositive: tp, falsePositive: fp, falseNegative: fn, precisionDenominator: tp + fp, recallDenominator: tp + fn,
    passed: positiveCases >= POLICY.minPositive && negativeCases >= POLICY.minNegative && fp <= POLICY.maxFalsePositive && fn <= POLICY.maxFalseNegative && tp > 0 };
}

/** The demo uses a synthetic signer; it never represents a founder/human approval. */
export function review(evaluation, decision, reviewerKey) {
  insist(evaluation.passed === true && decision === 'approve-shadow-experiment', 'review did not approve a passing experiment');
  const body = { kind: 'synthetic-review', evaluationDigest: digest(evaluation), decision, productionApproved: false };
  return { body, signature: sign(body, reviewerKey) };
}
function verifyReview(receipt, evaluation, reviewerKey) {
  keys(receipt, ['body', 'signature']);
  keys(receipt.body, ['kind', 'evaluationDigest', 'decision', 'productionApproved']);
  insist(receipt.body.kind === 'synthetic-review' && receipt.body.productionApproved === false && receipt.body.decision === 'approve-shadow-experiment' && receipt.body.evaluationDigest === digest(evaluation), 'review receipt does not bind this experiment');
  signed(receipt.body, receipt.signature, reviewerKey);
}
export function publish(candidate, fixtures, receipt, version, reviewerPublicKey, publisherPrivateKey) {
  insist(VERSION.test(version), 'strict bundle version required');
  const evaluation = evaluate(candidate, fixtures);
  insist(evaluation.passed, 'evaluation failed');
  verifyReview(receipt, evaluation, reviewerPublicKey);
  const body = { schemaVersion: 1, mode: 'synthetic-inactive', version, candidate, evaluation, review: receipt };
  return { body, signature: sign(body, publisherPrivateKey) };
}
export function verifyBundle(bundle, fixtures, trust) {
  insist(Buffer.byteLength(canonical(bundle)) <= 262144, 'bundle exceeds limit');
  keys(bundle, ['body', 'signature']);
  keys(bundle.body, ['schemaVersion', 'mode', 'version', 'candidate', 'evaluation', 'review']);
  insist(bundle.body.schemaVersion === 1 && bundle.body.mode === 'synthetic-inactive' && VERSION.test(bundle.body.version), 'unsupported or active bundle');
  signed(bundle.body, bundle.signature, trust.publisher);
  const evaluation = evaluate(bundle.body.candidate, fixtures);
  insist(evaluation.passed && digest(evaluation) === digest(bundle.body.evaluation), 'evaluation mismatch');
  verifyReview(bundle.body.review, evaluation, trust.reviewer);
  // Force experimental even after review; no branch can emit validated claims.
  const claims = bundle.body.candidate.rules.map(rule => {
    const claim = { scope: 'global', subjectKind: rule.subjectKind, subject: rule.subject, subjectVersion: rule.subjectVersion, capability: rule.capability, status: 'experimental', evidence: rule.evidence.map(ref => ({ kind: 'config', ref: `synthetic:${ref}`, observedAt: '2026-10-23T00:00:00Z' })) };
    return { id: claimId(claim), ...claim };
  });
  return { mode: 'shadow', version: bundle.body.version, bundleDigest: digest(bundle), claims, productionApproved: false };
}
function newer(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
export function receive(bundle, fixtures, trust, state = null) {
  const verified = verifyBundle(bundle, fixtures, trust);
  if (state) {
    insist(VERSION.test(state.highestVersion), 'invalid receiver state');
    insist(newer(verified.version, state.highestVersion), 'stale version or same-version replacement refused');
  }
  return { highestVersion: verified.version, selectedVersion: verified.version, selectedDigest: verified.bundleDigest, consumedRollbacks: state?.consumedRollbacks || [], overlay: { claims: verified.claims }, mode: 'shadow', productionApproved: false };
}
export function rollbackReceipt(state, targetBundle, reviewerKey) {
  const body = { kind: 'synthetic-rollback', fromDigest: state.selectedDigest, toDigest: digest(targetBundle), nonce: crypto.randomUUID(), productionApproved: false };
  return { body, signature: sign(body, reviewerKey) };
}
export function rollback(state, targetBundle, fixtures, trust, receipt) {
  keys(receipt, ['body', 'signature']);
  keys(receipt.body, ['kind', 'fromDigest', 'toDigest', 'nonce', 'productionApproved']);
  const body = receipt.body;
  insist(body.kind === 'synthetic-rollback' && body.productionApproved === false && body.fromDigest === state.selectedDigest && body.toDigest === digest(targetBundle) && typeof body.nonce === 'string' && /^[0-9a-f-]{36}$/.test(body.nonce) && !state.consumedRollbacks.includes(body.nonce), 'rollback binding/replay refused');
  signed(body, receipt.signature, trust.reviewer);
  const target = verifyBundle(targetBundle, fixtures, trust);
  insist(newer(state.selectedVersion, target.version), 'rollback must select an earlier verified version');
  return { ...state, selectedVersion: target.version, selectedDigest: target.bundleDigest, overlay: { claims: target.claims }, consumedRollbacks: [...state.consumedRollbacks, body.nonce] };
}
