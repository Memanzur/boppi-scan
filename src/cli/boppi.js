#!/usr/bin/env node
/**
 * boppi: local AI agent security scan.
 *
 * One command that discovers local AI agent MCP configurations, runs the
 * existing Boppi engine unchanged (scanner → risk engine → security graph →
 * exposure paths), and reports what your AI agents can reach. Everything runs
 * on this machine; nothing is transmitted anywhere.
 *
 * Consent model: invoking this CLI is the explicit consent. Every file read
 * is listed at the end of the run so consent is inspectable.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const evidenceIdentity = require('./evidenceIdentity');

const models = require('../engine/models');
const riskRubric = require('../engine/riskRubric');
const scanner = require('../engine/localMcpScanner');
const Storage = require('../engine/agentSecurityStorage');
const Registry = require('../engine/providerRegistry');
const Controller = require('../engine/scanController');
const securityGraph = require('../engine/securityGraph');
const exposurePathEngine = require('../engine/exposurePathEngine');
const rootCauseEngine = require('../engine/rootCauseEngine');
const agentRiskEngine = require('../engine/agentRiskEngine');

const { createConfigProvider } = require('./provider');
const { enrich } = require('./simulate');
const builtinTools = require('./builtinTools');
const plugins = require('./discovery/claudePlugins');
const configFacts = require('./configFacts');
const recognitionModule = require('./recognition');
const predict = require('./predict');
const verify = require('./verify');
const overlayModule = require('./overlay');
const overlayBundle = require('./overlayBundle');
const terminal = require('./render/terminal');
const html = require('./render/html');
const push = require('./push');
const updateNotice = require('./updateNotice');
const plan = require('./plan');
const policyModule = require('./policy');
const sarif = require('./render/sarif');
const fix = require('./fix');
const discoverCommand = require('./discovery/discover');
const watchCommand = require('./watch');
const eventsCommand = require('./events');
const evidence = require('./evidence');
const demo = require('./demo');
const askCommand = require('./ask');
const remediate = require('./remediate');
const rollback = require('./rollback');
const hook = require('./hook');
const settingsModule = require('./settings');
const connect = require('./connect');

const VERSION = require('../../package.json').version;
const SEVERITY_ORDER = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const COMMANDS = new Set(['scan', 'agents', 'paths', 'plan', 'fix', 'rollback', 'verify', 'history', 'push', 'demo', 'hook', 'settings', 'discover', 'watch', 'events', 'ask', 'connect', 'overlay']);
const OVERLAY_SUBCOMMANDS = ['verify', 'status', 'rollback', 'reset'];
// Config locations differ per OS. The override exists for tests and for scanning a copied home directory from another machine.
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);

function usage() {
  return [
    'Usage: boppi [scan|agents|paths|plan|fix|rollback|verify|history|push|demo|hook|settings|discover|watch|events|ask|connect] [options]',
    '',
    '  boppi scan                     discover local AI agent configs, scan, print the full report',
    '  boppi agents                   inventory table only',
    '  boppi paths                    exposure paths only',
    '  boppi plan                     compare every candidate fix (paths broken, new paths, capabilities lost) and show the exact edits; changes nothing',
    '  boppi fix --server <name>      preview the exact edit, then remove one server entry from its config file (backup first), rescan, and grade the prediction',
    '  boppi rollback [--id <id>]     list the backups fix recorded, or restore one to its file and rescan',
    '  boppi verify <previous.json>   rescan and grade the predictions in an earlier --json export',
    '  boppi overlay verify <bundle.json> --trust <keys.json>   check a signed claims bundle without changing anything',
    '  boppi overlay status|reset|rollback --receipt <r.json> --trust <keys.json>   show, reset or roll back the accepted bundle',
    '  boppi history                  show recent local scan summaries and verified exposure reduction',
    '  boppi push                     scan, then send the sanitized inventory to your Boppi workspace',
    '  boppi demo                     scan a synthetic risky config copied to ~/.boppi/demo/ (never your real configs); --reset restores it',
    '  boppi demo --html <file>       write a self-contained interactive demo page built from four synthetic environments',
    '  boppi hook                    record one sanitized Claude Code hook event locally; best effort, live delivery unverified',
    '  boppi ask --file <export.json> --question <question>  answer supported access questions locally; use --server/--client for removal predictions, --json - for JSON stdout',
    '  boppi events                  local timeline of recorded hook events: calls per server and tool, outcomes, and every gap',
    '  boppi events push             send those metadata-only records to a workspace that allowed activity sync for this collector; --dry-run prints them',
    '  boppi settings                show local privacy settings; --set key=value changes one setting',
    '  boppi discover --server <name> start one configured stdio MCP server with your consent, ask it only for its tool list, store the list locally; never during a scan',
    '  boppi watch                   stay in the foreground, rescan when a config or settings file changes (and every 60 s), print what changed; installs nothing',
    '  boppi connect pair|status|unpair|run  pair this machine with your workspace for dashboard-requested fixes; run pulls proposals, shows the exact sanitized preview here, and applies one only after you confirm',
    '',
    'Push options (push, events push and connect are the only commands that use the network):',
    `  --url <workspace>   workspace origin or ingest URL (default ${push.DEFAULT_WORKSPACE_URL})`,
    '  --token <token>     collector token from the Collectors page; or set BOPPI_TOKEN; or omit it and paste when prompted',
    '  --file <scan.json>  push an earlier --json export instead of scanning now',
    '  --dry-run           print the records that would be sent, send nothing',
    '  --merge             add to the workspace without removing records absent from this scan',
    '',
    'fix options:',
    '  --server <name>     the MCP server entry to remove (as boppi scan names it)',
    '  --client <key>      which client config to edit when the name exists in more than one: claude-desktop | claude-code | cursor',
    '  --yes               apply without the terminal confirmation (required when stdin is not a terminal)',
    '',
    'plan options:',
    '  --diff              print the sanitized diff preview for every candidate removal',
    '',
    'connect options:',
    '  --url <workspace>   (pair) workspace origin, https unless localhost; stored in ~/.boppi/connector.json with the device credential (owner-only)',
    '  --code <pair-code>  (pair) one-time code from the Collectors page',
    '  --name <name>       (pair) device name the workspace shows (default: this machine\'s hostname)',
    '  --once              (run) one poll cycle, then exit',
    '  --interval <s>      (run) seconds between polls (default 60, minimum 5)',
    '  --yes               (run) apply approved proposals without the terminal confirmation; printed in the output when used',
    '',
    'rollback options:',
    '  --id <id>           the manifest entry to restore (from boppi rollback with no --id)',
    '  --yes               restore without the terminal confirmation',
    '',
    'hook options:',
    '  --print-config      print the Claude Code hook snippet; add it yourself, Boppi never edits settings',
    '  --disable | --enable  pause or resume capture (a local flag file; the snippet is untouched)',
    '  --forget            delete every recorded event and health counter',
    '',
    'events options:',
    '  --since <days>      window to read (default 30)',
    '  --json <file>       write the machine-readable timeline to a file',
    '  --install           rejected; installation always requires your explicit manual action',
    '  push                send the records in the window to the workspace (--url, --token or BOPPI_TOKEN as for push; --dry-run prints the payload and sends nothing)',
    '',
    'settings options:',
    '  --set key=value     set telemetry=false, cloudSync=false, or retentionDays=1..3650',
    '',
    'demo options:',
    '  --reset             restore the sandbox config from the bundled fixture',
    '',
    'watch options:',
    '  --interval <s>      periodic rescan interval in seconds (default 60, minimum 1)',
    '  --duration <s>      stop after this many seconds (default: until Ctrl-C)',
    '  --once              print the baseline and exit',
    '  --log <file>        append one JSON line per baseline, change, hold, and stop (owner-only file)',
    '',
    'discover options:',
    '  --server <name>     the MCP server entry to start (as boppi scan names it); remote (url) entries and package-fetching launchers (npx, uvx, docker) are refused',
    '  --client <key>      which client holds the entry when the name exists in more than one',
    '  --yes               start without the terminal confirmation (required when stdin is not a terminal)',
    '  --record <file>     write the protocol record (every method Boppi sent, counts of what came back; no tool text)',
    '  --forget            remove the stored tool list for --server, or every stored list with --all',
    '',
    'Options:',
    '  --json <file>       write the machine-readable export (export v2 schema + exposure paths)',
    '  --html <file>       write a self-contained HTML report',
    '  --sarif <file>      write a SARIF 2.1.0 report (paths, findings, policy violations) for code scanning',
    '  --policy <file>     evaluate a boppi.policy.json guard; ./boppi.policy.json is used automatically when present',
    '  --only <clients>    limit discovery, e.g. --only claude-desktop,cursor',
    '  --config <path>     scan one explicit config file (skip discovery)',
    '  --source <id>       client type for --config: claude-desktop | claude-code | cursor',
    '  --fail-on <sev>     exit 1 if any finding or path is at/above this severity, 4 if a client could not be analyzed (CI usage)',
    '  --overlay <file>    apply an unsigned capability claims file; validated claims add inferred permissions, experimental ones are only reported',
    '  --overlay-bundle <file> --trust <keys.json>',
    '                      report a signed, reviewed claims bundle in shadow only (never changes results); the trust root is yours',
    '  --quiet             one summary line only',
    '  --verbose           all paths, per-server capability provenance',
    '  --no-color          plain-text output (NO_COLOR env is also respected)',
    '  --contradictions-dir <dir>  where verify writes boppi-contradiction-<id>.json (default: cwd)',
    '  --history-file <file>  local-only scan history file (default: <scan home>/.boppi/history.json)',
    '  --version, -v       print the version and exit',
    '',
    'Privacy: scan analysis runs locally. Reports redact recognized secrets and paths;',
    'review exports before sharing. Every configuration file read is listed.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    command: 'scan', json: null, html: null, only: null, config: null, source: 'claude-desktop',
    failOn: null, overlay: null, overlayBundle: null, trust: null, receipt: null, quiet: false, verbose: false,
    color: !('NO_COLOR' in process.env) && process.stdout.isTTY !== false,
    home: process.env.BOPPI_SCAN_HOME || os.homedir(), cwd: process.cwd(), help: false, version: false,
    input: null, contradictionsDir: null, historyFile: null,
    url: null, token: process.env.BOPPI_TOKEN || null, file: null, dryRun: false, merge: false, reset: false, code: null, name: null, subcommand: null,
    install: false, printConfig: false, set: [], record: null, forget: false, all: false, interval: 60, duration: 0, once: false, log: null, since: 30, disable: false, enable: false,
    platform: process.env.BOPPI_SCAN_PLATFORM || process.platform,
    // Claude Code's documented override of the plugins root (~/.claude/plugins).
    pluginRoot: process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || null,
  };
  let askRequested = false;
  const takesValue = new Set(['--question', '--since', '--interval', '--duration', '--log', '--record', '--json', '--html', '--only', '--config', '--source', '--fail-on', '--home', '--cwd', '--contradictions-dir', '--overlay', '--overlay-bundle', '--trust', '--receipt', '--history-file', '--url', '--token', '--file', '--platform', '--server', '--client', '--sarif', '--policy', '--id', '--set', '--code', '--name']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (options.command === 'events' && !options.subcommand && arg === 'push') options.subcommand = 'push';
    else if (options.command === 'overlay' && !options.subcommand && OVERLAY_SUBCOMMANDS.includes(arg)) options.subcommand = arg;
    else if (COMMANDS.has(arg)) { options.command = arg; if (arg === 'ask') askRequested = true; }
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--no-color') options.color = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (takesValue.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      if (arg === '--question') options.question = value;
      else if (arg === '--json') options.json = value;
      else if (arg === '--html') options.html = value;
      else if (arg === '--only') options.only = value.split(',').map(v => v.trim()).filter(Boolean);
      else if (arg === '--config') options.config = value;
      else if (arg === '--source') options.source = value;
      else if (arg === '--fail-on') options.failOn = value;
      else if (arg === '--overlay') options.overlay = value;
      else if (arg === '--overlay-bundle') options.overlayBundle = value;
      else if (arg === '--trust') options.trust = value;
      else if (arg === '--receipt') options.receipt = value;
      else if (arg === '--home') options.home = value;
      else if (arg === '--cwd') options.cwd = value;
      else if (arg === '--contradictions-dir') options.contradictionsDir = value;
      else if (arg === '--history-file') options.historyFile = value;
      else if (arg === '--url') options.url = value;
      else if (arg === '--token') options.token = value;
      else if (arg === '--file') options.file = value;
      else if (arg === '--platform') options.platform = value;
      else if (arg === '--server') options.server = value;
      else if (arg === '--sarif') options.sarif = value;
      else if (arg === '--policy') options.policy = value;
      else if (arg === '--client') options.client = value;
      else if (arg === '--id') options.id = value;
      else if (arg === '--set') options.set.push(value);
      else if (arg === '--code') options.code = value;
      else if (arg === '--name') options.name = value;
      else if (arg === '--record') options.record = value;
      else if (arg === '--interval') options.interval = Number(value);
      else if (arg === '--since') options.since = Number(value);
      else if (arg === '--duration') options.duration = Number(value);
      else if (arg === '--log') options.log = value;
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--merge') options.merge = true;
    else if (arg === '--yes') options.yes = true;
    else if (arg === '--reset') options.reset = true;
    else if (arg === '--diff') options.diff = true;
    else if (arg === '--install') options.install = true;
    else if (arg === '--print-config') options.printConfig = true;
    else if (arg === '--forget') options.forget = true;
    else if (arg === '--once') options.once = true;
    else if (arg === '--disable') options.disable = true;
    else if (arg === '--enable') options.enable = true;
    else if (arg === '--all') options.all = true;
    else if (options.command === 'verify' && !options.input && !arg.startsWith('-')) options.input = arg;
    else if (options.command === 'overlay' && options.subcommand === 'verify' && !options.input && !arg.startsWith('-')) options.input = arg;
    else if (options.command === 'connect' && !options.subcommand && connect.SUBCOMMANDS.includes(arg)) options.subcommand = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (askRequested && options.command !== 'ask') throw new Error('ask does not accept a second command');
  if (options.command === 'ask' && !options.help && !options.version) {
    if (!options.file || !options.question || options.question.length > 500) throw new Error('ask requires --file <scan-export.json> and --question <supported question> (at most 500 characters)');
    if (options.json && options.json !== '-') throw new Error('ask writes only to stdout; use --json -');
    if (options.config || options.overlay || options.policy || options.html || options.sarif || options.yes || options.install) throw new Error('ask reads an export only; scan, fix and installation options are not supported');
  }
  if (options.command === 'verify' && !options.input && !options.help && !options.version) throw new Error('verify requires the path of an earlier --json export');
  if (options.overlayBundle && !options.trust) throw new Error('--overlay-bundle requires --trust <public-keys.json>; no key ships with boppi');
  if (options.overlayBundle && options.overlay) throw new Error('use --overlay-bundle or --overlay, not both');
  if (options.command === 'overlay' && !options.help && !options.version) {
    if (!options.subcommand) throw new Error(`overlay requires one of: ${OVERLAY_SUBCOMMANDS.join(', ')}`);
    if (options.subcommand === 'verify' && (!options.input || !options.trust)) throw new Error('overlay verify requires <bundle.json> and --trust <public-keys.json>');
    if (options.subcommand === 'rollback' && (!options.receipt || !options.trust)) throw new Error('overlay rollback requires --receipt <receipt.json> and --trust <public-keys.json>');
  }
  if (options.command === 'fix' && !options.server && !options.help && !options.version) throw new Error('fix requires --server <name>');
  if (options.command === 'events' && !options.help && !options.version && (!Number.isFinite(options.since) || options.since < 1 || options.since > 3650)) throw new Error('--since must be a number of days from 1 to 3650');
  if (options.command === 'watch' && !options.help && !options.version) {
    if (!Number.isFinite(options.interval) || options.interval < 1) throw new Error('--interval must be a number of seconds, at least 1');
    if (!Number.isFinite(options.duration) || options.duration < 0 || options.duration > 2000000) throw new Error('--duration must be a number of seconds up to 2000000 (about 23 days)');
    if (options.config) throw new Error('watch follows discovered client files; --config is not supported');
  }
  if (options.command === 'discover' && !options.help && !options.version) {
    if (!options.server && !(options.forget && options.all)) throw new Error('discover requires --server <name> (or --forget --all)');
    if (options.all && !options.forget) throw new Error('--all is only accepted with --forget; discovery starts one server per run');
    if (options.yes && !options.server) throw new Error('--yes is only accepted together with --server');
    if (process.env.BOPPI_DISCOVER_TIMEOUTS) { try { options.discoveryTimeouts = JSON.parse(process.env.BOPPI_DISCOVER_TIMEOUTS); } catch { throw new Error('BOPPI_DISCOVER_TIMEOUTS must be JSON'); } }
  }
  if (options.command === 'connect' && !options.help && !options.version) {
    if (!options.subcommand) throw new Error(`connect requires one of: ${connect.SUBCOMMANDS.join(', ')}`);
    if (options.subcommand === 'pair' && (!options.url || !options.code)) throw new Error('connect pair requires --url <workspace> and --code <pair-code>');
    if (options.subcommand === 'run' && (!Number.isFinite(options.interval) || options.interval < 5)) throw new Error('--interval must be a number of seconds, at least 5');
    if (options.yes && options.subcommand !== 'run') throw new Error('--yes is only accepted with connect run');
    if (options.config) throw new Error('connect follows discovered client files; --config is not supported');
  }
  if (options.client && !ONLY_ALIASES[options.client]) throw new Error(`--client must be one of: ${[...new Set(Object.values(ONLY_ALIASES))].join(', ')}`);
  if (options.command === 'push' && !options.help && !options.version) {
    if (!options.dryRun && !options.token && !process.stdin.isTTY) throw new Error('push needs a collector token: pass --token <token>, set BOPPI_TOKEN, or run it in a terminal to be prompted');
    options.ingestUrl = push.resolveIngestUrl(options.url);
  }
  if (options.command === 'events' && options.subcommand === 'push' && !options.help && !options.version) {
    if (!options.dryRun && !options.token && !process.stdin.isTTY) throw new Error('events push needs a collector token: pass --token <token>, set BOPPI_TOKEN, or run it in a terminal to be prompted');
    options.eventsUrl = eventsCommand.eventsUrl(options.url);
  }
  if (!SUPPORTED_PLATFORMS.has(options.platform)) throw new Error(`--platform must be one of: ${[...SUPPORTED_PLATFORMS].join(', ')}`);
  if (options.only) {
    const unknown = options.only.filter(value => !ONLY_ALIASES[value]);
    if (unknown.length) throw new Error(`--only does not know ${unknown.join(', ')}; use ${[...new Set(Object.values(ONLY_ALIASES))].join(', ')}`);
  }
  if (options.config && !fs.existsSync(options.config)) throw new Error(`--config file not found: ${options.config}`);
  if (options.policy && !fs.existsSync(options.policy)) throw new Error(`--policy file not found: ${options.policy}`);
  if (options.failOn && !SEVERITY_ORDER[options.failOn]) throw new Error(`--fail-on must be one of: ${Object.keys(SEVERITY_ORDER).join(', ')}`);
  if (!scanner.supportedSources.includes(options.source)) throw new Error(`--source must be one of: ${scanner.supportedSources.join(', ')}`);
  if (!options.historyFile) options.historyFile = path.join(options.home, '.boppi', 'history.json');
  return options;
}

/** A scan whose every discovered file was read and whose path search finished; only such scans can show that a path closed. */
function scanComplete(scan) { return !(scan.incomplete || []).length && !(scan.traversal && scan.traversal.complete === false); }

