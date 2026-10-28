#!/usr/bin/env node
/** Remote header names are recorded as inspect-only facts; values never leave memory and no grade changes (D-3). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { configFacts } = require('../src/cli/configFacts');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
const SECRET = 'HEADERSECRETVALUE_abc123';

function home(withHeaders) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-facts-'));
  const remote = { type: 'http', url: 'https://mcp.example.test/mcp' };
  if (withHeaders) Object.assign(remote, { headers: { Authorization: `Bearer ${SECRET}`, 'X-Trace': 'on' } });
  const helper = withHeaders ? { type: 'http', url: 'https://other.example.test/mcp', headersHelper: `/usr/local/bin/get-${SECRET}` } : { type: 'http', url: 'https://other.example.test/mcp' };
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { remote, helper, files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(dir, 'docs')] } } }));
  return dir;
}
function scan(dir) {
  const json = path.join(dir, 'out.json'), html = path.join(dir, 'out.html'), sarif = path.join(dir, 'out.sarif');
  const r = spawnSync(process.execPath, [CLI, 'scan', '--json', json, '--html', html, '--sarif', sarif, '--only', 'claude-code', '--home', dir, '--cwd', dir, '--no-color', '--history-file', path.join(dir, 'h.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', CLAUDE_CODE_PLUGIN_CACHE_DIR: '' } });
  return { code: r.status, stdout: r.stdout || '', exported: JSON.parse(fs.readFileSync(json, 'utf8')), all: [r.stdout, r.stderr, fs.readFileSync(json, 'utf8'), fs.readFileSync(html, 'utf8'), fs.readFileSync(sarif, 'utf8'), fs.existsSync(path.join(dir, 'h.json')) ? fs.readFileSync(path.join(dir, 'h.json'), 'utf8') : ''].join('\n') };
}
const grade = exported => JSON.stringify({ paths: exported.exposurePaths.map(p => [p.exposureKey.split(':')[0], p.severity]).sort(), caps: exported.inventory.real.mcpServers.map(s => [s.name, [...s.capabilities].sort()]).sort() });

console.log('── Header names are facts, values are never kept ──');
ok('configFacts keeps names and flags credential-looking ones', JSON.stringify(configFacts({ headers: { Authorization: 'x', 'X-Trace': 'y', 'bad name': 'z' } })) === JSON.stringify({ inspectOnly: true, headerNames: ['Authorization', 'X-Trace'], credentialHeaderNames: ['Authorization'], headersHelper: false }));
ok('a server without headers has no facts', configFacts({ command: 'node' }) === null && configFacts(null) === null);
const withH = scan(home(true));
const without = scan(home(false));
const remote = withH.exported.inventory.real.mcpServers.find(s => s.name === 'remote');
ok('the export records the header names on the server', remote && remote.configFacts && remote.configFacts.credentialHeaderNames.join() === 'Authorization' && remote.configFacts.headerNames.join() === 'Authorization,X-Trace');
ok('a headersHelper is recorded as present, never its command', withH.exported.inventory.real.mcpServers.find(s => s.name === 'helper').configFacts.headersHelper === true);
ok('no header value or helper command appears in terminal, JSON, HTML, SARIF or history', !withH.all.includes(SECRET), 'value leaked');
ok('the terminal says so under COVERAGE', /Not graded: .*2 servers send credential headers: remote \(Authorization\); helper \(headersHelper\)/.test(withH.stdout), withH.stdout.split('\n').find(l => l.includes('Not graded')) || 'no line');
console.log('── No grade changes ──');
ok('exposure paths and capabilities are identical with and without headers', grade(withH.exported) === grade(without.exported));
ok('exit code is the same', withH.code === without.code, `${withH.code} vs ${without.code}`);
ok('without headers there is no Not graded line', !without.stdout.includes('Not graded:'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
