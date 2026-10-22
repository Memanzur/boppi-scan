/**
 * Per-tool reach and filesystem scope. A server's capability ids are
 * server-wide and stop at one category each, so a GitHub connector that can
 * push commits looked the same as one that only reads issues, and a
 * filesystem server at ~/ looked the same as one at one project folder.
 * This module maps the tool names the catalog and the config already list
 * to the engine's finer categories, and grades a directory argument before
 * it is fingerprinted. Every output is a label; no path leaves here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Exact tool names from the catalog and common servers, mapped to engine categories.
const TOOL_TABLE = Object.freeze({
  push_files: 'modify_source_code', create_or_update_file: 'modify_source_code', merge_pull_request: 'modify_source_code', git_commit: 'modify_source_code',
  get_file_contents: 'read_source_code', search_code: 'read_source_code', git_show: 'read_source_code', git_diff: 'read_source_code', git_diff_unstaged: 'read_source_code', git_diff_staged: 'read_source_code',
  kubectl_apply: 'access_production_system', kubectl_delete: 'access_production_system', kubectl_create: 'access_production_system', kubectl_patch: 'access_production_system', kubectl_scale: 'access_production_system', kubectl_rollout: 'access_production_system', kubectl_generic: 'access_production_system', exec_in_pod: 'access_production_system', install_helm_chart: 'access_production_system', upgrade_helm_chart: 'access_production_system', uninstall_helm_chart: 'access_production_system',
  deploy_edge_function: 'access_production_system', apply_migration: 'access_production_system', execute_sql: 'access_production_system', pause_project: 'access_production_system', restore_project: 'access_production_system', d1_database_query: 'access_production_system',
  slack_post_message: 'send_external_message', slack_reply_to_thread: 'send_external_message', add_issue_comment: 'send_external_message', create_issue: 'send_external_message', create_pull_request_review: 'send_external_message', 'API-create-a-comment': 'send_external_message',
  create_refund: 'access_financial_data', cancel_subscription: 'access_financial_data', create_invoice: 'access_financial_data', finalize_invoice: 'access_financial_data', create_payment_link: 'access_financial_data', retrieve_balance: 'access_financial_data', list_payment_intents: 'access_financial_data', list_customers: 'access_customer_data', create_customer: 'access_customer_data',
  delete_file: 'delete_files', delete_entities: 'create_or_modify_records',
});

// Reading cluster or infrastructure state changes nothing; only a tool that can change it reaches a production system.
const INFRA_READ_ONLY = /^(kubectl|helm|terraform|k8s)[-_]?(get|describe|list|logs?|top|explain|events?|context|version|status|show|plan|diff|output|state[-_]?list|ping)(?:[-_]|$)/i;
// Name patterns for tools the table does not list, such as tools declared in a config entry.
const TOOL_RULES = Object.freeze([
  { pattern: /^(send|reply|forward)[-_]?(e?mail|message)s?$|^gmail[-_]?send|^(e?mail|message)[-_]?send/i, category: 'send_email' },
  { pattern: /^(read|get|list|search|fetch)[-_]?(e?mails?|inbox|messages?|threads?)$|^gmail[-_]?(read|search|list)/i, category: 'read_email' },
  { pattern: /^(delete|remove|trash)[-_]?(e?mail|message)s?$/i, category: 'send_email' },
  { pattern: /^(delete|remove|trash)[-_]?(file|directory|folder)s?$/i, category: 'delete_files' },
  { pattern: /^(kubectl|helm|terraform|k8s)[-_]?(apply|delete|create|patch|scale|rollout|exec|edit|replace|set|install|upgrade|uninstall|destroy|import|taint|cordon|drain|restart|run)(?:[-_]|$)|^(deploy|rollout|promote|release)[-_]/i, category: 'access_production_system' },
  { pattern: /^(push|commit)[-_]?(files?|changes?|commits?)?$|^merge[-_]?(pull|merge)[-_]?request/i, category: 'modify_source_code' },
]);

// Whether the config names which environment a production-capable server points at. Only an explicit word counts; silence is unknown.
const PRODUCTION_WORDS = /(^|[^a-z])(prod|production|live)($|[^a-z])/i;
const NON_PRODUCTION_WORDS = /(^|[^a-z])(dev|development|staging|stage|test|testing|sandbox|local|minikube|kind|preview|qa)($|[^a-z])/i;
function environmentOf(haystack) {
  if (typeof haystack !== 'string') return 'unknown';
  if (PRODUCTION_WORDS.test(haystack)) return 'production';
  if (NON_PRODUCTION_WORDS.test(haystack)) return 'non_production';
  return 'unknown';
}

// Server identity rules for categories no tool name carries, keyed by the same haystack knownServers uses.
const IDENTITY_RULES = Object.freeze([
  { pattern: /gmail|outlook|(^|[^a-z])imap($|[^a-z])|(^|[^a-z])mail[-_]?(mcp|server)|email[-_]?mcp|mcp[-_]?(g?mail|email)/i, categories: ['read_email', 'send_email'], label: 'email connector' },
  { pattern: /(^|[^a-z])smtp($|[^a-z])|sendgrid|mailgun|resend|email[-_]?send/i, categories: ['send_email'], label: 'email sending service' },
]);

const CATEGORY_LABEL = Object.freeze({
  modify_source_code: 'modify source code', read_source_code: 'read source code', access_production_system: 'reach a production system',
  send_external_message: 'send external messages', send_email: 'send email', read_email: 'read email', delete_files: 'delete files',
  access_financial_data: 'access financial data', access_customer_data: 'access customer data', create_or_modify_records: 'create or modify records',
  access_credentials: 'access credentials',
});

/**
 * Categories a server reaches through its tools: one entry per category
 * with the tool names behind it. `tools` are {tool, basis} from inference.
 */
