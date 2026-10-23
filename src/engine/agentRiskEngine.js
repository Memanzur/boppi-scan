/** Boppi Agent Security explainable risk engine. */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : (typeof globalThis !== 'undefined' ? globalThis.BoppiAgentSecurityModels : null);
  const api = factory(models);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentRiskEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models) {
  'use strict';
  const SEVERITY_POINTS = Object.freeze({ critical: 70, high: 45, medium: 16, low: 6 });
  const THRESHOLDS = Object.freeze({ critical: 75, high: 50, medium: 25 });
  const RULES = [
    { id:'AE-001', severity:'critical', category:'exfiltration', title:'Sensitive access can reach external messaging', needs:['sensitive','browse_internet','external_message'], path:'Sensitive data can be read and sent through externally reachable content.', fix:'Remove external messaging or restrict sensitive-data access and internet browsing.' },
    { id:'AE-002', severity:'critical', category:'credential_exposure', title:'Code execution can reach credentials and the network', needs:['execution','credential','network'], path:'An injected or compromised action could execute code, read credentials, and send them externally.', fix:'Disable shell/code execution or remove credential and network access.' },
    { id:'AE-003', severity:'high', category:'supply_chain', title:'Sensitive business data is connected to an unverified MCP server', needs:['business_sensitive','unverified_mcp'], path:'An unverified tool server sits on a path to sensitive business data.', fix:'Verify the MCP server, restrict its data scope, or disconnect it.' },
    { id:'AE-004', severity:'critical', category:'software_supply_chain', title:'Source modification can reach production systems', needs:['source_modify','production'], path:'The agent can change code while also reaching production systems or credentials.', fix:'Separate source modification from production access and require approval for deployment actions.' },
    { id:'AE-005', severity:'high', category:'impersonation', title:'Email access and browser content create an impersonation path', needs:['read_email','external_message','browser_or_untrusted'], path:'Untrusted content could influence an agent that can read and send email.', fix:'Require approval for outbound mail and restrict browser or untrusted-content access.' },
    { id:'AE-006', severity:'high', category:'data_governance', title:'Broad file access has unknown vendor data-training posture', needs:['broad_files','unknown_training'], path:'A broad file grant may expose company data to a vendor whose training posture is unknown.', fix:'Reduce the file scope or verify the vendor’s data-use controls.' },
    { id:'AE-007', severity:'critical', category:'prompt_injection_impact', title:'Shell and filesystem access can be influenced by untrusted content', needs:['shell','filesystem','untrusted'], path:'Instructions from external content could influence an agent with destructive local capabilities.', fix:'Disable shell access, restrict filesystem paths, and isolate untrusted content.' },
  ];
  const categorySet = permissions => new Set((permissions || []).map(p => p.normalizedCategory || p.category || 'unknown'));
  function has(set, ...values) { return values.some(v => set.has(v)); }
  function permissionEvidence(permissions, predicate) {
    return (permissions || []).filter(predicate).map(p => ({ id:p.id, category:p.normalizedCategory, rawPermission:p.rawPermission, source:p.source?.id || null }));
  }
  function classify(permissions, mcpServers, agent) {
    const set = categorySet(permissions);
    const sensitive = has(set,'read_files','access_customer_data','access_financial_data','access_health_data','access_hr_data');
    const broadFiles = (permissions || []).some(p => p.normalizedCategory === 'read_files' && /drive|all|full|filesystem|document/i.test(p.rawPermission || ''));
    const unknownTraining = (agent?.trainingPosture || 'unknown') === 'unknown';
    // AE-003 requires explicit evidence that the server is unverified. An
    // unknown trust state is uncertainty, not proof of supply-chain risk.
    const unverifiedMcp = (mcpServers || []).some(s => s.trustStatus === 'unverified');
    const groups = {
      sensitive: permissionEvidence(permissions, p => sensitive && ['read_files','access_customer_data','access_financial_data','access_health_data','access_hr_data'].includes(p.normalizedCategory)),
      browse_internet: permissionEvidence(permissions, p => p.normalizedCategory === 'browse_internet'),
      external_message: permissionEvidence(permissions, p => ['send_external_message','send_email'].includes(p.normalizedCategory)),
      execution: permissionEvidence(permissions, p => ['execute_code','run_shell_commands'].includes(p.normalizedCategory)),
      credential: permissionEvidence(permissions, p => ['access_credentials','access_environment_variables'].includes(p.normalizedCategory)),
      network: permissionEvidence(permissions, p => ['call_external_api','browse_internet'].includes(p.normalizedCategory)),
      business_sensitive: permissionEvidence(permissions, p => ['access_customer_data','access_financial_data','access_health_data','access_hr_data'].includes(p.normalizedCategory)),
      source_modify: permissionEvidence(permissions, p => p.normalizedCategory === 'modify_source_code'),
      production: permissionEvidence(permissions, p => p.normalizedCategory === 'access_production_system'),
      read_email: permissionEvidence(permissions, p => p.normalizedCategory === 'read_email'),
      browser_or_untrusted: permissionEvidence(permissions, p => ['browser_automation','browse_internet','untrusted_external_content'].includes(p.normalizedCategory)),
      broad_files: permissionEvidence(permissions, p => p.normalizedCategory === 'read_files' && /drive|all|full|filesystem|document/i.test(p.rawPermission || '')),
      shell: permissionEvidence(permissions, p => p.normalizedCategory === 'run_shell_commands'),
      filesystem: permissionEvidence(permissions, p => ['read_files','write_files','delete_files'].includes(p.normalizedCategory)),
      untrusted: permissionEvidence(permissions, p => p.normalizedCategory === 'untrusted_external_content'),
      unverified_mcp: (mcpServers || []).filter(s => s.trustStatus === 'unverified').map(s => ({ id:s.id, name:s.name, source:s.source?.id || null })),
    };
    if (unknownTraining) groups.unknown_training = [{ id:agent?.id || 'agent', evidence:'training posture unknown' }];
    return groups;
  }
  function triggered(rule, groups) {
    const g = groups;
    return rule.needs.every(need => Array.isArray(g[need]) && g[need].length > 0);
  }
  function confidenceFor(agent, permissions, mcpServers, stale) {
    const values = [agent?.confidence ?? 0.5, ...(permissions || []).map(p => p.normalizationConfidence ?? 0.5), ...(mcpServers || []).map(s => s.confidence ?? 0.5)];
    let c = Math.min(...values);
    if (stale) c *= 0.7;
    return Math.round(c * 1000) / 1000;
  }
  function assess(agent, permissions = [], mcpServers = [], options = {}) {
    const groups = classify(permissions, mcpServers, agent);
    const stale = !!options.stale;
    const confidence = confidenceFor(agent, permissions, mcpServers, stale);
    const inferredAt = options.now || agent?.updatedAt || agent?.createdAt || agent?.source?.observedAt || '1970-01-01T00:00:00.000Z';
    const rawFindings = RULES.filter(rule => triggered(rule, groups)).map(rule => {
      const evidence = rule.needs.flatMap(need => groups[need] || []);
      const evidenceIds = [...new Set(evidence.map(e => e.id).filter(Boolean))];
      const raw = {
        id: models ? models.stableId('finding', [agent?.id || 'unknown', rule.id, evidenceIds]) : `${rule.id}:${agent?.id || 'unknown'}`,
        agentId: agent?.id || 'unknown-agent',
        source: options.source || { id:'risk-engine', type:'risk-engine', evidenceClass:'inferred', name:'Boppi risk engine', observedAt:inferredAt, evidenceRef:options.sourceScanId || agent?.source?.id || null },
        evidenceClass:'inferred', dataset:agent?.source?.evidenceClass === 'fixture' ? 'sample' : 'real', evidenceSource:agent?.source || null,
        sourceScanId: options.sourceScanId || null,
        createdAt: options.now || agent?.updatedAt || agent?.createdAt,
        firstSeenAt: options.now || agent?.firstSeenAt, lastSeenAt: options.now || agent?.lastSeenAt,
        status: 'open',
        ruleId:rule.id, ruleVersion:'1', severity:rule.severity, category:rule.category,
        title:rule.title, description:rule.path, contributingPermissions:evidence.filter(e => e.category && e.id).map(e => e.id),
        evidence, attackPath:rule.path, recommendation:rule.fix, confidence, stale,
      };
      return models ? models.createRiskFinding(raw) : raw;
    });
    const findings = rawFindings;
    return { ...score({ findings, permissions, mcpServers, stale }), findings, stale, confidence };
  }
  /**
   * The agent score and band from a set of findings. Exposed so a caller that
   * restates a finding at an exposure path's priority (the scanner's
   * alignFindings) can rescore the agent with the same arithmetic, instead of
   * leaving the row at the rule's own severity.
   */
  function score({ findings = [], permissions = [], mcpServers = [], stale = false } = {}) {
    const permissionPoints = Math.min(20, (permissions || []).reduce((sum, p) => sum + Math.max(0, Number(p.riskWeight) || 0), 0));
    const rulePoints = (findings || []).reduce((sum, f) => sum + (SEVERITY_POINTS[f.severity] || 0), 0);
    const trustPoints = (mcpServers || []).some(s => (s.trustStatus || 'unknown') === 'unverified') ? 8 : 0;
    const staleFactor = stale ? 0.85 : 1;
    const total = Math.min(100, Math.round((rulePoints + permissionPoints + trustPoints) * staleFactor));
    const level = total >= THRESHOLDS.critical ? 'critical' : total >= THRESHOLDS.high ? 'high' : total >= THRESHOLDS.medium ? 'medium' : 'low';
    return { score: total, riskLevel: level, contributingFactors: { rulePoints, permissionPoints, trustPoints, staleFactor }, scoreExplanation: (findings || []).length ? `${findings.length} explainable rule(s) triggered; permission and trust factors contributed ${permissionPoints + trustPoints} points.` : 'No dangerous combination was triggered; score reflects only permission and trust factors.' };
  }
  function dedupeFindings(existing = [], next = []) {
    const map = new Map((existing || []).map(f => [f.id, f]));
    for (const finding of next || []) {
      const previous = map.get(finding.id);
      map.set(finding.id, previous ? { ...previous, ...finding, firstSeenAt: previous.firstSeenAt, status: finding.status || previous.status, lastSeenAt: finding.lastSeenAt || previous.lastSeenAt } : finding);
    }
    return [...map.values()];
  }
  function updateFindingStatus(finding, active, now = new Date().toISOString()) {
    if (!finding || typeof finding !== 'object') throw new TypeError('finding is required');
    return { ...finding, status: active ? 'open' : 'resolved', lastSeenAt: new Date(now).toISOString() };
  }
  return { RULES, SEVERITY_POINTS, THRESHOLDS, assess, score, dedupeFindings, updateFindingStatus };
});
