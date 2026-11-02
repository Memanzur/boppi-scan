/**
 * Bounded walk of common code folders for project MCP configs.
 * Depth is two directory levels under each root (Projects/repo and
 * Projects/org/repo). node_modules and other dependency directories are not entered.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.next', 'out', 'coverage',
  '.venv', 'venv', '__pycache__', '.cache', 'Pods', '.turbo', '.yarn', 'bower_components',
  '.hg', '.svn', '.idea', 'Library', 'AppData',
]);

const CODE_ROOTS = Object.freeze([
  ['Projects'], ['Developer'], ['dev'], ['code'], ['src'], ['repos'], ['source'],
  ['work'], ['github'], ['workspace'], ['GitHub'],
  ['Documents', 'GitHub'],
]);

const MAX_DIRS = 800;
const MAX_FILES = 80;
const MAX_DEPTH = 2;

function walkProjectConfigs(home) {
  const found = [];
  let visits = 0;
  const seen = new Set();

  function considerFile(file, kind) {
    if (found.length >= MAX_FILES) return;
    let resolved;
    try { resolved = fs.realpathSync(file); } catch (_) { return; }
    const root = fs.realpathSync(home);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
    if (seen.has(resolved)) return;
    let stat;
    try { stat = fs.lstatSync(file); } catch (_) { return; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) return;
    seen.add(resolved);
    found.push({ path: file, kind });
  }

  function walk(dir, depth) {
    if (visits >= MAX_DIRS || found.length >= MAX_FILES) return;
    visits += 1;
    considerFile(path.join(dir, '.mcp.json'), 'mcp');
    considerFile(path.join(dir, '.cursor', 'mcp.json'), 'cursor');
    if (depth >= MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (visits >= MAX_DIRS || found.length >= MAX_FILES) return;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  for (const parts of CODE_ROOTS) {
    const root = path.join(home, ...parts);
    let stat;
    try { stat = fs.lstatSync(root); } catch (_) { continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    walk(root, 0);
  }
  return found;
}

module.exports = { walkProjectConfigs, CODE_ROOTS, SKIP_DIRS, MAX_DEPTH, MAX_DIRS, MAX_FILES };
