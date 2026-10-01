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

/** Inject catalog-inferred capabilities into raw server entries before scanning. */
function enrich(mergedServers, home) {
  const inferenceByServer = {};
  const mcpServers = {};
  for (const [name, server] of Object.entries(mergedServers || {})) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const inference = inferCapabilities(name, server, { home });
    inferenceByServer[name] = inference;
    mcpServers[name] = {
      ...server,
      capabilities: inference.capabilities,
      filesystemPaths: inference.filesystemPaths.length ? inference.filesystemPaths : server.filesystemPaths,
    };
  }
  return { config: { mcpServers }, inferenceByServer };
}

/** The inventory one client's raw servers produce, through the provider path a scan uses. */
function clientInventory({ mergedServers, clientKey, label, source, configPath, observedAt, home }) {
  const { config, inferenceByServer } = enrich(mergedServers, home);
  const scannerResult = scanner.scanConfig({ source, consent: true, dryRun: true, config, configPath, observedAt });
  const normalized = createConfigProvider({ clientKey, label, scannerResult, inferenceByServer }).normalize(scannerResult, { now: observedAt });
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

module.exports = { enrich, clientInventory, exposureKeysOf, diffKeys, simulateConfigEdit };