/** Why two history entries cannot be compared for closed paths, or null when they can. */
function incomparable(previous, current) {
  if (typeof previous.complete !== 'boolean') return 'the earlier scan predates completeness records';
  if (!previous.complete) return 'the earlier scan was incomplete';
  if (!current.complete) return 'this scan is incomplete (a file could not be read or the path search hit its limit)';
  if (previous.scope !== current.scope) return `the scans cover different scopes (${previous.scope} vs ${current.scope})`;
  if (!previous.coverageIdentity || !current.coverageIdentity) return 'the scan coverage identity is unknown (older history)';
  if (previous.coverageIdentity !== current.coverageIdentity) return 'the selected clients, configuration files, project, platform or analysis inputs changed';
  if (previous.engineVersion !== current.engineVersion || previous.rubricVersion !== current.rubricVersion) return 'the engine or risk rubric changed between the scans';
  return null;
}

function historyEntry(scan, changes = null) {
  const counts = scan.inventory;
  const severityCounts = Object.fromEntries(Object.keys(SEVERITY_ORDER).map(severity => [severity, scan.paths.filter(pathItem => pathItem.severity === severity).length]));
  const top = (scan.paths || []).slice(0, 3).map(pathItem => ({
    id: pathItem.id,
    templateId: pathItem.templateId,
    severity: pathItem.severity,
    label: pathItem.label,
    confidence: pathItem.confidence,
    stale: pathItem.stale,
  }));
  const recommendation = (scan.predictions || []).find(prediction => prediction.predictedEliminated.length || predict.loweredOf(prediction).length);
  return {
    schemaVersion: 1,
    scannedAt: scan.startedAt,
    durationMs: scan.durationMs,
    scannerVersion: VERSION,
    engineVersion: models.ENGINE_VERSION,
    rubricVersion: riskRubric.RUBRIC_VERSION,
    scope: scan.scope,
    coverageIdentity: scan.coverageIdentity,
    complete: scanComplete(scan),
    agents: counts.agents.length,
    mcpServers: counts.mcpServers.length,
    findings: counts.findings.filter(finding => !['resolved', 'accepted_risk', 'false_positive'].includes(finding.status)).length,
    exposurePaths: scan.paths.length,
    severityCounts,
    incomplete: scan.incomplete,
    topPaths: top,
    pathIds: scan.paths.map(pathItem => pathItem.id),
    exposureKeys: scan.paths.map(pathItem => pathItem.exposureKey).sort(),
    changes,
    recommendedEdit: recommendation ? {
      client: recommendation.client.label,
      server: recommendation.edit.server,
      eliminated: recommendation.predictedEliminated.length,
      lowered: predict.loweredOf(recommendation).length,
    } : null,
  };
}

