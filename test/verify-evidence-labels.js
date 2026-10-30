#!/usr/bin/env node
/**
 * AG-08: config-derived facts are never worded as runtime observation, and
 * every finding states its basis and what was not checked. The stored
 * evidenceClass value 'observed' (a record read from a config file) stays in
 * the export and push schema; only the words people read change. Scans a
 * config-only synthetic home and renders every surface: terminal, plan,
 * paths, ask, HTML report with its graph data, SARIF, demo terminal and demo
 * page.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const BIN = path.join(__dirname, '..', 'bin', 'boppi.js');
const ENV = { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', NO_COLOR: '1' };
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: ENV, ...opts });

// Sentences that say runtime was NOT observed, define the runtime layer, or name the raw schema value next to its meaning.
const NEGATIONS = [
  'no tool call, data transfer, or attack was observed',
  'What configured, inferred, observed, and verified mean',
  'Observed:</b> requires runtime evidence',
  'Observed: requires runtime evidence',
  'Configuration and observed inactivity cannot establish',
  'source class: observed (configuration metadata, not runtime)',
  'potential access, not observed behavior',
];
const OBSERVATION = /\b(observed|seen|we saw|boppi saw)\b/i;
function residue(text) {
  let rest = text;
  for (const phrase of NEGATIONS) rest = rest.split(phrase).join('');
  const hit = rest.match(new RegExp(`.{0,80}${OBSERVATION.source}.{0,60}`, 'i'));
  return hit ? hit[0] : null;
}

/** Every string a person can read in embedded view data; the raw evidenceClass value is schema, not wording. */
function readableStrings(value, key = '') {
  if (typeof value === 'string') return key === 'evidenceClass' ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(v => readableStrings(v, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => readableStrings(v, k));
  return [];
}
const embedded = (html, id) => JSON.parse((html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`)) || [, 'null'])[1]);
const visibleText = html => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-evidence-labels-')));
const out = path.join(home, 'out');
fs.mkdirSync(path.join(home, '.cursor'));
fs.mkdirSync(out);
fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
  fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
  gh: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'placeholder' } },
} }));
const base = ['--home', home, '--cwd', home, '--no-color', '--history-file', path.join(out, 'history.json')];
const file = name => path.join(out, name);

try {
  const scan = run(['scan', ...base, '--verbose', '--json', file('scan.json'), '--html', file('report.html'), '--sarif', file('report.sarif')]);
  const exported = JSON.parse(fs.readFileSync(file('scan.json'), 'utf8'));
  const findings = exported.inventory.real.findings.filter(f => f.status === 'open');
  const html = fs.readFileSync(file('report.html'), 'utf8');
  const sarif = JSON.parse(fs.readFileSync(file('report.sarif'), 'utf8'));
  const demoHome = path.join(home, 'demo-home');
  const demo = run(['demo', '--home', demoHome, '--no-color']);
  run(['demo', '--html', file('demo.html'), '--home', demoHome]);
  const demoHtml = fs.readFileSync(file('demo.html'), 'utf8');
  const asks = ['What can my AI tools access?', 'Which agents have potentially sensitive permissions?', 'Which permissions appear unnecessary?']
    .map(question => run(['ask', '--file', file('scan.json'), '--question', question, '--no-color']).stdout).join('\n');

  section('the fixture is config-only and the schema value is kept');
  ok('the scan reads config and has findings to word', scan.status === 0 && findings.length >= 2, `exit ${scan.status}, ${findings.length} findings`);
  ok('the export still stores evidenceClass "observed" for config records (Cloud schema)', exported.inventory.real.permissions.some(p => p.source.evidenceClass === 'observed'));
  ok('no hook events, so nothing here is runtime evidence', !fs.existsSync(path.join(home, '.boppi', 'events')));

  section('no surface words config data as observed or seen');
  const surfaces = {
    'terminal scan': scan.stdout,
    'plan': run(['plan', ...base]).stdout,
    'paths': run(['paths', ...base]).stdout,
    'ask': asks,
    'HTML report text': visibleText(html),
    'HTML graph data': readableStrings(embedded(html, 'boppi-data')).join('\n'),
    'SARIF': readableStrings(sarif).join('\n'),
    'demo terminal': demo.stdout,
    'demo page text': visibleText(demoHtml),
    'demo page data': readableStrings(embedded(demoHtml, 'boppi-demo-data')).join('\n'),
  };
  for (const [name, text] of Object.entries(surfaces)) {
    ok(`${name}: rendered`, text.length > 200, `${text.length} chars`);
    const hit = residue(text);
    ok(`${name}: no observed/seen phrasing for config data`, !hit, hit);
  }
  ok('graph view labels config edges "configured"', readableStrings(embedded(html, 'boppi-data')).some(s => /Reached from|configured/.test(s)) && /; configured, confidence/.test(surfaces['HTML graph data']));

  section('each finding states its basis and what was not checked');
  const lines = scan.stdout.split('\n');
  for (const f of findings) {
    const at = lines.findIndex(l => l.includes(f.ruleId) && l.includes(f.title));
    ok(`terminal ${f.ruleId}: based on + not checked`, at >= 0 && /based on: \S/.test(lines[at + 1] || '') && /not checked: .*potential access/.test(lines[at + 2] || ''), lines.slice(at, at + 3).join(' | '));
  }
  const findingsTable = (html.match(/<h2>Findings[\s\S]*?<\/table>/) || [''])[0];
  ok('HTML report: one basis and one not-checked line per finding', (findingsTable.match(/<b>Based on:<\/b> \S/g) || []).length === findings.length && (findingsTable.match(/<b>Not checked:<\/b>/g) || []).length === findings.length);
  const results = sarif.runs[0].results.filter(r => /^(AE|EP)-/.test(r.ruleId));
  ok('SARIF: every finding and path result carries basedOn and notChecked', results.length >= findings.length && results.every(r => r.properties.basedOn && r.properties.basedOn.length && r.properties.notChecked && r.properties.notChecked.length));
  ok('SARIF: finding messages state basis in the text a viewer shows', results.filter(r => r.ruleId.startsWith('AE-')).every(r => /Based on: \S.*Not checked: /.test(r.message.text)));
  ok('graph view: every path says what was not checked', embedded(html, 'boppi-data').paths.every(p => p.assessment && p.assessment.unknowns.length));
  ok('demo terminal: findings state their basis', /based on: \S/.test(demo.stdout) && /not checked: /.test(demo.stdout));

  section('rescan outcomes are not called observations');
  const verifySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'verify.js'), 'utf8');
  const rescanSources = ['watch.js', 'remediate.js'].map(n => fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', n), 'utf8')).join('\n');
  ok('verify table compares prediction to rescan', verifySource.includes("'predicted vs rescan'") && !verifySource.includes('predicted vs observed'));
  ok('watch and fix say rescan, not observed', !/observed by rescan|eliminated, observed/.test(rescanSources));
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
