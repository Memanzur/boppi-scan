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
const CLOSING = 'See history, teams and approvals: npx boppi push';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
