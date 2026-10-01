/**
 * CLI scan provider factory. Wraps one sanitized localMcpScanner result as a
 * scanController provider and derives explainable permission records from the
 * evidenced MCP capabilities so the existing risk engine can reason about
 * them. Same pattern as importedOAuthProvider (providers create permissions);
 * the engine itself is untouched.
 */
'use strict';
const models = require('../engine/models');

const CAP_TO_CATEGORY = Object.freeze({
  filesystem_access: 'read_files',
  shell_access: 'run_shell_commands',
  code_execution: 'execute_code',
  network_access: 'call_external_api',
  environment_access: 'access_environment_variables',
  credential_access: 'access_credentials',
  browser_automation: 'browser_automation',
  untrusted_external_content: 'untrusted_external_content',
});
const RISK_WEIGHT = Object.freeze({
  shell_access: 3, code_execution: 3, credential_access: 3,
  filesystem_access: 2, network_access: 2, browser_automation: 2, untrusted_external_content: 2,
  environment_access: 1,
});

function reasonFor(capability, server, inference) {
  if (capability === 'environment_access') return 'Environment variable names are configured for this server; values are never collected.';
  if (capability === 'credential_access' && (server.credentialReferences || []).length) {
    return 'Environment variable names indicate credential references; values are never collected.';
  }
  const inferred = inference && inference.inferences.find(entry => entry.capabilities.includes(capability));
  if (inferred) return `Inferred from the server's evidenced identity: ${inferred.label} (matched "${inferred.matched}").`;
  return 'Capability declared in the MCP server configuration.';
}

function isInferred(capability, server, inference) {
  if (capability === 'environment_access') return false;
  if (capability === 'credential_access' && (server.credentialReferences || []).length) return false;
  return !!(inference && inference.inferences.some(entry => entry.capabilities.includes(capability)));
}

function derivePermissions(agent, servers, inferenceByServer, observedAt) {
  const permissions = [];
  for (const server of servers) {
    const inference = inferenceByServer[server.name] || null;
    for (const capability of server.capabilities || []) {
      const normalizedCategory = CAP_TO_CATEGORY[capability];
      if (!normalizedCategory) continue;
      const inferred = isInferred(capability, server, inference);
      permissions.push(models.createPermission({
        agentId: agent.id,
        integrationId: server.id,
        rawPermission: `${server.name} (${capability})`,
        normalizedCategory,
        accessLevel: capability === 'filesystem_access' && server.filesystemPathCount > 0 ? 'scoped' : 'broad',
        riskWeight: RISK_WEIGHT[capability] || 1,
        normalizationConfidence: inferred ? 0.7 : 0.85,
        normalizationReason: reasonFor(capability, server, inference),
        source: { ...agent.source, evidenceClass: inferred ? 'inferred' : 'observed' },
        createdAt: observedAt,
        updatedAt: observedAt,
      }));
    }
  }
  return permissions;
}

/** Build a scanController provider from one client's scanner result. */
function createConfigProvider({ clientKey, label, scannerResult, inferenceByServer = {} }) {
  return {
    id: `cli-${clientKey}`,
    version: '0.1.0',
    name: `Boppi CLI scan: ${label}`,
    isAvailable: () => true,
    scan: () => scannerResult,
    normalize: (raw, context = {}) => {
      const observedAt = context.now || new Date().toISOString();
      return {
        agents: [raw.agent],
        integrations: [],
        permissions: derivePermissions(raw.agent, raw.records, inferenceByServer, observedAt),
        mcpServers: raw.records,
        diagnostics: raw.diagnostics || [],
      };
    },
  };
}

module.exports = { createConfigProvider, derivePermissions, CAP_TO_CATEGORY };