function writeHistory(scan, file) {
  let entries = [];
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(existing)) entries = existing;
  } catch (_) { /* first run or an unreadable local history file */ }
  const previous = entries.filter(e => e.kind !== 'verification').at(-1) || null;
  const entry = historyEntry(scan);
  const currentPathIds = new Set(scan.paths.map(pathItem => pathItem.id));
  const previousPathIds = new Set(previous?.pathIds || []);
  const withheld = previous ? incomparable(previous, entry) : null;
  // A path missing from an incomplete, differently scoped, or differently graded scan is unknown, not resolved.
  const changes = previous ? (withheld ? { comparedAt: previous.scannedAt, withheld } : {
    comparedAt: previous.scannedAt,
    newPaths: [...currentPathIds].filter(id => !previousPathIds.has(id)).length,
    resolvedPaths: [...previousPathIds].filter(id => !currentPathIds.has(id)).length,
    agentDelta: scan.inventory.agents.length - (previous.agents || 0),
    serverDelta: scan.inventory.mcpServers.length - (previous.mcpServers || 0),
  }) : null;
  entry.changes = changes;
  entries.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries.slice(-40), null, 2));
  return changes;
}

/** A verification outcome, appended to the local history so reduction can be tracked over time. */
function recordVerification(file, scan, result) {
  let entries = [];
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(existing)) entries = existing;
  } catch (_) { /* no history yet */ }
  const confirmedKeys = result.resolutions.filter(r => r.status === verify.STATUS.CONFIRMED).flatMap(r => r.observed ? r.observed.eliminated : []);
  entries.push({
    schemaVersion: 1,
    kind: 'verification',
    verifiedAt: scan.startedAt,
    scannerVersion: VERSION,
    engineVersion: models.ENGINE_VERSION,
    rubricVersion: riskRubric.RUBRIC_VERSION,
    scope: scan.scope,
    coverageIdentity: scan.coverageIdentity,
    complete: scanComplete(scan),
    summary: result.summary,
    confirmedEliminatedKeys: [...new Set(confirmedKeys)].sort(),
    exposureKeys: scan.paths.map(pathItem => pathItem.exposureKey).sort(),
  });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries.slice(-40), null, 2));
  } catch (_) { /* read-only home */ }
}

