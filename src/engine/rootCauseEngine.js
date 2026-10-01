/**
 * Boppi root-cause and what-if remediation engine.
 *
 * The product thesis: don't hand a team 73 findings — show the single change
 * that breaks the most attack paths, prove it breaks them, and show what
 * remains. (Grounded in docs/research/TOXIC_COMBINATIONS.md.)
 *
 * This module is a deterministic layer over the security graph and the exposure
 * path engine. It never invents a claim: "removing X breaks N paths" is
 * computed by ACTUALLY removing X from the graph and re-running the exact same
 * bounded path finder, then comparing exposure keys (template:agent). A path
 * id is a route fingerprint; a second route to the same exposure is not an
 * elimination. What survives is what survives.
 *
 * Three capabilities:
 *   simulateNodeRemoval(graph, ids)      — pure: a graph with nodes+edges gone
 *   clusterRootCauses(graph, paths)      — rank remediable elements by paths they
 *                                          actually eliminate (verified by re-run)
 *   recommendRemediationPlan(graph,paths)— greedy minimal fix set that breaks all
 *                                          targeted paths (correct cover, approx. minimal)
 *
 * Language discipline mirrors exposurePathEngine: every path is a POTENTIAL
 * exposure path. A root cause "eliminates" a path in the evidenced model; it is
 * not a claim that an attack was underway.
 */
