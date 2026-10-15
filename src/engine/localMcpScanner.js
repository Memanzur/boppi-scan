/** Consent-gated, metadata-only local MCP scanner for explicitly selected configs. */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : globalThis.BoppiAgentSecurityModels;
  const api = factory(models);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiLocalMcpScanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models) {
  'use strict';

  const SOURCE_SPECS = Object.freeze({
    'claude-desktop': Object.freeze({ id:'local-mcp-claude-desktop', name:'Claude Desktop MCP configuration', vendor:'Anthropic', type:'ai_assistant', agentName:'Claude Desktop' }),
    'claude-code': Object.freeze({ id:'local-mcp-claude-code', name:'Claude Code MCP configuration', vendor:'Anthropic', type:'coding_agent', agentName:'Claude Code' }),
    'cursor': Object.freeze({ id:'local-mcp-cursor', name:'Cursor MCP configuration', vendor:'Anysphere', type:'coding_agent', agentName:'Cursor' }),
  });
  const SENSITIVE_NAME = /(token|secret|password|private[_-]?key|api[_-]?key|authorization|cookie|credential)/i;
  // Positional arguments have no field name to key off. Keep this deliberately
  // conservative and redact common credential formats before they enter any
  // model, export, history file, or verifier bundle.
  const SENSITIVE_VALUE = /(?:bearer\s+|(?:sk|pk|rk|ghp|github_pat|xox[baprs]|sb_(?:publishable|secret)|bpc_|AKIA|ASIA)[A-Za-z0-9._~+/=-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i;
  const CREDENTIAL_URI = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
  const CREDENTIAL_AT_HOST = /(?:^|[=\s])[^\s/:=@]+:[^\s/@]+@[^\s]+/i;
  const SAFE_CAPABILITIES = new Set(['filesystem_access','shell_access','code_execution','network_access','environment_access','credential_access','browser_automation','untrusted_external_content']);

  function fail(message) { throw new TypeError(`Local MCP scanner: ${message}`); }
  function text(value, field, max = 240) {
    if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
    if (value.length > max) fail(`${field} is too long`);
    return value.trim();
  }
  function safeList(value, field) {
    if (value == null) return [];
    if (!Array.isArray(value)) fail(`${field} must be an array`);
    return value.filter(v => typeof v === 'string' && v.trim()).map(v => text(v, field, 240));
  }
  function pathFingerprint(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    return models.stableId('path', [value.trim()]);
  }
  function sanitizeEndpoint(value) {
    if (value == null || value === '') return null;
    const raw = text(value, 'endpoint', 1000);
    try {
      const url = new URL(raw);
      // URL paths can contain bearer tokens, signed paths, tenant IDs, or
      // other credentials. The origin is enough to classify network access.
      return `${url.protocol}//${url.host}`;
    } catch (_) {
      return null;
    }
  }
  // A flag whose name says it carries a credential: --api-key, --token, -p,
  // --key=..., DATABASE_PASSWORD=... The value may sit after '=' or in the
  // next argument, so the caller redacts both.
  const SENSITIVE_FLAG = /^(?:--?|\/)?[A-Za-z0-9_.-]*(?:key|token|secret|pass(?:word|wd|phrase)?|auth|cred(?:ential)?s?|cookie|session|signature|private)[A-Za-z0-9_.-]*(?:=|$)/i;
  function isSensitiveFlag(raw) { return SENSITIVE_FLAG.test(raw) || /^-p$/i.test(raw); }
  function sanitizeArgument(value) {
    const raw = text(value, 'argument', 500);
    if (SENSITIVE_NAME.test(raw) || SENSITIVE_VALUE.test(raw) || CREDENTIAL_URI.test(raw) || CREDENTIAL_AT_HOST.test(raw)) return '[redacted-sensitive-argument]';
    if (isSensitiveFlag(raw)) return raw.includes('=') ? `${raw.slice(0, raw.indexOf('='))}=[redacted-sensitive-argument]` : raw;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return sanitizeEndpoint(raw) || '[redacted-endpoint]';
    if (/^(\/|~\/|[A-Za-z]:[\\/])/.test(raw)) return pathFingerprint(raw);
    return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  }
  /** Sanitize an argument list; the value after a bare credential flag is redacted whatever it looks like. */
  function sanitizeArguments(list) {
    const out = [];
    let redactNext = false;
    for (const value of list) {
      if (redactNext) { out.push('[redacted-sensitive-argument]'); redactNext = false; continue; }
      const raw = text(value, 'argument', 500);
      out.push(sanitizeArgument(raw));
      redactNext = isSensitiveFlag(raw) && !raw.includes('=');
    }
    return out;
  }
  function sanitizeCommand(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const basename = value.trim().split(/[\\/]/).pop();
    if (!basename || SENSITIVE_NAME.test(basename) || /(?:sk|ghp|xox[baprs])-?[A-Za-z0-9_-]{12,}/i.test(basename)) {
      return '[redacted-sensitive-command]';
    }
    return basename.slice(0, 240);
  }
  function sanitizeEnv(env) {
    if (env == null) return { names:[], credentialReferences:[] };
    if (typeof env !== 'object' || Array.isArray(env)) fail('env must be an object of names to values');
    const names = Object.keys(env).filter(name => name && name.length <= 120).map(name => text(name, 'environment variable name', 120));
    return { names, credentialReferences:names.filter(name => SENSITIVE_NAME.test(name)) };
  }
  function declaredCapabilities(server) {
    const raw = safeList(server.capabilities, 'capabilities');
    return [...new Set(raw.filter(value => SAFE_CAPABILITIES.has(value)))];
  }
  function trustStatus(value) { return value === 'verified' || value === 'unverified' ? value : 'unknown'; }
  function scanConfig(input = {}) {
    if (input.consent !== true) fail('explicit consent is required');
    const spec = SOURCE_SPECS[input.source];
    if (!spec) fail(`unsupported source: ${input.source || 'unknown'}`);
    if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) fail('config must be an object');
    const servers = input.config.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) fail(`${input.source} config must contain an mcpServers object`);
    const configPath = input.configPath ? pathFingerprint(input.configPath) : null;
    const observedAt = input.observedAt || new Date().toISOString();
    const source = { id:spec.id, type:'local-mcp', evidenceClass:'observed', name:spec.name, observedAt, evidenceRef:'explicit local configuration scan' };
    const agent = models.createAgent({
      id:models.stableId('agent', ['local-mcp', input.source, configPath || input.agentName || spec.agentName]),
      providerAgentId:models.stableId('local-mcp-agent', [input.source, configPath || input.agentName || spec.agentName]),
      name:typeof input.agentName === 'string' && input.agentName.trim() ? input.agentName.trim() : spec.agentName,
      vendor:spec.vendor, type:spec.type, status:'active', deviceId:typeof input.deviceId === 'string' ? input.deviceId : null,
      confidence:0.85, source, createdAt:observedAt, updatedAt:observedAt,
    });
    const records = [];
    for (const [name, server] of Object.entries(servers)) {
      if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
      const serverName = text(name, 'server name', 160);
      const env = sanitizeEnv(server.env);
      const args = sanitizeArguments(safeList(server.args, `${serverName}.args`));
      const capabilities = declaredCapabilities(server);
      if (env.names.length) capabilities.push('environment_access');
      if (env.credentialReferences.length) capabilities.push('credential_access');
      if (Array.isArray(server.filesystemPaths) && server.filesystemPaths.length) capabilities.push('filesystem_access');
      const tools = safeList(server.tools, `${serverName}.tools`).map(value => value.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120)).filter(Boolean);
      const createdAt = observedAt;
      const record = models.createMCPServer({
        id:models.stableId('mcp', [input.source, configPath, serverName, server.command || server.url || '']),
        serverId:models.stableId('mcp-server', [input.source, serverName, server.command || server.url || '']),
        agentId:agent.id, name:serverName,
        command:sanitizeCommand(server.command),
        arguments:args, endpoint:sanitizeEndpoint(server.url || server.endpoint), configPath,
        exposedTools:tools, capabilities:[...new Set(capabilities)], trustStatus:trustStatus(server.trustStatus),
        filesystemPathCount:Array.isArray(server.filesystemPaths) ? server.filesystemPaths.length : 0,
        environmentVariableNames:env.names, credentialReferences:env.credentialReferences,
        dryRun:input.dryRun !== false, confidence:0.85, source:{...source, observedAt:createdAt}, createdAt, updatedAt:createdAt,
      });
      records.push(record);
    }
    return { agent, source:models.createScanSource({...source, observedAt}), sourceId:input.source, dryRun:input.dryRun !== false, consentRecorded:true, records, diagnostics:[] };
  }
  function normalize(raw) {
    if (!raw || !SOURCE_SPECS[raw.sourceId] || raw.consentRecorded !== true) fail('raw scan result lacks consent and source provenance');
    return { agent:raw.agent, mcpServers:raw.records || [], diagnostics:raw.diagnostics || [], source:raw.source, sourceId:raw.sourceId, dryRun:raw.dryRun !== false, consentRecorded:true };
  }
  return { id:'local-mcp-companion', version:'1.1.0', name:'Local MCP configuration scanner', supportedSources:Object.keys(SOURCE_SPECS), scanConfig, normalize, sanitizeEndpoint, pathFingerprint };
});
