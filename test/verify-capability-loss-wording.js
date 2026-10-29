#!/usr/bin/env node
/**
 * No surface calls a fix harmless (QA-011). An empty modeled capability loss
 * means Boppi found nothing unique, not that nothing is lost; a server whose
 * capabilities Boppi never established is "unknown". The plan table, the
 * interactive report and the demo use the same bounded wording boppi fix
 * already uses (remediate.capabilityLossText). Synthetic inputs only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { renderPlan } = require('../src/cli/plan');
const { capabilityLossText } = require('../src/cli/remediate');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const CATEGORICAL = /nothing it does not|does not (also )?get (it )?elsewhere|does not also get from another server|No capability it does not/i;
const UNKNOWN = 'unknown: Boppi has not established this server\'s capabilities; removing it may break functionality not modeled here';
const NONE_UNIQUE = 'no known unique capability identified; unmodeled functionality may still be lost';

section('the plan table, one row per case');
const path1 = { id: 'p1', exposureKey: 'EP-A:x', severity: 'high' };
const servers = {
  unknown: { id: 'mcp_00000000000000a1', agentId: 'agent_00000000000000a1', name: 'mystery', command: 'node', arguments: [], capabilities: [] },
  duplicate: { id: 'mcp_00000000000000a2', agentId: 'agent_00000000000000a1', name: 'fs-b', command: 'npx', arguments: [], capabilities: ['filesystem_access'] },
  modeled: { id: 'mcp_00000000000000a3', agentId: 'agent_00000000000000a1', name: 'fetch', command: 'uvx', arguments: [], capabilities: ['network_access'] },
};
const prediction = (server, lost, kept) => ({
  predictionId: `pred_${server.name}`, agentId: server.agentId, serverId: server.id, client: { key: 'cursor', label: 'Cursor' },
  edit: { action: 'remove_server', server: server.name }, before: { exposureKeys: ['EP-A:x'] },
  predictedEliminated: ['EP-A:x'], predictedLowered: [], predictedSurviving: [], disruption: { lost, kept },
});
const report = {
  paths: [path1], builtinResidual: [],
  inventory: { agents: [{ id: 'agent_00000000000000a1', name: 'Cursor' }], mcpServers: Object.values(servers) },
  predictions: [prediction(servers.unknown, [], []), prediction(servers.duplicate, [], ['filesystem_access']), prediction(servers.modeled, ['network_access'], [])],
  remediationPlan: null,
};
const text = renderPlan(report);
const row = name => text.split('\n').find(line => line.includes(`remove "${name}"`)) || '';
ok('a server with unknown capabilities says unknown', row('mystery').includes(UNKNOWN), row('mystery'));
ok('duplicate grants: no known unique capability, unmodeled loss possible', row('fs-b').includes(NONE_UNIQUE), row('fs-b'));
ok('a modeled loss names it and says other functionality may be lost', row('fetch').includes('network_access (modeled capabilities; other functionality may be lost)'), row('fetch'));
ok('the legend no longer calls the column the whole workflow cost', text.includes('can cost more than this column shows') && !text.includes('the workflow cost of the edit'));
ok('no categorical harmlessness anywhere in the plan', !CATEGORICAL.test(text));
ok('the table matches boppi fix wording exactly', row('mystery').includes(capabilityLossText([], servers.unknown)) && row('fs-b').includes(capabilityLossText([], servers.duplicate)));

section('a real plan of a synthetic home');
{
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-loss-wording-')));
  fs.mkdirSync(path.join(home, '.cursor'));
  fs.mkdirSync(path.join(home, 'docs'));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
    'fs-a': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  } }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'boppi.js'), 'plan', '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  ok('boppi plan prints the bounded wording and no categorical claim', r.stdout.includes('(modeled capabilities; other functionality may be lost)') && !CATEGORICAL.test(r.stdout), r.stdout.slice(0, 400));
  const html = path.join(home, 'report.html');
  const scan = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'boppi.js'), 'scan', '--html', html, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  const costLine = scan.stdout.split('\n').find(line => line.includes('cost: the agent loses')) || '';
  ok('the terminal scan root-cause cost line carries the modeled-capabilities caveat', costLine.includes('(modeled capabilities; other functionality may be lost)'), costLine || scan.stdout.slice(0, 400));
  const htmlCost = (fs.existsSync(html) ? fs.readFileSync(html, 'utf8') : '').match(/Cost: the agent loses[^<]*/);
  ok('the static HTML root-cause cost line carries the same caveat', !!htmlCost && htmlCost[0].includes('(modeled capabilities; other functionality may be lost)'), htmlCost && htmlCost[0]);
  fs.rmSync(home, { recursive: true, force: true });
}

section('the interactive report and the demo');
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'render', 'interactive.client.js'), 'utf8');
const demoSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'render', 'demo.client.js'), 'utf8');
ok('neither client script contains a categorical claim', !CATEGORICAL.test(clientSource) && !CATEGORICAL.test(demoSource));
const lossSource = (clientSource.match(/function lossText\(r\) \{[^\n]*\}/) || [''])[0];
// eslint-disable-next-line no-new-func
const lossText = lossSource ? new Function('capList', `${lossSource}; return lossText;`)(ids => ids.join(', ')) : () => '';
ok('report: unknown capabilities', lossText({ entry: { capabilities: [] }, loses: [] }).startsWith('capabilities unknown'));
ok('report: a server entry Boppi could not show is unknown too', lossText({ entry: null, loses: [] }).startsWith('capabilities unknown'));
ok('report: duplicate grants', lossText({ entry: { capabilities: ['filesystem_access'] }, loses: [] }) === NONE_UNIQUE);
ok('report: a modeled loss', lossText({ entry: { capabilities: ['network_access'] }, loses: ['network_access'] }) === 'network_access (modeled capabilities; other functionality may be lost)');
ok('demo: every remediation says whether its capabilities are known', /capabilitiesKnown: !!\(r\.entry/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'demo.js'), 'utf8')) && demoSource.includes('!fix.capabilitiesKnown'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
