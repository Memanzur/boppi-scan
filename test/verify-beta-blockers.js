#!/usr/bin/env node
/** Exact-artifact regressions for scope-bound history and evidence-bound moves. Synthetic configs only. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const PACKAGE_ROOT = process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname, '..');
const CLI = path.join(PACKAGE_ROOT, 'bin/boppi.js');
const verify = require(path.join(PACKAGE_ROOT, 'src/cli/verify'));
const { verifiedReduction } = require(path.join(PACKAGE_ROOT, 'src/cli/boppi'));
let passed = 0;
function check(name, value) { if (!value) throw new Error(name); console.log('PASS ' + name); passed++; }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-final-blockers-'));
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
function write(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); }
const fetch = { command: 'uvx', args: ['mcp-server-fetch'], env: { API_TOKEN: 'BOPPI_MOVE_SECRET_CANARY' } };
function files(home) { return { desktop: path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'), cursor: path.join(home, '.cursor/mcp.json'), code: path.join(home, '.claude.json') }; }
function run(home, args, cwd = home) {
  fs.mkdirSync(cwd, { recursive: true });
  const p = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--platform', 'darwin', '--no-color'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  if (p.status !== 0 && !([4].includes(p.status) && args[0] === 'scan' && p.stderr.includes('Scan incomplete:'))) throw new Error(p.stderr || p.stdout);
  return p.stdout;
}
function scan(home, args = [], cwd = home) { const file = path.join(root, 'scan-' + Math.random() + '.json'); run(home, ['scan', '--json', file, ...args], cwd); return { file, data: read(file) }; }
function grade(home, baseline, args = [], cwd = home) { const out = path.join(root, 'result-' + Math.random() + '.json'); const text = run(home, ['verify', baseline, '--json', out, ...args], cwd); return { ...read(out), text }; }
function latest(home) { return read(path.join(home, '.boppi/history.json')).filter(x => x.kind !== 'verification').at(-1); }
try {
  const home = path.join(root, 'scope'); const f = files(home);
  write(f.cursor, { mcpServers: { fetch } }); write(f.desktop, { mcpServers: {} });
  scan(home, ['--only', 'cursor']); scan(home, ['--only', 'claude-desktop']);
  check('selected client switch withholds history; uninspected Cursor never resolved', !!latest(home).changes.withheld && latest(home).changes.resolvedPaths === undefined);
  scan(home, ['--only', 'cursor']); write(f.cursor, { mcpServers: {} }); scan(home, ['--only', 'cursor']);
  check('same inspected coverage permits real removal history', latest(home).changes.resolvedPaths > 0 && !latest(home).changes.withheld);
  scan(home, ['--only', 'cursor,desktop']); const identity = latest(home).coverageIdentity; scan(home, ['--only', 'claude-desktop,cursor,cursor']);
  check('client aliases/order/duplicates canonicalize to same coverage', latest(home).coverageIdentity === identity && !latest(home).changes.withheld);
  const explicit1 = path.join(home, 'one.json'), explicit2 = path.join(home, 'two.json');
  write(explicit1, { mcpServers: { fetch } }); write(explicit2, { mcpServers: {} });
  scan(home, ['--config', explicit1]); scan(home, ['--config', explicit2]);
  check('different explicit files withhold comparison', !!latest(home).changes.withheld);
  scan(home, ['--only', 'claude-code'], path.join(home, 'project-a')); scan(home, ['--only', 'claude-code'], path.join(home, 'project-b'));
  check('different project blocks in same user config withhold comparison', !!latest(home).changes.withheld);
  write(f.cursor, { mcpServers: { fetch } }); scan(home, ['--only', 'cursor']); fs.writeFileSync(f.cursor, '{'); scan(home, ['--only', 'cursor']);
  check('partial unreadable scan cannot resolve history', !!latest(home).changes.withheld && !latest(home).complete);
  const versions = { complete: true, scope: 'selected', engineVersion: '1', rubricVersion: '1', exposureKeys: [] };
  const legacy = { ...versions, kind: 'verification', confirmedEliminatedKeys: ['uninspected'] };
  check('unknown legacy coverage cannot count verified reduction', verifiedReduction([legacy, versions]).stillClosed === 0 && !!verifiedReduction([legacy, versions]).withheld);
  check('different selected coverage cannot count verified reduction', verifiedReduction([{ ...legacy, coverageIdentity: 'a' }, { ...versions, coverageIdentity: 'b' }]).stillClosed === 0);

  const moveHome = path.join(root, 'move'); const m = files(moveHome);
  const filesystem = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', moveHome] };
  write(m.desktop, { mcpServers: { filesystem, fetch } }); write(m.cursor, { mcpServers: {} }); write(m.code, { mcpServers: {} });
  const before = scan(moveHome); const moves = before.data.predictions.filter(p => p.edit.server === 'fetch' && p.edit.action === 'move_server');
  check('baseline predicts two moves with source/destination identities', moves.length === 2 && moves.every(p => p.coverageIdentity && p.target.coverageIdentity && /^evidence-v1:[a-f0-9]{64}$/.test(p.target.serverIdentity)));
  write(m.desktop, { mcpServers: { filesystem } });
  let result = grade(moveHome, before.file); const rows = r => r.resolutions.filter(p => p.edit.server === 'fetch');
  check('removal-only confirms removal and neither empty-destination move', rows(result).filter(r => r.status === 'CONFIRMED').length === 1 && rows(result).filter(r => r.edit.action === 'move_server').every(r => r.reason === 'destination_server_absent'));
  check('unverified move row says absent, not graded', result.text.split('\n').filter(l => l.includes('move fetch to ')).every(l => l.includes('absent, not graded')));
  result = grade(moveHome, before.file, ['--only', 'claude-desktop']);
  check('uninspected destinations are unresolved', rows(result).filter(r => r.edit.action === 'move_server').every(r => r.reason === 'destination_not_scanned'));
  write(m.cursor, { mcpServers: { fetch } }); result = grade(moveHome, before.file);
  check('genuine same-entry move confirms only the actual destination', rows(result).find(r => r.edit.toClient === 'cursor').status === 'CONFIRMED' && rows(result).find(r => r.edit.toClient === 'claude-code').status === 'UNRESOLVED');
  write(m.cursor, { mcpServers: { fetch: { ...fetch, env: { API_TOKEN: 'changed-secret' } } } });
  check('same-name modified destination config is unresolved', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'cursor').reason === 'destination_server_changed');
  write(m.cursor, { mcpServers: { fetch } }); fs.writeFileSync(m.code, '{');
  check('unreadable destination is never confirmed', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'claude-code').status === 'UNRESOLVED');
  write(m.code, { mcpServers: {} }); write(path.join(moveHome, '.cursor/project/.keep'), {});
  fs.writeFileSync(path.join(moveHome, '.cursor/mcp.json'), '{');
  check('partial destination evidence is unresolved', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'cursor').status === 'UNRESOLVED');
  write(m.cursor, { mcpServers: { fetch, filesystem } });
  check('different destination exposures produce partial, not confirmed', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'cursor').status === 'PARTIAL');
  write(m.cursor, { mcpServers: { fetch } }); write(m.desktop, { mcpServers: { filesystem, fetch } });
  check('copy without source removal is not a verified move', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'cursor').reason === 'edit_not_applied');
  write(m.desktop, { mcpServers: { filesystem } });
  const older = JSON.parse(JSON.stringify(before.data)); older.predictions.forEach(p => { if (p.target) { delete p.target.serverIdentity; delete p.target.predictedState; } }); const oldFile = path.join(root, 'old.json'); write(oldFile, older);
  check('old move prediction without destination evidence stays unknown', rows(grade(moveHome, oldFile)).filter(r => r.edit.action === 'move_server').every(r => r.reason === 'destination_evidence_unknown'));
  const unknown = JSON.parse(JSON.stringify(before.data)); unknown.predictions.forEach(p => { delete p.coverageIdentity; }); const unknownFile = path.join(root, 'unknown.json'); write(unknownFile, unknown);
  check('legacy source coverage never confirms', grade(moveHome, unknownFile).summary.confirmed === 0);
  const changed = JSON.parse(JSON.stringify(before.data)); changed.predictions.forEach(p => { p.rubricVersion = 'unknown'; }); const changedFile = path.join(root, 'changed.json'); write(changedFile, changed);
  check('unknown analysis version never confirms', grade(moveHome, changedFile).summary.confirmed === 0);
  const states = new Map([['source', { agentId: 'source', client: { key: 'claude-desktop' }, coverageIdentity: 'known', coverage: { complete: true }, serverNames: new Set(), exposureKeys: [], priorities: {} }]]);
  const p = { ...moves[0], agentId: 'source', coverageIdentity: 'known', evidenceComplete: true };
  check('unknown destination agent stays unresolved', verify.resolvePrediction(p, states).status === 'UNRESOLVED');
  write(m.cursor, { mcpServers: {} }); write(m.code, { mcpServers: { fetch } });
  check('genuine move to Code also confirms with its built-in exposures', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'claude-code').status === 'CONFIRMED');
  write(path.join(moveHome, '.mcp.json'), {}); fs.writeFileSync(path.join(moveHome, '.mcp.json'), '{');
  check('a readable destination plus unreadable secondary file stays incomplete', rows(grade(moveHome, before.file)).find(r => r.edit.toClient === 'claude-code').reason === 'destination_incomplete');
  fs.rmSync(path.join(moveHome, '.mcp.json'));
  const baselinePartial = JSON.parse(JSON.stringify(before.data)); baselinePartial.predictions.forEach(p => { if (p.target) p.target.evidenceComplete = false; }); const partialFile = path.join(root, 'baseline-partial.json'); write(partialFile, baselinePartial);
  check('an incomplete destination baseline cannot later confirm a move', rows(grade(moveHome, partialFile)).filter(r => r.edit.action === 'move_server').every(r => r.reason === 'destination_evidence_unknown'));
  check('unknown traversal is incomplete, never safe', !verify.coverageOf({ discovery: {} }, { files: [{ status: 'found' }] }).complete);
  check('unknown file status is incomplete, never safe', !verify.coverageOf({ traversal: { complete: true } }, { files: [{ status: 'unknown' }] }).complete);
  const exported = scan(moveHome).data;
  const privacy = JSON.stringify([before.data, exported, read(path.join(moveHome, '.boppi/history.json'))]);
  check('identities and history export no raw secret or absolute home', !privacy.includes('BOPPI_MOVE_SECRET_CANARY') && !privacy.includes(moveHome));
  check('history contains no raw coverage locations', !JSON.stringify(read(path.join(home, '.boppi/history.json'))).includes(home));
  console.log(`${passed} beta-blocker checks passed`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
