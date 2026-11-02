/**
 * boppi fix: apply one remove_server edit to the config file that holds the
 * server, with a backup first, then rescan and grade the prediction.
 * The command is the approval. On a terminal it also asks; --yes skips that.
 */
'use strict';
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
  const stamp = now.replace(/[:.]/g, '-');
  return path.join(home, '.boppi', 'backups', `${path.basename(file)}.${stamp}.bak`);
}

/** Write the backup, then the edited config. Returns the backup path. */
function applyRemoval({ located, serverName, cwd, home, now }) {
  const backup = backupPath(home, located.file, now);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(located.file, backup);
  fs.chmodSync(backup, 0o600);
  const removed = deleteServer(located.json, serverName, cwd);
  if (!removed) throw new Error(`"${serverName}" was not found in ${located.file} at write time`);
  fs.writeFileSync(located.file, JSON.stringify(located.json, null, 2) + '\n');
  return backup;
}

function confirm(question) {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, answer => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
  });
}

module.exports = { locateServer, deleteServer, applyRemoval, backupPath, confirm };
