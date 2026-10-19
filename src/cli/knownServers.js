/**
 * Capability inference for MCP servers found in config files.
 * CLI-only layer: config files rarely declare capabilities, so the CLI infers
 * them from evidenced identity. The known-server catalog (exact package
 * identity) runs first; the name rules below add what the catalog did not
 * mention. Every inference is labeled with what matched and the kind of
 * evidence (basis) behind it, and the derived permission records carry
 * evidenceClass 'inferred', never presented as observed fact.
 *
 * Evidence kinds: 'configured' (an explicit config field: a capabilities
 * array, a url, an existing directory argument, environment variable names),
 * 'catalog' (exact identity matched a catalog entry), 'inferred' (name rule).
 * 'observed' (runtime) and 'verified' (post-fix rescan) are never produced
 * here; the checkup says so.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { matchCatalog } = require('./serverCatalog');

const RULES = Object.freeze([
  { pattern: /claude mcp serve/i, capabilities: ['filesystem_access', 'shell_access', 'code_execution'], label: 'Claude Code exposed as an MCP server (file, shell, and code tools)' },
  { pattern: /filesystem|file[-_]?system|file[-_]?server/i, capabilities: ['filesystem_access'], label: 'file access server' },
  { pattern: /puppeteer|playwright|selenium|browserbase|browser[-_]?use|browsermcp|chrome-devtools/i, capabilities: ['browser_automation', 'untrusted_external_content', 'network_access'], label: 'browser automation server' },
  { pattern: /(^|[^a-z])fetch|firecrawl|crawler|scraper?|search|tavily|serpapi|exa-mcp|duckduckgo|kagi|perplexity/i, capabilities: ['network_access', 'untrusted_external_content'], label: 'web fetch or search server' },
  { pattern: /shell|terminal|desktop[-_]?commander|applescript|osascript|command[-_]?runner|cli[-_]?mcp/i, capabilities: ['shell_access'], label: 'shell or command server' },
  { pattern: /e2b|code[-_]?interpreter|run[-_]?python|riza|sandbox|jupyter|(^|[^a-z])repl($|[^a-z])/i, capabilities: ['code_execution'], label: 'code execution server' },
  { pattern: /github|gitlab|bitbucket|slack|discord|notion|linear|jira|asana|gmail|google[-_]?(drive|calendar|maps|sheets|workspace)|gdrive|supabase|stripe|sentry|cloudflare|(^|[^a-z])aws($|[^a-z])|azure|(^|[^a-z])gcp($|[^a-z])|vercel|netlify|heroku|postgres|mysql|mongodb|redis|snowflake|salesforce|hubspot|airtable|zapier/i, capabilities: ['network_access'], label: 'external service connector' },
  { pattern: /1password|keychain|(^|[^a-z])vault($|[^a-z])|bitwarden|secrets?[-_]?manager/i, capabilities: ['credential_access'], label: 'credential manager server' },
  { pattern: /(^|[^a-z])smtp($|[^a-z])|sendgrid|mailgun|resend|email[-_]?send/i, capabilities: ['network_access'], label: 'email service connector' },
]);

function expandHome(value, home) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('~/')) return path.join(home || os.homedir(), value.slice(2));
  return value;
}

function isExistingDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch (_) { return false; }
}

/**
 * Infer capabilities for one raw (pre-sanitization) MCP server config entry.
 * Returns { capabilities, filesystemPaths, inferences, catalog, tools,
 * capabilityEvidence }. Each inference records which evidence produced which
 * capabilities and its basis; capabilityEvidence has one entry per capability
 * naming the first evidence that established it.
 */
function inferCapabilities(name, server, options = {}) {
  const home = options.home || os.homedir();
  const args = Array.isArray(server.args) ? server.args.filter(v => typeof v === 'string') : [];
  const haystack = [name, server.command || '', ...args, server.url || server.endpoint || ''].join(' ');
  const capabilities = new Set();
  const inferences = [];
  const capabilityEvidence = [];
  const add = (list, basis, matched) => {
    const added = list.filter(c => !capabilities.has(c));
    for (const capability of added) {
      capabilities.add(capability);
      capabilityEvidence.push({ capability, basis, matched });
    }
    return added;
  };

  add(Array.isArray(server.capabilities) ? server.capabilities : [], 'configured', 'capabilities');

  const catalogMatch = matchCatalog(server);
  const catalog = catalogMatch ? catalogMatch.entry : null;
  if (catalog) {
    const added = add(catalog.capabilities, 'catalog', catalogMatch.identity.name);
    if (added.length) inferences.push({ capabilities: added, label: `known server catalog: ${catalog.label}`, matched: catalogMatch.identity.name, basis: 'catalog' });
  }

  for (const rule of RULES) {
    const match = haystack.match(rule.pattern);
    if (!match) continue;
    const added = add(rule.capabilities, 'inferred', match[0].trim() || match[0]);
    if (added.length) inferences.push({ capabilities: added, label: rule.label, matched: match[0].trim() || match[0], basis: 'inferred' });
  }

  if (typeof (server.url || server.endpoint) === 'string' && (server.url || server.endpoint).trim()) {
    const added = add(['network_access'], 'configured', 'url');
    if (added.length) inferences.push({ capabilities: added, label: 'remote MCP server', matched: 'url', basis: 'configured' });
  }

  const filesystemPaths = [];
  for (const arg of args) {
    if (!/^(\/|~\/|[A-Za-z]:[\\/])/.test(arg)) continue;
    if (isExistingDirectory(expandHome(arg, home))) filesystemPaths.push(arg);
  }
  if (filesystemPaths.length) {
    const matched = `${filesystemPaths.length} director${filesystemPaths.length === 1 ? 'y' : 'ies'}`;
    const added = add(['filesystem_access'], 'configured', matched);
    if (added.length) inferences.push({ capabilities: added, label: 'directory arguments', matched, basis: 'configured' });
  }

  const configuredTools = Array.isArray(server.tools) ? server.tools.filter(v => typeof v === 'string') : [];
  const tools = [...new Set([...configuredTools, ...(catalog ? catalog.tools : [])])];
  return { capabilities: [...capabilities], filesystemPaths, inferences, catalog, tools, capabilityEvidence };
}

module.exports = { RULES, inferCapabilities };
