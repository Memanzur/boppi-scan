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

/** Basename of an executable: strip quotes, a Windows or POSIX path, and .exe/.cmd/.bat/.ps1. */
function commandStem(command) {
  let base = String(command || '').trim();
  if ((base.startsWith('"') && base.endsWith('"')) || (base.startsWith("'") && base.endsWith("'"))) base = base.slice(1, -1).trim();
  base = base.split(/[\\/]/).pop().toLowerCase();
  return base.replace(/\.(?:exe|cmd|bat|ps1)$/, '');
}

function commandBaseName(command) {
  return commandStem(command);
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

/** Lowercase hyphenated package name, a scoped name, or a versioned spec. */
function isPackageNameShape(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || text !== text.toLowerCase()) return false;
  const version = '(?:@(?:latest|next|canary|\\*|x|[0-9][^\\s]*)|==[^\\s]+)?';
  const hyphenated = new RegExp(`^(?:@[a-z0-9_.-]+\\/)?[a-z0-9]+(?:[._-][a-z0-9]+)+${version}$`);
  const scoped = new RegExp(`^(?:@[a-z0-9_.-]+\\/)[a-z0-9_.-]+${version}$`);
  const versioned = /^[a-z0-9_.-]+(?:@(?:latest|next|canary|\*|x|[0-9][^\s]*)|==[^\s]+)$/;
  return hyphenated.test(text) || scoped.test(text) || versioned.test(text);
}

/**
 * Env values that are package names are not stored keys. A high confidence
 * token still is, including when it is also lowercase.
 */
function isEnvSecret(raw) {
  if (!isInlineSecret(raw)) return false;
  const value = String(raw).trim();
  if (isPackageNameShape(value) && !isHighConfidenceSecret(value)) return false;
  return true;
}

/**
 * Per installer: package flags name the package, value flags consume the next
 * token, boolean flags do not. A flag that is not in the table is boolean,
 * so it does not swallow the package.
 */
const NPM_VALUE_FLAGS = [
  '--registry', '--cache', '--userconfig', '--globalconfig', '--prefix', '--loglevel',
  '--workspace', '-w', '--call', '-c', '--tag', '--scope', '--otp', '--user-agent',
  '--script-shell', '--depth', '--fetch-retries', '--fetch-retry-factor',
  '--fetch-retry-mintimeout', '--fetch-retry-maxtimeout', '--fetch-timeout',
  '--maxsockets', '--tmp', '--umask', '--proxy', '--https-proxy', '--noproxy',
  '--local-address', '--cert', '--key', '--ca', '--cafile', '--before',
  '--node-options', '--nodedir', '--viewer', '--editor', '--message', '-m',
  '--save-prefix', '--logs-max', '--logs-dir', '--replace-registry-host',
  '--install-strategy', '--omit', '--include', '--cache-min', '--cache-max',
  '--searchlimit', '--searchopts', '--searchexclude', '--searchstaleness',
  '--init-module', '--init-author-name', '--init-author-email', '--init-author-url',
  '--init-license', '--init-version', '--git', '--location', '--libc', '--os',
  '--cpu', '--arch', '-C', '--dir',
];
const NPM_BOOLEAN_FLAGS = [
  '-y', '--yes', '-q', '--quiet', '--offline', '--no-fund', '--no-install',
  '--ignore-existing', '--prefer-offline', '--prefer-online', '--ignore-scripts',
  '--foreground-scripts', '--fund', '--audit', '--json', '--parseable', '--long',
  '--global', '-g', '--force', '-f', '--dry-run', '--save-exact', '--strict-ssl',
  '--engine-strict', '--package-lock', '--legacy-peer-deps', '--strict-peer-deps',
];

const INSTALLER_TABLE = Object.freeze({
  npx: { direct: true, subs: [], package: ['-p', '--package'], value: NPM_VALUE_FLAGS, boolean: NPM_BOOLEAN_FLAGS },
  bunx: { direct: true, subs: [], package: ['-p', '--package'], value: ['--cache', '--loglevel', '--registry', '--prefix'], boolean: ['-y', '--yes', '-q', '--quiet', '--offline', '--no-fund'] },
  pnpx: { direct: true, subs: [], package: ['-p', '--package'], value: ['--cache', '--loglevel', '--registry', '--prefix', '--workspace', '-w'], boolean: ['-y', '--yes', '-q', '--quiet', '--offline', '--no-fund'] },
  npm: { direct: false, subs: ['exec|x'], package: ['-p', '--package'], value: NPM_VALUE_FLAGS.concat(['--globalconfig']), boolean: NPM_BOOLEAN_FLAGS },
  yarn: { direct: false, subs: ['dlx'], package: ['--package'], value: [], boolean: ['-q', '--quiet', '--offline'] },
  pnpm: { direct: false, subs: ['dlx'], package: ['--package'], value: ['--registry', '--store-dir', '--workspace', '-w', '-C', '--dir', '--prefix'], boolean: ['-q', '--quiet', '--offline', '--prefer-offline'] },
  uvx: { direct: true, subs: [], package: ['--from'], value: ['-p', '--python', '--with', '--index', '--index-url', '--cache-dir'], boolean: ['-q', '--quiet', '--offline', '--no-progress', '--refresh', '--no-cache', '--isolated'] },
  uv: { direct: false, subs: ['tool', 'run'], package: ['--from'], value: ['-p', '--python', '--with', '--index', '--index-url', '--cache-dir'], boolean: ['-q', '--quiet', '--offline', '--no-progress', '--refresh', '--no-cache', '--isolated', '--no-project'] },
});

