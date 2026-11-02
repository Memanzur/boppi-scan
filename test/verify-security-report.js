#!/usr/bin/env node
/** First-run security report: score, counts, top risks, JSON, and a clean machine. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { securityScore } = require('../src/cli/securityScore');
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
  section('Security score formula');
  const none = securityScore([]);
  ok('no findings is 100 A', none.score === 100 && none.grade === 'A' && none.higherIsSafer === true);
  ok('one medium finding is 90 B', securityScore([{ severity: 'medium' }]).score === 90 && securityScore([{ severity: 'medium' }]).grade === 'B');
  ok('one critical finding is 60 C', securityScore([{ severity: 'critical' }]).score === 60 && securityScore([{ severity: 'critical' }]).grade === 'C');
  ok('two criticals is 20 F', securityScore([{ severity: 'critical' }, { severity: 'critical' }]).score === 20 && securityScore([{ severity: 'critical' }, { severity: 'critical' }]).grade === 'F');
  ok('three criticals stay capped at 0 F', securityScore([{ severity: 'critical' }, { severity: 'critical' }, { severity: 'critical' }]).score === 0);
  ok('24 low findings are grade F', securityScore(Array.from({ length: 24 }, () => ({ severity: 'low' }))).grade === 'F');
  ok('one high finding is 75 C', securityScore([{ severity: 'high' }]).score === 75 && securityScore([{ severity: 'high' }]).grade === 'C');
  ok('50 risk points is grade D', securityScore([{ severity: 'high' }, { severity: 'high' }]).score === 50 && securityScore([{ severity: 'high' }, { severity: 'high' }]).grade === 'D');
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
