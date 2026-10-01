#!/usr/bin/env node
/** Verify suite for --overlay: experimental claims change nothing, validated claims add inferred permissions with provenance. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { packageIdentifier, loadOverlay } = require('../src/cli/overlay');
const { inferCapabilities } = require('../src/cli/knownServers');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const T0 = '2026-10-01T00:00:00Z';
const inspectorEvidence = (file, line, text) => ({ kind: 'inspector', file, line, text, contentHash: 'sha256-fixture', registryIntegrity: 'sha512-fixture', observedAt: T0 });
const claim = (id, subject, capability, status, evidence) => ({
  id, scope: 'global', subjectKind: 'npm_package', subject, subjectVersion: '1.0.0', capability, status, source: 'inspector',
  evidence, supporting: 1, contradicting: 0, createdAt: T0, lastValidatedAt: status === 'validated' ? T0 : null, expiresAt: '2027-03-30T00:00:00Z', engineVersionMin: '0.1.0',
});
const READ_CLAIM = claim('claim-ledger-read', '@acme/ledger-sync-mcp', 'read_files', 'validated', [inspectorEvidence('dist/index.js', 42, "fs.readFileSync(target, 'utf8')"), { kind: 'human', actorId: 'reviewer-1', observedAt: T0 }]);
const API_CLAIM = claim('claim-relay-api', '@acme/outbound-relay-mcp', 'call_external_api', 'validated', [inspectorEvidence('src/relay.ts', 17, 'await fetch(url, { method: "POST" })'), { kind: 'human', actorId: 'reviewer-1', observedAt: T0 }]);
const SHELL_SHADOW = claim('claim-ledger-shell', '@acme/ledger-sync-mcp', 'run_shell_commands', 'experimental', [inspectorEvidence('dist/index.js', 88, "execSync('git status')")]);
const NO_EVIDENCE = { ...claim('claim-bad-no-evidence', '@acme/ledger-sync-mcp', 'execute_code', 'validated', []), evidence: [] };
const LLM_ONLY = claim('claim-bad-llm', '@acme/outbound-relay-mcp', 'execute_code', 'validated', [{ kind: 'llm', model: 'none', observedAt: T0 }]);

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function scanWith(root, name, overlayClaims) {
  const config = path.join(root, 'config.json');
  const out = path.join(root, `${name}.json`);
  const args = ['scan', '--config', config, '--source', 'claude-desktop', '--json', out, '--quiet'];
  if (overlayClaims) {
    const overlayPath = path.join(root, `${name}-overlay.json`);
    fs.writeFileSync(overlayPath, JSON.stringify({ claims: overlayClaims }, null, 2));
    args.push('--overlay', overlayPath);
  }
  const result = runCli(args, root);
  return { result, exported: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-overlay-verify-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    mcpServers: {
      ledger: { command: 'npx', args: ['-y', '@acme/ledger-sync-mcp@1.0.0'] },
      relay: { command: 'npx', args: ['-y', '@acme/outbound-relay-mcp'] },
    },
  }));

  section('Package identifier extraction');
  ok('npx -y <pkg>', packageIdentifier({ command: 'npx', args: ['-y', '@acme/ledger-sync-mcp'] }).name === '@acme/ledger-sync-mcp');
  ok('pinned version is stripped and kept', (() => { const p = packageIdentifier({ command: 'npx', args: ['-y', '@acme/ledger-sync-mcp@1.2.3'] }); return p.name === '@acme/ledger-sync-mcp' && p.version === '1.2.3'; })());
  ok('npm exec form', packageIdentifier({ command: 'npm', args: ['exec', '--', 'some-mcp'] }).name === 'some-mcp');
  ok('uvx is a pypi package, not npm', packageIdentifier({ command: 'uvx', args: ['mcp-server-fetch'] }).kind === 'pypi_package');
  ok('a plain node script is not a package', packageIdentifier({ command: 'node', args: ['/opt/server.js'] }) === null);

  section('Overlay loading rejects claims without usable evidence');
  const overlayPath = path.join(root, 'load-overlay.json');
  fs.writeFileSync(overlayPath, JSON.stringify({ claims: [READ_CLAIM, SHELL_SHADOW, NO_EVIDENCE, LLM_ONLY] }));
  const loaded = loadOverlay(overlayPath);
  ok('claims with evidence load', loaded.activeCount === 2);
  ok('a claim without evidence is rejected', loaded.rejected.some(r => r.id === 'claim-bad-no-evidence' && /evidence/.test(r.error)));
  ok('an llm-only claim marked validated is rejected', loaded.rejected.some(r => r.id === 'claim-bad-llm' && /llm/.test(r.error)));

  section('Catalog says nothing about the fixture packages');
  const catalog = ['@acme/ledger-sync-mcp', '@acme/outbound-relay-mcp'].map(name => inferCapabilities('server', { command: 'npx', args: ['-y', name] }, { home: root }));
  ok('no catalog rule matches either package', catalog.every(c => c.inferences.length === 0));

  section('Baseline scan without overlay');
  const base = scanWith(root, 'base', null);
  ok('baseline scan exits 0', base.result.code === 0 && base.exported);
  const basePermissions = base.exported.inventory.real.permissions;
  ok('baseline derives no permissions', basePermissions.length === 0);
  ok('baseline has no EP-A path', !base.exported.exposurePaths.some(p => p.templateId === 'EP-A'));
  ok('baseline export has empty shadow diagnostics', Array.isArray(base.exported.diagnostics.shadow) && base.exported.diagnostics.shadow.length === 0);

  section('Experimental claim runs in shadow and changes nothing');
  const shadow = scanWith(root, 'shadow', [SHELL_SHADOW]);
  ok('shadow scan exits 0', shadow.result.code === 0 && shadow.exported);
  ok('permissions unchanged', shadow.exported.inventory.real.permissions.length === basePermissions.length);
  ok('paths unchanged', JSON.stringify(shadow.exported.exposurePaths.map(p => p.id).sort()) === JSON.stringify(base.exported.exposurePaths.map(p => p.id).sort()));
  const shadowEntry = shadow.exported.diagnostics.shadow[0];
  ok('shadow entry names the claim, server, package, and capability', shadowEntry && shadowEntry.claimId === 'claim-ledger-shell' && shadowEntry.server === 'ledger' && shadowEntry.package === '@acme/ledger-sync-mcp' && shadowEntry.capability === 'run_shell_commands');
  ok('shadow entry cites the evidence line', shadowEntry && shadowEntry.evidence === 'dist/index.js:88');
  ok('overlay file is listed among files read', shadow.exported.discovery.filesRead.some(f => f.endsWith('shadow-overlay.json')));

  section('Validated claim adds an inferred permission with provenance');
  const one = scanWith(root, 'one', [READ_CLAIM]);
  const added = one.exported.inventory.real.permissions.find(p => p.normalizedCategory === 'read_files');
  ok('read_files permission added', !!added);
  ok('evidence class is inferred, never observed', added && added.source.evidenceClass === 'inferred');
  ok('normalization confidence is 0.7', added && added.normalizationConfidence === 0.7);
  ok('reason cites the claim id and evidence file:line', added && added.normalizationReason.includes('claim-ledger-read') && added.normalizationReason.includes('dist/index.js:42'));
  ok('permission source id carries the claim id', added && added.source.id === 'overlay-claim:claim-ledger-read');
  ok('applied diagnostics list the claim', one.exported.diagnostics.applied.some(a => a.claimId === 'claim-ledger-read' && a.server === 'ledger'));
  ok('one validated claim alone yields no EP-A', !one.exported.exposurePaths.some(p => p.templateId === 'EP-A'));

  section('Bad overlay input');
  fs.writeFileSync(path.join(root, 'broken.json'), '{ nope');
  const broken = runCli(['scan', '--config', path.join(root, 'config.json'), '--source', 'claude-desktop', '--overlay', path.join(root, 'broken.json'), '--quiet'], root);
  ok('unreadable overlay exits 2 with a message', broken.code === 2 && /overlay/i.test(broken.stderr));

  console.log(`\nOverlay checks: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
