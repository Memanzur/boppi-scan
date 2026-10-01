#!/usr/bin/env node
// Catalog baseline: what the shipped regex catalog says about each corpus package when it is
// configured as `{ command: 'npx', args: ['-y', name] }`. Writes catalog-baseline.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { inferCapabilities } = require(path.join(HERE, '..', '..', 'src', 'cli', 'knownServers.js'));
const { CAP_TO_CATEGORY } = require(path.join(HERE, '..', '..', 'src', 'cli', 'provider.js'));

/** Catalog categories for one package name, with the rule labels that produced them. */
export function catalogCategories(name) {
  // The server key in a real config is user-chosen; the package name is the only identity the
  // catalog can see here, so the key is a neutral placeholder.
  const inference = inferCapabilities('server', { command: 'npx', args: ['-y', name] }, { home: '/nonexistent' });
  const categories = {};
  for (const entry of inference.inferences) {
    for (const capability of entry.capabilities) {
      const category = CAP_TO_CATEGORY[capability];
      if (!category) continue;
      (categories[category] ||= []).push({ label: entry.label, matched: entry.matched });
    }
  }
  return categories;
}

function main() {
  const index = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus', 'index.json'), 'utf8'));
  const packages = index.packages.map(p => ({ name: p.name, version: p.version, categories: catalogCategories(p.name) }));
  const withAny = packages.filter(p => Object.keys(p.categories).length).length;
  fs.writeFileSync(path.join(HERE, 'catalog-baseline.json'), JSON.stringify({ corpusBuiltAt: index.builtAt, packages }, null, 2));
  process.stderr.write(`catalog matched ${withAny} of ${packages.length} packages\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
