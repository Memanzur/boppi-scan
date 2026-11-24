// Drops training records that copy known rules-engine bugs.
// Independent of the rules-engine fix: it looks at the config and the labels
// the generator already has, and it still drops the bad shape if templates change.
// A single-server catalog launch (command or URL only, no extra flags) is
// excluded from both splits so a trivial catalog row cannot overlap eval data.

const LAUNCHERS = new Set(['npx', 'npm', 'uvx', 'uv', 'bunx', 'pnpm', 'pnpx', 'yarn', 'docker', 'podman', 'pipx', 'node', 'nodejs', 'python', 'python3', 'bun', 'deno']);
const ARG_BOILERPLATE = new Set(['run', 'exec']);
const SENSITIVE_NAME = /(token|secret|password|private[_-]?key|api[_-]?key|authorization|cookie|credential)/i;
const CREDENTIAL_PREFIX = /^(?:sk|pk|rk|ghp|github_pat|xox[baprs]|AKIA|ASIA)[-_]/i;
const PACKAGE_SPEC = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+(?:@(?:latest|next|\*|x|[0-9][A-Za-z0-9._+-]*)|==[0-9][A-Za-z0-9._+-]*)?$/;

// Catalog rows the engine currently calls unknown because their role grants no
// capability (or, for everything, the same reference set). Match id, package, or command.
export const REFERENCE_IDS = ['memory', 'sequential-thinking', 'time', 'everything', 'mcp-sequential-thinking'];

export const FILTERS = ['single_server_catalog_launch', 'false_unknown_server', 'false_plaintext_secret', 'fix_passed_still_unpinned'];

function entryNames(entry) {
  return [entry.id, ...(entry.packages || []), ...(entry.commands || [])].map(v => String(v).toLowerCase());
}

export function isReferenceEntry(entry) {
  if (!entry) return false;
  const names = entryNames(entry);
  return REFERENCE_IDS.some(id => names.includes(id) || names.some(n => n.endsWith(`/${id}`)));
}

export function catalogEntryForSpec(spec, catalog) {
  if (!spec || typeof spec !== 'object' || !catalog) return null;
  let best = null;
  const consider = (token, hit) => {
    if (!hit || !hit.entry) return;
    if (!best || token.length > best.len) best = { entry: hit.entry, len: token.length };
  };
  if (typeof spec.command === 'string' && !LAUNCHERS.has(spec.command.toLowerCase())) consider(spec.command, catalog.matchIdentity(spec.command));
  if (Array.isArray(spec.args)) {
    for (const arg of spec.args) {
      if (typeof arg !== 'string' || !arg || arg.startsWith('-') || isPathArg(arg) || LAUNCHERS.has(arg.toLowerCase()) || ARG_BOILERPLATE.has(arg)) continue;
      consider(arg, catalog.matchIdentity(arg));
    }
  }
  if (typeof spec.url === 'string') {
    try { const host = new URL(spec.url).hostname; consider(host, catalog.matchHost(host)); } catch { /* not a url */ }
  }
  return best ? best.entry : null;
}

function isPathArg(arg) {
  return typeof arg === 'string' && (arg.startsWith('/') || arg.startsWith('~') || /^[A-Za-z]:[\\/]/.test(arg));
}

/** True when the config is one catalog server launched with no extra behavior. */
export function isSingleServerCatalogLaunch(config, catalog) {
  const servers = config && config.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return false;
  const names = Object.keys(servers);
  if (names.length !== 1) return false;
  const spec = servers[names[0]];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
  if (Object.keys(spec).some(k => k !== 'command' && k !== 'args' && k !== 'url')) return false;
  if (!catalogEntryForSpec(spec, catalog)) return false;
  if (typeof spec.url === 'string') return !spec.command && !(Array.isArray(spec.args) && spec.args.length);
  if (typeof spec.command !== 'string') return false;
  const args = Array.isArray(spec.args) ? spec.args : [];
  if (args.some(a => typeof a !== 'string' || isPathArg(a))) return false;
  const entry = catalogEntryForSpec(spec, catalog);
  for (const arg of args) {
    if (arg.startsWith('-') || ARG_BOILERPLATE.has(arg) || LAUNCHERS.has(arg.toLowerCase())) continue;
    const hit = catalog.matchIdentity(arg);
    if (!hit || hit.entry.id !== entry.id) return false;
  }
  return true;
}

