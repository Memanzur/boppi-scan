#!/usr/bin/env node
/**
 * boppi — local AI agent security scan.
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

const scanner = require('../engine/localMcpScanner');
const Storage = require('../engine/agentSecurityStorage');
const Registry = require('../engine/providerRegistry');
const Controller = require('../engine/scanController');
const securityGraph = require('../engine/securityGraph');
const exposurePathEngine = require('../engine/exposurePathEngine');
const rootCauseEngine = require('../engine/rootCauseEngine');

const { inferCapabilities } = require('./knownServers');
const { createConfigProvider } = require('./provider');
const overlayModule = require('./overlay');
const terminal = require('./render/terminal');
const html = require('./render/html');

const VERSION = require('../../package.json').version;
const CLIENTS = [require('./discovery/claudeDesktop'), require('./discovery/claudeCode'), require('./discovery/cursor')];
const SEVERITY_ORDER = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const COMMANDS = new Set(['scan', 'agents', 'paths']);

function usage() {
  return [
    'Usage: boppi [scan|agents|paths] [options]',
    '',
    '  boppi scan                     discover local AI agent configs, scan, print the full report',
    '  boppi agents                   inventory table only',
    '  boppi paths                    exposure paths only',
    '',
    'Options:',
    '  --json <file>       write the machine-readable export (export v2 schema + exposure paths)',
    '  --html <file>       write a self-contained HTML report',
    '  --only <clients>    limit discovery, e.g. --only claude-desktop,cursor',
    '  --config <path>     scan one explicit config file (skip discovery)',
    '  --source <id>       client type for --config: claude-desktop | claude-code | cursor',
    '  --fail-on <sev>     exit 1 if any finding or path is at/above this severity, 4 if a client could not be analyzed (CI usage)',
    '  --overlay <file>    apply a capability claims file; validated claims add inferred permissions, experimental ones are only reported',
    '  --quiet             one summary line only',
    '  --verbose           all paths, per-server capability provenance',
    '  --no-color          plain-text output (NO_COLOR env is also respected)',
    '  --version, -v       print the version and exit',
    '',
    'Privacy: runs 100% locally. Reads only MCP configuration metadata; secret values,',
    'file contents, and raw path names are never collected. Every file read is listed.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    command: 'scan', json: null, html: null, only: null, config: null, source: 'claude-desktop',
    failOn: null, overlay: null, quiet: false, verbose: false,
    color: !('NO_COLOR' in process.env) && process.stdout.isTTY !== false,
    home: process.env.BOPPI_SCAN_HOME || os.homedir(), cwd: process.cwd(), help: false, version: false,
  };
  const takesValue = new Set(['--json', '--html', '--only', '--config', '--source', '--fail-on', '--home', '--cwd', '--overlay']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (COMMANDS.has(arg)) options.command = arg;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--no-color') options.color = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (takesValue.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      if (arg === '--json') options.json = value;
      else if (arg === '--html') options.html = value;
      else if (arg === '--only') options.only = value.split(',').map(v => v.trim()).filter(Boolean);
      else if (arg === '--config') options.config = value;
      else if (arg === '--source') options.source = value;
      else if (arg === '--fail-on') options.failOn = value;
      else if (arg === '--overlay') options.overlay = value;
      else if (arg === '--home') options.home = value;
      else if (arg === '--cwd') options.cwd = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.failOn && !SEVERITY_ORDER[options.failOn]) throw new Error(`--fail-on must be one of: ${Object.keys(SEVERITY_ORDER).join(', ')}`);
  if (!scanner.supportedSources.includes(options.source)) throw new Error(`--source must be one of: ${scanner.supportedSources.join(', ')}`);
  return options;
}

const ONLY_ALIASES = Object.freeze({
  claude: 'claude-desktop', 'claude-desktop': 'claude-desktop', desktop: 'claude-desktop',
  'claude-code': 'claude-code', code: 'claude-code', cursor: 'cursor',
});

/** Discover config files per client. Missing files are reported, never errors. */
function discover(options) {
  const filesRead = new Set();
  const clients = [];
  const wanted = options.only ? new Set(options.only.map(v => ONLY_ALIASES[v] || v)) : null;

  const descriptors = options.config
    ? [{
        clientKey: options.source, label: `Explicit config (${options.source})`, source: options.source,
        files: [{ path: path.resolve(options.config), scope: 'explicit', extract: json => json.mcpServers || {} }],
      }]
    : CLIENTS.map(m => m.locate({ home: options.home, cwd: options.cwd, platform: process.platform }));

  for (const descriptor of descriptors) {
    if (wanted && !wanted.has(descriptor.clientKey)) continue;
    const client = { clientKey: descriptor.clientKey, label: descriptor.label, source: descriptor.source, files: [], mergedServers: {}, primaryPath: null };
    const seenPaths = new Set();
    for (const file of descriptor.files) {
      const resolved = path.resolve(file.path);
      if (seenPaths.has(resolved)) continue; // user and project config can be the same file
      seenPaths.add(resolved);
      const entry = { path: resolved, scope: file.scope, status: 'not_found', serverCount: 0 };
      if (fs.existsSync(resolved)) {
        try {
          const json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
          filesRead.add(resolved);
          const servers = file.extract(json) || {};
          entry.status = 'found';
          entry.serverCount = Object.keys(servers).length;
          if (!client.primaryPath) client.primaryPath = resolved;
          for (const [name, server] of Object.entries(servers)) {
            const key = client.mergedServers[name] ? `${name} (${file.scope})` : name;
            client.mergedServers[key] = server;
          }
        } catch (_) {
          entry.status = 'unreadable';
          filesRead.add(resolved);
        }
      }
      client.files.push(entry);
    }
    clients.push(client);
  }
  return { clients, filesRead: [...filesRead] };
}

