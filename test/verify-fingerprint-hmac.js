#!/usr/bin/env node
/**
 * AGR-01: keyed path fingerprints are HMAC-SHA256, path_ + 32 hex. The red
 * team's FNV-1a length extension (one fingerprint of a folder forges the
 * fingerprint of any path under it, without the key) must fail, and an
 * install upgraded from the FNV form must still verify, roll back, uninstall
 * and serve connector rollbacks from the state the old form wrote.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const models = require('../src/engine/models');
const scanner = require('../src/engine/localMcpScanner');
const fingerprint = require('../src/cli/fingerprint');
const fix = require('../src/cli/fix');
const connect = require('../src/cli/connect');
const cli = require('../src/cli/boppi');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
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
  const legacyUnder = forger(fingerprint.legacy(HOME));
  ok('control: the attack still forges every legacy FNV fingerprint without the key', UNDER.every(rel => legacyUnder(rel) === fingerprint.legacy(HOME + rel)));
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
  ok('the legacy form is still path_ + 16 hex, for reading old state only', /^path_[0-9a-f]{16}$/.test(fingerprint.legacy('/Users/alice')));
  ok('formatOf names the form a stored fingerprint was written in', fingerprint.formatOf(scanner.pathFingerprint('/x'), '/x') === 'current' && fingerprint.formatOf(fingerprint.legacy('/x'), '/x') === 'legacy' && fingerprint.formatOf(fingerprint.legacy('/y'), '/x') === null);
  const once = scanner.sanitizeArguments(['/Users/alice/docs', '--root=/srv/data']);
  ok('a keyed fingerprint in an argument is not mistaken for a secret on a second pass', JSON.stringify(scanner.sanitizeArguments(once)) === JSON.stringify(once) && /^--root=path_[0-9a-f]{32}$/.test(once[1]), once.join(' '));
  scanner.setFingerprinter(null);
  ok('without an injected fingerprinter the engine falls back to the unkeyed form', scanner.pathFingerprint('/Users/alice') === models.stableId('path', ['/Users/alice']) && /^path_[0-9a-f]{16}$/.test(scanner.pathFingerprint('/Users/alice')));
}

// A preload that makes this CLI write state exactly as releases through 0.4.0 did: keyed FNV-1a fingerprints, no format in history.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-fp-hmac-'));
const LEGACY = path.join(root, 'legacy-preload.js');
fs.writeFileSync(LEGACY, `'use strict';
const models = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'engine', 'models'))});
const scanner = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'engine', 'localMcpScanner'))});
const fingerprint = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'cli', 'fingerprint'))});
const useKey = fingerprint.useKey;
fingerprint.useKey = key => { useKey(key); scanner.setFingerprinter(value => models.stableId('path', [key, value])); };
fingerprint.FORMAT = undefined;
`);

function makeHome(name) {
  const home = path.join(root, name);
  const dir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(home, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), JSON.stringify({ theme: 'keep-me', mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  } }, null, 2));
  return { home, config: path.join(dir, 'claude_desktop_config.json') };
}
function run(home, args, { legacy = false } = {}) {
  const r = spawnSync(process.execPath, [...(legacy ? ['--require', LEGACY] : []), CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_TOKEN: '' } });
  return { code: r.status, out: r.stdout + r.stderr };
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const historyOf = home => readJson(path.join(home, '.boppi', 'history.json'));

section('upgrade: verify grades an export the legacy form wrote');
{
  const { home, config } = makeHome('verify');
  const before = path.join(root, 'verify-before.json');
  run(home, ['scan', '--json', before], { legacy: true });
  const old = readJson(before);
  const prediction = old.predictions.find(p => p.edit.action === 'remove_server' && p.predictedEliminated.length);
  ok('the legacy export has a removal that closes a path', !!prediction);
  ok('the legacy export carries a legacy fingerprint', /^path_[0-9a-f]{16}$/.test(prediction.configFingerprint));
  const now = path.join(root, 'verify-now.json');
  run(home, ['scan', '--json', now]);
  const current = readJson(now).predictions.find(p => p.edit.server === prediction.edit.server && p.edit.action === 'remove_server');
  ok('the upgraded scan names the agent by a different id (so the test is not vacuous)', current && current.agentId !== prediction.agentId && /^path_[0-9a-f]{32}$/.test(current.configFingerprint));
  const parsed = readJson(config);
  delete parsed.mcpServers[prediction.edit.server];
  fs.writeFileSync(config, JSON.stringify(parsed, null, 2));
  const out = path.join(root, 'verify-out.json');
  const r = run(home, ['verify', before, '--json', out]);
  const resolution = readJson(out).resolutions.find(x => x.predictionId === prediction.predictionId);
  ok('the legacy prediction is CONFIRMED, not agent_not_scanned', resolution && resolution.status === 'CONFIRMED', resolution ? `${resolution.status} ${resolution.reason}` : r.out.slice(0, 300));
  const history = historyOf(home);
  const firstCurrent = history.find(e => e.kind !== 'verification' && e.pathFingerprints);
  ok('history: the first scan after the upgrade withholds its comparison with the legacy entry', firstCurrent && firstCurrent.changes && /fingerprints changed format/.test(firstCurrent.changes.withheld || ''), JSON.stringify(firstCurrent && firstCurrent.changes));
  run(home, ['scan']);
  const last = historyOf(home).filter(e => e.kind !== 'verification').at(-1);
  ok('history: the next scan compares again', last.changes && !last.changes.withheld && typeof last.changes.resolvedPaths === 'number', JSON.stringify(last.changes));
}

section('upgrade: rollback and uninstall work on legacy state');
{
  const { home, config } = makeHome('rollback');
  const original = fs.readFileSync(config);
  const applied = run(home, ['fix', '--server', 'fetch', '--yes'], { legacy: true });
  const entry = fix.readManifest(home).entries.find(e => e.action === 'remove_server');
  ok('the legacy release applied a fix with a backup', applied.code === 0 && !!entry, applied.out.slice(0, 300));
  fingerprint.useKey(fs.readFileSync(path.join(home, '.boppi', 'fingerprint-key'), 'utf8').trim());
  const release = fix.acquireLock(home, scanner.pathFingerprint(config));
  const blocked = run(home, ['rollback', '--id', entry.id, '--yes']);
  release();
  ok('rollback takes the same keyed file lock as fix and the connector', blocked.code === 2 && /another boppi process is editing/.test(blocked.out), blocked.out.slice(0, 300));
  const rolled = run(home, ['rollback', '--id', entry.id, '--yes']);
  ok('the upgraded rollback restores it byte for byte', rolled.code === 0 && fs.readFileSync(config).equals(original), rolled.out.slice(0, 300));
  const dry = run(home, ['uninstall', '--dry-run']);
  ok('uninstall lists the legacy state', dry.code === 0 && /fingerprint key/.test(dry.out) && /scan history/.test(dry.out), dry.out.slice(0, 400));
  const gone = run(home, ['uninstall', '--yes']);
  ok('uninstall removes it', gone.code === 0 && !fs.existsSync(path.join(home, '.boppi')), gone.out.slice(0, 400));
}

section('upgrade: a connector removal the legacy form recorded can still be rolled back');
(async () => {
  const { home, config } = makeHome('connector');
  const original = fs.readFileSync(config);
  const options = cli.parseArgs(['scan', '--home', home, '--cwd', home, '--platform', 'darwin']);
  const useKey = fingerprint.useKey;
  fingerprint.useKey = key => { useKey(key); scanner.setFingerprinter(value => models.stableId('path', [key, value])); };
  const oldScan = await cli.performScan(options);
  const [target] = connect.localTargets(oldScan, options);
  const oldOffer = connect.toOffer(target, '0.4.0', oldScan.startedAt);
  const oldBinding = { ...oldOffer, action: 'remove_server', nonce: 'n'.repeat(16) };
  const removed = connect.applyRemoval({ options, binding: oldBinding, proposalId: 'proposal-legacy', now: new Date().toISOString() });
  const legacyAgent = oldScan.discovery.clients.find(c => c.clientKey === target.client).agentId;
  fingerprint.useKey = useKey;
  ok('the legacy connector removal applied, bound to legacy fingerprints', removed.ok && /^path_[0-9a-f]{16}$/.test(oldBinding.targetFile) && /^path_[0-9a-f]{16}$/.test(oldBinding.project));

  const scan = await cli.performScan(options);
  ok('a rescan of the legacy proposal finds its file', connect.rescanReport(scan, oldBinding, options).configHash === removed.appliedHash);
  const offers = connect.rollbackTargets(scan, options).map(t => connect.toOffer(t, '0.4.1', scan.startedAt));
  const offer = offers.find(o => o.backupManifestId === removed.backupManifestId);
  ok('the rollback is offered with the legacy project and file the workspace bound the fix to', offer && offer.project === oldBinding.project && offer.targetFile === oldBinding.targetFile, JSON.stringify(offers));
  const restored = offer && connect.applyRollback({ options, scan, binding: { ...offer, nonce: 'r'.repeat(16) }, proposalId: 'proposal-rollback' });
  ok('the rollback restores the file byte for byte', restored && restored.ok && fs.readFileSync(config).equals(original), JSON.stringify(restored));
  const restoredScan = await cli.performScan(options);
  const report = connect.rescanReport(restoredScan, oldBinding, options);
  ok('a rescan graded against the legacy binding reports exposure keys in its agent id space', report.exposureKeys.length > 0 && report.exposureKeys.every(key => key.endsWith(`:${legacyAgent}`)), JSON.stringify(report.exposureKeys));
  const fresh = connect.localTargets(restoredScan, options).map(t => connect.toOffer(t, '0.4.1', scan.startedAt));
  ok('new offers use the HMAC form', fresh.length > 0 && fresh.every(o => /^path_[0-9a-f]{32}$/.test(o.targetFile) && /^path_[0-9a-f]{32}$/.test(o.project)));
  ok('a legacy removal binding is not one of the new offers (refused as not_offered, never applied)', !fresh.some(o => connect.offerMatches(o, oldBinding)));
})().catch(error => { failed++; console.log(`  ✗ connector continuity threw: ${error.stack}`); }).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
