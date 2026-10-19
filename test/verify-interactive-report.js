#!/usr/bin/env node
/** The interactive report's view model (graphData) lines up with the engine's graph, paths, and predictions, and builds from a --json export alone. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const graphData = require('../src/cli/render/graphData');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root) {
  const home = path.join(root, 'home');
  const docs = path.join(home, 'docs');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', docs] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      '1password': { command: 'npx', args: ['-y', '@1password/mcp'], env: { OP_TOKEN: 'SUPERSECRETVALUE' } },
      shell: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
    },
  }, null, 2));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
    projects: { [home]: { mcpServers: { 'project-fetch': { command: 'uvx', args: ['mcp-server-fetch'] } } } },
  }, null, 2));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } } }, null, 2));
  return home;
}

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-interactive-'));
  const home = makeHome(root);
  const jsonPath = path.join(root, 'export.json');
  const scan = runCli(['scan', '--json', jsonPath], home);
  ok('scan exits 0', scan.code === 0);
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  section('Export carries the graph');
  ok('export has graph.nodes and graph.edges', Array.isArray(exported.graph && exported.graph.nodes) && Array.isArray(exported.graph.edges) && exported.graph.nodes.length > 0);
  const nodeIds = new Set(exported.graph.nodes.map(n => n.id));
  const edgeIds = new Set(exported.graph.edges.map(e => e.id));
  ok('every exposure path node resolves to a graph node', exported.exposurePaths.length > 0 && exported.exposurePaths.every(p => p.nodes.every(n => nodeIds.has(n.id))));
  ok('every exposure path edge resolves to a graph edge', exported.exposurePaths.every(p => p.edges.every(e => edgeIds.has(e.id))));
  ok('graph nodes carry no env values or secrets', !JSON.stringify(exported.graph).includes('SUPERSECRETVALUE'));
  ok('scanArgs is null without --config', exported.scanArgs === null);

  section('View model from the export');
  const view = graphData.viewFromExport(exported);
  ok('schemaVersion 1 with the configuration-not-behaviour disclaimer', view.schemaVersion === 1 && view.disclaimer.includes('Not an execution trace') && /not what they did/.test(view.scope));
  ok('one view node per graph node, ids preserved', view.nodes.length === exported.graph.nodes.length && view.nodes.every(n => nodeIds.has(n.id)));
  ok('one view edge per graph edge with from/to', view.edges.length === exported.graph.edges.length && view.edges.every(e => nodeIds.has(e.from) && nodeIds.has(e.to)));
  ok('every node kind is one of the six layers', view.nodes.every(n => graphData.KINDS.includes(n.kind)));
  ok('agents resolve to agent nodes', view.agents.length === 3 && view.agents.every(a => view.nodes.find(n => n.id === a.id && n.kind === 'agent')));
  ok('every non-agent node is owned by an agent', view.nodes.filter(n => n.kind !== 'agent').every(n => view.agents.some(a => a.id === n.agentId)));
  ok('every node has at least one evidence line', view.nodes.every(n => n.evidence.length >= 1 && n.evidence.every(line => line.title && line.detail)));
  ok('configuration observations are labeled configured without changing raw provenance', view.nodes.some(n => n.evidenceClass === 'observed') && view.nodes.filter(n => n.evidenceClass === 'observed').every(n => n.evidenceLabel === 'configured' && n.evidence.some(line => line.detail.includes('source class: observed') && line.detail.includes('not runtime'))));
  ok('inferred provenance remains inferred', view.nodes.filter(n => n.evidenceClass === 'inferred').every(n => n.evidenceLabel === 'inferred'));
  const serverNode = view.nodes.find(n => n.kind === 'server' && n.label === 'filesystem');
  ok('server nodes carry command, trust status, and reached-from evidence', !!serverNode && serverNode.evidence.some(l => l.title === 'Command') && serverNode.evidence.some(l => l.title === 'Trust status') && serverNode.evidence.some(l => l.title === 'Reached from'));
  ok('credential node names the variable, never the value', view.nodes.some(n => n.kind === 'credential' && /OP_TOKEN/.test(n.label)) && !JSON.stringify(view).includes('SUPERSECRETVALUE'));

  section('Paths');
  ok('view paths mirror engine paths one to one', view.paths.length === exported.exposurePaths.length && view.paths.every((p, i) => p.id === exported.exposurePaths[i].id));
  ok('path nodeIds and edgeIds resolve to view nodes and edges', view.paths.every(p => p.nodeIds.every(id => nodeIds.has(id)) && p.edgeIds.every(id => edgeIds.has(id))));
  ok('paths carry severity, confidence, explanation, whyItMatters, and the disclaimer', view.paths.every(p => ['critical', 'high', 'medium', 'low'].includes(p.severity) && typeof p.confidence === 'number' && p.explanation && p.whyItMatters && p.disclaimer));
  ok('nodes on a path carry that path id and its severity', view.paths.every(p => p.nodeIds.every(id => { const n = view.nodes.find(x => x.id === id); return n.pathIds.includes(p.id) && n.severity; })));
  const critical = view.paths.find(p => p.severity === 'critical' && p.remediationIds.length);
  ok('a critical path with one removable route lists at least one remediation', !!critical && critical.remediationIds.length >= 1);
  const twoRoutes = view.paths.find(p => p.templateId === 'EP-A' && p.agentName === 'Claude Code');
  ok('the Claude Code exfiltration path, fed by built-in file access and two network servers, lists no single-server remediation', !!twoRoutes && twoRoutes.remediationIds.length === 0 && twoRoutes.chain.includes('Claude Code built-in file access (Read, Edit, Write)'));

  section('Remediations');
  ok('remediations come from predictions that eliminate at least one path', view.remediations.length > 0 && view.remediations.every(r => r.eliminates.length >= 1 && exported.predictions.some(p => p.predictionId === r.id)));
  const top = view.remediations[0];
  ok('top remediation names the file, the key, and the sanitized entry', top.files.from.length === 1 && top.files.from[0].startsWith('~/') && top.keyPath === `mcpServers.${JSON.stringify(top.server)}` && top.entry && top.entry.command);
  ok('eliminates and survives reference view path ids', [...top.eliminates, ...top.survives].every(id => view.paths.some(p => p.id === id)));
  ok('remediation declares what the agent loses', Array.isArray(top.loses) && top.loses.length >= 1);
  ok('view carries a plain-language label for every capability id it mentions', top.loses.every(id => typeof view.capabilityLabels[id] === 'string' && view.capabilityLabels[id] !== id && !/_access$/.test(view.capabilityLabels[id])) && graphData.capabilityLabel('shell_access') === 'shell access (run commands)' && graphData.capabilityLabel('unknown_thing') === 'unknown_thing');
  ok('server evidence and the inventory table use the plain-language labels', serverNode.evidence.some(l => l.title === 'Capabilities' && /file access \(read and write files\)/.test(l.detail)));
  ok('every remediation on a path points back to that path', view.remediations.every(r => r.eliminates.every(id => view.paths.find(p => p.id === id).remediationIds.includes(r.id))));
  ok('remove_server remediations are not guided; move_server ones are', view.remediations.every(r => r.guided === (r.action === 'move_server')));
  ok('previewHash is a sha256 and changes when the server differs', /^[0-9a-f]{64}$/.test(top.previewHash) && new Set(view.remediations.map(r => r.previewHash)).size === view.remediations.length);
  ok('static command is a boppi fix invocation with the client', top.command === `boppi fix --server ${JSON.stringify(top.server)} --client ${top.clientKey}`);
  ok('plan steps reference remediation ids', view.plan.steps.length >= 1 && view.plan.steps.every(id => view.remediations.some(r => r.id === id)));
  ok('coverage lists the portable files read', view.coverage.filesRead.length >= 3 && view.coverage.filesRead.every(f => f.startsWith('~/')));

  section('Explicit --config scan');
  const explicit = runCli(['scan', '--config', path.join(home, '.cursor', 'mcp.json'), '--source', 'cursor', '--json', path.join(root, 'explicit.json')], home);
  const explicitExport = JSON.parse(fs.readFileSync(path.join(root, 'explicit.json'), 'utf8'));
  ok('scanArgs records the portable config path and source', explicit.code === 0 && explicitExport.scanArgs && explicitExport.scanArgs.config === '~/.cursor/mcp.json' && explicitExport.scanArgs.source === 'cursor');
  const command = graphData.fixCommand({ edit: { server: 'puppeteer' }, client: { key: 'cursor' } }, explicitExport.scanArgs);
  ok('fix command carries --config for a home-relative file', command === 'boppi fix --server "puppeteer" --client cursor --config ~/.cursor/mcp.json --source cursor');
  const outside = graphData.fixCommand({ edit: { server: 'x' }, client: { key: 'cursor' } }, { config: 'path_abc123', source: 'cursor' });
  ok('fix command asks for the file when the path is fingerprinted', /add --config/.test(outside) && !outside.includes('--config path_abc123'));
  const { shellArgument } = require('../src/cli/shell');
  const dangerousName = 'server$(printf BAD)`printf BAD`\'name';
  const quoted = spawnSync('/bin/sh', ['-c', 'printf "%s" ' + shellArgument(dangerousName)], { encoding: 'utf8' });
  ok('copied shell commands preserve literal server names without evaluating substitutions', quoted.status === 0 && quoted.stdout === dangerousName);

  section('Interactive HTML report');
  const htmlPath = path.join(root, 'report.html');
  const htmlRun = runCli(['scan', '--html', htmlPath], home);
  const htmlOut = fs.readFileSync(htmlPath, 'utf8');
  const withoutSvgNamespace = htmlOut.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
  ok('html written, self-contained, with a strict CSP', htmlRun.code === 0 && htmlOut.startsWith('<!doctype html>') && !/<script src=|<link rel|https?:\/\//.test(withoutSvgNamespace) && /Content-Security-Policy" content="default-src 'none'/.test(htmlOut));
  const embedded = htmlOut.match(/<script type="application\/json" id="boppi-data">([\s\S]*?)<\/script>/);
  ok('embedded view model parses', !!embedded && (() => { try { JSON.parse(embedded[1]); return true; } catch (e) { return false; } })());
  const inPage = JSON.parse(embedded[1]);
  ok('embedded nodes, edges, and paths match the export ids', inPage.nodes.length === exported.graph.nodes.length && inPage.paths.length === exported.exposurePaths.length && inPage.paths.every(p => p.nodeIds.every(id => nodeIds.has(id))));
  ok('embedded JSON never contains a raw < or the home path', !embedded[1].includes('<') && !htmlOut.includes(home) && !htmlOut.includes(os.homedir()));
  ok('embedded JSON never contains the secret value', !htmlOut.includes('SUPERSECRETVALUE'));
  ok('page keeps the existing sections', ['What this scan established', 'Discovered MCP servers and capabilities', 'Root cause', 'Potential exposure paths (', 'Findings (', 'Agents (', 'Privacy.'].every(text => htmlOut.includes(text)));
  ok('inventory rows show plain-language capabilities, not raw ids', /<td>file access \(read and write files\)/.test(htmlOut.replace(/<td>[^<]*, /g, '<td>')) && !/<td>[a-z_]*_access(, [a-z_]*_access)*<\/td>/.test(htmlOut));
  ok('client script restores keyboard focus after every rerender and marks selected rows pressed', /function restoreFocus/.test(htmlOut) && /var key = focusKey\(\); renderToolbar\(\)/.test(htmlOut) && /'aria-pressed': state\.path === p\.id/.test(htmlOut));
  ok('narrow screens get a swipe hint for the five-column graph', htmlOut.includes('class="narrow-only"') && /\.narrow-only\{display:none\}/.test(htmlOut) && /\.narrow-only\{display:inline\}/.test(htmlOut));
  ok('page has the graph, path list, panel, and show-in-graph buttons', ['id="graph-svg"', 'id="graph-paths"', 'id="graph-panel"', 'data-show-path="'].every(text => htmlOut.includes(text)));
  ok('page carries the value proposition and the not-an-execution-trace disclaimer', htmlOut.includes('See what your AI agents can access, understand the potential exposure paths, fix dangerous access, and verify that the risk is gone.') && htmlOut.includes('Not an execution trace'));
  ok('static page has no live token meta', !htmlOut.includes('<meta name="boppi-live"'));
  ok('client script is inline and names the four stages', /Preparing backup[\s\S]*Applying change[\s\S]*Rescanning[\s\S]*Verifying/.test(htmlOut) && htmlOut.includes('/api/fix'));

  section('Live mode render');
  const html = require('../src/cli/render/html');
  const cli = require('../src/cli/boppi');
  cli.performScan(cli.parseArgs(['scan', '--home', home, '--cwd', home, '--no-color'])).then(scan => {
    const report = { version: cli.VERSION, startedAt: scan.startedAt, durationMs: scan.durationMs, discovery: scan.portableDiscovery.clients, filesRead: scan.discovery.filesRead, portableFilesRead: scan.portableDiscovery.filesRead, inventory: scan.inventory, graph: scan.graph, paths: scan.paths, prioritization: scan.prioritization, predictions: scan.predictions, remediationPlan: scan.remediationPlan, inferenceByClient: scan.inferenceByClient, incomplete: scan.incomplete, scanArgs: scan.scanArgs };
    const livePage = html.renderHtml(report, { live: { token: 'tok"en<x>' } });
    ok('live render embeds the escaped token in a meta tag', livePage.includes('<meta name="boppi-live" content="tok&quot;en&lt;x&gt;">') && livePage.includes('served by <code>boppi ui</code>'));
    ok('renderHtml without options matches the CLI output shape', html.renderHtml(report).includes('makes no network requests'));
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }).catch(error => { console.error(error); process.exitCode = 1; });
})();
