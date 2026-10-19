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

module.exports = { filesHolding, editFiles };
