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

function valueIsPresent(raw) {
  if (typeof raw !== 'string') return false;
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  if (!value) return false;
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
  if (Array.isArray(server.args) && server.args.some(value => isInlineSecret(value))) labels.push('inline-argument');
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
  PROVIDER_KEY_NAMES, valueIsPresent, isInlineSecret, inlineCredentialLabels, envKeyPresence, namesInText,
};
