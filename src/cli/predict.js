/**
 * Predictions: for each server that takes part in an exposure, what a
 * remove_server edit would eliminate, computed by rescanning without it.
 * A prediction is a claim the next scan can grade (see verify.js).
 */
'use strict';
const models = require('../engine/models');
const riskRubric = require('../engine/riskRubric');
const scanner = require('../engine/localMcpScanner');
const securityGraph = require('../engine/securityGraph');
const exposurePathEngine = require('../engine/exposurePathEngine');
const { SEVERITY_RANK, clientInventory, simulateConfigEdit, simulateMoveServer, capabilitiesLost } = require('./simulate');
const { builtinHoldings } = require('./builtinTools');

const SCHEMA_VERSION = 1;

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
function predictForClient({ client, inventory, graph, paths, observedAt, home, overlay = null, scannerVersion, otherClients = [] }) {
  const agentPaths = paths.filter(p => p.agentId === client.agentId);
  if (!agentPaths.length) return [];
  const contextFor = c => ({ clientKey: c.clientKey, label: c.label, source: c.source, configPath: c.primaryPath, observedAt, home, overlay, builtin: c.builtin || null });
  const agentContext = contextFor(client);
  const inventoryHash = inventoryDigest(inventory, client.agentId);
  const configFingerprint = scanner.pathFingerprint(client.primaryPath);
  const targets = otherClients.filter(c => c.agentId && c.primaryPath && !c.scanError && c.clientKey !== client.clientKey);
  const base = (server, edit, sim) => ({
    schemaVersion: SCHEMA_VERSION,
    predictionId: models.stableId('prediction', [models.ENGINE_VERSION, client.agentId, edit, sim.before.exposureKeys]),
    engineVersion: models.ENGINE_VERSION,
    rubricVersion: riskRubric.RUBRIC_VERSION,
    scannerVersion,
    createdAt: observedAt,
    client: { key: client.clientKey, label: client.label },
    agentId: client.agentId,
    configFingerprint,
    edit,
    serverId: server.id,
    before: { exposureKeys: sim.before.exposureKeys, priorities: sim.before.priorities },
    predictedEliminated: sim.eliminated,
    predictedSurviving: sim.survived,
    predictedLowered: sim.lowered,
    disruption: capabilitiesLost(inventory, client.agentId, server.id),
    inventoryHash,
  });
  return participatingServers(inventory, client.agentId, agentPaths, graph).flatMap(server => {
    const removal = { action: 'remove_server', server: server.name };
    const out = [base(server, removal, simulateConfigEdit({ rawConfig: { mcpServers: client.mergedServers }, agentContext, edit: removal }))];
    for (const target of targets) {
      if (Object.prototype.hasOwnProperty.call(target.mergedServers, server.name)) continue;
      const move = { action: 'move_server', server: server.name, toClient: target.clientKey };
      const sim = simulateMoveServer({ rawConfig: { mcpServers: client.mergedServers }, agentContext, targetRawConfig: { mcpServers: target.mergedServers }, targetAgentContext: contextFor(target), edit: move });
      out.push({ ...base(server, move, sim), target: { key: target.clientKey, label: target.label, agentId: target.agentId, predictedAppeared: sim.appeared } });
    }
    return out;
  });
}

/**
 * What one agent's built-in tools hold open with every MCP server removed:
 * the paths of a rescan on an empty server list, with the tools on their
 * chains. Null when the client has no built-in grants or nothing survives.
 */
function builtinResidualForClient({ client, observedAt, home, overlay = null }) {
  if (!client.builtin || !Array.isArray(client.builtin.grants) || !client.builtin.grants.length) return null;
  const inventory = clientInventory({ clientKey: client.clientKey, label: client.label, source: client.source, configPath: client.primaryPath, observedAt, home, overlay, builtin: client.builtin, mergedServers: {} });
  const paths = exposurePathEngine.findPaths(securityGraph.buildGraph(inventory));
  if (!paths.length) return null;
  const [holding] = builtinHoldings({ inventory, paths, discovery: [client] }, paths.map(p => p.exposureKey));
  return holding ? { ...holding, priorities: Object.fromEntries(paths.map(p => [p.exposureKey, p.severity])) } : null;
}

function severityByKey(paths) { return new Map(paths.map(p => [p.exposureKey, p.severity])); }
function breakdown(keys, severities) {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const key of keys) out[severities.get(key) || 'low'] += 1;
  return out;
}

/** Priorities a prediction lowers without closing the path; absent on predictions made before the field existed. */
function loweredOf(prediction) { return Array.isArray(prediction.predictedLowered) ? prediction.predictedLowered : []; }

/**
 * Predictions ordered by what they change: critical paths closed, then the
 * weighted priority they remove (a closed path counts its whole priority, a
 * lowered path the steps it drops), then counts, then id.
 */
function rankPredictions(predictions, paths) {
  const severities = severityByKey(paths);
  return predictions
    .map(prediction => {
      const eliminatedSeverity = breakdown(prediction.predictedEliminated, severities);
      const lowered = loweredOf(prediction);
      const weight = prediction.predictedEliminated.reduce((sum, key) => sum + (SEVERITY_RANK[severities.get(key)] || 0), 0)
        + lowered.reduce((sum, step) => sum + Math.max(0, (SEVERITY_RANK[step.from] || 0) - (SEVERITY_RANK[step.to] || 0)), 0);
      const appeared = prediction.target ? prediction.target.predictedAppeared.length : 0;
      const lost = prediction.disruption ? prediction.disruption.lost.length : 0;
      return { prediction, eliminatedSeverity, lowered, weight, appeared, lost };
    })
    .filter(entry => entry.prediction.predictedEliminated.length || entry.lowered.length)
    .sort((a, b) => (b.eliminatedSeverity.critical - a.eliminatedSeverity.critical) || (b.weight - a.weight)
      || (b.prediction.predictedEliminated.length - a.prediction.predictedEliminated.length)
      || (b.lowered.length - a.lowered.length)
      || (a.appeared - b.appeared) || (a.lost - b.lost)
      || ((a.prediction.edit.action === 'move_server') - (b.prediction.edit.action === 'move_server'))
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
  const pool = rankPredictions(predictions, paths).map(entry => entry.prediction).filter(p => p.edit.action === 'remove_server');
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

module.exports = { SCHEMA_VERSION, inventoryDigest, participatingServers, predictForClient, builtinResidualForClient, loweredOf, rankPredictions, planFromPredictions };
