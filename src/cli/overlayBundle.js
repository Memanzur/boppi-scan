/**
 * Verified overlay bundles (C-1). A bundle is a signed, reviewed set of
 * capability claims that the scanner only reports in shadow: it never adds a
 * permission, changes a severity or marks a claim validated. The trust root is
 * a local file the user passes with --trust; no key ships with Boppi and no
 * bundle is fetched from anywhere.
 *
 *   bundle = { body, signature }            publisher signs canonical(body)
 *   body.review = { body, signature }       reviewer signs the content digest
 *
 * Receiver state lives at ~/.boppi/intelligence/state.json (mode 600, atomic
 * write): the highest version ever accepted, the selected bundle, and spent
 * rollback nonces. A missing or corrupt state after first use fails closed
 * until `boppi overlay reset`.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fix = require('./fix');
const normalizer = require('../engine/permissionNormalizer');
const { ENGINE_VERSION } = require('../engine/models');
const { RUBRIC_VERSION } = require('../engine/riskRubric');

const MAX_BYTES = 262144;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const SUBJECT = /^(@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}$/;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const DIGEST = /^[0-9a-f]{64}$/;
// Evaluation policies this receiver understands, with the result each one requires for `passed` (QA-013).
const EVALUATION_POLICIES = Object.freeze({ 'held-out-exact-v1': { maxFalsePositive: 0, maxFalseNegative: 0 } });
const MAX_CASES = 100000;

class BundleRefusal extends Error {
  constructor(reason, detail) { super(`refused (${reason}): ${detail}`); this.reason = reason; }
}
function refuse(reason, detail) { throw new BundleRefusal(reason, detail); }
function insist(ok, reason, detail) { if (!ok) refuse(reason, detail); }

function onlyKeys(value, allowed, where) {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'unknown_field', `${where} must be an object`);
  const extra = Object.keys(value).filter(k => !allowed.includes(k));
  insist(!extra.length, 'unknown_field', `${where} has unexpected field ${extra[0]}`);
  const missing = allowed.filter(k => !(k in value));
  insist(!missing.length, 'unknown_field', `${where} is missing ${missing[0]}`);
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  insist(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'unknown_field', 'unsupported value in signed content');
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

function newer(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
const atLeast = (version, min) => version === min || newer(version, min);

function publicKey(pem, role) {
  let key;
  try { key = crypto.createPublicKey(pem); } catch { refuse('trust_invalid', `${role} is not a public key`); }
  insist(key.asymmetricKeyType === 'ed25519', 'trust_invalid', `${role} must be an Ed25519 key`);
  return key;
}
function fingerprint(key) { return crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16); }

/** The local trust root: { publisher, reviewer } PEM public keys, two different keys. */
function loadTrust(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { refuse('trust_invalid', `cannot read ${file}: ${error.message}`); }
  onlyKeys(parsed, ['publisher', 'reviewer'], 'trust file');
  const publisher = publicKey(parsed.publisher, 'publisher');
  const reviewer = publicKey(parsed.reviewer, 'reviewer');
  insist(fingerprint(publisher) !== fingerprint(reviewer), 'trust_invalid', 'publisher and reviewer must be different keys');
  return { publisher, reviewer };
}

function checkSignature(value, signature, key, reason) {
  insist(typeof signature === 'string' && SIGNATURE.test(signature), reason, 'signature is not an Ed25519 signature');
  insist(crypto.verify(null, Buffer.from(canonical(value)), key, Buffer.from(signature, 'base64')), reason, 'signature does not verify against the trusted key');
}

