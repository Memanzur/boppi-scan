#!/usr/bin/env node
// Deterministic training and dev data generator for Boppi's own model.
// Labels come from the Boppi rules engine; explanations from rule and catalog
// text; fixes from boppi fix, kept only when a re-scan passes.
//
//   node research/model/gen.mjs --engine <boppi-scan checkout> --out research/model/out
//
// It never reads test/corpus or any held-out corpus. Outputs are gitignored.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rng, fnv } from './lib/rng.mjs';
import { scanConfig, fixAndRescan, catalogFor, SEVERITY_RANK } from './lib/engine.mjs';
import { partitionCatalog, makeConfig, inject, BENIGN_ROLES, probeSpec, shortName } from './lib/templates.mjs';
import { SYSTEM_PROMPT, userPrompt, buildTarget } from './lib/format.mjs';

const GENERATOR_VERSION = 'own-model-gen/1';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []));
const engineDir = path.resolve(args.engine || path.join(here, '..', '..'));
const outDir = path.resolve(args.out || path.join(here, 'out'));
const plan = {
  train: { clean: Number(args['train-clean'] || 2000), injected: Number(args['train-injected'] || 335), seed: Number(args['train-seed'] || 20261119) },
  dev: { clean: Number(args['dev-clean'] || 300), injected: Number(args['dev-injected'] || 65), seed: Number(args['dev-seed'] || 77003) },
};
const concurrency = Number(args.jobs || Math.max(2, os.cpus().length));

for (const forbidden of ['heldout', 'held-out', 'test/corpus']) {
  if (engineDir.includes(forbidden) || outDir.includes(forbidden)) throw new Error(`refusing path containing ${forbidden}`);
}

let engineCommit = 'unknown';
try { engineCommit = execFileSync('git', ['-C', engineDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { /* not a git checkout */ }
const catalogMod = catalogFor(engineDir);
const parts = partitionCatalog(catalogMod.CATALOG);

function serverInfoFor(config, labels) {
  const caps = Object.fromEntries(labels.servers.map(s => [s.name, s.capabilities]));
  const info = {};
  for (const [name, spec] of Object.entries(config.mcpServers || {})) {
    let hit = null;
    if (spec.url) { try { hit = catalogMod.matchHost(new URL(spec.url).hostname); } catch (_) { hit = null; } }
    for (const arg of [spec.command, ...(spec.args || [])]) { if (!hit && arg && !String(arg).startsWith('-')) hit = catalogMod.matchIdentity(String(arg)); }
    info[name] = { capabilities: caps[name] || [], catalog: hit ? { id: hit.entry.id, role: hit.entry.role, citation: hit.entry.citation } : null };
  }
  return info;
}

const canon = config => JSON.stringify(config, Object.keys(config).sort());
const stableHash = obj => fnv(JSON.stringify(obj, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v)));

function planCases(split) {
  const { clean, injected, seed } = plan[split];
  const r = rng(seed);
  const cases = [];
  const seen = new Set();
  let guard = 0;
  while (cases.length < clean + injected && guard++ < (clean + injected) * 20) {
    const base = makeConfig(split, parts, r);
    const h = stableHash(base.config);
    if (seen.has(h)) continue;
    seen.add(h);
    const isInjected = cases.length >= clean;
    const item = { split, index: cases.length, client: base.client, scenario: base.scenario, dirs: base.dirs, clean: base.config, config: base.config, injection: null, hash: h };
    if (isInjected) { const inj = inject(base.config, split, r); item.config = inj.config; item.injection = inj.injection; }
    cases.push(item);
  }
  return cases;
}

async function labelCase(item) {
  const slot = `${item.split}-${item.hash}`;
  const scanned = await scanConfig({ engineDir, client: item.client, config: item.config, dirs: item.dirs, slot });
  if (scanned.error) return { item, dropped: 'scan_error', error: scanned.error };
  const labels = scanned.labels;
  let injectionChangedRules = false;
  if (item.injection) {
    const clean = await scanConfig({ engineDir, client: item.client, config: item.clean, dirs: item.dirs, slot });
    const sig = l => JSON.stringify(l.findings.map(f => [f.rule_id, f.severity, f.servers]));
    injectionChangedRules = !clean.labels || sig(clean.labels) !== sig(labels);
  }
  let fix = null;
  const needsFix = labels.findings.length > 0;
  if (needsFix) {
    fix = await fixAndRescan({ engineDir, client: item.client, config: item.config, dirs: item.dirs, before: labels, slot });
    // No edit at all means boppi fix had nothing safe to apply (manual only):
    // keep the case with an empty fix. An edit that fails the re-scan is dropped.
    if (!fix.ops.length) fix = null;
    else if (!fix.verdict.pass) return { item, dropped: 'fix_failed_rescan', verdict: fix.verdict };
  }
  const serverInfo = serverInfoFor(item.config, labels);
  const target = buildTarget({ labels, serverInfo, fix, injected: !!item.injection });
  const id = `${item.split}-${String(item.index).padStart(5, '0')}`;
  return {
    record: {
      id, split: item.split, client: item.client, scenario: item.scenario, injected: !!item.injection, injection: item.injection,
      injection_changed_rules: injectionChangedRules, config: item.config, dirs: item.dirs,
      labels: { max_severity: labels.max_severity, rule_ids: target.rule_ids, findings: labels.findings.map(f => ({ rule_id: f.rule_id, severity: f.severity, servers: f.servers })) },
      fix: fix ? { commands: fix.commands, ops: fix.ops, rescan: fix.verdict } : null,
      target, engine: { commit: engineCommit }, generator: GENERATOR_VERSION,
    },
  };
}

async function pool(items, fn, n) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      if (++done % 200 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }));
  return out;
}

