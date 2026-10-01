/**
 * Predictions: for each server that takes part in an exposure, what a
 * remove_server edit would eliminate, computed by rescanning without it.
 * A prediction is a claim the next scan can grade (see verify.js).
 */
'use strict';
const models = require('../engine/models');
const scanner = require('../engine/localMcpScanner');
const { simulateConfigEdit } = require('./simulate');

const SCHEMA_VERSION = 1;
const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

/** Identity of the evidence a prediction was computed from. Timestamps are excluded so the same config hashes the same on every run. */
function inventoryDigest(inventory, agentId) {
  const mine = records => (records || []).filter(r => r.agentId === agentId);
  return models.stableId('inventory', {
    agents: (inventory.agents || []).filter(a => a.id === agentId).map(a => a.id),
    mcpServers: mine(inventory.mcpServers).map(s => ({ id: s.id, capabilities: [...s.capabilities].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    permissions: mine(inventory.permissions).map(p => p.id).sort(),
  });
}

/**
 * Servers that take part in one of the agent's paths: the record or a
 * permission derived from it is a path node, or grants an edge into one. The
 * second case catches a server on an alternative route the chosen chain did
 * not use, whose removal is still a candidate edit worth predicting.
 */
function participatingServers(inventory, agentId, agentPaths, graph) {
  const nodeIds = new Set(agentPaths.flatMap(p => p.nodes.map(n => n.id)));
  const involved = new Set(nodeIds);
  for (const edge of graph.edges) if (nodeIds.has(edge.toEntityId)) involved.add(edge.fromEntityId);
  const ownerOf = new Map((inventory.permissions || []).map(p => [p.id, p.integrationId]));
  const owners = new Set([...involved].map(id => ownerOf.get(id)).filter(Boolean));
  return (inventory.mcpServers || []).filter(s => s.agentId === agentId && (involved.has(s.id) || owners.has(s.id)));
}

/**
 * One prediction per participating server of one scanned client.
 * client: a discovery client with agentId and mergedServers set.
 */
function predictForClient({ client, inventory, graph, paths, observedAt, home, scannerVersion }) {
  const agentPaths = paths.filter(p => p.agentId === client.agentId);
  if (!agentPaths.length) return [];
  const agentContext = { clientKey: client.clientKey, label: client.label, source: client.source, configPath: client.primaryPath, observedAt, home };
  const inventoryHash = inventoryDigest(inventory, client.agentId);
  const configFingerprint = scanner.pathFingerprint(client.primaryPath);
  return participatingServers(inventory, client.agentId, agentPaths, graph).map(server => {
    const edit = { action: 'remove_server', server: server.name };
    const sim = simulateConfigEdit({ rawConfig: { mcpServers: client.mergedServers }, agentContext, edit });
    return {
      schemaVersion: SCHEMA_VERSION,
      predictionId: models.stableId('prediction', [models.ENGINE_VERSION, client.agentId, edit, sim.before.exposureKeys]),
      engineVersion: models.ENGINE_VERSION,
      scannerVersion,
      createdAt: observedAt,
      client: { key: client.clientKey, label: client.label },
      agentId: client.agentId,
      configFingerprint,
      edit,
      serverId: server.id,
      before: { exposureKeys: sim.before.exposureKeys },
      predictedEliminated: sim.eliminated,
      predictedSurviving: sim.survived,
      inventoryHash,
    };
  });
}

function severityByKey(paths) { return new Map(paths.map(p => [p.exposureKey, p.severity])); }
function breakdown(keys, severities) {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const key of keys) out[severities.get(key) || 'low'] += 1;
  return out;
}

/** Predictions ordered by what they break: critical count, weighted severity, count, then id. */
function rankPredictions(predictions, paths) {
  const severities = severityByKey(paths);
  return predictions
    .map(prediction => {
      const eliminatedSeverity = breakdown(prediction.predictedEliminated, severities);
      const weight = prediction.predictedEliminated.reduce((sum, key) => sum + (SEVERITY_RANK[severities.get(key)] || 0), 0);
      return { prediction, eliminatedSeverity, weight };
    })
    .filter(entry => entry.prediction.predictedEliminated.length)
    .sort((a, b) => (b.eliminatedSeverity.critical - a.eliminatedSeverity.critical) || (b.weight - a.weight)
      || (b.prediction.predictedEliminated.length - a.prediction.predictedEliminated.length)
      || a.prediction.predictionId.localeCompare(b.prediction.predictionId));
}

/**
 * Greedy cover of the exposures at or above severityFloor using single-edit
 * predictions. Removing evidence never restores an exposure, so the union of
 * the chosen eliminated sets is a correct cover; it is not provably minimal.
 */
function planFromPredictions(predictions, paths, options = {}) {
  const floor = SEVERITY_RANK[options.severityFloor] || 1;
  const remaining = new Set(paths.filter(p => (SEVERITY_RANK[p.severity] || 0) >= floor).map(p => p.exposureKey));
  const targeted = remaining.size;
  const pool = rankPredictions(predictions, paths).map(entry => entry.prediction);
  const steps = [];
  while (remaining.size) {
    let best = null, bestGain = 0;
    for (const prediction of pool) {
      if (steps.some(s => s.predictionId === prediction.predictionId)) continue;
      const gain = prediction.predictedEliminated.filter(key => remaining.has(key)).length;
      if (gain > bestGain) { best = prediction; bestGain = gain; }
    }
    if (!best) break;
    const breaks = best.predictedEliminated.filter(key => remaining.has(key)).sort();
    for (const key of breaks) remaining.delete(key);
    steps.push({ predictionId: best.predictionId, agentId: best.agentId, client: best.client, edit: best.edit, breaksCount: breaks.length, breaksExposureKeys: breaks });
  }
  return { schemaVersion: SCHEMA_VERSION, targetedExposures: targeted, severityFloor: options.severityFloor || 'low', steps, residualExposureKeys: [...remaining].sort(), breaksAll: remaining.size === 0 };
}

module.exports = { SCHEMA_VERSION, inventoryDigest, participatingServers, predictForClient, rankPredictions, planFromPredictions };
