/**
 * boppi fix: apply one remove_server edit to the config file that holds the
 * server, with a backup first, then rescan and grade the prediction.
 * The command is the approval. On a terminal it also asks; --yes skips that.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** The scanned file and key path that hold a server for one client, or null. */
function locateServer(client, descriptor, serverName) {
  const discovered = (client.files || []).filter(file => typeof file.extract === 'function');
  const files = discovered.length ? discovered : (descriptor && descriptor.files) || [];
  for (const file of files) {
    const resolved = path.resolve(file.path);
    let linkStat;
    try { linkStat = fs.lstatSync(resolved); } catch (_) { continue; }
    if (linkStat.isSymbolicLink()) {
      try {
        const raw = fs.readFileSync(resolved, 'utf8');
        const parsed = file.parse ? file.parse(raw) : JSON.parse(raw);
        const servers = file.extract(parsed) || {};
        if (Object.prototype.hasOwnProperty.call(servers, serverName)) return { file: resolved, scope: file.scope, symlink: true };
      } catch (_) { /* an unreadable link is not a candidate */ }
      continue;
    }
    if (!linkStat.isFile()) continue;
    const format = file.format || 'json';
    let parsed;
    try {
      const raw = fs.readFileSync(resolved, 'utf8');
      parsed = file.parse ? file.parse(raw) : JSON.parse(raw);
    } catch (_) { continue; }
    const servers = file.extract(parsed) || {};
    if (!Object.prototype.hasOwnProperty.call(servers, serverName)) continue;
    if (format !== 'json') return { file: resolved, scope: file.scope, unsupportedFormat: format };
    return { file: resolved, scope: file.scope, json: parsed };
  }
  return null;
}

/** Delete the server from every mcpServers block the client reads in this file. Returns how many blocks changed. */
function deleteFromMap(map, serverName) {
  if (map && typeof map === 'object' && !Array.isArray(map) && Object.prototype.hasOwnProperty.call(map, serverName)) {
    delete map[serverName];
    return 1;
  }
  return 0;
}

function deleteServer(json, serverName, cwd) {
  let removed = 0;
  removed += deleteFromMap(json.mcpServers, serverName);
  removed += deleteFromMap(json.servers, serverName);
  removed += deleteFromMap(json.context_servers, serverName);
  if (json.mcp && typeof json.mcp === 'object') removed += deleteFromMap(json.mcp.servers, serverName);
  const project = json.projects && cwd && json.projects[cwd];
  if (project && project.mcpServers && typeof project.mcpServers === 'object' && Object.prototype.hasOwnProperty.call(project.mcpServers, serverName)) {
    delete project.mcpServers[serverName];
    removed += 1;
  }
  return removed;
}

function backupPath(home, file, now) {
  const stamp = String(now).replace(/[^A-Za-z0-9-]+/g, '-');
  const tag = crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 8);
  return path.join(home, '.boppi', 'backups', `${path.basename(file)}.${tag}.${stamp}.bak`);
}

function undoManifestPath(home) {
  return path.join(home, '.boppi', 'fix-undo.json');
}

function insideDir(parent, file) {
  const root = path.resolve(parent);
  const resolved = path.resolve(file);
  if (process.platform === 'win32') {
    const left = root.toLowerCase();
    const right = resolved.toLowerCase();
    return right === left || right.startsWith(left + path.sep);
  }
  return resolved === root || resolved.startsWith(root + path.sep);
}

function noFollowFlag() {
  return fs.constants.O_NOFOLLOW || 0;
}

/** Refuse a symlink at this path. Directory symlinks above it are the path the user named. */
function assertRegularFile(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`refusing to edit ${path.basename(file)} because it is not a regular file`);
  }
  return stat;
}

function ensurePrivateDir(dir) {
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(parent, 0o700); } catch (_) { /* the parent may already be in use */ }
  let stat;
  try { stat = fs.lstatSync(dir); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.mkdirSync(dir, { mode: 0o700 });
    stat = fs.lstatSync(dir);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('refusing to use a symlinked backup directory');
  }
  fs.chmodSync(dir, 0o700);
  return dir;
}

