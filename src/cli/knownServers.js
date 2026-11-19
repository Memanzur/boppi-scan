/**
 * Capability inference for MCP servers.
 *
 * Critical findings may use only two kinds of evidence:
 *   observed: a declared tool on the tool list, a capability the config
 *     already states, a directory argument that exists, or a non-loopback URL
 *   allowlist: the server name, command basename, or package argument equals
 *     an entry below
 * A substring hit on the joined config text stays on the server at grade
 * `substring`. It is visible in the inventory and cannot satisfy a critical
 * rule. Word boundaries are grouped so `search` does not match inside
 * `research-notes`, and the short words sandbox and vault do not match inside
 * a hyphenated name such as `sandbox-helper` or `obsidian-vault`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const GRADE_RANK = Object.freeze({ substring: 1, allowlist: 2, observed: 3 });

/** Exact identity tokens. Documented in docs/EVALUATION.md. */
const ALLOWLIST = Object.freeze([
  {
    label: 'filesystem server',
    capabilities: ['filesystem_access'],
    tokens: ['filesystem', 'file-system', 'file-server', '@modelcontextprotocol/server-filesystem', 'server-filesystem', 'mcp-server-filesystem'],
  },
  {
    label: 'shell or command server',
    capabilities: ['shell_access'],
    tokens: ['shell', 'desktop-commander', '@wonderwhy-er/desktop-commander', 'mcp-server-shell'],
  },
  {
    label: 'browser automation server',
    capabilities: ['browser_automation', 'untrusted_external_content', 'network_access'],
    tokens: ['puppeteer', 'playwright', '@modelcontextprotocol/server-puppeteer', '@playwright/mcp', 'server-puppeteer', 'mcp-server-puppeteer'],
  },
  {
    label: 'web fetch server',
    capabilities: ['network_access', 'untrusted_external_content'],
    tokens: ['fetch', 'mcp-server-fetch'],
  },
  {
    label: 'code execution server',
    capabilities: ['code_execution'],
    tokens: ['e2b', 'e2b-code-interpreter', 'code-interpreter', '@e2b/code-interpreter'],
  },
  {
    label: 'slack connector',
    capabilities: ['network_access'],
    tokens: ['slack', '@modelcontextprotocol/server-slack', 'server-slack', 'mcp-server-slack'],
  },
  {
    label: 'github connector',
    capabilities: ['network_access'],
    tokens: ['github', '@modelcontextprotocol/server-github', 'server-github', 'mcp-server-github'],
  },
  {
    label: 'credential manager',
    capabilities: ['credential_access'],
    tokens: ['1password', '@1password/mcp', 'bitwarden', 'keychain'],
  },
]);

/** Declared tool names. A hit is observed, not a guess from the server name. */
const TOOL_ALLOWLIST = Object.freeze([
  { label: 'declared shell tool', capabilities: ['shell_access'], names: ['run_bash', 'bash', 'execute_command', 'run_command', 'run_shell', 'shell_exec'] },
  { label: 'declared file tool', capabilities: ['filesystem_access'], names: ['read_file', 'read_text_file', 'write_file', 'list_directory', 'list_dir', 'list_files'] },
  { label: 'declared credential tool', capabilities: ['credential_access'], names: ['read_aws_credentials', 'get_secret', 'read_secret', 'read_secrets'] },
  { label: 'declared slack tool', capabilities: ['network_access'], names: ['post_slack_message', 'send_slack_message', 'slack_post_message'] },
  { label: 'declared browser tool', capabilities: ['browser_automation', 'untrusted_external_content', 'network_access'], names: ['browser_navigate', 'browser_click', 'playwright_navigate'] },
]);

function compile(parts, mode) {
  const body = parts.join('|');
  if (mode === 'phrase') return new RegExp(body, 'i');
  // token: hyphen and underscore belong to the word (research-notes, sandbox-helper, obsidian-vault).
  // word: hyphen splits words (price-fetch matches fetch, server-filesystem matches filesystem).
  const boundary = mode === 'token' ? '[^a-z0-9_-]' : '[^a-z0-9]';
  return new RegExp(`(?:^|${boundary})(?:${body})(?:$|${boundary})`, 'i');
}

