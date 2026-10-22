#!/usr/bin/env node
/** Verify suite for server recognition: unrecognized servers are named in every output, and package launches are graded pinned or unpinned. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const recognition = require('../src/cli/recognition');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
function writeDesktop(home, servers) {
  const file = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }));
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-recognition-'));
  const home = path.join(root, 'home');
  const tools = path.join(home, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(tools, 'notes-server.js'), 'process.exit(0)\n');
  writeDesktop(home, {
    weather: { command: 'npx', args: ['-y', 'weather-mcp-server'] },
    'local-notes': { command: 'node', args: [path.join(tools, 'notes-server.js')] },
    'internal-api': { url: 'https://mcp.internal.example.test/sse' },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2025.8.21', tools] },
    time: { command: 'uvx', args: ['mcp-server-time==0.6.2'] },
    declared: { command: 'node', args: [path.join(tools, 'notes-server.js')], capabilities: ['filesystem_access'] },
    'tagged-image': { command: 'docker', args: ['run', '-i', '--rm', 'mcp/memory:1.0'] },
    'files-by-tools': { command: 'node', args: [path.join(tools, 'notes-server.js')], tools: ['read_file', 'read_multiple_files', 'search_files'] },
  });

  section('Pin grading');
  ok('no version is unpinned', recognition.pinOf('npm', { kind: 'npm', name: 'x', version: null }) === 'unpinned');
  ok('latest and ranges are unpinned', ['latest', '^1.2.0', '~1.2.0', '>=1.0'].every(v => recognition.pinOf('npm', { kind: 'npm', name: 'x', version: v }) === 'unpinned'));
  ok('an exact version, a pypi ==, and a docker digest are pinned', recognition.pinOf('npm', { version: '1.2.3' }) === 'pinned' && recognition.pinOf('pypi', { version: '==0.6.2' }) === 'pinned' && recognition.pinOf('docker', { version: 'sha256:' + 'a'.repeat(64) }) === 'pinned');
  ok('a docker tag is tagged, not pinned: the registry can move it', recognition.pinOf('docker', { version: '1.0' }) === 'tagged' && recognition.pinOf('docker', { version: 'latest' }) === 'unpinned' && recognition.pinOf('docker', { version: null }) === 'unpinned');
  ok('a pypi range is unpinned', recognition.pinOf('pypi', { version: '>=0.6' }) === 'unpinned');
  ok('urls and local programs have no pin', recognition.pinOf('url', null) === 'not_applicable' && recognition.pinOf('local', null) === 'not_applicable');
  ok('local runtimes and bare binaries are local launchers', recognition.launcherOf({ command: 'node', args: [] }, null) === 'local' && recognition.launcherOf({ command: '/opt/tools/server', args: [] }, null) === 'local' && recognition.launcherOf({}, null) === 'unknown');

  section('Terminal report');
  const jsonPath = path.join(root, 'export.json');
  const htmlPath = path.join(root, 'report.html');
  const sarifPath = path.join(root, 'report.sarif');
  const scan = runCli(['scan', '--only', 'claude-desktop', '--json', jsonPath, '--html', htmlPath, '--sarif', sarifPath], home);
  ok('scan exits 0', scan.code === 0);
  ok('unrecognized servers are tagged on their inventory line', scan.stdout.includes('weather · Claude Desktop · capabilities: no supported capability identified · unrecognized · unpinned') && scan.stdout.includes('local-notes · Claude Desktop · capabilities: no supported capability identified · unrecognized'));
  ok('a recognized but unpinned server is tagged unpinned only', scan.stdout.includes('fetch · Claude Desktop · capabilities: network_access, untrusted_external_content · unpinned'));
  ok('a pinned server and a url server carry no tag', /filesystem · Claude Desktop · capabilities: filesystem_access\n/.test(scan.stdout) && /internal-api · Claude Desktop · capabilities: network_access\n/.test(scan.stdout));
  ok('a catalog server with no capability is recognized, not unknown', /time · Claude Desktop · capabilities: no supported capability identified\n/.test(scan.stdout));
  ok('a server with a declared capabilities array is recognized', /declared · Claude Desktop · capabilities: filesystem_access\n/.test(scan.stdout));
  ok('a server whose declared tools map to a category is recognized through them', !scan.stdout.includes('files-by-tools · Claude Desktop · node (local program)') && /files-by-tools · Claude Desktop[^\n]*\n      reach through tools: read files/.test(scan.stdout));
  ok('the UNRECOGNIZED SERVERS section names each server, its launch, and why', scan.stdout.includes('UNRECOGNIZED SERVERS (2)') && scan.stdout.includes('weather · Claude Desktop · weather-mcp-server (npm package, unpinned) · not in the catalog, no name rule matched, no url, no directory argument, no declared capabilities') && scan.stdout.includes('local-notes · Claude Desktop · node (local program) · not in the catalog'));
  ok('the section says unknown is not safe and how to act', scan.stdout.includes('which is not the same as safe') && scan.stdout.includes('"requireKnownCapabilities": true'));
  ok('PACKAGE PINS counts the package launches and names tagged images separately', scan.stdout.includes('PACKAGE PINS  2 of 5 package-launched servers are unpinned: weather, fetch. 1 Docker image runs by tag, not digest: tagged-image.') && scan.stdout.includes('A Docker tag is a moving label'));
  ok('a tagged image is marked on its inventory line, never called pinned', scan.stdout.includes('tagged-image · Claude Desktop · capabilities: no supported capability identified · tagged image') && !/tagged-image[^\n]*pinned/.test(scan.stdout));
  ok('COVERAGE names the unrecognized servers in the not-established line', scan.stdout.includes('Not established: runtime behavior, activity that did not appear in configuration, or access not evidenced by the scanned metadata. What 2 unrecognized servers (weather, local-notes) can do.'));
  ok('the raw script path never appears in the terminal', !scan.stdout.includes(path.join(tools, 'notes-server.js')));

  section('Exports');
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const byServer = Object.fromEntries(exported.recognition.map(r => [r.server, r]));
  ok('the JSON export carries one recognition record per server with its server id', exported.recognition.length === 9 && exported.recognition.every(r => r.serverId && exported.inventory.real.mcpServers.some(m => m.id === r.serverId)));
  ok('records say recognized, launcher, pin, and version', !byServer.weather.recognized && byServer.weather.pin === 'unpinned' && byServer.filesystem.pin === 'pinned' && byServer.filesystem.identity.version === '2025.8.21' && byServer.time.identity.version === '==0.6.2' && byServer['internal-api'].launcher === 'url' && byServer['local-notes'].launcher === 'local' && byServer['local-notes'].pin === 'not_applicable');
  ok('the export never contains the raw script path or the home directory', !JSON.stringify(exported).includes(tools) && !JSON.stringify(exported).includes(home));
  const page = fs.readFileSync(htmlPath, 'utf8');
  ok('the HTML report has a recognition column and an unrecognized servers card', page.includes('<th>Recognition</th>') && page.includes('Unrecognized servers (2)') && page.includes('Package pins:'));
  const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
  const sarifRules = new Set(sarif.runs[0].tool.driver.rules.map(r => r.id));
  const sarifResults = sarif.runs[0].results;
  ok('SARIF declares the unrecognized and unpinned rules and emits one result each per server', sarifRules.has('BOPPI-UNRECOGNIZED') && sarifRules.has('BOPPI-UNPINNED') && sarifResults.filter(r => r.ruleId === 'BOPPI-UNRECOGNIZED').length === 2 && sarifResults.filter(r => r.ruleId === 'BOPPI-UNPINNED').length === 2);
  const { viewFromExport } = require('../src/cli/render/graphData');
  const view = viewFromExport(exported);
  const weatherNode = view.nodes.find(n => n.kind === 'server' && n.label === 'weather');
  ok('the interactive view explains an unrecognized server on its node', !!weatherNode && weatherNode.evidence.some(l => l.title === 'Recognition' && l.detail.startsWith('unrecognized:') && l.detail.includes('not the same as safe')));

  section('A clean catalog-only machine shows no recognition noise');
  const tidy = path.join(root, 'tidy');
  writeDesktop(tidy, { time: { command: 'uvx', args: ['mcp-server-time==0.6.2'] }, filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2025.8.21', tools] } });
  const tidyScan = runCli(['scan', '--only', 'claude-desktop'], tidy);
  ok('no UNRECOGNIZED or PACKAGE PINS section when every server is recognized and pinned', tidyScan.code === 0 && !tidyScan.stdout.includes('UNRECOGNIZED SERVERS') && !tidyScan.stdout.includes('PACKAGE PINS') && !tidyScan.stdout.includes('unrecognized server'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
