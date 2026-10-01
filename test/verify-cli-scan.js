#!/usr/bin/env node
/** Verify suite for the boppi CLI (bin/boppi.js): discovery, engine reuse, report, exports, exit codes. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeFixtureHome(root) {
  const home = path.join(root, 'home');
  const docs = path.join(home, 'docs');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', docs] },
      fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch'] },
      'code-runner': { command: 'npx', args: ['-y', 'e2b-code-interpreter'], env: { E2B_API_KEY: 'SUPERSECRETVALUE' } },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'SUPERSECRETVALUE' } } },
    projects: {},
  }));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: {
      puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
      commander: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
    },
  }));
  return home;
}

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-cli-verify-'));
  const home = makeFixtureHome(root);

  section('Discovery and full scan report');
  const jsonPath = path.join(root, 'export.json');
  const htmlPath = path.join(root, 'report.html');
  const scan = runCli(['scan', '--json', jsonPath, '--html', htmlPath], home);
  ok('scan exits 0 without --fail-on', scan.code === 0);
  ok('all three clients are discovered', ['Claude Desktop', 'Claude Code', 'Cursor'].every(label => scan.stdout.includes(label)));
  ok('missing project config is reported as not found, not an error', scan.stdout.includes('.mcp.json') && scan.stdout.includes('not found'));
  ok('inventory counts 3 agents and 6 MCP servers', scan.stdout.includes('3 agents') && scan.stdout.includes('6 MCP servers'));
  ok('exposure paths include data exfiltration (EP-A)', scan.stdout.includes('EP-A'));
  ok('exposure paths include credential exposure (EP-B)', scan.stdout.includes('EP-B'));
  ok('exposure paths include privilege path (EP-E)', scan.stdout.includes('EP-E'));
  ok('rule-engine findings appear (AE rules)', /AE-\d{3}/.test(scan.stdout));
  ok('report explains inference honestly', scan.stdout.includes('inferred from evidenced identity'));
  ok('root-cause section names the single highest-leverage fix', scan.stdout.includes('ROOT CAUSE') && /breaks \d+ of \d+ exposure/.test(scan.stdout));
  ok('minimal remediation plan is shown', scan.stdout.includes('Full plan to break all'));

  section('Privacy footer lists exactly the files read');
  const expectedFiles = [
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.claude.json'),
    path.join(home, '.cursor', 'mcp.json'),
  ];
  ok('every read file is listed', expectedFiles.every(f => scan.stdout.includes(f)));
  const listedCount = (scan.stdout.split('PRIVACY')[1] || '').split('\n').filter(l => l.trim().startsWith('- ')).length;
  ok('no extra files are listed', listedCount === expectedFiles.length);
  ok('privacy statement is present', scan.stdout.includes('nothing left this machine'));

  section('JSON export (export v2 schema + exposure paths)');
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  ok('export uses schema exportVersion 2', exported.exportVersion === 2);
  const engineVersion = require('../src/engine/models').ENGINE_VERSION;
  ok('export is stamped with the engine version', /^\d+\.\d+\.\d+$/.test(engineVersion) && exported.engineVersion === engineVersion);
  ok('every exposure path carries the engine version', exported.exposurePaths.length > 0 && exported.exposurePaths.every(p => p.engineVersion === engineVersion));
  ok('every finding carries the engine version', exported.inventory.real.findings.length > 0 && exported.inventory.real.findings.every(f => f.engineVersion === engineVersion));
  ok('export contains 3 real agents', exported.inventory.real.agents.length === 3);
  ok('export contains exposure paths with template ids', Array.isArray(exported.exposurePaths) && ['EP-A', 'EP-B', 'EP-E'].every(id => exported.exposurePaths.some(p => p.templateId === id)));
  ok('export findings include AE-002 (credential exposure)', exported.inventory.real.findings.some(f => f.ruleId === 'AE-002'));
  ok('export prioritization has severity counts', exported.prioritization && typeof exported.prioritization.counts.critical === 'number');
  ok('export includes root causes with verified elimination counts', exported.rootCauses && exported.rootCauses.causes.length > 0 && typeof exported.rootCauses.causes[0].eliminatedCount === 'number');
  ok('export includes a remediation plan that breaks the targeted paths', exported.remediationPlan && typeof exported.remediationPlan.breaksAll === 'boolean');

  section('Predictions: every count comes from a rescan without the server');
  const predictions = exported.predictions;
  const PREDICTION_FIELDS = ['schemaVersion', 'predictionId', 'engineVersion', 'scannerVersion', 'createdAt', 'client', 'agentId', 'configFingerprint', 'edit', 'serverId', 'before', 'predictedEliminated', 'predictedSurviving', 'inventoryHash'];
  ok('export carries predictions', Array.isArray(predictions) && predictions.length > 0);
  ok('every prediction has the documented shape', predictions.every(p => PREDICTION_FIELDS.every(f => f in p) && p.schemaVersion === 1 && p.engineVersion === engineVersion && p.scannerVersion === exported.generatedBy.split('/')[1] && p.edit.action === 'remove_server' && typeof p.edit.server === 'string' && /^path_[0-9a-f]{16}$/.test(p.configFingerprint) && /^inventory_[0-9a-f]{16}$/.test(p.inventoryHash)));
  ok('eliminated and surviving partition the before set', predictions.every(p => [...p.predictedEliminated, ...p.predictedSurviving].sort().join() === [...p.before.exposureKeys].sort().join() && !p.predictedEliminated.some(k => p.predictedSurviving.includes(k))));
  const keysByAgent = agentId => exported.exposurePaths.filter(x => x.agentId === agentId).map(x => x.exposureKey).sort();
  ok('a prediction\'s before set is the agent\'s scanned exposures', predictions.every(p => p.before.exposureKeys.join() === keysByAgent(p.agentId).join()));
  const exportedGraph = require('../src/engine/securityGraph').buildGraph(exported.inventory.real);
  const pathNodeIds = new Set(exported.exposurePaths.flatMap(x => x.nodes.map(n => n.id)));
  const involvedIds = new Set([...pathNodeIds, ...exportedGraph.edges.filter(e => pathNodeIds.has(e.toEntityId)).map(e => e.fromEntityId)]);
  const participating = exported.inventory.real.mcpServers.filter(m => involvedIds.has(m.id) || exported.inventory.real.permissions.some(q => q.integrationId === m.id && involvedIds.has(q.id)));
  ok('exactly one prediction per server that takes part in a path', participating.length > 0 && participating.length === predictions.length && participating.every(m => predictions.some(p => p.serverId === m.id && p.edit.server === m.name)));
  ok('a server with no exposure of its own gets no prediction', !predictions.some(p => p.edit.server === 'github'));
  const fetchPrediction = predictions.find(p => p.edit.server === 'fetch');
  ok('removing fetch from the desktop fixture breaks all three of its exposures', fetchPrediction && fetchPrediction.predictedEliminated.length === 3 && fetchPrediction.predictedSurviving.length === 0);
  const filesystemPrediction = predictions.find(p => p.edit.server === 'filesystem');
  ok('removing filesystem breaks only the exfiltration exposure', filesystemPrediction && filesystemPrediction.predictedEliminated.length === 1 && filesystemPrediction.predictedEliminated[0].startsWith('EP-A:'));
  const topCount = Math.max(...predictions.map(p => p.predictedEliminated.length));
  ok('the terminal root cause states the top prediction\'s count over all exposures', scan.stdout.includes(`breaks ${topCount} of ${exported.exposurePaths.length} exposures`));
  ok('the remediation plan is built from predictions and covers every high-or-critical exposure', exported.remediationPlan.breaksAll === true && exported.remediationPlan.steps.every(st => predictions.some(p => p.predictionId === st.predictionId)) && exported.remediationPlan.steps.reduce((n, st) => n + st.breaksCount, 0) === exported.remediationPlan.targetedExposures);
  ok('export records discovery provenance', Array.isArray(exported.discovery.filesRead) && exported.discovery.filesRead.length === 3);
  const serverIds = new Map(exported.inventory.real.mcpServers.map(m => [m.id, m]));
  const permissions = exported.inventory.real.permissions;
  ok('every derived permission points at the server record it came from', permissions.length > 0 && permissions.every(p => serverIds.has(p.integrationId) && serverIds.get(p.integrationId).agentId === p.agentId));
  ok('every scanned server with capabilities owns at least one permission', exported.inventory.real.mcpServers.filter(m => m.capabilities.length).every(m => permissions.some(p => p.integrationId === m.id)));
  const serialized = JSON.stringify(exported);
  ok('secret env values never appear in the export', !serialized.includes('SUPERSECRETVALUE'));
  ok('raw filesystem paths are fingerprinted in MCP records', !JSON.stringify(exported.inventory.real.mcpServers).includes(path.join(home, 'docs')));

  section('Export carries no raw filesystem paths');
  ok('discovery file paths are ~-relative under the scanned home', exported.discovery.filesRead.every(f => f.startsWith('~/')) && exported.discovery.clients.every(c => c.files.every(f => f.path.startsWith('~/')) && (c.primaryPath === null || c.primaryPath.startsWith('~/'))));
  ok('the Claude Desktop config is listed by its ~ path', exported.discovery.filesRead.includes('~/Library/Application Support/Claude/claude_desktop_config.json'));
  ok('the export never contains the scanned home directory', !serialized.includes(home));
  ok('the export never contains the real home directory or username', !serialized.includes(os.homedir()) && !serialized.includes(os.userInfo().username));
  ok('discovery block has no mergedServers (raw config) payload', exported.discovery.clients.every(c => !('mergedServers' in c)));

  section('Deterministic identity across runs');
  const jsonPath2 = path.join(root, 'export2.json');
  runCli(['scan', '--json', jsonPath2], home);
  const exported2 = JSON.parse(fs.readFileSync(jsonPath2, 'utf8'));
  const ids = e => ({
    agents: e.inventory.real.agents.map(a => a.id).sort(),
    findings: e.inventory.real.findings.map(f => f.id).sort(),
    paths: e.exposurePaths.map(p => p.id).sort(),
  });
  ok('agent ids are stable across runs', JSON.stringify(ids(exported).agents) === JSON.stringify(ids(exported2).agents));
  ok('finding ids are stable across runs', JSON.stringify(ids(exported).findings) === JSON.stringify(ids(exported2).findings));
  ok('path ids are stable across runs', JSON.stringify(ids(exported).paths) === JSON.stringify(ids(exported2).paths));
  ok('prediction ids are stable across runs', JSON.stringify(exported.predictions.map(p => p.predictionId).sort()) === JSON.stringify(exported2.predictions.map(p => p.predictionId).sort()));
  ok('inventory hashes are stable across runs', JSON.stringify(exported.predictions.map(p => p.inventoryHash).sort()) === JSON.stringify(exported2.predictions.map(p => p.inventoryHash).sort()));

  section('HTML report');
  const htmlOut = fs.readFileSync(htmlPath, 'utf8');
  ok('HTML report is written and self-contained', htmlOut.startsWith('<!doctype html>') && !/<script src=|<link rel/.test(htmlOut));
  ok('HTML report includes paths and privacy section', htmlOut.includes('Potential exposure paths') && htmlOut.includes('Privacy.'));
  ok('HTML report lists files read by ~ path and never the home directory', htmlOut.includes('~/.cursor/mcp.json') && !htmlOut.includes(home) && !htmlOut.includes(os.homedir()));
  ok('HTML root cause states the same honest count as the terminal', htmlOut.includes(`Breaks <b>${topCount} of ${exported.exposurePaths.length}</b> exposures`));

  section('Subcommands and filters');
  const agentsOnly = runCli(['agents'], home);
  ok('agents subcommand prints inventory without paths section', agentsOnly.stdout.includes('AGENTS (3)') && !agentsOnly.stdout.includes('EXPOSURE PATHS'));
  const pathsOnly = runCli(['paths'], home);
  ok('paths subcommand prints paths without findings section', pathsOnly.stdout.includes('EXPOSURE PATHS') && !pathsOnly.stdout.includes('FINDINGS ('));
  const onlyCursor = runCli(['scan', '--only', 'cursor'], home);
  ok('--only cursor limits the scan to one agent', onlyCursor.stdout.includes('1 agent ') && !onlyCursor.stdout.includes('Claude Desktop'));
  const quiet = runCli(['scan', '--quiet'], home);
  ok('--quiet prints a compact summary', quiet.stdout.trim().split('\n').length <= 2 && quiet.stdout.includes('3 agents'));

  section('Explicit --config mode');
  const explicit = runCli(['scan', '--config', path.join(home, '.cursor', 'mcp.json'), '--source', 'cursor'], home);
  ok('explicit config scan works', explicit.code === 0 && explicit.stdout.includes('1 agent '));
  ok('explicit config reports its file in the privacy footer', explicit.stdout.includes(path.join(home, '.cursor', 'mcp.json')));
  const outsideHome = path.join(root, 'outside.json');
  fs.copyFileSync(path.join(home, '.cursor', 'mcp.json'), outsideHome);
  const outsideJson = path.join(root, 'outside-export.json');
  runCli(['scan', '--config', outsideHome, '--source', 'cursor', '--json', outsideJson, '--quiet'], home);
  const outsideExport = JSON.parse(fs.readFileSync(outsideJson, 'utf8'));
  ok('a config outside the home directory is fingerprinted in the export', outsideExport.discovery.filesRead.length === 1 && /^path_[0-9a-f]{16}$/.test(outsideExport.discovery.filesRead[0]) && !JSON.stringify(outsideExport).includes(root));

  section('Exit codes (--fail-on and errors)');
  ok('--fail-on critical exits 1 when critical exposure exists', runCli(['scan', '--fail-on', 'critical', '--quiet'], home).code === 1);
  const emptyHome = path.join(root, 'empty-home');
  fs.mkdirSync(emptyHome, { recursive: true });
  const emptyRun = runCli(['scan', '--fail-on', 'critical', '--quiet'], emptyHome);
  ok('--fail-on critical exits 0 on a clean machine', emptyRun.code === 0);
  ok('clean machine reports zero agents without failing', runCli(['scan'], emptyHome).code === 0);
  ok('unknown --fail-on value exits 2', runCli(['scan', '--fail-on', 'apocalyptic'], home).code === 2);
  ok('unknown argument exits 2 with usage', runCli(['--frobnicate'], home).code === 2);

  section('Unreadable config is a note, not a crash');
  const brokenHome = path.join(root, 'broken-home');
  fs.mkdirSync(path.join(brokenHome, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(brokenHome, '.cursor', 'mcp.json'), '{ not json');
  const broken = runCli(['scan'], brokenHome);
  ok('invalid JSON config is reported and skipped', broken.code === 4 && broken.stdout.includes('could not be scanned (invalid JSON)'));

  section('Server names that resemble secret keys still scan');
  const vaultHome = path.join(root, 'vault-home');
  fs.mkdirSync(path.join(vaultHome, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(vaultHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      '1password': { command: 'npx', args: ['-y', '@1password/mcp'] },
      'desktop-commander': { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    },
  }));
  const vault = runCli(['scan', '--only', 'claude-desktop'], vaultHome);
  ok('a server named 1password does not drop the Claude Desktop agent', vault.code === 0 && vault.stdout.includes('1 agent ') && vault.stdout.includes('3 MCP servers'));
  const credentialPath = (vault.stdout.split('EP-B')[1] || '').split('\n')[1] || '';
  ok('credential exposure path (EP-B) through 1password is reported', credentialPath.includes('1password') && credentialPath.includes('access credentials'));
  ok('no client is reported as missing from the results', !vault.stdout.includes('analysis failed') && !vault.stderr.includes('Scan incomplete'));
  const secretName = path.join(root, 'secret-name-home');
  fs.mkdirSync(path.join(secretName, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(secretName, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { 'sk-abcdefghijklmnopqrstuv': { command: 'npx', args: ['-y', 'x'] } } }));
  const rejected = runCli(['scan', '--only', 'cursor'], secretName);
  ok('a config rejected by the sanitizer shows the reason instead of "invalid JSON"', rejected.code === 4 && rejected.stdout.includes('could not be scanned (') && rejected.stdout.includes('secret material'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
