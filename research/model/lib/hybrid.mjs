// The shipping rule: the rules engine decides severity. Model output can add
// explanation text and a drafted fix, and can suggest extra rule ids, but a
// suggestion never gets a severity and never changes a rule finding.
export function hybridMerge(ruleFindings, modelOutput) {
  const text = new Map();
  for (const f of (modelOutput && modelOutput.findings) || []) {
    if (f && typeof f.rule_id === 'string' && typeof f.chain === 'string') text.set(`${f.rule_id}|${[...(f.servers || [])].sort().join(',')}`, f.chain);
  }
  const ruleIds = new Set(ruleFindings.map(f => f.rule_id));
  const findings = ruleFindings.map(f => ({
    rule_id: f.rule_id, severity: f.severity, servers: f.servers, source: 'rules',
    explanation: text.get(`${f.rule_id}|${f.servers.join(',')}`) || null,
  }));
  const suggestions = [...new Set(((modelOutput && modelOutput.rule_ids) || []).filter(id => typeof id === 'string' && !ruleIds.has(id)))]
    .map(id => ({ rule_id: id, severity: null, source: 'model', status: 'unverified suggestion' }));
  const fix = modelOutput && modelOutput.fix ? { commands: modelOutput.fix.commands || [], ops: modelOutput.fix.ops || [], status: 'draft, must pass re-scan' } : null;
  return { findings, suggestions, fix };
}
