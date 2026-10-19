/**
 * boppi fix primitives: locate the file that holds a server, delete the
 * entry, keep a backup, and record every fix in a manifest that rollback
 * reads. remediate.js sequences these into stages; boppi.js only dispatches.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENTS = [require('./discovery/claudeDesktop'), require('./discovery/claudeCode'), require('./discovery/cursor')];
const MANIFEST_VERSION = 1;

/** The client descriptors a scan with these options reads: one explicit file, or every known client location. */
function descriptorsFor(options) {
  if (options.config) {
    return [{
      clientKey: options.source, label: `Explicit config (${options.source})`, source: options.source,
      files: [{ path: path.resolve(options.config), scope: 'explicit', extract: json => json.mcpServers || {} }],
    }];
  }
  return CLIENTS.map(m => m.locate({ home: options.home, cwd: options.cwd, platform: options.platform }));
}

/** The scanned file and key path that hold a server for one client, or null. */
function locateServer(client, descriptor, serverName) {
  for (const file of descriptor.files) {
    const resolved = path.resolve(file.path);
    if (!fs.existsSync(resolved)) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch (_) { continue; }
    const servers = file.extract(json) || {};
    if (!Object.prototype.hasOwnProperty.call(servers, serverName)) continue;
    return { file: resolved, scope: file.scope, json };
  }
  return null;
}

/** Delete the server from every mcpServers block the client reads in this file. Returns how many blocks changed. */
function deleteServer(json, serverName, cwd) {
  let removed = 0;
  if (json.mcpServers && typeof json.mcpServers === 'object' && Object.prototype.hasOwnProperty.call(json.mcpServers, serverName)) {
    delete json.mcpServers[serverName];
    removed += 1;
  }
  const project = json.projects && cwd && json.projects[cwd];
  if (project && project.mcpServers && typeof project.mcpServers === 'object' && Object.prototype.hasOwnProperty.call(project.mcpServers, serverName)) {
    delete project.mcpServers[serverName];
    removed += 1;
  }
  return removed;
}

/** The mcpServers blocks of this file that deleteServer would touch, as JSON pointer-like key paths. */
function serverBlocks(json, cwd) {
  const blocks = [];
  if (json.mcpServers && typeof json.mcpServers === 'object') blocks.push({ keyPath: 'mcpServers', servers: json.mcpServers });
  const project = json.projects && cwd && json.projects[cwd];
  if (project && project.mcpServers && typeof project.mcpServers === 'object') blocks.push({ keyPath: `projects[${JSON.stringify(cwd)}].mcpServers`, servers: project.mcpServers });
  return blocks;
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fileHash(file) { return sha256(fs.readFileSync(file)); }

function backupDir(home) { return path.join(home, '.boppi', 'backups'); }
function backupPath(home, file, now) {
  const stamp = now.replace(/[:.]/g, '-');
  return path.join(backupDir(home), `${path.basename(file)}.${sha256(path.resolve(file)).slice(0, 12)}.${stamp}.bak`);
}

/** Copy the file to its backup location with owner-only permissions. Returns the backup path. */
function writeBackup({ file, home, now }) {
  const backup = backupPath(home, file, now);
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  fs.writeFileSync(backup, fs.readFileSync(file), { mode: 0o600, flag: 'wx' });
  return backup;
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

module.exports = { CLIENTS, descriptorsFor, locateServer, deleteServer, serverBlocks, sha256, fileHash, backupDir, backupPath, writeBackup, manifestPath, readManifest, appendManifestEntry, confirm };
