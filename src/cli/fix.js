/**
 * boppi fix primitives: locate the file that holds a server, delete the
 * entry, keep a backup, and record every fix in a manifest that rollback
 * reads. remediate.js sequences these into stages; boppi.js only dispatches.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateConfigShape } = require('./configFiles');

const CLIENTS = [require('./discovery/claudeDesktop'), require('./discovery/claudeCode'), require('./discovery/cursor'), require('./discovery/codex')];
const codex = require('./discovery/codex');
const toml = require('./discovery/toml');
const MANIFEST_VERSION = 1;

/** The client descriptors a scan with these options reads: one explicit file, or every known client location. */
function descriptorsFor(options) {
  if (options.config) {
    // A Codex CLI file is TOML; every other explicit file is JSON.
    const isToml = options.source === 'codex' && /\.toml$/i.test(options.config);
    return [{
      clientKey: options.source, label: `Explicit config (${options.source})`, source: options.source,
      ...(isToml ? { manualEdit: codex.MANUAL_EDIT } : {}),
      files: [isToml
        ? { path: path.resolve(options.config), scope: 'explicit', format: 'toml', blocks: [{ keyPath: ['mcp_servers'], scope: 'explicit' }], map: codex.serverShape, evidence: codex.fileEvidence }
        : { path: path.resolve(options.config), scope: 'explicit', blocks: [{ keyPath: ['mcpServers'], scope: 'explicit' }] }],
    }];
  }
  return CLIENTS.map(m => m.locate({ home: options.home, cwd: options.cwd, platform: options.platform, managedDir: options.managedDir || null, codexManagedDir: options.codexManagedDir || null, cursorEnterpriseDir: options.cursorEnterpriseDir || null }));
}

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** The plain object at keyPath, or null when any step is missing or not an object. */
function objectAt(json, keyPath) {
  let node = json;
  for (const key of keyPath) {
    if (!isObject(node) || !hasOwn(node, key)) return null;
    node = node[key];
  }
  return isObject(node) ? node : null;
}

function unreadableReason(error, format) {
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'permission denied';
  if (error.code === 'EISDIR') return 'this is a directory, not a config file';
  if (format === 'toml') return 'invalid TOML';
  return error.message === 'invalid_config_shape' ? 'unsupported configuration shape' : 'invalid JSON';
}

/** Parse a discovered file by its declared format; JSON unless the locator says TOML. */
function parseConfig(file, text) { return file.format === 'toml' ? toml.parse(text) : JSON.parse(text); }

/**
 * Read every file one client descriptor names, in order, and list each
 * server with the label scans and plans use, its name in the file, and the
 * exact key path that holds it. A name an earlier block already used is
 * labeled with that block's scope, so no entry is dropped. Discovery and
 * every write path go through here, so a label resolves to the entry it was
 * given to. overrides maps a resolved path to parsed contents to read in
 * place of that file, so a rollback can label the entries of a backup.
 * A TOML file (Codex CLI) is read the same way: `map` turns each table into
 * the common server shape and `evidence` adds recorded values to its entry.
 */
function readClient(descriptor, cwd, overrides = new Map()) {
  const files = [], servers = [], documents = new Map(), taken = new Set(), seen = new Set();
  for (const file of descriptor.files) {
    const resolved = path.resolve(file.path);
    if (seen.has(resolved)) continue; // user and project config can be the same file
    seen.add(resolved);
    const entry = { path: resolved, scope: file.scope, status: 'not_found', serverCount: 0, servers: [], ...(file.format ? { format: file.format } : {}) };
    files.push(entry);
    if (!overrides.has(resolved) && !fs.existsSync(resolved)) continue;
    let json;
    try {
      json = overrides.has(resolved) ? overrides.get(resolved) : parseConfig(file, fs.readFileSync(resolved, 'utf8'));
      if (file.format !== 'toml') validateConfigShape(json, { source: descriptor.source, cwd });
    } catch (error) {
      entry.status = 'unreadable';
      entry.reason = unreadableReason(error, file.format);
      continue;
    }
    entry.status = 'found';
    documents.set(resolved, json);
    // Values the locator records beyond the server entries (policy values, counts); never command or secret text.
    if (file.evidence) Object.assign(entry, file.evidence(json));
    for (const block of file.blocks) {
      for (const [name, raw] of Object.entries(objectAt(json, block.keyPath) || {})) {
        const server = file.map ? file.map(raw) : raw;
        if (server === null) continue;
        let label = name;
        for (let n = 2; taken.has(label); n++) label = n === 2 ? `${name} (${block.scope})` : `${name} (${block.scope} ${n})`;
        taken.add(label);
        entry.servers.push(label);
        if (label !== name) (entry.renamed = entry.renamed || []).push({ from: name, to: label });
        servers.push({ label, name, file: resolved, scope: file.scope, keyPath: [...block.keyPath, name], server, ...(file.format ? { format: file.format } : {}) });
      }
    }
    entry.serverCount = entry.servers.length;
  }
  return { files, servers, documents };
}

/**
 * The file, key path and name in the file that hold the server a scan
 * labeled `label`, read from the files as they are now, or null. labels maps
 * every key path in that file to its scan label, so a preview can sanitize
 * each entry with its own record. overrides is passed to readClient.
 */
