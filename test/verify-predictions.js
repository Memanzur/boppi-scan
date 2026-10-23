#!/usr/bin/env node
/** Verify suite for `boppi verify`: each resolver status from real before/after scans, and the contradiction fixture. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'reroute.json');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', cwd: home });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const desktopConfig = home => path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
function writeDesktop(home, servers) {
  fs.mkdirSync(path.dirname(desktopConfig(home)), { recursive: true });
  fs.writeFileSync(desktopConfig(home), JSON.stringify({ mcpServers: servers }));
}
function without(servers, name) { const copy = { ...servers }; delete copy[name]; return copy; }
const statusOf = (out, server) => (out.stdout.split('\n').find(l => l.includes(`remove ${server}`)) || '').trim().split(/\s+/)[0];
const rowOf = (out, server) => out.stdout.split('\n').find(l => l.includes(`remove ${server}`)) || '';

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-verify-'));
  const home = path.join(root, 'home');
  const servers = {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    'code-runner': { command: 'npx', args: ['-y', 'e2b-code-interpreter'], env: { E2B_API_KEY: 'SUPERSECRETVALUE' } },
  };
  writeDesktop(home, servers);
  const before = path.join(root, 'before.json');
  ok('baseline scan exports predictions', runCli(['scan', '--only', 'claude-desktop', '--json', before, '--quiet'], home).code === 0);
  const exported = JSON.parse(fs.readFileSync(before, 'utf8'));
  const byServer = Object.fromEntries(exported.predictions.map(p => [p.edit.server, p]));
  ok('fixture predicts three edits', Object.keys(byServer).sort().join() === 'code-runner,fetch,filesystem');

  section('CONFIRMED and UNRESOLVED(edit_not_applied) from a real edit');
  writeDesktop(home, without(servers, 'filesystem'));
  const confirmed = runCli(['verify', before, '--only', 'claude-desktop'], home);
  ok('verify exits 0', confirmed.code === 0);
  ok('the applied edit is CONFIRMED', statusOf(confirmed, 'filesystem') === 'CONFIRMED');
  ok('edits that were not applied are UNRESOLVED edit_not_applied', ['fetch', 'code-runner'].every(s => statusOf(confirmed, s) === 'UNRESOLVED' && rowOf(confirmed, s).includes('edit_not_applied')));
  ok('summary line counts statuses', confirmed.stdout.includes('1 confirmed · 0 partial · 0 contradicted · 2 unresolved'));
  ok('the next step names the confirmed fix, how many paths closed, and what remains', /Next: 1 fix confirmed as predicted \(1 path closed, \d+ remaining\); 2 other predictions not graded because that edit was not applied\./.test(confirmed.stdout) && !confirmed.stdout.includes('Nothing could be graded yet'));
  ok('the table counts closed paths, never "gone"', rowOf(confirmed, 'filesystem').includes('1 of ') && rowOf(confirmed, 'filesystem').includes('closed / 1 of ') && !confirmed.stdout.includes(' gone'));
  ok('no contradiction file is written for confirmed or unresolved', !fs.readdirSync(home).some(f => f.startsWith('boppi-contradiction-')));

  section('UNRESOLVED(agent_not_scanned) when the agent is missing from the rescan');
  const notScanned = runCli(['verify', before, '--only', 'cursor'], home);
  ok('every prediction is UNRESOLVED agent_not_scanned', notScanned.code === 0 && ['filesystem', 'fetch', 'code-runner'].every(s => statusOf(notScanned, s) === 'UNRESOLVED' && rowOf(notScanned, s).includes('agent_not_scanned')));
  ok('with nothing graded the next step still says so', notScanned.stdout.includes('Next: Nothing could be graded yet'));

  section('PARTIAL and CONTRADICTED from over-claiming predictions');
  const tampered = JSON.parse(JSON.stringify(exported));
  const keys = byServer.fetch.before.exposureKeys;
  const epA = keys.find(k => k.startsWith('EP-A:'));
  // The pre-fix engine claimed removing one of two external routes eliminated the exposure. That claim must now grade CONTRADICTED.
  const contradictedPrediction = { ...byServer.fetch, predictionId: 'prediction_contradicted', edit: { action: 'remove_server', server: 'code-runner' }, predictedEliminated: [epA], predictedSurviving: keys.filter(k => k !== epA) };
  const partialPrediction = { ...byServer['code-runner'], predictionId: 'prediction_partial', predictedEliminated: keys, predictedSurviving: [] };
  const staleEngine = { ...byServer.fetch, predictionId: 'prediction_old_engine', engineVersion: '0.0.1' };
  const staleRubric = { ...byServer.fetch, predictionId: 'prediction_old_rubric', rubricVersion: '1.0.1' };
  tampered.predictions = [contradictedPrediction, partialPrediction, staleEngine, staleRubric];
  const tamperedFile = path.join(root, 'tampered.json');
  fs.writeFileSync(tamperedFile, JSON.stringify(tampered));
  writeDesktop(home, without(servers, 'code-runner'));
  const contradictionsDir = path.join(root, 'contradictions');
  const verificationJson = path.join(root, 'verification.json');
  const graded = runCli(['verify', tamperedFile, '--only', 'claude-desktop', '--json', verificationJson, '--contradictions-dir', contradictionsDir], home);
  ok('verify exits 0 even with contradictions', graded.code === 0);
  const rows = graded.stdout.split('\n').filter(l => l.includes('remove code-runner'));
  ok('a wholly wrong claim is CONTRADICTED', rows.some(l => l.startsWith('CONTRADICTED') && l.includes('all_predicted_eliminated_present')));
  ok('a partly wrong claim is PARTIAL', rows.some(l => l.startsWith('PARTIAL') && l.includes('some_predicted_eliminated_present')));
  ok('a prediction from another engine version is flagged engine_changed', rowOf(graded, 'fetch').includes('engine_changed') && graded.stdout.includes('engine version changed'));
  ok('a prediction from another rubric version is flagged rubric_changed', graded.stdout.split('\n').some(l => l.includes('remove fetch') && l.includes('rubric_changed')) && graded.stdout.includes('risk rubric changed since the prediction'));
  ok('a prediction records the rubric version it was made under', typeof byServer.fetch.rubricVersion === 'string' && byServer.fetch.rubricVersion === require('../src/engine/riskRubric').RUBRIC_VERSION);
  const verification = JSON.parse(fs.readFileSync(verificationJson, 'utf8'));
  ok('--json records every resolution with observed sets', verification.resolutions.length === 4 && verification.summary.contradicted === 1 && verification.summary.partial === 1 && verification.resolutions.find(r => r.predictionId === 'prediction_partial').observed.survivors.includes(epA));
  const files = fs.existsSync(contradictionsDir) ? fs.readdirSync(contradictionsDir) : [];
  ok('one contradiction fixture per PARTIAL or CONTRADICTED resolution', files.sort().join() === 'boppi-contradiction-prediction_contradicted.json,boppi-contradiction-prediction_partial.json');
  const bundle = JSON.parse(fs.readFileSync(path.join(contradictionsDir, 'boppi-contradiction-prediction_contradicted.json'), 'utf8'));
  ok('the fixture carries the prediction, both inventories, and both engine versions', bundle.prediction.predictionId === 'prediction_contradicted' && bundle.before.inventory.mcpServers.length === 3 && bundle.after.inventory.mcpServers.length === 2 && bundle.engineVersions.prediction === bundle.engineVersions.verifier);
  const serializedBundle = JSON.stringify(bundle);
  ok('the fixture is sanitized', !serializedBundle.includes('SUPERSECRETVALUE') && !serializedBundle.includes(home));

  section('Replaying an explicit config edited at another path');
  const editedCopy = path.join(root, 'reroute-without-fetch.json');
  const reroute = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const rerouteBefore = path.join(root, 'reroute-before.json');
  runCli(['scan', '--config', FIXTURE, '--source', 'claude-desktop', '--json', rerouteBefore, '--quiet'], home);
  fs.writeFileSync(editedCopy, JSON.stringify({ mcpServers: without(reroute.mcpServers, 'fetch') }));
  const replay = runCli(['verify', rerouteBefore, '--config', editedCopy, '--source', 'claude-desktop'], home);
  ok('every server on or beside the reroute path gets a prediction, including the unused slack route', JSON.parse(fs.readFileSync(rerouteBefore, 'utf8')).predictions.map(p => p.edit.server).sort().join() === 'fetch,filesystem,slack');
  ok('the single explicit client is matched by client key and flagged', replay.code === 0 && rowOf(replay, 'fetch').includes('agent_matched_by_client'));
  ok('removing fetch from the reroute fixture is CONFIRMED to eliminate nothing, and says so', statusOf(replay, 'fetch') === 'CONFIRMED' && rowOf(replay, 'fetch').includes('0 of 1 closed / 0 of 1 closed') && rowOf(replay, 'fetch').includes('no_change_predicted'));
  ok('a zero-benefit edit never reads as a fix that worked', !replay.stdout.includes('worked as predicted') && /0 paths closed, 1 remaining/.test(replay.stdout) && /not a risk-reducing fix/.test(replay.stdout));
  ok('the edits not applied in the copy stay UNRESOLVED', ['filesystem', 'slack'].every(s => statusOf(replay, s) === 'UNRESOLVED'));
  const zeroCopy = path.join(root, 'reroute-copy.json');
  fs.writeFileSync(zeroCopy, JSON.stringify(reroute));
  const zeroFix = runCli(['fix', '--server', 'fetch', '--config', zeroCopy, '--source', 'claude-desktop', '--yes'], home);
  ok('fix warns before applying an edit predicted to close no path', zeroFix.stdout.includes('note:    this edit is not predicted to close or lower any exposure path') && zeroFix.stdout.includes('no_change_predicted') && !zeroFix.stdout.includes('worked as predicted'));

  section('Unusable input');
  ok('a missing file exits 2', runCli(['verify', path.join(root, 'nope.json')], home).code === 2);
  const noPredictions = path.join(root, 'no-predictions.json');
  fs.writeFileSync(noPredictions, '{"exportVersion":2}');
  ok('an export without predictions exits 2', runCli(['verify', noPredictions], home).code === 2);
  ok('verify without a file exits 2 with usage', runCli(['verify'], home).code === 2);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
