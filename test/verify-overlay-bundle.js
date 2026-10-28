#!/usr/bin/env node
/** Verified overlay bundles are shadow only, refuse every malformed or replayed input with a named reason, and keep durable receiver state (C-1). Keys are generated per run; none is committed. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Criterion 6: nothing in the bundle module may reach the network.
const NETWORK = new Set(['http', 'https', 'net', 'dns', 'tls', 'http2', 'dgram', 'node:http', 'node:https', 'node:net', 'node:dns', 'node:tls', 'node:http2', 'node:dgram']);
const realLoad = Module._load;
let networkAttempts = 0;
Module._load = function (request, ...rest) { if (NETWORK.has(request)) { networkAttempts++; throw new Error(`network module ${request} is not allowed`); } return realLoad.call(this, request, ...rest); };
const bundles = require('../src/cli/overlayBundle');
Module._load = realLoad;
const { ENGINE_VERSION } = require('../src/engine/models');
const { RUBRIC_VERSION } = require('../src/engine/riskRubric');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const keyPair = () => crypto.generateKeyPairSync('ed25519');
const pem = key => key.export({ type: 'spki', format: 'pem' });
const sign = (value, key) => crypto.sign(null, Buffer.from(bundles.canonical(value)), key).toString('base64');
const publisher = keyPair(), reviewer = keyPair(), stranger = keyPair();
const FUTURE = '2099-01-01T00:00:00Z';

function claim(over = {}) {
  return { subjectKind: 'npm_package', subject: '@acme/mcp-notes', subjectVersion: '1.2.3', capability: 'run_shell_commands', status: 'experimental', expiresAt: FUTURE, evidence: [{ kind: 'evaluation', ref: 'held-out:notes-1' }], ...over };
}
/** Build a bundle; `edit` changes the body before the review, `after` after both signatures. */
function makeBundle({ version = '1.0.0', claims = [claim()], mode = 'inactive', compatibility = { engineVersionMin: ENGINE_VERSION, rubricVersions: [RUBRIC_VERSION] }, pub = publisher.privateKey, rev = reviewer.privateKey, edit, after } = {}) {
  const body = { schemaVersion: 1, kind: 'boppi-overlay-bundle', mode, version, compatibility, claims, evaluation: { policy: 'held-out-exact-v1', heldOutCases: 12, truePositive: 6, falsePositive: 0, falseNegative: 0, passed: true } };
  if (edit) edit(body);
  const reviewBody = { kind: 'overlay-review', contentDigest: bundles.digest(bundles.contentOf(body)), decision: 'approve-shadow', productionApproved: false };
  body.review = { body: reviewBody, signature: sign(reviewBody, rev) };
  const bundle = { body, signature: sign(body, pub) };
  if (after) after(bundle);
  return JSON.stringify(bundle);
}
function receipt(fromDigest, toDigest, { nonce = crypto.randomUUID(), key = reviewer.privateKey } = {}) {
  const body = { kind: 'overlay-rollback', fromDigest, toDigest, nonce, productionApproved: false };
  return JSON.stringify({ body, signature: sign(body, key) });
}

