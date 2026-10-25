/**
 * Which of a client's found configuration files hold a given server entry.
 * Discovery records the merged server keys per file; an older export without
 * that field falls back to every found file, as before.
 */
'use strict';

function filesHolding(client, server) {
  const found = (client ? client.files || [] : []).filter(f => f.status === 'found' && f.kind !== 'settings');
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

/** Reject unsupported JSON shapes before discovery can silently discard a grant. Unknown fields remain allowed. */
function validateConfigShape(json, { source, cwd }) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const invalid = () => { throw new Error('invalid_config_shape'); };
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const serverMap = value => {
    if (!object(value)) invalid();
    for (const entry of Object.values(value)) {
      if (!object(entry)) invalid();
      for (const field of ['command', 'url']) if (has(entry, field) && typeof entry[field] !== 'string') invalid();
      if (has(entry, 'args') && (!Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== 'string'))) invalid();
      if (has(entry, 'env') && (!object(entry.env) || Object.values(entry.env).some(v => typeof v !== 'string'))) invalid();
    }
  };
  if (!object(json)) invalid();
  if (has(json, 'mcpServers')) serverMap(json.mcpServers);
  if (source === 'claude-code' && has(json, 'projects')) {
    if (!object(json.projects)) invalid();
    if (has(json.projects, cwd)) {
      const project = json.projects[cwd];
      if (!object(project)) invalid();
      if (has(project, 'mcpServers')) serverMap(project.mcpServers);
    }
  }
}

module.exports = { filesHolding, editFiles, validateConfigShape };