function checkClaim(claim, now, index) {
  insist(!(claim && claim.status === 'validated'), 'validated_claim', `claim ${index} says validated; a bundle can only carry experimental claims`);
  onlyKeys(claim, ['subjectKind', 'subject', 'subjectVersion', 'capability', 'status', 'expiresAt', 'evidence'], `claim ${index}`);
  insist(claim.status === 'experimental', 'claim_invalid', `claim ${index} status must be experimental`);
  insist(['npm_package', 'pypi_package'].includes(claim.subjectKind), 'claim_invalid', `claim ${index} subjectKind`);
  insist(typeof claim.subject === 'string' && SUBJECT.test(claim.subject), 'claim_invalid', `claim ${index} subject`);
  insist(typeof claim.subjectVersion === 'string' && VERSION.test(claim.subjectVersion), 'claim_invalid', `claim ${index} needs an exact subjectVersion`);
  insist(normalizer.CATEGORIES.includes(claim.capability) && claim.capability !== 'unknown', 'claim_invalid', `claim ${index} capability is not in the taxonomy`);
  const expires = Date.parse(claim.expiresAt);
  insist(typeof claim.expiresAt === 'string' && Number.isFinite(expires), 'claim_invalid', `claim ${index} expiresAt`);
  insist(expires > now, 'claim_expired', `claim ${index} expired at ${claim.expiresAt}`);
  insist(Array.isArray(claim.evidence) && claim.evidence.length > 0 && claim.evidence.length <= 50, 'claim_invalid', `claim ${index} evidence`);
  for (const e of claim.evidence) {
    onlyKeys(e, ['kind', 'ref'], `claim ${index} evidence`);
    insist(['evaluation', 'human'].includes(e.kind) && typeof e.ref === 'string' && e.ref.length > 0 && e.ref.length <= 200, 'claim_invalid', `claim ${index} evidence entry`);
  }
}

/**
 * Signatures authenticate the authors, not the numbers. The evaluation must
 * name a supported policy, carry bounded whole-number counters, and pass by
 * that policy's own rule; a `passed: true` beside counters that fail it, or
 * malformed counters, is refused even with good signatures.
 */
function checkEvaluation(evaluation) {
  const policy = typeof evaluation.policy === 'string' && Object.hasOwn(EVALUATION_POLICIES, evaluation.policy) ? EVALUATION_POLICIES[evaluation.policy] : null;
  insist(policy, 'evaluation_invalid', `evaluation policy ${JSON.stringify(evaluation.policy)} is not supported`);
  for (const key of ['heldOutCases', 'truePositive', 'falsePositive', 'falseNegative']) {
    insist(Number.isSafeInteger(evaluation[key]) && evaluation[key] >= 0 && evaluation[key] <= MAX_CASES, 'evaluation_invalid', `evaluation ${key} must be a whole number from 0 to ${MAX_CASES}`);
  }
  insist(evaluation.heldOutCases > 0, 'evaluation_invalid', 'evaluation has no held-out cases');
  const meets = evaluation.truePositive > 0 && evaluation.falsePositive <= policy.maxFalsePositive && evaluation.falseNegative <= policy.maxFalseNegative;
  insist(evaluation.passed === true && meets, 'evaluation_invalid', evaluation.passed === true ? `evaluation claims a pass its counters do not meet under ${evaluation.policy}` : 'evaluation did not pass');
}

/** Content the reviewer approves: everything in the body except the review itself. */
function contentOf(body) { return { schemaVersion: body.schemaVersion, kind: body.kind, mode: body.mode, version: body.version, compatibility: body.compatibility, claims: body.claims, evaluation: body.evaluation }; }

/**
 * Verify one bundle against the trust root, the clock and this scanner's
 * versions. Pure apart from reading nothing: no state, no files, no network.
 */