function readRegular(file) {
  const before = assertRegularFile(file);
  if (!before) throw new Error(`refusing to read a missing file: ${path.basename(file)}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const now = fs.fstatSync(fd);
    if (now.ino !== before.ino || now.dev !== before.dev) throw new Error(`refusing to read ${path.basename(file)} because it changed`);
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Replace a regular file without following a symlink and without updating other hard links. */
function replaceRegularFile(file, text, mode) {
  const before = assertRegularFile(file);
  if (!before) throw new Error(`refusing to edit a missing file: ${path.basename(file)}`);
  try { fs.accessSync(file, fs.constants.W_OK); } catch (_) {
    const error = new Error(`EACCES: permission denied, open '${file}'`);
    error.code = 'EACCES';
    throw error;
  }
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.boppi-${crypto.randomBytes(8).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, mode & 0o777);
  try {
    fs.writeFileSync(fd, text);
    fs.fchmodSync(fd, mode & 0o777);
  } finally {
    fs.closeSync(fd);
  }
  try {
    const again = assertRegularFile(file);
    if (!again || again.ino !== before.ino || again.dev !== before.dev) {
      throw new Error(`refusing to edit ${path.basename(file)} because it changed`);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function chmodNoFollow(file, mode) {
  const before = assertRegularFile(file);
  if (!before) throw new Error(`refusing to change the mode of a missing file: ${path.basename(file)}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const now = fs.fstatSync(fd);
    if (now.ino !== before.ino || now.dev !== before.dev) throw new Error(`refusing to change the mode of ${path.basename(file)} because it changed`);
    fs.fchmodSync(fd, mode & 0o777);
  } finally {
    fs.closeSync(fd);
  }
}

function undoKeyPath(home) {
  return path.join(home, '.boppi', 'undo-key');
}

function loadUndoKey(home) {
  const file = undoKeyPath(home);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch (_) { /* first backup set */ }
  const key = crypto.randomBytes(32).toString('hex');
  ensurePrivateDir(path.join(home, '.boppi', 'backups'));
  fs.writeFileSync(file, key + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) { /* the mode option already requested 600 */ }
  return key;
}

function canonicalManifest(body) {
  const files = (body.files || []).map(entry => ({ original: entry.original, backup: entry.backup, mode: entry.mode }));
  return JSON.stringify({ createdAt: body.createdAt, files });
}

function signManifest(body, key) {
  const clean = { createdAt: body.createdAt, files: body.files };
  const mac = crypto.createHmac('sha256', key).update(canonicalManifest(clean)).digest('hex');
  return { ...clean, mac };
}

