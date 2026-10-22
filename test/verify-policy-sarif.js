#!/usr/bin/env node
/** A policy file turns configuration facts into violations with a non-zero exit; SARIF carries paths, findings, and violations. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      commander: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
      mystery: { command: 'node', args: ['server.js'] },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } } }));
  return home;
}

function runCli(args, home, cwd = home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-policy-'));
  const home = makeHome(root);
  const policyFile = path.join(root, 'policy.json');
  fs.writeFileSync(policyFile, JSON.stringify({
    version: 1,
    failOn: 'critical',
    denyServers: ['desktop-commander', '/^nothing-matches$/'],
    denyCombinations: [['filesystem_access', 'network_access']],
    requireKnownCapabilities: true,
  }));

  section('violations');
  const run = runCli(['scan', '--policy', policyFile, '--json', path.join(root, 'export.json'), '--sarif', path.join(root, 'report.sarif')], home);
  ok('a violated policy exits 1 and prints the POLICY section', run.code === 1 && run.stdout.includes('POLICY') && /\d+ violations/.test(run.stdout));
  ok('a denied server is reported', run.stdout.includes('POL-DENY-SERVER') && run.stdout.includes('"commander"'));
  ok('a denied capability combination is reported per agent', run.stdout.includes('POL-DENY-COMBINATION') && run.stdout.includes('filesystem_access and network_access'));
  ok('a server with no inferred capability is reported when the policy requires recognition', run.stdout.includes('POL-UNKNOWN-SERVER') && run.stdout.includes('"mystery"'));
  ok('a critical path trips failOn', run.stdout.includes('POL-SEVERITY'));
  const exported = JSON.parse(fs.readFileSync(path.join(root, 'export.json'), 'utf8'));
  ok('the export carries the policy result with a portable file reference', exported.policy && exported.policy.passed === false && exported.policy.violations.length >= 4 && !exported.policy.file.includes(root));
  ok('violations are ordered by severity then rule', exported.policy.violations.every((v, i, all) => i === 0 || ({ low: 1, medium: 2, high: 3, critical: 4 })[all[i - 1].severity] >= ({ low: 1, medium: 2, high: 3, critical: 4 })[v.severity]));

  section('SARIF');
  const log = JSON.parse(fs.readFileSync(path.join(root, 'report.sarif'), 'utf8'));
  const runObj = log.runs && log.runs[0];
  ok('SARIF 2.1.0 envelope with one run and the boppi driver', log.version === '2.1.0' && log.$schema.includes('sarif-2.1.0') && runObj && runObj.tool.driver.name === 'boppi' && runObj.tool.driver.version === exported.generatedBy.split('/')[1]);
  const ruleIds = new Set(runObj.tool.driver.rules.map(r => r.id));
  ok('rules cover every exposure template and every violated policy rule', ['EP-A', 'EP-B', 'EP-C', 'EP-D', 'EP-E', 'EP-F'].every(id => ruleIds.has(id)) && ruleIds.has('POL-DENY-SERVER') && ruleIds.has('POL-DENY-COMBINATION'));
  ok('every result references a declared rule and a config location', runObj.results.length > 0 && runObj.results.every(r => ruleIds.has(r.ruleId) && r.locations[0].physicalLocation.artifactLocation.uri));
  const openFindings = exported.inventory.real.findings.filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status));
  const recognitionResults = exported.recognition.filter(r => !r.recognized).length + exported.recognition.filter(r => r.pin === 'unpinned').length;
  ok('results are the paths, the open findings, the violations, and the unrecognized or unpinned servers', runObj.results.length === exported.exposurePaths.length + openFindings.length + exported.policy.violations.length + recognitionResults && runObj.results.filter(r => r.ruleId === 'BOPPI-UNPINNED').length === exported.recognition.filter(r => r.pin === 'unpinned').length);
  ok('critical and high map to error, medium to warning', runObj.results.filter(r => ['critical', 'high'].includes(r.properties.severity)).every(r => r.level === 'error') && runObj.results.filter(r => r.properties.severity === 'medium').every(r => r.level === 'warning'));
  const serialized = JSON.stringify(log);
  ok('SARIF uses portable config paths, never the home directory', serialized.includes('~/Library/Application Support/Claude/claude_desktop_config.json') && !serialized.includes(home));

  section('discovery and validation');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ denyServers: ['desktop-commander'] }));
  const auto = runCli(['scan'], home, cwd);
  ok('boppi.policy.json in the working directory is picked up without --policy', auto.code === 1 && auto.stdout.includes('POL-DENY-SERVER'));
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ allowServers: ['filesystem', 'fetch', 'commander', 'mystery', 'puppeteer'] }));
  const clean = runCli(['scan'], home, cwd);
  ok('a satisfied policy prints passed and exits 0', clean.code === 0 && clean.stdout.includes('POLICY  passed'));
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ failOn: 'extreme' }));
  const bad = runCli(['scan'], home, cwd);
  ok('an invalid policy exits 2 with the reason', bad.code === 2 && bad.stderr.includes('failOn'));
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ surprise: true }));
  const unknownKey = runCli(['scan'], home, cwd);
  ok('an unknown policy key is rejected rather than ignored', unknownKey.code === 2 && unknownKey.stderr.includes('unknown key'));
  const missing = runCli(['scan', '--policy', path.join(root, 'nope.json')], home);
  ok('a missing --policy file exits 2', missing.code === 2);

  section('plan honors the policy');
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ denyServers: ['desktop-commander'] }));
  const planViolated = runCli(['plan'], home, cwd);
  ok('boppi plan exits 1 and prints the POLICY section when the policy is violated', planViolated.code === 1 && planViolated.stdout.includes('POL-DENY-SERVER') && planViolated.stdout.includes('"commander"'));
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ allowServers: ['filesystem', 'fetch', 'commander', 'mystery', 'puppeteer'] }));
  const planClean = runCli(['plan'], home, cwd);
  ok('boppi plan exits 0 when the policy passes', planClean.code === 0 && planClean.stdout.includes('POLICY  passed'));
  const planNoPolicy = runCli(['plan'], home);
  ok('boppi plan without a policy exits 0 and prints no POLICY section', planNoPolicy.code === 0 && !planNoPolicy.stdout.includes('POLICY'));

  section('explicit config in CI shape');
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] }, shell: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] } } }));
  fs.writeFileSync(path.join(cwd, 'boppi.policy.json'), JSON.stringify({ denyCombinations: [['shell_access', 'untrusted_external_content']] }));
  const ci = runCli(['scan', '--config', path.join(cwd, '.mcp.json'), '--source', 'claude-code', '--sarif', path.join(cwd, 'ci.sarif')], home, cwd);
  const ciLog = JSON.parse(fs.readFileSync(path.join(cwd, 'ci.sarif'), 'utf8'));
  ok('an explicit config scan evaluates the policy and writes SARIF against that file', ci.code === 1 && ci.stdout.includes('POL-DENY-COMBINATION') && ciLog.runs[0].results.some(r => r.ruleId === 'POL-DENY-COMBINATION'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