function splitInstallerFlag(arg) {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    if (eq > 2) return { flag: arg.slice(0, eq), inline: arg.slice(eq + 1) };
    return { flag: arg, inline: null };
  }
  if (/^-[A-Za-z]=/.test(arg)) return { flag: arg.slice(0, 2), inline: arg.slice(3) };
  return { flag: arg, inline: null };
}

/**
 * The package an installer will fetch. Subcommands (npm exec, npm x, yarn dlx,
 * pnpm dlx, uv tool run) are not packages. Package flags and value flags come
 * from INSTALLER_TABLE. Any other flag is boolean and does not swallow the
 * next token. `--` does not hide the package that follows it. Anything after
 * the package belongs to the server.
 * Returns { token, spec } or null. token is the argv string to rewrite.
 */
function bareInstallName(spec) {
  let text = String(spec || '').trim();
  text = text.replace(/==[^\s]+$/, '');
  if (text.startsWith('@')) {
    const slash = text.indexOf('/');
    const at = slash === -1 ? -1 : text.indexOf('@', slash + 1);
    return (at === -1 ? text : text.slice(0, at)).toLowerCase();
  }
  const at = text.lastIndexOf('@');
  return (at > 0 ? text.slice(0, at) : text).toLowerCase();
}

function installerPackage(command, args) {
  const base = commandBaseName(command);
  const table = INSTALLER_TABLE[base];
  const list = Array.isArray(args) ? args.filter(item => typeof item === 'string') : [];
  if (!table) return null;
  const direct = table.direct;
  const subs = table.subs;
  const packageFlags = new Set(table.package);
  const valueFlags = new Set(table.value);
  const booleanFlags = new Set(table.boolean);

  function parse(unknownAsValue) {
    let subIndex = 0;
    let token = null;
    let spec = null;
    let endOfFlags = false;
    const take = (raw, name) => {
      if (!isPackageSpec(name)) return false;
      token = raw;
      spec = name;
      return true;
    };
    for (let i = 0; i < list.length; i++) {
      const arg = list[i];
      if (arg === '--') {
        endOfFlags = true;
        continue;
      }
      if (!endOfFlags && arg.startsWith('-')) {
        const parsed = splitInstallerFlag(arg);
        if (spec) break;
        let kind = 'boolean';
        if (packageFlags.has(parsed.flag)) kind = 'package';
        else if (valueFlags.has(parsed.flag)) kind = 'value';
        else if (!booleanFlags.has(parsed.flag) && !booleanFlags.has(arg)) {
          // An unrecognized short or long flag before the package makes the
          // launch ambiguous. Do not pin the next token.
          const candidates = list.slice(i + 1).filter(item => isPackageSpec(item)).slice(0, 2);
          return { ambiguous: true, token: null, spec: null, candidates };
        }
        if (kind === 'boolean') continue;
        let raw = arg;
        let name = parsed.inline;
        if (parsed.inline == null) {
          const next = list[i + 1];
          if (typeof next !== 'string' || next === '--' || next.startsWith('-')) continue;
          raw = next;
          name = next;
          i += 1;
        }
        if (kind === 'package' && take(raw, name) && (direct || subIndex >= subs.length)) break;
        continue;
      }
      if (!direct && subIndex < subs.length) {
        const choices = subs[subIndex].split('|');
        if (!choices.includes(arg)) return null;
        subIndex += 1;
        continue;
      }
      if (!spec && !take(arg, arg)) continue;
      break;
    }
    if (!direct && subIndex < subs.length) return null;
    if (!spec) return null;
    return { token, spec, ambiguous: false };
  }

  const strict = parse(false);
  if (strict && strict.ambiguous) return strict;
  const greedy = parse(true);
  if (greedy && greedy.ambiguous) return greedy;
  // An unknown flag whose next token is a different package than the one the
  // installer would launch is not a safe pin. Fail closed.
  if (strict && greedy && bareInstallName(strict.spec) !== bareInstallName(greedy.spec)) {
    return { ambiguous: true, token: null, spec: null, candidates: [strict.spec, greedy.spec] };
  }
  return strict;
}

function packageArgument(server) {
  if (!server || typeof server !== 'object') return null;
  const chosen = installerPackage(server.command, server.args);
  return chosen && !chosen.ambiguous ? chosen.token : null;
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
      if (isEnvSecret(value)) labels.push(String(name).slice(0, 120));
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
  PROVIDER_KEY_NAMES, valueIsPresent, isEnvReference, isPackageSpec, isPackageNameShape, isHighConfidenceSecret,
  isInlineSecret, isEnvSecret, isArgumentSecret, packageArgument, installerPackage, commandStem, INSTALLER_TABLE, inlineCredentialLabels, envKeyPresence, namesInText,
};