/** Exposures confirmed eliminated by a verification and still absent from the most recent scan. */
function verifiedReduction(entries) {
  const verifications = entries.filter(e => e.kind === 'verification');
  const scans = entries.filter(e => e.kind !== 'verification');
  const latest = scans.at(-1) || verifications.at(-1) || null;
  // Only verifications made under the latest scan's rules and scope say anything about its paths, and only a complete latest scan can show a path still absent.
  const comparable = latest ? verifications.filter(v => !incomparable(v, latest)) : [];
  const withheld = !latest ? null : latest.complete !== true ? 'the latest scan is incomplete or predates completeness records' : verifications.length && !comparable.length ? 'no verification matches the latest scan\'s scope and rubric' : null;
  const confirmed = new Set(comparable.flatMap(v => v.confirmedEliminatedKeys || []));
  const present = new Set(latest ? latest.exposureKeys || [] : []);
  const stillClosed = [...confirmed].filter(key => !present.has(key));
  return { verifications: verifications.length, confirmed: confirmed.size, stillClosed: stillClosed.length, reopened: confirmed.size - stillClosed.length, latestHasKeys: !!(latest && latest.exposureKeys), withheld };
}

function renderHistory(file) {
  let entries;
  try { entries = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { entries = []; }
  if (!Array.isArray(entries) || !entries.length) return `No local scan history yet. Run \`boppi scan\` to save the first summary.\nHistory file: ${file}`;
  const lines = [`BOPPI · LOCAL SCAN HISTORY`, `History file: ${file}`, ''];
  const reduction = verifiedReduction(entries);
  if (reduction.verifications && reduction.withheld) {
    lines.push(`VERIFIED EXPOSURE REDUCTION  withheld: ${reduction.withheld}. ${reduction.verifications} verification${reduction.verifications === 1 ? '' : 's'} recorded; run a complete boppi scan to compare.`);
    lines.push('');
  } else if (reduction.verifications) {
    lines.push(`VERIFIED EXPOSURE REDUCTION  ${reduction.confirmed} exposure path${reduction.confirmed === 1 ? '' : 's'} confirmed eliminated across ${reduction.verifications} verification${reduction.verifications === 1 ? '' : 's'}; ${reduction.stillClosed} still absent in the latest scan${reduction.reopened ? `, ${reduction.reopened} reappeared` : ''}.`);
    lines.push('');
  }
  for (const entry of entries.slice().reverse()) {
    if (entry.kind === 'verification') {
      lines.push(`${entry.verifiedAt} · verify · ${entry.summary.confirmed} confirmed · ${entry.summary.partial} partial · ${entry.summary.contradicted} contradicted · ${entry.summary.unresolved} unresolved`);
      continue;
    }
    const severity = Object.entries(entry.severityCounts || {}).filter(([, count]) => count).map(([name, count]) => `${count} ${name}`).join(', ') || 'no exposure paths';
    const incomplete = entry.incomplete?.length ? ` · incomplete: ${entry.incomplete.join(', ')}` : '';
    lines.push(`${entry.scannedAt} · ${entry.agents} agents · ${entry.mcpServers} MCP servers · ${entry.exposurePaths} paths (${severity})${incomplete}`);
    if (entry.changes && entry.changes.withheld) lines.push(`  changes: comparison withheld (${entry.changes.withheld})`);
    else if (entry.changes) lines.push(`  changes: ${entry.changes.newPaths} new · ${entry.changes.resolvedPaths} resolved · ${entry.changes.agentDelta >= 0 ? '+' : ''}${entry.changes.agentDelta} agents · ${entry.changes.serverDelta >= 0 ? '+' : ''}${entry.changes.serverDelta} MCP servers`);
    if (entry.recommendedEdit) lines.push(`  recommended: remove "${entry.recommendedEdit.server}" from ${entry.recommendedEdit.client} (${entry.recommendedEdit.eliminated} paths modeled eliminated${entry.recommendedEdit.lowered ? `, ${entry.recommendedEdit.lowered} lowered` : ''})`);
  }
  lines.push('', 'History contains sanitized summaries only. Raw config values and file contents are never stored.');
  return lines.join('\n');
}

const ONLY_ALIASES = Object.freeze({
  claude: 'claude-desktop', 'claude-desktop': 'claude-desktop', desktop: 'claude-desktop',
  'claude-code': 'claude-code', code: 'claude-code', cursor: 'cursor',
});

/** Per-machine secret that keys every path fingerprint. Created once, mode 600, never leaves the machine. */
function loadFingerprintKey(home) {
  const file = path.join(home, '.boppi', 'fingerprint-key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch (_) { /* first run */ }
  const key = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, key + '\n', { mode: 0o600 });
  } catch (_) { /* read-only home: the key lives for this process only */ }
  return key;
}

/** Discover config files per client. Missing files are reported, never errors. */
function discover(options) {
  const filesRead = new Set();
  const clients = [];
  const wanted = options.only ? new Set(options.only.map(v => ONLY_ALIASES[v] || v)) : null;

  const descriptors = fix.descriptorsFor(options);

  for (const descriptor of descriptors) {
    if (wanted && !wanted.has(descriptor.clientKey)) continue;
    const read = fix.readClient(descriptor, options.cwd);
    const client = { clientKey: descriptor.clientKey, label: descriptor.label, source: descriptor.source, files: read.files, mergedServers: {}, primaryPath: null };
    for (const server of read.servers) client.mergedServers[server.label] = server.server;
    for (const entry of read.files) {
      if (entry.status === 'not_found') continue;
      filesRead.add(entry.path);
      if (entry.status === 'found' && !client.primaryPath) client.primaryPath = entry.path;
    }
    if (descriptor.pluginIndex && descriptor.pluginIndex.status !== 'not_found') {
      filesRead.add(descriptor.pluginIndex.path);
      client.files.push({ ...descriptor.pluginIndex });
    }
    if (builtinTools.hasBuiltinTools(client.clientKey)) {
      // Permission settings are read only when discovery found this client, and never in explicit --config mode.
      client.builtin = builtinTools.describeBuiltin(client.clientKey, client.primaryPath ? descriptor.settingsFiles || null : null, { home: options.home, cwd: options.cwd });
      for (const entry of client.builtin.settings.files) {
        if (entry.status !== 'not_found') filesRead.add(entry.path);
        client.files.push(entry);
      }
    }
    client.coverageIdentity = evidenceIdentity.digest('client-coverage-v2', {
      key: client.clientKey, source: client.source, platform: options.platform,
      home: path.resolve(options.home), cwd: path.resolve(options.cwd), explicit: !!options.config,
      files: client.files.map(f => ({ path: path.resolve(f.path), scope: f.scope, kind: f.kind || 'config' })).sort((a, b) => a.path.localeCompare(b.path)),
    });
    clients.push(client);
  }
  return { clients, filesRead: [...filesRead] };
}

/** Shadow entries: what experimental claims would have added. Reported, never applied. */
function shadowEntries(client, overlayByServer) {
  const entries = [];
  for (const [serverName, match] of Object.entries(overlayByServer)) {
    for (const claim of match.experimental) {
      entries.push({ client: client.clientKey, server: serverName, package: match.package.name, claimId: claim.id, capability: claim.capability, status: claim.status, evidence: overlayModule.citedEvidence(claim) });
    }
  }
  return entries;
}

/**
 * A rule-engine finding that an exposure path also describes takes the path's
 * rubric priority, so every surface shows one severity for one exposure. The
 * agent's score and band are then recomputed from the aligned findings with
 * the engine's own arithmetic, and the band is then pinned to the worst open
 * finding or exposure path on the agent (low when there is none), so the
 * AGENTS row never says critical for a machine whose every path is medium,
 * and never says medium next to a critical path. The score keeps the engine's
 * points within that band.
 */
