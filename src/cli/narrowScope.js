/**
 * narrow_scope: point a server's broad directory argument (the whole home
 * directory, a system root, a dotfile or secrets folder) at a folder inside
 * it, so the server keeps working on what it needs and loses the rest.
 * Directory arguments are found the way knownServers finds them; grades come
 * from toolCategories.scopeOf, so the preview, the rescan and the grade all
 * read scope the same way. Raw paths stay on this machine: the edit that
 * predictions, exports and pushes carry names directories by fingerprint.
 */
'use strict';
const fs = require('fs');
const { scopeOf, SCOPE_LABEL } = require('./toolCategories');
const evidenceIdentity = require('./evidenceIdentity');
const { pathFingerprint } = require('../engine/localMcpScanner');
const { samePath, isInside, DIRECTORY_ARG, expandHomeArg } = require('./platform');

const BROAD = new Set(['system', 'home', 'secrets']);
const isDirectory = candidate => { try { return fs.statSync(candidate).isDirectory(); } catch (_) { return false; } };
const real = candidate => { try { return fs.realpathSync(candidate); } catch (_) { return null; } };

/** The directory arguments of one raw server entry that grade as broad, with their index in args. */
function broadDirectories(entry, home) {
  const args = entry && Array.isArray(entry.args) ? entry.args : [];
  return args.flatMap((arg, index) => {
    if (typeof arg !== 'string' || !DIRECTORY_ARG.test(arg)) return [];
    const absolute = expandHomeArg(arg, home);
    if (!isDirectory(absolute)) return [];
    const grade = scopeOf(absolute, home);
    return BROAD.has(grade) ? [{ index, arg, grade, label: SCOPE_LABEL[grade] }] : [];
  });
}

/**
 * Why `to` cannot replace `from`, or null. The target must be an existing
 * directory strictly inside `from` once symlinks are resolved, and must not
 * itself grade as broad: narrowing the home directory to ~/.ssh is not narrower.
 */
function targetProblem({ from, to, home }) {
  const fromReal = real(expandHomeArg(from, home));
  if (!isDirectory(to)) return `${to} is not an existing directory`;
  const toReal = real(to);
  if (!fromReal || !toReal) return 'the directories could not be resolved';
  if (samePath(toReal, fromReal)) return `${to} is the directory the server already has`;
  if (!isInside(toReal, fromReal)) return `${to} is not inside the directory it would replace`;
  const grade = scopeOf(toReal, real(home) || home);
  if (BROAD.has(grade)) return `${to} is ${SCOPE_LABEL[grade]}, which is not narrower`;
  return null;
}

/** A copy of the raw entry with args[index] replaced by `to`. */
function narrowedEntry(entry, index, to) {
  const args = entry.args.slice();
  args[index] = to;
  return { ...entry, args };
}

/**
 * The edit as predictions, exports and the manifest record it: directories by
 * fingerprint, plus the digest of the entry the rescan must find (the same
 * digest verify reads from mergedServers), so grading can tell the edit landed.
 */
function describeEdit({ server, entry, index, to }) {
  return {
    action: 'narrow_scope',
    server,
    argIndex: index,
    from: pathFingerprint(entry.args[index]),
    to: pathFingerprint(to),
    expectedIdentity: evidenceIdentity.digest('moved-server', narrowedEntry(entry, index, to)),
  };
}

module.exports = { BROAD, broadDirectories, targetProblem, narrowedEntry, describeEdit };
