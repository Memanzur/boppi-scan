/**
 * What Boppi keeps from a server's own answers. Everything a server sends is
 * untrusted text: names are validated, descriptions are truncated and
 * stripped, schemas are pruned to a shape, instructions and icons are dropped.
 * Pure functions; no process, no I/O. See docs/phase3/DISCOVERY_SPIKE.md §5.
 */
'use strict';

const LIMITS = Object.freeze({
  nameLength: 128,
  textLength: 128,
  descriptionLength: 160,
  schemaDepth: 8,
  schemaKeys: 200,
  toolsPerPage: 500,
  pages: 20,
  lineBytes: 256 * 1024,
  totalBytes: 2 * 1024 * 1024,
});
const ACCEPTED_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26']);
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const ANNOTATIONS = Object.freeze(['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']);
const PARAMETER_HINTS = Object.freeze([
  ['path', /path|file|dir|folder/i],
  ['url', /url|uri|endpoint|host/i],
  ['command', /command|cmd|script|shell|exec/i],
  ['credential', /token|secret|password|key|credential/i],
]);

/** Printable text, control characters and escape sequences removed, cut to `max`. */
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** The initialize result reduced to identity and the tools capability. `instructions` is prompt text and is dropped. */
function projectInitialize(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { accepted: false, reason: 'initialize result is not an object' };
  const version = typeof result.protocolVersion === 'string' ? result.protocolVersion : null;
  if (!ACCEPTED_VERSIONS.includes(version)) return { accepted: false, reason: `unsupported protocol version ${version === null ? '(missing)' : JSON.stringify(cleanText(version, 32))}` };
  const info = result.serverInfo && typeof result.serverInfo === 'object' ? result.serverInfo : {};
  const tools = result.capabilities && result.capabilities.tools && typeof result.capabilities.tools === 'object' ? result.capabilities.tools : null;
  return {
    accepted: true,
    protocolVersion: version,
    serverInfo: { name: cleanText(info.name, LIMITS.nameLength), version: cleanText(info.version, LIMITS.textLength), title: cleanText(info.title, LIMITS.nameLength) },
    toolsCapability: tools !== null,
    listChanged: tools !== null && tools.listChanged === true,
  };
}

/** Schema reduced to a shape: nesting bounded, values that could carry data dropped, parameter names kept for hints. */
function schemaShape(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { valid: false, parameterCount: 0, parameterNames: [], truncated: false };
  let keys = 0, truncated = false;
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (depth > LIMITS.schemaDepth) { truncated = true; return; }
    for (const key of Object.keys(node)) {
      keys += 1;
      if (keys > LIMITS.schemaKeys) { truncated = true; return; }
      if (key === 'properties' && node.properties && typeof node.properties === 'object') for (const child of Object.values(node.properties)) walk(child, depth + 1);
      else if (key === 'items') walk(node.items, depth + 1);
    }
  };
  walk(schema, 0);
  const names = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? Object.keys(schema.properties).map(n => cleanText(n, 64)).filter(Boolean).slice(0, 50)
    : [];
  return { valid: true, parameterCount: names.length, parameterNames: names, truncated };
}

function parameterHints(names) {
  const hints = new Set();
  for (const name of names) for (const [hint, pattern] of PARAMETER_HINTS) if (pattern.test(name)) hints.add(hint);
  return [...hints].sort();
}

/** One tool reduced to what grading and display need. Returns { tool } or { rejected }. */
function projectTool(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { rejected: { reason: 'tool is not an object' } };
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (name === null) return { rejected: { reason: 'tool has no name' } };
  if (!TOOL_NAME.test(name)) return { rejected: { reason: 'tool name is not 1 to 128 characters of letters, digits, underscore, hyphen, dot', name: cleanText(name, 40) } };
  const shape = schemaShape(raw.inputSchema);
  const annotations = {};
  if (raw.annotations && typeof raw.annotations === 'object') for (const key of ANNOTATIONS) if (typeof raw.annotations[key] === 'boolean') annotations[key] = raw.annotations[key];
  return { tool: {
    name,
    title: cleanText(raw.title, LIMITS.nameLength),
    description: cleanText(raw.description, LIMITS.descriptionLength),
    inputSchemaValid: shape.valid,
    parameterCount: shape.parameterCount,
    parameterHints: parameterHints(shape.parameterNames),
    schemaTruncated: shape.truncated,
    annotations,
    hasOutputSchema: !!(raw.outputSchema && typeof raw.outputSchema === 'object'),
  } };
}

/**
 * All pages of a tools/list exchange reduced to one projection.
 * pages: [{ tools: [...] }] in the order received; options.partial names the
 * bound that stopped the session, if any.
 */
function projectToolList(pages, options = {}) {
  const tools = [];
  const rejected = [];
  const seen = new Map();
  let received = 0;
  for (const page of pages || []) {
    const list = page && Array.isArray(page.tools) ? page.tools : [];
    for (const raw of list.slice(0, LIMITS.toolsPerPage)) {
      received += 1;
      const result = projectTool(raw);
      if (result.rejected) { rejected.push(result.rejected); continue; }
      const prior = seen.get(result.tool.name);
      if (prior) { prior.duplicate = true; continue; }
      seen.set(result.tool.name, result.tool);
      tools.push(result.tool);
    }
    if (list.length > LIMITS.toolsPerPage) rejected.push({ reason: `page held ${list.length} tools; only the first ${LIMITS.toolsPerPage} were read` });
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return {
    tools,
    rejected,
    counts: { pages: (pages || []).length, received, kept: tools.length, rejected: rejected.length, duplicates: tools.filter(t => t.duplicate).length },
    partial: Boolean(options.partial),
    partialReason: options.partial || null,
  };
}

module.exports = { LIMITS, ACCEPTED_VERSIONS, cleanText, projectInitialize, projectTool, projectToolList, schemaShape };
