#!/usr/bin/env node
/**
 * Prove what the npm package ships: `npm pack --dry-run --json` may list only
 * bin/, src/, README.md, LICENSE and package.json; never tests, docs,
 * scripts, fixtures, dotfiles or source maps. Exit 1 naming any other file.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { disallowedPackFiles } from './layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status !== 0) { process.stderr.write(`check-pack: npm pack --dry-run failed: ${result.stderr}\n`); process.exit(1); }
const files = JSON.parse(result.stdout)[0].files.map(f => f.path);
const bad = disallowedPackFiles(files);
if (bad.length) { process.stderr.write(`check-pack: the npm package would ship ${bad.length} file(s) it must not: ${bad.join(', ')}\n`); process.exit(1); }
process.stdout.write(`check-pack: OK, ${files.length} files, all under bin/ or src/, or README.md, LICENSE, package.json\n`);
