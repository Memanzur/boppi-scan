#!/usr/bin/env node
/**
 * boppi fix --narrow keeps a filesystem server and points its broad directory
 * argument at a folder inside it: refused unless the target is an existing,
 * narrower folder really inside the old one; previewed without writing;
 * applied with a backup, rescanned and graded; recorded so rollback restores
 * the exact bytes and uninstall stops while the fix is live. Raw directories
 * never reach the prediction an export or push carries.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const verify = require('../src/cli/verify');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-narrow-')));
const home = path.join(root, 'home');
const outside = path.join(root, 'outside');
for (const dir of ['.cursor', 'notes', '.ssh', 'code/app/.git']) fs.mkdirSync(path.join(home, dir), { recursive: true });
fs.mkdirSync(outside);
fs.symlinkSync(outside, path.join(home, 'escape'), 'junction');
const config = path.join(home, '.cursor', 'mcp.json');
const write = servers => { const text = JSON.stringify({ theme: 'keep-me', mcpServers: servers }, null, 2); fs.writeFileSync(config, text); return text; };
const fsEntry = dirs => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', ...dirs], env: { NODE_ENV: 'production' } });
const run = (args, extra = {}, cwd = home) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--only', 'cursor', '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(root, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' }, ...extra });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const manifest = () => { try { return JSON.parse(fs.readFileSync(path.join(home, '.boppi', 'backups', 'index.json'), 'utf8')).entries; } catch (_) { return []; } };
const original = write({ fs: fsEntry([home]), fetch: { command: 'uvx', args: ['mcp-server-fetch'] } });

section('refusals write nothing');
for (const [label, target, expect] of [
  ['a folder outside the current one', outside, 'not inside'],
  ['a link inside home that resolves outside it', path.join(home, 'escape'), 'not inside'],
  ['the same directory', home, 'already has'],
  ['a folder that does not exist', path.join(home, 'missing'), 'not an existing directory'],
  ['a secrets folder', path.join(home, '.ssh'), 'not narrower'],
]) {
  const r = run(['fix', '--server', 'fs', '--narrow', target, '--yes']);
  ok(`${label}: exit 2 and says why`, r.code === 2 && r.stderr.includes(expect), r.stderr.trim());
}
const noBroad = run(['fix', '--server', 'fetch', '--narrow', path.join(home, 'notes'), '--yes']);
ok('a server with no broad directory argument is refused', noBroad.code === 2 && noBroad.stderr.includes('nothing to narrow'), noBroad.stderr.trim());
ok('--narrow outside fix is a usage error', run(['scan', '--narrow', home]).stderr.includes('only accepted by boppi fix'));
ok('the file and the backup manifest are untouched', fs.readFileSync(config, 'utf8') === original && manifest().length === 0);

section('two broad directories are refused, not guessed');
{
  const twoDirs = write({ fs: fsEntry([home, '/']) });
  const r = run(['fix', '--server', 'fs', '--narrow', path.join(home, 'notes'), '--yes']);
  ok('exit 2 naming the count', r.code === 2 && r.stderr.includes('2 broad directory arguments'), r.stderr.trim());
  ok('file unchanged', fs.readFileSync(config, 'utf8') === twoDirs);
  write({ fs: fsEntry([home]), fetch: { command: 'uvx', args: ['mcp-server-fetch'] } });
}

section('preview without --yes');
const notes = path.join(home, 'notes');
{
  const r = run(['fix', '--server', 'fs', '--narrow', notes]);
  ok('exits 2 without a terminal and writes nothing', r.code === 2 && r.stderr.includes('--yes') && fs.readFileSync(config, 'utf8') === original && manifest().length === 0);
  ok('names the scope it narrows and predicts from a rescan', r.stdout.includes('narrows: the directory argument that covers the whole home directory') && /breaks: {2}\d of 3 exposure paths/.test(r.stdout) && r.stdout.includes('lowers:  EP-A critical to high'), r.stdout.split('\n').slice(0, 6).join(' | '));
  const diff = r.stdout.split('\n').filter(line => /^\s+[-+]\s/.test(line));
  ok('the diff changes one argument, shown as fingerprints', diff.length === 2 && diff.every(line => /path_[0-9a-f]{32}/.test(line)) && !diff.some(line => line.includes(home)), diff.join(' | '));
}

section('plan and scan suggest narrowing to the project folder');
{
  const fromNotes = run(['plan'], {}, notes);
  const fromHome = run(['plan']);
  const command = `boppi fix --server "fs" --client cursor --narrow ${JSON.stringify(notes)}`;
  ok('plan from a folder inside the broad directory adds a NARROW section with the prediction and the command', fromNotes.code === 0 && fromNotes.stdout.includes('NARROW  keep a server and limit its folder access to this project') && /narrow "fs" on Cursor: (closes \d exposure paths? \(EP-\w(, EP-\w)*\)|lowers \d \(EP-\w (critical|high|medium) to (high|medium|low)(, EP-\w \w+ to \w+)*\)).*; the server keeps its tools/.test(fromNotes.stdout) && fromNotes.stdout.includes(`then: ${command}`), fromNotes.stdout.slice(-600));
  ok('plan from the home directory itself, or from a folder outside it, suggests no narrow', fromHome.code === 0 && !fromHome.stdout.includes('NARROW') && fromHome.stdout.includes('CANDIDATE FIXES') && !run(['plan'], {}, outside).stdout.includes('NARROW'));
  const scan = run(['scan'], {}, notes);
  ok('the scan\'s next steps suggest the same narrow', scan.stdout.includes(`or keep "fs" and limit its folder access to this project (`) && scan.stdout.includes(`boppi fix --server "fs" --narrow ${JSON.stringify(notes)}`), scan.stdout.slice(-800));
  ok('a scan from home has no narrow suggestion', !run(['scan']).stdout.includes('limit its folder access'));
  const exported = path.join(root, 'plan.json');
  run(['plan', '--json', exported], {}, notes);
  ok('the plan export carries no narrow prediction and no project folder', !fs.readFileSync(exported, 'utf8').includes('narrow_scope') && !fs.readFileSync(exported, 'utf8').includes(notes));
  ok('suggesting writes nothing', fs.readFileSync(config, 'utf8') === original && manifest().length === 0);
}

section('apply, rescan and grade');
let manifestId, exportFile;
{
  const r = run(['fix', '--server', 'fs', '--narrow', notes, '--yes']);
  ok('exit 0 and the prediction is CONFIRMED', r.code === 0 && r.stdout.includes('CONFIRMED') && r.stdout.includes('narrow fs'), r.stdout.slice(-400));
  const before = JSON.parse(original), after = JSON.parse(fs.readFileSync(config, 'utf8'));
  ok('only the directory argument changed', JSON.stringify(after.mcpServers.fs.args) === JSON.stringify(['-y', '@modelcontextprotocol/server-filesystem', notes])
    && after.theme === before.theme && JSON.stringify(after.mcpServers.fs.env) === JSON.stringify(before.mcpServers.fs.env) && JSON.stringify(after.mcpServers.fetch) === JSON.stringify(before.mcpServers.fetch));
  const entry = manifest().at(-1);
  manifestId = entry && entry.id;
  ok('the manifest records a narrow_scope fix with its backup', entry && entry.action === 'narrow_scope' && entry.argIndex === 2 && fs.readFileSync(entry.backup, 'utf8') === original);
  exportFile = entry && entry.scanExport;
  const text = exportFile ? fs.readFileSync(exportFile, 'utf8') : '';
  const prediction = text ? JSON.parse(text).predictions.find(p => p.edit.action === 'narrow_scope') : null;
  ok('the export carries the narrow prediction with fingerprints, not paths', prediction && /^path_/.test(prediction.edit.from) && /^path_/.test(prediction.edit.to) && !JSON.stringify(prediction).includes(home));
  ok('no raw directory anywhere in the export', text.length > 1000 && !text.includes(notes) && !text.includes(home));
  const graded = run(['verify', exportFile]);
  const row = graded.stdout.split('\n').find(line => line.includes('narrow fs')) || '';
  ok('boppi verify <export> grades it again: CONFIRMED', row.startsWith('CONFIRMED'), row || graded.stdout.slice(-300));
}

section('uninstall waits, rollback restores');
{
  const held = run(['uninstall', '--dry-run']);
  ok('uninstall names the live narrow fix and its rollback', held.stdout.includes(`boppi rollback --id ${manifestId}`), held.stdout.slice(-300));
  const listed = run(['rollback']);
  ok('rollback lists it as a narrow', listed.stdout.includes(`${manifestId}`) && listed.stdout.includes('narrow "fs" on cursor'));
  const restored = run(['rollback', '--id', manifestId, '--yes']);
  ok('rollback restores the original bytes', restored.code === 0 && fs.readFileSync(config, 'utf8') === original, restored.stderr.trim());
  ok('uninstall no longer waits for it', !run(['uninstall', '--dry-run']).stdout.includes(`boppi rollback --id ${manifestId}`));
}

section('grading rules for narrow_scope');
{
  const prediction = JSON.parse(fs.readFileSync(exportFile, 'utf8')).predictions.find(p => p.edit.action === 'narrow_scope');
  const state = identity => new Map([[prediction.agentId, { agentId: prediction.agentId, client: prediction.client, coverageIdentity: prediction.coverageIdentity, serverNames: new Set(identity === null ? [] : ['fs']), serverIdentities: identity === null ? {} : { fs: identity }, exposureKeys: prediction.before.exposureKeys, priorities: prediction.before.priorities, coverage: { complete: true, reasons: [] } }]]);
  ok('the original entry still in place: UNRESOLVED narrow_not_applied', verify.resolvePrediction(prediction, state('not-the-narrowed-entry')).reason === 'narrow_not_applied');
  ok('the server gone: UNRESOLVED server_absent, never confirmed', verify.resolvePrediction(prediction, state(null)).reason === 'server_absent');
  ok('the narrowed entry with nothing changed: CONTRADICTED', verify.resolvePrediction(prediction, state(prediction.edit.expectedIdentity)).status === 'CONTRADICTED');
}

section('a bare ~ counts as the whole home folder');
{
  const tilde = write({ fs: fsEntry(['~']), fetch: { command: 'uvx', args: ['mcp-server-fetch'] } });
  const r = run(['fix', '--server', 'fs', '--narrow', notes, '--yes']);
  ok('fix --narrow on a server at ~ narrows it and confirms', r.code === 0 && r.stdout.includes('CONFIRMED'), r.stdout.slice(-400) + r.stderr.slice(-200));
  ok('the ~ argument is replaced by the narrower folder', JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.fs.args[2] === notes);
  const restored = run(['rollback', '--id', manifest().at(-1).id, '--yes']);
  ok('rollback restores the ~ entry byte for byte', restored.code === 0 && fs.readFileSync(config, 'utf8') === tilde);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