function verifyBundle(text, trust, { now = Date.now(), engineVersion = ENGINE_VERSION, rubricVersion = RUBRIC_VERSION } = {}) {
  insist(Buffer.byteLength(text) <= MAX_BYTES, 'oversize', `bundle is larger than ${MAX_BYTES} bytes`);
  let bundle;
  try { bundle = JSON.parse(text); } catch { refuse('unknown_field', 'bundle is not JSON'); }
  onlyKeys(bundle, ['body', 'signature'], 'bundle');
  const body = bundle.body;
  onlyKeys(body, ['schemaVersion', 'kind', 'mode', 'version', 'compatibility', 'claims', 'evaluation', 'review'], 'body');
  insist(body.schemaVersion === 1 && body.kind === 'boppi-overlay-bundle', 'unsupported_schema', 'not a version 1 Boppi overlay bundle');
  insist(body.mode === 'inactive', 'not_inactive', `mode is ${JSON.stringify(body.mode)}; only inactive bundles are accepted`);
  checkSignature(body, bundle.signature, trust.publisher, 'publisher_signature');
  insist(typeof body.version === 'string' && VERSION.test(body.version), 'unsupported_schema', 'version must be x.y.z');
  onlyKeys(body.compatibility, ['engineVersionMin', 'rubricVersions'], 'compatibility');
  insist(typeof body.compatibility.engineVersionMin === 'string' && VERSION.test(body.compatibility.engineVersionMin), 'unsupported_schema', 'engineVersionMin');
  insist(atLeast(engineVersion, body.compatibility.engineVersionMin), 'engine_incompatible', `needs engine ${body.compatibility.engineVersionMin} or later; this is ${engineVersion}`);
  insist(Array.isArray(body.compatibility.rubricVersions) && body.compatibility.rubricVersions.includes(rubricVersion), 'rubric_incompatible', `written for rubric ${(body.compatibility.rubricVersions || []).join(', ')}; this is ${rubricVersion}`);
  onlyKeys(body.evaluation, ['policy', 'heldOutCases', 'truePositive', 'falsePositive', 'falseNegative', 'passed'], 'evaluation');
  checkEvaluation(body.evaluation);
  insist(Array.isArray(body.claims) && body.claims.length > 0 && body.claims.length <= 500, 'claim_invalid', 'claims must be a non-empty bounded list');
  body.claims.forEach((claim, i) => checkClaim(claim, now, i));
  onlyKeys(body.review, ['body', 'signature'], 'review');
  onlyKeys(body.review.body, ['kind', 'contentDigest', 'decision', 'productionApproved'], 'review body');
  checkSignature(body.review.body, body.review.signature, trust.reviewer, 'reviewer_signature');
  insist(body.review.body.kind === 'overlay-review' && body.review.body.decision === 'approve-shadow' && body.review.body.productionApproved === false
    && body.review.body.contentDigest === digest(contentOf(body)), 'review_binding', 'the review does not approve this exact content for shadow use');
  const claims = body.claims.map(claim => ({ id: `bclaim_${digest(claim).slice(0, 16)}`, ...claim, evidence: claim.evidence.map(e => ({ ...e })) }));
  return { version: body.version, digest: digest(bundle), claims, compatibility: body.compatibility, signers: { publisher: fingerprint(trust.publisher), reviewer: fingerprint(trust.reviewer) } };
}

// ── receiver state ──
function stateDir(home) { return path.join(home, '.boppi', 'intelligence'); }
function statePath(home) { return path.join(stateDir(home), 'state.json'); }
function storedPath(home, bundleDigest) { return path.join(stateDir(home), 'bundles', `${bundleDigest}.json`); }
function storedDigests(home) {
  try { return fs.readdirSync(path.join(stateDir(home), 'bundles')).map(name => name.replace(/\.json$/, '')).filter(d => DIGEST.test(d)).slice(0, MAX_ACCEPTED); } catch { return []; }
}
const EMPTY = Object.freeze({ schemaVersion: 1, highestVersion: null, selectedVersion: null, selectedDigest: null, consumedRollbacks: [], accepted: [] });
const MAX_ACCEPTED = 1000;

