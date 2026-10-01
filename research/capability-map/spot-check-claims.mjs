#!/usr/bin/env node
// Picks 20 claims deterministically and verifies each cited evidence line against the extracted package on disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaim } from './claims-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const claims = JSON.parse(fs.readFileSync(path.join(HERE, 'claims.json'), 'utf8')).claims;
const index = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus', 'index.json'), 'utf8'));
const hashes = new Map(index.packages.map(p => [`${p.name}@${p.version}`, p]));
const step = Math.max(1, Math.floor(claims.length / 20));
const picked = claims.filter((_, i) => i % step === 0).slice(0, 20);
let bad = 0;
for (const claim of picked) {
  const errors = validateClaim(claim);
  const entry = hashes.get(`${claim.subject}@${claim.subjectVersion}`);
  const problems = [...errors];
  if (!entry) problems.push('subject not in corpus index');
  else {
    if (entry.contentHash !== claim.evidence[0].contentHash) problems.push('contentHash differs from index');
    if (entry.registryIntegrity !== claim.evidence[0].registryIntegrity) problems.push('registryIntegrity differs from index');
    for (const e of claim.evidence) {
      const file = path.join(HERE, 'corpus', 'packages', claim.subject, claim.subjectVersion, e.file);
      if (!fs.existsSync(file)) { problems.push(`${e.file} missing (corpus not extracted?)`); continue; }
      const line = (fs.readFileSync(file, 'utf8').split('\n')[e.line - 1] || '').trim();
      if (!line.includes(e.text.slice(0, 40)) && !e.text.includes(line.slice(0, 40))) problems.push(`${e.file}:${e.line} text differs`);
    }
  }
  if (problems.length) bad++;
  console.log(`${problems.length ? '✗' : '✓'} ${claim.id} ${claim.subject}@${claim.subjectVersion} ${claim.capability} [${claim.status}] ${claim.evidence.length} evidence${problems.length ? ' :: ' + problems.join('; ') : ''}`);
}
console.log(`\n${picked.length - bad} of ${picked.length} spot-checked claims verified`);
process.exitCode = bad ? 1 : 0;
