/**
 * Held-out split by server identity, and the shape check for human held-out
 * labels. Research tooling only; never imported by the product CLI. The
 * protocol it implements is HELD_OUT_PROTOCOL.md.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest } from './pipeline.mjs';

export const SPLIT_METHOD = 'identity-groups-v1';
const NAME = /^(@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/;
const NOISE = new Set(['mcp', 'server', 'servers', 'modelcontextprotocol', 'model', 'context', 'protocol']);
// Under a scope these name only a role, not a server (`@azure/mcp`, `@x/cli`).
const GENERIC = new Set(['', 'cli', 'core', 'client', 'sdk', 'tools', 'js', 'ts', 'node', 'api', 'app']);

function insist(ok, reason) { if (!ok) throw new Error(reason); }

/**
 * Keys that tie a package to a server identity. Two packages that share any
 * key are the same identity for splitting: same npm scope (same publisher),
 * or same name stem once MCP noise words and separators are gone. The scope
 * also counts as a stem so `clerk` and `@clerk/mcp-tools` stay together. A
 * scoped name whose stem is only a role word adds no stem of its own.
 */
export function identityKeys(name) {
  insist(typeof name === 'string' && NAME.test(name), `invalid package name: ${name}`);
  const keys = new Set();
  const [scope, bare] = name.startsWith('@') ? name.slice(1).split('/') : [null, name];
  const stemOf = text => text.split(/[^a-z0-9]+/).filter(t => t && !NOISE.has(t)).join('');
  if (scope) { keys.add(`scope:${scope}`); if (stemOf(scope)) keys.add(`stem:${stemOf(scope)}`); }
  const stem = stemOf(bare);
  if (!scope || !GENERIC.has(stem)) keys.add(`stem:${stem || bare}`);
  return [...keys].sort();
}