/** Fresh state on first use; after first use a missing or unreadable state refuses until reset. */
function readState(home) {
  const file = statePath(home);
  if (!fs.existsSync(file)) {
    const bundles = path.join(stateDir(home), 'bundles');
    insist(!fs.existsSync(bundles) || fs.readdirSync(bundles).length === 0, 'state_missing', `${file} is gone but accepted bundles exist; run boppi overlay reset to start over`);
    return { ...EMPTY, consumedRollbacks: [], accepted: [] };
  }
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { refuse('state_corrupt', `${file} is unreadable; run boppi overlay reset to start over`); }
  const ok = state && state.schemaVersion === 1 && Array.isArray(state.consumedRollbacks) && state.consumedRollbacks.every(n => NONCE.test(n))
    && (state.highestVersion === null || VERSION.test(state.highestVersion)) && (state.selectedVersion === null || VERSION.test(state.selectedVersion))
    && (state.selectedDigest === null || DIGEST.test(state.selectedDigest)) && (state.resetAt === undefined || typeof state.resetAt === 'string')
    && (state.accepted === undefined || (Array.isArray(state.accepted) && state.accepted.length <= MAX_ACCEPTED && state.accepted.every(d => typeof d === 'string' && DIGEST.test(d))));
  insist(ok, 'state_corrupt', `${file} is not valid receiver state; run boppi overlay reset to start over`);
  // State written before acceptance was recorded: with no reset since, every stored bundle was accepted by this
  // receiver (the only writer); after a reset nothing is known to be accepted in the current epoch.
  if (state.accepted === undefined) state.accepted = state.resetAt !== undefined ? [] : storedDigests(home);
  return state;
}
function writeState(home, state) {
  fs.mkdirSync(stateDir(home), { recursive: true, mode: 0o700 });
  fix.writeAtomic(statePath(home), JSON.stringify(state, null, 2) + '\n', 0o600);
}
function withLock(home, work) {
  fs.mkdirSync(path.join(home, '.boppi'), { recursive: true, mode: 0o700 });
  const release = fix.acquireLock(home, 'intelligence-state');
  insist(release, 'state_locked', 'another boppi process is changing the overlay state; try again');
  try { return work(); } finally { release(); }
}

/** Accept a verified bundle for this receiver: the selected one again, or a strictly newer version. */
function accept(home, text, trust, opts = {}) {
  const verified = verifyBundle(text, trust, opts);
  return withLock(home, () => {
    const state = readState(home);
    if (state.selectedDigest === verified.digest) return { verified, state, changed: false };
    insist(!state.highestVersion || newer(verified.version, state.highestVersion), 'version_not_newer',
      `version ${verified.version} is not newer than ${state.highestVersion}, the highest accepted; same-version replacement and downgrade are refused (use boppi overlay rollback)`);
    fs.mkdirSync(path.dirname(storedPath(home, verified.digest)), { recursive: true, mode: 0o700 });
    fix.writeAtomic(storedPath(home, verified.digest), text, 0o600);
    const accepted = [...state.accepted.filter(d => d !== verified.digest), verified.digest].slice(-MAX_ACCEPTED);
    const next = { ...state, highestVersion: verified.version, selectedVersion: verified.version, selectedDigest: verified.digest, accepted };
    writeState(home, next);
    return { verified, state: next, changed: true };
  });
}

/** Roll back to an earlier bundle this receiver accepted, on a reviewer-signed single-use receipt. */
function rollback(home, receiptText, trust, opts = {}) {
  let receipt;
  try { receipt = JSON.parse(receiptText); } catch { refuse('unknown_field', 'receipt is not JSON'); }
  onlyKeys(receipt, ['body', 'signature'], 'receipt');
  onlyKeys(receipt.body, ['kind', 'fromDigest', 'toDigest', 'nonce', 'productionApproved'], 'receipt body');
  const body = receipt.body;
  insist(body.kind === 'overlay-rollback' && body.productionApproved === false && typeof body.nonce === 'string' && NONCE.test(body.nonce), 'rollback_binding', 'not a shadow rollback receipt');
  checkSignature(body, receipt.signature, trust.reviewer, 'reviewer_signature');
  return withLock(home, () => {
    const state = readState(home);
    insist(!state.consumedRollbacks.includes(body.nonce), 'rollback_replay', `receipt ${body.nonce} was already used`);
    insist(state.selectedDigest && body.fromDigest === state.selectedDigest, 'rollback_binding', 'the receipt does not start from the selected bundle');
    // A stored file is not proof of acceptance: reset keeps files, so the target must have been accepted since then (QA-005).
    insist(typeof body.toDigest === 'string' && state.accepted.includes(body.toDigest), 'rollback_target_unverified', 'the target was not accepted by this receiver since its last reset');
    let text;
    try { text = fs.readFileSync(storedPath(home, body.toDigest), 'utf8'); } catch { refuse('rollback_target_unverified', 'the target is not a bundle this receiver verified and accepted'); }
    let target;
    try { target = verifyBundle(text, trust, opts); } catch (error) { refuse('rollback_target_unverified', `the stored target no longer verifies: ${error.message}`); }
    insist(target.digest === body.toDigest, 'rollback_target_unverified', 'the stored target does not match its digest');
    insist(newer(state.selectedVersion, target.version), 'rollback_not_earlier', `target ${target.version} is not earlier than ${state.selectedVersion}`);
    const next = { ...state, selectedVersion: target.version, selectedDigest: target.digest, consumedRollbacks: [...state.consumedRollbacks, body.nonce] };
    writeState(home, next);
    return { target, state: next };
  });
}

