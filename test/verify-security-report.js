#!/usr/bin/env node
/** First-run security report: score, counts, top risks, JSON, and a clean machine. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { securityScore } = require('../src/cli/securityScore');
const { buildSecurityReport } = require('../src/cli/securityReport');
const VECTOR = require('./fixtures/security-score-vector.json');
const { parseArgs } = require('../src/cli/boppi');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const SECRET = 'sk-ant-plaintexttestvalue123456';
const CLOSING = 'See history, teams and approvals: npx @boppi/cli push';

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed += 1; console.log(`  ✓ ${name}`); } else { failed += 1; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--platform', 'darwin', '--no-color', '--history-file', path.join(home, '..', 'history.json')], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '', ms: Date.now() - started };
}

(function formula() {
  section('Shared security-score vector');
  ok('the vector names the control-plane source', VECTOR.source.includes('lib/risk-score.ts') && VECTOR.cases.length >= 5);
  for (const item of VECTOR.cases) {
    const result = securityScore(item.paths.map(severity => ({ severity })));
    ok(`${item.id} is ${item.score} ${item.grade}`, result.score === item.score && result.grade === item.grade && result.penalty === item.penalty && result.higherIsSafer === true);
  }
  const findingsOnly = buildSecurityReport({
    paths: [],
    inventory: { agents: [], mcpServers: [], findings: [{ severity: 'critical', status: 'open', ruleId: 'AE-006', agentId: 'a' }] },
    predictions: [], discovery: [], credentialNames: [], inlineCredentials: [],
  }, '/tmp');
  ok('a rule finding with no exposure path leaves the score at 100', findingsOnly.score === 100 && findingsOnly.grade === 'A' && findingsOnly.clean === true);
  ok('the penalty is capped at 100', securityScore(Array.from({ length: 40 }, () => ({ severity: 'critical' }))).score === 0);
})();

(function scan() {
  section('First run');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-score-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, '.ssh')] },
      fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch'], env: { OPENAI_API_KEY: SECRET } },
    },
  }));
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });

  const jsonPath = path.join(root, 'report.json');
  const brief = runCli(['scan', '--json', jsonPath], home);
  if (brief.code !== 0) console.log(brief.stderr || brief.stdout);
  ok('scan exits 0 in under 5s', brief.code === 0 && brief.ms < 5000);
  ok('the report leads with a security score and says higher is safer', brief.stdout.includes('Security score') && brief.stdout.includes('/100') && brief.stdout.includes('Higher is safer'));
  ok('counts name tools, servers, and keys', /1 AI tool · 2 tool servers · \d+ exposed key/.test(brief.stdout));
  ok('a top risk names Cursor, ~/.ssh, and the fetch server', brief.stdout.includes('Cursor can read ~/.ssh and reach the internet via the fetch server'));
  ok('the risk has a severity and a real fix command', /CRITICAL\s+Cursor can read ~\/\.ssh/.test(brief.stdout) && brief.stdout.includes('boppi fix --server fetch --client cursor'));
  ok('the report does not say External destination and does not print the secret', !brief.stdout.includes('External destination') && !brief.stdout.includes(SECRET));
  ok('a json export suppresses the closing line', !brief.stdout.includes(CLOSING));

  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const security = exported.securityReport;
  ok('json carries the same score, counts, and risks', security && security.higherIsSafer === true && security.counts.aiTools === 1 && security.counts.toolServers === 2 && security.risks.some(risk => risk.sentence.includes('~/.ssh') && risk.sentence.includes('fetch') && risk.fix === 'boppi fix --server fetch --client cursor' && risk.severity === 'critical'));
  ok('json does not contain the secret or the raw home path', !JSON.stringify(exported).includes(SECRET) && !JSON.stringify(exported).includes(home));
  const fix = security.risks.find(risk => risk.fix && risk.fix.includes('fetch'));
  const fixArgs = fix.fix.replace(/^boppi /, '').split(' ');
  ok('the printed fix command is one the CLI accepts', (() => { try { parseArgs(['fix', ...fixArgs, '--yes']); return true; } catch (_) { return false; } })());

  const plain = runCli([], home);
  ok('boppi with no args prints the same report and ends with the push line', plain.code === 0 && plain.stdout.includes('Security score') && plain.stdout.trimEnd().endsWith(CLOSING) && !plain.stdout.includes('https://app.boppi.io'));

  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const clean = runCli(['scan'], empty);
  ok('a clean machine says there is no risky AI access', clean.code === 0 && clean.stdout.includes('100/100 A') && clean.stdout.includes('No risky AI access found') && clean.stdout.includes('0 AI tools · 0 tool servers · 0 exposed keys'));

  fs.rmSync(root, { recursive: true, force: true });
})();

(function htmlReport() {
  section('HTML report');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-html-'));
  const home = path.join(root, 'home');
  const project = path.join(home, 'project');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const githubToken = 'ghp_FAKE_NOT_A_REAL_TOKEN_000000000000';
  const claudeToken = 'ghp_FAKE_CLAUDE_CODE_TOKEN_000000000000';
  const notionToken = 'ntn_FAKE_NOTION_TOKEN_000000000000';
  const openai = 'sk-FAKE_OPENAI_KEY_000000000000';
  const anthropic = 'sk-ant-FAKE_ANTHROPIC_KEY_0000000000';
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken } },
      puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
    },
  }));
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
      notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: notionToken } },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      'desktop-commander': { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: claudeToken } },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions', allow: ['Bash'] },
  }));
  fs.writeFileSync(path.join(home, '.env'), `OPENAI_API_KEY=${openai}\n`);
  fs.writeFileSync(path.join(home, '.bashrc'), `export ANTHROPIC_API_KEY=${anthropic}\n`);

  const htmlPath = path.join(root, 'report.html');
  const jsonPath = path.join(root, 'report.json');
  const scan = spawnSync(process.execPath, [CLI, 'scan', '--json', jsonPath, '--html', htmlPath, '--home', home, '--cwd', project, '--platform', 'darwin', '--no-color', '--history-file', path.join(root, 'history.json')], { encoding: 'utf8' });
  if (scan.status !== 0) console.log(scan.stderr || scan.stdout);
  ok('demo scan exits 0', scan.status === 0);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const scored = securityScore(exported.exposurePaths);
  ok('demo score matches the terminal formula and is 49 D', scored.score === 49 && scored.grade === 'D' && exported.securityReport.score === 49 && exported.securityReport.grade === 'D');
  ok('HTML prints that score, grade, and higher is safer', html.includes('aria-label="Security score 49/100, grade D. Higher is safer."') && html.includes('class="score-num">49<') && html.includes('class="grade" aria-label="Grade D">D<'));
  ok('HTML verdict names keys, the internet, and the 3 items', html.includes('Your AI tools can reach your keys and the internet. Fix the 3 items below, then tighten the settings that follow.'));
  const found = html.split('id="found"')[1].split('id="technical"')[0];
  ok('provider keys are not listed as an AI tool', !found.includes('Provider keys') && found.includes('Cursor') && found.includes('Claude Desktop') && found.includes('Claude Code'));
  let cursor = 0;
  for (const risk of exported.securityReport.risks) {
    const at = html.indexOf(risk.sentence, cursor);
    ok(`HTML includes the top risk: ${risk.sentence}`, at > cursor);
    cursor = at + 1;
  }
  ok('Claude Code key fix names the config file and the keychain', html.includes('Move GITHUB_PERSONAL_ACCESS_TOKEN out of ~/.claude.json into your OS keychain.'));
  ok('home folder risk tells you to limit the filesystem server', html.includes('Limit the filesystem server to a project folder instead of your home folder.'));
  ok('Cursor key fix names mcp.json', found.includes('Move GITHUB_PERSONAL_ACCESS_TOKEN out of ~/.cursor/mcp.json into your OS keychain.'));
  ok('Claude Code hygiene is in the report', html.includes('Settings to tighten') && html.includes('bypass permission prompts') && html.includes('Bash with no command restriction') && html.includes('Set permissions.defaultMode to default so Claude Code asks before tools run.') && html.includes('Replace the open Bash allow rule with the specific commands you want Claude Code to run.'));
  ok('key names are shown and values are not', found.includes('OPENAI_API_KEY') && found.includes('ANTHROPIC_API_KEY') && found.includes('NOTION_TOKEN') && found.includes('Values are never shown.') && ![githubToken, claudeToken, notionToken, openai, anthropic].some(secret => html.includes(secret)));
  ok('HTML stays on this computer', html.includes('Scanned locally. Nothing left this computer.') && html.includes(CLOSING) && html.includes('href="https://boppi.io"') && html.startsWith('<!doctype html>') && !/<script src=|<link rel|https?:\/\/(?!boppi\.io)/.test(html));
  ok('the page has no em dash or en dash and hides the raw timestamp', !html.includes('\u2014') && !html.includes('\u2013') && !/\d{4}-\d{2}-\d{2}T/.test(html));
  ok('technical details still hold the evidence tables', html.includes('<details class="tech" id="technical">') && html.includes('Potential exposure paths') && html.includes('Privacy.') && html.includes('~/.cursor/mcp.json') && !html.includes(home));
  ok('terminal text for this scan is unchanged aside from the export paths', scan.stdout.includes('49/100 D') && scan.stdout.includes('Higher is safer') && scan.stdout.includes('HYGIENE') && scan.stdout.includes('bypass permission prompts') && scan.stdout.includes('TOP RISKS') && !scan.stdout.includes('Your biggest risks'));

  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  const cleanPath = path.join(root, 'clean.html');
  const clean = spawnSync(process.execPath, [CLI, 'scan', '--html', cleanPath, '--home', empty, '--cwd', empty, '--platform', 'darwin', '--no-color', '--history-file', path.join(root, 'clean-history.json')], { encoding: 'utf8' });
  const cleanHtml = fs.readFileSync(cleanPath, 'utf8');
  ok('clean machine HTML shows 100 A and says no risky AI access', clean.status === 0 && cleanHtml.includes('class="score-num">100<') && cleanHtml.includes('class="grade" aria-label="Grade A">A<') && cleanHtml.includes('No risky AI access found'));
  ok('clean machine HTML says what was checked', /What was checked: \d+ AI tools across \d+ config locations\. None are installed\./.test(cleanHtml));
  ok('clean machine HTML does not invent a risk list', !cleanHtml.includes('Your biggest risks') && !cleanHtml.includes(home) && !cleanHtml.includes('\u2014'));

  fs.rmSync(root, { recursive: true, force: true });
})();

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
