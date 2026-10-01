#!/usr/bin/env node
// Picks the 50 packages to label by hand. Seeded, so the sample is reproducible from index.json alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEED = 20261001;
export const SAMPLE_SIZE = 50;

function mulberry32(seed) {
  return function next() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function samplePackages(packages, seed = SEED, size = SAMPLE_SIZE) {
  const pool = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  const rand = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size).sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus', 'index.json'), 'utf8'));
  const sample = samplePackages(index.packages).map(p => ({ name: p.name, version: p.version, contentHash: p.contentHash, root: path.join('corpus', 'packages', p.name, p.version), fileCount: p.fileCount }));
  fs.writeFileSync(path.join(HERE, 'labels-sample.json'), JSON.stringify({ seed: SEED, size: SAMPLE_SIZE, corpusBuiltAt: index.builtAt, packages: sample }, null, 2));
  process.stderr.write(`sampled ${sample.length} packages with seed ${SEED}\n`);
}