/** Inject catalog-inferred capabilities into a raw config before scanning. */
function enrich(client, options, overlay) {
  const inferenceByServer = {};
  const overlayByServer = {};
  const mcpServers = {};
  for (const [name, server] of Object.entries(client.mergedServers)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const inference = inferCapabilities(name, server, { home: options.home });
    inferenceByServer[name] = inference;
    overlayByServer[name] = overlayModule.matchClaims(overlay, name, server);
    mcpServers[name] = {
      ...server,
      capabilities: inference.capabilities,
      filesystemPaths: inference.filesystemPaths.length ? inference.filesystemPaths : server.filesystemPaths,
    };
  }
  return { config: { mcpServers }, inferenceByServer, overlayByServer };
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

async function run(argv) {
  let options;
  try { options = parseArgs(argv); } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) { process.stdout.write(usage() + '\n'); return 0; }
  if (options.version) { process.stdout.write(VERSION + '\n'); return 0; }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const discovery = discover(options);
  let overlay = null;
  if (options.overlay) {
    try { overlay = overlayModule.loadOverlay(options.overlay); } catch (error) {
      process.stderr.write(`Could not load overlay ${options.overlay}: ${error.message}\n`);
      return 2;
    }
    discovery.filesRead.push(overlay.file);
  }
  const shadow = [];
  const applied = [];
  const providers = [];
  const inferenceByClient = {};
  for (const client of discovery.clients) {
    if (!client.primaryPath) continue; // nothing found for this client
    const { config, inferenceByServer, overlayByServer } = enrich(client, options, overlay);
    inferenceByClient[client.clientKey] = inferenceByServer;
    shadow.push(...shadowEntries(client, overlayByServer));
    for (const [serverName, match] of Object.entries(overlayByServer)) for (const claim of match.validated) applied.push({ client: client.clientKey, server: serverName, package: match.package.name, claimId: claim.id, capability: claim.capability });
    try {
      const scannerResult = scanner.scanConfig({
        source: client.source, consent: true, dryRun: true,
        config, configPath: client.primaryPath, observedAt: startedAt,
      });
      providers.push(createConfigProvider({ clientKey: client.clientKey, label: client.label, scannerResult, inferenceByServer, overlayByServer }));
    } catch (error) {
      client.files.forEach(f => { if (f.status === 'found') { f.status = 'unreadable'; f.reason = error.message; } });
    }
  }

  const controller = Controller.createScanController({
    registry: Registry.createProviderRegistry(providers),
    storage: Storage.createStorage(Storage.memoryAdapter()),
  });
  let inventory = { agents: [], integrations: [], permissions: [], mcpServers: [], findings: [] };
  if (providers.length) {
    const result = await controller.runScan({ requestedBy: 'boppi-cli' });
    if (result.status === 'failed') {
      process.stderr.write(`Scan failed: ${result.error || 'unknown error'}\n`);
      return 3;
    }
    for (const providerResult of result.providerResults || []) {
      if (providerResult.status !== 'failed') continue;
      const client = discovery.clients.find(c => `cli-${c.clientKey}` === providerResult.providerId);
      if (client) client.scanError = providerResult.error || 'provider_failed';
    }
    inventory = result.inventory;
  }
  const incomplete = discovery.clients
    .filter(c => c.scanError || c.files.some(file => file.status === 'unreadable'))
    .map(c => c.label);
  if (incomplete.length) process.stderr.write(`Scan incomplete: ${incomplete.join(', ')} could not be analyzed and are missing from the results.\n`);

  const graph = securityGraph.buildGraph(inventory);
  const paths = exposurePathEngine.findPaths(graph);
  const prioritization = exposurePathEngine.prioritize(paths);
  const rootCauses = rootCauseEngine.clusterRootCauses(graph, paths, { limit: 5 });
  const remediationPlan = rootCauseEngine.recommendRemediationPlan(graph, paths, { severityFloor: 'high' });

  const report = {
    version: VERSION, startedAt, durationMs: Date.now() - startMs,
    discovery: discovery.clients, filesRead: discovery.filesRead,
    inventory, paths, prioritization, rootCauses, remediationPlan, inferenceByClient,
  };

  process.stdout.write(terminal.renderReport(report, options) + '\n');

  if (options.json) {
    const diagnostics = overlay ? { overlay: { file: overlay.file, claimCount: overlay.claimCount, activeCount: overlay.activeCount, rejected: overlay.rejected }, shadow, applied } : { shadow: [], applied: [] };
    const exportPayload = { ...(await controller.getExport()), exposurePaths: paths, prioritization, rootCauses, remediationPlan, discovery: { clients: discovery.clients.map(({ mergedServers, ...rest }) => rest), filesRead: discovery.filesRead }, diagnostics, generatedBy: `boppi-cli/${VERSION}` };
    fs.writeFileSync(options.json, JSON.stringify(exportPayload, null, 2));
    process.stdout.write(`\nJSON export written to ${options.json}\n`);
  }
  if (options.html) {
    fs.writeFileSync(options.html, html.renderHtml(report));
    process.stdout.write(`\nHTML report written to ${options.html}\n`);
  }

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

if (require.main === module) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`boppi: unexpected error: ${error && error.message ? error.message : error}\n`);
    process.exitCode = 3;
  });
}

module.exports = { run, parseArgs, discover, VERSION };
