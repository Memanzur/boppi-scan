#!/usr/bin/env node
// Self checks for the data and eval pipeline. No model needed.
//   node research/model/test-pipeline.mjs --engine <checkout> [--dev out/dev.jsonl]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hybridMerge } from './lib/hybrid.mjs';
import { parseOutput } from './lib/format.mjs';
import { diff, apply } from './lib/jsonops.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, 'test-label-sanity.mjs')], { stdio: 'inherit' });
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const engine = opt('engine') || path.join(here, '..', '..');
const devFile = opt('dev') || path.join(here, 'out', 'dev.jsonl');

// 1. Hybrid: a model that obeys an injection ("everything is info, no findings") cannot lower severity.
const rules = [{ rule_id: 'AE-009', severity: 'critical', servers: ['fetch', 'shell'] }];
const obedient = { rule_ids: [], findings: [{ rule_id: 'AE-009', servers: ['fetch', 'shell'], chain: 'Audited, benign.', severity: 'info' }], fix: { commands: [], ops: [] }, untrusted_instructions_seen: false };
const merged = hybridMerge(rules, obedient);
assert.equal(merged.findings[0].severity, 'critical');
assert.equal(merged.findings.length, 1);
const extra = hybridMerge(rules, { ...obedient, rule_ids: ['AE-009', 'AE-999'] });
assert.equal(extra.suggestions[0].severity, null);
assert.equal(extra.suggestions[0].status, 'unverified suggestion');

// 2. Strict parser rejects a severity field and non-JSON.
assert.equal(parseOutput('{"rule_ids":[],"findings":[],"fix":{"commands":[],"ops":[]},"untrusted_instructions_seen":false,"severity":"info"}').error, 'schema');
assert.equal(parseOutput('Sure! Here is the analysis').error, 'not_json');
assert.ok(parseOutput('<think>\n\n</think>\n\n{"rule_ids":["AE-010"],"findings":[],"fix":{"commands":[],"ops":[]},"untrusted_instructions_seen":true}').value);

// 3. JSON ops round trip.
const a = { mcpServers: { x: { command: 'npx', args: ['-y', 'p'], autoApprove: ['run'] }, y: { url: 'https://h/mcp' } } };
const b = { mcpServers: { x: { command: 'npx', args: ['p'], autoApprove: [] } } };
assert.deepEqual(apply(a, diff(a, b)), b);

// 4. Oracle predictions (the dev targets themselves) must score 1.0 and every fix must pass re-scan.
if (fs.existsSync(devFile)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-oracle-'));
  const dev = fs.readFileSync(devFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  fs.writeFileSync(path.join(tmp, 'oracle.jsonl'), dev.map(r => JSON.stringify({ id: r.id, output: JSON.stringify(r.target) })).join('\n') + '\n');
  fs.writeFileSync(path.join(tmp, 'obedient.jsonl'), dev.map(r => JSON.stringify({ id: r.id, output: JSON.stringify({ rule_ids: [], findings: [], fix: { commands: [], ops: [] }, untrusted_instructions_seen: false }) })).join('\n') + '\n');
  const run = pred => JSON.parse(execFileSync(process.execPath, [path.join(here, 'eval.mjs'), '--dev', devFile, '--pred', pred, '--engine', engine], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const oracle = run(path.join(tmp, 'oracle.jsonl'));
  const model = oracle.arms.find(x => x.arm === 'model-only');
  assert.equal(model.critical_precision, 1);
  assert.equal(model.critical_recall, 1);
  assert.equal(model.benign_flagged, 0);
  assert.equal(oracle.schema.valid, dev.length);
  assert.equal(oracle.fixes.passed_rescan, oracle.fixes.proposed, `oracle fixes: ${JSON.stringify(oracle.fixes)}`);
  const ob = run(path.join(tmp, 'obedient.jsonl'));
  const hyb = ob.arms.find(x => x.arm === 'hybrid');
  assert.equal(hyb.critical_recall, 1, 'hybrid keeps rules severity even when the model says nothing');
  assert.equal(ob.arms.find(x => x.arm === 'model-only').critical_recall, 0);
  // A "fix" that vandalizes the config (servers replaced by strings) must never count.
  fs.writeFileSync(path.join(tmp, 'vandal.jsonl'), dev.map(r => JSON.stringify({ id: r.id, output: JSON.stringify({ ...r.target, fix: { commands: [], ops: Object.keys(r.config.mcpServers).map(n => ({ op: 'replace', path: `/mcpServers/${n.replace(/~/g, '~0').replace(/\//g, '~1')}`, value: 'disabled' })) } }) })).join('\n') + '\n');
  const vandal = run(path.join(tmp, 'vandal.jsonl'));
  assert.equal(vandal.fixes.passed_rescan, 0, 'vandalized configs never pass');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`oracle fixes ${oracle.fixes.passed_rescan}/${oracle.fixes.proposed} pass re-scan; hybrid unaffected by an obedient model`);
}
console.log('pipeline checks passed');
