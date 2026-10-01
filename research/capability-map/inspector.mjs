#!/usr/bin/env node
// Static inspector: scans a package's JS and TS sources for capability signals.
// Every hit records file, line, and matched text. No execution, no network.
//
//   node inspector.mjs                      inspect every package in corpus/index.json, write inspector-output.json
//   node inspector.mjs <dir>                inspect one extracted package, print the result
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const INSPECTOR_VERSION = '0.1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// One row per signal. `modules` are import specifiers (node: prefix and subpaths are normalized away).
// `members` are call names that upgrade an import hit to a call hit. `importSuffices` means a bare
// import already implies the capability; otherwise a claim needs a call site in the same file.
export const SIGNALS = Object.freeze([
  { id: 'child_process', category: 'run_shell_commands', modules: ['child_process'], members: ['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'], importSuffices: false },
  { id: 'shell_libs', category: 'run_shell_commands', modules: ['execa', 'zx', 'shelljs', 'cross-spawn', 'node-pty', 'tinyexec', 'nano-spawn'], importSuffices: true },
  { id: 'fs_read', category: 'read_files', modules: ['fs', 'fs-extra', 'graceful-fs'], members: ['readFile', 'readFileSync', 'readdir', 'readdirSync', 'createReadStream', 'opendir', 'opendirSync', 'readJson', 'readJsonSync'], importSuffices: false },
  { id: 'glob', category: 'read_files', modules: ['glob', 'fast-glob', 'globby', 'tinyglobby'], importSuffices: true },
  { id: 'fs_write', category: 'write_files', modules: ['fs', 'fs-extra', 'graceful-fs'], members: ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rename', 'renameSync', 'createWriteStream', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'writeJson', 'writeJsonSync', 'outputFile', 'outputFileSync', 'ensureDir', 'ensureDirSync', 'ensureFile', 'truncate', 'truncateSync', 'symlink', 'symlinkSync'], importSuffices: false },
  { id: 'fs_delete', category: 'delete_files', modules: ['fs', 'fs-extra', 'graceful-fs'], members: ['rm', 'rmSync', 'unlink', 'unlinkSync', 'rmdir', 'rmdirSync', 'remove', 'removeSync', 'emptyDir', 'emptyDirSync'], importSuffices: false },
  { id: 'delete_libs', category: 'delete_files', modules: ['rimraf', 'del', 'trash'], importSuffices: true },
  { id: 'http_client', category: 'call_external_api', modules: ['http', 'https', 'http2'], members: ['request', 'get'], importSuffices: false },
  { id: 'net', category: 'call_external_api', modules: ['net', 'tls', 'dgram'], members: ['connect', 'createConnection', 'createSocket'], importSuffices: false },
  { id: 'http_libs', category: 'call_external_api', modules: ['undici', 'axios', 'node-fetch', 'got', 'ky', 'superagent', 'request', 'needle', 'phin', 'cross-fetch', 'isomorphic-fetch', 'ofetch', 'wretch', 'ws', 'socket.io-client', 'graphql-request', '@apollo/client', 'openai', '@anthropic-ai/sdk', '@google/generative-ai', '@google/genai'], importSuffices: true },
  { id: 'fetch_global', category: 'call_external_api', globals: [/(?<![\w.$])fetch\s*\(/], importSuffices: true },
  { id: 'browser', category: 'browser_automation', modules: ['puppeteer', 'puppeteer-core', 'puppeteer-extra', 'playwright', 'playwright-core', '@playwright/test', 'patchright', 'rebrowser-playwright', 'selenium-webdriver', 'chrome-remote-interface', 'webdriverio', '@browserbasehq/sdk', '@browserbasehq/stagehand', 'chrome-launcher', 'lighthouse'], importSuffices: true },
  { id: 'vm', category: 'execute_code', modules: ['vm'], members: ['runInNewContext', 'runInContext', 'runInThisContext', 'Script', 'compileFunction', 'createContext'], importSuffices: false },
  { id: 'sandbox_libs', category: 'execute_code', modules: ['isolated-vm', 'vm2', '@e2b/code-interpreter', 'e2b', 'quickjs-emscripten', '@jitl/quickjs-wasmfile-release-sync', 'node-eval', 'safe-eval'], importSuffices: true },
  { id: 'eval_global', category: 'execute_code', globals: [/(?<![\w.$])eval\s*\(/, /new\s+Function\s*\(/], importSuffices: true },
  { id: 'worker_eval', category: 'execute_code', modules: ['worker_threads'], members: ['Worker'], requireText: /eval\s*:\s*true/, importSuffices: false },
  { id: 'credential_stores', category: 'access_credentials', modules: ['keytar', '@napi-rs/keyring', 'node-vault', 'hashi-vault-js', '@aws-sdk/client-secrets-manager', '@aws-sdk/client-ssm', '@azure/keyvault-secrets', '@google-cloud/secret-manager', 'keychain', '@1password/sdk', '@1password/connect', '@1password/op-js', '@bitwarden/sdk-napi', 'infisical-node', '@infisical/sdk', '@doppler/sdk'], importSuffices: true },
  { id: 'email', category: 'send_email', modules: ['nodemailer', '@sendgrid/mail', 'resend', 'mailgun-js', 'mailgun.js', 'postmark', '@aws-sdk/client-ses', '@aws-sdk/client-sesv2', 'mailersend', '@getbrevo/brevo'], importSuffices: true },
  { id: 'service_sdks', category: 'call_external_api', modules: ['@octokit/rest', '@octokit/core', '@octokit/graphql', '@octokit/request', '@octokit/plugin-paginate-rest', 'octokit', '@notionhq/client', 'googleapis', '@googleapis/drive', '@googleapis/calendar', '@googleapis/gmail', '@supabase/supabase-js', 'stripe', 'jira-client', 'jira.js', '@linear/sdk', '@sentry/node', 'cloudflare', '@aws-sdk/client-s3', '@aws-sdk/client-dynamodb', '@aws-sdk/client-lambda', '@aws-sdk/client-ec2', 'aws-sdk', '@azure/identity', '@azure/arm-resources', '@google-cloud/storage', '@google-cloud/bigquery', 'pg', 'postgres', 'mysql2', 'mysql', 'mongodb', 'mongoose', 'ioredis', 'redis', 'snowflake-sdk', 'jsforce', '@hubspot/api-client', 'airtable', '@vercel/sdk', 'firebase-admin', '@elastic/elasticsearch', '@clickhouse/client', 'neo4j-driver', '@pinecone-database/pinecone', '@qdrant/js-client-rest', 'weaviate-client', 'chromadb', 'twilio', '@slack/web-api', '@slack/bolt', 'discord.js', 'telegraf', 'node-telegram-bot-api', '@microsoft/microsoft-graph-client', '@atlassian/confluence', 'confluence.js'], importSuffices: true },
  { id: 'chat_sdks', category: 'send_external_message', modules: ['@slack/web-api', '@slack/bolt', '@slack/webhook', 'discord.js', 'telegraf', 'node-telegram-bot-api', 'twilio', '@microsoft/teams-js', 'botbuilder', 'whatsapp-web.js'], importSuffices: true },
  { id: 'env_secrets', category: 'access_environment_variables', globals: [/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g], nameFilter: /key|token|secret|password|passwd|credential|auth/i, importSuffices: true },
]);

export const CATEGORIES = Object.freeze([...new Set(SIGNALS.map(s => s.category))]);

const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/;
const SKIP_RULES = [
  [/(^|\/)node_modules\//, 'node_modules'],
  [/\.d\.(ts|mts|cts)$/, 'type declaration'],
  [/(^|\/)(test|tests|__tests__|spec|__mocks__|fixtures?|e2e)\//, 'test directory'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, 'test file'],
  [/(^|\/)(examples?|docs?|samples?|benchmarks?)\//, 'example or docs directory'],
  [/\.map$/, 'source map'],
];
const MINIFIED_LINE = 2000;

const IMPORT_RE = /(?:require\s*\(\s*|from\s+|import\s+|import\s*\(\s*)['"]([^'"\n]+)['"]/g;

function normalizeModule(spec) {
  let m = spec.replace(/^node:/, '');
  if (m.startsWith('.') || m.startsWith('/')) return null;
  const parts = m.split('/');
  m = m.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return m;
}

function skipReason(rel) {
  for (const [re, reason] of SKIP_RULES) if (re.test(rel)) return reason;
  if (!SOURCE_EXT.test(rel)) return null;
  return null;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function lineText(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  const raw = text.slice(start, end).trim();
  if (raw.length <= 200) return raw;
  const offset = Math.max(0, index - start - 80);
  return raw.slice(offset, offset + 200);
}

function memberRegex(members) {
  return new RegExp(`(?<![\\w$])(?:${members.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\)?\\s*\\(`, 'g');
}

/** Scan one source file. Returns signal hits with evidence. */
export function scanSource(rel, text) {
  const hits = [];
  const imported = new Map();
  for (const m of text.matchAll(IMPORT_RE)) {
    const mod = normalizeModule(m[1]);
    if (!mod) continue;
    if (!imported.has(mod)) imported.set(mod, { index: m.index, spec: m[1] });
  }
  for (const signal of SIGNALS) {
    if (signal.modules) {
      for (const mod of signal.modules) {
        const imp = imported.get(mod);
        if (!imp) continue;
        const importEvidence = { file: rel, line: lineAt(text, imp.index), text: lineText(text, imp.index), kind: 'import', module: mod };
        let callEvidence = [];
        if (signal.members) {
          for (const call of text.matchAll(memberRegex(signal.members))) {
            callEvidence.push({ file: rel, line: lineAt(text, call.index), text: lineText(text, call.index), kind: 'call', module: mod });
            if (callEvidence.length >= 5) break;
          }
        }
        if (signal.requireText && !signal.requireText.test(text)) callEvidence = [];
        if (callEvidence.length) hits.push({ signal: signal.id, category: signal.category, strength: 'call', evidence: [importEvidence, ...callEvidence] });
        else if (signal.importSuffices) hits.push({ signal: signal.id, category: signal.category, strength: 'import', evidence: [importEvidence] });
        else hits.push({ signal: signal.id, category: signal.category, strength: 'import_only', evidence: [importEvidence] });
      }
    }
    if (signal.globals) {
      const evidence = [];
      for (const re of signal.globals) {
        const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
        for (const m of text.matchAll(new RegExp(re.source, flags))) {
          if (signal.nameFilter) {
            const name = m[1] || m[2] || '';
            if (!signal.nameFilter.test(name)) continue;
          }
          evidence.push({ file: rel, line: lineAt(text, m.index), text: lineText(text, m.index), kind: 'global' });
          if (evidence.length >= 5) break;
        }
      }
      if (evidence.length) hits.push({ signal: signal.id, category: signal.category, strength: 'call', evidence });
    }
  }
  return hits;
}

function listFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out;
}

/** Inspect one extracted package directory. Deterministic for a fixed tree. */
export function inspectPackage(root) {
  const scanned = [];
  const skipped = [];
  const minified = [];
  const hits = [];
  for (const rel of listFiles(root)) {
    if (!SOURCE_EXT.test(rel)) continue;
    const reason = skipReason(rel);
    if (reason) { skipped.push({ file: rel, reason }); continue; }
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    scanned.push(rel);
    if (text.split('\n').some(l => l.length > MINIFIED_LINE)) minified.push(rel);
    hits.push(...scanSource(rel, text));
  }
  // A category is claimed only from hits at 'call' or 'import' strength. 'import_only' hits are
  // kept for the record but do not claim anything, which is the precision bias.
  const categories = {};
  for (const hit of hits) {
    if (hit.strength === 'import_only') continue;
    const current = categories[hit.category] || (categories[hit.category] = { strength: 'import', signals: [], evidence: [] });
    if (hit.strength === 'call') current.strength = 'call';
    if (!current.signals.includes(hit.signal)) current.signals.push(hit.signal);
    for (const e of hit.evidence) if (current.evidence.length < 20) current.evidence.push(e);
  }
  return { scannedFiles: scanned, skipped, minifiedFiles: minified, hits, categories };
}

export function signalTableHash() {
  return 'sha256-' + crypto.createHash('sha256').update(JSON.stringify(SIGNALS, (k, v) => v instanceof RegExp ? v.toString() : v)).digest('hex');
}

function main() {
  const target = process.argv[2];
  if (target) {
    const result = inspectPackage(path.resolve(target));
    process.stdout.write(JSON.stringify({ ...result, hits: undefined }, null, 2) + '\n');
    return;
  }
  const corpus = path.join(HERE, 'corpus');
  const index = JSON.parse(fs.readFileSync(path.join(corpus, 'index.json'), 'utf8'));
  const inspectedAt = new Date().toISOString();
  const packages = index.packages.map(entry => {
    const root = path.join(corpus, 'packages', entry.name, entry.version);
    const result = inspectPackage(root);
    return {
      name: entry.name, version: entry.version, registryIntegrity: entry.registryIntegrity, contentHash: entry.contentHash,
      scannedFileCount: result.scannedFiles.length, skipped: result.skipped, minifiedFiles: result.minifiedFiles,
      categories: result.categories, importOnly: result.hits.filter(h => h.strength === 'import_only').map(h => ({ signal: h.signal, file: h.evidence[0].file, line: h.evidence[0].line })),
    };
  });
  const output = { inspectorVersion: INSPECTOR_VERSION, signalTableHash: signalTableHash(), inspectedAt, corpusBuiltAt: index.builtAt, packages };
  fs.writeFileSync(path.join(HERE, 'inspector-output.json'), JSON.stringify(output, null, 2));
  const withAny = packages.filter(p => Object.keys(p.categories).length).length;
  process.stderr.write(`inspected ${packages.length} packages, ${withAny} with at least one category\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