const SUBSTRING_RULES = Object.freeze([
  { pattern: compile(['filesystem', 'file[-_]?system', 'file[-_]?server'], 'word'), capabilities: ['filesystem_access'], label: 'file access server' },
  { pattern: compile(['puppeteer', 'playwright', 'selenium', 'browserbase', 'browser[-_]?use', 'browsermcp', 'chrome-devtools'], 'word'), capabilities: ['browser_automation', 'untrusted_external_content', 'network_access'], label: 'browser automation server' },
  { pattern: compile(['fetch', 'firecrawl', 'crawler', 'scraper?', 'tavily', 'serpapi', 'exa-mcp', 'duckduckgo', 'kagi', 'perplexity'], 'word'), capabilities: ['network_access', 'untrusted_external_content'], label: 'web fetch or search server' },
  { pattern: compile(['search'], 'token'), capabilities: ['network_access', 'untrusted_external_content'], label: 'web fetch or search server' },
  { pattern: compile(['shell'], 'token'), capabilities: ['shell_access'], label: 'shell or command server' },
  { pattern: compile(['terminal', 'desktop[-_]?commander', 'applescript', 'osascript', 'command[-_]?runner', 'cli[-_]?mcp'], 'word'), capabilities: ['shell_access'], label: 'shell or command server' },
  { pattern: compile(['sandbox', 'repl'], 'token'), capabilities: ['code_execution'], label: 'code execution server' },
  { pattern: compile(['e2b', 'code[-_]?interpreter', 'run[-_]?python', 'riza', 'jupyter'], 'word'), capabilities: ['code_execution'], label: 'code execution server' },
  { pattern: compile(['github', 'gitlab', 'bitbucket', 'slack', 'discord', 'notion', 'linear', 'jira', 'asana', 'gmail', 'google[-_]?(?:drive|calendar|maps|sheets|workspace)', 'gdrive', 'supabase', 'stripe', 'sentry', 'cloudflare', 'azure', 'vercel', 'netlify', 'heroku', 'postgres', 'mysql', 'mongodb', 'redis', 'snowflake', 'salesforce', 'hubspot', 'airtable', 'zapier'], 'word'), capabilities: ['network_access'], label: 'external service connector' },
  { pattern: compile(['aws', 'gcp'], 'token'), capabilities: ['network_access'], label: 'external service connector' },
  { pattern: compile(['vault'], 'token'), capabilities: ['credential_access'], label: 'credential manager server' },
  { pattern: compile(['1password', 'keychain', 'bitwarden', 'secrets?[-_]?manager'], 'word'), capabilities: ['credential_access'], label: 'credential manager server' },
  { pattern: compile(['smtp'], 'token'), capabilities: ['network_access'], label: 'email service connector' },
  { pattern: compile(['sendgrid', 'mailgun', 'resend', 'email[-_]?send'], 'word'), capabilities: ['network_access'], label: 'email service connector' },
]);

const ALLOW_INDEX = new Map();
for (const rule of ALLOWLIST) {
  for (const token of rule.tokens) ALLOW_INDEX.set(token.toLowerCase(), rule);
}
const TOOL_INDEX = new Map();
for (const rule of TOOL_ALLOWLIST) {
  for (const name of rule.names) TOOL_INDEX.set(name.toLowerCase(), rule);
}

function expandHome(value, home) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('~/')) return path.join(home || os.homedir(), value.slice(2));
  return value;
}

function isExistingDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch (_) { return false; }
}

function toolNameOf(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = typeof value.name === 'string' ? value.name : typeof value.id === 'string' ? value.id : '';
    return raw.trim();
  }
  return '';
}

function identityTokens(name, server) {
  const tokens = [];
  if (typeof name === 'string' && name.trim()) tokens.push(name.trim());
  if (typeof server.command === 'string' && server.command.trim()) {
    tokens.push(server.command.trim().split(/[\\/]/).pop());
  }
  const args = Array.isArray(server.args) ? server.args : [];
  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    const value = arg.trim();
    if (!value || value.startsWith('-')) continue;
    if (/^(\/|~\/|[A-Za-z]:[\\/])/.test(value)) continue;
    if (/^[A-Za-z0-9_.@/-]+$/.test(value)) tokens.push(value);
  }
  return tokens;
}

