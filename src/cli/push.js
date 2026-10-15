/**
 * boppi push: send one scan's sanitized inventory to a Boppi workspace.
 *
 * This is the only command in the package that uses the network. It maps the
 * scanner's inventory onto the control plane's public ingest contract
 * (one record per agent, integration, permission, and MCP server) and POSTs
 * the batch as a snapshot with a collector bearer token.
 */
'use strict';

const DEFAULT_WORKSPACE_URL = 'https://app.boppi.io';
const INGEST_PATH = '/api/ingest';
const SNAPSHOT_MAX = 5000;
const MERGE_BATCH = 1000;
const RECORD_FIELD_MAX = 512;

const EVIDENCE_CLASS = Object.freeze({ observed: 'observed', imported: 'imported', inferred: 'inferred', fixture: 'inferred' });
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const clip = (value, max = RECORD_FIELD_MAX) => String(value).slice(0, max);
const confidenceOf = item => (Number.isFinite(item.confidence) ? item.confidence : item.normalizationConfidence);
const present = (key, value) => (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) ? {} : { [key]: value });

/** Ingest record for one inventory item; metadata fields match lib/engine/inventory.ts in the control plane. */
function record(kind, item, metadata) {
  const confidence = confidenceOf(item);
  return {
    kind,
    external_id: clip(item.id),
    name: clip(item.name || item.rawPermission || item.provider || item.id),
    evidence_class: EVIDENCE_CLASS[item.source && item.source.evidenceClass] || 'inferred',
    ...(Number.isFinite(confidence) ? { confidence } : {}),
    stale: Boolean(item.stale),
    metadata,
  };
}

/** The scanner inventory as ingest records. Findings stay local; the control plane derives its own. */
function toRecords(inventory) {
  const records = [];
  for (const agent of inventory.agents || []) {
    records.push(record('agent', agent, {
      type: agent.type || 'unknown',
      ...present('vendor', agent.vendor),
      ...present('owner', agent.owner),
      ...present('device_id', agent.deviceId),
    }));
  }
  for (const integration of inventory.integrations || []) {
    records.push(record('integration', integration, {
      agent_external_id: integration.agentId,
      provider: integration.provider || 'unknown',
      connection_type: integration.connectionType || 'unknown',
      ...present('account_label', integration.accountLabel),
      ...present('scopes', integration.rawScopes),
    }));
  }
  for (const permission of inventory.permissions || []) {
    records.push(record('permission', permission, {
      agent_external_id: permission.agentId,
      ...present('integration_external_id', permission.integrationId),
      category: permission.normalizedCategory || 'unknown',
      raw_permission: clip(permission.rawPermission || 'unknown'),
      access_level: permission.accessLevel || 'unknown',
    }));
  }
  for (const server of inventory.mcpServers || []) {
    records.push(record('mcp_server', server, {
      agent_external_id: server.agentId,
      ...present('command', server.command && clip(server.command)),
      ...present('args', (server.arguments || []).map(a => clip(a))),
      ...present('capabilities', server.capabilities),
      ...present('credential_references', server.credentialReferences),
      ...present('exposed_tools', server.exposedTools),
      trust_status: server.trustStatus || 'unknown',
      ...present('config_path', server.configPath && clip(server.configPath)),
    }));
  }
  return records;
}

/** Workspace or ingest URL as given by the user, resolved to the ingest endpoint. */
function resolveIngestUrl(input) {
  let url;
  try { url = new URL(input || DEFAULT_WORKSPACE_URL); } catch (_) { throw new Error(`--url is not a valid URL: ${input}`); }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('--url must use https (http is allowed only for localhost)');
  const given = url.pathname.replace(/\/+$/, '');
  if (given !== '' && given !== INGEST_PATH) throw new Error(`--url must be the workspace origin or end in ${INGEST_PATH}`);
  url.pathname = INGEST_PATH;
  url.search = '';
  url.hash = '';
  return url;
}

function workspaceUrl(ingestUrl) { return `${ingestUrl.protocol}//${ingestUrl.host}`; }

function counts(inventory) {
  return {
    agents: (inventory.agents || []).length,
    mcpServers: (inventory.mcpServers || []).length,
    permissions: (inventory.permissions || []).length,
    integrations: (inventory.integrations || []).length,
  };
}

async function postBatch({ ingestUrl, token, records, snapshot, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(ingestUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'boppi-cli' },
      body: JSON.stringify(snapshot ? { records, snapshot: true } : { records }),
    });
  } catch (error) {
    return { ok: false, networkError: error && error.cause && error.cause.message ? error.cause.message : (error.message || String(error)) };
  }
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

/**
 * Send the records. A snapshot goes as one request (the server caps a request
 * at SNAPSHOT_MAX records, which is also the snapshot ceiling). A merge is sent
 * in MERGE_BATCH-sized requests. Resolves to { ok, ingested } or the first
 * failed batch: { ok: false, status, body } or { ok: false, networkError }.
 */
async function pushRecords({ ingestUrl, token, records, snapshot, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('this Node version has no fetch(); Node 18 or newer is required');
  const batches = snapshot ? [records] : [];
  if (!snapshot) for (let start = 0; start < records.length; start += MERGE_BATCH) batches.push(records.slice(start, start + MERGE_BATCH));
  let ingested = 0;
  for (const batch of batches) {
    const result = await postBatch({ ingestUrl, token, records: batch, snapshot, fetchImpl });
    if (!result.ok) return result;
    ingested += Number.isFinite(result.body && result.body.ingested) ? result.body.ingested : batch.length;
  }
  return { ok: true, ingested };
}

const FAILURE_HINT = Object.freeze({
  401: 'The token was rejected. Copy a fresh one from the Collectors page (tokens are shown once, and revoked tokens stop working immediately).',
  413: 'The request body is too large. Scan fewer clients with --only and push each separately.',
  422: 'The workspace rejected the record shape. Update the scanner (npx boppi@latest) and try again.',
  503: 'The workspace is temporarily unavailable. Retry in a minute.',
});

function describeFailure(result) {
  if (result.networkError) return `Could not reach the workspace: ${result.networkError}`;
  const message = (result.body && result.body.error) || 'unknown error';
  const hint = FAILURE_HINT[result.status];
  const requestId = result.body && result.body.requestId ? ` (request ${result.body.requestId})` : '';
  return `Push rejected (HTTP ${result.status}): ${message}${requestId}${hint ? `\n${hint}` : ''}`;
}

module.exports = { DEFAULT_WORKSPACE_URL, INGEST_PATH, SNAPSHOT_MAX, MERGE_BATCH, toRecords, resolveIngestUrl, workspaceUrl, counts, pushRecords, describeFailure };
