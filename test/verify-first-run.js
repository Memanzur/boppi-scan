#!/usr/bin/env node
/** First run on an empty machine and on a machine with tools but no MCP servers. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { summarize } = require('../src/cli/discovery/claudePermissions');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const SECRET = 'sk-ant-should-never-print-1234567890';

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed += 1; console.log(`  ✓ ${name}`); } else { failed += 1; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home) {
  return spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--platform', 'darwin', '--no-color', '--history-file', path.join(home, '..', 'history.json')], { encoding: 'utf8' });
}

section('Permission summary keeps tool names, not secrets or paths');
const summary = summarize({
  permissions: {
    defaultMode: 'bypassPermissions',
    allow: ['Bash', 'Bash(curl -H "Authorization: Bearer ' + SECRET + '")', 'Read(~/.ssh/**)'],
  },
});
ok('bypass mode is recorded', summary.mode === 'bypassPermissions' && summary.unscopedShell === true);
ok('only the tool name is kept from an allow rule', summary.tools.includes('Bash') && summary.tools.includes('Read') && !JSON.stringify(summary).includes(SECRET) && !JSON.stringify(summary).includes('.ssh'));

section('Empty machine');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-first-'));
const empty = path.join(root, 'empty');
fs.mkdirSync(empty);
const emptyRun = runCli(['scan'], empty);
ok('empty scan exits 0', emptyRun.status === 0);
ok('empty scan leads with a safe score and a verdict', emptyRun.stdout.includes('100/100 A') && emptyRun.stdout.includes('Higher is safer') && emptyRun.stdout.includes('No risky AI access found'));
ok('empty scan says what was checked', /Checked \d+ AI tools across \d+ config locations/.test(emptyRun.stdout));
ok('empty scan offers the sample workspace and an html report', emptyRun.stdout.includes('https://beta.boppi.io') && emptyRun.stdout.includes('boppi scan --html'));
ok('empty scan does not print the long coverage essay', !emptyRun.stdout.includes('Not established') && !emptyRun.stdout.includes('not proof that the environment is safe'));
const emptyVerbose = runCli(['scan', '--verbose'], empty);
ok('verbose still states the coverage limit', emptyVerbose.stdout.includes('Not established') && emptyVerbose.stdout.includes('not proof that the environment is safe'));

section('Tools installed, no MCP servers');
const home = path.join(root, 'work');
fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: {} }));
fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
  permissions: { defaultMode: 'bypassPermissions', allow: ['Bash', 'Read(~/.ssh/**)'] },
  env: { OPENAI_API_KEY: SECRET },
}));
fs.writeFileSync(path.join(home, '.zshrc'), `export ANTHROPIC_API_KEY="${SECRET}"\n`);
const typical = runCli(['scan'], home);
if (typical.status !== 0) console.log(typical.stderr);
ok('typical scan exits 0', typical.status === 0);
ok('score stays 100 A when there are no exposure paths', typical.stdout.includes('100/100 A'));
ok('Claude Desktop and Claude Code are named, with no MCP servers', typical.stdout.includes('Claude Desktop') && typical.stdout.includes('Claude Code') && typical.stdout.includes('no MCP servers'));
ok('bypass permissions is a high hygiene finding', typical.stdout.includes('HYGIENE') && typical.stdout.includes('HIGH') && typical.stdout.includes('bypass permission prompts'));
ok('the key name is shown and the value is not', typical.stdout.includes('ANTHROPIC_API_KEY') && !typical.stdout.includes(SECRET) && !typical.stdout.includes('.ssh'));
ok('the verdict mentions the hygiene finding instead of only saying nothing happened', typical.stdout.includes('No exposure paths. Claude Code is set to bypass permission prompts'));
const jsonPath = path.join(root, 'out.json');
runCli(['scan', '--json', jsonPath], home);
const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
ok('json firstRun matches the screen and has no secret', exported.firstRun && exported.firstRun.hygiene.some(item => item.severity === 'high' && item.tool === 'Claude Code') && exported.securityReport.score === 100 && !JSON.stringify(exported).includes(SECRET));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
