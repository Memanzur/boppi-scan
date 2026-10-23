/**
 * Evidence layers (Phase 8, slice P8-1). For every MCP server and every
 * exposure path the scan keeps four layers apart, each with its source,
 * basis, versions, time range, uncertainty, and coverage status:
 *   configured   what the configuration files say (the graph is built from this)
 *   advertised   what a consented `boppi discover` stored (the server's own tool list)
 *   observed     what Claude Code hooks reported (invocations and outcomes, never effects)
 *   hypothesis   investigative content analysis; not available until Phase 7 ships
 * A path is possible reach from the configured layer. Observed calls on a
 * server in a path say the server was invoked, not that the path was walked.
 */
'use strict';
const models = require('../engine/models');
const riskRubric = require('../engine/riskRubric');

const MONITORED_CLIENTS = Object.freeze(['claude-code']);
const OUTCOMES = Object.freeze(['ok', 'error', 'failed', 'interrupted', 'denied', 'unknown']);
const baseName = name => String(name || '').replace(/ \((user|project|local|global|explicit)\)$/, '');

/** Observed calls per server base name from the events timeline (calls already paired by session and invocation). */
function observedIndex(calls) {
  const index = new Map();
  for (const call of calls || []) {
    if (call.kind !== 'mcp' || !call.server) continue;
    const row = index.get(call.server) || { calls: 0, outcomes: Object.fromEntries(OUTCOMES.map(o => [o, 0])), firstAt: call.at, lastAt: call.at, sessions: new Set(), eventIds: [], tools: new Set() };
    row.calls++;
    row.outcomes[call.outcome] = (row.outcomes[call.outcome] || 0) + 1;
    if (call.at < row.firstAt) row.firstAt = call.at;
    if (call.at > row.lastAt) row.lastAt = call.at;
    if (call.session) row.sessions.add(call.session);
    if (call.tool) row.tools.add(call.tool);
    if (row.eventIds.length < 50) row.eventIds.push(`${call.session || '-'}:${call.invocation || '-'}`);
    index.set(call.server, row);
  }
  return index;
}

function configuredLayer(scan, server) {
  const permissions = (scan.inventory.permissions || []).filter(p => p.integrationId === server.id);
  const bases = [...new Set(permissions.map(p => (p.attributes || {}).basis).filter(Boolean))].sort();
  const edges = (scan.graph && scan.graph.edges || []).filter(e => e.fromEntityId === server.id || e.toEntityId === server.id);
  return {
    status: 'present',
    source: 'configuration file',
    configPath: server.configPath || null,
    basis: bases,
    permissions: permissions.length,
    edges: edges.length,
    firstSeenAt: server.firstSeenAt || server.createdAt || scan.startedAt,
    lastSeenAt: server.lastSeenAt || scan.startedAt,
    uncertainty: typeof server.confidence === 'number' ? Number((1 - server.confidence).toFixed(2)) : null,
    coverage: scan.scope === 'full' ? 'complete' : scan.scope === 'selected' ? 'selected clients only' : 'one explicit file',
    note: 'possible reach: what the configuration grants, not what happened',
  };
}

function advertisedLayer(scan, clientKey, server) {
  const inference = scan.inferenceByClient && scan.inferenceByClient[clientKey] && scan.inferenceByClient[clientKey][server.name];
  const advertised = inference && inference.advertised;
  if (!advertised || advertised.status === 'none') return { status: 'none', source: 'no consented discovery stored', coverage: 'none', note: 'run boppi discover --server to add the tool list the server itself advertises' };
  if (advertised.status === 'stale') return { status: 'stale', source: 'consented discovery', discoveredAt: advertised.discoveredAt || null, reason: advertised.reason, coverage: 'ignored', note: 'the stored list no longer matches the entry or has expired; nothing from it is used' };
  return { status: 'usable', source: 'consented discovery', discoveredAt: advertised.discoveredAt, tools: advertised.tools, mapped: advertised.mapped, unmapped: advertised.unmapped, partial: !!advertised.partial, coverage: advertised.partial ? 'partial list' : 'full list', uncertainty: 'tool names only; what each tool does was not verified' };
}

function observedLayer({ clientKey, server, index, events, window }) {
  if (!MONITORED_CLIENTS.includes(clientKey)) return { status: 'not_monitored', source: 'none', coverage: 'none', note: `${clientKey} has no supported hook; only Claude Code is monitored` };
  if (!events) return { status: 'no_hook_events', source: 'Claude Code hooks', coverage: 'none', note: 'no hook events recorded on this machine; add the snippet from boppi hook --print-config to observe calls' };
  const row = index.get(baseName(server.name));
  const base = { source: 'Claude Code hooks', coverage: `${window.sinceDays}-day window, ${events.records.length} records, ${events.torn} unreadable, ${events.duplicates} duplicate`, window };
  if (!row) return { ...base, status: 'none', calls: 0, note: 'no invocation of this server was reported in the window; hooks only see Claude Code calls' };
  return {
    ...base,
    status: 'observed',
    calls: row.calls,
    outcomes: row.outcomes,
    tools: [...row.tools].sort(),
    sessions: row.sessions.size,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
    eventIds: row.eventIds,
    uncertainty: 'an invocation says the client called the tool, not what it did to files or the network; a call with no outcome is unknown',
  };
}

