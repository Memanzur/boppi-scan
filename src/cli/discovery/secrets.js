/**
 * Presence of AI provider credential names. Values are inspected only long
 * enough to decide "set and not a placeholder", then dropped. Nothing in the
 * returned objects is a secret value.
 */
'use strict';

// Aligned with the scanner's argument redaction and the model boundary, plus
// the hyphenated sk-/pk- form those two patterns split between them.
const SENSITIVE_VALUE = /(?:bearer\s+|(?:^|[^A-Za-z0-9])(?:sk|pk|rk|ghp|github_pat|xox[baprs]|sb_(?:publishable|secret)|bpc_|AKIA|ASIA)[A-Za-z0-9._~+/=-]{10,}|(?:^|[^A-Za-z0-9])(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}|(?:^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i;
const CREDENTIAL_URI = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;

const PROVIDER_KEY_NAMES = Object.freeze([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
]);

const AWS_INI = Object.freeze({
  aws_access_key_id: 'AWS_ACCESS_KEY_ID',
  aws_secret_access_key: 'AWS_SECRET_ACCESS_KEY',
  aws_session_token: 'AWS_SESSION_TOKEN',
});

/** Whole-value indirection such as ${env:VAR}. The name is not a stored secret. */
function isEnvReference(value) {
  return /^\$\{\s*env\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\}$/i.test(value);
}

const INSTALLERS = new Set(['npx', 'npm', 'uvx', 'uv', 'pip', 'pipx', 'bunx', 'pnpm', 'pnpx', 'yarn', 'deno']);

function commandBaseName(command) {
  if (typeof command !== 'string') return '';
  return command.trim().split(/[\\/]/).pop().toLowerCase();
}

/** npm or Python package spec, with or without a version. Not a path, flag, or URL. */
function isPackageSpec(arg) {
  if (typeof arg !== 'string') return false;
  const value = arg.trim();
  if (!value || /\s/.test(value) || value.startsWith('-')) return false;
  if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+(?:@(?:latest|next|canary|\*|x|[0-9][^\s]*)|==[^\s]+)?$/i.test(value);
}

function isHighConfidenceSecret(value) {
  return /(?:bearer\s+|(?:^|[^A-Za-z0-9])(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}|(?:^|[^A-Za-z0-9])(?:ghp_|github_pat_|xox[baprs]-|sb_(?:publishable|secret)_|bpc_|AKIA|ASIA)[A-Za-z0-9._~+/=-]{8,}|(?:^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i.test(value)
    || CREDENTIAL_URI.test(value);
}

function packageArgument(server) {
  if (!server || typeof server !== 'object') return null;
  if (!INSTALLERS.has(commandBaseName(server.command))) return null;
  const args = Array.isArray(server.args) ? server.args : [];
  const found = args.find(arg => isPackageSpec(arg));
  return found == null ? null : found;
}

function valueIsPresent(raw) {
  if (typeof raw !== 'string') return false;
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  if (!value) return false;
  if (isEnvReference(value)) return false;
  if (/^\$(\{[A-Za-z0-9_.-]+\}|[A-Za-z_][A-Za-z0-9_]*)$/.test(value)) return false;
  if (/^\$\{\{\s*secrets\.[^}]+\}\}$/.test(value)) return false;
  if (/^(changeme|placeholder|your[-_ ]?(api[-_ ]?)?key|todo|xxx+|redacted|<[^>]+>|insert[-_ ]?key|replace[-_ ]?me)$/i.test(value)) return false;
  return true;
}

function isInlineSecret(raw) {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (value.length < 12 || value.length > 2000) return false;
  if (!valueIsPresent(value)) return false;
  return SENSITIVE_VALUE.test(value) || CREDENTIAL_URI.test(value);
}

/**
 * Command names and package specs are not secret values. A high-confidence
 * token in some other argument still is.
 */
function isArgumentSecret(raw) {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (isPackageSpec(value) && !isHighConfidenceSecret(value)) return false;
  return isInlineSecret(value);
}

/** Names only. `where` is "environment" or a path the caller already made portable. */
function inlineCredentialLabels(server) {
  const labels = [];
  if (!server || typeof server !== 'object') return labels;
  if (server.env && typeof server.env === 'object' && !Array.isArray(server.env)) {
    for (const [name, value] of Object.entries(server.env)) {
      if (isInlineSecret(value)) labels.push(String(name).slice(0, 120));
    }
  }
  if (server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers)) {
    for (const [name, value] of Object.entries(server.headers)) {
      if (isInlineSecret(value)) labels.push(`header:${String(name).slice(0, 80)}`);
    }
  }
  const skipPackage = packageArgument(server);
  let skippedPackage = false;
  if (Array.isArray(server.args) && server.args.some(value => {
    if (!skippedPackage && skipPackage != null && value === skipPackage) {
      skippedPackage = true;
      return false;
    }
    return isArgumentSecret(value);
  })) labels.push('inline-argument');
  return labels;
}

function envKeyPresence() {
  const found = [];
  for (const name of PROVIDER_KEY_NAMES) {
    if (valueIsPresent(process.env[name])) found.push(name);
  }
  return found;
}

function namesInText(text, { ini = false } = {}) {
  const found = new Set();
  const keyPattern = new RegExp(`^(?:export\\s+)?(${PROVIDER_KEY_NAMES.join('|')})\\s*[=:]\\s*(.*)$`);
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(keyPattern);
    if (match && valueIsPresent(match[2].slice(0, 400))) found.add(match[1]);
    if (!ini) continue;
    const aws = line.match(/^(aws_access_key_id|aws_secret_access_key|aws_session_token)\s*=\s*(.*)$/i);
    if (aws && valueIsPresent(aws[2].slice(0, 400))) found.add(AWS_INI[aws[1].toLowerCase()]);
  }
  return [...found];
}

module.exports = {
  PROVIDER_KEY_NAMES, valueIsPresent, isEnvReference, isPackageSpec, isHighConfidenceSecret,
  isInlineSecret, isArgumentSecret, packageArgument, inlineCredentialLabels, envKeyPresence, namesInText,
};