function remoteHost(server) {
  const raw = server.url || server.endpoint;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try { url = new URL(raw.trim()); } catch (_) { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
  return url.host || null;
}

/**
 * Infer capabilities for one raw (pre-sanitization) MCP server config entry.
 * Returns { capabilities, capabilityGrades, filesystemPaths, inferences }.
 * capabilityGrades maps each capability to observed, allowlist, or substring.
 */
function inferCapabilities(name, server, options = {}) {
  const home = options.home || os.homedir();
  const spec = server && typeof server === 'object' ? server : {};
  const args = Array.isArray(spec.args) ? spec.args.filter(value => typeof value === 'string') : [];
  const capabilities = new Set();
  const grades = {};
  const inferences = [];

  function grant(caps, grade, label, matched) {
    const added = [];
    for (const capability of caps) {
      const previous = grades[capability];
      if (previous && GRADE_RANK[previous] > GRADE_RANK[grade]) continue;
      if (!previous || GRADE_RANK[grade] >= GRADE_RANK[previous]) grades[capability] = grade;
      if (!capabilities.has(capability)) {
        capabilities.add(capability);
        added.push(capability);
      }
    }
    if (added.length) inferences.push({ capabilities: added, label, matched, grade });
  }

  if (Array.isArray(spec.capabilities)) {
    const declared = spec.capabilities.filter(value => typeof value === 'string' && value.trim());
    if (declared.length) grant(declared, 'observed', 'capability declared in the config', declared.join(', '));
  }

  const toolNames = [];
  if (Array.isArray(spec.tools)) {
    for (const entry of spec.tools) {
      const toolName = toolNameOf(entry);
      if (toolName) toolNames.push(toolName);
    }
  }
  const toolsByRule = new Map();
  for (const toolName of toolNames) {
    const rule = TOOL_INDEX.get(toolName.toLowerCase());
    if (!rule) continue;
    if (!toolsByRule.has(rule)) toolsByRule.set(rule, []);
    toolsByRule.get(rule).push(toolName);
  }
  for (const [rule, names] of toolsByRule) grant(rule.capabilities, 'observed', rule.label, names.join(', '));

  const commandLine = [spec.command || '', ...args].join(' ');
  if (/claude mcp serve/i.test(commandLine)) {
    grant(['filesystem_access', 'shell_access', 'code_execution'], 'allowlist', 'Claude Code exposed as an MCP server (file, shell, and code tools)', 'claude mcp serve');
  }

  const seenRules = new Set();
  for (const token of identityTokens(name, spec)) {
    const rule = ALLOW_INDEX.get(token.toLowerCase());
    if (!rule || seenRules.has(rule)) continue;
    seenRules.add(rule);
    grant(rule.capabilities, 'allowlist', rule.label, token);
  }

  const filesystemPaths = [];
  for (const arg of args) {
    if (!/^(\/|~\/|[A-Za-z]:[\\/])/.test(arg)) continue;
    if (isExistingDirectory(expandHome(arg, home))) filesystemPaths.push(arg);
  }
  if (filesystemPaths.length) {
    grant(['filesystem_access'], 'observed', 'directory arguments', `${filesystemPaths.length} director${filesystemPaths.length === 1 ? 'y' : 'ies'}`);
  }

  const host = remoteHost(spec);
  if (host) grant(['network_access'], 'observed', 'remote MCP server', host);

  const haystack = [name, spec.command || '', ...args, spec.url || spec.endpoint || ''].join(' ');
  for (const rule of SUBSTRING_RULES) {
    const match = haystack.match(rule.pattern);
    if (!match) continue;
    const missing = rule.capabilities.filter(capability => !grades[capability]);
    if (!missing.length) continue;
    grant(missing, 'substring', rule.label, (match[0] || '').trim() || match[0]);
  }

  return { capabilities: [...capabilities], capabilityGrades: grades, filesystemPaths, inferences };
}

module.exports = { RULES: SUBSTRING_RULES, ALLOWLIST, TOOL_ALLOWLIST, inferCapabilities };
