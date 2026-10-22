/**
 * Boppi risk rubric, version 1.
 *
 * Separates four things the old severity blended: the impact a template
 * describes, how strongly each branch of the path is evidenced, how wide the
 * access scope is, and the action priority that follows. The priority is the
 * template severity stepped down by the weakest branch: zero steps when the
 * strongest grant on that branch is established, one when it is potential,
 * two when it is assumed. Evidence confidence (how sure the scan is that a
 * relationship exists at all) stays a separate number on the path, and
 * likelihood of exploitation is never assessed here.
 *
 * Every output is a label or a sentence built from labels; nothing here
 * reads files, calls tools, or keeps a path.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiRiskRubric = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RUBRIC_VERSION = '1.0.1';
  const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
  const RANK_SEVERITY = Object.freeze({ 4: 'critical', 3: 'high', 2: 'medium', 1: 'low' });
  const STRENGTH = Object.freeze(['established', 'potential', 'assumed']);
  const MAX_STEPS = 2;

  const BRANCH_LABEL = Object.freeze({
    sensitiveData: 'reads data that may be sensitive', anyData: 'reads data', credential: 'reaches a credential reference',
    execution: 'can run code or commands', network: 'can reach the network', externalDestination: 'can reach an external destination',
    production: 'can change a production system', sourceModify: 'can change source code', untrusted: 'processes untrusted content',
    privileged: 'holds a privileged capability', emailRead: 'can read email', emailSend: 'can send email or messages',
    browserContent: 'processes browser or untrusted content', unverifiedMcp: 'uses an explicitly unverified MCP server',
  });
  const BASIS_TEXT = Object.freeze({
    configured: 'declared in the configuration', catalog: 'listed in the known-server catalog', builtin: 'the client\'s own built-in tool',
    inferred: 'inferred from the server name only', observed: 'declared in the configuration',
  });
  const GATE_TEXT = Object.freeze({ unprompted: 'never prompts', prompted: 'asks before each use', unknown: 'prompting not checked', denied: 'denied' });
  const SCOPE_TEXT = Object.freeze({
    system: 'a system-wide directory', home: 'the whole home directory', secrets: 'a dotfile or secrets folder', source: 'a source tree', other: 'one ordinary folder',
  });
  const ESTABLISHED_SENSITIVE = new Set(['read_email', 'access_customer_data', 'access_financial_data', 'access_health_data', 'access_hr_data']);
  const BROAD_SCOPES = new Set(['home', 'system', 'secrets']);

  function attributesOf(node) { return (node && node.metadata && node.metadata.attributes) || {}; }
  function basisOf(attributes, edgeOrNode) {
    if (attributes.basis) return attributes.basis;
    return (edgeOrNode && edgeOrNode.metadata && edgeOrNode.metadata.basis) || ((edgeOrNode && edgeOrNode.evidenceClass) === 'inferred' ? 'inferred' : 'configured');
  }

  /** One grant feeding a branch node: who grants it and the attributes that grade it. */
  function grantOf(edge, nodesById) {
    const grantor = nodesById.get(edge.fromEntityId);
    if (!grantor) return null;
    const attributes = attributesOf(grantor);
    return {
      grantorId: grantor.id,
      grantorType: grantor.entityType,
      label: grantor.label || grantor.id,
      basis: basisOf(attributes, grantor.entityType === 'permission' ? grantor : edge),
      gate: attributes.gate || null,
      scope: attributes.scope || null,
      scopeLabel: attributes.scopeLabel || null,
      environment: attributes.environment || null,
      credentialKind: attributes.credentialKind || (edge.metadata && edge.metadata.credentialKind) || (edge.relationshipType === 'mcp_references_credential' ? 'environment_name' : null),
      settingsRead: attributes.settingsRead,
      edge,
    };
  }

  /** Grants feeding a node. An external destination is reached through capabilities, so their grants are collected instead. */
  function grantsFor(node, incoming, nodesById, depth = 0, below = []) {
    const out = [];
    for (const edge of incoming.get(node.id) || []) {
      const grantor = nodesById.get(edge.fromEntityId);
      if (!grantor) continue;
      if (grantor.entityType === 'capability' && depth < 2) { out.push(...grantsFor(grantor, incoming, nodesById, depth + 1, [edge, ...below])); continue; }
      if (grantor.entityType === 'permission' || grantor.entityType === 'mcp_server' || grantor.entityType === 'integration' || grantor.entityType === 'oauth_grant') {
        const grant = grantOf(edge, nodesById);
        if (grant) out.push({ ...grant, route: [edge, ...below] });
      }
    }
    return out;
  }

  function sensitivitySteps(category, grant) {
    if (ESTABLISHED_SENSITIVE.has(category)) return 0;
    if (category === 'read_source_code') return 1;
    if (category === 'read_files') {
      if (grant.scope && BROAD_SCOPES.has(grant.scope)) return 0;
      if (grant.scope === 'source') return 1;
      return 2;
    }
    return 0;
  }

  /** Steps a single grant costs on a branch, with the reasons a reader needs. */
  function gradeGrant(branch, node, grant) {
    const reasons = [];
    let steps = 0;
    if (grant.basis === 'inferred') { steps += 1; reasons.push({ kind: 'assumption', text: `"${grant.label.split(' (')[0]}" is graded from its name, not from a tool list or catalog entry` }); }
    if (grant.gate === 'prompted') { steps += 1; reasons.push({ kind: 'assumption', text: `${grant.label} asks before each use; this path assumes a prompt could be approved` }); }
    if (grant.gate === 'unknown') { steps += 1; reasons.push({ kind: 'unknown', text: `whether the client asks before ${grant.label} is used was not checked` }); }
    if (node.entityType === 'data_category') {
      const category = node.metadata && node.metadata.category;
      const s = sensitivitySteps(category, grant);
      steps += s;
      if (s === 1 && category === 'read_source_code') reasons.push({ kind: 'assumption', text: 'source code is treated as potentially sensitive' });
      if (s === 1 && category === 'read_files') reasons.push({ kind: 'assumption', text: `the files in reach are ${SCOPE_TEXT.source}, treated as potentially sensitive` });
      if (s === 2) reasons.push({ kind: 'unknown', text: `which files ${grant.label.split(' (')[0]} can reach, and whether any are sensitive, was not established` });
      if (s === 0 && category === 'read_files' && grant.scope) reasons.push({ kind: 'fact', text: `the files in reach cover ${SCOPE_TEXT[grant.scope] || grant.scope}` });
    }
    if (node.entityType === 'production_system') {
      if (grant.environment === 'production') reasons.push({ kind: 'fact', text: 'the configuration names a production environment' });
      else if (grant.environment === 'non_production') { steps += 1; reasons.push({ kind: 'assumption', text: 'the configuration names a non-production environment; which system it really points at was not checked' }); }
      else if (grant.environment === 'unknown') { steps += 1; reasons.push({ kind: 'unknown', text: 'nothing in the configuration names the environment; the system is treated as production-capable' }); }
      else { steps += 1; reasons.push({ kind: 'unknown', text: 'the permission names a production system, but no tool list showed what it can change or which environment it reaches' }); }
    }
    if (node.entityType === 'credential_reference') {
      const kind = grant.credentialKind || ((node.metadata && node.metadata.category) === 'access_environment_variables' ? 'environment_name' : null);
      if (kind === 'environment_name') { steps += 1; reasons.push({ kind: 'assumption', text: 'a variable name suggests a credential; its value was not read and may not be reachable by the model' }); }
      else if (kind === 'infra_read') {
        steps += 1; reasons.push({ kind: 'unknown', text: 'read-only cluster or infrastructure tools can read secrets, state, and logs; whether the role allows that was not checked' });
        if (grant.environment === 'non_production') { steps += 1; reasons.push({ kind: 'assumption', text: 'the configuration names a non-production environment; which system it really points at was not checked' }); }
        else if (grant.environment === 'production') reasons.push({ kind: 'fact', text: 'the configuration names a production environment' });
      }
      else if (grant.scope && BROAD_SCOPES.has(grant.scope)) reasons.push({ kind: 'fact', text: `the files in reach cover ${SCOPE_TEXT[grant.scope]}, where credentials usually live` });
    }
    return { steps: Math.min(MAX_STEPS, steps), reasons };
  }

  function describeGrant(grant) {
    const parts = [BASIS_TEXT[grant.basis] || grant.basis];
    if (grant.gate) parts.push(GATE_TEXT[grant.gate] || grant.gate);
    return parts.join('; ');
  }

  /** The strongest grant on one branch, with its strength and the reasons. */
  function assessBranch(branch, node, incoming, nodesById, routeNodeIds) {
    const all = grantsFor(node, incoming, nodesById);
    const onRoute = routeNodeIds ? all.filter(g => routeNodeIds.has(g.edge.fromEntityId)) : [];
    const grants = onRoute.length ? onRoute : all;
    if (node.entityType === 'mcp_server') return { name: branch, label: BRANCH_LABEL[branch] || branch, node: node.label, strength: 'established', steps: 0, grantor: node.label, because: 'the configuration marks this server unverified', reasons: [] };
    let best = null;
    for (const grant of grants) {
      const graded = gradeGrant(branch, node, grant);
      if (!best || graded.steps < best.steps || (graded.steps === best.steps && grant.label.localeCompare(best.grant.label) < 0)) best = { grant, ...graded };
    }
    if (!best) return { name: branch, label: BRANCH_LABEL[branch] || branch, node: node.label, strength: 'assumed', steps: MAX_STEPS, grantor: null, because: 'no grant could be traced for this branch', reasons: [{ kind: 'unknown', text: `how the agent ${BRANCH_LABEL[branch] || branch} could not be traced to a grant` }] };
    return { name: branch, label: BRANCH_LABEL[branch] || branch, node: node.label, strength: STRENGTH[best.steps], steps: best.steps, grantor: best.grant.label, because: describeGrant(best.grant), reasons: best.reasons, gate: best.grant.gate, basis: best.grant.basis, route: best.grant.route };
  }

  /**
   * Assess one path. `branches` are { name, nodeId } in template order,
   * `incoming` maps node id to its in-edges, `nodesById` the graph index.
   */
  function assessPath({ template, agentNode, branches, incoming, nodesById }) {
    const assessed = branches.map(branch => assessBranch(branch.name, nodesById.get(branch.nodeId) || { id: branch.nodeId, entityType: 'unknown', label: branch.nodeId, metadata: {} }, incoming, nodesById, branch.routeNodeIds));
    const weakest = assessed.reduce((worst, b) => (b.steps > worst.steps ? b : worst), assessed[0]);
    const rank = Math.max(1, (SEVERITY_RANK[template.severity] || 1) - (weakest ? weakest.steps : 0));
    const facts = [];
    const assumptions = [];
    const unknowns = [];
    const push = (list, text) => { if (!list.includes(text)) list.push(text); };
    for (const branch of assessed) {
      if (branch.grantor) push(facts, `${branch.grantor}: ${branch.label} (${branch.because})`);
      for (const reason of branch.reasons) push(reason.kind === 'fact' ? facts : reason.kind === 'assumption' ? assumptions : unknowns, reason.text);
    }
    const builtin = assessed.filter(b => b.basis === 'builtin');
    if (builtin.length) {
      push(unknowns, 'managed (machine-wide) permission settings were not read');
      const scoped = builtin.map(b => { const branch = branches.find(x => x.name === b.name); return grantsFor(nodesById.get(branch.nodeId), incoming, nodesById).find(g => g.basis === 'builtin' && g.scopeLabel && (!branch.routeNodeIds || branch.routeNodeIds.has(g.edge.fromEntityId))); }).find(Boolean);
      if (scoped) push(assumptions, `${agentNode.label} is assumed to run from the scanned folder; ${scoped.scopeLabel}`);
    }
    if (assessed.some(b => b.basis && b.basis !== 'builtin')) push(unknowns, 'whether the client asks before each MCP tool call was not checked');
    push(unknowns, 'no tool call, data transfer, or attack was observed; this is configured potential access');
    return {
      rubricVersion: RUBRIC_VERSION,
      impact: template.severity,
      priority: RANK_SEVERITY[rank],
      weakestBranch: weakest ? weakest.name : null,
      weakestStrength: weakest ? weakest.strength : 'established',
      branches: assessed.map(b => ({ name: b.name, label: b.label, node: b.node, strength: b.strength, grantor: b.grantor, because: b.because })),
      facts,
      assumptions,
      unknowns,
      likelihood: 'not assessed',
    };
  }

  function buildIncoming(graph) {
    const incoming = new Map();
    for (const edge of graph.edges || []) {
      if (!incoming.has(edge.toEntityId)) incoming.set(edge.toEntityId, []);
      incoming.get(edge.toEntityId).push(edge);
    }
    for (const list of incoming.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return incoming;
  }

  return { RUBRIC_VERSION, STRENGTH, BRANCH_LABEL, assessPath, assessBranch, buildIncoming };
});
