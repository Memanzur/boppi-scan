/**
 * Public MCP server catalog. Entries and citations live in mcpCatalog.json.
 * Identity matching normalizes package specs: registry and scope prefixes,
 * version suffixes (@latest, @1.2.3, ==1.2.3), and image tags. Hyphenated
 * names then drop the MCP affixes mcp-server-, server-, -mcp-server, -mcp,
 * and -server, so brave-search and 1password-mcp resolve to a catalog row.
 * A hyphenated lookalike such as research-notes or github-stars-cache does
 * not, because those leftover words are not affixes.
 */
'use strict';
const CATALOG = require('./mcpCatalog.json');

const ROLE_CAPABILITIES = Object.freeze({
  files: ['filesystem_access'],
  'shell-files': ['shell_access', 'filesystem_access'],
  commands: ['shell_access'],
  kube: ['shell_access', 'network_access', 'credential_access'],
  browser: ['browser_automation', 'untrusted_external_content', 'network_access'],
  search: ['network_access', 'untrusted_external_content'],
  code: ['code_execution'],
  credential: ['credential_access'],
  data: ['sensitive_read'],
  'data-local': ['sensitive_read'],
  saas: ['sensitive_read'],
  'saas-message': ['sensitive_read', 'messaging_send'],
  email: ['sensitive_read', 'messaging_send', 'untrusted_external_content'],
  issues: ['sensitive_read', 'untrusted_external_content'],
  payment: ['network_access', 'production_access'],
  source: ['sensitive_read', 'source_write'],
  'source-local': ['source_write'],
  memory: [],
  reference: [],
});

/** Roles whose network connection is the read path, not an outbound exfil leg. */
const DATA_SOURCE_ROLES = new Set(['data', 'data-local', 'saas', 'saas-message', 'email', 'issues', 'source']);

const MESSAGE_NAME = /(?:^|[^a-z0-9])(?:slack|sendgrid|mailgun|gmail|resend)(?:[^a-z0-9]|$)/;
const ISSUE_NAME = /(?:^|[^a-z0-9])(?:jira|linear)(?:[^a-z0-9]|$)/;
const EMAIL_NAME = /(?:^|[^a-z0-9])(?:gmail|imap)(?:[^a-z0-9]|$)/;

function entryBlob(entry) {
  return [entry.id, ...(entry.commands || []), ...(entry.packages || []), ...(entry.images || [])].join(' ').toLowerCase();
}

function capabilitiesForEntry(entry) {
  const caps = capabilitiesForRole(entry.role);
  const blob = entryBlob(entry);
  const add = capability => { if (!caps.includes(capability)) caps.push(capability); };
  if (MESSAGE_NAME.test(blob) || EMAIL_NAME.test(blob)) add('messaging_send');
  if (ISSUE_NAME.test(blob) || EMAIL_NAME.test(blob)) add('untrusted_external_content');
  return caps;
}

const AFFIX_PREFIXES = ['mcp-server-', 'server-', 'mcp-'];
const AFFIX_SUFFIXES = ['-mcp-server', '-server', '-mcp'];
const BARE_AFFIX = new Set(['mcp', 'server', 'mcp-server']);

function capabilitiesForRole(role) {
  return ROLE_CAPABILITIES[role] ? [...ROLE_CAPABILITIES[role]] : ['network_access'];
}

function stripVersion(value) {
  let text = String(value).trim();
  text = text.replace(/==[^\s]+$/, '');
  text = text.replace(/@(?:latest|next|canary)$/i, '');
  text = text.replace(/@[0-9][A-Za-z0-9._+-]*$/, '');
  if (!text.includes('://')) text = text.replace(/:(?:latest|[0-9][\w.-]*)$/i, '');
  return text;
}

function normalizeName(value) {
  let text = stripVersion(value).toLowerCase();
  text = text.replace(/^(?:https?:\/\/)/, '');
  text = text.replace(/^(?:ghcr\.io|docker\.io|registry\.hub\.docker\.com|public\.ecr\.aws|quay\.io)\//, '');
  let scope = '';
  const scoped = text.match(/^@([a-z0-9_.-]+)\/(.+)$/);
  if (scoped) {
    scope = scoped[1];
    text = scoped[2];
  }
  text = text.replace(/[_/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return { name: text, scope };
}

function derivedKeys(value) {
  const { name, scope } = normalizeName(value);
  const keys = [];
  const push = key => { if (key && !BARE_AFFIX.has(key) && !keys.includes(key)) keys.push(key); };
  push(name);
  let current = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of AFFIX_PREFIXES) {
      if (current.startsWith(prefix) && current.length > prefix.length) {
        current = current.slice(prefix.length);
        push(current);
        changed = true;
      }
    }
    for (const suffix of AFFIX_SUFFIXES) {
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length);
        push(current);
        changed = true;
      }
    }
  }
  if (scope && (current === 'mcp' || current === 'server' || current === '')) push(scope);
  return keys;
}

const byKey = new Map();
const byHost = new Map();
for (const entry of CATALOG) {
  const aliases = [entry.id, ...(entry.packages || []), ...(entry.commands || []), ...(entry.images || [])];
  for (const alias of aliases) {
    for (const key of derivedKeys(alias)) {
      if (!byKey.has(key)) byKey.set(key, { entry, key });
    }
  }
  for (const host of entry.hosts || []) {
    const normalized = String(host).toLowerCase();
    if (!byHost.has(normalized)) byHost.set(normalized, entry);
  }
}

function bestKey(keys) {
  let best = null;
  for (const key of keys) {
    const hit = byKey.get(key);
    if (!hit) continue;
    if (!best || key.length > best.key.length) best = hit;
  }
  return best;
}

function matchIdentity(token) {
  const hit = bestKey(derivedKeys(token));
  if (!hit) return null;
  return { entry: hit.entry, key: hit.key, capabilities: capabilitiesForEntry(hit.entry), role: hit.entry.role };
}

function matchHost(host) {
  if (!host) return null;
  const entry = byHost.get(String(host).toLowerCase());
  if (!entry) return null;
  return { entry, key: host, capabilities: capabilitiesForEntry(entry), role: entry.role };
}

module.exports = {
  CATALOG, ROLE_CAPABILITIES, DATA_SOURCE_ROLES, capabilitiesForRole, derivedKeys, matchIdentity, matchHost,
};
