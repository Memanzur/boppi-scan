#!/usr/bin/env node
/** Verify the optional monitoring prototype stays local, metadata-only, and opt-in. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hook = require('../src/cli/hook');
const settings = require('../src/cli/settings');

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-monitor-'));
const fingerprint = value => `fp-${value}`;

section('privacy-preserving event projection');
const record = hook.toRecord({
  hook_event_name: 'PostToolUse', tool_name: 'mcp__filesystem__read_file', session_id: 'secret-session',
  cwd: '/Users/example/private-project', tool_response: { content: 'PRIVATE FILE CONTENT', is_error: false, token: 'SECRET' },
}, { now: '2026-10-18T00:00:00.000Z', fingerprint });
ok('classifies MCP tools without storing payloads', record.kind === 'mcp' && record.server === 'filesystem' && record.tool === 'read_file');
ok('hashes session and fingerprints cwd', record.session !== 'secret-session' && record.cwd === 'fp-/Users/example/private-project');
ok('stores only the fixed event keys', Object.keys(record).every(key => hook.EVENT_KEYS.includes(key)) && !('content' in record));
ok('records outcome without error details', record.outcome === 'ok');

section('local append and retention');
hook.runHook({ home, install: false, printConfig: false }, { fingerprint, settings: { retentionDays: 30 } });
const input = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'mcp__fetch__fetch', session_id: 'session', cwd: '/tmp/project', tool_response: { error: 'PRIVATE ERROR', tool_input: 'PRIVATE INPUT' } });
const child = spawnSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(input)})`], { encoding: 'utf8' });
ok('test fixture is available', child.status === 0);
const file = hook.eventsFile(home);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ at: '2020-01-01T00:00:00.000Z', event: 'old' }) + '\n');
hook.append(home, record, 30);
const contents = fs.readFileSync(file, 'utf8');
ok('writes owner-only event storage', (fs.statSync(file).mode & 0o777) === 0o600);
ok('expires old events and caps the file to sanitized records', !contents.includes('2020-01-01') && !contents.includes('PRIVATE') && contents.trim().split('\n').length === 1);

section('safe settings defaults and validation');
const defaults = settings.load(home);
ok('telemetry and cloud sync default off', defaults.telemetry === false && defaults.cloudSync === false);
const changed = settings.assign(home, ['retentionDays=7']);
ok('valid retention setting persists', changed.retentionDays === 7 && settings.load(home).retentionDays === 7);
let rejected = false;
try { settings.assign(home, ['cloudSync=yes']); } catch (_) { rejected = true; }
ok('invalid settings are rejected', rejected);

section('CLI wiring');
const cli = path.join(__dirname, '..', 'bin', 'boppi.js');
const shown = spawnSync(process.execPath, [cli, 'hook', '--print-config'], { encoding: 'utf8' });
ok('hook config is printable without installing', shown.status === 0 && shown.stdout.includes('PostToolUse') && shown.stderr.includes('does not install it'));
const installed = spawnSync(process.execPath, [cli, 'hook', '--install'], { encoding: 'utf8' });
ok('installation is explicitly refused', installed.status === 2 && installed.stderr.includes('requires your approval'));
const shownSettings = spawnSync(process.execPath, [cli, 'settings', '--home', home], { encoding: 'utf8' });
ok('settings command is local and readable', shownSettings.status === 0 && shownSettings.stdout.includes('cloudSync'));

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