// Refuse to write anything that looks like a real credential. Every value is
// generated from placeholders, so a hit means a template bug.
const SECRET_PATTERNS = /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abp]-[0-9A-Za-z-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY/;
function assertNoSecrets(text, where) {
  const hit = text.match(SECRET_PATTERNS);
  if (hit) throw new Error(`secret-like value in ${where}; refusing to write`);
}

const chat = rec => ({ id: rec.id, messages: [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userPrompt(rec.client, rec.config) },
  { role: 'assistant', content: JSON.stringify(rec.target) },
] });

fs.mkdirSync(outDir, { recursive: true });

// Probe: scan each benign-role row alone (scoped dir for file servers) and
// keep the rows the rules rate below high. Deterministic, local, no network.
async function probeBenign() {
  const rows = [...new Map(['train', 'dev'].flatMap(split => BENIGN_ROLES.flatMap(role => (parts[split][role] || []).map(row => [row.id, { row, role }])))).values()];
  const results = await pool(rows, async ({ row, role }) => {
    const spec = probeSpec(row);
    if (!spec) return null;
    const dirs = [];
    if (role === 'files') { spec.args = [...(spec.args || []), '/home/dev/projects/app']; dirs.push('/home/dev/projects/app'); }
    const res = await scanConfig({ engineDir, client: 'cursor', config: { mcpServers: { [shortName(row)]: spec } }, dirs, slot: `probe-${fnv(row.id)}` });
    return res.labels && (SEVERITY_RANK[res.labels.max_severity] ?? -1) < 3 ? row.id : null;
  }, concurrency);
  const ok = new Set(results.filter(Boolean));
  parts.benign = {};
  for (const split of ['train', 'dev']) {
    parts.benign[split] = {};
    for (const role of BENIGN_ROLES) parts.benign[split][role] = (parts[split][role] || []).filter(row => ok.has(row.id));
  }
  return { probed: rows.length, benign_rows: ok.size, by_role: Object.fromEntries(BENIGN_ROLES.map(role => [role, { train: parts.benign.train[role].length, dev: parts.benign.dev[role].length }])) };
}
const probe = await probeBenign();
process.stderr.write(`benign probe: ${JSON.stringify(probe)}\n`);

const devCases = planCases('dev');
const devHashes = new Set(devCases.map(c => c.hash));
const trainPlanned = planCases('train');
const trainCases = trainPlanned.filter(c => !devHashes.has(c.hash));
const manifest = { generator: GENERATOR_VERSION, engine: { dir_basename: path.basename(engineDir), commit: engineCommit }, plan, benign_probe: probe, dedupe_dropped_train: trainPlanned.length - trainCases.length, splits: {} };

for (const [split, cases] of [['dev', devCases], ['train', trainCases]]) {
  process.stderr.write(`${split}: labeling ${cases.length} configs with ${concurrency} workers\n`);
  const results = await pool(cases, labelCase, concurrency);
  const records = results.filter(x => x.record).map(x => x.record);
  const drops = {};
  for (const x of results) if (x.dropped) drops[x.dropped] = (drops[x.dropped] || 0) + 1;
  fs.writeFileSync(path.join(outDir, `${split}.dropped.jsonl`), results.filter(x => x.dropped).map(x => JSON.stringify({ split, index: x.item.index, scenario: x.item.scenario, reason: x.dropped, verdict: x.verdict || null, error: x.error || null, config: x.item.config })).join('\n') + '\n');
  const body = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  assertNoSecrets(body, `${split}.jsonl`);
  fs.writeFileSync(path.join(outDir, `${split}.jsonl`), body);
  fs.writeFileSync(path.join(outDir, `${split}.chat.jsonl`), records.map(r => JSON.stringify(chat(r))).join('\n') + '\n');
  const bySev = {};
  const byRule = {};
  for (const r of records) {
    bySev[r.labels.max_severity] = (bySev[r.labels.max_severity] || 0) + 1;
    for (const id of r.labels.rule_ids) byRule[id] = (byRule[id] || 0) + 1;
  }
  manifest.splits[split] = {
    planned: cases.length, kept: records.length, dropped: drops,
    injected: records.filter(r => r.injected).length, clean: records.filter(r => !r.injected).length,
    injection_changed_rules: records.filter(r => r.injection_changed_rules).length,
    with_fix: records.filter(r => r.fix && r.fix.ops.length).length,
    by_max_severity: bySev, by_rule: Object.fromEntries(Object.entries(byRule).sort()),
    benign: records.filter(r => (SEVERITY_RANK[r.labels.max_severity] ?? -1) < 3).length,
  };
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(JSON.stringify(manifest.splits, null, 2) + '\n');
