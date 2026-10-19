/**
 * View model for the interactive report: the scan's graph, paths, and
 * candidate edits reshaped for a renderer that works from the --json export.
 * Pure. Every id here is an engine id, so a click in the UI resolves back to
 * the same node, edge, path, or prediction the CLI prints.
 */
'use strict';
const crypto = require('crypto');
const exposurePathEngine = require('../../engine/exposurePathEngine');
const { rankPredictions } = require('../predict');
const { shellArgument, shellPath } = require('../shell');
const { builtinCapabilities } = require('../builtinTools');
const recognition = require('../recognition');

const KIND_BY_ENTITY = Object.freeze({
  ai_agent: 'agent', coding_agent: 'agent', autonomous_agent: 'agent', ai_application: 'agent',
  mcp_server: 'server',
  capability: 'capability', permission: 'capability', tool: 'capability',
  data_category: 'data',
  credential_reference: 'credential',
  external_destination: 'destination', production_system: 'destination',
});
const KINDS = Object.freeze(['agent', 'server', 'capability', 'data', 'credential', 'destination']);
const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

/** Plain-language names for engine capability ids. Unknown ids pass through unchanged. */
const CAPABILITY_LABELS = Object.freeze({
  filesystem_access: 'file access (read and write files)',
  network_access: 'network access (reach external services)',
  shell_access: 'shell access (run commands)',
  code_execution: 'code execution (run programs)',
  credential_access: 'credential access (use stored secrets)',
  environment_access: 'environment access (read environment variables)',
  browser_automation: 'browser automation (drive a web browser)',
  untrusted_external_content: 'untrusted content intake (read external pages or messages)',
});
function capabilityLabel(id) { return CAPABILITY_LABELS[id] || id; }

function kindOf(entityType) { return KIND_BY_ENTITY[entityType] || entityType; }
function evidenceLabel(evidenceClass) { return evidenceClass === 'observed' ? 'configured' : (evidenceClass || 'unknown'); }

function previewHash(fields) {
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** Each derived node belongs to the agent whose edges reach it. Record-backed nodes carry agentId themselves. */
function agentOwnership(graph, inventory) {
  const owner = new Map();
  const outgoing = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.fromEntityId)) outgoing.set(edge.fromEntityId, []);
    outgoing.get(edge.fromEntityId).push(edge.toEntityId);
  }
  for (const agent of inventory.agents || []) {
    const queue = [agent.id];
    while (queue.length) {
      const id = queue.shift();
      if (owner.has(id)) continue;
      owner.set(id, agent.id);
      for (const next of outgoing.get(id) || []) if (!owner.has(next)) queue.push(next);
    }
  }
  return owner;
}

/** Files on disk where an edit applies, from the (portable) discovery. */
function editFiles(prediction, discovery) {
  const client = (discovery || []).find(c => c.clientKey === prediction.client.key);
  const found = client ? client.files.filter(f => f.status === 'found' && f.kind !== 'settings').map(f => f.path) : [];
  if (prediction.edit.action !== 'move_server') return { from: found, to: [] };
  const target = (discovery || []).find(c => c.clientKey === prediction.target.key);
  return { from: found, to: target ? [target.primaryPath].filter(Boolean) : [] };
}

function fixCommand(prediction, scanArgs) {
  let command = `boppi fix --server ${shellArgument(prediction.edit.server)} --client ${prediction.client.key}`;
  if (scanArgs && scanArgs.config) {
    // A ~ path expands in a shell; a fingerprinted path outside home cannot be
    // reproduced, so the user runs the command from the scanned directory.
    if (scanArgs.config.startsWith('~/')) command += ` --config ${shellPath(scanArgs.config)} --source ${scanArgs.source}`;
    else command += ` --source ${scanArgs.source}  # add --config <the file you scanned>`;
  }
  return command;
}