function alignFindings(inventory, paths) {
  const byKey = new Map(paths.map(p => [`${p.agentId}:${terminal.PATH_RULE_FOR_TEMPLATE[p.templateId]}`, p]));
  const touched = new Set();
  for (const finding of inventory.findings || []) {
    const covering = byKey.get(`${finding.agentId}:${finding.ruleId}`);
    if (!covering || covering.severity === finding.severity) continue;
    finding.ruleSeverity = finding.severity;
    finding.severity = covering.severity;
    finding.description = `${finding.description} Priority ${covering.severity} follows the ${covering.templateId} exposure path assessment (rubric ${covering.assessment ? covering.assessment.rubricVersion : 'n/a'}); the rule's own severity is ${finding.ruleSeverity}.`;
    touched.add(finding.agentId);
  }
  const { SEVERITY_RANK } = require('./simulate');
  const { THRESHOLDS } = agentRiskEngine;
  for (const agent of inventory.agents || []) {
    const mine = records => (records || []).filter(r => r.agentId === agent.id);
    if (touched.has(agent.id)) {
      const rescored = agentRiskEngine.score({ findings: mine(inventory.findings), permissions: mine(inventory.permissions), mcpServers: mine(inventory.mcpServers), stale: !!agent.stale });
      agent.riskScore = rescored.score;
      agent.riskLevel = rescored.riskLevel;
    }
    const open = mine(inventory.findings).filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status));
    const worst = [...open.map(f => f.severity), ...paths.filter(p => p.agentId === agent.id).map(p => p.severity)].sort((a, b) => (SEVERITY_RANK[b] || 0) - (SEVERITY_RANK[a] || 0))[0] || 'low';
    const bands = ['low', 'medium', 'high', 'critical'];
    const ceiling = bands[bands.indexOf(worst) + 1];
    if ((SEVERITY_RANK[worst] || 0) > (SEVERITY_RANK[agent.riskLevel] || 0)) { agent.riskLevel = worst; agent.riskScore = Math.max(agent.riskScore || 0, THRESHOLDS[worst] || 0); }
    else if ((SEVERITY_RANK[worst] || 0) < (SEVERITY_RANK[agent.riskLevel] || 0)) { agent.riskLevel = worst; agent.riskScore = Math.min(agent.riskScore || 0, ceiling ? THRESHOLDS[ceiling] - 1 : 100); }
  }
}

/** Discover, scan, and analyze. Returns everything a renderer or the verifier needs and writes nothing. */
async function performScan(options) {
  const fingerprintKey = loadFingerprintKey(options.home);
  scanner.setFingerprintKey(fingerprintKey);
  evidenceIdentity.setKey(fingerprintKey);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const discovery = discover(options);
  let overlay = null;
  if (options.overlay) {
    try { overlay = overlayModule.loadOverlay(options.overlay); } catch (error) {
      return { failed: `Could not load overlay ${options.overlay}: ${error.message}`, exitCode: 2 };
    }
    overlay.unsigned = true;
    process.stderr.write('boppi: unsigned overlay: its claims are self-asserted, including any it marks validated. Use --overlay-bundle with --trust for a verified one.\n');
    discovery.filesRead.push(overlay.file);
  } else if (options.overlayBundle) {
    try {
      const { verified } = overlayBundle.accept(options.home, fs.readFileSync(options.overlayBundle, 'utf8'), overlayBundle.loadTrust(options.trust));
      overlay = overlayBundle.toOverlay(options.overlayBundle, verified);
    } catch (error) {
      return { failed: `Overlay bundle ${options.overlayBundle} ${error instanceof overlayBundle.BundleRefusal ? error.message : `could not be read: ${error.message}`}`, exitCode: 2 };
    }
    discovery.filesRead.push(overlay.file);
  }
  for (const client of discovery.clients) client.coverageIdentity = evidenceIdentity.digest('client-analysis', {
    coverage: client.coverageIdentity,
    overlay: overlay ? crypto.createHash('sha256').update(fs.readFileSync(overlay.file)).digest('hex') : null,
  });
  const shadow = [];
  const applied = [];
  const providers = [];
  const inferenceByClient = {};
  const recognition = [];
  for (const client of discovery.clients) {
    if (!client.primaryPath) continue; // nothing found for this client
    const { config, inferenceByServer, overlayByServer } = enrich(client.mergedServers, options.home, overlay, discoverCommand.advertisedLookup(options.home, client.source));
    inferenceByClient[client.clientKey] = inferenceByServer;
    shadow.push(...shadowEntries(client, overlayByServer));
    for (const [serverName, match] of Object.entries(overlayByServer)) for (const claim of match.validated) applied.push({ client: client.clientKey, server: serverName, package: match.package.name, claimId: claim.id, capability: claim.capability });
    try {
      const scannerResult = scanner.scanConfig({
        source: client.source, consent: true, dryRun: true,
        config, configPath: client.primaryPath, observedAt: startedAt,
      });
      client.agentId = scannerResult.agent.id;
      recognition.push(...recognitionModule.describeClient({ clientKey: client.clientKey, label: client.label, mergedServers: client.mergedServers, inferenceByServer, records: scannerResult.records }));
      providers.push(createConfigProvider({ clientKey: client.clientKey, label: client.label, scannerResult, inferenceByServer, overlayByServer, builtin: client.builtin || null }));
    } catch (error) {
      const hint = /secret material/.test(error.message) ? '. Move that value into an environment variable the server reads and rescan; Boppi never records the value itself' : '';
      client.files.forEach(f => { if (f.status === 'found') { f.status = 'unreadable'; f.reason = `${error.message}${hint}`; } });
    }
  }

  const controller = Controller.createScanController({
    registry: Registry.createProviderRegistry(providers),
    storage: Storage.createStorage(Storage.memoryAdapter()),
  });
  let inventory = { agents: [], integrations: [], permissions: [], mcpServers: [], findings: [] };
  if (providers.length) {
    const result = await controller.runScan({ requestedBy: 'boppi-cli' });
    if (result.status === 'failed') return { failed: result.error || 'unknown error' };
    for (const providerResult of result.providerResults || []) {
      if (providerResult.status !== 'failed') continue;
      const client = discovery.clients.find(c => `cli-${c.clientKey}` === providerResult.providerId);
      if (client) client.scanError = providerResult.error || 'provider_failed';
    }
    inventory = result.inventory;
  }
  configFacts.attach(discovery.clients, inventory.mcpServers);
  const incomplete = discovery.clients
    .filter(c => c.scanError || c.files.some(file => file.status === 'unreadable'))
    .map(c => c.label);

  const graph = securityGraph.buildGraph(inventory);
  const { paths, traversal } = exposurePathEngine.analyze(graph);
  alignFindings(inventory, paths);
  const prioritization = exposurePathEngine.prioritize(paths);
  const rootCauses = rootCauseEngine.clusterRootCauses(graph, paths, { limit: 5 });
  const predictions = discovery.clients
    .filter(c => c.agentId && !c.scanError)
    .flatMap(client => predict.predictForClient({ client, inventory, graph, paths, observedAt: startedAt, home: options.home, overlay, scannerVersion: VERSION, otherClients: discovery.clients }));
  for (const prediction of predictions) prediction.evidenceComplete = prediction.evidenceComplete && traversal.complete === true;
  const remediationPlan = predict.planFromPredictions(predictions, paths, { severityFloor: 'high' });
  const builtinResidual = discovery.clients
    .filter(c => c.agentId && !c.scanError)
    .map(client => predict.builtinResidualForClient({ client, observedAt: startedAt, home: options.home, overlay }))
    .filter(Boolean);
  const storageExport = await controller.getExport();

  const diagnostics = overlay
    ? { overlay: { file: overlay.file, claimCount: overlay.claimCount, activeCount: overlay.activeCount, rejected: overlay.rejected, ...(overlay.unsigned ? { unsigned: true } : {}), ...(overlay.signed ? { signed: overlay.signed } : {}) }, shadow, applied }
    : { shadow: [], applied: [] };
  // Which explicit file was scanned, in portable form, so a report can print a `boppi fix` command that targets the same file.
  const scanArgs = options.config ? { config: portablePath(path.resolve(options.config), options.home), source: options.source } : null;
  const scan = { startedAt, scannerVersion: VERSION, home: options.home, platform: options.platform, scope: options.config ? 'explicit' : options.only ? 'selected' : 'full', durationMs: Date.now() - startMs, discovery, portableDiscovery: portableDiscovery(discovery, options.home), inventory, graph, paths, traversal, prioritization, rootCauses, predictions, remediationPlan, builtinResidual, inferenceByClient, recognition, diagnostics, incomplete, storageExport, scanArgs };
  // Include attempted locations, even absent files, and cwd (Claude Code stores project blocks in a user file).
  // File contents deliberately do not define coverage: a real edit must remain comparable.
  scan.coverageIdentity = evidenceIdentity.digest('coverage-v2', {
    scope: scan.scope, platform: options.platform, home: path.resolve(options.home), cwd: path.resolve(options.cwd),
    clients: discovery.clients.map(c => ({ key: c.clientKey, source: c.source,
      files: c.files.map(f => ({ path: path.resolve(f.path), scope: f.scope, kind: f.kind || 'config' })).sort((a, b) => a.path.localeCompare(b.path)),
    })).sort((a, b) => a.key.localeCompare(b.key)),
    overlay: overlay ? crypto.createHash('sha256').update(fs.readFileSync(overlay.file)).digest('hex') : null,
  });
  // The observed layer reads only this machine's hook events (a local file); a home with none stored says so.
  const storedEvents = options.config ? null : (hook.storedFiles(options.home).length ? eventsCommand.readEvents(options.home, { sinceDays: 30 }) : null);
  scan.evidenceLayers = evidence.layersFor(scan, { events: storedEvents ? { ...storedEvents, calls: eventsCommand.timeline(storedEvents.records).calls } : null, sinceDays: 30 });
  return scan;
}

