/**
 * Boppi AI Security Graph builder.
 *
 * Deterministically converts the normalized Agent Security inventory into a
 * graph of nodes and evidence-backed edges. The graph is rebuilt from the
 * inventory on demand and never persisted separately; nodes reference
 * normalized records by their stable IDs. Only entities supported by current
 * evidence are created: a browser observation produces user/device/agent
 * nodes, never permission or capability edges.
 */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : (typeof globalThis !== 'undefined' ? globalThis.BoppiAgentSecurityModels : null);
  const api = factory(models);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiSecurityGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models) {
  'use strict';

  const SCHEMA_VERSION = 1;

  const ENTITY_TYPES = Object.freeze([
    'user', 'device', 'ai_application', 'ai_agent', 'coding_agent', 'autonomous_agent',
    'integration', 'oauth_grant', 'mcp_server', 'tool', 'permission', 'capability',
    'data_category', 'credential_reference', 'external_destination', 'production_system', 'unknown',
  ]);

  const RELATIONSHIP_TYPES = Object.freeze([
    'user_uses_agent', 'device_runs_agent', 'agent_connects_to_integration',
    'integration_grants_permission', 'agent_has_permission', 'agent_connects_to_mcp',
    'mcp_exposes_tool', 'mcp_grants_capability', 'mcp_references_credential',
    'permission_grants_capability', 'permission_grants_data_access',
    'permission_references_credential', 'permission_grants_production_access',
    'capability_reaches_external_destination',
  ]);

  const CAPABILITY_CATEGORIES = new Set([
    'execute_code', 'run_shell_commands', 'browse_internet', 'call_external_api',
    'send_external_message', 'send_email', 'browser_automation', 'make_purchase',
    'create_or_modify_records', 'modify_source_code', 'modify_calendar',
    'write_files', 'delete_files', 'untrusted_external_content',
  ]);
  const DATA_CATEGORIES = new Set([
    'read_files', 'read_email', 'read_calendar', 'read_source_code',
    'access_customer_data', 'access_financial_data', 'access_health_data', 'access_hr_data',
  ]);
  const CREDENTIAL_CATEGORIES = new Set(['access_credentials', 'access_environment_variables']);
  const PRODUCTION_CATEGORIES = new Set(['access_production_system']);
  const WRITE_SHAPED_LEVELS = new Set(['admin', 'write', 'broad']);
  const EXTERNAL_FACING = new Set(['browse_internet', 'call_external_api', 'send_external_message', 'send_email']);
  const SENSITIVE_DATA = new Set(['read_files', 'read_email', 'read_source_code', 'access_customer_data', 'access_financial_data', 'access_health_data', 'access_hr_data']);
  const PRIVILEGED_CAPABILITIES = new Set(['run_shell_commands', 'execute_code', 'delete_files', 'modify_source_code']);

  function fail(message) { throw new TypeError(`Security graph: ${message}`); }
  function stableId(kind, identity) {
    if (models) return models.stableId(kind, identity);
    fail('models module unavailable');
  }
  function datasetOf(record) {
    if (record?.dataset === 'sample') return 'sample';
    return record?.source?.evidenceClass === 'fixture' ? 'sample' : 'real';
  }
  function evidenceClassOf(record) { return record?.source?.evidenceClass || 'inferred'; }
  function withBasis(record, basis) {
    return basis === 'catalog' || basis === 'inferred'
      ? { ...record, confidence:Math.min(confidenceOf(record), 0.7), source:{ ...record.source, evidenceClass:'inferred' } }
      : record;
  }
  function evidenceSourceOf(record) {
    const s = record?.source || {};
    return { id: s.id || null, type: s.type || 'unknown', name: s.name || 'Unknown source', evidenceClass: s.evidenceClass || 'inferred' };
  }
  function confidenceOf(record, fallback = 0.5) {
    const value = Number(record?.confidence ?? record?.normalizationConfidence);
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : fallback;
  }
  function timeRange(record) {
    return {
      firstSeenAt: record?.firstSeenAt || record?.createdAt || null,
      lastSeenAt: record?.lastSeenAt || record?.updatedAt || record?.createdAt || null,
    };
  }
  function agentEntityType(agent) {
    const type = String(agent?.type || '').toLowerCase();
    if (type.includes('coding')) return 'coding_agent';
    if (type.includes('autonomous')) return 'autonomous_agent';
    if (type.includes('browser') || type.includes('application') || type.includes('assistant')) return 'ai_application';
    return 'ai_agent';
  }

  function createBuilder() {
    const nodes = new Map();
    const edges = new Map();

    function addNode(node) {
      const existing = nodes.get(node.id);
      if (!existing) { nodes.set(node.id, { schemaVersion: SCHEMA_VERSION, metadata: {}, ...node }); return nodes.get(node.id); }
      // Deterministic merge: keep highest confidence, stay stale only if all evidence is stale.
      existing.confidence = Math.max(existing.confidence, node.confidence);
      existing.stale = existing.stale && !!node.stale;
      return existing;
    }
    function addEdge(fromNode, toNode, relationshipType, record, metadata = {}) {
      if (!RELATIONSHIP_TYPES.includes(relationshipType)) fail(`unknown relationship type ${relationshipType}`);
      const id = stableId('edge', [fromNode.id, relationshipType, toNode.id]);
      const range = timeRange(record);
      const existing = edges.get(id);
      if (existing) {
        existing.confidence = Math.max(existing.confidence, confidenceOf(record));
        existing.stale = existing.stale && !!record?.stale;
        if (range.firstSeenAt && (!existing.firstSeenAt || range.firstSeenAt < existing.firstSeenAt)) existing.firstSeenAt = range.firstSeenAt;
        if (range.lastSeenAt && (!existing.lastSeenAt || range.lastSeenAt > existing.lastSeenAt)) existing.lastSeenAt = range.lastSeenAt;
        if (record?.id && !existing.metadata.evidenceRecordIds.includes(record.id)) existing.metadata.evidenceRecordIds.push(record.id);
        return existing;
      }
      const edge = {
        schemaVersion: SCHEMA_VERSION,
        id,
        fromEntityId: fromNode.id,
        fromEntityType: fromNode.entityType,
        toEntityId: toNode.id,
        toEntityType: toNode.entityType,
        relationshipType,
        source: evidenceSourceOf(record),
        evidenceClass: evidenceClassOf(record),
        confidence: confidenceOf(record),
        firstSeenAt: range.firstSeenAt,
        lastSeenAt: range.lastSeenAt,
        stale: !!record?.stale,
        dataset: datasetOf(record),
        metadata: { evidenceRecordIds: record?.id ? [record.id] : [], ...metadata },
      };
      edges.set(id, edge);
      return edge;
    }
    return { nodes, edges, addNode, addEdge };
  }

  function derivedNode(builder, kind, scopeId, key, entityType, label, record, metadata = {}) {
    return builder.addNode({
      id: stableId('gnode', [kind, scopeId, key]),
      entityType,
      label,
      recordId: record?.id || null,
      recordKind: kind,
      dataset: datasetOf(record),
      evidenceClass: evidenceClassOf(record),
      confidence: confidenceOf(record),
      stale: !!record?.stale,
      metadata,
    });
  }

  // Edges out of an MCP server carry the basis of the capability they evidence, so the rubric can grade a server grant without a permission record.
  function attachCategory(builder, agentNode, fromNode, category, record, edgeExtra = {}) {
    if (!category || category === 'unknown') return; // unknown never creates graph reach
    const agentScope = agentNode.id;
    const edgeMeta = { category, ...edgeExtra };
    if (CAPABILITY_CATEGORIES.has(category)) {
      const capability = derivedNode(builder, 'capability', agentScope, category, 'capability', category.replace(/_/g, ' '), record, {
        category,
        untrusted: category === 'untrusted_external_content',
        privileged: PRIVILEGED_CAPABILITIES.has(category),
        externalFacing: EXTERNAL_FACING.has(category),
      });
      const relationship = fromNode.entityType === 'mcp_server' ? 'mcp_grants_capability' : 'permission_grants_capability';
      builder.addEdge(fromNode, capability, relationship, record, edgeMeta);
      if (EXTERNAL_FACING.has(category)) {
        const destination = derivedNode(builder, 'external', agentScope, 'external_destination', 'external_destination', 'External destination', record, {});
        builder.addEdge(capability, destination, 'capability_reaches_external_destination', record, { category });
      }
      return;
    }
    if (DATA_CATEGORIES.has(category)) {
      const data = derivedNode(builder, 'data', agentScope, category, 'data_category', category.replace(/_/g, ' '), record, {
        category, sensitive: SENSITIVE_DATA.has(category),
      });
      builder.addEdge(fromNode, data, 'permission_grants_data_access', record, edgeMeta);
      return;
    }
    if (CREDENTIAL_CATEGORIES.has(category)) {
      const credential = derivedNode(builder, 'credential', agentScope, category, 'credential_reference', category.replace(/_/g, ' '), record, { category });
      builder.addEdge(fromNode, credential, 'permission_references_credential', record, edgeMeta);
      return;
    }
    if (PRODUCTION_CATEGORIES.has(category)) {
      // A production system is reached only when a tool list showed write access (demonstrated) or the permission carries a write-shaped access level (inferred). A name alone is a hint, recorded on the permission node and listed as an unknown.
      const attributes = (fromNode.metadata && fromNode.metadata.attributes) || {};
      const level = fromNode.metadata && fromNode.metadata.accessLevel;
      if (attributes.writeAccess !== true && !WRITE_SHAPED_LEVELS.has(level)) { fromNode.metadata.productionHint = true; return; }
      const production = derivedNode(builder, 'production', agentScope, category, 'production_system', 'Production system', record, { category });
      builder.addEdge(fromNode, production, 'permission_grants_production_access', record, edgeMeta);
    }
  }

  /** Every node whose name suggests production access without evidence of what it can change (a permission, or an imported server record); each is disclosed, never silently dropped. */
  function productionHints(graph) {
    return (graph.nodes || []).filter(n => n.metadata && n.metadata.productionHint).map(n => n.label);
  }

  /**
   * Build the graph from a normalized inventory
   * ({agents, integrations, permissions, mcpServers}).
   * Deterministic: identical evidence produces an identical logical graph.
   */
  function buildGraph(inventory, options = {}) {
    if (!inventory || typeof inventory !== 'object') fail('inventory is required');
    const normalizer = options.normalizer
      || (typeof require === 'function' ? require('./permissionNormalizer') : (typeof globalThis !== 'undefined' ? globalThis.BoppiPermissionNormalizer : null));
    const builder = createBuilder();
    const agentNodes = new Map();
    const integrationNodes = new Map();

    for (const agent of inventory.agents || []) {
      const agentNode = builder.addNode({
        id: agent.id,
        entityType: agentEntityType(agent),
        label: agent.name,
        recordId: agent.id,
        recordKind: 'agent',
        dataset: datasetOf(agent),
        evidenceClass: evidenceClassOf(agent),
        confidence: confidenceOf(agent),
        stale: !!agent.stale,
        metadata: { vendor: agent.vendor || null, agentType: agent.type || 'unknown', trainingPosture: agent.trainingPosture || 'unknown' },
      });
      agentNodes.set(agent.id, agentNode);
      if (agent.owner) {
        const user = derivedNode(builder, 'user', 'global', agent.owner.toLowerCase(), 'user', agent.owner, agent, {});
        builder.addEdge(user, agentNode, 'user_uses_agent', agent);
      }
      if (agent.deviceId) {
        const device = derivedNode(builder, 'device', 'global', agent.deviceId.toLowerCase(), 'device', agent.deviceId, agent, {});
        builder.addEdge(device, agentNode, 'device_runs_agent', agent);
      }
    }

    for (const integration of inventory.integrations || []) {
      const agentNode = agentNodes.get(integration.agentId);
      if (!agentNode) continue; // no orphan edges
      const node = builder.addNode({
        id: integration.id,
        entityType: integration.connectionType === 'oauth' ? 'oauth_grant' : 'integration',
        label: `${integration.provider}${integration.accountLabel ? ` (${integration.accountLabel})` : ''}`,
        recordId: integration.id,
        recordKind: 'integration',
        dataset: datasetOf(integration),
        evidenceClass: evidenceClassOf(integration),
        confidence: confidenceOf(integration),
        stale: !!integration.stale,
        metadata: { provider: integration.provider, connectionType: integration.connectionType },
      });
      integrationNodes.set(integration.id, node);
      builder.addEdge(agentNode, node, 'agent_connects_to_integration', integration);
    }

    for (const permission of inventory.permissions || []) {
      const agentNode = agentNodes.get(permission.agentId);
      if (!agentNode) continue;
      const permissionNode = builder.addNode({
        id: permission.id,
        entityType: 'permission',
        label: permission.rawPermission === 'unknown' ? permission.normalizedCategory.replace(/_/g, ' ') : permission.rawPermission,
        recordId: permission.id,
        recordKind: 'permission',
        dataset: datasetOf(permission),
        evidenceClass: evidenceClassOf(permission),
        confidence: confidenceOf(permission),
        stale: !!permission.stale,
        metadata: { category: permission.normalizedCategory, accessLevel: permission.accessLevel, riskWeight: permission.riskWeight || 0, attributes: { ...(permission.attributes || {}) } },
      });
      const grantor = permission.integrationId && integrationNodes.get(permission.integrationId);
      if (grantor) builder.addEdge(grantor, permissionNode, 'integration_grants_permission', permission);
      else builder.addEdge(agentNode, permissionNode, 'agent_has_permission', permission);
      attachCategory(builder, agentNode, permissionNode, permission.normalizedCategory, permission);
    }

    for (const server of inventory.mcpServers || []) {
      const agentNode = agentNodes.get(server.agentId);
      if (!agentNode) continue;
      const serverNode = builder.addNode({
        id: server.id,
        entityType: 'mcp_server',
        label: server.name,
        recordId: server.id,
        recordKind: 'mcpServer',
        dataset: datasetOf(server),
        evidenceClass: evidenceClassOf(server),
        confidence: confidenceOf(server),
        stale: !!server.stale,
        metadata: { trustStatus: server.trustStatus || 'unknown' },
      });
      builder.addEdge(agentNode, serverNode, 'agent_connects_to_mcp', server);
      for (const toolName of server.exposedTools || []) {
        const evidence = (server.toolEvidence || []).find(item => item.tool === toolName);
        const record = withBasis(server, evidence?.basis);
        const tool = derivedNode(builder, 'tool', server.id, toolName.toLowerCase(), 'tool', toolName, record, {});
        builder.addEdge(serverNode, tool, 'mcp_exposes_tool', record);
      }
      for (const raw of server.capabilities || []) {
        const category = normalizer ? normalizer.normalize(raw).normalizedCategory : 'unknown';
        const evidence = (server.capabilityEvidence || []).find(item => item.capability === raw);
        attachCategory(builder, agentNode, serverNode, category, withBasis(server, evidence?.basis), {
          ...(evidence?.basis ? { basis: evidence.basis } : {}),
          ...(CREDENTIAL_CATEGORIES.has(category) ? { credentialKind: (server.credentialReferences || []).length ? 'environment_name' : 'capability' } : {}),
        });
      }
      for (const reference of server.credentialReferences || []) {
        const credential = derivedNode(builder, 'credential', agentNode.id, `mcp:${reference.toLowerCase()}`, 'credential_reference', reference, server, { referenceName: reference });
        builder.addEdge(serverNode, credential, 'mcp_references_credential', server);
      }
    }

    const nodeList = [...builder.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edgeList = [...builder.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      schemaVersion: SCHEMA_VERSION,
      nodes: nodeList,
      edges: edgeList,
      builtFrom: {
        agents: (inventory.agents || []).length,
        integrations: (inventory.integrations || []).length,
        permissions: (inventory.permissions || []).length,
        mcpServers: (inventory.mcpServers || []).length,
      },
    };
  }

  return {
    SCHEMA_VERSION, ENTITY_TYPES, RELATIONSHIP_TYPES,
    CAPABILITY_CATEGORIES: [...CAPABILITY_CATEGORIES], DATA_CATEGORIES: [...DATA_CATEGORIES],
    SENSITIVE_DATA: [...SENSITIVE_DATA], EXTERNAL_FACING: [...EXTERNAL_FACING],
    PRIVILEGED_CAPABILITIES: [...PRIVILEGED_CAPABILITIES],
    buildGraph, productionHints,
  };
});
