#!/usr/bin/env node
// Merges labeler output into labels.json and checks every evidence citation against the file on disk.
//   node merge-labels.mjs part1.json part2.json ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED } from './sample-labels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAXONOMY = new Set(['read_files','write_files','delete_files','read_email','send_email','read_calendar','modify_calendar','read_source_code','modify_source_code','access_customer_data','access_financial_data','access_health_data','access_hr_data','execute_code','run_shell_commands','browse_internet','call_external_api','send_external_message','create_or_modify_records','make_purchase','access_credentials','access_environment_variables','browser_automation','access_production_system','untrusted_external_content']);

const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'labels-sample.json'), 'utf8'));
const expected = new Map(sample.packages.map(p => [p.name, p]));
const merged = new Map();
const problems = [];

for (const file of process.argv.slice(2)) {
  const part = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const pkg of part.packages) {
    const want = expected.get(pkg.name);
    if (!want) { problems.push(`${pkg.name}: not in the sample`); continue; }
    if (pkg.version !== want.version) problems.push(`${pkg.name}: version ${pkg.version} differs from sampled ${want.version}`);
    const root = path.join(HERE, want.root);
    const categories = [];
    const seen = new Set();
    for (const entry of pkg.categories || []) {
      if (!TAXONOMY.has(entry.category)) { problems.push(`${pkg.name}: category ${entry.category} not in taxonomy`); continue; }
      if (seen.has(entry.category)) { problems.push(`${pkg.name}: duplicate ${entry.category}`); continue; }
      const e = entry.evidence || {};
      const full = path.join(root, e.file || '');
      let verified = false;
      if (e.file && Number.isInteger(e.line) && fs.existsSync(full)) {
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        const actual = (lines[e.line - 1] || '').trim();
        verified = actual.length > 0 && (actual.includes(String(e.text).trim().slice(0, 60)) || String(e.text).trim().includes(actual.slice(0, 60)));
        if (!verified) problems.push(`${pkg.name}: ${entry.category} evidence ${e.file}:${e.line} does not match the file (line reads "${actual.slice(0, 80)}")`);
      } else problems.push(`${pkg.name}: ${entry.category} evidence missing or file not found (${e.file}:${e.line})`);
      seen.add(entry.category);
      categories.push({ category: entry.category, evidence: { file: e.file, line: e.line, text: String(e.text || '').trim().slice(0, 200) }, evidenceVerified: verified, ...(entry.note ? { note: entry.note } : {}) });
    }
    merged.set(pkg.name, { name: pkg.name, version: want.version, contentHash: want.contentHash, serverShape: pkg.serverShape || 'other', unknown: pkg.unknown === true, categories: categories.sort((a, b) => a.category.localeCompare(b.category)), notes: pkg.notes || '' });
  }
}
for (const name of expected.keys()) if (!merged.has(name)) problems.push(`${name}: no label`);

const packages = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
const output = { reviewer: 'claude', humanReviewed: false, seed: SEED, corpusBuiltAt: sample.corpusBuiltAt, labeledAt: new Date().toISOString(), method: 'LABELING.md', packageCount: packages.length, unknownCount: packages.filter(p => p.unknown).length, packages };
fs.writeFileSync(path.join(HERE, 'labels.json'), JSON.stringify(output, null, 2));
for (const p of problems) process.stderr.write(`problem: ${p}\n`);
process.stderr.write(`merged ${packages.length} labels, ${output.unknownCount} unknown, ${problems.length} problems\n`);
process.exitCode = problems.some(p => /not in taxonomy|no label|not in the sample/.test(p)) ? 1 : 0;
