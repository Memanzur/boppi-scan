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
      filesystemPaths: inference.filesystemPaths.length ? inference.filesystemPaths : server.filesystemPaths,
    };
  }
  return { config: { mcpServers }, inferenceByServer, overlayByServer };
}

/** The inventory one client's raw servers produce, through the provider path a scan uses. */
function clientInventory({ mergedServers, clientKey, label, source, configPath, observedAt, home, overlay = null }) {
  const { config, inferenceByServer, overlayByServer } = enrich(mergedServers, home, overlay);
  const scannerResult = scanner.scanConfig({ source, consent: true, dryRun: true, config, configPath, observedAt });
  const normalized = createConfigProvider({ clientKey, label, scannerResult, inferenceByServer, overlayByServer }).normalize(scannerResult, { now: observedAt });
  return { agents: normalized.agents, integrations: [], permissions: normalized.permissions, mcpServers: normalized.mcpServers, inferenceByServer };
}

function exposureKeysOf(inventory) {
  return exposurePathEngine.findPaths(securityGraph.buildGraph(inventory)).map(p => p.exposureKey).sort();
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
  const before = exposureKeysOf(clientInventory({ ...agentContext, mergedServers: servers }));
  const after = exposureKeysOf(clientInventory({ ...agentContext, mergedServers: rest }));
  return { before: { exposureKeys: before }, after: { exposureKeys: after }, ...diffKeys(before, after) };
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
  const source = diffKeys(
    exposureKeysOf(clientInventory({ ...agentContext, mergedServers: servers })),
    exposureKeysOf(clientInventory({ ...agentContext, mergedServers: rest })),
  );
  const target = diffKeys(
    exposureKeysOf(clientInventory({ ...targetAgentContext, mergedServers: targetServers })),
    exposureKeysOf(clientInventory({ ...targetAgentContext, mergedServers: { ...targetServers, [edit.server]: moved } })),
  );
  return { eliminated: source.eliminated, survived: source.survived, appeared: target.appeared, before: { exposureKeys: [...source.eliminated, ...source.survived].sort() } };
}

/**
 * What an agent gives up when a server goes: the capabilities no other server
 * on that agent also grants. Read from the normalized inventory, so it is the
 * same evidence the graph was built from.
 */
function capabilitiesLost(inventory, agentId, serverId) {
  const mine = (inventory.mcpServers || []).filter(s => s.agentId === agentId);
  const server = mine.find(s => s.id === serverId);
  if (!server) return { lost: [], kept: [] };
  const elsewhere = new Set(mine.filter(s => s.id !== serverId).flatMap(s => s.capabilities || []));
  const capabilities = [...new Set(server.capabilities || [])].sort();
  return { lost: capabilities.filter(c => !elsewhere.has(c)), kept: capabilities.filter(c => elsewhere.has(c)) };
}

module.exports = { enrich, clientInventory, exposureKeysOf, diffKeys, simulateConfigEdit, simulateMoveServer, capabilitiesLost };