function toolReach(tools, haystack) {
  const byCategory = new Map();
  const add = (category, tool, basis) => {
    if (!byCategory.has(category)) byCategory.set(category, { category, label: CATEGORY_LABEL[category] || category.replace(/_/g, ' '), tools: [], basis });
    const entry = byCategory.get(category);
    if (!entry.tools.includes(tool)) entry.tools.push(tool);
    if (basis === 'configured') entry.basis = 'configured';
  };
  for (const { tool, basis } of tools || []) {
    const exact = TOOL_TABLE[tool];
    if (exact) { add(exact, tool, basis); continue; }
    if (INFRA_READ_ONLY.test(tool)) continue;
    const rule = TOOL_RULES.find(r => r.pattern.test(tool));
    if (rule) add(rule.category, tool, basis);
  }
  for (const rule of IDENTITY_RULES) {
    const match = typeof haystack === 'string' && haystack.match(rule.pattern);
    if (!match) continue;
    // A name is an identity hint, never a tool list: the reach is recorded as inferred so the rubric treats it as assumed.
    for (const category of rule.categories) add(category, `${rule.label} (${match[0].trim()})`, 'inferred');
  }
  const production = byCategory.get('access_production_system');
  if (production) { production.writeAccess = true; production.environment = environmentOf(haystack); }
  return [...byCategory.values()];
}

const SCOPE_RANK = Object.freeze({ system: 5, home: 4, secrets: 3, source: 2, other: 1 });
const SCOPE_LABEL = Object.freeze({
  system: 'a system-wide directory', home: 'the whole home directory', secrets: 'a dotfile or secrets folder', source: 'a source tree', other: 'a folder elsewhere',
});
const SECRET_NAMES = new Set(['.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', '.config', '.azure', '.gcloud', '.boppi', '.claude', '.cursor', '.netrc', 'secrets', 'credentials', 'keys', '.password-store', '.1password']);
const SOURCE_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', '.hg'];
const SYSTEM_ROOTS = new Set(['/', '/etc', '/usr', '/var', '/opt', '/bin', '/sbin', '/lib', '/private', '/users', '/home', '/system', '/library', '/applications', '/volumes']);

function exists(candidate) { try { fs.statSync(candidate); return true; } catch (_) { return false; } }

/** Coarse grade of one existing directory argument, computed from the path and the directory's contents, never kept with the path. */
function scopeOf(directory, home) {
  const root = path.resolve(home || os.homedir());
  const resolved = path.resolve(directory);
  const lower = resolved.toLowerCase();
  if (resolved === root) return 'home';
  if (/^[A-Za-z]:\\?$/.test(resolved) || SYSTEM_ROOTS.has(lower) || (root.startsWith(resolved + path.sep) && resolved !== root)) return 'system';
  const underHome = resolved.startsWith(root + path.sep);
  const segments = (underHome ? resolved.slice(root.length + 1) : resolved).split(path.sep).filter(Boolean);
  if (segments.some(segment => SECRET_NAMES.has(segment.toLowerCase()) || (underHome && segment.startsWith('.')))) return 'secrets';
  if (SOURCE_MARKERS.some(marker => exists(path.join(resolved, marker)))) return 'source';
  return 'other';
}

/** The scope grades of a list of existing directories, worst first, with a one-line label. */
function filesystemScope(directories, home) {
  const grades = [...new Set((directories || []).map(d => scopeOf(d, home)))].sort((a, b) => SCOPE_RANK[b] - SCOPE_RANK[a]);
  if (!grades.length) return null;
  return { worst: grades[0], grades, label: grades.map(g => SCOPE_LABEL[g]).join(' and ') };
}

const WRITE_TOOL = /^(write|edit|move|create|delete|rename|append|git_(commit|add|reset|checkout))/i;
/** Extra categories a filesystem grant implies from where it points and whether the server can write. */
function scopeReach(scope, tools) {
  if (!scope) return [];
  const out = [];
  const canWrite = (tools || []).some(t => WRITE_TOOL.test(t.tool));
  if (scope.grades.includes('secrets') || scope.grades.includes('home') || scope.grades.includes('system')) out.push({ category: 'access_credentials', label: CATEGORY_LABEL.access_credentials, tools: [], basis: 'configured', because: `the directory argument covers ${SCOPE_LABEL[scope.grades.find(g => ['secrets', 'home', 'system'].includes(g))]}` });
  if (scope.grades.includes('source') || scope.grades.includes('home') || scope.grades.includes('system')) {
    out.push({ category: 'read_source_code', label: CATEGORY_LABEL.read_source_code, tools: [], basis: 'configured', because: 'the directory argument covers a source tree' });
    if (canWrite) out.push({ category: 'modify_source_code', label: CATEGORY_LABEL.modify_source_code, tools: (tools || []).filter(t => WRITE_TOOL.test(t.tool)).map(t => t.tool), basis: 'configured', because: 'the directory argument covers a source tree and the server has write tools' });
  }
  return out;
}

module.exports = { TOOL_TABLE, TOOL_RULES, IDENTITY_RULES, INFRA_READ_ONLY, CATEGORY_LABEL, SCOPE_LABEL, toolReach, environmentOf, scopeOf, filesystemScope, scopeReach };