function makeHome(root, name) {
  const home = path.join(root, name);
  const dir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: {
    notes: { command: 'npx', args: ['-y', '@acme/mcp-notes@1.2.3'] },
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/someone'] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  } }, null, 2));
  return home;
}
function cli(args, home) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const stateBytes = home => { try { return fs.readFileSync(bundles.statePath(home), 'utf8'); } catch { return null; } };
const permissionKeys = e => e.inventory.real.permissions.map(p => `${p.agentId}|${p.mcpServerId || ''}|${p.normalizedCategory || p.category || ''}|${p.raw || p.name || ''}`).sort();
const severities = e => e.exposurePaths.map(p => `${p.exposureKey}:${p.severity}:${p.baseSeverity}`).sort();

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-overlay-bundle-'));
  const write = (name, text) => { const f = path.join(root, name); fs.writeFileSync(f, text); return f; };
  const trustFile = write('trust.json', JSON.stringify({ publisher: pem(publisher.publicKey), reviewer: pem(reviewer.publicKey) }));
  try {
    section('1. without a bundle the scan is unchanged');
    const home = makeHome(root, 'home');
    const base = cli(['scan', '--json', path.join(root, 'base.json'), '--quiet'], home);
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'base.json'), 'utf8'));
    ok('the plain scan succeeds and reports no overlay', base.code !== 2 && JSON.stringify(baseline.diagnostics) === '{"shadow":[],"applied":[]}');
    ok('the plain scan writes no overlay state', stateBytes(home) === null && !fs.existsSync(path.join(home, '.boppi', 'intelligence')));

    section('2. a verified bundle is reported in shadow only');
    const v1 = write('v1.json', makeBundle({ version: '1.0.0' }));
    const withBundle = cli(['scan', '--overlay-bundle', v1, '--trust', trustFile, '--json', path.join(root, 'with.json'), '--quiet'], home);
    const shadowed = JSON.parse(fs.readFileSync(path.join(root, 'with.json'), 'utf8'));
    const shadow = shadowed.diagnostics.shadow;
    ok('the scan accepts the bundle', withBundle.code === base.code);
    ok('its claim appears in diagnostics.shadow as experimental', shadow.length === 1 && shadow[0].server === 'notes' && shadow[0].capability === 'run_shell_commands' && shadow[0].status === 'experimental');
    ok('nothing is applied', shadowed.diagnostics.applied.length === 0);
    ok('diagnostics name the signed version, digest and signers', shadowed.diagnostics.overlay.signed && shadowed.diagnostics.overlay.signed.version === '1.0.0' && /^[0-9a-f]{16}$/.test(shadowed.diagnostics.overlay.signed.signers.publisher));
    ok(`permissions are identical to the baseline (${permissionKeys(baseline).length} compared)`, permissionKeys(baseline).length > 0 && JSON.stringify(permissionKeys(shadowed)) === JSON.stringify(permissionKeys(baseline)));
    ok(`exposure path severities are identical to the baseline (${severities(baseline).length} compared)`, severities(baseline).length > 0 && JSON.stringify(severities(shadowed)) === JSON.stringify(severities(baseline)));
    const loose = write('loose.json', makeBundle({ version: '1.0.1', claims: [claim({ subjectVersion: '1.2.4' })] }));
    const looseScan = cli(['scan', '--overlay-bundle', loose, '--trust', trustFile, '--json', path.join(root, 'loose-out.json'), '--quiet'], home);
    ok('a claim for another exact version does not match the pinned server', looseScan.code === base.code && JSON.parse(fs.readFileSync(path.join(root, 'loose-out.json'), 'utf8')).diagnostics.shadow.length === 0);
    const v101State = JSON.parse(stateBytes(home));

    section('3. every bad input is refused with a named reason and no state change');
    const wrongTrust = write('wrong-trust.json', JSON.stringify({ publisher: pem(stranger.publicKey), reviewer: pem(reviewer.publicKey) }));
    const wrongReviewerTrust = write('wrong-rev-trust.json', JSON.stringify({ publisher: pem(publisher.publicKey), reviewer: pem(stranger.publicKey) }));
    const big = claim(); big.evidence = Array.from({ length: 50 }, (_, i) => ({ kind: 'evaluation', ref: `held-out:${'x'.repeat(190)}${i}` }));
    const cases = [
      ['wrong publisher key', makeBundle({ version: '2.0.0' }), wrongTrust, 'publisher_signature'],
      ['wrong reviewer key', makeBundle({ version: '2.0.0' }), wrongReviewerTrust, 'reviewer_signature'],
      ['reviewer signed with the publisher key', makeBundle({ version: '2.0.0', rev: publisher.privateKey }), trustFile, 'reviewer_signature'],
      ['tampered body', makeBundle({ version: '2.0.0', after: b => { b.body.claims[0].capability = 'execute_code'; } }), trustFile, 'publisher_signature'],
      ['review of other content', makeBundle({ version: '2.0.0', after: b => { b.body.review.body.contentDigest = 'f'.repeat(64); b.body.review.signature = sign(b.body.review.body, reviewer.privateKey); b.signature = sign(b.body, publisher.privateKey); } }), trustFile, 'review_binding'],
      ['a mode other than inactive', makeBundle({ version: '2.0.0', mode: 'active' }), trustFile, 'not_inactive'],
      ['oversize', makeBundle({ version: '2.0.0', claims: Array.from({ length: 30 }, (_, i) => claim({ subject: `pkg-${i}`, evidence: big.evidence })) }), trustFile, 'oversize'],
      ['unknown field in the body', makeBundle({ version: '2.0.0', edit: b => { b.activate = true; } }), trustFile, 'unknown_field'],
      ['unknown field in a claim', makeBundle({ version: '2.0.0', claims: [{ ...claim(), autoApply: true }] }), trustFile, 'unknown_field'],
      ['expired claim', makeBundle({ version: '2.0.0', claims: [claim({ expiresAt: '2020-01-01T00:00:00Z' })] }), trustFile, 'claim_expired'],
      ['newer engine required', makeBundle({ version: '2.0.0', compatibility: { engineVersionMin: '99.0.0', rubricVersions: [RUBRIC_VERSION] } }), trustFile, 'engine_incompatible'],
      ['other rubric', makeBundle({ version: '2.0.0', compatibility: { engineVersionMin: ENGINE_VERSION, rubricVersions: ['0.9.0'] } }), trustFile, 'rubric_incompatible'],
      ['same version, different content', makeBundle({ version: '1.0.1', claims: [claim({ capability: 'execute_code' })] }), trustFile, 'version_not_newer'],
      ['lower version', makeBundle({ version: '0.9.0' }), trustFile, 'version_not_newer'],
      ['a claim marked validated', makeBundle({ version: '2.0.0', claims: [claim({ status: 'validated' })] }), trustFile, 'validated_claim'],
    ];
    for (const [label, text, trust, reason] of cases) {
      const before = stateBytes(home);
      const r = cli(['scan', '--overlay-bundle', write(`case-${reason}-${passed}.json`, text), '--trust', trust, '--quiet'], home);
      ok(`${label}: exit 2, ${reason}, state unchanged`, r.code === 2 && r.stderr.includes(`refused (${reason})`) && stateBytes(home) === before);
    }
    ok('the oversize case really is over the limit', Buffer.byteLength(cases.find(c => c[3] === 'oversize')[1]) > bundles.MAX_BYTES);

    section('rollback: single use, bound, only to an earlier verified bundle');
    const v1Digest = JSON.parse(fs.readFileSync(path.join(root, 'with.json'), 'utf8')).diagnostics.overlay.signed.digest;
    const unverifiedTarget = receipt(v101State.selectedDigest, 'a'.repeat(64));
    const r0before = stateBytes(home);
    const r0 = cli(['overlay', 'rollback', '--receipt', write('r0.json', unverifiedTarget), '--trust', trustFile], home);
    ok('rollback to a bundle never accepted here: rollback_target_unverified, no change', r0.code === 2 && r0.stderr.includes('refused (rollback_target_unverified)') && stateBytes(home) === r0before);
    const forged = cli(['overlay', 'rollback', '--receipt', write('rf.json', receipt(v101State.selectedDigest, v1Digest, { key: stranger.privateKey })), '--trust', trustFile], home);
    ok('a receipt not signed by the reviewer is refused', forged.code === 2 && forged.stderr.includes('refused (reviewer_signature)') && stateBytes(home) === r0before);
    const wrongFrom = cli(['overlay', 'rollback', '--receipt', write('rw.json', receipt(v1Digest, v1Digest)), '--trust', trustFile], home);
    ok('a receipt that does not start at the selected bundle is refused', wrongFrom.code === 2 && wrongFrom.stderr.includes('refused (rollback_binding)'));
    const goodReceipt = write('r1.json', receipt(v101State.selectedDigest, v1Digest));
    const r1 = cli(['overlay', 'rollback', '--receipt', goodReceipt, '--trust', trustFile], home);
    const afterRollback = JSON.parse(stateBytes(home));
    ok('a valid receipt selects the earlier verified bundle and keeps the high-water mark', r1.code === 0 && afterRollback.selectedVersion === '1.0.0' && afterRollback.highestVersion === '1.0.1' && afterRollback.consumedRollbacks.length === 1);
    const replayState = stateBytes(home);
    const replay = cli(['overlay', 'rollback', '--receipt', goodReceipt, '--trust', trustFile], home);
    ok('replaying the receipt is refused (rollback_replay) with no change', replay.code === 2 && replay.stderr.includes('refused (rollback_replay)') && stateBytes(home) === replayState);
    const forward = cli(['scan', '--overlay-bundle', loose, '--trust', trustFile, '--quiet'], home);
    ok('the rolled-back-from version cannot be re-accepted', forward.code === 2 && forward.stderr.includes('refused (version_not_newer)'));
    const again = cli(['scan', '--overlay-bundle', v1, '--trust', trustFile, '--quiet'], home);
    ok('the selected bundle can still be scanned with', again.code === base.code);

    section('4. state survives restarts and fails closed');
    const v2 = write('v2.json', makeBundle({ version: '2.0.0' }));
    ok('a newer version is accepted in a new process', cli(['scan', '--overlay-bundle', v2, '--trust', trustFile, '--quiet'], home).code === base.code && JSON.parse(stateBytes(home)).highestVersion === '2.0.0');
    ok('a later process still refuses the older version', cli(['scan', '--overlay-bundle', v1, '--trust', trustFile, '--quiet'], home).stderr.includes('refused (version_not_newer)'));
    ok('state is mode 600', (fs.statSync(bundles.statePath(home)).mode & 0o777) === 0o600);
    fs.rmSync(bundles.statePath(home));
    const missing = cli(['scan', '--overlay-bundle', v2, '--trust', trustFile, '--quiet'], home);
    ok('deleted state refuses every bundle (state_missing)', missing.code === 2 && missing.stderr.includes('refused (state_missing)'));
    fs.writeFileSync(bundles.statePath(home), '{"schemaVersion":1,"highestVersion":"9');
    const corrupt = cli(['scan', '--overlay-bundle', v2, '--trust', trustFile, '--quiet'], home);
    ok('corrupt state refuses every bundle (state_corrupt)', corrupt.code === 2 && corrupt.stderr.includes('refused (state_corrupt)'));
    const reset = cli(['overlay', 'reset'], home);
    ok('reset says it keeps no high-water mark', reset.code === 0 && /no high-water mark is kept/.test(reset.stdout) && JSON.parse(stateBytes(home)).highestVersion === null);
    ok('after reset an older verified version is accepted', cli(['scan', '--overlay-bundle', v1, '--trust', trustFile, '--quiet'], home).code === base.code && JSON.parse(stateBytes(home)).highestVersion === '1.0.0');
    ok('status reports the selected bundle', /selected: version 1\.0\.0/.test(cli(['overlay', 'status'], home).stdout));

    section('5. nothing can become validated');
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'overlayBundle.js'), 'utf8');
    ok('overlayBundle.js never assigns a validated status', !/status\s*[:=]\s*['"]validated['"]/.test(source));
    const verifiedClaims = bundles.verifyBundle(makeBundle({ version: '3.0.0', claims: [claim(), claim({ capability: 'read_files' })] }), bundles.loadTrust(trustFile)).claims;
    ok('every verified claim is experimental', verifiedClaims.length === 2 && verifiedClaims.every(c => c.status === 'experimental'));
    let refused = null;
    try { bundles.verifyBundle(makeBundle({ version: '3.0.0', claims: [claim({ status: 'validated' })] }), bundles.loadTrust(trustFile)); } catch (error) { refused = error.reason; }
    ok('a bundle claiming validated is refused, never downgraded silently', refused === 'validated_claim');

    section('6. no network');
    const quiet = makeHome(root, 'no-network');
    Module._load = function (request, ...rest) { if (NETWORK.has(request)) { networkAttempts++; throw new Error('network'); } return realLoad.call(this, request, ...rest); };
    try {
      const trust = bundles.loadTrust(trustFile);
      const a = bundles.accept(quiet, makeBundle({ version: '1.0.0' }), trust);
      const b = bundles.accept(quiet, makeBundle({ version: '1.1.0' }), trust);
      bundles.rollback(quiet, receipt(b.verified.digest, a.verified.digest), trust);
      bundles.reset(quiet);
    } finally { Module._load = realLoad; }
    ok('verify, accept, rollback and reset load no network module', networkAttempts === 0);
    ok('the module requires no network module at all', !/require\(['"](node:)?(https?|net|dns|tls|http2|dgram)['"]\)/.test(source));

    section('7. overlay verify is a dry run');
    const dryHome = makeHome(root, 'dry');
    const dry = cli(['overlay', 'verify', v2, '--trust', trustFile], dryHome);
    const trust = bundles.loadTrust(trustFile);
    ok('prints version, claim count, digest and both signer fingerprints', dry.code === 0 && /version 2\.0\.0, 1 experimental claim/.test(dry.stdout) && dry.stdout.includes(bundles.verifyBundle(fs.readFileSync(v2, 'utf8'), trust).digest)
      && dry.stdout.includes(bundles.fingerprint(trust.publisher)) && dry.stdout.includes(bundles.fingerprint(trust.reviewer)));
    ok('changes no state', stateBytes(dryHome) === null && !fs.existsSync(path.join(dryHome, '.boppi', 'intelligence')));
    const dryBad = cli(['overlay', 'verify', write('dry-bad.json', makeBundle({ version: '2.0.0', mode: 'active' })), '--trust', trustFile], dryHome);
    ok('a bad bundle exits 2 with its reason', dryBad.code === 2 && dryBad.stderr.includes('refused (not_inactive)'));
    ok('--overlay-bundle without --trust is refused', cli(['scan', '--overlay-bundle', v2, '--quiet'], dryHome).code === 2);

    section('unsigned overlays are marked');
    const unsignedFile = write('unsigned.json', JSON.stringify({ claims: [{ id: 'c1', subjectKind: 'npm_package', subject: '@acme/mcp-notes', capability: 'run_shell_commands', status: 'validated', evidence: [{ kind: 'human', actorId: 'me' }] }] }));
    const unsigned = cli(['scan', '--overlay', unsignedFile, '--json', path.join(root, 'unsigned-out.json'), '--quiet'], dryHome);
    ok('stderr warns about an unsigned overlay', /unsigned overlay/.test(unsigned.stderr));
    ok('diagnostics mark it unsigned', JSON.parse(fs.readFileSync(path.join(root, 'unsigned-out.json'), 'utf8')).diagnostics.overlay.unsigned === true);

    section('8. README states the limits');
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    ok('README says bundles are shadow only, have no hosted channel and use your own trust root', /--overlay-bundle/.test(readme) && /shadow only/i.test(readme) && /no hosted (channel|distribution)/i.test(readme) && /trust root/i.test(readme));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
