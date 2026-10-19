/**
 * Boppi Agent Security normalized models.
 *
 * This module is deliberately independent from the browser extension runtime.
 * It accepts metadata only; secrets, tokens, environment values, and file
 * contents are rejected at the boundary.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentSecurityModels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  // Version of the analysis logic, independent of the npm package version.
  // Bump when ids, path semantics, templates, or inference change meaning.
  const ENGINE_VERSION = '1.0.0';
  const FORBIDDEN_KEY = /(token|secret|password|private[_-]?key|file[_-]?contents?|raw[_-]?contents?|env(?:ironment)?[_-]?values?)/i;
  const SECRET_VALUE = /(-----BEGIN [^-]*PRIVATE KEY-----|(?:sk|ghp|xox[baprs])-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+)/i;
  const SAFE_TRUST = new Set(['verified', 'unverified', 'unknown']);
  const SAFE_STATUS = new Set(['active', 'inactive', 'unknown', 'open', 'resolved', 'accepted', 'dismissed', 'acknowledged', 'assigned', 'in_progress', 'accepted_risk', 'false_positive']);
  const REMEDIATION_STATUS = new Set(['open', 'in_progress', 'completed', 'cancelled']);
  const HISTORY_LIMIT = 100;
  const EVIDENCE_CLASSES = new Set(['observed', 'imported', 'fixture', 'inferred']);
  const CAPABILITY_BASES = new Set(['configured', 'catalog', 'inferred', 'observed', 'verified']);

  function fail(message) { throw new TypeError(`Agent Security model: ${message}`); }
  function requiredString(value, field) {
    if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
    return value.trim();
  }
  function optionalString(value, field) {
    if (value == null || value === '') return null;
    return requiredString(value, field);
  }
  function timestamp(value, field) {
    if (value == null) return new Date().toISOString();
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) fail(`${field} must be a valid timestamp`);
    return d.toISOString();
  }
  function confidence(value) {
    if (value == null) return 0.5;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) fail('confidence must be between 0 and 1');
    return Math.round(n * 1000) / 1000;
  }
  function safeValue(value, path = 'record') {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (value.length > 2000) fail(`${path} is too large`);
      if (SECRET_VALUE.test(value)) fail(`${path} appears to contain secret material`);
      return value;
    }
    if (Array.isArray(value)) return value.map((v, i) => safeValue(v, `${path}[${i}]`));
    if (typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is prohibited`);
        out[key] = safeValue(child, `${path}.${key}`);
      }
      return out;
    }
    fail(`${path} contains an unsupported value`);
  }
  // Array order is identity: an edge from A to B is not the edge from B to A.
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${k}:${canonical(value[k])}`).join('|')}}`;
    return JSON.stringify(value ?? null);
  }
  function fnv1a32(text, offset) {
    let h = offset;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  // Two independent 32-bit FNV-1a passes give 64 bits without BigInt, so the
  // same function runs in the extension and in Node.
  function hash(value) {
    const text = String(value);
    return fnv1a32(text, 2166136261) + fnv1a32(text, 0x811c9dc5 ^ 0x5bd1e995);
  }
  function stableId(kind, identity) { return `${kind}_${hash(`${kind}:${canonical(identity)}`)}`; }
  function source(input) {
    if (!input || typeof input !== 'object') fail('source is required');
    const clean = safeValue(input, 'source');
    const inferredClass = clean.type === 'fixture' ? 'fixture' : clean.type === 'oauth' ? 'imported' : clean.type === 'browser' ? 'observed' : 'inferred';
    return {
      id: requiredString(clean.id || stableId('source', clean), 'source.id'),
      type: requiredString(clean.type || 'unknown', 'source.type'),
      evidenceClass: EVIDENCE_CLASSES.has(clean.evidenceClass) ? clean.evidenceClass : inferredClass,
      name: requiredString(clean.name || clean.type || 'Unknown source', 'source.name'),
      observedAt: timestamp(clean.observedAt, 'source.observedAt'),
      evidenceRef: optionalString(clean.evidenceRef, 'source.evidenceRef'),
      ...(Array.isArray(clean.previous) ? { previous: clean.previous.map(item => source(item)) } : {}),
    };
  }
  function base(input, kind, identity) {
    if (!input || typeof input !== 'object') fail(`${kind} input must be an object`);
    const clean = safeValue(input, kind);
    const created = timestamp(clean.createdAt, `${kind}.createdAt`);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: requiredString(clean.id || stableId(kind, identity(clean)), `${kind}.id`),
      createdAt: created,
      updatedAt: timestamp(clean.updatedAt || created, `${kind}.updatedAt`),
      source: source(clean.source),
    };
  }

  function agentIdentity(input) {
    return input.providerAgentId || input.deviceId && input.applicationId
      || input.accountId && input.applicationId
      || input.configFingerprint
      || `source:${String(input.source?.id || 'unknown').toLowerCase()}:${String(input.vendor || 'unknown').toLowerCase()}:${String(input.name || 'unknown').toLowerCase()}`;
  }
  function createAgent(input) {
    const clean = safeValue(input, 'agent');
    const out = {
      ...base(clean, 'agent', agentIdentity),
      name: requiredString(clean.name, 'agent.name'),
      type: requiredString(clean.type || 'unknown', 'agent.type'),
      vendor: optionalString(clean.vendor, 'agent.vendor'),
      owner: optionalString(clean.owner, 'agent.owner'),
      department: optionalString(clean.department, 'agent.department'),
      deviceId: optionalString(clean.deviceId, 'agent.deviceId'),
      version: optionalString(clean.version, 'agent.version'),
      trainingPosture: optionalString(clean.trainingPosture, 'agent.trainingPosture') || 'unknown',
      observationCount: Number.isFinite(Number(clean.observationCount)) ? Math.max(0, Number(clean.observationCount)) : 0,
      observedSites: Array.isArray(clean.observedSites) ? clean.observedSites.map(v => requiredString(v, 'agent.observedSites')) : [],
      status: SAFE_STATUS.has(clean.status) ? clean.status : 'unknown',
      riskScore: clean.riskScore == null ? 0 : Math.max(0, Math.min(100, Number(clean.riskScore))),
      riskLevel: clean.riskLevel || 'low',
      confidence: confidence(clean.confidence),
      firstSeenAt: timestamp(clean.firstSeenAt || clean.createdAt, 'agent.firstSeenAt'),
      lastSeenAt: timestamp(clean.lastSeenAt || clean.updatedAt || clean.createdAt, 'agent.lastSeenAt'),
      ownershipHistory: Array.isArray(clean.ownershipHistory) ? clean.ownershipHistory.map(safeValue) : [],
      stale: !!clean.stale,
    };
    if (!Number.isFinite(out.riskScore)) fail('agent.riskScore must be numeric');
    return out;
  }
  function createIntegration(input) {
    const clean = safeValue(input, 'integration');
    return {
      ...base(clean, 'integration', x => x.providerId || `${x.agentId}:${x.provider}:${x.accountLabel || ''}`),
      agentId: requiredString(clean.agentId, 'integration.agentId'),
      provider: requiredString(clean.provider || 'unknown', 'integration.provider'),
      accountLabel: optionalString(clean.accountLabel, 'integration.accountLabel'),
      connectionType: requiredString(clean.connectionType || 'unknown', 'integration.connectionType'),
      status: SAFE_STATUS.has(clean.status) ? clean.status : 'unknown',
      rawScopes: Array.isArray(clean.rawScopes) ? clean.rawScopes.map((v) => requiredString(v, 'integration.rawScopes')) : [],
      firstSeenAt: timestamp(clean.firstSeenAt || clean.createdAt, 'integration.firstSeenAt'),
      lastSeenAt: timestamp(clean.lastSeenAt || clean.updatedAt || clean.createdAt, 'integration.lastSeenAt'),
    };
  }
  function createPermission(input) {
    const clean = safeValue(input, 'permission');
    return {
      ...base(clean, 'permission', x => `${x.agentId}:${x.integrationId || ''}:${x.normalizedCategory}:${x.rawPermission || ''}`),
      agentId: requiredString(clean.agentId, 'permission.agentId'),
      integrationId: optionalString(clean.integrationId, 'permission.integrationId'),
      normalizedCategory: requiredString(clean.normalizedCategory || 'unknown', 'permission.normalizedCategory'),
      rawPermission: requiredString(clean.rawPermission || 'unknown', 'permission.rawPermission'),
      accessLevel: requiredString(clean.accessLevel || 'unknown', 'permission.accessLevel'),
      riskWeight: Number.isFinite(Number(clean.riskWeight)) ? Number(clean.riskWeight) : 0,
      normalizationConfidence: confidence(clean.normalizationConfidence),
      normalizationReason: requiredString(clean.normalizationReason || 'No mapping explanation supplied', 'permission.normalizationReason'),
    };
  }
  function createMCPServer(input) {
    const clean = safeValue(input, 'mcpServer');
    return {
      ...base(clean, 'mcpServer', x => x.serverId || `${x.agentId}:${x.name}:${x.configFingerprint || ''}`),
      agentId: requiredString(clean.agentId, 'mcpServer.agentId'),
      name: requiredString(clean.name, 'mcpServer.name'),
      command: optionalString(clean.command, 'mcpServer.command'),
      arguments: Array.isArray(clean.arguments) ? clean.arguments.map(v => requiredString(v, 'mcpServer.arguments')) : [],
      endpoint: optionalString(clean.endpoint, 'mcpServer.endpoint'),
      configPath: optionalString(clean.configPath, 'mcpServer.configPath'),
      exposedTools: Array.isArray(clean.exposedTools) ? clean.exposedTools.map(v => requiredString(v, 'mcpServer.exposedTools')) : [],
      capabilities: Array.isArray(clean.capabilities) ? clean.capabilities.map(v => requiredString(v, 'mcpServer.capabilities')) : [],
      capabilityEvidence: Array.isArray(clean.capabilityEvidence) ? clean.capabilityEvidence.map(e => ({
        capability: requiredString(e && e.capability, 'mcpServer.capabilityEvidence.capability'),
        basis: CAPABILITY_BASES.has(e && e.basis) ? e.basis : 'inferred',
        matched: optionalString(e && e.matched, 'mcpServer.capabilityEvidence.matched'),
      })) : [],
      filesystemPathCount: Number.isFinite(Number(clean.filesystemPathCount)) ? Math.max(0, Number(clean.filesystemPathCount)) : 0,
      environmentVariableNames: Array.isArray(clean.environmentVariableNames) ? clean.environmentVariableNames.map(v => requiredString(v, 'mcpServer.environmentVariableNames')) : [],
      credentialReferences: Array.isArray(clean.credentialReferences) ? clean.credentialReferences.map(v => requiredString(v, 'mcpServer.credentialReferences')) : [],
      dryRun: clean.dryRun !== false,
      trustStatus: SAFE_TRUST.has(clean.trustStatus) ? clean.trustStatus : 'unknown',
      riskScore: Math.max(0, Math.min(100, Number(clean.riskScore) || 0)),
      confidence: confidence(clean.confidence),
      firstSeenAt: timestamp(clean.firstSeenAt || clean.createdAt, 'mcpServer.firstSeenAt'),
      lastSeenAt: timestamp(clean.lastSeenAt || clean.updatedAt || clean.createdAt, 'mcpServer.lastSeenAt'),
    };
  }
  function createRiskFinding(input) {
    const clean = safeValue(input, 'riskFinding');
    return {
      ...base(clean, 'finding', x => `${x.agentId}:${x.ruleId}:${x.evidenceHash || ''}`),
      agentId: requiredString(clean.agentId, 'riskFinding.agentId'),
      ruleId: requiredString(clean.ruleId, 'riskFinding.ruleId'),
      ruleVersion: requiredString(clean.ruleVersion || '1', 'riskFinding.ruleVersion'),
      engineVersion: optionalString(clean.engineVersion, 'riskFinding.engineVersion') || ENGINE_VERSION,
      severity: requiredString(clean.severity || 'low', 'riskFinding.severity'),
      category: requiredString(clean.category || 'unknown', 'riskFinding.category'),
      title: requiredString(clean.title, 'riskFinding.title'),
      description: requiredString(clean.description, 'riskFinding.description'),
      contributingPermissions: Array.isArray(clean.contributingPermissions) ? clean.contributingPermissions.map(v => requiredString(v, 'riskFinding.contributingPermissions')) : [],
      evidence: Array.isArray(clean.evidence) ? clean.evidence.map(safeValue) : [],
      attackPath: requiredString(clean.attackPath, 'riskFinding.attackPath'),
      recommendation: requiredString(clean.recommendation, 'riskFinding.recommendation'),
      confidence: confidence(clean.confidence),
      evidenceClass: EVIDENCE_CLASSES.has(clean.evidenceClass) ? clean.evidenceClass : 'inferred',
      dataset: clean.dataset === 'sample' ? 'sample' : 'real',
      evidenceSource: clean.evidenceSource && typeof clean.evidenceSource === 'object' ? safeValue(clean.evidenceSource, 'riskFinding.evidenceSource') : null,
      status: SAFE_STATUS.has(clean.status) ? clean.status : 'open',
      firstSeenAt: timestamp(clean.firstSeenAt || clean.createdAt, 'riskFinding.firstSeenAt'),
      lastSeenAt: timestamp(clean.lastSeenAt || clean.updatedAt || clean.createdAt, 'riskFinding.lastSeenAt'),
      sourceScanId: optionalString(clean.sourceScanId, 'riskFinding.sourceScanId'),
      stale: !!clean.stale,
      // Workflow (M1). Preserved across engine regeneration by findingWorkflow.mergeFindings.
      ownerId: optionalString(clean.ownerId, 'riskFinding.ownerId'),
      assigneeId: optionalString(clean.assigneeId, 'riskFinding.assigneeId'),
      department: optionalString(clean.department, 'riskFinding.department'),
      dueAt: clean.dueAt ? timestamp(clean.dueAt, 'riskFinding.dueAt') : null,
      resolvedAt: clean.resolvedAt ? timestamp(clean.resolvedAt, 'riskFinding.resolvedAt') : null,
      resolution: clean.resolution && typeof clean.resolution === 'object' ? safeValue(clean.resolution, 'riskFinding.resolution') : null,
      reopenedCount: Number.isFinite(Number(clean.reopenedCount)) ? Math.max(0, Number(clean.reopenedCount)) : 0,
      history: Array.isArray(clean.history) ? clean.history.map(h => safeValue(h, 'riskFinding.history')).slice(-HISTORY_LIMIT) : [],
    };
  }
  function createLocalIdentity(input) {
    const clean = safeValue(input, 'localIdentity');
    // Identity key: email when available, otherwise name + creation time.
    // Display name alone is never the key — see PLATFORM-AUDIT §9/§23.
    const out = {
      ...base(clean, 'identity', x => x.email ? `email:${String(x.email).toLowerCase()}` : `local:${String(x.name || '').toLowerCase()}:${x.createdAt || ''}`),
      name: requiredString(clean.name, 'localIdentity.name'),
      email: optionalString(clean.email, 'localIdentity.email'),
      department: optionalString(clean.department, 'localIdentity.department'),
      team: optionalString(clean.team, 'localIdentity.team'),
      isSelf: !!clean.isSelf,
      // Reserved for Boppi Cloud: organization user id lands here at migration.
      externalRef: optionalString(clean.externalRef, 'localIdentity.externalRef'),
    };
    return out;
  }
  function createRemediationTask(input) {
    const clean = safeValue(input, 'remediationTask');
    const created = timestamp(clean.createdAt, 'remediationTask.createdAt');
    return {
      ...base(clean, 'remediation', x => `${x.findingId}:${x.title}:${x.createdAt || ''}`),
      findingId: requiredString(clean.findingId, 'remediationTask.findingId'),
      title: requiredString(clean.title, 'remediationTask.title'),
      description: optionalString(clean.description, 'remediationTask.description'),
      assigneeId: optionalString(clean.assigneeId, 'remediationTask.assigneeId'),
      status: REMEDIATION_STATUS.has(clean.status) ? clean.status : 'open',
      priority: ['critical', 'high', 'medium', 'low'].includes(clean.priority) ? clean.priority : 'medium',
      dueAt: clean.dueAt ? timestamp(clean.dueAt, 'remediationTask.dueAt') : null,
      completedAt: clean.completedAt ? timestamp(clean.completedAt, 'remediationTask.completedAt') : null,
      completionNote: optionalString(clean.completionNote, 'remediationTask.completionNote'),
      dataset: clean.dataset === 'sample' ? 'sample' : 'real',
      history: Array.isArray(clean.history) ? clean.history.map(h => safeValue(h, 'remediationTask.history')).slice(-HISTORY_LIMIT) : [],
    };
  }
  function createComment(input) {
    const clean = safeValue(input, 'comment');
    return {
      ...base(clean, 'comment', x => `${x.subjectKind}:${x.subjectId}:${x.createdAt || ''}:${String(x.body || '').slice(0, 40)}`),
      subjectKind: ['finding', 'remediation'].includes(clean.subjectKind) ? clean.subjectKind : fail('comment.subjectKind must be finding or remediation'),
      subjectId: requiredString(clean.subjectId, 'comment.subjectId'),
      authorId: optionalString(clean.authorId, 'comment.authorId'),
      authorName: optionalString(clean.authorName, 'comment.authorName'),
      body: requiredString(clean.body, 'comment.body'),
      dataset: clean.dataset === 'sample' ? 'sample' : 'real',
    };
  }
  function createScan(input) {
    const clean = safeValue(input, 'scan');
    return {
      ...base(clean, 'scan', x => `${x.startedAt || ''}:${(x.sourceIds || []).join(',')}`),
      startedAt: timestamp(clean.startedAt, 'scan.startedAt'),
      completedAt: clean.completedAt ? timestamp(clean.completedAt, 'scan.completedAt') : null,
      sourceIds: Array.isArray(clean.sourceIds) ? clean.sourceIds.map(v => requiredString(v, 'scan.sourceIds')) : [],
      status: requiredString(clean.status || 'unknown', 'scan.status'),
      recordCounts: clean.recordCounts && typeof clean.recordCounts === 'object' ? safeValue(clean.recordCounts) : {},
      errorSummary: optionalString(clean.errorSummary, 'scan.errorSummary'),
    };
  }
  function createScanSource(input) { return source(input); }

  function validateRecord(record, kind) {
    const validators = { agent: createAgent, integration: createIntegration, permission: createPermission, mcpServer: createMCPServer, riskFinding: createRiskFinding, scan: createScan, scanSource: createScanSource, localIdentity: createLocalIdentity, remediationTask: createRemediationTask, comment: createComment };
    if (!validators[kind]) fail(`unknown record kind ${kind}`);
    validators[kind](record);
    return true;
  }
  function mergeAgents(records) {
    const groups = new Map();
    for (const record of records || []) {
      const agent = createAgent(record);
      const key = agent.id;
      const current = groups.get(key);
      if (!current) { groups.set(key, agent); continue; }
      const ownerChanged = current.owner && agent.owner && current.owner !== agent.owner;
      const history = [...(current.ownershipHistory || [])];
      if (ownerChanged) history.push({ owner: current.owner, from: current.updatedAt, to: agent.updatedAt, source: current.source.id });
      groups.set(key, {
        ...current, ...agent,
        owner: agent.owner || current.owner,
        department: agent.department || current.department,
        firstSeenAt: new Date(Math.min(Date.parse(current.firstSeenAt), Date.parse(agent.firstSeenAt))).toISOString(),
        lastSeenAt: new Date(Math.max(Date.parse(current.lastSeenAt), Date.parse(agent.lastSeenAt))).toISOString(),
        ownershipHistory: history,
        source: current.source.id === agent.source.id ? current.source : { ...agent.source, previous: [current.source] },
      });
    }
    return [...groups.values()];
  }
  function dedupeById(records, factory) {
    const map = new Map();
    for (const item of records || []) { const value = factory(item); if (!map.has(value.id)) map.set(value.id, value); }
    return [...map.values()];
  }

  return { SCHEMA_VERSION, ENGINE_VERSION, EVIDENCE_CLASSES: [...EVIDENCE_CLASSES], HISTORY_LIMIT, stableId, createAgent, createIntegration, createPermission, createMCPServer, createRiskFinding, createScan, createScanSource, createLocalIdentity, createRemediationTask, createComment, validateRecord, mergeAgents, dedupeById, safeValue };
});
