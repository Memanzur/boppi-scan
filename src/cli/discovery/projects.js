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

  // A candidate that exists is always reported. Discovery follows a symlink
  // to a real file. A path we cannot use is still reported so the scan is
  // incomplete instead of looking empty.
  function considerFile(file, kind) {
    if (found.length >= MAX_FILES) return;
    let listed;
    try { listed = fs.lstatSync(file); } catch (error) {
      if (error.code !== 'ENOENT') found.push({ path: file, kind: 'dropped', reason: 'unreadable' });
      return;
    }
    let identity = file;
    try { identity = fs.realpathSync(file); } catch (_) { identity = file; }
    if (seen.has(identity)) return;
    seen.add(identity);
    found.push({ path: file, kind });
  }

  function walk(dir, depth) {
    if (visits >= MAX_DIRS || found.length >= MAX_FILES) return;
    visits += 1;
    considerFile(path.join(dir, '.mcp.json'), 'mcp');
    considerFile(path.join(dir, '.cursor', 'mcp.json'), 'cursor');
    if (depth >= MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'ELOOP') found.push({ path: dir, kind: 'blocked' });
      return;
    }
    for (const entry of entries) {
      if (visits >= MAX_DIRS || found.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) {
        const linked = path.join(dir, entry.name);
        let linkedDir = true;
        try { linkedDir = fs.statSync(linked).isDirectory(); } catch (_) { linkedDir = true; }
        if (linkedDir && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          found.push({ path: linked, kind: 'dropped', reason: 'symlinked directory' });
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  for (const parts of CODE_ROOTS) {
    const root = path.join(home, ...parts);
    let stat;
    try { stat = fs.lstatSync(root); } catch (_) { continue; }
    if (stat.isSymbolicLink()) {
      found.push({ path: root, kind: 'dropped', reason: 'symlinked directory' });
      continue;
    }
    if (!stat.isDirectory()) continue;
    walk(root, 0);
  }
  return found;
}

module.exports = { walkProjectConfigs, CODE_ROOTS, SKIP_DIRS, MAX_DEPTH, MAX_DIRS, MAX_FILES };
