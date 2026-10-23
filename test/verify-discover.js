#!/usr/bin/env node
/** `boppi discover` end to end against the fixture servers: consent, refusals, bounds, canaries, the recorder's method set, cache, lock, and forget. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ALLOWED_METHODS } = require('../src/cli/discovery/recorder');
const discover = require('../src/cli/discovery/discover');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'mcp-servers');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n${name}`); }

const CANARIES = ['ghp_secretvalue_1234567890', '/Users/someone/.ssh/id_rsa', 'rm -rf /', 'sekret-value-xyz'];
const fixture = (name, ...extra) => ({ command: process.execPath, args: [path.join(FIXTURES, `${name}.js`), ...extra] });

function run(args, home, { env = {}, input } = {}) {
  const result = spawnSync(process.execPath, [CLI, 'discover', ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', input: input === undefined ? '' : input, env: { ...process.env, ...env } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const cacheFiles = home => fs.existsSync(discover.discoveryDir(home)) ? fs.readdirSync(discover.discoveryDir(home)).filter(f => f.endsWith('.json')) : [];

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-discover-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      paged: { ...fixture('paged'), env: { API_KEY: 'sekret-value-xyz' } },
      timeout: fixture('timeout'),
      hostile: fixture('hostile'),
      malformed: fixture('malformed'),
      reject: fixture('auth-rejection', 'list'),
      npxserver: { command: 'npx', args: ['-y', 'some-package'] },
      remote: { url: 'https://example.test/mcp' },
      missing: { command: 'no-such-program-boppi-xyz' },
    },
    projects: {},
  }));

  section('Consent and refusals: nothing starts without --yes, a refused launcher never starts');
  const declined = run(['--server', 'paged'], home);
  ok('without --yes and without a terminal the command prints the consent text and does not start', declined.code === 2 && declined.stdout.includes('BOPPI · DISCOVER  "paged"') && declined.stdout.includes('never:    tools/call') && declined.stderr.includes('not started') && cacheFiles(home).length === 0);
  ok('the consent text names env variables, never their values', declined.stdout.includes('(API_KEY)') && !declined.stdout.includes('sekret-value-xyz'));
  const npx = run(['--server', 'npxserver', '--yes'], home);
  ok('a package-fetching launcher is refused before anything starts', npx.code === 2 && npx.stderr.includes('fetches a package at start') && !npx.stdout.includes('DISCOVERED'));
  const remote = run(['--server', 'remote', '--yes'], home);
  ok('a remote endpoint is refused in this release', remote.code === 2 && remote.stderr.includes('Streamable HTTP'));
  const missing = run(['--server', 'missing', '--yes'], home);
  ok('a program that is not installed is reported, never installed', missing.code === 2 && missing.stderr.includes('not installed'));
  const unknown = run(['--server', 'nope', '--yes'], home);
  ok('an unknown server name is an error that names boppi scan', unknown.code === 2 && unknown.stderr.includes('boppi scan lists the names'));
  const bad = spawnSync(process.execPath, [CLI, 'discover', '--yes', '--home', home, '--cwd', home], { encoding: 'utf8' });
  ok('--yes without --server is rejected by argument parsing', bad.status === 2 && bad.stderr.includes('requires --server'));
  const allNoForget = spawnSync(process.execPath, [CLI, 'discover', '--server', 'paged', '--all', '--yes', '--home', home, '--cwd', home], { encoding: 'utf8' });
  ok('--all is only accepted with --forget', allNoForget.status === 2 && allNoForget.stderr.includes('one server per run'));

  section('A consented session on the paged fixture');
  const record = path.join(root, 'paged-record.json');
  const paged = run(['--server', 'paged', '--yes', '--record', record], home);
  ok('discovery succeeds and reports the tool count and pages', paged.code === 0 && paged.stdout.includes('DISCOVERED  40 tools advertised by "paged" in 3 pages'));
  ok('the result is graded advertised, not verified', paged.stdout.includes('advertised, not verified'));
  ok('the process exited on its own and the methods sent are listed', paged.stdout.includes('exited on its own') && paged.stdout.includes('sent:     initialize, notifications/initialized, tools/list'));
  const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
  ok('the protocol record holds only allowed methods and never tools/call', rec.methods.every(m => ALLOWED_METHODS.includes(m)) && !rec.methods.includes('tools/call') && rec.violations.length === 0);
  ok('the record carries no params beyond method and id', rec.record.sent.every(entry => Object.keys(entry).sort().join() === 'at,id,method'));
  const files = cacheFiles(home);
  const cache = JSON.parse(fs.readFileSync(path.join(discover.discoveryDir(home), files[0]), 'utf8'));
  ok('one cache file is written, owner-only, with the entry hash and the projection', files.length === 1 && (fs.statSync(path.join(discover.discoveryDir(home), files[0])).mode & 0o777) === 0o600 && cache.entryHash.length === 64 && cache.list.counts.kept === 40 && cache.maxAgeDays === 7);
  ok('the cached launch is sanitized: the command is a basename and no env value is stored', cache.launch.command === path.basename(process.execPath) && !JSON.stringify(cache).includes('sekret-value-xyz') && cache.launch.envNames.join() === 'API_KEY');
  const entry = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.paged;
  ok('the cache is usable for the same entry and stale for a changed one or an old date', discover.cacheStatus(cache, entry).usable && !discover.cacheStatus(cache, { ...entry, args: [...entry.args, '--x'] }).usable && discover.cacheStatus(cache, entry, Date.parse(cache.discoveredAt) + 8 * 86400000).reason.includes('older than 7 days'));

  section('Bounds, rejection, and hostile data');
  const timeout = run(['--server', 'timeout', '--yes'], home, { env: { BOPPI_DISCOVER_TIMEOUTS: JSON.stringify({ pageMs: 300, initializeMs: 2000 }) } });
  ok('a server that never answers tools/list is cancelled, reported partial, and shut down', timeout.code === 0 && timeout.stdout.includes('partial: the server did not answer tools/list in time') && timeout.stdout.includes('notifications/cancelled') && !timeout.stdout.includes('STILL RUNNING'));
  const reject = run(['--server', 'reject', '--yes'], home);
  ok('a tools/list error is a rejection with its code and nothing stored', reject.code === 3 && reject.stdout.includes('REJECTED') && reject.stdout.includes('tools/list error -32001') && !cacheFiles(home).some(f => fs.readFileSync(path.join(discover.discoveryDir(home), f), 'utf8').includes('"server": "reject"')));
  const malformed = run(['--server', 'malformed', '--yes'], home);
  ok('malformed entries are counted as rejected and the valid ones are kept', malformed.code === 0 && /DISCOVERED  \d+ tools advertised by "malformed"/.test(malformed.stdout) && /rejected as malformed/.test(malformed.stdout));
  const hostileRecord = path.join(root, 'hostile-record.json');
  const hostile = run(['--server', 'hostile', '--yes', '--record', hostileRecord], home);
  const everything = hostile.stdout + hostile.stderr + fs.readFileSync(hostileRecord, 'utf8') + cacheFiles(home).map(f => fs.readFileSync(path.join(discover.discoveryDir(home), f), 'utf8')).join('');
  ok('no canary from the hostile fixture reaches the terminal, the record, or the cache', hostile.code === 0 && CANARIES.every(c => !everything.includes(c)));
  ok('no escape sequence from the hostile fixture reaches the terminal', !/\u001b\[/.test(hostile.stdout));

  section('Lock and forget');
  const pagedEntry = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.paged;
  const serverId = discover.serverIdOf({ source: 'claude-code' }, 'paged', pagedEntry);
  const lock = path.join(discover.discoveryDir(home), `.lock-${serverId}`);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const locked = run(['--server', 'paged', '--yes'], home);
  ok('a live lock held by another process stops a second discovery of the same server', locked.code === 2 && locked.stderr.includes('another Boppi process'));
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
  const stale = run(['--server', 'paged', '--yes'], home);
  ok('a stale lock from a dead process is replaced and released', stale.code === 0 && !fs.existsSync(lock));
  const before = cacheFiles(home).length;
  const forgetOne = run(['--forget', '--server', 'paged'], home);
  ok('--forget --server removes that one stored list', forgetOne.code === 0 && forgetOne.stdout.includes('Removed the stored tool list for "paged"') && cacheFiles(home).length === before - 1);
  const forgetAll = run(['--forget', '--all'], home);
  ok('--forget --all removes every stored list', forgetAll.code === 0 && cacheFiles(home).length === 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
