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
    if (!fs.existsSync(resolved)) continue;
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
  const stamp = String(now).replace(/[:.]/g, '-');
  const tag = crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 8);
  return path.join(home, '.boppi', 'backups', `${path.basename(file)}.${tag}.${stamp}.bak`);
}

function undoManifestPath(home) {
  return path.join(home, '.boppi', 'fix-undo.json');
}

function insideDir(parent, file) {
  const root = path.resolve(parent);
  const resolved = path.resolve(file);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** One timestamped backup set. Commit writes ~/.boppi/fix-undo.json for --undo. */
function createBackupSet(home, now) {
  const files = [];
  return {
    capture(file) {
      const existing = files.find(entry => entry.original === file);
      if (existing) return existing;
      const mode = fs.statSync(file).mode & 0o777;
      const backup = backupPath(home, file, `${now}-${files.length}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(file, backup);
      fs.chmodSync(backup, 0o600);
      const entry = { original: file, backup, mode };
      files.push(entry);
      return entry;
    },
    commit() {
      if (!files.length) return null;
      const manifestPath = undoManifestPath(home);
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      const body = { createdAt: now, files };
      fs.writeFileSync(manifestPath, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
      return body;
    },
  };
}

/** Write the backup, then the edited config. Returns the backup path. */
function applyRemoval({ located, serverName, cwd, home, now }) {
  const set = createBackupSet(home, now);
  const entry = set.capture(located.file);
  const removed = deleteServer(located.json, serverName, cwd);
  if (!removed) throw new Error(`"${serverName}" was not found in ${located.file} at write time`);
  fs.writeFileSync(located.file, JSON.stringify(located.json, null, 2) + '\n');
  set.commit();
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
  const backups = path.join(home, '.boppi', 'backups');
  for (const entry of manifest.files) {
    if (!entry || typeof entry.original !== 'string' || typeof entry.backup !== 'string') {
      throw new Error('the backup set is incomplete');
    }
    if (!insideDir(backups, entry.backup)) throw new Error('a backup path is outside ~/.boppi/backups');
    if (!fs.existsSync(entry.backup)) throw new Error(`backup file is missing: ${path.basename(entry.backup)}`);
    fs.mkdirSync(path.dirname(entry.original), { recursive: true });
    fs.copyFileSync(entry.backup, entry.original);
    if (Number.isInteger(entry.mode)) fs.chmodSync(entry.original, entry.mode);
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
};