/** Every layer for every server and path in a scan. `events` is the events timeline for the home, or null when no events are stored. */
function layersFor(scan, { events = null, sinceDays = 30 } = {}) {
  const clientByAgent = new Map((scan.discovery.clients || []).filter(c => c.agentId).map(c => [c.agentId, c.clientKey]));
  const window = { sinceDays, to: scan.startedAt };
  const calls = events ? events.calls : [];
  const index = observedIndex(calls);
  const servers = (scan.inventory.mcpServers || []).map(server => {
    const clientKey = clientByAgent.get(server.agentId) || null;
    return {
      serverId: server.id,
      name: server.name,
      agentId: server.agentId,
      client: clientKey,
      layers: {
        configured: configuredLayer(scan, server),
        advertised: advertisedLayer(scan, clientKey, server),
        observed: observedLayer({ clientKey, server, index, events, window }),
        hypothesis: { status: 'not_available', source: 'none', coverage: 'none', note: 'no prompt or content analysis is enabled (Phase 7 is a document only)' },
      },
    };
  });
  const byId = new Map(servers.map(s => [s.serverId, s]));
  const configuredNames = new Set(servers.filter(s => s.client && MONITORED_CLIENTS.includes(s.client)).map(s => baseName(s.name)));
  const unmatchedObserved = [...index.entries()].filter(([name]) => !configuredNames.has(name)).map(([name, row]) => ({ server: name, calls: row.calls, lastAt: row.lastAt, note: 'calls were reported for a server that is not in the current Claude Code configuration (removed since, or a project the scan did not cover)' }));
  const paths = (scan.paths || []).map(p => {
    const serverIds = (p.nodes || []).filter(n => n.entityType === 'mcp_server').map(n => n.entityId || n.id).filter(id => byId.has(id));
    const invoked = serverIds.map(id => byId.get(id)).filter(s => s.layers.observed.status === 'observed').map(s => ({ serverId: s.serverId, name: s.name, calls: s.layers.observed.calls, lastAt: s.layers.observed.lastAt }));
    return {
      pathId: p.id,
      exposureKey: p.exposureKey,
      templateId: p.templateId,
      severity: p.severity,
      agentId: p.agentId,
      servers: serverIds,
      layers: {
        configured: { status: 'possible_reach', basis: p.assessment ? { facts: p.assessment.facts.length, assumptions: p.assessment.assumptions.length, unknowns: p.assessment.unknowns.length } : null, note: 'a path template matched the configured graph; this is possible reach, not an incident' },
        observed: invoked.length
          ? { status: 'servers_invoked', invoked, note: 'servers on this path were invoked in the window; that shows use of the tool, not that the path was walked end to end' }
          : { status: 'possible_reach_only', note: 'no invocation of any server on this path was reported in the window (or the client is not monitored)' },
      },
    };
  });
  return {
    schemaVersion: 1,
    versions: { scanner: scan.scannerVersion || null, engine: models.ENGINE_VERSION, rubric: riskRubric.RUBRIC_VERSION, eventsSchema: 2 },
    window,
    coverage: {
      configured: scan.scope,
      advertised: servers.some(s => s.layers.advertised.status === 'usable') ? 'some servers' : 'none',
      observed: !events ? 'no hook events on this machine' : `Claude Code hooks, ${sinceDays}-day window`,
      hypothesis: 'not available',
      monitoredClients: MONITORED_CLIENTS,
    },
    servers,
    paths,
    unmatchedObserved,
    note: 'Layers never merge: configured reach is not activity, advertised tools are not verified, observed calls are not effects, and no hypothesis layer exists yet.',
  };
}

/** One terminal line per server. */
function observedSentence(serverLayers) {
  const o = serverLayers.layers.observed;
  if (o.status === 'not_monitored') return `runtime: not monitored (only Claude Code hooks are supported)`;
  if (o.status === 'no_hook_events') return 'runtime: no hook events recorded (add the snippet from boppi hook --print-config to observe calls)';
  if (o.status === 'none') return `runtime: 0 calls observed in the last ${o.window.sinceDays} days`;
  const parts = OUTCOMES.filter(k => o.outcomes[k]).map(k => `${o.outcomes[k]} ${k}`);
  return `runtime: observed ${o.calls} call${o.calls === 1 ? '' : 's'} in the last ${o.window.sinceDays} days (${parts.join(', ')}) across ${o.sessions} session${o.sessions === 1 ? '' : 's'}, last ${o.lastAt}; an observed call shows the tool was invoked, not what it did`;
}

module.exports = { MONITORED_CLIENTS, OUTCOMES, baseName, observedIndex, layersFor, observedSentence };
