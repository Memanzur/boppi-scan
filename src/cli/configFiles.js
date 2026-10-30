/**
 * Which of a client's found configuration files hold a given server entry.
 * Discovery records the merged server keys per file; an older export without
 * that field falls back to every found file, as before.
 */
'use strict';

function filesHolding(client, server) {
  // Only configuration files hold servers; settings and plugin-index entries carry a `kind`. A file with a
  // malformed entry is unreadable but still holds the servers that were read from it.
  const found = (client ? client.files || [] : []).filter(f => !f.kind && (f.status === 'found' || (f.status === 'unreadable' && Array.isArray(f.servers) && f.servers.length)));
  if (found.some(f => !Array.isArray(f.servers))) return found.map(f => f.path);
  return found.filter(f => f.servers.includes(server)).map(f => f.path);
}

function editFiles(prediction, discovery) {
  const client = (discovery || []).find(c => c.clientKey === prediction.client.key);
  const from = filesHolding(client, prediction.edit.server);
  if (prediction.edit.action !== 'move_server') return { from, to: [] };
  const target = (discovery || []).find(c => c.clientKey === prediction.target.key);
  return { from, to: target ? [target.primaryPath].filter(Boolean) : [] };
}

/**
 * Reject unsupported JSON shapes before discovery can silently discard a grant. Unknown fields remain allowed.
 * A file or server block of the wrong shape throws; a single malformed server entry does not, so the other
 * entries can still be read. Returns the key paths of those malformed entries; the caller skips them and
 * reports the file unreadable, so the scan stays incomplete.
 */
function validateConfigShape(json, { source, cwd }) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const invalid = () => { throw new Error('invalid_config_shape'); };
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const malformed = [];
  const badEntry = entry => !object(entry)
    || ['command', 'url'].some(field => has(entry, field) && typeof entry[field] !== 'string')
    || (has(entry, 'args') && (!Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== 'string')))
    || (has(entry, 'env') && (!object(entry.env) || Object.values(entry.env).some(v => typeof v !== 'string')));
  const serverMap = (value, keyPath) => {
    if (!object(value)) invalid();
    for (const [name, entry] of Object.entries(value)) if (badEntry(entry)) malformed.push([...keyPath, name]);
  };
  if (!object(json)) invalid();
  if (has(json, 'mcpServers')) serverMap(json.mcpServers, ['mcpServers']);
  if (source === 'claude-code' && has(json, 'projects')) {
    if (!object(json.projects)) invalid();
    if (has(json.projects, cwd)) {
      const project = json.projects[cwd];
      if (!object(project)) invalid();
      if (has(project, 'mcpServers')) serverMap(project.mcpServers, ['projects', cwd, 'mcpServers']);
    }
  }
  return malformed;
}

module.exports = { filesHolding, editFiles, validateConfigShape };