/** Config locations as they leave the machine: ~-relative under the scanned home, a fingerprint anywhere else. */
function portablePath(file, home) {
  const root = path.resolve(home);
  if (file === root || file.startsWith(root + path.sep)) return '~' + file.slice(root.length).split(path.sep).join('/');
  return scanner.pathFingerprint(file);
}
function portableDiscovery(discovery, home) {
  return {
    clients: discovery.clients.map(({ mergedServers, ...client }) => ({
      ...client,
      primaryPath: client.primaryPath ? portablePath(client.primaryPath, home) : null,
      files: client.files.map(file => ({ ...file, path: portablePath(file.path, home) })),
      ...(client.builtin ? { builtin: { ...client.builtin, settings: { ...client.builtin.settings, files: client.builtin.settings.files.map(file => ({ ...file, path: portablePath(file.path, home) })) } } } : {}),
    })),
    filesRead: discovery.filesRead.map(file => portablePath(file, home)),
  };
}

function exportPayload(scan) {
  const envelope = push.collectorEnvelope(scan.portableDiscovery, VERSION, scan.platform, scan.scope);
  return {
    ...scan.storageExport,
    engineVersion: models.ENGINE_VERSION,
    graph: scan.graph,
    exposurePaths: scan.paths,
    traversal: scan.traversal,
    prioritization: scan.prioritization,
    rootCauses: scan.rootCauses,
    predictions: scan.predictions,
    remediationPlan: scan.remediationPlan,
    builtinResidual: scan.builtinResidual,
    advertised: discoverCommand.advertisedSummary(scan.inferenceByClient),
    evidenceLayers: scan.evidenceLayers,
    recognition: scan.recognition,
    scanArgs: scan.scanArgs,
    ...envelope,
    discovery: scan.portableDiscovery,
    diagnostics: scan.diagnostics.overlay
      ? { ...scan.diagnostics, overlay: { ...scan.diagnostics.overlay, file: portablePath(scan.diagnostics.overlay.file, scan.home) } }
      : scan.diagnostics,
    generatedBy: `boppi-cli/${VERSION}`,
  };
}

