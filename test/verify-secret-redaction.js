#!/usr/bin/env node
/**
 * Secret values in MCP server arguments never reach a report, export or push:
 * a corpus of vendor token formats plus prefix-less high-entropy keys is
 * redacted, ordinary arguments (packages, versions, flags, ports, project
 * names, UUIDs) survive, and Boppi's own path fingerprints are not mistaken
 * for secrets, so re-sanitizing is idempotent. Every token here is synthetic.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const scanner = require('../src/engine/localMcpScanner');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }

const TOKENS = {
  'Google API key': 'AIzaSyA1234567890abcdefghijklmnopqrstuv',
  'GitLab personal token': 'glpat-abcdefghij1234567890',
  'GitHub OAuth token': 'gho_16C7e42F292c6912E7710c838347Ae178B4a',
  'GitHub app token': 'ghs_16C7e42F292c6912E7710c838347Ae178B4a',
  'npm token': 'npm_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  'PyPI token': 'pypi-AgEIcHlwaS5vcmcCJDEyMzQ1Njc4LTkwYWItY2RlZi0xMjM0',
  'Hugging Face token': 'hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
  'xAI key': 'xai-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8',
  'Google OAuth access token': 'ya29.a0AfH6SMBx1y2z3A4b5C6d7E8f9G0h',
  'DigitalOcean token': 'dop_v1_3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a3f9a1c7e5b2d4f6a8c0e1b3d',
  'Shopify token': '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',
  'SendGrid key': 'SG.aBcDeFgHiJkLmNoPq1.rStUvWxYz0123456789aBcD',
  'Stripe webhook secret': 'whsec_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
  'Linear key': 'lin_api_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
  'Notion token': 'ntn_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  'Notion legacy secret': 'secret_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1',
  'Azure storage connection string': 'DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=Zx9Kq2LmN8pR4tV6wY1bC3dE5fG7hJ0kL2mN4pQ6rS8tU0vW2xY4zA6bC8dE0f==',
  'Anthropic key': 'sk-ant-api03-a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6',
  'OpenAI project key': 'sk-proj-a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6',
  'AWS secret access key (no prefix)': 'Zx9Kq2LmN8pR4tV6wY1bC3dE5fG7hJ0kL2mN4pQ6',
  'Slack bot token': 'xoxb-1234567890-0987654321-aBcDeFgHiJkLmNoP',
  'Stripe restricted key': 'rk_live_a1B2c3D4e5F6g7H8i9J0k1L2',
  'generic 40-hex key': '3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a',
  'Twilio key': 'SK3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c2e',
  'Datadog key (32 hex)': 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  'Mailgun key': 'key-3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c2e',
  'private key header': '-----BEGIN RSA PRIVATE KEY-----MIIEowIBAAKCAQEA',
};

const BENIGN = ['-y', '@modelcontextprotocol/server-filesystem', 'mcp-server-fetch', '@modelcontextprotocol/server-everything@2025.1.14',
  '--port=8080', 'python3.11', 'my-gcp-project-123456', '--region=us-east-1', '123e4567-e89b-12d3-a456-426614174000',
  'ghcr.io/github/github-mcp-server', '--transport=stdio', 'server.py', '--log-level=debug', 'chrome-devtools-mcp@latest',
  '@upstash/context7-mcp@1.0.14', 'v20.11.1', 'mcp-remote', 'org.example.server', '--read-only', 'desktop-commander'];

console.log('\nToken formats in positional arguments are redacted');
for (const [label, token] of Object.entries(TOKENS)) {
  const [out] = scanner.sanitizeArguments([token]);
  ok(label, !out.includes(token.slice(-12)) && /redacted/.test(out), out);
}

console.log('\nTokens embedded in a longer argument are redacted');
for (const arg of [`--header=X-Api-Key ${TOKENS['Google API key']}`, `token:${TOKENS['GitLab personal token']}`, `config=${TOKENS['generic 40-hex key']}`]) {
  const [out] = scanner.sanitizeArguments([arg]);
  ok(arg.slice(0, 24), !out.includes(arg.slice(-12)), out);
}

console.log('\nOrdinary arguments survive unchanged');
for (const arg of BENIGN) ok(arg, scanner.sanitizeArguments([arg])[0] === arg, scanner.sanitizeArguments([arg])[0]);

console.log('\nFingerprints are not secrets: sanitizing twice changes nothing');
const once = scanner.sanitizeArguments(['/Users/someone/Documents', '--root=/srv/data', ...BENIGN, ...Object.values(TOKENS)]);
ok('a second pass leaves the first pass unchanged', JSON.stringify(scanner.sanitizeArguments(once)) === JSON.stringify(once), JSON.stringify(once.slice(0, 2)));
ok('path fingerprints stay fingerprints', /^path_[0-9a-f]{16}$/.test(once[0]) && /^--root=path_[0-9a-f]{16}$/.test(once[1]), once.slice(0, 2).join(' '));

console.log('\nWhole scan: no token reaches the terminal, JSON, HTML, SARIF or the push body');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-redaction-'));
fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
const servers = {};
Object.values(TOKENS).forEach((token, i) => { servers[`srv${i}`] = { command: 'npx', args: ['-y', `pkg-${i}`, token] }; });
fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: servers }));
const run = args => spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', env: { ...process.env, BOPPI_TOKEN: 'bpc_synthetic_test_token_value_0000', HOME: home } });
const outputs = {
  terminal: run(['scan']).stdout,
  push: run(['push', '--dry-run', '--url', 'http://127.0.0.1:9']).stdout,
};
for (const [kind, flag] of [['html', '--html'], ['json', '--json'], ['sarif', '--sarif']]) {
  const file = path.join(home, `report.${kind}`);
  run(['scan', flag, file]);
  outputs[kind] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
const body = JSON.parse(outputs.push.slice(outputs.push.indexOf('{'), outputs.push.lastIndexOf('}') + 1));
ok('the client was scanned, not refused: every server is in the push body', body.records.filter(r => r.kind === 'mcp_server').length === Object.keys(TOKENS).length, String(body.records.filter(r => r.kind === 'mcp_server').length));
for (const [where, text] of Object.entries(outputs)) {
  const leaked = Object.entries(TOKENS).filter(([, token]) => text.includes(token.slice(-12))).map(([label]) => label);
  ok(`${where}: produced output and no token appears`, text.length > 200 && leaked.length === 0, leaked.join(', ') || `${text.length} bytes`);
}
fs.rmSync(home, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
