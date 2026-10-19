/**
 * Boppi exposure-path engine.
 *
 * Walks the security graph with explicit, security-relevant path templates and
 * bounded, cycle-safe traversal. It complements the per-agent rule engine
 * (agentRiskEngine) — findings stay; paths add the evidenced multi-entity
 * chain and a prioritization layer.
 *
 * Language discipline: every result is a POTENTIAL exposure path built from
 * evidenced access relationships. Nothing here claims an attack occurred.
 */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : (typeof globalThis !== 'undefined' ? globalThis.BoppiAgentSecurityModels : null);
  const api = factory(models);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiExposurePathEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MAX_DEPTH = 6;
  const MAX_VISITED = 2000;
  const MAX_PATHS = 200;
  const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
  const LOW_CONFIDENCE = 0.4;
  const STALE_CONFIDENCE_FACTOR = 0.7;
  const DISCLAIMER = 'Not an execution trace. This path represents evidenced access relationships.';
  const IMPACT_RANK = Object.freeze({ production_system: 6, credential_reference: 5, data_category: 4, external_destination: 3, tool: 2 });

  const TEMPLATES = Object.freeze([
    {
      id: 'EP-A', category: 'data_exfiltration', severity: 'critical',
      label: 'Potential data exfiltration path',
      branches: ['sensitiveData', 'externalDestination'],
      impact: 'externalDestination',
      explanation: 'This agent can potentially read sensitive data and reach an external destination through evidenced capabilities.',
      whyItMatters: 'If this agent were compromised or misdirected, data it can read could potentially reach an untrusted external destination.',
      remediation: 'Remove external messaging or API access, or restrict the sensitive-data grants feeding this path.',
    },
    {
      id: 'EP-B', category: 'credential_exposure', severity: 'critical',
      label: 'Potential credential exposure path',
      branches: ['credential', 'execution', 'network'],
      impact: 'credential',
      explanation: 'This agent can potentially reach credential material while also holding code-execution and network capabilities.',
      whyItMatters: 'Credential references combined with execution and network access create a potential path for credential material to leave the environment.',
      remediation: 'Restrict shell or credential access and remove network capabilities this agent does not need.',
    },
    {
      id: 'EP-C', category: 'software_supply_chain', severity: 'critical',
      label: 'Potential software supply-chain path',
      branches: ['sourceModify', 'production'],
      impact: 'production',
      explanation: 'This agent can potentially modify source code and reach production systems.',
      whyItMatters: 'Code changes that can flow to production without human review are a software supply-chain exposure.',
      remediation: 'Separate source modification from production access and require approval for deployment actions.',
    },
    {
      id: 'EP-D', category: 'supply_chain_exposure', severity: 'high',
      label: 'Potential supply-chain exposure path',
      branches: ['unverifiedMcp', 'sensitiveData'],
      impact: 'sensitiveData',
      explanation: 'An explicitly unverified MCP server is connected to an agent that can also reach sensitive data.',
      whyItMatters: 'An unverified tool server expands this agent’s blast radius alongside its sensitive-data access.',
      remediation: 'Verify the MCP server, restrict its scope, or disconnect it. Review the MCP trust state.',
    },
    {
      id: 'EP-E', category: 'privilege', severity: 'high',
      label: 'Potential privilege path',
      branches: ['untrusted', 'privileged'],
      impact: 'privileged',
      explanation: 'This agent processes untrusted external content while holding privileged capabilities.',
      whyItMatters: 'Instructions hidden in untrusted content could potentially influence an agent with privileged local capabilities.',
      remediation: 'Isolate untrusted content from privileged tools, or remove shell, code-execution, or destructive file capabilities.',
    },
    {
      id: 'EP-F', category: 'impersonation', severity: 'high',
      label: 'Potential impersonation path',
      branches: ['emailRead', 'emailSend', 'browserContent'],
      impact: 'emailSend',
      explanation: 'This agent can read email, send outbound messages, and process browser or untrusted content.',
      whyItMatters: 'Externally influenced content could potentially steer an agent that can read and send email as its owner.',
      remediation: 'Require approval for outbound mail and restrict browser or untrusted-content access.',
    },
  ]);

  // Record ids are content hashes that differ between machines for the same configuration, so every tie is broken on labels first; ids only settle identical labels.
  function buildAdjacency(graph, nodesById = new Map((graph.nodes || []).map(n => [n.id, n]))) {
    const out = new Map();
    const label = id => (nodesById.get(id) || {}).label || '';
    for (const edge of graph.edges || []) {
      if (!out.has(edge.fromEntityId)) out.set(edge.fromEntityId, []);
      out.get(edge.fromEntityId).push(edge);
    }
    for (const list of out.values()) list.sort((a, b) => label(a.toEntityId).localeCompare(label(b.toEntityId)) || a.relationshipType.localeCompare(b.relationshipType) || a.id.localeCompare(b.id));
    return out;
  }

  /** Bounded, deterministic, cycle-safe BFS. Returns nodeId → ordered edge chain from root. */
  function reachFrom(rootId, adjacency) {
    const chains = new Map([[rootId, []]]);
    const queue = [rootId];
    let visited = 0;
    while (queue.length) {
      const currentId = queue.shift();
      const chain = chains.get(currentId);
      if (chain.length >= MAX_DEPTH) continue;
      for (const edge of adjacency.get(currentId) || []) {
        if (chains.has(edge.toEntityId)) continue; // cycle-safe: first (shortest) chain wins
        if (++visited > MAX_VISITED) return chains;
        chains.set(edge.toEntityId, [...chain, edge]);
        queue.push(edge.toEntityId);
      }
    }
    return chains;
  }

  function classifyReach(chains, nodesById) {
    const groups = {
      sensitiveData: [], anyData: [], credential: [], execution: [], network: [],
      externalDestination: [], production: [], sourceModify: [], untrusted: [],
      privileged: [], emailRead: [], emailSend: [], browserContent: [], unverifiedMcp: [],
    };
    for (const [nodeId, chain] of chains) {
      if (!chain.length) continue; // skip the root itself
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const category = node.metadata?.category || null;
      const entry = { nodeId, chain, label: node.label || '' };
      if (node.entityType === 'data_category') {
        groups.anyData.push(entry);
        if (node.metadata?.sensitive) groups.sensitiveData.push(entry);
        if (category === 'read_email') groups.emailRead.push(entry);
      } else if (node.entityType === 'capability') {
        if (['execute_code', 'run_shell_commands'].includes(category)) groups.execution.push(entry);
        if (['call_external_api', 'browse_internet'].includes(category)) groups.network.push(entry);
        if (['send_email', 'send_external_message'].includes(category)) groups.emailSend.push(entry);
        if (['browse_internet', 'browser_automation'].includes(category) || node.metadata?.untrusted) groups.browserContent.push(entry);
        if (node.metadata?.untrusted) groups.untrusted.push(entry);
        if (node.metadata?.privileged) groups.privileged.push(entry);
      } else if (node.entityType === 'credential_reference') {
        groups.credential.push(entry);
      } else if (node.entityType === 'external_destination') {
        groups.externalDestination.push(entry);
      } else if (node.entityType === 'production_system') {
        groups.production.push(entry);
      } else if (node.entityType === 'mcp_server' && node.metadata?.trustStatus === 'unverified') {
        // Explicit evidence only: an unknown trust state is uncertainty, not risk.
        groups.unverifiedMcp.push(entry);
      }
      if (node.entityType === 'capability' && category === 'modify_source_code') groups.sourceModify.push(entry);
    }
    for (const key of Object.keys(groups)) groups[key].sort((a, b) => a.chain.length - b.chain.length || a.label.localeCompare(b.label) || a.nodeId.localeCompare(b.nodeId));
    return groups;
  }

  /**
   * Identity of an exposure. The engine emits at most one path per template
   * per agent, so the pair is the unit. path.id is the route fingerprint and
   * changes when a different chain evidences the same exposure.
   */
  function exposureKey(path) { return `${path.templateId}:${path.agentId}`; }

  function assemblePath(template, agentNode, branches, nodesById, incomingUserEdge) {
    const orderedEdges = [];
    const seenEdges = new Set();
    if (incomingUserEdge) { orderedEdges.push(incomingUserEdge); seenEdges.add(incomingUserEdge.id); }
    for (const branch of branches) {
      for (const edge of branch.chain) {
        if (seenEdges.has(edge.id)) continue;
        seenEdges.add(edge.id);
        orderedEdges.push(edge);
      }
    }
    const orderedNodeIds = [];
    const seenNodes = new Set();
    const pushNode = id => { if (!seenNodes.has(id)) { seenNodes.add(id); orderedNodeIds.push(id); } };
    if (incomingUserEdge) pushNode(incomingUserEdge.fromEntityId);
    pushNode(agentNode.id);
    for (const edge of orderedEdges) { pushNode(edge.fromEntityId); pushNode(edge.toEntityId); }

    const pathNodes = orderedNodeIds.map(id => {
      const node = nodesById.get(id);
      return { id, entityType: node?.entityType || 'unknown', label: node?.label || id };
    });
    const confidences = orderedEdges.map(e => e.confidence).concat(pathNodes.map(n => nodesById.get(n.id)?.confidence ?? 0.5));
    const stale = orderedEdges.some(e => e.stale) || orderedNodeIds.some(id => nodesById.get(id)?.stale);
    let confidence = Math.round(Math.min(...confidences) * 1000) / 1000;
    if (stale) confidence = Math.round(confidence * STALE_CONFIDENCE_FACTOR * 1000) / 1000;
    // Low-confidence evidence never yields a critical path on its own.
    const rank = SEVERITY_RANK[template.severity];
    const severity = confidence < LOW_CONFIDENCE
      ? Object.keys(SEVERITY_RANK).find(k => SEVERITY_RANK[k] === Math.max(1, rank - 1))
      : template.severity;

    const sources = new Map();
    for (const edge of orderedEdges) if (edge.source?.id) sources.set(edge.source.id, edge.source);
    const dataset = orderedEdges.some(e => e.dataset === 'sample') || agentNode.dataset === 'sample' ? 'sample' : 'real';
    const firstSeenAt = orderedEdges.map(e => e.firstSeenAt).filter(Boolean).sort()[0] || null;
    const lastSeenAt = orderedEdges.map(e => e.lastSeenAt).filter(Boolean).sort().pop() || null;
    const impactBranch = branches.find(b => b.name === template.impact) || branches[branches.length - 1];

    return {
      schemaVersion: SCHEMA_VERSION,
      engineVersion: models.ENGINE_VERSION,
      id: models.stableId('path', [template.id, agentNode.id, orderedEdges.map(e => e.id).sort()]),
      exposureKey: exposureKey({ templateId: template.id, agentId: agentNode.id }),
      templateId: template.id,
      category: template.category,
      label: template.label,
      severity,
      baseSeverity: template.severity,
      agentId: agentNode.id,
      agentName: agentNode.label,
      sourceEntityId: pathNodes[0].id,
      impactEntityId: impactBranch.nodeId,
      nodes: pathNodes,
      edges: orderedEdges.map(e => ({ id: e.id, relationshipType: e.relationshipType, fromEntityId: e.fromEntityId, toEntityId: e.toEntityId, evidenceClass: e.evidenceClass, confidence: e.confidence, stale: e.stale })),
      evidence: [...sources.values()],
      evidenceCount: sources.size,
      confidence,
      stale,
      dataset,
      explanation: template.explanation,
      whyItMatters: template.whyItMatters,
      remediation: template.remediation,
      firstSeenAt,
      lastSeenAt,
      disclaimer: DISCLAIMER,
    };
  }

  /** Find exposure paths across the whole graph. Deterministic and bounded. */
  function findPaths(graph) {
    if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('Exposure path engine: graph is required');
    const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
    const adjacency = buildAdjacency(graph, nodesById);
    const userEdgesByAgent = new Map();
    for (const edge of graph.edges || []) {
      if (edge.relationshipType === 'user_uses_agent' && !userEdgesByAgent.has(edge.toEntityId)) userEdgesByAgent.set(edge.toEntityId, edge);
    }
    const agents = graph.nodes
      .filter(n => ['ai_application', 'ai_agent', 'coding_agent', 'autonomous_agent'].includes(n.entityType))
      .sort((a, b) => a.id.localeCompare(b.id));

    const paths = [];
    for (const agentNode of agents) {
      if (paths.length >= MAX_PATHS) break;
      const chains = reachFrom(agentNode.id, adjacency);
      const groups = classifyReach(chains, nodesById);
      for (const template of TEMPLATES) {
        if (paths.length >= MAX_PATHS) break;
        const branches = [];
        let satisfied = true;
        for (const name of template.branches) {
          const best = (groups[name] || [])[0];
          if (!best) { satisfied = false; break; }
          branches.push({ name, ...best });
        }
        if (!satisfied) continue;
        paths.push(assemblePath(template, agentNode, branches, nodesById, userEdgesByAgent.get(agentNode.id) || null));
      }
    }
    return paths.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || b.confidence - a.confidence || a.id.localeCompare(b.id));
  }

  /**
   * Evidenced transitive reach for one agent: everything a compromise of this
   * agent could reach through evidenced access relationships. Unknown
   * categories create no reach and are therefore absent, not counted.
   */
  function blastRadius(graph, agentId) {
    if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('Blast radius: graph is required');
    const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
    const agentNode = nodesById.get(agentId);
    if (!agentNode) throw new TypeError(`Blast radius: unknown agent ${agentId}`);
    if (!['ai_application', 'ai_agent', 'coding_agent', 'autonomous_agent'].includes(agentNode.entityType)) {
      throw new TypeError(`Blast radius: ${agentId} is not an agent node`);
    }
    const chains = reachFrom(agentId, buildAdjacency(graph, nodesById));
    const reachable = [];
    for (const [nodeId, chain] of chains) {
      if (!chain.length) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;
      const confidences = chain.map(e => e.confidence).concat(node.confidence ?? 0.5);
      const stale = chain.some(e => e.stale) || !!node.stale;
      let confidence = Math.round(Math.min(...confidences) * 1000) / 1000;
      if (stale) confidence = Math.round(confidence * STALE_CONFIDENCE_FACTOR * 1000) / 1000;
      reachable.push({
        nodeId,
        entityType: node.entityType,
        label: node.label,
        depth: chain.length,
        edgeIds: chain.map(e => e.id),
        evidenceClasses: [...new Set(chain.map(e => e.evidenceClass))].sort(),
        confidence,
        stale,
        dataset: node.dataset || 'real',
        sensitive: !!node.metadata?.sensitive,
        privileged: !!node.metadata?.privileged,
      });
    }
    reachable.sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId));
    const countsByType = {};
    for (const entry of reachable) countsByType[entry.entityType] = (countsByType[entry.entityType] || 0) + 1;
    return {
      schemaVersion: SCHEMA_VERSION,
      agentId,
      agentName: agentNode.label,
      total: reachable.length,
      maxDepth: reachable.reduce((max, entry) => Math.max(max, entry.depth), 0),
      countsByType,
      sensitiveDataCount: reachable.filter(e => e.entityType === 'data_category' && e.sensitive).length,
      credentialCount: countsByType.credential_reference || 0,
      productionCount: countsByType.production_system || 0,
      externalDestinationCount: countsByType.external_destination || 0,
      reachable,
      dataset: !reachable.length || reachable.every(e => e.dataset !== 'sample')
        ? 'real'
        : (reachable.every(e => e.dataset === 'sample') ? 'sample' : 'mixed'),
      disclaimer: DISCLAIMER,
      note: 'Evidenced reach only. Unknown categories create no reach and are not counted.',
    };
  }

  /** Aggregated prioritization: severity counts plus a per-agent rollup. */
  function prioritize(paths) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const byAgent = new Map();
    for (const path of paths || []) {
      counts[path.severity] = (counts[path.severity] || 0) + 1;
      if (!byAgent.has(path.agentId)) byAgent.set(path.agentId, []);
      byAgent.get(path.agentId).push(path);
    }
    const perAgent = [...byAgent.entries()].map(([agentId, agentPaths]) => {
      const sorted = [...agentPaths].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || b.confidence - a.confidence || a.id.localeCompare(b.id));
      const highest = sorted[0];
      const impact = sorted
        .map(p => p.nodes.find(n => n.id === p.impactEntityId))
        .filter(Boolean)
        .sort((a, b) => (IMPACT_RANK[b.entityType] || 0) - (IMPACT_RANK[a.entityType] || 0))[0] || null;
      return {
        agentId,
        agentName: highest.agentName,
        pathCount: agentPaths.length,
        highestPath: { id: highest.id, label: highest.label, severity: highest.severity },
        highestImpact: impact ? { entityType: impact.entityType, label: impact.label } : null,
        confidence: highest.confidence,
        stale: agentPaths.some(p => p.stale),
        dataset: agentPaths.every(p => p.dataset === 'sample') ? 'sample' : 'real',
      };
    }).sort((a, b) => (SEVERITY_RANK[b.highestPath.severity] || 0) - (SEVERITY_RANK[a.highestPath.severity] || 0) || b.confidence - a.confidence || a.agentId.localeCompare(b.agentId));
    return { counts, perAgent, total: (paths || []).length };
  }

  return { SCHEMA_VERSION, MAX_DEPTH, MAX_PATHS, TEMPLATES, DISCLAIMER, exposureKey, findPaths, prioritize, blastRadius };
});
