#!/usr/bin/env node
/** Verify the synthetic browser demo is separate from real configuration scans. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cli = require('../src/cli/boppi');
const demo = require('../src/cli/demo');
const html = require('../src/cli/render/html');

(async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-demo-'));
  const bundle = await demo.buildBundle({ home, cwd: home, platform: 'darwin' }, { performScan: cli.performScan, version: cli.VERSION });
  const page = html.renderDemoHtml(bundle);
  const ok = (name, condition) => { if (!condition) throw new Error(`FAIL: ${name}`); console.log(`  ✓ ${name}`); };
  ok('bundle contains synthetic scenarios', bundle.scenarios.length >= 4 && /synthetic|simulated/i.test(bundle.banner));
  ok('demo page is self-contained and CSP constrained', page.startsWith('<!doctype html>') && page.includes('Content-Security-Policy') && !/<script src=|<link rel|https?:\/\//.test(page.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')));
  ok('demo page embeds no live token or real home path', !page.includes('<meta name="boppi-live"') && !page.includes(os.homedir()));
  ok('demo page uses text rendering for scenario data', page.includes('textContent') && page.includes('Simulated remediation previews'));
  ok('demo page says what Boppi is before asking for exploration', page.indexOf('Boppi reads the MCP server configuration of AI agents such as Claude Desktop, Claude Code, and Cursor') < page.indexOf('Choose a sample environment'));
  const lossy = bundle.scenarios.flatMap(s => s.remediations).find(r => r.loses.length);
  ok('every simulated removal can explain its lost capabilities in plain language', !!lossy && lossy.loses.every(id => bundle.scenarios.some(s => s.view.capabilityLabels && s.view.capabilityLabels[id] && s.view.capabilityLabels[id] !== id)));
  ok('demo client reports simulation results with correct plurals and labels', page.includes("plural(fix.eliminated.length, 'potential path')") && page.includes('capLabel(activeScenario.view, id)') && !page.includes("path(s) removed"));
  const sandboxHome = path.join(home, 'home with spaces');
  const terminal = spawnSync(process.execPath, [path.join(__dirname, '../bin/boppi.js'), 'demo', '--home', sandboxHome, '--cwd', sandboxHome, '--platform', 'darwin', '--no-color'], { encoding: 'utf8' });
  ok('terminal demo offers a fix for the same client as its sandbox', terminal.status === 0 && /boppi fix .*--client claude-desktop .*--source claude-desktop/.test(terminal.stdout));
  const verifyLine = terminal.stdout.split('\n').find(line => /^\s+boppi verify /.test(line)) || '';
  ok('terminal demo quotes its saved scan path when the home has spaces', /boppi verify ["']/.test(verifyLine) && verifyLine.includes(path.join(sandboxHome, '.boppi/demo/scan.json')));
  const realConfig = path.join(sandboxHome, 'Library/Application Support/Claude/claude_desktop_config.json');
  fs.mkdirSync(path.dirname(realConfig), { recursive: true });
  fs.writeFileSync(realConfig, JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } } }));
  const realBefore = fs.readFileSync(realConfig, 'utf8');
  const sandbox = path.join(sandboxHome, '.boppi/demo/mcp.json');
  const bin = path.join(__dirname, '../bin/boppi.js');
  const planned = spawnSync(process.execPath, [bin, 'plan', '--config', sandbox, '--source', 'claude-desktop', '--home', sandboxHome, '--platform', 'darwin', '--no-color'], { encoding: 'utf8' });
  const followUps = planned.stdout.split('\n').filter(line => /boppi (fix|verify) /.test(line));
  ok('every command the sandbox plan suggests carries its --config and --home', followUps.length >= 3 && followUps.every(line => line.includes('--config') && line.includes('--home')));
  const thenLine = (followUps.find(line => line.includes('then: boppi fix --server "github"')) || '').replace(/^\s*then: boppi/, '');
  const applied = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${bin}"${thenLine} --yes --no-color`], { encoding: 'utf8' });
  ok('running the plan\'s suggested fix edits the sandbox, never the real client config', applied.status === 0 && fs.readFileSync(realConfig, 'utf8') === realBefore && !JSON.parse(fs.readFileSync(sandbox, 'utf8')).mcpServers.github);
  ok('the applied fix names an undo command for the same home', applied.stdout.includes('boppi rollback --id') && /undo +boppi rollback --id \S+ --home /.test(applied.stdout));
  fs.rmSync(home, { recursive: true, force: true });
  console.log('\n12 passed, 0 failed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
