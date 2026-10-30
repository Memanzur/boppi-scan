#!/usr/bin/env node
/** Verify suite for plaintext-secret detection: a credential written into a config file is reported by location, never by value. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const scanner = require('../src/engine/localMcpScanner');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }

const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const OPAQUE = 'q8Zr2Lm9Xv4Tn7Pw3Ks6Hd1Fb5Jc0Yg';
const FLAG = 'flagvalue_apikey_test_77';
const PW = 'hunter2-is-a-bad-password';
const values = [GH, OPAQUE, FLAG, PW];

const found = scanner.plaintextExposures(
  { GITHUB_TOKEN: GH, DB_PASSWORD: PW, API_KEY: '${API_KEY}', WIN_TOKEN: '%TOKEN%', VS_TOKEN: '${env:TOKEN}', SECRET: 'your-secret-here', LOG_LEVEL: 'debug', PORT: '8080', DEBUG_TOKEN: 'true' },
  ['-y', 'pkg', '--api-key', FLAG, `--token=${OPAQUE}`, '--token', '$TOKEN', '--port', '8080', '/Users/me/secrets.json'],
);
ok('literal env credentials are found by name', found.some(e => e.location === 'env' && e.name === 'GITHUB_TOKEN') && found.some(e => e.location === 'env' && e.name === 'DB_PASSWORD'));
ok('environment references and placeholders are not plaintext secrets', !found.some(e => ['API_KEY', 'WIN_TOKEN', 'VS_TOKEN', 'SECRET', 'LOG_LEVEL', 'PORT', 'DEBUG_TOKEN'].includes(e.name)));
ok('the value after a credential flag is found by position', found.some(e => e.location === 'argument' && e.position === 3));
ok('a credential after flag= is found by position', found.some(e => e.location === 'argument' && e.position === 4));
ok('a reference after a credential flag and a path naming secrets are not', !found.some(e => e.location === 'argument' && [6, 9].includes(e.position)));
ok('exactly the four plaintext credentials are reported', found.length === 4);
ok('no detection result carries a value', !values.some(v => JSON.stringify(found).includes(v)));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-inline-secrets-'));
try {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: GH } },
      search: { command: 'npx', args: ['-y', 'search-mcp', '--api-key', FLAG] },
      clean: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
    },
    projects: {},
  }));
  const jsonPath = path.join(root, 'report.json');
  const htmlPath = path.join(root, 'report.html');
  const run = spawnSync(process.execPath, [CLI, 'scan', '--json', jsonPath, '--html', htmlPath, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(root, 'history.json')], { encoding: 'utf8' });
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const byName = name => report.inventory.real.mcpServers.find(m => m.name === name);
  ok('the scan report records the plaintext env credential', (byName('github').plaintextExposures || []).some(e => e.name === 'GITHUB_TOKEN'));
  ok('the scan report records the plaintext argument credential', (byName('search').plaintextExposures || []).some(e => e.location === 'argument' && e.position === 3));
  ok('an environment reference is not reported', (byName('clean').plaintextExposures || []).length === 0);
  ok('the terminal report names both servers under PLAINTEXT SECRETS', /PLAINTEXT SECRETS \(2\)/.test(run.stdout) && /github · environment entry GITHUB_TOKEN/.test(run.stdout) && /search · argument 4/.test(run.stdout));
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const [label, body] of [['terminal output', run.stdout + run.stderr], ['JSON report', fs.readFileSync(jsonPath, 'utf8')], ['HTML report', html]]) {
    ok(`no plaintext credential value appears in the ${label}`, !values.some(v => body.includes(v)));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