function manifestIsSigned(body, key) {
  if (!body || typeof body.mac !== 'string') return false;
  const expect = crypto.createHmac('sha256', key).update(canonicalManifest(body)).digest('hex');
  const left = Buffer.from(body.mac);
  const right = Buffer.from(expect);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** One timestamped backup set. Commit writes ~/.boppi/fix-undo.json for --undo. */
function createBackupSet(home, now) {
  const files = [];
  return {
    capture(file) {
      const existing = files.find(entry => entry.original === file);
      if (existing) return existing;
      const before = assertRegularFile(file);
      if (!before) throw new Error(`refusing to back up a missing file: ${path.basename(file)}`);
      const mode = before.mode & 0o777;
      const backup = backupPath(home, file, `${now}-${files.length}`);
      ensurePrivateDir(path.dirname(backup));
      if (!insideDir(path.join(home, '.boppi', 'backups'), backup)) {
        throw new Error('refusing to write a backup outside ~/.boppi/backups');
      }
      const data = readRegular(file);
      const fd = fs.openSync(backup, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try {
        fs.writeFileSync(fd, data);
        fs.fchmodSync(fd, 0o600);
      } finally {
        fs.closeSync(fd);
      }
      const entry = { original: file, backup, mode };
      files.push(entry);
      return entry;
    },
    commit() {
      if (!files.length) return null;
      const manifestPath = undoManifestPath(home);
      ensurePrivateDir(path.join(home, '.boppi', 'backups'));
      const body = signManifest({ createdAt: now, files }, loadUndoKey(home));
      fs.writeFileSync(manifestPath, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
      try { fs.chmodSync(manifestPath, 0o600); } catch (_) { /* newly created files already request 600 */ }
      return body;
    },
  };
}

/** Write the backup, then the edited config. Returns the backup path. */
function applyRemoval({ located, serverName, cwd, home, now }) {
  if (located.symlink) throw new Error(`refusing to edit ${path.basename(located.file)} because it is not a regular file`);
  const set = createBackupSet(home, now);
  const entry = set.capture(located.file);
  const removed = deleteServer(located.json, serverName, cwd);
  if (!removed) throw new Error(`"${serverName}" was not found in ${path.basename(located.file)} at write time`);
  set.commit();
  const mode = fs.lstatSync(located.file).mode & 0o777;
  replaceRegularFile(located.file, JSON.stringify(located.json, null, 2) + '\n', mode);
  return entry.backup;
}

/** Restore the last backup set. Returns the manifest, or null when there is none. */
function undoLast(home) {
  const manifestPath = undoManifestPath(home);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length) return null;
  if (!manifestIsSigned(manifest, loadUndoKey(home))) throw new Error('the backup set was modified');
  const backups = path.join(home, '.boppi', 'backups');
  const backupStat = fs.lstatSync(backups);
  if (backupStat.isSymbolicLink() || !backupStat.isDirectory()) throw new Error('refusing to use a symlinked backup directory');
  for (const entry of manifest.files) {
    if (!entry || typeof entry.original !== 'string' || typeof entry.backup !== 'string') {
      throw new Error('the backup set is incomplete');
    }
    if (!insideDir(backups, entry.backup)) throw new Error('a backup path is outside ~/.boppi/backups');
    const backupReal = fs.realpathSync(entry.backup);
    const rootReal = fs.realpathSync(backups);
    if (backupReal !== rootReal && !backupReal.startsWith(rootReal + path.sep)) throw new Error('a backup path is outside ~/.boppi/backups');
    const backupInfo = fs.lstatSync(entry.backup);
    if (backupInfo.isSymbolicLink() || !backupInfo.isFile()) throw new Error('a backup is not a regular file');
    const parent = path.dirname(entry.original);
    let parentInfo;
    try { parentInfo = fs.lstatSync(parent); } catch (_) {
      throw new Error(`refusing to create a new directory for ${path.basename(entry.original)}`);
    }
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new Error(`refusing to restore ${path.basename(entry.original)} through a symlink`);
    const data = readRegular(entry.backup);
    const mode = Number.isInteger(entry.mode) ? entry.mode : 0o600;
    const existing = assertRegularFile(entry.original);
    if (existing) replaceRegularFile(entry.original, data, mode);
    else {
      const fd = fs.openSync(entry.original, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag(), mode & 0o777);
      try {
        fs.writeFileSync(fd, data);
        fs.fchmodSync(fd, mode & 0o777);
      } finally {
        fs.closeSync(fd);
      }
    }
  }
  return manifest;
}

function confirm(question) {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, answer => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
  });
}

/** y, n, s, or a. Anything else, including a blank line, skips the fix. */
function parseChoice(answer) {
  const text = String(answer || '').trim().toLowerCase();
  if (text === 'y' || text === 'yes') return 'yes';
  if (text === 'a' || text === 'all') return 'all';
  if (text === 'n' || text === 'no' || text === 's' || text === 'skip') return 'skip';
  return 'skip';
}

function askChoice(question) {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, answer => { rl.close(); resolve(parseChoice(answer)); });
  });
}

module.exports = {
  locateServer, deleteServer, applyRemoval, backupPath, confirm, createBackupSet, undoLast, parseChoice, askChoice, undoManifestPath,
  replaceRegularFile, chmodNoFollow, assertRegularFile,
};