/** Start over: no high-water mark is kept. Stored bundles stay on disk but are no longer selectable by rollback until accepted again; used receipts stay used. */
function reset(home) {
  return withLock(home, () => {
    // Used rollback receipts stay used: a reset must not make an old receipt valid again. Unreadable state keeps none.
    let consumedRollbacks = [];
    try { consumedRollbacks = readState(home).consumedRollbacks; } catch { consumedRollbacks = []; }
    const next = { ...EMPTY, consumedRollbacks, accepted: [], resetAt: new Date().toISOString() };
    writeState(home, next);
    return next;
  });
}

/** The verified claims in the structure loadOverlay returns, matched by exact package version and shadow only. */
function toOverlay(file, verified) {
  const bySubject = new Map();
  for (const claim of verified.claims) {
    const key = `${claim.subjectKind}:${claim.subject}`;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(claim);
  }
  return { file: path.resolve(file), claimCount: verified.claims.length, activeCount: verified.claims.length, rejected: [], bySubject, exactVersion: true,
    signed: { version: verified.version, digest: verified.digest, signers: verified.signers } };
}

/** boppi overlay verify|status|rollback|reset. Exit 0 on success, 2 on any refusal. */
function runOverlay(options, out = text => process.stdout.write(text + '\n'), err = text => process.stderr.write(text + '\n')) {
  try {
    if (options.subcommand === 'verify') {
      const verified = verifyBundle(fs.readFileSync(options.input, 'utf8'), loadTrust(options.trust));
      const state = readState(options.home);
      const acceptable = state.selectedDigest === verified.digest || !state.highestVersion || newer(verified.version, state.highestVersion);
      out(`verified: version ${verified.version}, ${verified.claims.length} experimental claim${verified.claims.length === 1 ? '' : 's'}, shadow only`);
      out(`digest: ${verified.digest}`);
      out(`signers: publisher ${verified.signers.publisher}, reviewer ${verified.signers.reviewer}`);
      out(`compatible with engine ${ENGINE_VERSION} and rubric ${RUBRIC_VERSION}`);
      out(acceptable ? 'a scan with --overlay-bundle would accept it' : `a scan would refuse it: version is not newer than ${state.highestVersion}`);
      out('nothing was changed');
      return 0;
    }
    if (options.subcommand === 'status') {
      const state = readState(options.home);
      if (!state.selectedDigest) out(state.resetAt ? `no bundle selected (reset ${state.resetAt}; no high-water mark kept)` : 'no bundle accepted yet');
      else out(`selected: version ${state.selectedVersion}, digest ${state.selectedDigest}\nhighest accepted: ${state.highestVersion}\nrollbacks used: ${state.consumedRollbacks.length}`);
      out('bundles are shadow only: they never change permissions, paths or severities');
      return 0;
    }
    if (options.subcommand === 'rollback') {
      const { target, state } = rollback(options.home, fs.readFileSync(options.receipt, 'utf8'), loadTrust(options.trust));
      out(`rolled back to version ${target.version} (${target.digest}); highest accepted stays ${state.highestVersion}`);
      return 0;
    }
    if (options.subcommand === 'reset') {
      reset(options.home);
      out('overlay state reset: no high-water mark is kept, so any verified version can be accepted next');
      return 0;
    }
  } catch (error) {
    err(`boppi overlay ${options.subcommand}: ${error instanceof BundleRefusal ? error.message : error.message}`);
    return 2;
  }
  return 2;
}

module.exports = { runOverlay,  BundleRefusal, MAX_BYTES, canonical, digest, contentOf, fingerprint, loadTrust, verifyBundle, readState, statePath, storedPath, accept, rollback, reset, toOverlay };
