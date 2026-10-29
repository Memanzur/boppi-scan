#!/usr/bin/env node
/** Verify suite for AG-06: unrecognized servers get static launch facts that never grade, never run anything, and never leak. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const launchAnalysis = require('../src/cli/launchAnalysis');
const recognition = require('../src/cli/recognition');
const push = require('../src/cli/push');

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

const PLANTED_DIR = 'zebra-planted-dir-4417';
const PLANTED_SECRET = 'sk-PLANTEDsecretVALUE9a8b7c6d5e4f';
const PLANTED_MANIFEST_SECRET = 'ghp_PLANTEDmanifestTOKEN0123456789abcdefXYZ';
const PLANTED_DESCRIPTION = 'zebra-planted-description-9921';

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-unknown-'));
  const home = path.join(root, 'home');
  const project = path.join(home, 'code', PLANTED_DIR, 'notes-mcp');
  fs.mkdirSync(path.join(project, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(project, 'dist', 'index.js'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: '@acme/notes-mcp', version: '1.4.2', description: PLANTED_DESCRIPTION }));
  const leaky = path.join(home, 'Downloads', PLANTED_DIR);
  fs.mkdirSync(leaky, { recursive: true });
  fs.writeFileSync(path.join(leaky, 'server.js'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(leaky, 'package.json'), JSON.stringify({ name: PLANTED_MANIFEST_SECRET.toLowerCase(), version: `1.0.0 ${PLANTED_SECRET}` }));
  const hidden = path.join(home, '.local', 'bin');
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(path.join(hidden, 'mystery-bin'), '#!/bin/sh\n');

  section('Package launchers are read from the config text');
  const launch = server => launchAnalysis.packageLaunch(server);
  ok('npx, uvx and docker keep the catalog identity', launch({ command: 'npx', args: ['-y', 'a-pkg@1.0.0'] }).identity.version === '1.0.0' && launch({ command: 'uvx', args: ['b-pkg'] }).via === 'uvx' && launch({ command: 'docker', args: ['run', '-i', 'img:1'] }).via === 'docker run');
  ok('bunx, pnpm dlx, npm exec, yarn dlx and bun x are npm launches', ['bunx', 'pnpm dlx', 'npm exec', 'yarn dlx', 'bun x'].every(form => { const [command, ...sub] = form.split(' '); const found = launch({ command, args: [...sub, 'some-mcp@2.0.0'] }); return found && found.via === form && found.identity.kind === 'npm' && found.identity.name === 'some-mcp' && found.identity.version === '2.0.0'; }));
  ok('pipx run and uv tool run are PyPI launches', launch({ command: 'pipx', args: ['run', 'py-mcp'] }).identity.kind === 'pypi' && launch({ command: 'uv', args: ['tool', 'run', 'py-mcp==0.3'] }).identity.version === '==0.3');
  ok('uv run and npm run of a local script are not package launches', launch({ command: 'uv', args: ['run', 'server.py'] }) === null && launch({ command: 'uv', args: ['run', 'main', 'server.py'] }) === null && launch({ command: 'npm', args: ['run', 'serve-mcp'] }) === null);
  ok('a url is not a package launch', launch({ url: 'https://example.test/mcp' }) === null);

  section('Locations are enums');
  const where = file => launchAnalysis.locationOf(file, '/Users/me', '/var/folders/xy/T');
  ok('home, Downloads and hidden tool folders', where('/Users/me/code/x.js') === 'home' && where('/Users/me/Downloads/x.js') === 'downloads' && where('/Users/me/.local/bin/x') === 'home_tools');
  ok('installed package folders win over home and system', where('/Users/me/proj/node_modules/x/i.js') === 'installed_package' && where('/usr/local/lib/node_modules/x/i.js') === 'installed_package' && where('/usr/lib/python3/site-packages/x.py') === 'installed_package');
  ok('temporary, system and elsewhere', where('/tmp/x.js') === 'temporary' && where('/var/folders/xy/T/x.js') === 'temporary' && where('/opt/homebrew/bin/x') === 'system' && where('/srv/x.js') === 'elsewhere');

  section('Program facts');
  const facts = server => launchAnalysis.analyze(server, { home, tmpdir: '/nonexistent-tmp' });
  const script = facts({ command: 'node', args: ['--enable-source-maps', path.join(project, 'dist', 'index.js')] });
  ok('a node script is located, found, and its package.json name and version read', script.via === 'node script' && script.program.form === 'script' && script.program.location === 'home' && script.program.exists === true && script.program.manifest.name === '@acme/notes-mcp' && script.program.manifest.version === '1.4.2');
  ok('only name and version leave the manifest', Object.keys(script.program.manifest).sort().join() === 'name,version' && !JSON.stringify(script).includes(PLANTED_DESCRIPTION));
  const missing = facts({ command: 'node', args: ['~/gone/server.js'] });
  ok('a missing script is reported as not found, with no manifest', missing.program.exists === false && missing.program.location === 'home' && missing.program.manifest === null);
  ok('a module, inline code and a relative script have no location to check', facts({ command: 'python3', args: ['-m', 'my_server'] }).program.form === 'module' && facts({ command: 'node', args: ['-e', 'x'] }).via === 'node inline code' && facts({ command: 'python', args: ['server.py'] }).program.location === 'relative');
  ok('a bare command is looked up on PATH, not resolved', facts({ command: 'my-mcp-server' }).program.location === 'path_lookup' && facts({ command: 'my-mcp-server' }).program.exists === null && facts({ command: 'my-mcp-server' }).via === 'command name');
  ok('a program path in a hidden tool folder is found', (() => { const f = facts({ command: path.join(hidden, 'mystery-bin') }); return f.via === 'program path' && f.program.location === 'home_tools' && f.program.exists === true; })());
  ok('a package launch has no program facts', facts({ command: 'bunx', args: ['x-mcp'] }).program === null);
  const unsafe = facts({ command: 'node', args: [path.join(leaky, 'server.js')] });
  ok('a secret-shaped package.json name and a malformed version are dropped', unsafe.program.location === 'downloads' && unsafe.program.manifest === null);
  ok('credential env names are kept, values never', (() => { const f = facts({ command: 'x', env: { NOTES_API_TOKEN: PLANTED_SECRET, LOG_LEVEL: 'debug' } }); return f.credentialEnvNames.join() === 'NOTES_API_TOKEN' && !JSON.stringify(f).includes(PLANTED_SECRET); })());
  const sentence = launchAnalysis.factsSentence(script);
  ok('the sentence labels the facts as config, not run, and not capabilities', sentence.startsWith('From the config, not run: starts with node script') && sentence.includes('the nearest package.json says @acme/notes-mcp 1.4.2') && sentence.endsWith('These facts do not show what it can do.'));

  section('A scan with unknown servers');
  writeDesktop(home, {
    notes: { command: 'node', args: [path.join(project, 'dist', 'index.js')], env: { NOTES_API_TOKEN: PLANTED_SECRET } },
    downloaded: { command: 'node', args: [path.join(leaky, 'server.js'), `--dir=${leaky}`] },
    bunny: { command: 'bunx', args: ['acme-widget-mcp'] },
    mystery: { command: path.join(hidden, 'mystery-bin') },
  });
  const jsonPath = path.join(root, 'export.json');
  const htmlPath = path.join(root, 'report.html');
  const sarifPath = path.join(root, 'report.sarif');
  const scan = runCli(['scan', '--only', 'claude-desktop', '--json', jsonPath, '--html', htmlPath, '--sarif', sarifPath], home);
  ok('scan exits 0', scan.code === 0);
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const by = Object.fromEntries(exported.recognition.map(r => [r.server, r]));
  ok('analysis facts stay unrecognized', ['downloaded', 'bunny', 'mystery'].every(name => by[name].recognized === false && by[name].analysis && by[name].analysis.basis === 'configured'));
  ok('bunx is graded as an unpinned npm launch, not a local program', by.bunny.launcher === 'npm' && by.bunny.pin === 'unpinned' && by.bunny.identity.name === 'acme-widget-mcp' && by.bunny.analysis.via === 'bunx');
  ok('the terminal prints the facts under each unrecognized server', scan.stdout.includes('From the config, not run: starts with node script; the script is in Downloads') && scan.stdout.includes('starts with bunx. These facts do not show what it can do.') && scan.stdout.includes('the program is in a hidden tool folder in your home'));
  ok('PACKAGE PINS now counts the bunx launch', /PACKAGE PINS +1 of 1 package-launched server is unpinned: bunny\./.test(scan.stdout));
  const html = fs.readFileSync(htmlPath, 'utf8');
  ok('HTML shows the facts', html.includes('From the config, not run: starts with node script; the script is in Downloads'));
  const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
  ok('SARIF carries the facts on the unrecognized result', sarif.runs[0].results.some(r => r.ruleId === 'BOPPI-UNRECOGNIZED' && r.message.text.includes('starts with bunx')));
  const { viewFromExport } = require('../src/cli/render/graphData');
  const node = viewFromExport(exported).nodes.find(n => n.kind === 'server' && n.label === 'mystery');
  ok('the interactive view shows launch facts on the node', !!node && node.evidence.some(l => l.title === 'Launch facts' && l.detail.includes('hidden tool folder')));

  section('Grades are unchanged by the facts');
  const unknownIds = new Set(exported.recognition.filter(r => !r.recognized).map(r => r.serverId));
  const unknownCaps = exported.inventory.real.mcpServers.filter(m => unknownIds.has(m.id) && m.name !== 'notes').every(m => !(m.capabilities || []).length);
  ok('servers with only launch facts have no capability', unknownCaps);
  ok('no exposure path touches an unrecognized server without a credential name', exported.exposurePaths.every(p => !JSON.stringify(p).includes(by.bunny.serverId) && !JSON.stringify(p).includes(by.mystery.serverId)));
  const gradeOf = report => JSON.stringify({
    permissions: report.inventory.real.permissions.map(p => [p.integrationId, p.normalizedCategory, p.riskWeight]).sort(),
    paths: report.exposurePaths.map(p => [p.templateId, p.severity]).sort(),
    counts: report.prioritization.counts,
  });
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(leaky, { recursive: true, force: true });
  fs.rmSync(hidden, { recursive: true, force: true });
  const afterPath = path.join(root, 'after.json');
  runCli(['scan', '--only', 'claude-desktop', '--json', afterPath], home);
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
  const afterBy = Object.fromEntries(after.recognition.map(r => [r.server, r]));
  ok('deleting the programs changes the facts', afterBy.mystery.analysis.program.exists === false && afterBy.notes.analysis.program.manifest === null);
  ok('and leaves every permission, path, and count exactly as graded before', gradeOf(after) === gradeOf(exported));

  section('Leak test: planted values never reach exports or push');
  const records = push.toRecords(exported.inventory.real, exported.recognition);
  const surfaces = { json: fs.readFileSync(jsonPath, 'utf8'), html, sarif: fs.readFileSync(sarifPath, 'utf8'), terminal: scan.stdout + scan.stderr, push: JSON.stringify(records) };
  for (const [name, text] of Object.entries(surfaces)) {
    // The terminal names the config file it read, which sits under the home directory; every other surface carries no home path at all.
    ok(`${name}: no planted directory, home path, secret, or manifest text`, !text.includes(PLANTED_DIR) && (name === 'terminal' || !text.includes(home)) && !text.includes(PLANTED_SECRET) && !text.toLowerCase().includes(PLANTED_MANIFEST_SECRET.toLowerCase()) && !text.includes(PLANTED_DESCRIPTION));
  }
  ok('push recognition metadata is still only recognized, pin and launcher', records.filter(r => r.kind === 'mcp_server').every(r => Object.keys(r.metadata.recognition).sort().join() === 'launcher,pin,recognized'));
  ok('push gets no analysis object', !surfaces.push.includes('"analysis"') && !surfaces.push.includes('From the config'));

  section('A clean machine is unchanged');
  const tidy = path.join(root, 'tidy');
  writeDesktop(tidy, { time: { command: 'uvx', args: ['mcp-server-time==0.6.2'] } });
  const tidyScan = runCli(['scan', '--only', 'claude-desktop', '--json', path.join(root, 'tidy.json')], tidy);
  ok('recognized servers carry no analysis', tidyScan.code === 0 && JSON.parse(fs.readFileSync(path.join(root, 'tidy.json'), 'utf8')).recognition.every(r => !('analysis' in r)) && !tidyScan.stdout.includes('From the config, not run'));
  ok('recognition helpers return no sentence for a recognized record', recognition.analysisSentence({ recognized: true }) === '');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
