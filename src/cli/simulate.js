/**
 * Counterfactual scan of a config edit. Runs the same inference, sanitizer,
 * provider, graph, and path finder as a normal scan on a copy of the raw
 * config with one server removed, and reports which exposures went away.
 * Nothing here estimates; every number comes from a re-run.
 */
'use strict';
const scanner = require('../engine/localMcpScanner');
const securityGraph = require('../engine/securityGraph');
const exposurePathEngine = require('../engine/exposurePathEngine');
const { inferCapabilities } = require('./knownServers');
const { createConfigProvider } = require('./provider');
const { builtinCovers } = require('./builtinTools');
const overlayModule = require('./overlay');

/** Inject catalog-inferred capabilities into raw server entries before scanning, and match overlay claims per server. */
function enrich(mergedServers, home, overlay = null) {
  const inferenceByServer = {};
  const overlayByServer = {};
  const mcpServers = {};
  for (const [name, server] of Object.entries(mergedServers || {})) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const inference = inferCapabilities(name, server, { home });
    inferenceByServer[name] = inference;
    overlayByServer[name] = overlayModule.matchClaims(overlay, name, server);
    mcpServers[name] = {
      ...server,
      capabilities: inference.capabilities,
      capabilityEvidence: inference.capabilityEvidence,
      tools: inference.tools,
      toolEvidence: inference.toolEvidence,
      filesystemPaths: inference.filesystemPaths.length ? inference.filesystemPaths : server.filesystemPaths,
    };
  }
  return { config: { mcpServers }, inferenceByServer, overlayByServer };
}

/** The inventory one client's raw servers produce, through the provider path a scan uses. */
function clientInventory({ mergedServers, clientKey, label, source, configPath, observedAt, home, overlay = null, builtin = null }) {
  const { config, inferenceByServer, overlayByServer } = enrich(mergedServers, home, overlay);
  const scannerResult = scanner.scanConfig({ source, consent: true, dryRun: true, config, configPath, observedAt });
  const normalized = createConfigProvider({ clientKey, label, scannerResult, inferenceByServer, overlayByServer, builtin }).normalize(scannerResult, { now: observedAt });
  return { agents: normalized.agents, integrations: [], permissions: normalized.permissions, mcpServers: normalized.mcpServers, inferenceByServer };
}

const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

function exposureKeysOf(inventory) {
  return exposurePathEngine.findPaths(securityGraph.buildGraph(inventory)).map(p => p.exposureKey).sort();
}

/** Exposure keys plus the priority of each, so a rescan can show a path that stays open at a lower priority. */
function exposureStateOf(inventory) {
  const priorities = {};
  for (const p of exposurePathEngine.findPaths(securityGraph.buildGraph(inventory))) priorities[p.exposureKey] = p.severity;
  return { exposureKeys: Object.keys(priorities).sort(), priorities };
}

/** Keys present in both states whose priority dropped, with the step they dropped. */
function loweredBetween(before, after) {
  return before.exposureKeys
    .filter(key => after.priorities[key] && (SEVERITY_RANK[after.priorities[key]] || 0) < (SEVERITY_RANK[before.priorities[key]] || 0))
    .map(key => ({ exposureKey: key, from: before.priorities[key], to: after.priorities[key] }));
}

function diffKeys(before, after) {
  const was = new Set(before);
  const is = new Set(after);
  return {
    eliminated: before.filter(k => !is.has(k)),
    survived: before.filter(k => is.has(k)),
    appeared: after.filter(k => !was.has(k)),
  };
}

/**
 * Apply {action:'remove_server', server} to a copy of the raw config and
 * rescan. agentContext is the client descriptor a scan would use
 * ({clientKey, label, source, configPath, observedAt, home}).
 */
