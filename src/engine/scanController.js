/**
 * Agent Security scan controller.
 * Providers return metadata; this controller owns normalization, risk,
 * persistence, lifecycle events, and sample/real separation.
 */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : globalThis.BoppiAgentSecurityModels;
  const risk = typeof require === 'function' ? require('./agentRiskEngine') : globalThis.BoppiAgentRiskEngine;
  const storageApi = typeof require === 'function' ? require('./agentSecurityStorage') : globalThis.BoppiAgentSecurityStorage;
  const observationApi = typeof require === 'function' ? require('./browserObservationStore') : globalThis.BoppiAgentSecurityBrowserObservationStore;
  const registryApi = typeof require === 'function' ? require('./providerRegistry') : globalThis.BoppiAgentSecurityProviderRegistry;
  const workflow = typeof require === 'function' ? require('./findingWorkflow') : globalThis.BoppiFindingWorkflow;
  const api = factory(models, risk, storageApi, observationApi, registryApi, workflow);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentSecurityScanController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models, risk, storageApi, observationApi, registryApi, workflow) {
  'use strict';
  const STALE_MS = Object.freeze({ observed:30 * 86400000, imported:14 * 86400000, inferred:30 * 86400000 });
  const CONTROLLER_SOURCE = { id:'scan-controller', type:'controller', evidenceClass:'inferred', name:'Boppi scan controller', observedAt:'2026-01-01T00:00:00.000Z', evidenceRef:'normalized provider output' };
  function nowIso(clock) { return new Date((clock || Date).now()).toISOString(); }
  function sanitizeErrorCode(error, fallback = 'provider_failed') {
    const message = String(error?.code || error?.message || error || '').toLowerCase();
    if (message.includes('quota') || message.includes('storage')) return 'storage_unavailable';
    if (message.includes('permission') || message.includes('denied')) return 'provider_permission_denied';
    if (message.includes('timeout')) return 'provider_timeout';
    if (message.includes('invalid') || message.includes('malformed') || message.includes('schema')) return 'invalid_provider_data';
    return fallback;
  }
  function sourceClass(record) {
    if (record?.dataset === 'sample') return 'fixture';
    return record?.evidenceClass || record?.source?.evidenceClass || 'inferred';
  }
  function isStale(record, now) {
    const cls = sourceClass(record);
    if (cls === 'fixture') return false;
    const last = Date.parse(record?.lastSeenAt || record?.updatedAt || 0);
    return !Number.isFinite(last) || (now - last) > (STALE_MS[cls] || STALE_MS.inferred);
  }
  function safeEvent(type, fields, timestamp) {
    const allowed = new Set(['scanId','providerId','agentId','findingId','status','reason','count','evidenceClass','stale','requestedBy','dataset','remediationId','verification','actorId']);
    const out = { schemaVersion:models.SCHEMA_VERSION, type, timestamp };
    for (const [key, value] of Object.entries(fields || {})) if (allowed.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) out[key] = value;
    return out;
  }
  function inventoryRecords(bucket) { return ['agents','integrations','permissions','mcpServers','findings'].flatMap(key => bucket[key] || []); }
  function mergeInventory(previous, incoming, now, eventSink) {
    const agents = models.mergeAgents([...(previous.agents || []), ...(incoming.agents || [])]).map(agent => ({ ...agent, stale:isStale(agent, Date.parse(now)) }));
    const agentIds = new Set(agents.map(a => a.id));
    const integrations = models.dedupeById([...(previous.integrations || []), ...(incoming.integrations || [])], models.createIntegration).filter(x => agentIds.has(x.agentId));
    const permissions = models.dedupeById([...(previous.permissions || []), ...(incoming.permissions || [])], models.createPermission).filter(x => agentIds.has(x.agentId));
    const mcpServers = models.dedupeById([...(previous.mcpServers || []), ...(incoming.mcpServers || [])], models.createMCPServer).filter(x => agentIds.has(x.agentId));
    // Workflow-aware merge: preserves ownership/assignment/history and reopens
    // resolved findings whose evidence returned.
    const merged = workflow.mergeFindings(previous.findings || [], incoming.findings || [], Date.parse(now));
    if (eventSink) for (const event of merged.events) eventSink.push(safeEvent(event.type, event.fields, now));
    return { agents, integrations, permissions, mcpServers, findings:merged.findings };
  }
  function reconcileFindings(previous, incoming, scannedAgentIds, now, eventSink) {
    const activeIds = new Set((incoming.findings || []).map(f => f.id));
    // VERIFIED resolution: the agent was re-scanned and the rule no longer triggers.
    const verified = workflow.verifyResolveAbsent(previous.findings || [], activeIds, scannedAgentIds, Date.parse(now));
    if (eventSink) for (const event of verified.events) eventSink.push(safeEvent(event.type, event.fields, now));
    return { ...incoming, findings:[...(incoming.findings || []), ...verified.findings] };
  }
  function createScanController(options = {}) {
    const registry = options.registry || registryApi.createProviderRegistry(options.providers || []);
    const storage = options.storage || storageApi.createStorage(options.adapter);
    const observations = options.observationStore || (observationApi && observationApi.createStore ? observationApi.createStore(options.adapter || storage.adapter) : null);
    const clock = options.clock || Date;
    let scanInProgress = false;
    async function performScan(request = {}) {
      const startedAt = nowIso(clock);
      const requestedBy = typeof request.requestedBy === 'string' && request.requestedBy.trim() ? request.requestedBy.trim() : 'local-user';
      const prior = await storage.load();
      const context = { ...(request.context || {}), includeSampleData:request.includeSampleData === true };
      const providerIds = Array.isArray(request.providerIds) && request.providerIds.length ? request.providerIds : registry.list().map(p => p.id);
      let observationError = null;
      if (!request.context && observations && providerIds.includes('browser-ai-usage')) {
        try {
          const observationState = await observations.load();
          context.browserObservations = observationState.observations;
        } catch (error) {
          observationError = sanitizeErrorCode(error, 'observation_store_unavailable');
          context.browserObservations = [];
        }
      }
      const providerResults = [], incoming = { agents:[], integrations:[], permissions:[], mcpServers:[], findings:[] };
      let failures = 0, availableCount = 0;
      for (const providerId of providerIds) {
        const provider = registry.get(providerId);
        if (!provider) { failures++; providerResults.push({ providerId, status:'failed', error:'provider_not_registered' }); continue; }
        if (providerId === 'browser-ai-usage' && observationError) {
          failures++;
          providerResults.push({ providerId, status:'failed', error:observationError });
          continue;
        }
        try {
          const available = await provider.isAvailable(context);
          if (!available) { providerResults.push({ providerId, status:'unavailable' }); continue; }
          availableCount++;
          const raw = await provider.scan(context);
          const normalized = await provider.normalize(raw, { ...context, now:startedAt });
          for (const key of ['agents','integrations','permissions','mcpServers']) if (Array.isArray(normalized[key])) incoming[key].push(...normalized[key]);
          providerResults.push({ providerId, status:'completed', diagnostics:Array.isArray(normalized.diagnostics) ? normalized.diagnostics : [] });
        } catch (error) {
          failures++;
          providerResults.push({ providerId, status:'failed', error:sanitizeErrorCode(error) });
        }
      }
      const scanId = models.stableId('scan', [startedAt, providerIds]);
      const staged = { ...incoming, findings:[] };
      const allAgents = models.mergeAgents(staged.agents);
      for (const agent of allAgents) {
        const permissions = staged.permissions.filter(p => p.agentId === agent.id);
        const mcpServers = staged.mcpServers.filter(s => s.agentId === agent.id);
        const assessed = risk.assess(agent, permissions, mcpServers, { sourceScanId:scanId, now:startedAt, stale:isStale(agent, Date.parse(startedAt)) });
        const updated = models.createAgent({ ...agent, riskScore:assessed.score, riskLevel:assessed.riskLevel, stale:assessed.stale, source:agent.source, updatedAt:startedAt });
        const index = staged.agents.findIndex(a => a.id === agent.id);
        if (index >= 0) staged.agents[index] = updated;
        staged.findings.push(...assessed.findings);
      }
      const previousReal = prior.real || { agents:[], integrations:[], permissions:[], mcpServers:[], findings:[] };
      const previousSample = prior.sample || { agents:[], integrations:[], permissions:[], mcpServers:[], findings:[] };
      const realIncoming = { agents:staged.agents.filter(a => sourceClass(a) !== 'fixture'), integrations:staged.integrations.filter(x => sourceClass(x) !== 'fixture'), permissions:staged.permissions.filter(x => sourceClass(x) !== 'fixture'), mcpServers:staged.mcpServers.filter(x => sourceClass(x) !== 'fixture'), findings:staged.findings.filter(x => sourceClass(x) !== 'fixture') };
      const sampleIncoming = { agents:staged.agents.filter(a => sourceClass(a) === 'fixture'), integrations:staged.integrations.filter(x => sourceClass(x) === 'fixture'), permissions:staged.permissions.filter(x => sourceClass(x) === 'fixture'), mcpServers:staged.mcpServers.filter(x => sourceClass(x) === 'fixture'), findings:staged.findings.filter(x => sourceClass(x) === 'fixture') };
      const realScannedIds = new Set(realIncoming.agents.map(a => a.id));
      const sampleScannedIds = new Set(sampleIncoming.agents.map(a => a.id));
      const workflowEvents = [];
      const reconciledReal = reconcileFindings(previousReal, realIncoming, realScannedIds, startedAt, workflowEvents);
      const reconciledSample = reconcileFindings(previousSample, sampleIncoming, sampleScannedIds, startedAt, workflowEvents);
      const real = mergeInventory(previousReal, reconciledReal, startedAt, workflowEvents);
      const sample = request.includeSampleData ? mergeInventory(previousSample, reconciledSample, startedAt, workflowEvents) : previousSample;
      const status = failures && availableCount ? 'partial' : failures && !availableCount ? 'failed' : 'completed';
      const scan = models.createScan({ id:scanId, source:CONTROLLER_SOURCE, startedAt, completedAt:nowIso(clock), sourceIds:providerIds, status, recordCounts:{ agents:staged.agents.length, integrations:staged.integrations.length, permissions:staged.permissions.length, mcpServers:staged.mcpServers.length, findings:staged.findings.length }, errorSummary:failures ? `${failures} provider(s) failed or were unavailable.` : null });
      const events = [...(prior.events || []), safeEvent('agent_security_scan_started', { scanId, requestedBy }, startedAt)];
      events.push(safeEvent(status === 'completed' ? 'agent_security_scan_completed' : status === 'partial' ? 'agent_security_scan_partial' : 'agent_security_scan_failed', { scanId, status, count:staged.agents.length }, scan.completedAt));
      for (const provider of providerResults) if (provider.status === 'failed') events.push(safeEvent('agent_security_scan_failed', { scanId, providerId:provider.providerId, reason:provider.error || 'provider failure' }, scan.completedAt));
      const previousIds = new Set([...inventoryRecords(previousReal), ...inventoryRecords(previousSample)].filter(r => r && r.id).map(r => r.id));
      for (const agent of staged.agents) events.push(safeEvent(previousIds.has(agent.id) ? 'agent_updated' : 'agent_discovered', { scanId, agentId:agent.id, evidenceClass:sourceClass(agent), stale:!!agent.stale }, scan.completedAt));
      for (const finding of staged.findings) events.push(safeEvent('risky_permission_combination_found', { scanId, agentId:finding.agentId, findingId:finding.id, status:finding.status, evidenceClass:sourceClass(finding) }, scan.completedAt));
      events.push(...workflowEvents); // verified resolutions and reopens from reconciliation
      const rejectedImport = providerResults.some(p => p.diagnostics?.some(d => Array.isArray(d.rejectedFields)));
      if (rejectedImport) events.push(safeEvent('imported_oauth_data_rejected', { scanId, reason:'Sensitive or unsupported imported fields were rejected.' }, scan.completedAt));
      const next = { ...prior, schemaVersion:models.SCHEMA_VERSION, real, sample, scans:[...(prior.scans || []), scan], events, providerState:Object.fromEntries(providerResults.map(p => [p.providerId, { status:p.status, lastScanAt:scan.completedAt }])) };
      let persisted;
      try { persisted = await storage.commit(next); } catch (error) { return { scan, status:'failed', error:'persistence_failed', message:'Local Agent Security storage failed; the previous inventory was preserved.', inventory:prior.real, sample:prior.sample, providerResults }; }
      return { scan, status, providerResults, inventory:request.includeSampleData ? { ...real, sample } : real, sample, persistedAt:persisted.updatedAt };
    }
    async function runScan(request = {}) {
      if (scanInProgress) return { status:'failed', error:'scan_in_progress', message:'An Agent Security scan is already running.' };
      scanInProgress = true;
      try { return await performScan(request); } finally { scanInProgress = false; }
    }
    async function getLatestScan() { const state = await storage.load(); return state.scans.at(-1) || null; }
    async function getScanHistory() { return (await storage.load()).scans; }
    async function getInventory() { const state = await storage.load(); return { ...state.real, sample:state.sample }; }
    async function getAgentById(id) { const inventory = await getInventory(); return [...inventory.agents, ...inventory.sample.agents].find(a => a.id === id) || null; }
    async function getFindings() { const state = await storage.load(); return [...state.real.findings, ...state.sample.findings]; }
    async function getExport() {
      const state = await storage.load();
      const payload = { schemaVersion:models.SCHEMA_VERSION, exportVersion:2, exportedAt:nowIso(clock), inventory:{ real:state.real, sample:state.sample }, identities:state.identities, remediations:state.remediations, comments:state.comments, scans:state.scans, events:state.events, providerState:state.providerState };
      // Storage adapters may return shared object references. Detach the export so
      // callers cannot mutate the in-memory state by editing an export object.
      return JSON.parse(JSON.stringify(payload));
    }

    // ── M1 workflow actions (local). Pure logic lives in findingWorkflow; ────
    // ── this layer owns lookup, persistence, and hash-chained events. ────────
    async function getWorkspace() {
      const state = await storage.load();
      return { identities:state.identities || [], remediations:state.remediations || [], comments:state.comments || [] };
    }
    async function saveIdentity(fields) {
      const state = await storage.load();
      const createdAt = fields.createdAt || nowIso(clock);
      const identity = models.createLocalIdentity({ ...fields, createdAt, source:{ id:'local-user', type:'workflow', evidenceClass:'imported', name:'Local workflow user', observedAt:createdAt } });
      const existing = (state.identities || []).findIndex(i => i.id === identity.id);
      const identities = [...(state.identities || [])];
      if (fields.isSelf) for (const record of identities) record.isSelf = false;
      if (existing >= 0) identities[existing] = { ...identities[existing], ...identity, createdAt:identities[existing].createdAt };
      else identities.push(identity);
      await storage.commit({ ...state, identities });
      return identity;
    }
    function locateFinding(state, findingId) {
      for (const bucket of ['real','sample']) {
        const index = (state[bucket].findings || []).findIndex(f => f.id === findingId);
        if (index >= 0) return { bucket, index, finding:state[bucket].findings[index] };
      }
      return null;
    }
    async function applyFindingAction(findingId, action = {}) {
      const state = await storage.load();
      const located = locateFinding(state, findingId);
      if (!located) throw new TypeError('finding_not_found');
      const now = (clock || Date).now();
      let result;
      if (action.kind === 'assign') result = workflow.assign(located.finding, action, now);
      else if (action.kind === 'transition') result = workflow.transition(located.finding, action, now);
      else if (action.kind === 'setOwner') result = workflow.setOwner(located.finding, action, now);
      else if (action.kind === 'setDue') result = workflow.setDueDate(located.finding, action, now);
      else throw new TypeError('unknown_finding_action');
      state[located.bucket].findings = [...state[located.bucket].findings];
      state[located.bucket].findings[located.index] = result.finding;
      const events = [...(state.events || [])];
      if (result.event) events.push(safeEvent(result.event.type, { ...result.event.fields, actorId:action.actorId, dataset:located.bucket === 'sample' ? 'sample' : 'real' }, nowIso(clock)));
      await storage.commit({ ...state, events });
      return result.finding;
    }
    async function createRemediationTask(findingId, fields = {}) {
      const state = await storage.load();
      const located = locateFinding(state, findingId);
      if (!located) throw new TypeError('finding_not_found');
      const now = (clock || Date).now();
      const finding = located.bucket === 'sample' ? { ...located.finding, dataset:'sample' } : located.finding;
      const { task, event } = workflow.createRemediation(fields, finding, now);
      const events = [...(state.events || []), safeEvent(event.type, { ...event.fields, actorId:fields.actorId }, nowIso(clock))];
      await storage.commit({ ...state, remediations:[...(state.remediations || []), task], events });
      return task;
    }
    async function applyRemediationAction(taskId, action = {}) {
      const state = await storage.load();
      const index = (state.remediations || []).findIndex(t => t.id === taskId);
      if (index < 0) throw new TypeError('remediation_not_found');
      const now = (clock || Date).now();
      const task = state.remediations[index];
      let result;
      if (action.kind === 'start') result = workflow.startRemediation(task, action, now);
      else if (action.kind === 'complete') result = workflow.completeRemediation(task, action, now);
      else if (action.kind === 'cancel') result = workflow.cancelRemediation(task, action, now);
      else throw new TypeError('unknown_remediation_action');
      const remediations = [...state.remediations];
      remediations[index] = result.task;
      const events = [...(state.events || [])];
      if (result.event) events.push(safeEvent(result.event.type, { ...result.event.fields, actorId:action.actorId }, nowIso(clock)));
      await storage.commit({ ...state, remediations, events });
      return result.task;
    }
    async function addComment(fields = {}) {
      const state = await storage.load();
      let dataset = 'real';
      if (fields.subjectKind === 'finding') dataset = locateFinding(state, fields.subjectId)?.bucket === 'sample' ? 'sample' : 'real';
      else if (fields.subjectKind === 'remediation') dataset = (state.remediations || []).find(t => t.id === fields.subjectId)?.dataset === 'sample' ? 'sample' : 'real';
      const createdAt = nowIso(clock);
      const comment = models.createComment({ ...fields, dataset, createdAt, source:{ id:'local-user', type:'workflow', evidenceClass:'imported', name:'Local workflow user', observedAt:createdAt } });
      await storage.commit({ ...state, comments:[...(state.comments || []), comment] });
      return comment;
    }

    return { runScan, getLatestScan, getScanHistory, getInventory, getAgentById, getFindings, getExport, getWorkspace, saveIdentity, applyFindingAction, createRemediationTask, applyRemediationAction, addComment, clearSampleData:storage.clearSampleData, clearAgentSecurityData:storage.clearAgentSecurityData, registry, storage };
  }
  return { createScanController, STALE_MS, safeEvent, sanitizeErrorCode };
});
