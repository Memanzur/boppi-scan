import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { identityKeys, splitByIdentity, verifySplit, validateHeldOutLabels, compareLabelers, buildDefaultSplit, DEFAULTS } from './heldout.mjs';
import { digest } from './pipeline.mjs';
const require = createRequire(import.meta.url);
const { CATEGORIES } = require('../../src/engine/permissionNormalizer');
const copy = value => JSON.parse(JSON.stringify(value));
const frozen = JSON.parse(fs.readFileSync(DEFAULTS.out, 'utf8'));
const corpus = JSON.parse(fs.readFileSync(DEFAULTS.corpus, 'utf8')).packages;
const labeled = JSON.parse(fs.readFileSync(DEFAULTS.pin, 'utf8')).packages.map(p => p.name);
const heldNames = frozen.heldOut.flatMap(g => g.packages.map(p => p.name));
const reseal = split => { const { digest: _, ...body } = split; return { ...body, digest: digest(body) }; };

test('identity keys tie a package to its publisher scope and name stem, not to MCP role words', () => {
  assert.deepEqual(identityKeys('@clerk/mcp-tools'), ['scope:clerk', 'stem:clerk']);
  assert.deepEqual(identityKeys('clerk'), ['stem:clerk']);
  assert.deepEqual(identityKeys('@azure/mcp'), ['scope:azure', 'stem:azure']);
  assert.deepEqual(identityKeys('firecrawl-mcp'), ['stem:firecrawl']);
  assert.deepEqual(identityKeys('mcp-server-firecrawl'), ['stem:firecrawl']);
  assert.throws(() => identityKeys('../../etc/passwd'));
});

test('the split is deterministic and does not depend on input order', () => {
  const pin = labeled;
  const a = splitByIdentity(corpus, { seed: 7, heldOutPercent: 30, pinDevelopment: pin });
  const b = splitByIdentity([...corpus].reverse(), { seed: 7, heldOutPercent: 30, pinDevelopment: pin });
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.digest, splitByIdentity(corpus, { seed: 8, heldOutPercent: 30, pinDevelopment: pin }).digest);
});

test('the frozen split equals a recomputation from the committed corpus', () => {
  assert.equal(buildDefaultSplit().digest, frozen.digest);
  assert.equal(verifySplit(frozen), true);
  assert.ok(heldNames.length >= 30, `held-out has ${heldNames.length} packages`);
});

test('no held-out package shares a scope or stem with development, including every V1-labeled package', () => {
  const devKeys = new Set(frozen.development.flatMap(g => g.packages.flatMap(p => identityKeys(p.name))));
  for (const name of heldNames) for (const key of identityKeys(name)) assert(!devKeys.has(key), `${name} leaks ${key}`);
  for (const name of labeled) assert(!heldNames.includes(name), `${name} was labeled during development`);
});

test('a split edited after freezing is refused, resealed or not', () => {
  const moved = copy(frozen);
  moved.heldOut.push(moved.development.find(g => g.packages.some(p => p.name === labeled[0])));
  assert.throws(() => verifySplit(moved), /digest/);
  assert.throws(() => verifySplit(reseal(moved)), /both development and held-out/);
  const sneaky = copy(frozen);
  const devPkg = sneaky.development[0].packages[0];
  sneaky.heldOut[0].packages.push({ ...devPkg, name: `${devPkg.name.startsWith('@') ? devPkg.name.split('/')[0] + '/other' : devPkg.name + '-mcp'}` });
  assert.throws(() => verifySplit(reseal(sneaky)), /both development and held-out/);
  const unpinned = reseal({ ...copy(frozen), pinnedDevelopment: [...frozen.pinnedDevelopment, heldNames[0]] });
  assert.throws(() => verifySplit(unpinned), /pinned/);
  assert.throws(() => splitByIdentity(corpus, { seed: 7, heldOutPercent: 30, pinDevelopment: ['not-in-corpus'] }), /pinned/);
  assert.throws(() => splitByIdentity([...corpus, corpus[0]], { seed: 7, heldOutPercent: 30 }), /duplicate/);
});

const target = frozen.heldOut[0].packages[0];
const good = labeler => ({
  schemaVersion: 1, splitDigest: frozen.digest, labeler,
  attestation: { sawInspectorOutput: false, sawDevelopmentRules: false, ranResearchScripts: false, sawOtherLabelersFile: false },
  packages: [{ name: target.name, version: target.version, contentHash: target.contentHash, serverShape: 'server', unknown: false,
    categories: [{ category: 'call_external_api', evidence: { file: 'dist/index.js', line: 12, text: 'await fetch(url)' } }] }],
});

test('human held-out labels are checked against the frozen split and the blinding attestation', () => {
  assert.deepEqual(validateHeldOutLabels(good('Sample Labeler'), frozen, CATEGORIES), { labeler: 'Sample Labeler', packages: 1 });
  const refused = [
    l => { l.labeler = 'Claude'; }, l => { l.labeler = 'codex agent'; }, l => { l.labeler = ''; },
    l => { l.attestation.sawInspectorOutput = true; }, l => { delete l.attestation.sawOtherLabelersFile; },
    l => { l.splitDigest = '0'.repeat(64); },
    l => { l.packages[0].name = labeled[0]; },
    l => { l.packages[0].version = '0.0.0-other'; }, l => { l.packages[0].contentHash = 'sha256-x'; },
    l => { delete l.packages[0].categories[0].evidence; }, l => { l.packages[0].categories[0].evidence.file = '../outside.js'; },
    l => { l.packages[0].categories[0].category = 'superuser'; },
    l => { l.packages[0].unknown = true; },
    l => { l.packages.push(copy(l.packages[0])); },
  ];
  for (const mutate of refused) { const l = good('Sample Labeler'); mutate(l); assert.throws(() => validateHeldOutLabels(l, frozen, CATEGORIES)); }
});

test('two labelers are compared and disagreements are listed, never averaged', () => {
  const first = good('Labeler One'), second = good('Labeler Two');
  second.packages[0].categories = [];
  const result = compareLabelers(first, second);
  assert.equal(result.both, 1);
  assert.deepEqual(result.disagreements, [{ name: target.name, onlyFirst: ['call_external_api'], onlySecond: [], shape: ['server', 'server'], unknown: [false, false] }]);
  assert.equal(compareLabelers(first, good('Labeler Two')).disagreements.length, 0);
  assert.throws(() => compareLabelers(first, good('labeler one')), /different labelers/);
});
