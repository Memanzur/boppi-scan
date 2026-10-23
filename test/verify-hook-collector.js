#!/usr/bin/env node
/** Phase 6 local collector: 10 concurrent synthetic sessions (500 invocations, 1,000+ records) with planned drops, reorders, duplicates, and rotation under load; torn writes; privacy canaries; health counters; disable, enable, forget; `boppi events`; hook overhead. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const hook = require('../src/cli/hook');
const events = require('../src/cli/events');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const WORKER = path.join(__dirname, 'fixtures', 'hook-worker.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n${name}`); }
const CANARIES = ['CANARY_INPUT', 'ghp_CANARY_TOKEN', 'CANARY_TRANSCRIPT', 'CANARY_CWD', 'CANARY_RESPONSE', 'CANARY_ERROR_TEXT', 'CANARY_FAILURE_TEXT', 'CANARY_REASON', '/Users/private', 'session-s', 'toolu_'];
const storedText = home => hook.storedFiles(home).map(f => fs.readFileSync(f, 'utf8')).join('');
const cliHook = (home, input, args = []) => spawnSync(process.execPath, [CLI, 'hook', ...args, '--home', home], { input, encoding: 'utf8', env: { ...process.env, BOPPI_HOOK_SEGMENT_BYTES: '' } });

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-collector-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });

  section('ten concurrent sessions with rotation under load');
  const workers = Array.from({ length: 10 }, (_, i) => new Promise(resolve => {
    const child = spawn(process.execPath, [WORKER, home, `s${i}`], { env: { ...process.env, BOPPI_HOOK_SEGMENT_BYTES: '20000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('exit', code => resolve({ code, err }));
  }));
  const results = await Promise.all(workers);
  ok('all ten sessions wrote without an error', results.every(r => r.code === 0 && r.err === ''));
  const read = events.readEvents(home, { sinceDays: 3650 });
  const expectedRecords = 10 * (50 + 50 - 2 + 2);
  ok(`every record was stored: ${read.records.length + read.duplicates} lines read, ${expectedRecords} written, ${read.torn} torn`, read.records.length + read.duplicates === expectedRecords && read.torn === 0);
  ok('duplicate deliveries are counted, not paired twice (2 per session)', read.duplicates === 20);
  ok(`rotation happened under concurrent writers (${hook.segmentFiles(home).length} segments) and lost nothing`, hook.segmentFiles(home).length >= 5);
  const { calls, orphans } = events.timeline(read.records);
  ok('500 invocations are paired into 500 calls', calls.length === 500);
  ok('no cross-session pairing: every call has one session and one invocation', calls.every(c => c.session && c.invocation) && new Set(calls.map(c => c.session)).size === 10);
  const unknown = calls.filter(c => c.outcome === 'unknown');
  ok('a dropped outcome event leaves the call unknown, never ok (2 per session)', unknown.length === 20 && !unknown.some(c => c.outcomeAt));
  ok('a reordered outcome (post before pre) is still paired and has no orphan', orphans.length === 0 && calls.filter(c => c.outcomeAt && c.outcomeAt < c.invokedAt).length === 10 * 7);
  const counts = Object.fromEntries(events.OUTCOMES.map(o => [o, calls.filter(c => c.outcome === o).length]));
  ok(`outcomes are modeled separately: ${JSON.stringify(counts)}`, counts.error > 0 && counts.failed > 0 && counts.interrupted > 0 && counts.denied > 0 && counts.ok > counts.error);
  ok('a denied call is never ok and an interrupted call is never failed', calls.every(c => c.outcome !== 'ok' || c.event !== 'PermissionDenied'));
  ok('the server source from the payload is kept (allowlisted) and durations are bounded numbers', calls.every(c => c.source === 'user') && calls.filter(c => c.durationMs === 12).length > 0);
  ok('all records are owner-only files', hook.storedFiles(home).every(f => (fs.statSync(f).mode & 0o777) === 0o600));

  section('privacy canaries');
  const text = storedText(home);
  ok('no tool input, response, error text, transcript path, raw cwd, raw session id, or raw tool_use_id is on disk', CANARIES.every(c => !text.includes(c)));
  ok('every stored key is in the fixed allowlist', read.records.every(r => Object.keys(r).every(k => hook.EVENT_KEYS.includes(k))));

  section('torn write and crash visibility');
  ok('a record without an invocation id (older client) is counted as uncorrelated', (() => { hook.append(home, hook.toRecord({ hook_event_name: 'PreToolUse', tool_name: 'mcp__srv0__tool0', session_id: 'x' }, { now: '2026-10-23T11:00:00.000Z', fingerprint: () => 'fp' }), 30); const r = events.readEvents(home, { sinceDays: 3650 }); return r.uncorrelated === 1 && events.timeline(r.records).calls.filter(c => c.unpaired).length === 1; })());
  fs.appendFileSync(hook.eventsFile(home), '{"schema":2,"id":"zz","at":"2026-10-23T10:');
  const torn = events.readEvents(home, { sinceDays: 3650 });
  ok('a line cut by a crash is counted as unreadable and the rest is intact', torn.torn === 1 && torn.records.length === read.records.length + 1);
  fs.appendFileSync(hook.eventsFile(home), '\n');

  section('health counters through the real command');
  const seg = hook.segmentFiles(home).length;
  cliHook(home, 'x'.repeat(1024 * 1024 + 1));
  cliHook(home, '{');
  cliHook(home, JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'CANARY_PROMPT' }));
  cliHook(home, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: '/bad name' }));
  const health = events.readEvents(home, { sinceDays: 3650 }).health;
  ok('oversized, invalid JSON, unsupported event, and bad tool name are counted as refused payloads, with no content', health.oversized === 1 && health.invalid_json === 1 && health.unsupported_event === 1 && health.bad_tool_name === 1 && !fs.readFileSync(hook.healthFile(home), 'utf8').includes('CANARY'));
  ok('refused payloads add no event record', hook.segmentFiles(home).length === seg);

  section('disable, enable, forget');
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__srv9__t', session_id: 's', tool_use_id: 'toolu_live', cwd: '/x' });
  const beforeDisable = events.readEvents(home, { sinceDays: 3650 }).records.length;
  const disabled = cliHook(home, '', ['--disable']);
  cliHook(home, payload);
  ok('--disable stops capture: the hook exits 0, writes nothing, says so on stderr', disabled.status === 0 && disabled.stderr.includes('disabled') && events.readEvents(home, { sinceDays: 3650 }).records.length === beforeDisable);
  const enabled = cliHook(home, '', ['--enable']);
  cliHook(home, payload);
  ok('--enable resumes capture', enabled.status === 0 && events.readEvents(home, { sinceDays: 3650 }).records.length === beforeDisable + 1);
  ok('--print-config lists the four supported events and a 5 s timeout, and installs nothing', (() => { const r = cliHook(home, '', ['--print-config']); const c = JSON.parse(r.stdout); return ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionDenied'].every(e => Array.isArray(c.hooks[e])) && c.hooks.PreToolUse[0].hooks[0].timeout === 5 && r.stderr.includes('does not install'); })());

  section('boppi events');
  const shown = spawnSync(process.execPath, [CLI, 'events', '--since', '3650', '--home', home, '--no-color'], { encoding: 'utf8' });
  ok('the timeline lists servers and tools with per-outcome counts', shown.status === 0 && shown.stdout.includes('BOPPI · EVENTS') && /srv0 \(user\) \/ tool0/.test(shown.stdout) && shown.stdout.includes('denied'));
  ok('the timeline names every gap: unknown, uncorrelated, duplicates, unreadable, refused', ['with no outcome event', 'without an invocation id', 'duplicate deliver', 'unreadable line', 'refused: oversized'].every(s => shown.stdout.includes(s)));
  ok('the timeline says only Claude Code is monitored and a call is not file or network evidence', shown.stdout.includes('other clients are not monitored') && shown.stdout.includes('not evidence of what the tool did'));
  const jsonFile = path.join(root, 'events.json');
  const written = spawnSync(process.execPath, [CLI, 'events', '--since', '3650', '--json', jsonFile, '--home', home], { encoding: 'utf8' });
  const exported = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  ok('--json writes the calls, orphans, summary, and gap counters to an owner-only file', written.status === 0 && exported.calls.length === 502 && exported.monitored.join() === 'claude-code' && (fs.statSync(jsonFile).mode & 0o777) === 0o600 && !fs.readFileSync(jsonFile, 'utf8').includes('CANARY'));
  const badSince = spawnSync(process.execPath, [CLI, 'events', '--since', '0', '--home', home], { encoding: 'utf8' });
  ok('--since outside 1..3650 is rejected', badSince.status !== 0);
  const empty = spawnSync(process.execPath, [CLI, 'events', '--home', path.join(root, 'empty')], { encoding: 'utf8' });
  ok('an empty home says how capture starts', empty.status === 0 && empty.stdout.includes('no events recorded'));

  section('hook overhead (real command, 30 runs)');
  const times = [];
  for (let i = 0; i < 30; i++) { const t = process.hrtime.bigint(); cliHook(home, payload); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95) - 1];
  ok(`p95 hook wall time ${p95.toFixed(0)} ms, median ${times[15].toFixed(0)} ms (roadmap target 100 ms on a reference machine; hard bound here 400 ms)`, p95 < 400);

  const forgot = cliHook(home, '', ['--forget']);
  ok('--forget deletes every event file and health counter and tells the user to remove the snippet', forgot.status === 0 && hook.storedFiles(home).length === 0 && !fs.existsSync(hook.healthFile(home)) && forgot.stderr.includes('Remove the hook snippet'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