/** Union of packages that share a key; each group is one server identity. */
export function identityGroups(names) {
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  for (const name of names) {
    const node = `pkg:${name}`;
    if (!parent.has(node)) parent.set(node, node);
    for (const key of identityKeys(name)) { if (!parent.has(key)) parent.set(key, key); union(node, key); }
  }
  const groups = new Map();
  for (const name of names) {
    const root = find(`pkg:${name}`);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root).add(name);
  }
  return [...groups.values()].map(set => [...set].sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

/** A group's side depends only on the seed and its first member name, never on input order. */
function draw(seed, group) {
  return parseInt(crypto.createHash('sha256').update(`${seed}:${group[0]}`).digest('hex').slice(0, 8), 16) / 0x100000000;
}

/**
 * packages: [{name, version, contentHash}]. pinDevelopment: names that are
 * already contaminated (seen while building rules); their whole identity
 * group goes to development.
 */
export function splitByIdentity(packages, { seed, heldOutPercent, pinDevelopment = [], corpusDigest = null }) {
  insist(Number.isSafeInteger(seed) && seed > 0, 'positive integer seed required');
  insist(Number.isInteger(heldOutPercent) && heldOutPercent > 0 && heldOutPercent < 100, 'heldOutPercent must be 1..99');
  insist(Array.isArray(packages) && packages.length > 0 && packages.length <= 5000, 'bounded package list required');
  const byName = new Map();
  for (const p of packages) {
    insist(p && typeof p.name === 'string' && typeof p.version === 'string' && typeof p.contentHash === 'string', 'package needs name, version, contentHash');
    insist(!byName.has(p.name), `duplicate package: ${p.name}`);
    byName.set(p.name, { name: p.name, version: p.version, contentHash: p.contentHash });
  }
  const pinned = new Set(pinDevelopment);
  for (const name of pinned) insist(byName.has(name), `pinned package not in corpus: ${name}`);
  const development = [], heldOut = [];
  for (const group of identityGroups([...byName.keys()])) {
    const side = group.some(n => pinned.has(n)) || draw(seed, group) >= heldOutPercent / 100 ? development : heldOut;
    side.push({ identity: group[0], packages: group.map(n => byName.get(n)) });
  }
  const body = { schemaVersion: 1, method: SPLIT_METHOD, seed, heldOutPercent, corpusDigest, pinnedDevelopment: [...pinned].sort(), development, heldOut };
  verifySplit({ ...body, digest: digest(body) });
  return { ...body, digest: digest(body) };
}

/** Refuses a split that leaks an identity across sides or was edited after it was frozen. */
export function verifySplit(split) {
  insist(split && split.schemaVersion === 1 && split.method === SPLIT_METHOD, 'unknown split method');
  const { digest: recorded, ...body } = split;
  insist(recorded === digest(body), 'split digest mismatch');
  const side = new Map();
  for (const [label, groups] of [['development', split.development], ['heldOut', split.heldOut]]) {
    insist(Array.isArray(groups), `${label} groups required`);
    for (const group of groups) for (const p of group.packages) for (const key of [`pkg:${p.name}`, ...identityKeys(p.name)]) {
      const seen = side.get(key);
      insist(seen === undefined || seen === label, `identity ${key} appears in both development and held-out`);
      side.set(key, label);
    }
  }
  for (const name of split.pinnedDevelopment) insist(side.get(`pkg:${name}`) === 'development', `pinned package ${name} is not in development`);
  insist(split.heldOut.length > 0 && split.development.length > 0, 'both sides must be non-empty');
  return true;
}

const LABELER = /^[A-Za-z][A-Za-z .'-]{1,79}$/;
const AGENT_LABELERS = /\b(claude|codex|gpt|chatgpt|gemini|copilot|agent|bot|llm|model)\b/i;
const SHAPES = ['server', 'library', 'cli', 'wrapper', 'other'];

/**
 * Checks one human labeler's held-out file against the frozen split. It cannot
 * prove a human did the work; it refuses the shapes that would make the
 * number meaningless: agent labelers, missing blinding attestations, packages
 * outside held-out, versions or hashes that differ from the frozen corpus, and
 * positive labels without an exact evidence line.
 */
export function validateHeldOutLabels(labels, split, categories) {
  verifySplit(split);
  insist(labels && labels.schemaVersion === 1 && labels.splitDigest === split.digest, 'labels must name the frozen split digest');
  insist(typeof labels.labeler === 'string' && LABELER.test(labels.labeler) && !AGENT_LABELERS.test(labels.labeler), 'a named human labeler is required');
  const a = labels.attestation || {};
  insist(a.sawInspectorOutput === false && a.sawDevelopmentRules === false && a.ranResearchScripts === false && a.sawOtherLabelersFile === false, 'blinding attestation incomplete');
  const held = new Map(split.heldOut.flatMap(g => g.packages.map(p => [p.name, p])));
  insist(Array.isArray(labels.packages) && labels.packages.length > 0, 'labels required');
  const seen = new Set();
  for (const row of labels.packages) {
    const frozen = held.get(row.name);
    insist(frozen, `package ${row.name} is not in the held-out split`);
    insist(!seen.has(row.name), `duplicate label for ${row.name}`); seen.add(row.name);
    insist(row.version === frozen.version && row.contentHash === frozen.contentHash, `version or content hash of ${row.name} differs from the frozen corpus`);
    insist(SHAPES.includes(row.serverShape) && typeof row.unknown === 'boolean' && Array.isArray(row.categories), `incomplete label for ${row.name}`);
    const cats = new Set();
    for (const c of row.categories) {
      insist(categories.includes(c.category) && c.category !== 'unknown' && !cats.has(c.category), `invalid category on ${row.name}`); cats.add(c.category);
      const e = c.evidence || {};
      insist(typeof e.file === 'string' && e.file && !e.file.startsWith('/') && !e.file.includes('..') && Number.isInteger(e.line) && e.line > 0 && typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 200, `evidence line required for ${row.name}/${c.category}`);
    }
    insist(!row.unknown || row.categories.length === 0, `${row.name} is unknown and also has positive labels`);
  }
  return { labeler: labels.labeler, packages: seen.size };
}

/** Two independent files are required per held-out package; disagreements go to adjudication, not averaging. */
export function compareLabelers(first, second) {
  insist(first.labeler.toLowerCase() !== second.labeler.toLowerCase(), 'two different labelers required');
  const other = new Map(second.packages.map(p => [p.name, p]));
  const disagreements = [];
  for (const p of first.packages) {
    const q = other.get(p.name); if (!q) continue;
    const a = new Set(p.categories.map(c => c.category)), b = new Set(q.categories.map(c => c.category));
    const onlyFirst = [...a].filter(c => !b.has(c)).sort(), onlySecond = [...b].filter(c => !a.has(c)).sort();
    if (onlyFirst.length || onlySecond.length || p.serverShape !== q.serverShape || p.unknown !== q.unknown) disagreements.push({ name: p.name, onlyFirst, onlySecond, shape: [p.serverShape, q.serverShape], unknown: [p.unknown, q.unknown] });
  }
  return { both: first.packages.filter(p => other.has(p.name)).length, disagreements };
}

function corpusPackages(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const index = JSON.parse(raw);
  insist(Array.isArray(index.packages), 'corpus index has no packages');
  return { packages: index.packages, corpusDigest: crypto.createHash('sha256').update(raw).digest('hex') };
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULTS = Object.freeze({
  corpus: path.join(here, '../capability-map/corpus/index.json'),
  pin: path.join(here, '../capability-map/labels.json'),
  out: path.join(here, 'heldout-split-v1.json'),
  seed: 20261028,
  heldOutPercent: 30,
});

export function buildDefaultSplit() {
  const { packages, corpusDigest } = corpusPackages(DEFAULTS.corpus);
  const pinDevelopment = JSON.parse(fs.readFileSync(DEFAULTS.pin, 'utf8')).packages.map(p => p.name);
  return splitByIdentity(packages, { seed: DEFAULTS.seed, heldOutPercent: DEFAULTS.heldOutPercent, pinDevelopment, corpusDigest });
}

// node research/intelligence/heldout.mjs --write   (refuses to overwrite the frozen file)
// node research/intelligence/heldout.mjs --check   (recomputes and compares)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const mode = process.argv[2];
  const split = buildDefaultSplit();
  if (mode === '--write') {
    fs.writeFileSync(DEFAULTS.out, JSON.stringify(split, null, 2) + '\n', { flag: 'wx' });
    console.log(`wrote ${DEFAULTS.out}`);
  } else if (mode === '--check') {
    const frozen = JSON.parse(fs.readFileSync(DEFAULTS.out, 'utf8'));
    verifySplit(frozen);
    insist(canonical(frozen) === canonical(split), 'frozen split differs from a recomputation; the corpus or the rule changed');
    console.log(`ok ${frozen.digest}`);
  } else { console.error('usage: heldout.mjs --write | --check'); process.exit(2); }
  const count = groups => groups.reduce((n, g) => n + g.packages.length, 0);
  console.log(`development: ${split.development.length} identities, ${count(split.development)} packages; held-out: ${split.heldOut.length} identities, ${count(split.heldOut)} packages`);
}