function serverEvidence(server) {
  const lines = [];
  if (server.command) lines.push({ title: 'Command', detail: `${server.command}${server.arguments.length ? ' ' + server.arguments.join(' ') : ''}` });
  if (server.endpoint) lines.push({ title: 'Endpoint', detail: server.endpoint });
  if (server.configPath) lines.push({ title: 'Config file', detail: `fingerprint ${server.configPath}` });
  lines.push({ title: 'Trust status', detail: server.trustStatus || 'unknown' });
  if ((server.capabilities || []).length) lines.push({ title: 'Capabilities', detail: server.capabilities.map(capabilityLabel).join(', ') });
  if ((server.environmentVariableNames || []).length) lines.push({ title: 'Environment variable names', detail: server.environmentVariableNames.join(', ') });
  if ((server.credentialReferences || []).length) lines.push({ title: 'Credential references (names only)', detail: server.credentialReferences.join(', ') });
  if ((server.exposedTools || []).length) lines.push({ title: 'Configured or catalog-inferred tools', detail: server.exposedTools.join(', ') });
  return lines;
}

function buildGraphView(report) {
  const inventory = report.inventory;
  const graph = report.graph || { nodes: [], edges: [] };
  const paths = report.paths || [];
  const discovery = report.discovery || [];
  const owner = agentOwnership(graph, inventory);
  const serverById = new Map((inventory.mcpServers || []).map(s => [s.id, s]));
  const permissionById = new Map((inventory.permissions || []).map(p => [p.id, p]));
  const recognitionById = new Map((report.recognition || []).filter(r => r.serverId).map(r => [r.serverId, r]));
  const agentById = new Map((inventory.agents || []).map(a => [a.id, a]));
  const labelById = new Map(graph.nodes.map(n => [n.id, n.label]));
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!incoming.has(edge.toEntityId)) incoming.set(edge.toEntityId, []);
    incoming.get(edge.toEntityId).push(edge);
  }
  const pathsByNode = new Map();
  for (const pathItem of paths) for (const node of pathItem.nodes) {
    if (!pathsByNode.has(node.id)) pathsByNode.set(node.id, []);
    pathsByNode.get(node.id).push(pathItem.id);
  }
  const worstSeverity = ids => (ids || []).map(id => paths.find(p => p.id === id)).reduce((worst, p) => (p && (SEVERITY_RANK[p.severity] || 0) > (SEVERITY_RANK[worst] || 0) ? p.severity : worst), null);

  const nodes = graph.nodes.map(node => {
    const kind = kindOf(node.entityType);
    const evidence = [{ title: 'Evidence class', detail: `${evidenceLabel(node.evidenceClass)} · source class: ${node.evidenceClass || 'unknown'} (configuration metadata, not runtime) · confidence ${node.confidence ?? '?'}${node.stale ? ' · stale' : ''}` }];
    const detail = {};
    if (kind === 'agent') {
      const agent = agentById.get(node.id);
      if (agent) {
        Object.assign(detail, { vendor: agent.vendor || null, type: agent.type || null, riskScore: agent.riskScore ?? null, riskLevel: agent.riskLevel || null });
        evidence.push({ title: 'Risk', detail: `${agent.riskScore ?? 0}/100 ${agent.riskLevel || 'low'}` });
        const client = discovery.find(c => c.agentId === agent.id);
        if (client) evidence.push({ title: 'Configuration files', detail: client.files.filter(f => f.status === 'found' && f.kind !== 'settings').map(f => f.path).join(', ') || 'none found' });
        if (client && client.builtin) {
          for (const grant of client.builtin.grants) evidence.push({ title: `Built-in ${grant.label}`, detail: `${grant.tools.map(t => t.tool).join(', ')} · ${grant.summary}` });
          const settings = client.builtin.settings;
          if (settings && settings.read) evidence.push({ title: 'Permission settings', detail: settings.found ? settings.files.filter(f => f.status === 'found').map(f => f.path).join(', ') : 'no settings file found; client defaults apply' });
        }
      }
    } else if (kind === 'server') {
      const server = serverById.get(node.recordId);
      if (server) evidence.push(...serverEvidence(server));
      for (const permission of (inventory.permissions || []).filter(p => p.integrationId === node.recordId)) {
        const scoped = /\(filesystem_access: (.+)\)$/.exec(permission.rawPermission || '');
        if (scoped) evidence.push({ title: 'File scope', detail: scoped[1] });
        if (permission.source && typeof permission.source.id === 'string' && permission.source.id.startsWith('tool-reach:')) evidence.push({ title: `Reach: ${permission.normalizedCategory.replace(/_/g, ' ')}`, detail: permission.normalizationReason });
      }
      const known = recognitionById.get(node.recordId);
      if (known) {
        const pin = known.pin === 'unpinned' ? ' · unpinned: runs whatever version is published at its next launch' : known.pin === 'pinned' ? ` · pinned ${known.identity.version}` : '';
        evidence.push({ title: 'Recognition', detail: known.recognized ? `recognized (${recognition.launchSummary(known, server)})${pin}` : `unrecognized: ${known.reasons.join(', ')} (${recognition.launchSummary(known, server)})${pin}. Boppi cannot tell what this server can do; it is in no path, which is not the same as safe.` });
      }
    } else if (node.entityType === 'permission') {
      const permission = permissionById.get(node.recordId);
      if (permission) {
        evidence.push({ title: 'How it was established', detail: permission.normalizationReason || 'declared in the scanned configuration' });
        evidence.push({ title: 'Access level', detail: `${permission.accessLevel || 'unknown'} · risk weight ${permission.riskWeight ?? 0}` });
        const grantor = serverById.get(permission.integrationId);
        if (grantor) evidence.push({ title: 'Granted by', detail: grantor.name });
      }
    }
    for (const edge of incoming.get(node.id) || []) {
      if (kind === 'agent') continue;
      evidence.push({ title: 'Reached from', detail: `${labelById.get(edge.fromEntityId) || edge.fromEntityId} (${edge.relationshipType.replace(/_/g, ' ')}; ${edge.evidenceClass}, confidence ${edge.confidence})` });
    }
    const pathIds = pathsByNode.get(node.id) || [];
    return {
      id: node.id, kind, entityType: node.entityType, label: node.label, recordId: node.recordId || null,
      agentId: kind === 'agent' ? node.id : (owner.get(node.id) || null),
      evidenceClass: node.evidenceClass || 'unknown', evidenceLabel:evidenceLabel(node.evidenceClass), confidence: node.confidence ?? null, stale: !!node.stale,
      evidence, detail, pathIds, severity: worstSeverity(pathIds),
    };
  });

  const edges = graph.edges.map(edge => ({
    id: edge.id, from: edge.fromEntityId, to: edge.toEntityId, kind: edge.relationshipType,
    evidenceClass: edge.evidenceClass, evidenceLabel:evidenceLabel(edge.evidenceClass), confidence: edge.confidence, stale: !!edge.stale,
  }));

  const pathIdsByKey = new Map();
  for (const pathItem of paths) {
    if (!pathIdsByKey.has(pathItem.exposureKey)) pathIdsByKey.set(pathItem.exposureKey, []);
    pathIdsByKey.get(pathItem.exposureKey).push(pathItem.id);
  }
  const keysToPathIds = keys => [...new Set((keys || []).flatMap(key => pathIdsByKey.get(key) || []))];

  const ranked = rankPredictions(report.predictions || [], paths);
  const remediations = ranked.map(entry => {
    const p = entry.prediction;
    const files = editFiles(p, discovery);
    const server = serverById.get(p.serverId);
    const eliminates = keysToPathIds(p.predictedEliminated);
    const survives = keysToPathIds(p.predictedSurviving);
    return {
      id: p.predictionId,
      action: p.edit.action,
      guided: p.edit.action === 'move_server',
      server: p.edit.server,
      serverId: p.serverId,
      agentId: p.agentId,
      clientKey: p.client.key,
      clientLabel: p.client.label,
      target: p.target ? { key: p.target.key, label: p.target.label, appears: p.target.predictedAppeared.length } : null,
      files,
      keyPath: `mcpServers.${JSON.stringify(p.edit.server)}`,
      entry: server ? { command: server.command, arguments: server.arguments, endpoint: server.endpoint, capabilities: server.capabilities, environmentVariableNames: server.environmentVariableNames } : null,
      eliminates, survives,
      eliminatedSeverity: entry.eliminatedSeverity,
      loses: p.disruption ? p.disruption.lost : [],
      keeps: p.disruption ? p.disruption.kept : [],
      previewHash: previewHash({ clientKey: p.client.key, server: p.edit.server, action: p.edit.action, target: p.target ? p.target.key : null, files: files.from, eliminatedExposureKeys: [...p.predictedEliminated].sort() }),
      command: fixCommand(p, report.scanArgs),
    };
  });

  const viewPaths = paths.map(pathItem => ({
    id: pathItem.id, exposureKey: pathItem.exposureKey, templateId: pathItem.templateId, category: pathItem.category,
    label: pathItem.label, severity: pathItem.severity, confidence: pathItem.confidence, stale: !!pathItem.stale,
    agentId: pathItem.agentId, agentName: pathItem.agentName,
    nodeIds: pathItem.nodes.map(n => n.id), edgeIds: pathItem.edges.map(e => e.id),
    chain: pathItem.nodes.map(n => n.label),
    explanation: pathItem.explanation, whyItMatters: pathItem.whyItMatters, remediation: pathItem.remediation, disclaimer: pathItem.disclaimer,
    evidenceCount: pathItem.evidenceCount,
    evidence: (pathItem.evidence || []).map(source => ({ name: source.name || source.id || 'evidence', evidenceClass: source.evidenceClass || 'unknown', evidenceLabel:evidenceLabel(source.evidenceClass), type: source.type || null, observedAt: source.observedAt || null })),
    remediationIds: remediations.filter(r => r.eliminates.includes(pathItem.id)).map(r => r.id),
  }));

  const plan = report.remediationPlan ? {
    steps: report.remediationPlan.steps.map(step => step.predictionId),
    targetedExposures: report.remediationPlan.targetedExposures,
    breaksAll: report.remediationPlan.breaksAll,
    residual: keysToPathIds(report.remediationPlan.residualExposureKeys),
  } : { steps: [], targetedExposures: 0, breaksAll: true, residual: [] };

  return {
    schemaVersion: 1,
    generatedAt: report.startedAt,
    version: report.version,
    disclaimer: exposurePathEngine.DISCLAIMER,
    scope: 'This graph is built from configuration metadata. It shows what the agents could reach, not what they did. Boppi did not observe any activity.',
    agents: (inventory.agents || []).map(a => ({ id: a.id, name: a.name, riskScore: a.riskScore ?? 0, riskLevel: a.riskLevel || 'low', serverIds: (inventory.mcpServers || []).filter(s => s.agentId === a.id).map(s => s.id) })),
    nodes, edges, paths: viewPaths, remediations, plan,
    capabilityLabels: Object.fromEntries([...new Set(remediations.flatMap(r => [...r.loses, ...r.keeps]).concat((inventory.mcpServers || []).flatMap(s => s.capabilities || []), (inventory.agents || []).flatMap(a => builtinCapabilities(inventory, a.id))))].map(id => [id, capabilityLabel(id)])),
    coverage: { filesRead: report.portableFilesRead || [], incomplete: report.incomplete || [] },
  };
}

/** The same view from a `boppi scan --json` export file, so a renderer needs no live scan. */
function viewFromExport(exported) {
  const inventory = exported.inventory && exported.inventory.real ? exported.inventory.real : (exported.inventory || {});
  const discovery = exported.discovery || { clients: [], filesRead: [] };
  return buildGraphView({
    version: (exported.generatedBy || '').split('/')[1] || null,
    startedAt: exported.exportedAt || null,
    inventory, graph: exported.graph, paths: exported.exposurePaths || [],
    discovery: discovery.clients || [], portableFilesRead: discovery.filesRead || [],
    predictions: exported.predictions || [], remediationPlan: exported.remediationPlan || null,
    recognition: exported.recognition || [],
    incomplete: (discovery.clients || []).filter(c => c.scanError || (c.files || []).some(f => f.status === 'unreadable')).map(c => c.label),
    scanArgs: exported.scanArgs || null,
  });
}

module.exports = { buildGraphView, viewFromExport, KINDS, kindOf, previewHash, editFiles, fixCommand, capabilityLabel, CAPABILITY_LABELS };
