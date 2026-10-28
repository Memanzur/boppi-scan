#!/usr/bin/env node
/**
 * The push envelope names the scope a scan covered (QA-007). Each coverage
 * client carries the coverage identity the scan computed: an opaque keyed
 * digest of home, project, platform and the files read. The workspace replaces
 * inventory and verifies findings only between scans of the same scope, so a
 * scan of a second project on the same machine must carry a different
 * identity, the same project must carry the same one, and no raw path may ride
 * along. Synthetic homes only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const IDENTITY = /^evidence-v1:[0-9a-f]{64}$/;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-push-scope-')));
const home = path.join(root, 'home');
const projectA = path.join(home, 'code', 'alpha');
const projectB = path.join(home, 'code', 'beta');
fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }));
for (const [dir, server] of [[projectA, 'alpha-files'], [projectB, 'beta-files']]) {
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { [server]: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', dir] } } }));
}
const env = { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_TOKEN: 'bpc_synthetic_test_token_value_0000' };
const cli = (cwd, args) => spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--no-color'], { encoding: 'utf8', env });
const body = (cwd, args = []) => {
  const r = cli(cwd, ['push', '--dry-run', '--url', 'http://127.0.0.1:9', ...args]);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1));
};
const identities = b => Object.fromEntries(b.coverage.clients.map(c => [c.key, c.identity]));

section('a live push names its scope per client');
const a1 = body(projectA), a2 = body(projectA), b1 = body(projectB);
ok('every found client carries a well-formed identity', a1.coverage.clients.filter(c => c.status === 'found').every(c => IDENTITY.test(c.identity || '')) && a1.coverage.clients.some(c => c.key === 'cursor'), JSON.stringify(a1.coverage.clients));
ok('the push is a full snapshot', a1.snapshot === true && a1.coverage.scope === 'full');
ok('the same project gives the same identity', JSON.stringify(identities(a1)) === JSON.stringify(identities(a2)));
ok('another project on the same machine gives a different identity', identities(a1).cursor !== identities(b1).cursor, `${identities(a1).cursor} vs ${identities(b1).cursor}`);
ok('no raw path appears in the coverage envelope', !JSON.stringify(a1.coverage).includes(root) && !JSON.stringify(b1.coverage).includes(root));

section('push --file carries the identity the export recorded, and drops a malformed one');
{
  const file = path.join(root, 'alpha.json');
  cli(projectA, ['scan', '--json', file]);
  const fromFile = body(projectA, ['--file', file]);
  ok('an export pushes the same identities as the live scan', JSON.stringify(identities(fromFile)) === JSON.stringify(identities(a1)), JSON.stringify(identities(fromFile)));
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const clients = doc.coverage.clients;
  for (const c of clients) if (c.identity) c.identity = projectA;
  const edited = path.join(root, 'edited.json');
  fs.writeFileSync(edited, JSON.stringify(doc));
  const r = cli(projectA, ['push', '--file', edited, '--dry-run', '--url', 'http://127.0.0.1:9']);
  const out = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1);
  ok('a raw path in place of the identity is not sent', clients.some(c => c.identity === projectA) && r.status === 0 && !out.includes(projectA) && !out.includes('"identity"'), `exit ${r.status}`);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