(function (root, factory) {
  const paths = typeof require === 'function' ? require('./exposurePathEngine') : (typeof globalThis !== 'undefined' ? globalThis.BoppiExposurePathEngine : null);
  const api = factory(paths);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiRootCauseEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (exposurePaths) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

  // Graph elements a human can actually remediate. Excludes the agent itself
  // (removing the agent is not a fix), the user/device (context, not exposure),
  // external_destination and data_category (you remove the ACCESS to data or the
  // reach to a destination, i.e. the capability/permission — which are listed).
  const REMEDIABLE = new Set(['mcp_server', 'capability', 'permission', 'credential_reference', 'integration', 'oauth_grant', 'tool']);

  function fail(message) { throw new TypeError(`Root-cause engine: ${message}`); }

  /** Pure: a shallow-cloned graph with the given node ids and their incident edges removed. */
  function simulateNodeRemoval(graph, removeIds) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('a built graph is required');
    const remove = removeIds instanceof Set ? removeIds : new Set(removeIds || []);
    return {
      ...graph,
      nodes: graph.nodes.filter(n => !remove.has(n.id)),
      edges: graph.edges.filter(e => !remove.has(e.fromEntityId) && !remove.has(e.toEntityId)),
    };
  }

  function severityWeight(pathList) {
    return pathList.reduce((sum, p) => sum + (SEVERITY_RANK[p.severity] || 0), 0);
  }
  function severityBreakdown(pathList) {
    const out = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const p of pathList) out[p.severity] = (out[p.severity] || 0) + 1;
    return out;
  }

  const RESCAN = 'Rescan afterward to verify the change landed.';

  // A capability is not edited directly: the fix is removing whichever server
  // or permission grants it. When the graph evidences that grantor, name it so
  // the instruction is executable instead of advisory.
  function labelAndRemediation(node, agentName, grantors) {
    const who = agentName || 'this agent';
    const list = Array.isArray(grantors) ? grantors : [];
    const servers = list.filter(g => g.entityType === 'mcp_server');
    const permissions = list.filter(g => g.entityType === 'permission');
    switch (node.entityType) {
      case 'mcp_server':
        return { label: `MCP server "${node.label}"`, remediation: `Remove or verify the server entry "${node.label}" in ${who}'s MCP configuration. ${RESCAN}` };
      case 'capability': {
        const label = `${who}: ${node.label} capability`;
        if (servers.length) {
          const names = servers.map(g => `"${g.label}"`).join(' and ');
          const entryWord = servers.length === 1 ? 'the server entry' : 'the server entries';
          return { label, remediation: `Remove ${entryWord} ${names} from ${who}'s MCP configuration to revoke its "${node.label}" grant. ${RESCAN}` };
        }
        if (permissions.length) {
          const names = permissions.map(g => `"${g.label}"`).join(' and ');
          return { label, remediation: `Revoke or narrow the permission ${names} on ${who}, which grants "${node.label}". ${RESCAN}` };
        }
        return { label, remediation: `Remove the "${node.label}" capability from ${who} by scoping or disabling the granting server or permission. ${RESCAN}` };
      }
      case 'credential_reference':
        return { label: `Credential reference "${node.label}"`, remediation: `Remove the credential reference "${node.label}" from ${who}'s configuration, or move it to a scoped secret store. ${RESCAN}` };
      case 'permission':
        return { label: `Permission "${node.label}"`, remediation: `Revoke or narrow the permission "${node.label}" granted to ${who}. ${RESCAN}` };
      case 'integration':
      case 'oauth_grant':
        return { label: `Grant "${node.label}"`, remediation: `Reduce or revoke the "${node.label}" grant on ${who}. ${RESCAN}` };
      case 'tool':
        return { label: `Tool "${node.label}"`, remediation: `Remove or restrict the "${node.label}" tool on ${who}. ${RESCAN}` };
      default:
        return { label: node.label || node.id, remediation: `Review and restrict "${node.label || node.id}". ${RESCAN}` };
    }
  }

  /**
   * Rank remediable graph elements by the exposure paths they actually
   * eliminate. Each candidate's eliminated set is verified by removing it and
   * re-running the path finder — not merely counting participation.
   */
  function clusterRootCauses(graph, baselinePaths, options = {}) {
    if (!exposurePaths) fail('exposurePathEngine unavailable');
    if (!graph || !Array.isArray(graph.nodes)) fail('a built graph is required');
    const baseline = Array.isArray(baselinePaths) ? baselinePaths : exposurePaths.findPaths(graph);
    if (!baseline.length) return { schemaVersion: SCHEMA_VERSION, totalPaths: 0, causes: [] };

    const baselineKeys = new Set(baseline.map(p => p.exposureKey));
    const agentNameForNode = new Map();
    const candidateIds = new Set();
    for (const path of baseline) {
      for (const node of path.nodes) {
        if (!agentNameForNode.has(node.id)) agentNameForNode.set(node.id, path.agentName);
        if (REMEDIABLE.has(node.entityType)) candidateIds.add(node.id);
      }
    }
    const nodesById = new Map(graph.nodes.map(n => [n.id, n]));

    const grantorsByCapability = new Map();
    for (const edge of graph.edges) {
      if (edge.relationshipType !== 'mcp_grants_capability' && edge.relationshipType !== 'permission_grants_capability') continue;
      const grantor = nodesById.get(edge.fromEntityId);
      if (!grantor) continue;
      if (!grantorsByCapability.has(edge.toEntityId)) grantorsByCapability.set(edge.toEntityId, []);
      grantorsByCapability.get(edge.toEntityId).push(grantor);
    }

    const causes = [];
    for (const nodeId of candidateIds) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const reduced = simulateNodeRemoval(graph, new Set([nodeId]));
      const survivingKeys = new Set(exposurePaths.findPaths(reduced).map(p => p.exposureKey));
      const eliminated = baseline.filter(p => !survivingKeys.has(p.exposureKey));
      if (!eliminated.length) continue;
      const grantors = grantorsByCapability.get(nodeId) || [];
      const agentName = agentNameForNode.get(nodeId);
      const { label, remediation } = labelAndRemediation(node, agentName, grantors);
      causes.push({
        nodeId,
        entityType: node.entityType,
        recordId: node.recordId || null,
        recordKind: node.recordKind || null,
        label,
        remediation,
        agentName: agentName || null,
        grantingServers: grantors
          .filter(g => g.entityType === 'mcp_server')
          .map(g => ({ nodeId: g.id, recordId: g.recordId || null, label: g.label }))
          .sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
        eliminatedExposureKeys: eliminated.map(p => p.exposureKey).sort(),
        eliminatedPathIds: eliminated.map(p => p.id).sort(),
        eliminatedCount: eliminated.length,
        eliminatedSeverity: severityBreakdown(eliminated),
        eliminatedWeight: severityWeight(eliminated),
        residualCount: baseline.length - eliminated.length,
        evidenceClass: node.evidenceClass || 'inferred',
        confidence: node.confidence ?? null,
        dataset: node.dataset || 'real',
      });
    }

    causes.sort((a, b) =>
      (b.eliminatedSeverity.critical - a.eliminatedSeverity.critical) ||
      (b.eliminatedWeight - a.eliminatedWeight) ||
      (b.eliminatedCount - a.eliminatedCount) ||
      a.nodeId.localeCompare(b.nodeId));

    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : causes.length;
    return { schemaVersion: SCHEMA_VERSION, totalPaths: baseline.length, totalExposureKeys: [...baselineKeys].sort(), totalPathIds: baseline.map(p => p.id).sort(), causes: causes.slice(0, limit) };
  }

  /**
   * Greedy minimal fix set: the fewest remediations that break every targeted
   * path. Uses each candidate's verified single-removal elimination set; the
   * union of chosen sets provably covers the targeted paths (removing an element
   * never un-breaks an already-broken path), so the plan is a CORRECT cover.
   * It is approximately minimal (greedy set cover), not provably minimal.
   */
  function recommendRemediationPlan(graph, baselinePaths, options = {}) {
    const cluster = clusterRootCauses(graph, baselinePaths);
    if (!cluster.totalPaths) return { schemaVersion: SCHEMA_VERSION, targetedPaths: 0, steps: [], residualExposureKeys: [], residualPathIds: [], breaksAll: true };

    const severityFloor = options.severityFloor && SEVERITY_RANK[options.severityFloor] ? SEVERITY_RANK[options.severityFloor] : 1;
    const baseline = Array.isArray(baselinePaths) ? baselinePaths : exposurePaths.findPaths(graph);
    const pathIdByKey = new Map(baseline.map(p => [p.exposureKey, p.id]));
    const targeted = new Set(baseline.filter(p => (SEVERITY_RANK[p.severity] || 0) >= severityFloor).map(p => p.exposureKey));
    if (!targeted.size) return { schemaVersion: SCHEMA_VERSION, targetedPaths: 0, steps: [], residualExposureKeys: [], residualPathIds: [], breaksAll: true };

    const remaining = new Set(targeted);
    const pool = cluster.causes.map(c => ({ ...c, eliminatedSet: new Set(c.eliminatedExposureKeys) }));
    const steps = [];
    while (remaining.size) {
      let best = null, bestGain = 0;
      for (const cause of pool) {
        if (steps.some(s => s.nodeId === cause.nodeId)) continue;
        let gain = 0;
        for (const id of cause.eliminatedSet) if (remaining.has(id)) gain++;
        if (gain > bestGain || (gain === bestGain && gain > 0 && best && cause.nodeId.localeCompare(best.nodeId) < 0)) { best = cause; bestGain = gain; }
      }
      if (!best || bestGain === 0) break; // no candidate reduces the remaining set further
      const newlyBroken = [...remaining].filter(key => best.eliminatedSet.has(key)).sort();
      for (const key of newlyBroken) remaining.delete(key);
      steps.push({ nodeId: best.nodeId, entityType: best.entityType, label: best.label, remediation: best.remediation, agentName: best.agentName || null, grantingServers: best.grantingServers || [], breaksTargetedCount: newlyBroken.length, breaksTargetedExposureKeys: newlyBroken, breaksTargetedPathIds: newlyBroken.map(key => pathIdByKey.get(key)).sort() });
    }
    const residual = [...remaining].sort();
    return {
      schemaVersion: SCHEMA_VERSION,
      targetedPaths: targeted.size,
      severityFloor: options.severityFloor || 'low',
      steps,
      residualExposureKeys: residual,
      residualPathIds: residual.map(key => pathIdByKey.get(key)).sort(),
      breaksAll: remaining.size === 0,
    };
  }

  return { SCHEMA_VERSION, REMEDIABLE: [...REMEDIABLE], simulateNodeRemoval, clusterRootCauses, recommendRemediationPlan };
});