function simulateConfigEdit({ rawConfig, agentContext, edit }) {
  if (!edit || edit.action !== 'remove_server') throw new TypeError(`Simulate: unsupported action ${edit && edit.action}`);
  const servers = rawConfig && rawConfig.mcpServers ? rawConfig.mcpServers : {};
  if (!Object.prototype.hasOwnProperty.call(servers, edit.server)) throw new TypeError(`Simulate: server ${edit.server} is not in the config`);
  const { [edit.server]: removed, ...rest } = servers;
  const before = exposureStateOf(clientInventory({ ...agentContext, mergedServers: servers }));
  const after = exposureStateOf(clientInventory({ ...agentContext, mergedServers: rest }));
  return { before, after, ...diffKeys(before.exposureKeys, after.exposureKeys), lowered: loweredBetween(before, after) };
}

/**
 * Apply {action:'move_server', server} across two clients and rescan both:
 * the server leaves the source config and is added to the target config
 * under the same name. Exposure keys embed the agent id, so the source's
 * eliminated keys and the target's appeared keys are reported separately.
 */
function simulateMoveServer({ rawConfig, agentContext, targetRawConfig, targetAgentContext, edit }) {
  if (!edit || edit.action !== 'move_server') throw new TypeError(`Simulate: unsupported action ${edit && edit.action}`);
  const servers = rawConfig && rawConfig.mcpServers ? rawConfig.mcpServers : {};
  if (!Object.prototype.hasOwnProperty.call(servers, edit.server)) throw new TypeError(`Simulate: server ${edit.server} is not in the config`);
  const targetServers = targetRawConfig && targetRawConfig.mcpServers ? targetRawConfig.mcpServers : {};
  if (Object.prototype.hasOwnProperty.call(targetServers, edit.server)) throw new TypeError(`Simulate: target already has a server named ${edit.server}`);
  const { [edit.server]: moved, ...rest } = servers;
  const sourceBefore = exposureStateOf(clientInventory({ ...agentContext, mergedServers: servers }));
  const sourceAfter = exposureStateOf(clientInventory({ ...agentContext, mergedServers: rest }));
  const source = diffKeys(sourceBefore.exposureKeys, sourceAfter.exposureKeys);
  const target = diffKeys(
    exposureKeysOf(clientInventory({ ...targetAgentContext, mergedServers: targetServers })),
    exposureKeysOf(clientInventory({ ...targetAgentContext, mergedServers: { ...targetServers, [edit.server]: moved } })),
  );
  return { eliminated: source.eliminated, survived: source.survived, appeared: target.appeared, lowered: loweredBetween(sourceBefore, sourceAfter), before: sourceBefore };
}

/**
 * What an agent gives up when a server goes: the capabilities no other server
 * on that agent also grants, and that the agent does not hold through its own
 * built-in tools. Read from the normalized inventory, so it is the same
 * evidence the graph was built from. `builtin` lists the kept capabilities
 * the agent keeps because they are built in.
 */
function capabilitiesLost(inventory, agentId, serverId) {
  const mine = (inventory.mcpServers || []).filter(s => s.agentId === agentId);
  const server = mine.find(s => s.id === serverId);
  if (!server) return { lost: [], kept: [], builtin: [] };
  const elsewhere = new Set(mine.filter(s => s.id !== serverId).flatMap(s => s.capabilities || []));
  // The agent's own web tools stand in for a server's generic web reach, but not for a connector that carries a credential: WebFetch cannot open a pull request or post to a workspace.
  const own = new Set((server.credentialReferences || []).length ? [] : builtinCovers(inventory, agentId));
  const capabilities = [...new Set(server.capabilities || [])].sort();
  return {
    lost: capabilities.filter(c => !elsewhere.has(c) && !own.has(c)),
    kept: capabilities.filter(c => elsewhere.has(c) || own.has(c)),
    builtin: capabilities.filter(c => own.has(c)),
  };
}

module.exports = { SEVERITY_RANK, enrich, clientInventory, exposureKeysOf, exposureStateOf, diffKeys, loweredBetween, simulateConfigEdit, simulateMoveServer, capabilitiesLost };
