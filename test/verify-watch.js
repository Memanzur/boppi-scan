#!/usr/bin/env node
/** boppi watch: foreground scan+push loop, interval floor, and the interval field only on watch payloads. */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const cli = require('../src/cli/boppi');
const push = require('../src/cli/push');
const watch = require('../src/cli/watch');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const CANARY = 'HISTORY_CANARY_DO_NOT_UPLOAD_9f3c';
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeFixtureHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.boppi'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'SUPERSECRETVALUE' } },
    },
  }));
  const history = JSON.stringify([{ note: CANARY, local: true }]);
  fs.writeFileSync(path.join(home, '.boppi', 'history.json'), history);
  return { home, history, historyPath: path.join(home, '.boppi', 'history.json') };
}

function cliEnv(env) {
  return { ...process.env, BOPPI_TOKEN: '', BOPPI_SCAN_PLATFORM: 'darwin', ...env };
}

function runCli(args, home, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--platform', 'darwin'], {
    encoding: 'utf8',
    env: cliEnv(env),
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/** Async spawn so an in-process workspace can answer while the CLI waits on fetch. */
function runCliAsync(args, home, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--platform', 'darwin'], {
      env: cliEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

/** Run watch until `stopWhen` is true, then send a single Ctrl+C. Kills the process if it is still up after timeoutMs. */
function runUntilStop(args, home, stopWhen, env = {}, timeoutMs = 20000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--platform', 'darwin'], {
      env: cliEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    let stopping = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    const maybeStop = () => {
      if (stopping || !stopWhen(stdout, stderr)) return;
      stopping = true;
      child.kill('SIGINT');
    };
    child.stdout.on('data', d => { stdout += d; maybeStop(); });
    child.stderr.on('data', d => { stderr += d; maybeStop(); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function startWorkspace() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = (() => { try { return JSON.parse(body); } catch (_) { return null; } })();
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: parsed, raw: body });
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      res.setHeader('content-type', 'application/json');
      if (token === 'bpc_good') { res.writeHead(200); res.end(JSON.stringify({ ingested: parsed && parsed.records ? parsed.records.length : 0, requestId: 'req-watch' })); }
      else if (token === 'bpc_down') { res.writeHead(503); res.end(JSON.stringify({ error: 'Ingest is temporarily unavailable. Retry in a minute.', requestId: 'req-down' })); }
      else { res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid or revoked collector token.', requestId: 'req-bad' })); }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

function claimsProtected(text) {
  return /machine is protected|you(?:'| a)?re protected|now protected|stays protected|keeps? (?:you|the machine) protected/i.test(text);
}

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-watch-verify-'));
  const { home, history, historyPath } = makeFixtureHome(root);

  section('Interval parsing');
  ok('default interval is 15 minutes', watch.parseInterval(undefined) === 15 * 60 && watch.parseInterval(null) === 900 && watch.parseInterval('') === 900);
  ok('minutes, hours, and seconds parse', watch.parseInterval('15m') === 900 && watch.parseInterval('1h') === 3600 && watch.parseInterval('60') === 60 && watch.parseInterval('60s') === 60 && watch.parseInterval('5M') === 300);
  ok('a 59 second interval is rejected', (() => { try { watch.parseInterval('59'); return false; } catch (error) { return /too short/.test(error.message) && /60s/.test(error.message); } })());
  ok('zero, one second, and 30s are rejected', ['0', '1', '1s', '30s', '0s'].every(value => { try { watch.parseInterval(value); return false; } catch (error) { return /too short/.test(error.message); } }));
  ok('a non-duration is rejected', (() => { try { watch.parseInterval('soon'); return false; } catch (error) { return /--interval/.test(error.message); } })());
  ok('15 minutes formats as minutes', watch.formatInterval(900) === '15 minutes' && watch.formatInterval(60) === '1 minute' && watch.formatInterval(3600) === '1 hour');

  const slept = [];
  const controller = new AbortController();
  const loop = await watch.repeat({
    intervalSeconds: 900,
    signal: controller.signal,
    sleep: async () => { slept.push(Date.now()); },
    runOnce: async () => { if (slept.length === 1) controller.abort(); },
  });
  ok('the loop runs a cycle, sleeps, then runs another cycle', loop.cycles === 2 && slept.length === 1);

  const noSleep = new AbortController();
  let sleptAnyway = false;
  const once = await watch.repeat({
    intervalSeconds: 60,
    signal: noSleep.signal,
    sleep: async () => { sleptAnyway = true; },
    runOnce: async () => { noSleep.abort(); },
  });
  ok('aborting during a cycle does not start the wait', once.cycles === 1 && sleptAnyway === false);

  const interrupted = new AbortController();
  const started = Date.now();
  const pending = watch.delay(60_000, interrupted.signal);
  setTimeout(() => interrupted.abort(), 30);
  await pending;
  ok('the wait returns when the stop signal fires', Date.now() - started < 2000);

  section('One-shot commands stay one-shot');
  ok('bare boppi is still a scan', cli.parseArgs([]).command === 'scan' && cli.parseArgs([]).intervalSeconds === undefined);
  const pushOptions = cli.parseArgs(['push', '--token', 'bpc_x', '--url', 'http://127.0.0.1:9', '--dry-run']);
  ok('push does not carry an interval', pushOptions.command === 'push' && pushOptions.expectedIntervalSeconds === undefined && pushOptions.intervalSeconds === undefined);
  const intervalOnPush = runCli(['push', '--interval', '15m', '--dry-run', '--token', 'bpc_x'], home);
  ok('--interval is rejected on push', intervalOnPush.code === 2 && intervalOnPush.stderr.includes('only valid with boppi watch'));
  const intervalOnScan = runCli(['scan', '--interval', '60', '--quiet'], home);
  ok('--interval is rejected on scan', intervalOnScan.code === 2 && intervalOnScan.stderr.includes('only valid with boppi watch'));
  const plain = push.requestBody({ records: [{ kind: 'agent' }], snapshot: true });
  const mergedPlain = push.requestBody({ records: [{ kind: 'agent' }], snapshot: false });
  ok('one-shot bodies have no expected_interval_seconds key', !Object.prototype.hasOwnProperty.call(plain, 'expected_interval_seconds') && plain.snapshot === true && !Object.prototype.hasOwnProperty.call(mergedPlain, 'expected_interval_seconds') && !Object.prototype.hasOwnProperty.call(mergedPlain, 'snapshot'));
  const watchedBody = push.requestBody({ records: [{ kind: 'agent' }], snapshot: true, expectedIntervalSeconds: 900 });
  ok('a watch body carries the interval next to the records', watchedBody.expected_interval_seconds === 900 && watchedBody.snapshot === true && watchedBody.records.length === 1);

  section('Argument handling');
  const help = runCli(['watch', '--help'], home);
  ok('watch --help exits 0', help.code === 0 && help.stdout.includes('boppi watch') && help.stdout.includes('15m') && help.stdout.includes('Ctrl+C'));
  ok('help does not claim the machine is protected', help.stdout.includes('does not protect the machine') && !claimsProtected(help.stdout) && !/protected/i.test(help.stdout));
  const tooShort = runCli(['watch', '--interval', '1', '--token', 'bpc_x', '--url', 'http://127.0.0.1:9'], home);
  ok('a 1 second interval exits 2 and does not scan or send', tooShort.code === 2 && /too short/.test(tooShort.stderr) && !tooShort.stdout.includes('Sending') && !tooShort.stderr.includes('Could not reach'));
  const thirty = runCli(['watch', '--interval', '30s', '--token', 'bpc_x', '--url', 'http://127.0.0.1:9'], home);
  ok('30s is below the minimum', thirty.code === 2 && /too short/.test(thirty.stderr));
  const noToken = runCli(['watch', '--url', 'http://127.0.0.1:9'], home);
  ok('watch without a token and without a terminal exits 2', noToken.code === 2 && noToken.stderr.includes('--token') && noToken.stderr.includes('BOPPI_TOKEN') && noToken.stderr.includes('prompted'));
  const withFile = runCli(['watch', '--file', path.join(root, 'export.json'), '--token', 'bpc_x', '--dry-run'], home);
  ok('watch refuses --file because it scans every cycle', withFile.code === 2 && withFile.stderr.includes('does not take --file'));
  const watchOptions = cli.parseArgs(['watch', '--token', 'bpc_x', '--url', 'http://127.0.0.1:9', '--interval', '5m', '--dry-run']);
  ok('parseArgs stores 5 minutes for watch and leaves the push field unset', watchOptions.intervalSeconds === 300 && watchOptions.expectedIntervalSeconds === undefined && watchOptions.command === 'watch');

  section('The request a workspace receives');
  const workspace = await startWorkspace();
  try {
    const watched = await runUntilStop(
      ['watch', '--url', workspace.url, '--interval', '60'],
      home,
      stdout => stdout.includes('Next scan in'),
      { BOPPI_TOKEN: 'bpc_good' },
    );
    ok('watch exits 0 after Ctrl+C', watched.code === 0 && watched.stdout.includes('Stopped.'));
    ok('watch copy does not claim the machine is protected', watched.stdout.includes('does not protect the machine') && !claimsProtected(watched.stdout + watched.stderr) && !/protected/i.test(watched.stdout + watched.stderr));
    ok('the minimum interval is announced as one minute', watched.stdout.includes('scanning every 1 minute') && watched.stdout.includes('Next scan in 1 minute'));
    const request = workspace.requests[0];
    ok('exactly one POST before Ctrl+C', workspace.requests.length === 1 && request.method === 'POST' && request.url === '/api/ingest');
    ok('watch sends expected_interval_seconds on the snapshot', request.body.snapshot === true && request.body.expected_interval_seconds === 60 && Array.isArray(request.body.records) && request.body.records.length > 0);
    ok('the payload keys are records, snapshot, and the interval', Object.keys(request.body).sort().join() === 'expected_interval_seconds,records,snapshot');
    ok('history.json is not uploaded', !request.raw.includes(CANARY) && !request.raw.includes('history.json') && fs.readFileSync(historyPath, 'utf8') === history);
    ok('secret values stay out of the watch payload', !request.raw.includes('SUPERSECRETVALUE'));
    ok('the token stays in the header', request.authorization === 'Bearer bpc_good' && !request.raw.includes('bpc_good'));

    const before = workspace.requests.length;
    const five = await runUntilStop(
      ['watch', '--url', workspace.url, '--interval', '5m', '--merge'],
      home,
      stdout => stdout.includes('Next scan in'),
      { BOPPI_TOKEN: 'bpc_good' },
    );
    const merged = workspace.requests[before];
    ok('a 5 minute merge watch sends 300 seconds and no snapshot flag', five.code === 0 && merged.body.expected_interval_seconds === 300 && !Object.prototype.hasOwnProperty.call(merged.body, 'snapshot') && !merged.raw.includes(CANARY));

    const beforeDefault = workspace.requests.length;
    const defaults = await runUntilStop(
      ['watch', '--url', workspace.url],
      home,
      stdout => stdout.includes('Next scan in 15 minutes'),
      { BOPPI_TOKEN: 'bpc_good' },
    );
    ok('the default interval is 15 minutes and 900 seconds', defaults.code === 0 && defaults.stdout.includes('scanning every 15 minutes') && workspace.requests[beforeDefault].body.expected_interval_seconds === 900);
    ok('watch cycles leave ~/.boppi/history.json untouched', fs.readFileSync(historyPath, 'utf8') === history);

    const beforePush = workspace.requests.length;
    const oncePush = await runCliAsync(['push', '--url', workspace.url], home, { BOPPI_TOKEN: 'bpc_good' });
    const pushed = workspace.requests[beforePush];
    ok('boppi push still exits after one request and omits the interval', oncePush.code === 0 && workspace.requests.length === beforePush + 1 && !oncePush.stdout.includes('Next scan') && !oncePush.stdout.includes('BOPPI · WATCH') && pushed.body.snapshot === true && !Object.prototype.hasOwnProperty.call(pushed.body, 'expected_interval_seconds') && !pushed.raw.includes(CANARY));

    const duringScan = workspace.requests.length;
    const scan = runCli(['--quiet'], home);
    ok('boppi with no command is still a one-shot scan', scan.code === 0 && !scan.stdout.includes('BOPPI · WATCH') && !scan.stdout.includes('Next scan') && workspace.requests.length === duringScan);

    const beforeDown = workspace.requests.length;
    const down = await runUntilStop(
      ['watch', '--url', workspace.url, '--interval', '60'],
      home,
      (stdout, stderr) => stderr.includes('HTTP 503') && stdout.includes('Next scan in'),
      { BOPPI_TOKEN: 'bpc_down' },
    );
    ok('a 503 is reported and another cycle is scheduled', down.code === 0 && workspace.requests.length === beforeDown + 1 && down.stderr.includes('HTTP 503') && down.stdout.includes('Next scan in 1 minute'));

    const beforeBad = workspace.requests.length;
    const rejected = await runUntilStop(
      ['watch', '--url', workspace.url, '--interval', '60'],
      home,
      () => false,
      { BOPPI_TOKEN: 'bpc_bad' },
      10000,
    );
    ok('a rejected token stops watch instead of looping', rejected.code === 5 && workspace.requests.length === beforeBad + 1 && rejected.stderr.includes('HTTP 401') && !rejected.stdout.includes('Next scan'));
    ok('a rejected watch does not upload history', !workspace.requests[beforeBad].raw.includes(CANARY));
  } finally {
    workspace.server.close();
  }

  const dry = await runUntilStop(
    ['watch', '--dry-run', '--interval', '15m', '--url', 'http://127.0.0.1:9'],
    home,
    stdout => stdout.includes('Nothing was sent'),
  );
  const dryBody = JSON.parse(dry.stdout.slice(dry.stdout.indexOf('{'), dry.stdout.lastIndexOf('}') + 1));
  ok('watch --dry-run shows the interval and sends nothing', dry.code === 0 && dryBody.expected_interval_seconds === 900 && Array.isArray(dryBody.records) && dry.stdout.includes('Nothing was sent') && !dry.stderr.includes('Could not reach'));
  ok('dry-run copy does not claim the machine is protected', dry.stdout.includes('does not protect the machine') && !claimsProtected(dry.stdout));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