/** boppi plan --diff: the sanitized diff preview of the source-side removal for every candidate, in plan order. */
function renderPlanDiffs(scan, options) {
  const lines = ['DIFF PREVIEW  what each removal changes, sanitized; values outside server entries are not shown'];
  const seen = new Set();
  for (const row of plan.candidateRows({ predictions: scan.predictions, paths: scan.paths })) {
    const p = row.prediction;
    const key = `${p.client.key}:${p.edit.server}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const client = scan.discovery.clients.find(c => c.clientKey === p.client.key);
    const preview = client ? previewFor(scan, options, client, p.edit.server) : null;
    lines.push('', `  remove "${p.edit.server}" from ${p.client.label}`);
    if (!preview) {
      const remedy = client ? plugins.pluginRemedy(client, p.edit.server) : null;
      lines.push(remedy ? `    source:  ${remedy.file}. ${remedy.reason}` : '    no readable file holds this entry');
      continue;
    }
    lines.push(`    file:    ${preview.file} (${preview.scope} scope)`, remediate.renderPreview(preview, '    '));
  }
  return lines.join('\n');
}

/** boppi verify: rescan with the same discovery options and grade each earlier prediction. */
async function runVerify(options) {
  let previous;
  try {
    previous = JSON.parse(fs.readFileSync(options.input, 'utf8'));
  } catch (error) {
    process.stderr.write(`verify: cannot read ${options.input}: ${error.message}\n`);
    return 2;
  }
  if (!previous || !Array.isArray(previous.predictions)) {
    process.stderr.write(`verify: ${options.input} has no predictions[]; it must be a --json export from boppi scan\n`);
    return 2;
  }
  const scan = await performScan(options);
  if (scan.failed) {
    process.stderr.write(`Scan failed: ${scan.failed}\n`);
    return scan.exitCode || 3;
  }
  const result = verify.resolveAll(previous, scan, { explicitConfig: !!options.config });
  process.stdout.write(verify.renderTable(result, options.color) + '\n');
  recordVerification(options.historyFile, scan, result);

  const written = [];
  const dir = options.contradictionsDir || options.cwd;
  for (const resolution of result.resolutions) {
    if (resolution.status !== verify.STATUS.PARTIAL && resolution.status !== verify.STATUS.CONTRADICTED) continue;
    const prediction = previous.predictions.find(p => p.predictionId === resolution.predictionId);
    // Prediction IDs originate in an input export. Make the basename safe and
    // prove containment before writing, so verify can never escape its output
    // directory through a crafted prediction ID.
    const safeId = String(resolution.predictionId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160) || crypto.createHash('sha256').update(String(resolution.predictionId)).digest('hex').slice(0, 16);
    const resolvedDir = path.resolve(dir);
    const file = path.resolve(resolvedDir, `boppi-contradiction-${safeId}.json`);
    if (!file.startsWith(`${resolvedDir}${path.sep}`)) {
      process.stderr.write('verify: refusing to write a contradiction file outside the requested directory\n');
      return 2;
    }
    fs.mkdirSync(resolvedDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(verify.contradictionBundle(prediction, resolution, previous, scan), null, 2));
    written.push(file);
  }
  for (const file of written) process.stdout.write(`contradiction fixture written to ${file}\n`);
  if (options.json) {
    const payload = { schemaVersion: 1, verifiedAt: scan.startedAt, engineVersion: models.ENGINE_VERSION, previous: { generatedBy: previous.generatedBy || null, engineVersion: previous.engineVersion || null }, summary: result.summary, engineChanged: result.engineChanged, resolutions: result.resolutions, contradictionFiles: written };
    fs.writeFileSync(options.json, JSON.stringify(payload, null, 2));
    process.stdout.write(`verification written to ${options.json}\n`);
  }
  return 0;
}

/** The sanitized diff preview for removing one server from one client's file, or null when no readable file holds it. */
function previewFor(scan, options, client, serverName) {
  const descriptor = fix.descriptorsFor(options).find(d => d.clientKey === client.clientKey);
  const located = descriptor ? fix.locateServer(descriptor, serverName, options.cwd) : null;
  if (!located) return null;
  const recordsByName = new Map(scan.inventory.mcpServers.filter(s => s.agentId === client.agentId).map(s => [s.name, s]));
  return remediate.previewRemoval({ located, serverName, cwd: options.cwd, recordsByName });
}

/** boppi fix: preview, confirm, then run the staged removal and print each stage. */
async function runFix(options) {
  const before = await performScan(options);
  if (before.failed) {
    process.stderr.write(`Scan failed: ${before.failed}\n`);
    return before.exitCode || 3;
  }
  const holders = before.discovery.clients.filter(c => c.primaryPath && Object.prototype.hasOwnProperty.call(c.mergedServers, options.server));
  const wantedClient = options.client ? ONLY_ALIASES[options.client] : null;
  const candidates = wantedClient ? holders.filter(c => c.clientKey === wantedClient) : holders;
  if (!candidates.length) {
    process.stderr.write(`fix: no scanned ${wantedClient ? `${wantedClient} ` : ''}configuration has a server named "${options.server}". boppi scan lists the names.\n`);
    return 2;
  }
  if (candidates.length > 1) {
    process.stderr.write(`fix: "${options.server}" exists in ${candidates.map(c => c.clientKey).join(' and ')}; pass --client to choose.\n`);
    return 2;
  }
  const client = candidates[0];
  const preview = previewFor(before, options, client, options.server);
  if (!preview) {
    const remedy = plugins.pluginRemedy(client, options.server);
    if (remedy) process.stderr.write(`fix: "${options.server}" is not in a file Boppi edits. ${remedy.reason}\n`);
    else process.stderr.write(`fix: "${options.server}" is listed for ${client.label} but no readable file holds it.\n`);
    return 2;
  }
  const prediction = before.predictions.find(p => p.edit.action === 'remove_server' && p.edit.server === options.server && p.client.key === client.clientKey);
  const server = before.inventory.mcpServers.find(s => s.agentId === client.agentId && s.name === options.server);
  const lost = prediction ? prediction.disruption.lost : (server ? server.capabilities : []);

  process.stdout.write(`BOPPI · FIX  remove "${options.server}" from ${client.label}\n`);
  process.stdout.write(`  file:    ${preview.file} (${preview.scope} scope)\n`);
  const lowered = prediction ? predict.loweredOf(prediction) : [];
  if (prediction) process.stdout.write(`  breaks:  ${prediction.predictedEliminated.length} of ${prediction.before.exposureKeys.length} exposure path${prediction.before.exposureKeys.length === 1 ? '' : 's'} on ${client.label}, by rescanning without it\n`);
  else process.stdout.write('  breaks:  nothing modeled; this server takes part in no exposure path\n');
  if (lowered.length) process.stdout.write(`  lowers:  ${lowered.map(step => `${step.exposureKey.split(':')[0]} ${step.from} to ${step.to}`).join(', ')} (the path stays open through what remains)\n`);
  if (prediction && !prediction.predictedEliminated.length && !lowered.length) process.stdout.write('  note:    this edit is not predicted to close or lower any exposure path; it removes a capability without reducing modeled risk. boppi plan compares edits that do.\n');
  process.stdout.write(`  loses:   ${remediate.capabilityLossText(lost, server)}\n`);
  process.stdout.write(`  backup:  ${fix.backupPath(options.home, preview.file, before.startedAt)}\n`);
  process.stdout.write(remediate.renderPreview(preview) + '\n');

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write('fix: not applied. Pass --yes to apply without a terminal confirmation.\n');
      return 2;
    }
    const approved = await fix.confirm('Apply this edit? [y/N] ');
    if (!approved) { process.stdout.write('Not applied.\n'); return 2; }
  }

  // Kept under ~/.boppi, owner-only, so a fix never leaves a file in the project that could be committed.
  const exportDir = path.join(options.home, '.boppi', 'fix-exports');
  fs.mkdirSync(exportDir, { recursive: true, mode: 0o700 });
  const exportFile = path.join(exportDir, `boppi-fix-${before.startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(exportFile, JSON.stringify(exportPayload(before), null, 2), { mode: 0o600 });
  process.stdout.write(`\nSTAGES  predictions saved to ${exportFile}\n`);

  let result = null, after = null, grade = null, failure = null;
  const stages = remediate.runRemediation({ options, server: options.server, clientKey: client.clientKey, scanBefore: before, expectedHashes: preview.fileHashes, exportFile, rescan: performScan });
  for await (const event of stages) {
    const line = remediate.renderStage(event);
    if (line) process.stdout.write(line + '\n');
    if (event.status === 'failed') failure = event;
    if (event.stage === 'rescan' && event.status === 'done') after = event.detail.scan;
    if (event.stage === 'verify' && event.status === 'done') grade = event.detail.result || null;
    if (event.stage === 'result') result = event.detail;
  }
  if (failure) {
    process.stderr.write(`fix: ${failure.stage} failed: ${failure.detail.reason}\n`);
    return failure.stage === 'rescan' ? (failure.detail.exitCode || 3) : failure.stage === 'backup' ? 2 : 3;
  }
  process.stdout.write(`\nApplied. Backup at ${result.backup}. Predictions saved to ${exportFile}.\n\n`);
  writeHistory(after, options.historyFile);
  if (!grade) {
    process.stdout.write(`Rescan: ${terminal.summaryLine({ inventory: after.inventory, paths: after.paths })}\n`);
    return 0;
  }
  process.stdout.write(verify.renderTable(grade, options.color) + '\n');
  recordVerification(options.historyFile, after, grade);
  return grade.summary.confirmed === 1 ? 0 : 1;
}

/** Ask for the token on the terminal without echoing it, so it never lands in shell history. */
function promptForToken() {
  return new Promise(resolve => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const write = rl._writeToOutput;
    process.stderr.write('Collector token (from the Collectors page; input is hidden): ');
    rl._writeToOutput = () => {};
    rl.question('', answer => { rl._writeToOutput = write; rl.close(); process.stderr.write('\n'); resolve(answer.trim()); });
  });
}

/** boppi push: scan (or load an export), map the real inventory to ingest records, send one snapshot. */
async function runPush(options) {
  if (!options.dryRun && !options.token) {
    options.token = await promptForToken();
    if (!options.token) { process.stderr.write('push: no token entered\n'); return 2; }
  }
  let inventory;
  let snapshotAt;
  let collector;
  let coverage;
  let builtinResidual = null;
  let incomplete = [];
  let recognition = [];
  if (options.file) {
    let payload;
    try { payload = JSON.parse(fs.readFileSync(options.file, 'utf8')); } catch (error) {
      process.stderr.write(`push: cannot read ${options.file}: ${error.message}\n`);
      return 2;
    }
    inventory = payload.inventory && payload.inventory.real ? payload.inventory.real : payload.inventory;
    recognition = Array.isArray(payload.recognition) ? payload.recognition : [];
    snapshotAt = typeof payload.exportedAt === 'string' ? payload.exportedAt : undefined;
    try { ({ collector, coverage, builtinResidual } = push.envelopeFromExport(payload)); } catch (error) {
      process.stderr.write(`push: ${error.message}\n`);
      return 2;
    }
    if (!inventory || !Array.isArray(inventory.agents)) {
      process.stderr.write(`push: ${options.file} has no inventory; it must be a --json export from boppi scan\n`);
      return 2;
    }
  } else {
    const scan = await performScan(options);
    if (scan.failed) {
      process.stderr.write(`Scan failed: ${scan.failed}\n`);
      return scan.exitCode || 3;
    }
    const payload = exportPayload(scan);
    inventory = payload.inventory.real;
    snapshotAt = payload.exportedAt;
    collector = payload.collector;
    coverage = payload.coverage;
    builtinResidual = push.builtinResidualFromExport(payload);
    incomplete = scan.incomplete;
    recognition = scan.recognition;
  }

  if (options.file) incomplete = (coverage?.clients || []).filter(client => ['unreadable', 'failed'].includes(client.status)).map(client => client.label);

  const records = options.file ? push.resanitizeRecords(push.toRecords(inventory, recognition)) : push.toRecords(inventory, recognition);
  const summary = push.counts(inventory);
  const described = `${plural(summary.agents, 'agent')}, ${plural(summary.mcpServers, 'MCP server')}, ${plural(summary.permissions, 'permission')}${summary.integrations ? `, ${plural(summary.integrations, 'integration')}` : ''}`;
  if (incomplete.length) process.stderr.write(`Scan incomplete: ${incomplete.join(', ')} could not be analyzed and ${incomplete.length === 1 ? 'is' : 'are'} missing from this push.\n`);

  const snapshot = !options.merge && push.completeCoverage(coverage) && records.length <= push.SNAPSHOT_MAX;
  if (options.dryRun) {
    process.stdout.write(JSON.stringify(push.ingestBody({ records, snapshot, snapshotAt, collector, coverage, builtinResidual }), null, 2) + '\n');
    process.stdout.write(`Dry run: ${plural(records.length, 'record')} (${described}) mapped. Nothing was sent.\n`);
    return 0;
  }
  if (!records.length) {
    process.stdout.write('Nothing to push: no AI agent configuration was found on this machine.\n');
    return 0;
  }

  const workspace = push.workspaceUrl(options.ingestUrl);
  process.stdout.write(`Sending ${plural(records.length, 'record')} (${described}) to ${workspace}${snapshot ? ' as a full snapshot' : ''}.\n`);
  process.stdout.write('Only sanitized inventory metadata is sent: no secret values, file contents, or raw paths.\n');
  if (!options.merge && !snapshot) process.stderr.write('Partial, incomplete, legacy, or oversized scan: merging evidence without removing earlier records. Run a complete discovery scan to replace the full inventory.\n');

  const result = await push.pushRecords({ ingestUrl: options.ingestUrl, token: options.token, records, snapshot, snapshotAt, collector, coverage, builtinResidual, fetchImpl: updateNotice.watching(options.home, globalThis.fetch) });
  if (!result.ok) {
    process.stderr.write(`${push.describeFailure(result)}\n`);
    return 5;
  }
  process.stdout.write(`Done. ${plural(result.ingested, 'record')} ingested. Open ${workspace}/dashboard to see this machine in the workspace graph.\n`);
  return incomplete.length ? 4 : 0;
}

function plural(count, noun) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }

