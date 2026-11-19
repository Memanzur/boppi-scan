#!/usr/bin/env node
/**
 * Scores the held-out corpus separately from test/corpus.
 * Prints precision and recall per severity, a worst-severity confusion
 * matrix, and every miss. Does not feed the tuning gate.
 * No network.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const corpus = require('./corpus');

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const RANK = ['none', 'low', 'medium', 'high', 'critical'];
const BAR = 0.8;
const CLIENTS = ['cursor', 'claude-desktop', 'claude-code', 'windsurf', 'cline', 'roo', 'codex', 'vscode'];

function loadScanner(root) {
  const abs = path.resolve(root);
  return {
    root: abs,
    parse: require(path.join(abs, 'src/cli/discovery/parse')),
    simulate: require(path.join(abs, 'src/cli/simulate')),
    risk: require(path.join(abs, 'src/engine/agentRiskEngine')),
    securityGraph: require(path.join(abs, 'src/engine/securityGraph')),
    exposure: require(path.join(abs, 'src/engine/exposurePathEngine')),
  };
}

function ratio(hit, total) {
  if (!total) return null;
  return hit / total;
}

function formatRatio(value, hit, total) {
  if (value == null) return `undefined (0/${total})`;
  return `${value.toFixed(3)} (${hit}/${total})`;
}

function substitute(value, home) {
  if (typeof value === 'string') return value.split('__HOME__').join(home);
  if (Array.isArray(value)) return value.map(item => substitute(item, home));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = substitute(child, home);
    return out;
  }
  return value;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function render(client, servers) {
  if (client === 'codex') {
    const lines = [];
    for (const [name, spec] of Object.entries(servers)) {
      lines.push(`[mcp_servers.${name}]`);
      if (typeof spec.command === 'string') lines.push(`command = ${tomlString(spec.command)}`);
      if (Array.isArray(spec.args)) lines.push(`args = [${spec.args.map(tomlString).join(', ')}]`);
      if (typeof spec.url === 'string') lines.push(`url = ${tomlString(spec.url)}`);
      if (spec.disabled === true) lines.push('disabled = true');
      if (spec.enabled === false) lines.push('enabled = false');
      lines.push('');
      if (spec.env && typeof spec.env === 'object') {
        lines.push(`[mcp_servers.${name}.env]`);
        for (const [key, val] of Object.entries(spec.env)) lines.push(`${key} = ${tomlString(val)}`);
        lines.push('');
      }
    }
    return lines.join('\n');
  }
  if (client === 'vscode') return JSON.stringify({ inputs: [], servers }, null, 2);
  return JSON.stringify({ mcpServers: servers }, null, 2);
}

function parseDocument(client, document, parse) {
  if (client === 'codex') return parse.codexServers(document);
  const json = JSON.parse(document);
  if (client === 'vscode') return parse.vscodeServers(json);
  return parse.mapServers(json.mcpServers || json.servers);
}

function toolNames(spec) {
  if (Array.isArray(spec.tools)) {
    return spec.tools.map(item => (typeof item === 'string' ? item : item && (item.name || item.id))).filter(Boolean).sort();
  }
  if (Array.isArray(spec.autoApprove)) return spec.autoApprove.slice().sort();
  return [];
}

function activeIntent(servers) {
  const out = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || spec.disabled === true || spec.enabled === false) continue;
    out[name] = spec;
  }
  return out;
}

function parserGaps(intent, parsed) {
  const gaps = [];
  for (const [name, spec] of Object.entries(intent)) {
    const got = parsed[name];
    if (!got) {
      gaps.push(`${name} dropped`);
      continue;
    }
    if ((spec.command || '') !== (got.command || '')) gaps.push(`${name} command`);
    if (JSON.stringify(spec.args || []) !== JSON.stringify(got.args || [])) gaps.push(`${name} args`);
    if ((spec.url || '') !== (got.url || '')) gaps.push(`${name} url`);
    if (JSON.stringify(toolNames(spec)) !== JSON.stringify([...(got.tools || [])].sort())) gaps.push(`${name} tools`);
  }
  for (const name of Object.keys(parsed)) {
    if (!intent[name]) gaps.push(`${name} kept while disabled`);
  }
  return gaps;
}

function prepare(home) {
  for (const rel of ['Documents', 'src/app/docs', 'opt', 'src/app']) {
    fs.mkdirSync(path.join(home, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(home, 'src/app/app.db'), '');
  for (const file of ['runner.js', 'baker.js', 'cabinet.js', 'helper.js']) {
    fs.writeFileSync(path.join(home, 'opt', file), '// held-out fixture\n');
  }
}

function worst(values) {
  let best = 'none';
  for (const value of values) {
    if (RANK.indexOf(value) > RANK.indexOf(best)) best = value;
  }
  return best;
}

function labelFor(client) {
  const labels = {
    cursor: 'Cursor',
    'claude-desktop': 'Claude Desktop',
    'claude-code': 'Claude Code',
    vscode: 'VS Code',
    windsurf: 'Windsurf',
    cline: 'Cline',
    roo: 'Roo Code',
    codex: 'Codex CLI',
  };
  return labels[client] || client;
}

function scanCase(entry, home, scanner) {
  const servers = substitute(entry.servers, home);
  const document = render(entry.client, servers);
  const parsed = parseDocument(entry.client, document, scanner.parse);
  const gaps = parserGaps(activeIntent(servers), parsed);
  const started = process.hrtime.bigint();
  const inventory = scanner.simulate.clientInventory({
    mergedServers: parsed,
    clientKey: entry.client,
    label: labelFor(entry.client),
    source: entry.client,
    configPath: path.join(home, `${entry.id}.json`),
    observedAt: '2026-11-19T00:00:00.000Z',
    home,
  });
  const agent = inventory.agents[0];
  const assessed = scanner.risk.assess(agent, inventory.permissions, inventory.mcpServers, { now: '2026-11-19T00:00:00.000Z' });
  const paths = scanner.exposure.findPaths(scanner.securityGraph.buildGraph({
    agents: inventory.agents,
    integrations: [],
    permissions: inventory.permissions,
    mcpServers: inventory.mcpServers,
  }));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const predicted = new Set();
  for (const finding of assessed.findings) {
    if (!finding.status || finding.status === 'open') predicted.add(finding.severity);
  }
  for (const item of paths) predicted.add(item.severity);
  const capabilities = {};
  for (const [name, inference] of Object.entries(inventory.inferenceByServer || {})) {
    capabilities[name] = {
      capabilities: inference.capabilities || [],
      grades: inference.capabilityGrades || {},
    };
  }
  return {
    elapsedMs,
    predicted,
    findings: assessed.findings,
    paths,
    capabilities,
    gaps,
    error: '',
  };
}

function integrityErrors(cases) {
  const errors = [];
  const count = corpus.serverCount;
  if (count < 80) errors.push(`held-out corpus has ${count} servers, need at least 80`);
  const clients = new Set(cases.map(entry => entry.client));
  for (const client of CLIENTS) {
    if (!clients.has(client)) errors.push(`held-out corpus has no ${client} case`);
  }
  const flat = cases.flatMap(entry => Object.values(entry.servers));
  if (!flat.some(spec => spec && spec.disabled === true)) errors.push('held-out corpus has no disabled server');
  if (!flat.some(spec => Array.isArray(spec.tools) && spec.tools.some(item => item && typeof item === 'object'))) {
    errors.push('held-out corpus has no tool object');
  }
  if (!flat.some(spec => typeof spec.url === 'string' && /127\.0\.0\.1|\[::1\]|localhost/.test(spec.url))) {
    errors.push('held-out corpus has no loopback URL');
  }
  if (!flat.some(spec => typeof spec.url === 'string' && spec.url.startsWith('https://'))) {
    errors.push('held-out corpus has no remote https URL');
  }
  const ids = new Set();
  for (const entry of cases) {
    if (ids.has(entry.id)) errors.push(`duplicate id ${entry.id}`);
    ids.add(entry.id);
    for (const severity of entry.expectedSeverities) {
      if (!SEVERITIES.includes(severity)) errors.push(`${entry.id} has unknown severity ${severity}`);
    }
  }
  return errors;
}

function score(rows) {
  const metrics = {};
  for (const severity of SEVERITIES) {
    const truth = rows.filter(row => row.expected.has(severity));
    const guess = rows.filter(row => row.predicted.has(severity));
    const tp = guess.filter(row => row.expected.has(severity)).length;
    const fp = guess.length - tp;
    const fn = truth.length - tp;
    metrics[severity] = {
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
      tp, fp, fn,
    };
  }
  return metrics;
}

function matrix(rows) {
  const table = {};
  for (const expected of RANK) {
    table[expected] = {};
    for (const predicted of RANK) table[expected][predicted] = 0;
  }
  for (const row of rows) {
    table[worst(row.expected)][worst(row.predicted)] += 1;
  }
  return table;
}

function capabilityLine(row) {
  const parts = [];
  for (const [name, info] of Object.entries(row.capabilities || {})) {
    const caps = info.capabilities.length ? info.capabilities.join(',') : 'none';
    const grades = Object.entries(info.grades).map(([cap, grade]) => `${cap}:${grade}`).join(',');
    parts.push(`${name}[${caps}${grades ? ` ${grades}` : ''}]`);
  }
  return parts.join(' ');
}

function findingLine(row) {
  const findings = (row.findings || []).map(item => `${item.ruleId || 'finding'}:${item.severity}`);
  const paths = (row.paths || []).map(item => `${item.templateId}:${item.severity}`);
  return [...findings, ...paths].join(' ') || 'no finding and no path';
}

function explain(row) {
  if (row.error) return `scan failed: ${row.error}`;
  if (row.gaps.length) return `parser did not preserve the config (${row.gaps.join(', ')})`;
  const caps = new Set(Object.values(row.capabilities || {}).flatMap(info => info.capabilities || []));
  const criticalMiss = row.expected.has('critical') && !row.predicted.has('critical');
  if (criticalMiss) {
    const grades = Object.values(row.capabilities || {}).flatMap(info => Object.values(info.grades || {}));
    if (!caps.size) return 'no capability was inferred from the package, URL, or declared tools';
    if (grades.length && grades.every(grade => grade === 'substring')) {
      return 'only substring evidence was inferred, so the critical gate withheld the finding';
    }
    if (!caps.has('network_access') && !caps.has('shell_access') && !caps.has('code_execution')) {
      return 'file or data access was inferred without network, shell, or code execution';
    }
    if (caps.has('shell_access') && !caps.has('network_access') && !caps.has('filesystem_access')) {
      return 'shell was inferred without network or filesystem, so the chain rules did not fire';
    }
    if (caps.has('filesystem_access') && !caps.has('network_access') && !caps.has('shell_access')) {
      return 'filesystem was inferred without an external destination or shell';
    }
    return `inferred ${[...caps].sort().join(', ')} but no critical finding or critical path was emitted`;
  }
  if (!row.expected.has('critical') && row.predicted.has('critical')) {
    return 'a critical finding or path was emitted for a config whose grants do not form that chain';
  }
  return findingLine(row);
}

function missRows(rows) {
  return rows.filter(row => {
    for (const severity of SEVERITIES) {
      if (row.expected.has(severity) !== row.predicted.has(severity)) return true;
    }
    return false;
  });
}

function report(root) {
  const lines = [];
  const say = line => lines.push(line);
  const cases = corpus.cases;
  const errors = integrityErrors(cases);
  say(`held-out cases ${cases.length} servers ${corpus.serverCount}`);
  if (errors.length) {
    for (const error of errors) say(`FAIL ${error}`);
    return { ok: false, text: lines.join('\n'), metrics: null, rows: [] };
  }

  const scanner = loadScanner(root);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-heldout-'));
  prepare(home);
  const rows = [];
  for (const entry of cases) {
    const expected = new Set(entry.expectedSeverities || []);
    try {
      const result = scanCase(entry, home, scanner);
      rows.push({ entry, expected, ...result });
    } catch (err) {
      rows.push({
        entry, expected, predicted: new Set(), findings: [], paths: [], capabilities: {},
        gaps: [], error: err && err.message ? err.message : String(err), elapsedMs: 0,
      });
    }
  }
  fs.rmSync(home, { recursive: true, force: true });

  const metrics = score(rows);
  for (const severity of SEVERITIES) {
    const item = metrics[severity];
    say(`${severity} precision ${formatRatio(item.precision, item.tp, item.tp + item.fp)} recall ${formatRatio(item.recall, item.tp, item.tp + item.fn)}`);
  }

  say('confusion matrix (worst expected severity by worst predicted severity)');
  say(`expected\\predicted ${RANK.map(item => item.padStart(10)).join('')}`);
  const table = matrix(rows);
  for (const expected of RANK) {
    const cells = RANK.map(predicted => String(table[expected][predicted]).padStart(10));
    say(`${expected.padEnd(18)} ${cells.join('')}`);
  }

  const critical = metrics.critical;
  const precisionOk = critical.precision != null && critical.precision >= BAR;
  const recallOk = critical.recall != null && critical.recall >= BAR;
  const thrown = rows.filter(row => row.error);
  if (thrown.length) say(`scan errors ${thrown.length}`);

  const misses = missRows(rows);
  const criticalMisses = misses.filter(row => row.expected.has('critical') !== row.predicted.has('critical'));
  say(`mismatched cases ${misses.length}`);
  say('critical misses');
  if (!criticalMisses.length) say('none');
  for (const row of criticalMisses) {
    const kind = row.expected.has('critical') ? 'false-negative' : 'false-positive';
    say(`${kind} ${row.entry.id} ${row.entry.client} expected ${[...row.expected].join('+') || 'none'} predicted ${[...row.predicted].join('+') || 'none'}`);
    say(`  why: ${explain(row)}`);
    say(`  evidence: ${capabilityLine(row) || 'no server survived parsing'}`);
    say(`  output: ${findingLine(row)}`);
    if (row.entry.rationale) say(`  label: ${row.entry.rationale}`);
  }

  const other = misses.filter(row => row.expected.has('critical') === row.predicted.has('critical'));
  if (other.length) {
    say('other severity misses');
    for (const row of other) {
      say(`${row.entry.id} expected ${[...row.expected].join('+') || 'none'} predicted ${[...row.predicted].join('+') || 'none'}`);
      say(`  why: ${explain(row)}`);
      say(`  evidence: ${capabilityLine(row) || 'no server survived parsing'}`);
      say(`  output: ${findingLine(row)}`);
    }
  }

  say('critical recall by client');
  for (const client of CLIENTS) {
    const subset = rows.filter(row => row.entry.client === client);
    const truth = subset.filter(row => row.expected.has('critical'));
    const hit = truth.filter(row => row.predicted.has('critical')).length;
    say(`${client} ${formatRatio(ratio(hit, truth.length), hit, truth.length)} of ${subset.length} cases`);
  }

  const ok = precisionOk && recallOk && thrown.length === 0;
  say(ok
    ? `held-out PASS critical precision ${critical.precision.toFixed(3)} recall ${critical.recall.toFixed(3)}`
    : `held-out FAIL critical precision ${critical.precision == null ? 'undefined' : critical.precision.toFixed(3)} recall ${critical.recall == null ? 'undefined' : critical.recall.toFixed(3)} (bar ${BAR.toFixed(2)}, scan errors ${thrown.length})`);
  return { ok, text: lines.join('\n'), metrics, rows };
}

function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '..');
  const result = report(root);
  console.log(result.text);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { report, loadScanner };
