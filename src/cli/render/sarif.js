/**
 * SARIF 2.1.0 export so a scan can land in GitHub code scanning or any SARIF
 * viewer. Rules are the exposure templates, the rule-engine findings, and
 * policy rules; results point at the portable config path of the agent.
 */
'use strict';
const exposurePathEngine = require('../../engine/exposurePathEngine');

const LEVEL = Object.freeze({ critical: 'error', high: 'error', medium: 'warning', low: 'note' });
const { remediationForEngineFinding } = require('../autoFix');

function configUriFor(agentId, discovery) {
  const client = (discovery || []).find(c => c.agentId === agentId);
  return client && client.primaryPath ? client.primaryPath : 'unknown-config';
}

function renderSarif(report, options = {}) {
  const rules = new Map();
  const addRule = (id, name, shortDescription, fullDescription, help, severity, remediation) => {
    if (rules.has(id)) return;
    const fix = remediation || { summary: help, steps: help ? [help] : [], autoFixable: false, fixId: id };
    rules.set(id, {
      id, name,
      shortDescription: { text: shortDescription },
      fullDescription: { text: fullDescription },
      help: { text: help, markdown: fix.steps && fix.steps.length ? `${help}\n\n${fix.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : help },
      defaultConfiguration: { level: LEVEL[severity] || 'warning' },
      properties: { severity, tags: ['security', 'ai-agent', 'mcp'], remediation: fix },
    });
  };
  for (const template of exposurePathEngine.TEMPLATES) addRule(template.id, template.category, template.label, template.explanation, template.remediation, template.severity);

  const results = [];
  for (const p of report.paths) {
    results.push({
      ruleId: p.templateId,
      level: LEVEL[p.severity] || 'warning',
      message: { text: `${p.label} on ${p.agentName}: ${p.nodes.map(n => n.label).join(' -> ')}. ${p.remediation}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: configUriFor(p.agentId, report.discovery) } } }],
      partialFingerprints: { boppiPathId: p.id, boppiExposureKey: p.exposureKey },
      properties: { severity: p.severity, agent: p.agentName, confidence: p.confidence, evidenceCount: p.evidenceCount, disclaimer: p.disclaimer },
    });
  }
  const openFindings = report.inventory.findings.filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status));
  const agentName = id => (report.inventory.agents.find(a => a.id === id) || {}).name || id;
  for (const f of openFindings) {
    const remediation = f.remediation || remediationForEngineFinding(f);
    addRule(f.ruleId, f.ruleId, f.title, f.description || f.title, remediation.summary || f.recommendation || f.title, f.severity, remediation);
    results.push({
      ruleId: f.ruleId,
      level: LEVEL[f.severity] || 'warning',
      message: { text: `${f.title} (${agentName(f.agentId)}). ${remediation.summary || f.recommendation || ''}`.trim() },
      locations: [{ physicalLocation: { artifactLocation: { uri: configUriFor(f.agentId, report.discovery) } } }],
      partialFingerprints: { boppiFindingId: f.id },
      properties: { severity: f.severity, agent: agentName(f.agentId), remediation },
    });
  }
  for (const v of (report.policy && report.policy.violations) || []) {
    const remediation = { summary: 'Change the configuration or the policy so the two agree.', steps: ['Change the configuration or the policy so the two agree.'], autoFixable: false, fixId: `manual-${v.ruleId}` };
    addRule(v.ruleId, v.rule, v.title, v.detail, remediation.summary, v.severity, remediation);
    results.push({
      ruleId: v.ruleId,
      level: LEVEL[v.severity] || 'error',
      message: { text: `${v.title}: ${v.detail}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: configUriFor(v.agentId, report.discovery) } } }],
      partialFingerprints: { boppiPolicyViolation: `${v.ruleId}:${v.agentId}:${v.subject}` },
      properties: { severity: v.severity, agent: v.agentName, policyFile: report.policy.file, remediation },
    });
  }
  const configFindings = report.configFindings || [];
  for (const finding of configFindings) {
    const remediation = finding.remediation || { summary: finding.title, steps: [], autoFixable: !!finding.autoFixable, fixId: finding.fixId || finding.ruleId };
    addRule(finding.ruleId, finding.ruleId, finding.title, finding.title, remediation.summary || finding.title, finding.severity, remediation);
    results.push({
      ruleId: finding.ruleId,
      level: LEVEL[finding.severity] || 'warning',
      message: { text: `${finding.title} ${remediation.summary || ''}`.trim() },
      locations: [{ physicalLocation: { artifactLocation: { uri: finding.file || 'unknown-config' } } }],
      partialFingerprints: { boppiFixId: finding.fixId || finding.ruleId },
      properties: { severity: finding.severity, tool: finding.tool, remediation },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'boppi',
          version: report.version,
          informationUri: 'https://github.com/Memanzur/boppi-scan',
          rules: [...rules.values()],
        },
      },
      automationDetails: { id: `boppi/${options.automationId || 'scan'}` },
      invocations: [{ executionSuccessful: true, startTimeUtc: report.startedAt, properties: { durationMs: report.durationMs, filesRead: report.portableFilesRead || [] } }],
      results,
      properties: { disclaimer: exposurePathEngine.DISCLAIMER, counts: { paths: report.paths.length, findings: openFindings.length, policyViolations: ((report.policy && report.policy.violations) || []).length, configFindings: configFindings.length } },
    }],
  };
}

/** Required SARIF 2.1.0 shape for a GitHub code scanning upload. Returns a list of problems. */
function validateSarif(log) {
  const errors = [];
  if (!log || typeof log !== 'object') return ['log is not an object'];
  if (log.version !== '2.1.0') errors.push('version must be 2.1.0');
  if (typeof log.$schema !== 'string' || !log.$schema.includes('sarif-2.1.0')) errors.push('$schema must name SARIF 2.1.0');
  if (!Array.isArray(log.runs) || log.runs.length === 0) errors.push('runs must be a non-empty array');
  const run = log.runs && log.runs[0];
  const driver = run && run.tool && run.tool.driver;
  if (!driver || typeof driver.name !== 'string' || !driver.name) errors.push('tool.driver.name is required');
  if (!driver || !Array.isArray(driver.rules)) errors.push('tool.driver.rules must be an array');
  const rules = new Map();
  for (const rule of (driver && driver.rules) || []) {
    if (!rule || typeof rule.id !== 'string' || !rule.id) {
      errors.push('every rule needs an id');
      continue;
    }
    if (rules.has(rule.id)) errors.push(`duplicate rule id ${rule.id}`);
    rules.set(rule.id, rule);
    if (!rule.shortDescription || typeof rule.shortDescription.text !== 'string' || !rule.shortDescription.text) errors.push(`rule ${rule.id} needs shortDescription.text`);
    if (!rule.help || typeof rule.help.text !== 'string' || !rule.help.text) errors.push(`rule ${rule.id} needs help.text`);
    const remediation = rule.properties && rule.properties.remediation;
    if (!remediation || typeof remediation.summary !== 'string' || !Array.isArray(remediation.steps) || typeof remediation.autoFixable !== 'boolean' || typeof remediation.fixId !== 'string') {
      errors.push(`rule ${rule.id} needs properties.remediation`);
    }
  }
  if (!run || !Array.isArray(run.results)) errors.push('run.results must be an array');
  for (const result of (run && run.results) || []) {
    if (!result || !rules.has(result.ruleId)) errors.push(`result ruleId ${result && result.ruleId} is not declared`);
    if (!result || !result.message || typeof result.message.text !== 'string' || !result.message.text) errors.push('every result needs message.text');
    const uri = result && result.locations && result.locations[0] && result.locations[0].physicalLocation && result.locations[0].physicalLocation.artifactLocation && result.locations[0].physicalLocation.artifactLocation.uri;
    if (typeof uri !== 'string' || !uri) errors.push('every result needs a location uri');
    if (result && result.level && !['error', 'warning', 'note', 'none'].includes(result.level)) errors.push(`result level ${result.level} is not a SARIF level`);
  }
  return errors;
}

module.exports = { renderSarif, validateSarif, LEVEL };