async function run(argv) {
  let options;
  try { options = parseArgs(argv); } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    // A hook that exits 2 blocks the tool call Claude Code was about to make, so a mistyped snippet is a health line, not a blocked tool.
    if (argv[0] === 'hook') { hook.recordHealth(os.homedir(), 'bad_flags'); return 0; }
    return 2;
  }
  if (options.help) { process.stdout.write(usage() + '\n'); return 0; }
  if (options.version) { process.stdout.write(VERSION + '\n'); return 0; }
  if (options.command === 'ask') return askCommand.runAsk({ ...options, client: options.client ? ONLY_ALIASES[options.client] : undefined });
  if (options.command === 'history') { process.stdout.write(renderHistory(options.historyFile) + '\n'); return 0; }
  if (options.command === 'settings') {
    try {
      const current = options.set.length ? settingsModule.assign(options.home, options.set) : settingsModule.load(options.home);
      process.stdout.write(settingsModule.render(options.home, current) + '\n');
      return 0;
    } catch (error) {
      process.stderr.write(`settings: ${error.message}\n`);
      return 2;
    }
  }
  if (options.command === 'hook') return hook.runHook(options, { fingerprint: value => crypto.createHmac('sha256', loadFingerprintKey(options.home)).update(value).digest('hex').slice(0, 16), keyedDigest: value => crypto.createHmac('sha256', loadFingerprintKey(options.home)).update(`id|${value}`).digest('hex').slice(0, 32), settings: options.install || options.printConfig ? settingsModule.defaults() : settingsModule.load(options.home) });
  if (options.command === 'verify') return runVerify(options);
  if (options.command === 'overlay') return overlayBundle.runOverlay(options);
  if (options.command === 'push') return runPush(options);
  if (options.command === 'fix') return runFix(options);
  if (options.command === 'events') return options.subcommand === 'push' ? eventsCommand.runEventsPush(options, { promptForToken }) : eventsCommand.runEvents(options);
  if (options.command === 'watch') return watchCommand.runWatch({ ...options, only: options.only ? options.only.map(v => ONLY_ALIASES[v] || v) : null }, { performScan, writeHistory });
  if (options.command === 'discover') return discoverCommand.runDiscover({ ...options, clientKey: options.client ? ONLY_ALIASES[options.client] : null }, { discover, confirm: fix.confirm, version: VERSION });
  if (options.command === 'demo') return demo.runDemo(options, { run, performScan, version: VERSION });
  if (options.command === 'connect') return connect.runConnect(options, { performScan, confirm: fix.confirm, version: VERSION });
  if (options.command === 'rollback') return rollback.runRollback(options, { rescan: performScan, recordScan: scan => writeHistory(scan, options.historyFile), summaryLine: terminal.summaryLine });

  const scan = await performScan(options);
  if (scan.failed) {
    process.stderr.write(`Scan failed: ${scan.failed}\n`);
    return scan.exitCode || 3;
  }
  const { discovery, inventory, paths, incomplete } = scan;
  if (incomplete.length) process.stderr.write(`Scan incomplete: ${incomplete.join(', ')} could not be analyzed and ${incomplete.length === 1 ? 'is' : 'are'} missing from the results.\n`);

  const report = {
    version: VERSION, startedAt: scan.startedAt, durationMs: scan.durationMs,
    discovery: discovery.clients, filesRead: discovery.filesRead, portableFilesRead: scan.portableDiscovery.filesRead, evidenceLayers: scan.evidenceLayers,
    inventory, graph: scan.graph, paths, traversal: scan.traversal, prioritization: scan.prioritization, rootCauses: scan.rootCauses, predictions: scan.predictions, remediationPlan: scan.remediationPlan, builtinResidual: scan.builtinResidual || [], inferenceByClient: scan.inferenceByClient, recognition: scan.recognition, incomplete, scanArgs: scan.scanArgs,
  };

  const policyFile = policyModule.discoverPolicy(options.policy, options.cwd);
  if (policyFile) {
    let loaded;
    try { loaded = policyModule.loadPolicy(policyFile); } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    report.policy = policyModule.evaluatePolicy(loaded, inventory, paths);
  }

  if (options.command === 'plan') {
    process.stdout.write(plan.renderPlan(report, options) + '\n');
    if (options.diff) process.stdout.write('\n' + renderPlanDiffs(scan, options) + '\n');
    if (report.policy) process.stdout.write('\n' + policyModule.renderPolicy(report.policy, options.color) + '\n');
    if (options.json) {
      fs.writeFileSync(options.json, JSON.stringify(exportPayload(scan), null, 2));
      process.stdout.write(`\nJSON export written to ${options.json}\n`);
    }
    if (report.policy && !report.policy.passed) return 1;
    return incomplete.length ? 4 : 0;
  }

  report.historyChanges = writeHistory(scan, options.historyFile);

  process.stdout.write(terminal.renderReport(report, options) + '\n');
  if (report.policy) process.stdout.write('\n' + policyModule.renderPolicy(report.policy, options.color) + '\n');

  if (options.json) {
    fs.writeFileSync(options.json, JSON.stringify({ ...exportPayload(scan), policy: report.policy ? { ...report.policy, file: portablePath(report.policy.file, scan.home) } : null }, null, 2));
    process.stdout.write(`\nJSON export written to ${options.json}\n`);
  }
  if (options.html) {
    // HTML is an export artifact, so it receives the portable discovery view;
    // the terminal may still show the exact files read for local consent.
    fs.writeFileSync(options.html, html.renderHtml({ ...report, discovery: scan.portableDiscovery.clients }));
    process.stdout.write(`\nHTML report written to ${options.html}\n`);
  }
  if (options.sarif) {
    const portableReport = { ...report, discovery: scan.portableDiscovery.clients, policy: report.policy ? { ...report.policy, file: portablePath(report.policy.file, scan.home) } : null };
    fs.writeFileSync(options.sarif, JSON.stringify(sarif.renderSarif(portableReport, { automationId: options.config ? 'config' : 'scan' }), null, 2));
    process.stdout.write(`\nSARIF report written to ${options.sarif}\n`);
  }
  const hint = terminal.pushHint(options);
  if (hint) process.stdout.write(`\n${hint}\n`);

  if (report.policy && !report.policy.passed) return 1;
  if (options.failOn) {
    const threshold = SEVERITY_ORDER[options.failOn];
    const worst = Math.max(0,
      ...inventory.findings.filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status)).map(f => SEVERITY_ORDER[f.severity] || 0),
      ...paths.map(p => SEVERITY_ORDER[p.severity] || 0));
    if (worst >= threshold) return 1;
    if (incomplete.length) return 4;
  }
  if (incomplete.length) return 4;
  return 0;
}

/** The command, then the stored update notice on stderr. A hook stays silent: Claude Code reads its output. */
async function main(argv) {
  const code = await run(argv);
  if (argv[0] !== 'hook') {
    let home = process.env.BOPPI_SCAN_HOME || os.homedir();
    try { home = parseArgs(argv).home; } catch (_) { /* usage error: default home */ }
    updateNotice.announce(home, VERSION);
  }
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`boppi: unexpected error: ${error && error.message ? error.message : error}\n`);
    process.exitCode = 3;
  });
}

module.exports = { run, main, parseArgs, discover, performScan, exportPayload, verifiedReduction, VERSION };
