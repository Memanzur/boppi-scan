#!/usr/bin/env node
// Turns inspector output into claims.json. Every claim carries the evidence lines, the package
// identity, both hashes, and the inspection date. Status is earned through the lifecycle rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaim, promote } from './claims-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function main() {
  const output = JSON.parse(fs.readFileSync(path.join(HERE, 'inspector-output.json'), 'utf8'));
  const claims = [];
  for (const pkg of output.packages) {
    for (const [capability, found] of Object.entries(pkg.categories).sort(([a], [b]) => a.localeCompare(b))) {
      const evidence = found.evidence.map(e => ({
        kind: 'inspector', file: e.file, line: e.line, text: e.text, signalKind: e.kind,
        contentHash: pkg.contentHash, registryIntegrity: pkg.registryIntegrity, observedAt: output.inspectedAt,
      }));
      const candidate = createClaim({
        subject: pkg.name, subjectVersion: pkg.version, capability, source: 'inspector', evidence,
        supporting: 1, createdAt: output.inspectedAt,
        strength: found.strength, signals: found.signals, inspectorVersion: output.inspectorVersion, signalTableHash: output.signalTableHash,
      });
      claims.push(promote(candidate, { now: output.inspectedAt }));
    }
  }
  const byStatus = {};
  for (const c of claims) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  fs.writeFileSync(path.join(HERE, 'claims.json'), JSON.stringify({ generatedAt: output.inspectedAt, inspectorVersion: output.inspectorVersion, signalTableHash: output.signalTableHash, claimCount: claims.length, byStatus, claims }, null, 2));
  process.stderr.write(`wrote ${claims.length} claims: ${JSON.stringify(byStatus)}\n`);
}

main();
