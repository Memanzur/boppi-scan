/**
 * SARIF 2.1.0 export so a scan can land in GitHub code scanning or any SARIF
 * viewer. Rules are the exposure templates, the rule-engine findings, and
 * policy rules, plus unrecognized and unpinned servers; results point at
 * the portable config path of the agent.
 */
'use strict';
const exposurePathEngine = require('../../engine/exposurePathEngine');
const recognition = require('../recognition');

const LEVEL = Object.freeze({ critical: 'error', high: 'error', medium: 'warning', low: 'note' });

function configUriFor(agentId, discovery) {
  const client = (discovery || []).find(c => c.agentId === agentId);
  return client && client.primaryPath ? client.primaryPath : 'unknown-config';
}

function renderSarif(report, options = {}) {
  const rules = new Map();
  const addRule = (id, name, shortDescription, fullDescription, help, severity) => {
    if (rules.has(id)) return;
    rules.set(id, {
      id, name,
      shortDescription: { text: shortDescription },
      fullDescription: { text: fullDescription },
      help: { text: help },
      defaultConfiguration: { level: LEVEL[severity] || 'warning' },
      properties: { severity, tags: ['security', 'ai-agent', 'mcp'] },
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
    addRule(f.ruleId, f.ruleId, f.title, f.description || f.title, f.recommendation || '', f.severity);
    results.push({
      ruleId: f.ruleId,
      level: LEVEL[f.severity] || 'warning',
      message: { text: `${f.title} (${agentName(f.agentId)}). ${f.recommendation || ''}`.trim() },
      locations: [{ physicalLocation: { artifactLocation: { uri: configUriFor(f.agentId, report.discovery) } } }],
      partialFingerprints: { boppiFindingId: f.id },
      properties: { severity: f.severity, agent: agentName(f.agentId) },
    });
  }
  for (const item of report.recognition || []) {
    const uri = configUriFor(item.agentId, report.discovery);
    if (!item.recognized) {
      addRule('BOPPI-UNRECOGNIZED', 'unrecognized_server', 'Unrecognized MCP server', 'The server matched no catalog entry, name rule, url, directory argument, or declared capability, so the scan cannot tell what it can do. It is in no exposure path, which is not the same as safe.', recognition.ADVICE, 'medium');
      results.push({
        ruleId: 'BOPPI-UNRECOGNIZED', level: 'warning',
        message: { text: `Server "${item.server}" on ${item.clientLabel} is unrecognized (${item.reasons.join(', ')}). ${recognition.ADVICE}` },
        locations: [{ physicalLocation: { artifactLocation: { uri } } }],
        partialFingerprints: { boppiRecognition: `unrecognized:${item.client}:${item.server}` },
        properties: { severity: 'medium', agent: item.clientLabel, launcher: item.launcher },
      });
    }
    if (item.pin === 'unpinned') {
      addRule('BOPPI-UNPINNED', 'unpinned_package', 'Unpinned MCP server package', 'The server is launched from a package registry without an exact version, so each launch runs whatever version is published at that moment.', recognition.UNPINNED_ADVICE, 'low');
      results.push({
        ruleId: 'BOPPI-UNPINNED', level: 'note',
        message: { text: `Server "${item.server}" on ${item.clientLabel} runs ${item.identity ? item.identity.name : 'a package'} (${item.launcherLabel}) without a version pin. ${recognition.UNPINNED_ADVICE}` },
        locations: [{ physicalLocation: { artifactLocation: { uri } } }],
        partialFingerprints: { boppiRecognition: `unpinned:${item.client}:${item.server}` },
        properties: { severity: 'low', agent: item.clientLabel, launcher: item.launcher },
      });
    }
    if (item.pin === 'tagged') {
      addRule('BOPPI-TAGGED-IMAGE', 'tagged_image', 'Docker image launched by tag', 'The server runs a Docker image selected by tag. A tag is a moving label the registry can point at new bytes; only a digest pins the image.', recognition.TAGGED_ADVICE, 'low');
      results.push({
        ruleId: 'BOPPI-TAGGED-IMAGE', level: 'note',
        message: { text: `Server "${item.server}" on ${item.clientLabel} runs ${item.identity ? item.identity.name : 'an image'} by tag ${item.identity ? item.identity.version : ''}. ${recognition.TAGGED_ADVICE}` },
        locations: [{ physicalLocation: { artifactLocation: { uri } } }],
        partialFingerprints: { boppiRecognition: `tagged:${item.client}:${item.server}` },
        properties: { severity: 'low', agent: item.clientLabel, launcher: item.launcher },
      });
    }
  }
  for (const v of (report.policy && report.policy.violations) || []) {
    addRule(v.ruleId, v.rule, v.title, v.detail, 'Change the configuration or the policy so the two agree.', v.severity);
    results.push({
      ruleId: v.ruleId,
      level: LEVEL[v.severity] || 'error',
      message: { text: `${v.title}: ${v.detail}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: configUriFor(v.agentId, report.discovery) } } }],
      partialFingerprints: { boppiPolicyViolation: `${v.ruleId}:${v.agentId}:${v.subject}` },
      properties: { severity: v.severity, agent: v.agentName, policyFile: report.policy.file },
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
      properties: { disclaimer: exposurePathEngine.DISCLAIMER, counts: { paths: report.paths.length, findings: openFindings.length, policyViolations: results.length - report.paths.length - openFindings.length } },
    }],
  };
}

module.exports = { renderSarif, LEVEL };
