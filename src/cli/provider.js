/**
 * CLI scan provider factory. Wraps one sanitized localMcpScanner result as a
 * scanController provider and derives explainable permission records from the
 * evidenced MCP capabilities so the existing risk engine can reason about
 * them. Same pattern as importedOAuthProvider (providers create permissions);
 * the engine itself is untouched.
 */
'use strict';
const models = require('../engine/models');
const overlay = require('./overlay');
const { builtinPermissions } = require('./builtinTools');

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
const CATEGORY_RISK_WEIGHT = Object.freeze({
  run_shell_commands: 3, execute_code: 3, access_credentials: 3, modify_source_code: 3, access_production_system: 3,
  read_files: 2, write_files: 2, delete_files: 2, call_external_api: 2, browser_automation: 2, send_email: 2, send_external_message: 2, untrusted_external_content: 2,
  read_source_code: 2, read_email: 2, access_financial_data: 2, access_customer_data: 2,
});

/** One permission per category a server reaches through its tools or the scope of its directory arguments. */
function reachPermissions(agent, server, inference, observedAt) {
  const permissions = [];
  for (const entry of (inference && inference.reach) || []) {
    const shown = entry.tools.slice(0, 2).join(', ') + (entry.tools.length > 2 ? ` +${entry.tools.length - 2}` : '');
    const how = entry.because ? entry.because : `tools ${entry.tools.join(', ')}`;
    const basis = entry.because ? 'configured' : entry.basis;
    const inferred = basis !== 'configured';
    permissions.push(models.createPermission({
      agentId: agent.id,
      integrationId: server.id,
      rawPermission: `${server.name} (${entry.category}${shown ? `: ${shown}` : ''})`,
      normalizedCategory: entry.category,
      accessLevel: 'broad',
      riskWeight: CATEGORY_RISK_WEIGHT[entry.category] || 1,
      normalizationConfidence: basis === 'advertised' ? 0.8 : inferred ? 0.7 : 0.85,
      normalizationReason: `This server can ${entry.label} because ${how}${entry.because ? '' : ` (${basis === 'catalog' ? 'listed in the known-server catalog' : basis === 'advertised' ? 'advertised by the running server in a consented discovery; what the tool does was not verified' : 'declared in the configuration'})`}.`,
      source: { ...agent.source, id: `tool-reach:${server.name}:${entry.category}`, evidenceClass: inferred ? 'inferred' : 'observed' },
      attributes: {
        basis,
        toolCount: entry.tools.length,
        ...(entry.because ? { scope: (inference.filesystemScope && inference.filesystemScope.worst) || 'other' } : {}),
        ...(entry.environment ? { environment: entry.environment } : {}),
        ...(entry.writeAccess ? { writeAccess: true } : {}),
        ...(entry.credentialKind ? { credentialKind: entry.credentialKind } : {}),
      },
      createdAt: observedAt,
      updatedAt: observedAt,
    }));
  }
  return permissions;
}

/** One inferred permission per validated overlay claim, carrying the claim id and its evidence line. */
function overlayPermission(agent, server, claim, observedAt) {
  const cited = overlay.citedEvidence(claim);
  const subject = claim.subjectVersion ? `${claim.subject}@${claim.subjectVersion}` : claim.subject;
  return models.createPermission({
    agentId: agent.id,
    rawPermission: `${server.name} (${claim.capability}, claim ${claim.id})`,
    normalizedCategory: claim.capability,
    accessLevel: 'broad',
    riskWeight: CATEGORY_RISK_WEIGHT[claim.capability] || 1,
    normalizationConfidence: 0.7,
    normalizationReason: `Validated capability claim ${claim.id} for ${subject}: evidence at ${cited}.`,
    source: { ...agent.source, id: `overlay-claim:${claim.id}`, name: `Capability claim ${claim.id} (${cited})`, evidenceClass: 'inferred', evidenceRef: cited },
    attributes: { basis: 'inferred' },
    createdAt: observedAt,
    updatedAt: observedAt,
  });
}

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

function derivePermissions(agent, servers, inferenceByServer, observedAt, overlayByServer = {}) {
  const permissions = [];
  for (const server of servers) {
    const inference = inferenceByServer[server.name] || null;
    for (const claim of (overlayByServer[server.name] || {}).validated || []) permissions.push(overlayPermission(agent, server, claim, observedAt));
    const scope = inference && inference.filesystemScope;
    for (const capability of server.capabilities || []) {
      const normalizedCategory = CAP_TO_CATEGORY[capability];
      if (!normalizedCategory) continue;
      const inferred = isInferred(capability, server, inference);
      const scoped = capability === 'filesystem_access' && scope;
      const evidence = (server.capabilityEvidence || []).find(e => e.capability === capability);
      permissions.push(models.createPermission({
        agentId: agent.id,
        integrationId: server.id,
        rawPermission: scoped ? `${server.name} (${capability}: ${scope.label})` : `${server.name} (${capability})`,
        normalizedCategory,
        accessLevel: scoped ? (['home', 'system'].includes(scope.worst) ? 'broad' : 'scoped') : capability === 'filesystem_access' && server.filesystemPathCount > 0 ? 'scoped' : 'broad',
        riskWeight: RISK_WEIGHT[capability] || 1,
        normalizationConfidence: inferred ? 0.7 : 0.85,
        normalizationReason: scoped ? `${reasonFor(capability, server, inference)} The directory argument${scope.grades.length === 1 ? ' covers' : 's cover'} ${scope.label}.` : reasonFor(capability, server, inference),
        source: { ...agent.source, evidenceClass: inferred ? 'inferred' : 'observed' },
        attributes: {
          basis: evidence ? evidence.basis : (inferred ? 'inferred' : 'configured'),
          ...(scoped ? { scope: scope.worst, scopeLabel: scope.label } : {}),
          ...(capability === 'credential_access' ? { credentialKind: (server.credentialReferences || []).length ? 'environment_name' : 'capability' } : {}),
          ...(capability === 'environment_access' ? { credentialKind: 'environment_name' } : {}),
        },
        createdAt: observedAt,
        updatedAt: observedAt,
      }));
    }
    permissions.push(...reachPermissions(agent, server, inference, observedAt));
  }
  return permissions;
}

/** Build a scanController provider from one client's scanner result. `builtin` is the client's built-in tool description, or null. */
function createConfigProvider({ clientKey, label, scannerResult, inferenceByServer = {}, overlayByServer = {}, builtin = null }) {
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
        permissions: [
          ...builtinPermissions(raw.agent, builtin, observedAt),
          ...derivePermissions(raw.agent, raw.records, inferenceByServer, observedAt, overlayByServer),
        ],
        mcpServers: raw.records,
        diagnostics: raw.diagnostics || [],
      };
    },
  };
}

module.exports = { createConfigProvider, derivePermissions, CAP_TO_CATEGORY };