function locateServer(descriptor, label, cwd, overrides) {
  const { servers, documents } = readClient(descriptor, cwd, overrides);
  const found = servers.find(s => s.label === label);
  // Boppi edits only JSON. A server in a TOML file is never located, so no write path can touch it; manualEdit explains why.
  if (!found || found.format === 'toml') return null;
  const labels = new Map(servers.filter(s => s.file === found.file).map(s => [JSON.stringify(s.keyPath), s.label]));
  return { file: found.file, scope: found.scope, json: documents.get(found.file), name: found.name, keyPath: found.keyPath, labels };
}

/**
 * Why a server cannot be removed by boppi fix: it lives in a file Boppi does
 * not edit (TOML). Returns { file, reason } or null when fix can proceed.
 */
function manualEdit(client, descriptor, serverName) {
  const holder = (client.files || []).find(f => f.status === 'found' && f.format === 'toml' && (f.servers || []).includes(serverName));
  if (!holder) return null;
  return { file: holder.path, reason: (descriptor && descriptor.manualEdit) || codex.MANUAL_EDIT };
}

/** Delete the one entry at keyPath. Returns whether it was there. */
function deleteAt(json, keyPath) {
  const parent = objectAt(json, keyPath.slice(0, -1));
  const name = keyPath[keyPath.length - 1];
  if (!parent || !hasOwn(parent, name)) return false;
  delete parent[name];
  return true;
}

/** A key path as the preview prints it: mcpServers."x" or projects["/repo"].mcpServers."x". */
function renderKeyPath(keyPath) {
  return keyPath.map((key, index) => {
    if (index === keyPath.length - 1) return `.${JSON.stringify(key)}`;
    if (keyPath[index - 1] === 'projects') return `[${JSON.stringify(key)}]`;
    return index ? `.${key}` : key;
  }).join('');
}

/** Read a config file only if it is a regular file, never through a symlink: { regularFile, bytes, mode } or { regularFile: false, failureCode }. */
function openRegular(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch (error) {
    if (error.code === 'ENOENT') return { regularFile: false, failureCode: 'file_missing' };
    if (error.code === 'EACCES' || error.code === 'EPERM') return { regularFile: false, failureCode: 'permission_denied' };
    return { regularFile: false, failureCode: 'not_regular_file' };
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || fs.lstatSync(file).isSymbolicLink()) return { regularFile: false, failureCode: 'not_regular_file' };
    return { regularFile: true, bytes: fs.readFileSync(fd), mode: stat.mode & 0o777 };
  } finally { fs.closeSync(fd); }
}

function lockPath(home, targetFile) { return path.join(home, '.boppi', 'locks', `${targetFile.replace(/[^A-Za-z0-9_]/g, '_')}.lock`); }

/** Take the per-file edit lock shared by fix, rollback and the connector; returns a release function, or null while another live process holds it. targetFile is the file's path fingerprint. */
function acquireLock(home, targetFile) {
  const file = lockPath(home, targetFile);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, `${process.pid}\n`, { mode: 0o600, flag: 'wx' }); return () => fs.rmSync(file, { force: true }); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      let alive = true;
      try { process.kill(pid, 0); } catch (killError) { alive = killError.code !== 'ESRCH'; }
      if (alive || !Number.isInteger(pid)) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fileHash(file) { return sha256(fs.readFileSync(file)); }

function backupDir(home) { return path.join(home, '.boppi', 'backups'); }
function backupPath(home, file, now) {
  const stamp = now.replace(/[:.]/g, '-');
  return path.join(backupDir(home), `${path.basename(file)}.${sha256(path.resolve(file)).slice(0, 12)}.${stamp}.bak`);
}

/** Copy the file to its backup location with owner-only permissions. Returns the backup path. bytes, when given, are the bytes already read from the file. */
function writeBackup({ file, home, now, bytes }) {
  const backup = backupPath(home, file, now);
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  fs.writeFileSync(backup, bytes || fs.readFileSync(file), { mode: 0o600, flag: 'wx' });
  return backup;
}

/** Replace a file's contents through a temp file in the same directory and a rename, so a crash leaves either the old or the new bytes. */
function writeAtomic(file, data, mode = 0o600) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, data, { mode, flag: 'wx' });
  try { fs.renameSync(temp, file); } catch (error) { fs.rmSync(temp, { force: true }); throw error; }
}

function manifestPath(home) { return path.join(backupDir(home), 'index.json'); }

function readManifest(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(home), 'utf8'));
    if (parsed && Array.isArray(parsed.entries)) return { schemaVersion: MANIFEST_VERSION, entries: parsed.entries };
  } catch (_) { /* no manifest yet */ }
  return { schemaVersion: MANIFEST_VERSION, entries: [] };
}

/** Append one entry to the manifest. The write goes to a temp file first so a crash never leaves a half-written index. */
function appendManifestEntry(home, entry) {
  const manifest = readManifest(home);
  const id = entry.id || `${entry.action}-${crypto.randomBytes(4).toString('hex')}`;
  const full = { id, ...entry };
  manifest.entries.push(full);
  const file = manifestPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  return full;
}

function confirm(question) {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, answer => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
  });
}

module.exports = { CLIENTS, openRegular, lockPath, acquireLock, descriptorsFor, parseConfig, readClient, locateServer, manualEdit, objectAt, deleteAt, renderKeyPath, sha256, fileHash, backupDir, backupPath, writeBackup, writeAtomic, manifestPath, readManifest, appendManifestEntry, confirm };
