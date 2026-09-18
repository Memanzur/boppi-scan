/**
 * Boppi finding workflow engine (M1, local).
 *
 * Pure, deterministic logic for the operational half of Agent Security:
 * finding lifecycle, ownership, assignment, remediation tasks, resolution
 * verification, and history preservation. Persistence and event sealing stay
 * in scanController/storage; this module never touches chrome.storage.
 *
 * Resolution honesty: 'verified' is set ONLY by scan reconciliation when the
 * finding's rule no longer triggers (evidence changed). A user can only ever
 * produce a 'manual' resolution, which the UI labels as not independently
 * verified.
 */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : (typeof globalThis !== 'undefined' ? globalThis.BoppiAgentSecurityModels : null);
  const api = factory(models);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiFindingWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models) {
  'use strict';

  const FINDING_STATUSES = Object.freeze(['open', 'acknowledged', 'assigned', 'in_progress', 'resolved', 'accepted_risk', 'false_positive']);
  const TERMINAL = new Set(['resolved', 'accepted_risk', 'false_positive']);
  const TRANSITIONS = Object.freeze({
    open: ['acknowledged', 'assigned', 'resolved', 'accepted_risk', 'false_positive'],
    acknowledged: ['assigned', 'resolved', 'accepted_risk', 'false_positive'],
    assigned: ['in_progress', 'acknowledged', 'resolved', 'accepted_risk', 'false_positive'],
    in_progress: ['assigned', 'resolved', 'accepted_risk', 'false_positive'],
    resolved: ['open'],
    accepted_risk: ['open'],
    false_positive: ['open'],
  });
  const EVENT_FOR_STATUS = Object.freeze({
    acknowledged: 'finding_acknowledged',
    assigned: 'finding_assigned',
    in_progress: 'finding_in_progress',
    resolved: 'finding_resolved',
    accepted_risk: 'risk_accepted',
    false_positive: 'finding_false_positive',
    open: 'finding_reopened',
  });
  // Finding rule → exposure-path template category (for cross-linking).
  const RULE_PATH_CATEGORY = Object.freeze({
    'AE-001': 'data_exfiltration', 'AE-002': 'credential_exposure', 'AE-003': 'supply_chain_exposure',
    'AE-004': 'software_supply_chain', 'AE-005': 'impersonation', 'AE-007': 'privilege',
  });
  const RESOLVED_PERIOD_MS = 30 * 86400000;

  function fail(message) { throw new TypeError(`Finding workflow: ${message}`); }
  function iso(value) { return new Date(value).toISOString(); }
  function historyEntry(event, fields, now) {
    const entry = { at: iso(now), event };
    for (const key of ['actor', 'from', 'to', 'note']) if (fields && fields[key] != null) entry[key] = String(fields[key]).slice(0, 300);
    return entry;
  }
  function withHistory(finding, entry) {
    return { ...finding, history: [...(finding.history || []), entry].slice(-models.HISTORY_LIMIT), updatedAt: entry.at };
  }
  function isTerminal(status) { return TERMINAL.has(status); }
  function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }

  /**
   * User-driven status transition. Terminal targets require a reason;
   * 'resolved' via this path is always a MANUAL resolution.
   */
  function transition(finding, { to, actorId = null, reason = null, note = null } = {}, now = Date.now()) {
    if (!finding || typeof finding !== 'object') fail('finding is required');
    const from = finding.status || 'open';
    if (!FINDING_STATUSES.includes(to)) fail(`unknown status ${to}`);
    if (!canTransition(from, to)) fail(`invalid transition ${from} → ${to}`);
    if (TERMINAL.has(to) && !reason) fail(`a reason is required to move a finding to ${to}`);
    let next = { ...finding, status: to };
    if (TERMINAL.has(to)) {
      next.resolvedAt = iso(now);
      next.resolution = { type: 'manual', reason: String(reason).slice(0, 300), byId: actorId || null, at: iso(now) };
    }
    if (to === 'open' && isTerminal(from)) {
      // Manual reopen: preserve the prior resolution in history, then clear it.
      next.resolution = null;
      next.resolvedAt = null;
      next.reopenedCount = (finding.reopenedCount || 0) + 1;
    }
    next = withHistory(next, historyEntry(EVENT_FOR_STATUS[to], { actor: actorId, from, to, note: note || reason }, now));
    return { finding: next, event: { type: EVENT_FOR_STATUS[to], fields: { findingId: finding.id, agentId: finding.agentId, status: to, ...(to === 'resolved' ? { verification: 'manual' } : {}) } } };
  }

  /** Assign a finding. Auto-advances open/acknowledged to assigned. */
  function assign(finding, { assigneeId, actorId = null } = {}, now = Date.now()) {
    if (!assigneeId) fail('assigneeId is required');
    if (isTerminal(finding.status)) fail('cannot assign a finding in a terminal status; reopen it first');
    const from = finding.status;
    const status = (from === 'open' || from === 'acknowledged') ? 'assigned' : from;
    const next = withHistory({ ...finding, assigneeId, status }, historyEntry('finding_assigned', { actor: actorId, from, to: status, note: `assignee:${assigneeId}` }, now));
    return { finding: next, event: { type: 'finding_assigned', fields: { findingId: finding.id, agentId: finding.agentId, status } } };
  }

  function setOwner(finding, { ownerId = null, department = null, actorId = null } = {}, now = Date.now()) {
    const next = withHistory({ ...finding, ownerId, department: department || finding.department || null }, historyEntry('finding_owner_set', { actor: actorId, note: ownerId ? `owner:${ownerId}` : 'owner cleared' }, now));
    return { finding: next, event: null };
  }

  function setDueDate(finding, { dueAt = null, actorId = null } = {}, now = Date.now()) {
    const next = withHistory({ ...finding, dueAt: dueAt ? iso(dueAt) : null }, historyEntry('finding_due_set', { actor: actorId, note: dueAt ? `due:${iso(dueAt)}` : 'due date cleared' }, now));
    return { finding: next, event: null };
  }

  /**
   * Merge engine-regenerated findings with previous workflow state.
   * - Non-terminal previous: keep all workflow fields and status; refresh
   *   engine fields (severity/confidence/evidence/lastSeen).
   * - Previous 'resolved' that re-triggers: REOPEN, preserving resolution
   *   history and recording why it reopened.
   * - accepted_risk / false_positive: keep status (that is their purpose).
   * Returns { findings, events } so the caller can seal reopen events.
   */
  function mergeFindings(previousList = [], incomingList = [], now = Date.now()) {
    const WORKFLOW_FIELDS = ['ownerId', 'assigneeId', 'department', 'dueAt', 'resolvedAt', 'resolution', 'reopenedCount', 'history'];
    const events = [];
    const map = new Map((previousList || []).map(f => [f.id, f]));
    for (const incoming of incomingList || []) {
      const previous = map.get(incoming.id);
      if (!previous) { map.set(incoming.id, incoming); continue; }
      if (incoming.resolution && incoming.status === 'resolved') {
        // Already workflow-processed (verified resolution from reconciliation);
        // it was built from the previous finding and carries its history.
        map.set(incoming.id, incoming);
        continue;
      }
      const merged = { ...previous, ...incoming, firstSeenAt: previous.firstSeenAt };
      for (const field of WORKFLOW_FIELDS) merged[field] = previous[field];
      if (previous.status === 'resolved') {
        const resolutionType = previous.resolution?.type || 'unknown';
        merged.status = 'open';
        merged.resolution = null;
        merged.resolvedAt = null;
        merged.reopenedCount = (previous.reopenedCount || 0) + 1;
        const reopened = withHistory(merged, historyEntry('finding_reopened', { from: 'resolved', to: 'open', note: `evidence returned after ${resolutionType} resolution` }, now));
        map.set(incoming.id, reopened);
        events.push({ type: 'finding_reopened', fields: { findingId: incoming.id, agentId: incoming.agentId, status: 'open', reason: 'evidence_returned' } });
        continue;
      }
      merged.status = previous.status; // accepted_risk / false_positive / active workflow states persist
      map.set(incoming.id, merged);
    }
    return { findings: [...map.values()], events };
  }

  /**
   * VERIFIED resolution: findings whose agent was re-scanned but whose rule no
   * longer triggered. Terminal findings are left untouched.
   * Returns { findings, events } for the no-longer-triggered set only.
   */
  function verifyResolveAbsent(previousList = [], activeIds, scannedAgentIds, now = Date.now()) {
    const events = [];
    const findings = [];
    for (const finding of previousList || []) {
      if (!scannedAgentIds.has(finding.agentId) || activeIds.has(finding.id) || isTerminal(finding.status)) continue;
      let next = { ...finding, status: 'resolved', resolvedAt: iso(now), resolution: { type: 'verified', reason: 'evidence_changed', byId: null, at: iso(now) } };
      next = withHistory(next, historyEntry('finding_resolved', { from: finding.status, to: 'resolved', note: 'verified by re-scan: the contributing evidence no longer triggers this rule' }, now));
      findings.push(next);
      events.push({ type: 'finding_resolved', fields: { findingId: finding.id, agentId: finding.agentId, status: 'resolved', verification: 'verified' } });
    }
    return { findings, events };
  }

  // ── Remediation tasks ──────────────────────────────────────────────────────
  function createRemediation(fields, finding, now = Date.now()) {
    if (!finding) fail('a finding is required to create a remediation task');
    if (isTerminal(finding.status) && finding.status !== 'accepted_risk') fail('cannot create a remediation task for a resolved or false-positive finding');
    const createdAt = iso(now);
    const task = models.createRemediationTask({
      findingId: finding.id,
      title: fields.title,
      description: fields.description || finding.recommendation || null,
      assigneeId: fields.assigneeId || finding.assigneeId || null,
      priority: fields.priority || finding.severity || 'medium',
      dueAt: fields.dueAt || null,
      dataset: finding.dataset === 'sample' ? 'sample' : 'real',
      createdAt,
      source: { id: 'finding-workflow', type: 'workflow', evidenceClass: 'inferred', name: 'Boppi finding workflow', observedAt: createdAt },
      history: [historyEntry('remediation_created', { actor: fields.actorId, note: `finding:${finding.id}` }, now)],
    });
    return { task, event: { type: 'remediation_created', fields: { remediationId: task.id, findingId: finding.id, status: 'open' } } };
  }
  function startRemediation(task, { actorId = null } = {}, now = Date.now()) {
    if (task.status !== 'open') fail(`cannot start a remediation task from ${task.status}`);
    const next = withHistory({ ...task, status: 'in_progress' }, historyEntry('remediation_started', { actor: actorId, from: 'open', to: 'in_progress' }, now));
    return { task: next, event: null };
  }
  function completeRemediation(task, { actorId = null, completionNote = null } = {}, now = Date.now()) {
    if (task.status === 'completed' || task.status === 'cancelled') fail(`cannot complete a remediation task from ${task.status}`);
    const next = withHistory({ ...task, status: 'completed', completedAt: iso(now), completionNote: completionNote ? String(completionNote).slice(0, 500) : null }, historyEntry('remediation_completed', { actor: actorId, from: task.status, to: 'completed', note: completionNote }, now));
    return { task: next, event: { type: 'remediation_completed', fields: { remediationId: task.id, findingId: task.findingId, status: 'completed' } } };
  }
  function cancelRemediation(task, { actorId = null, note = null } = {}, now = Date.now()) {
    if (task.status === 'completed' || task.status === 'cancelled') fail(`cannot cancel a remediation task from ${task.status}`);
    const next = withHistory({ ...task, status: 'cancelled' }, historyEntry('remediation_cancelled', { actor: actorId, from: task.status, to: 'cancelled', note }, now));
    return { task: next, event: null };
  }

  // ── Queries ────────────────────────────────────────────────────────────────
  function isOverdue(record, now = Date.now()) {
    if (!record?.dueAt) return false;
    const done = record.status && (TERMINAL.has(record.status) || record.status === 'completed' || record.status === 'cancelled');
    return !done && Date.parse(record.dueAt) < now;
  }
  function relatedPaths(finding, paths = []) {
    const category = RULE_PATH_CATEGORY[finding?.ruleId] || null;
    return paths.filter(p => p.agentId === finding?.agentId && (!category || p.category === category));
  }
  function relatedFindings(path, findings = []) {
    return (findings || []).filter(f => f.agentId === path?.agentId && RULE_PATH_CATEGORY[f.ruleId] === path?.category);
  }
  function workflowStats(findings = [], remediations = [], now = Date.now()) {
    const real = f => f.dataset !== 'sample';
    const active = (findings || []).filter(f => real(f) && !isTerminal(f.status));
    return {
      openCritical: active.filter(f => f.severity === 'critical').length,
      unassigned: active.filter(f => !f.assigneeId).length,
      overdueRemediation: (remediations || []).filter(t => t.dataset !== 'sample' && isOverdue(t, now)).length
        + active.filter(f => isOverdue(f, now)).length,
      resolvedThisPeriod: (findings || []).filter(f => real(f) && f.status === 'resolved' && f.resolvedAt && (now - Date.parse(f.resolvedAt)) <= RESOLVED_PERIOD_MS).length,
    };
  }

  return {
    FINDING_STATUSES, TRANSITIONS, TERMINAL: [...TERMINAL], RULE_PATH_CATEGORY,
    canTransition, isTerminal, transition, assign, setOwner, setDueDate,
    mergeFindings, verifyResolveAbsent,
    createRemediation, startRemediation, completeRemediation, cancelRemediation,
    isOverdue, relatedPaths, relatedFindings, workflowStats,
  };
});