export function isPackageSpec(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || CREDENTIAL_PREFIX.test(text) || text.includes('://') || isPathArg(text) || /\s/.test(text)) return false;
  return PACKAGE_SPEC.test(text);
}

export function isEnvReference(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim().replace(/^['"]|['"]$/g, '');
  return /^\$\{env:[^{}]+\}$/.test(text) || /^\$\{[A-Za-z_][A-Za-z0-9_.-]*\}$/.test(text) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(text);
}

function isRealSecretValue(value, secrets) {
  if (typeof value !== 'string') return false;
  if (isEnvReference(value)) return false;
  const text = value.trim();
  if (CREDENTIAL_PREFIX.test(text)) return true;
  if (isPackageSpec(text)) return false;
  return !!(secrets && secrets.isInlineSecret(text));
}

function envPairs(spec) {
  const pairs = [];
  for (const bag of [spec && spec.env, spec && spec.headers]) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    for (const [key, value] of Object.entries(bag)) pairs.push([key, value]);
  }
  return pairs;
}

function hasRealPlaintextEvidence(spec, secrets) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  if (args.some(arg => isRealSecretValue(arg, secrets))) return true;
  if (typeof spec.url === 'string' && isRealSecretValue(spec.url, secrets)) return true;
  for (const [key, value] of envPairs(spec)) {
    if (typeof value !== 'string' || isEnvReference(value)) continue;
    if (secrets && secrets.valueIsPresent && !secrets.valueIsPresent(value)) continue;
    if (isRealSecretValue(value, secrets)) return true;
    if (SENSITIVE_NAME.test(key)) return true;
    if (secrets && Array.isArray(secrets.PROVIDER_KEY_NAMES) && secrets.PROVIDER_KEY_NAMES.includes(key)) return true;
  }
  return false;
}

function hasFalsePlaintextEvidence(spec) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  if (args.some(arg => isPackageSpec(arg))) return true;
  return envPairs(spec).some(([, value]) => isEnvReference(value));
}

function namedServers(finding, config) {
  const names = Object.keys((config && config.mcpServers) || {});
  const listed = (finding.servers || []).filter(name => names.includes(name));
  if (listed.length) return listed;
  if ((!finding.servers || !finding.servers.length) && names.length === 1) return names;
  return [];
}

/**
 * @returns {{ drop: boolean, reasons: string[] }}
 * reasons are a subset of FILTERS. A record is dropped when any reason is set.
 */
export function reviewCase({ config, findings, afterFindings, fixKept, catalog, secrets }) {
  const reasons = new Set();
  const list = findings || [];
  if (isSingleServerCatalogLaunch(config, catalog)) reasons.add('single_server_catalog_launch');
  for (const finding of list) {
    if (finding.rule_id !== 'BOPPI-UNKNOWN-SERVER') continue;
    for (const name of namedServers(finding, config)) {
      if (isReferenceEntry(catalogEntryForSpec(config.mcpServers[name], catalog))) reasons.add('false_unknown_server');
    }
  }
  for (const finding of list) {
    if (finding.rule_id !== 'BOPPI-PLAINTEXT-SECRET') continue;
    for (const name of namedServers(finding, config)) {
      const spec = config.mcpServers[name];
      if (!hasRealPlaintextEvidence(spec, secrets) && hasFalsePlaintextEvidence(spec)) reasons.add('false_plaintext_secret');
    }
  }
  if (fixKept && (afterFindings || []).some(f => f.rule_id === 'BOPPI-UNPINNED-PACKAGE')) reasons.add('fix_passed_still_unpinned');
  return { drop: reasons.size > 0, reasons: FILTERS.filter(r => reasons.has(r)) };
}
