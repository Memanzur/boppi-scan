#!/usr/bin/env node
/**
 * boppi monitor: the background service is installed only after consent, only for the user, never with the token in
 * its definition, and removed completely by disable. The service entry point watches with the stored token, checks in,
 * and turns a refused token into a clean stop. launchctl is a stand-in that records its arguments; the real one is
 * never called, and every file lives in a throwaway home.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const monitor = require('../src/cli/monitor');

const CLI = path.join(__dirname, '..', 'src', 'cli', 'boppi.js');
const TOKEN = 'bpc_' + 'ab'.repeat(32);
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n${name}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-monitor-'));
const fakeLog = path.join(root, 'launchctl.log');
const fake = path.join(root, 'launchctl');
fs.writeFileSync(fake, `#!${process.execPath}\nconst fs = require('fs');\nfs.appendFileSync(${JSON.stringify(fakeLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nif (process.argv[2] === 'print') { if (process.env.FAKE_PRINT) { process.stdout.write(process.env.FAKE_PRINT); process.exit(0); } process.exit(113); }\nprocess.exit(Number(process.env.FAKE_EXIT || 0));\n`, { mode: 0o755 });
const calls = () => (fs.existsSync(fakeLog) ? fs.readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

function makeHome(name) {
  const home = path.join(root, name);
  const desktopDir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(desktopDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { files: { command: 'node', args: ['files.js'] } } }));
  return home;
}

const ENV = { BOPPI_TOKEN: '', BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_NO_UPDATE_NOTICE: '1', BOPPI_LAUNCHCTL: fake, BOPPI_WATCH_PUSH_BACKOFF_MS: '20' };
function cli(args, home, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { env: { ...process.env, ...ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function ingest() {
  const self = { pushes: [], beats: [], ingestStatus: 200 };
  self.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (req.url.endsWith('/heartbeat')) { self.beats.push({ body, authorization: req.headers.authorization }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
      self.pushes.push(body);
      res.writeHead(self.ingestStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(self.ingestStatus === 200 ? { ingested: body.records.length, snapshotId: 'snap', requestId: 'req' } : { error: 'Invalid or revoked collector token.', requestId: 'req' }));
    });
  });
  self.listen = () => new Promise(resolve => self.server.listen(0, '127.0.0.1', () => { self.url = `http://127.0.0.1:${self.server.address().port}`; resolve(); }));
  self.close = () => new Promise(resolve => { self.server.closeAllConnections(); self.server.close(() => resolve()); });
  return self;
}

async function waitFor(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await sleep(100); }
  return false;
}

(async function main() {
  const server = ingest();
  await server.listen();

  section('enable asks, refuses where it cannot work, and installs nothing on a no');
  const home = makeHome('home');
  const linux = await cli(['monitor', 'enable', '--token', TOKEN, '--yes', '--url', server.url], home, { BOPPI_SCAN_PLATFORM: 'linux' });
  ok('Linux and Windows are refused with the terminal alternative', linux.code === 2 && linux.stderr.includes('supports macOS for now') && linux.stderr.includes('boppi watch --push'));
  const noTty = await cli(['monitor', 'enable', '--token', TOKEN, '--url', server.url], home);
  ok('without a terminal and without --yes it refuses instead of installing silently', noTty.code === 2 && noTty.stderr.includes('asks before installing anything'));
  ok('nothing was written by a refused enable', !fs.existsSync(monitor.agentFile(home)) && !fs.existsSync(monitor.tokenFile(home)) && calls().length === 0);
  ok('a copy running from the npx cache is refused, because npm can delete it', /npx cache/.test(monitor.installedProgram({ execPath: '/usr/bin/node', script: '/Users/a/.npm/_npx/1a2b/node_modules/boppi/src/cli/boppi.js' }).problem || ''));
  ok('a standalone executable needs no script argument', monitor.programArguments({ execPath: '/Users/a/.boppi/bin/boppi', script: null, home: '/Users/a', ingestUrl: new URL('https://app.boppi.io/api/ingest') }).slice(0, 3).join(' ') === '/Users/a/.boppi/bin/boppi monitor run');
  ok('the yes flag is refused on other subcommands', (await cli(['monitor', 'status', '--yes'], home)).stderr.includes('--yes is only accepted with monitor enable'));

  section('enable --yes: one user LaunchAgent, token kept out of it');
  const enabled = await cli(['monitor', 'enable', '--token', TOKEN, '--yes', '--url', server.url], home);
  const plist = fs.existsSync(monitor.agentFile(home)) ? fs.readFileSync(monitor.agentFile(home), 'utf8') : '';
  ok('enable exits 0 and says how to check and how to turn it off', enabled.code === 0 && enabled.stdout.includes('Monitoring is on') && enabled.stdout.includes('boppi monitor disable'));
  ok('the consent text lists every file written and what leaves the machine', enabled.stdout.includes(monitor.agentFile(home)) && enabled.stdout.includes(monitor.tokenFile(home)) && enabled.stdout.includes('Only sanitized inventory metadata is sent'));
  ok('the agent is under the user\'s own LaunchAgents folder', monitor.agentFile(home) === path.join(home, 'Library', 'LaunchAgents', 'io.boppi.monitor.plist') && plist.includes('<string>io.boppi.monitor</string>'));
  ok('the agent runs monitor run against the chosen workspace and home', plist.includes('<string>monitor</string>') && plist.includes('<string>run</string>') && plist.includes(`<string>${server.url}/api/ingest</string>`) && plist.includes(`<string>${home}</string>`));
  ok('the token is not in the agent definition', !plist.includes(TOKEN) && !plist.includes('--token'));
  ok('restart only after a failed exit, at most once a minute', plist.includes('<key>SuccessfulExit</key><false/>') && plist.includes('<key>ThrottleInterval</key><integer>60</integer>'));
  if (process.platform === 'darwin') ok('macOS accepts the definition (plutil -lint)', spawnSync('/usr/bin/plutil', ['-lint', monitor.agentFile(home)]).status === 0);
  const tokenMode = fs.statSync(monitor.tokenFile(home)).mode & 0o777;
  ok('the token file is owner-only and holds the token', tokenMode === 0o600 && fs.readFileSync(monitor.tokenFile(home), 'utf8').trim() === TOKEN);
  ok('the monitor folder is owner-only', (fs.statSync(monitor.monitorDir(home)).mode & 0o777) === 0o700);
  const loaded = calls();
  ok('launchd is asked to replace any old copy, then load this one in the user\'s own session', loaded.length === 2 && loaded[0][0] === 'bootout' && loaded[1].join(' ') === `bootstrap gui/${process.getuid()} ${monitor.agentFile(home)}`);
  ok('nothing in the output shows the token', !enabled.stdout.includes(TOKEN) && !enabled.stderr.includes(TOKEN));

  section('status reads launchd and the last check-in');
  const running = await cli(['monitor', 'status'], home, { FAKE_PRINT: 'gui/501/io.boppi.monitor = {\n\tstate = running\n\tpid = 4242\n}\n' });
  ok('a running service reads "on, running"', running.code === 0 && running.stdout.includes('Monitoring: on, running') && running.stdout.includes('last check-in: none yet'));
  const notLoaded = await cli(['monitor', 'status'], home);
  ok('an unloaded service says it starts at next login', notLoaded.stdout.includes('installed, not loaded'));

  section('monitor run: watch --push with the stored token, check-ins, clean stop');
  const service = spawn(process.execPath, [CLI, 'monitor', 'run', '--url', server.url, '--home', home, '--cwd', home, '--no-color'], { env: { ...process.env, ...ENV } });
  let serviceOut = '';
  service.stdout.on('data', d => { serviceOut += d; });
  const exited = new Promise(resolve => service.on('exit', code => resolve(code)));
  const started = await waitFor(() => server.beats.length >= 1 && server.pushes.length >= 1, 30000);
  ok('the service pushes the baseline and checks in as continuous with the stored token', started && server.beats[0].body.mode === 'continuous' && server.beats[0].authorization === `Bearer ${TOKEN}`);
  service.kill('SIGTERM');
  const code = await exited;
  ok('SIGTERM (launchctl bootout) stops it with exit 0 and a manual sign-off', code === 0 && server.beats.slice(-1)[0].body.mode === 'manual');
  const log = fs.readFileSync(monitor.logFile(home), 'utf8');
  ok('its log is owner-only and never contains the token', (fs.statSync(monitor.logFile(home)).mode & 0o777) === 0o600 && !log.includes(TOKEN) && !serviceOut.includes(TOKEN));
  const after = await cli(['monitor', 'status'], home);
  ok('status shows the last check-in from the log', /last check-in: \S+ \(accepted\)/.test(after.stdout));

  server.ingestStatus = 401;
  fs.rmSync(path.join(home, '.boppi', 'watch-push'), { recursive: true, force: true });
  const refused = await cli(['monitor', 'run', '--url', server.url], home);
  server.ingestStatus = 200;
  ok('a refused token ends the service with exit 0, so launchd does not restart it in a loop', refused.code === 0);
  const refusedStatus = await cli(['monitor', 'status'], home);
  ok('status then says the workspace refused the token and what to do', refusedStatus.stdout.includes('stopped, the workspace refused the token') && refusedStatus.stdout.includes('Collectors page'));

  fs.chmodSync(monitor.tokenFile(home), 0o644);
  const loose = await cli(['monitor', 'run', '--url', server.url], home);
  ok('a token file others can read is refused, and nothing is sent', loose.code === 2 && loose.stderr.includes('other accounts on this machine can read it'));
  fs.chmodSync(monitor.tokenFile(home), 0o600);

  section('disable removes the service and the token, keeps the logs');
  fs.writeFileSync(fakeLog, '');
  const disabled = await cli(['monitor', 'disable'], home);
  ok('disable unloads it from the user session', calls().some(c => c.join(' ') === `bootout gui/${process.getuid()}/io.boppi.monitor`));
  ok('the agent definition, token and state are gone', disabled.code === 0 && !fs.existsSync(monitor.agentFile(home)) && !fs.existsSync(monitor.tokenFile(home)) && !fs.existsSync(monitor.stateFile(home)));
  ok('logs stay, and the output says boppi uninstall removes them', fs.existsSync(monitor.logFile(home)) && disabled.stdout.includes('boppi uninstall removes them'));
  const again = await cli(['monitor', 'disable'], home);
  ok('disabling twice is harmless', again.code === 0 && again.stdout.includes('was not installed'));
  ok('status after disable reads off', (await cli(['monitor', 'status'], home)).stdout.includes('Monitoring: off'));

  section('uninstall removes the service too');
  await cli(['monitor', 'enable', '--token', TOKEN, '--yes', '--url', server.url], home);
  fs.writeFileSync(fakeLog, '');
  const dry = await cli(['uninstall', '--dry-run'], home);
  ok('the uninstall plan names the service', dry.stdout.includes(`background monitoring service ${monitor.agentFile(home)}`) && fs.existsSync(monitor.agentFile(home)));
  const gone = await cli(['uninstall', '--yes'], home);
  ok('uninstall unloads and deletes the service with everything under .boppi', gone.code === 0 && !fs.existsSync(monitor.agentFile(home)) && !fs.existsSync(monitor.monitorDir(home)) && calls().some(c => c[0] === 'bootout'));
  makeHome('home');

  section('launchd failures and the real launchctl guard');
  const failing = await cli(['monitor', 'enable', '--token', TOKEN, '--yes', '--url', server.url], home, { FAKE_EXIT: '5' });
  ok('when macOS does not load it, enable says so and exits 4', failing.code === 4 && failing.stderr.includes('macOS did not start it'));
  await cli(['monitor', 'disable'], home);
  delete process.env.BOPPI_LAUNCHCTL;
  const guarded = monitor.launchctl(['print', 'gui/0/io.boppi.monitor.guard-check'], path.join(root, 'elsewhere'));
  ok('the real launchctl is never used for a home other than this account\'s', guarded.code === 125 && guarded.stderr.includes('not this account'));

  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exit(1); });
