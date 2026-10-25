#!/usr/bin/env node
/**
 * Regression suite for the independent review of 2026-10-24 (F-01, F-02).
 * F-01: an unreadable configuration file, a capped path search, a changed
 * engine or rubric, or a differently scoped scan can never turn an absent path
 * into a confirmed closure, in `boppi verify` or in the local history.
 * F-02: a path or URL embedded anywhere in a server argument never reaches the
 * export, the HTML report, SARIF, the terminal, the history file, or the push
 * payload.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const verify = require((process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname, '..')) + '/src/cli/verify');
const models = require((process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname, '..')) + '/src/engine/models');
const riskRubric = require((process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname, '..')) + '/src/engine/riskRubric');
const scanner = require((process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname, '..')) + '/src/engine/localMcpScanner');

const PACKAGE_ROOT = process.env.BOPPI_TEST_PACKAGE_ROOT || path.join(__dirname, '..');
const CLI = path.join(PACKAGE_ROOT, 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-review-'));
function run(args, home, cwd = home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const FETCH = { command: 'uvx', args: ['mcp-server-fetch'] };

(function main() {
  section('F-01: the review scenario, an unreadable secondary Cursor config');
  const home = path.join(root, 'partial', 'home');
  const project = path.join(home, 'project');
  writeJson(path.join(home, '.cursor', 'mcp.json'), { mcpServers: {} });
  writeJson(path.join(project, '.cursor', 'mcp.json'), { mcpServers: { fetch: FETCH } });
  const before = path.join(root, 'partial', 'before.json');
  ok('the baseline scan predicts that removing fetch closes paths', run(['scan', '--json', before, '--quiet'], home, project).code === 0 && readJson(before).predictions.some(p => p.edit.server === 'fetch' && p.predictedEliminated.length));
  fs.writeFileSync(path.join(project, '.cursor', 'mcp.json'), '{');
  const verification = path.join(root, 'partial', 'verification.json');
  const graded = run(['verify', before, '--json', verification], home, project);
  const summary = readJson(verification).summary;
  ok('verify grades nothing: UNRESOLVED evidence_incomplete, not CONFIRMED', graded.code === 0 && summary.confirmed === 0 && summary.unresolved === 1 && graded.stdout.includes('UNRESOLVED') && graded.stdout.includes('evidence_incomplete'), graded.stdout.slice(0, 300));
  ok('the table says the paths are absent but not graded, and the next step names the unreadable file', graded.stdout.includes('absent, not graded') && graded.stdout.includes('Nothing was graded: a configuration file for this agent could not be read'));
  const history = readJson(path.join(home, 'history.json'));
  const record = history.find(e => e.kind === 'verification');
  ok('the verification record stores no confirmed keys and marks itself incomplete', record && record.confirmedEliminatedKeys.length === 0 && record.complete === false && record.scope === 'full' && record.rubricVersion === riskRubric.RUBRIC_VERSION);
  run(['scan', '--quiet'], home, project);
  const shown = run(['history'], home, project).stdout;
  ok('history withholds the verified-reduction line and the scan comparison while the file is unreadable', shown.includes('VERIFIED EXPOSURE REDUCTION  withheld') && shown.includes('comparison withheld (this scan is incomplete') && !shown.includes('confirmed eliminated across'));
  const rescan = run(['scan'], home, project);
  ok('the scan report says the comparison was withheld instead of counting resolved paths', rescan.stdout.includes('comparison withheld') && !/\d+ resolved\/no longer present/.test(rescan.stdout));
  writeJson(path.join(project, '.cursor', 'mcp.json'), { mcpServers: {} });
  const repaired = run(['verify', before], home, project);
  ok('once the file is readable again and the server is really gone, the same prediction is CONFIRMED', repaired.stdout.includes('CONFIRMED') && repaired.stdout.includes('2 paths closed, as predicted'));

  section('F-01: a would-be success under changed rules or a narrower scope');
  const stale = readJson(before);
  const [first] = stale.predictions.filter(p => p.edit.server === 'fetch');
  stale.predictions = [{ ...first, predictionId: 'prediction_old_rubric', rubricVersion: '0.9.9' }, { ...first, predictionId: 'prediction_old_engine', engineVersion: '0.0.1' }];
  const staleFile = path.join(root, 'partial', 'stale.json');
  writeJson(staleFile, stale);
  const staleRun = run(['verify', staleFile], home, project);
  const staleRows = staleRun.stdout.split('\n').filter(l => l.includes('remove fetch'));
  ok('a prediction from another rubric or engine is UNRESOLVED rules_changed even though every path is gone', staleRows.length === 2 && staleRows.every(l => l.startsWith('UNRESOLVED') && l.includes('rules_changed')) && !staleRun.stdout.includes('CONFIRMED'));
  ok('the engine line no longer says statuses are still computed', staleRun.stdout.includes('those predictions are not graded') && staleRun.stdout.includes('Nothing was graded: the engine or risk rubric changed'));
  run(['scan', '--quiet'], home, project);
  const selected = run(['scan', '--only', 'cursor', '--quiet'], home, project);
  const afterSelected = run(['history'], home, project).stdout;
  ok('a narrower (--only) scan after a verification withholds the comparison instead of reporting closures', selected.code === 0 && afterSelected.includes('different scopes (full vs selected)') && afterSelected.includes('withheld'));

  section('F-01: unit rules for the traversal cap and legacy history');
  const complete = { discovery: { clients: [{ clientKey: 'cursor', label: 'Cursor', agentId: 'a1', files: [{ status: 'found' }] }] }, inventory: { mcpServers: [] }, paths: [], traversal: { complete: true } };
  const capped = { ...complete, traversal: { complete: false, reason: 'cap' } };
  complete.discovery.clients[0].coverageIdentity = 'synthetic-complete-coverage';
  const prediction = { coverageIdentity: 'synthetic-complete-coverage', evidenceComplete: true, predictionId: 'p', agentId: 'a1', client: { key: 'cursor', label: 'Cursor' }, edit: { action: 'remove_server', server: 'fetch' }, predictedEliminated: ['EP-A:a1:x'], predictedSurviving: [], engineVersion: models.ENGINE_VERSION, rubricVersion: riskRubric.RUBRIC_VERSION };
  ok('a complete rescan with the server gone confirms', verify.resolvePrediction(prediction, verify.currentState(complete)).status === 'CONFIRMED');
  const cappedResult = verify.resolvePrediction(prediction, verify.currentState(capped));
  ok('a capped path search is UNRESOLVED evidence_incomplete with the cap named', cappedResult.status === 'UNRESOLVED' && cappedResult.reason === 'evidence_incomplete' && cappedResult.coverage.join() === 'traversal_incomplete');
  const unreadable = { ...complete, discovery: { clients: [{ ...complete.discovery.clients[0], files: [{ status: 'found' }, { status: 'unreadable' }] }] } };
  ok('an unreadable file on the agent is UNRESOLVED evidence_incomplete', verify.resolvePrediction(prediction, verify.currentState(unreadable)).reason === 'evidence_incomplete');
  const stillThere = { ...capped, inventory: { mcpServers: [{ agentId: 'a1', name: 'fetch' }] } };
  ok('an unapplied edit is still reported as edit_not_applied before any coverage question', verify.resolvePrediction(prediction, verify.currentState(stillThere)).reason === 'edit_not_applied');
  const legacyHome = path.join(root, 'legacy', 'home');
  writeJson(path.join(legacyHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), { mcpServers: { fetch: FETCH } });
  writeJson(path.join(legacyHome, 'history.json'), [{ schemaVersion: 1, scannedAt: '2026-01-01T00:00:00.000Z', scannerVersion: '0.3.0', engineVersion: models.ENGINE_VERSION, agents: 1, mcpServers: 3, exposurePaths: 5, pathIds: ['old1', 'old2', 'old3', 'old4', 'old5'], exposureKeys: ['k1', 'k2', 'k3', 'k4', 'k5'] },
    { schemaVersion: 1, kind: 'verification', verifiedAt: '2026-01-02T00:00:00.000Z', scannerVersion: '0.3.0', engineVersion: models.ENGINE_VERSION, summary: { confirmed: 1, partial: 0, contradicted: 0, unresolved: 0 }, confirmedEliminatedKeys: ['k1', 'k2'], exposureKeys: [] }]);
  const legacyScan = run(['scan'], legacyHome, legacyHome);
  const legacyHistory = run(['history'], legacyHome, legacyHome).stdout;
  ok('a legacy history entry without completeness records is never compared for resolved paths', legacyScan.stdout.includes('comparison withheld: the earlier scan predates completeness records') && !legacyScan.stdout.includes('resolved/no longer present'));
  ok('a legacy verification is not counted as still-closed reduction', legacyHistory.includes('withheld') && !legacyHistory.includes('2 exposure paths confirmed eliminated'));

  section('F-02: embedded paths and URLs in arguments');
  const canary = 'BOPPI_REVIEW_CANARY';
  const samples = {
    equals: `--data-dir=/Volumes/${canary}_eq/client-private`,
    colon: `root:~/${canary}_colon/notes`,
    quoted: `"C:\\Users\\${canary}_win\\x"`,
    unc: `\\\\${canary}_share\\dir`,
    fileUrl: `file:///tmp/${canary}_file`,
    envHome: `$HOME/${canary}_env/x`,
    bracedEnv: `\${HOME}/${canary}_braced`,
    urlPath: `--url=https://api.example.com/${canary}_urlpath`,
    list: `--allow=/a/${canary}_l1,/b/${canary}_l2`,
    inlineCreds: `--dsn=postgres://user:${canary}_pw@db.example.com/${canary}_db`,
  };
  const sanitized = scanner.sanitizeArguments(Object.values(samples));
  ok('no sanitized argument carries the canary', sanitized.every(a => !a.includes(canary)), sanitized.join(' | '));
  ok('the structure around the path survives (flag names, separators, origins)', sanitized[0].startsWith('--data-dir=path_') && sanitized[1].startsWith('root:path_') && sanitized[7] === '--url=https://api.example.com' && /^--allow=path_[0-9a-f]+,path_[0-9a-f]+$/.test(sanitized[8]));
  const kept = scanner.sanitizeArguments(['@modelcontextprotocol/server-github', '-y', 'src/relative/file', './rel', 'a=b', 'mcp-server-fetch', '--port=8080']);
  ok('package specs, relative names, and plain flags are unchanged', kept.join('|') === '@modelcontextprotocol/server-github|-y|src/relative/file|./rel|a=b|mcp-server-fetch|--port=8080');

  section('F-02: every output channel on the review configuration plus the embedded cases');
  const privacyHome = path.join(root, 'privacy', 'home');
  const privacyProject = path.join(privacyHome, 'project');
  fs.mkdirSync(privacyProject, { recursive: true });
  writeJson(path.join(privacyHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), {
    mcpServers: {
      example: { command: `/Volumes/${canary}_cmd/bin/node`, args: Object.values(samples), env: { PLAIN: `${canary}_envvalue`, DB_PASSWORD: `${canary}_secret` } },
      fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', `/Users/${canary}_fsroot/Documents`] },
      remote: { url: `https://host.example/${canary}_remotepath?sig=${canary}_sig` },
    },
  });
  const out = name => path.join(root, 'privacy', name);
  const scanRun = run(['scan', '--json', out('export.json'), '--html', out('report.html'), '--sarif', out('report.sarif')], privacyHome, privacyProject);
  fs.writeFileSync(out('terminal.log'), scanRun.stdout + scanRun.stderr);
  const pushRun = run(['push', '--dry-run', '--url', 'http://127.0.0.1:1'], privacyHome, privacyProject);
  fs.writeFileSync(out('push.log'), pushRun.stdout + pushRun.stderr);
  const planRun = run(['plan', '--diff'], privacyHome, privacyProject);
  fs.writeFileSync(out('plan.log'), planRun.stdout + planRun.stderr);
  const askRun = run(['ask', '--file', out('export.json'), '--question', 'What can my AI tools access?'], privacyHome, privacyProject);
  fs.writeFileSync(out('ask.log'), askRun.stdout + askRun.stderr);
  const demoRun = run(['demo', '--html', out('demo.html')], privacyHome, privacyProject);
  fs.writeFileSync(out('demo.log'), demoRun.stdout + demoRun.stderr);
  ok('scan, push --dry-run, plan, ask and demo all ran', scanRun.code === 0 && pushRun.code === 0 && planRun.code === 0 && askRun.code === 0 && demoRun.code === 0, [scanRun.code, pushRun.code, planRun.code, askRun.code, demoRun.code].join());
  for (const name of ['export.json', 'report.html', 'report.sarif', 'terminal.log', 'push.log', 'plan.log', 'ask.log', 'demo.html']) {
    const text = fs.readFileSync(out(name), 'utf8');
    ok(`${name} carries no embedded path, command path, URL path, or env value canary`, !text.includes(canary), (text.match(new RegExp(`${canary}_[a-z0-9]+`, 'g')) || []).join(','));
  }
  ok('the local history file carries no canary', !fs.readFileSync(path.join(privacyHome, 'history.json'), 'utf8').includes(canary));
  const exported = readJson(out('export.json'));
  const example = exported.inventory.real.mcpServers.find(s => s.name === 'example');
  ok('the export still records the sanitized argument structure and the command basename', example && example.arguments.some(a => a.startsWith('--data-dir=path_')) && example.command === 'node');
  ok('the push payload still carries the sanitized arguments for the record', pushRun.stdout.includes('"--data-dir=path_'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
