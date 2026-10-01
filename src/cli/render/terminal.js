/** ANSI terminal report renderer for the Boppi CLI. */
'use strict';
const { rankPredictions } = require('../predict');

const PATH_RULE_FOR_TEMPLATE = Object.freeze({ 'EP-A': 'AE-001', 'EP-B': 'AE-002', 'EP-C': 'AE-004', 'EP-D': 'AE-003', 'EP-E': 'AE-007', 'EP-F': 'AE-005' });
const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

function makeStyle(useColor) {
  const wrap = (open, close) => value => (useColor ? `[${open}m${value}[${close}m` : String(value));
  return {
    bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39),
    green: wrap(32, 39), cyan: wrap(36, 39), magenta: wrap(35, 39), orange: wrap(33, 39),
  };
}

function severityBadge(severity, useColor) {
  if (useColor) {
    if (severity === 'critical') return '🔴 CRITICAL';
    if (severity === 'high') return '🟠 HIGH';
    if (severity === 'medium') return '🟡 MEDIUM';
    return '⚪ LOW';
  }
  return { critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW' }[severity] || severity.toUpperCase();
}

function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function chainFor(exposurePath) {
  return exposurePath.nodes.map(n => n.label).join(' -> ');
}

function coveredKeys(paths) {
  const covered = new Set();
  for (const p of paths) {
    const rule = PATH_RULE_FOR_TEMPLATE[p.templateId];
    if (rule) covered.add(`${p.agentId}:${rule}`);
  }
  return covered;
}

function plural(count, noun) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }

function editSentence(step) {
  return `Remove the "${step.edit.server}" entry from ${step.client.label}'s MCP configuration. Rescan afterward to verify the change landed.`;
}

/** The scanned config files the edit applies to, so the instruction names a real file. */
function editLocations(step, report) {
  const client = (report.discovery || []).find(c => c.clientKey === step.client.key);
  return client ? client.files.filter(f => f.status === 'found').map(f => `remove the "${step.edit.server}" entry from ${f.path}`) : [];
}

function summaryLine(report) {
  const { inventory, paths } = report;
  const criticalPaths = paths.filter(p => p.severity === 'critical').length;
  const criticalFindings = inventory.findings.filter(f => f.severity === 'critical' && f.status === 'open').length;
  return `${plural(inventory.agents.length, 'agent')} · ${plural(inventory.mcpServers.length, 'MCP server')} · ${plural(paths.length, 'exposure path')} (${criticalPaths} critical) · ${plural(inventory.findings.length, 'finding')} (${criticalFindings} critical)`;
}

function renderReport(report, options = {}) {
  const useColor = options.color !== false;
  const s = makeStyle(useColor);
  const command = options.command || 'scan';
  const lines = [];
  const out = (...values) => lines.push(values.join(''));

  if (options.quiet) {
    out(summaryLine(report));
    out(s.dim(`files read: ${report.filesRead.length} (run without --quiet for the full report and file list)`));
    return lines.join('\n');
  }

  out(s.bold('BOPPI'), s.dim(' · AI Agent Security scan · v'), s.dim(report.version));
  out(s.dim(`${report.startedAt} · completed in ${(report.durationMs / 1000).toFixed(2)}s · everything ran locally`));
  out('');

  out(s.bold('DISCOVERY'));
  for (const client of report.discovery) {
    for (const file of client.files) {
      const mark = file.status === 'found' ? s.green('  ✓ ') : file.status === 'unreadable' ? s.red('  ! ') : s.dim('  · ');
      const status = file.status === 'found'
        ? `${file.serverCount} server${file.serverCount === 1 ? '' : 's'}`
        : file.status === 'unreadable' ? `could not be scanned (${file.reason || 'invalid JSON'})` : 'not found';
      out(mark, pad(client.label, 16), pad(file.path, 64), '  ', s.dim(status));
    }
    if (client.scanError) out(s.red('  ! '), pad(client.label, 16), s.red(`analysis failed (${client.scanError}) · this client is missing from every section below`));
  }
  out('');
  const toolCount = report.inventory.mcpServers.reduce((sum, m) => sum + (m.exposedTools || []).length, 0);
  out(s.bold('INVENTORY  '), summaryLine(report), s.dim(toolCount ? ` · ${toolCount} declared tools` : ''));

  if (command === 'agents' || command === 'scan') {
    out('');
    out(s.bold(`AGENTS (${report.inventory.agents.length})`));
    const byAgent = new Map(report.prioritization.perAgent.map(a => [a.agentId, a]));
    out(s.dim('  ' + pad('agent', 18) + pad('risk', 18) + pad('servers', 9) + pad('capabilities', 14) + 'worst exposure path'));
    for (const agent of [...report.inventory.agents].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))) {
      const servers = report.inventory.mcpServers.filter(m => m.agentId === agent.id);
      const caps = new Set(servers.flatMap(m => m.capabilities || []));
      const top = byAgent.get(agent.id);
      out('  ', pad(agent.name, 18), pad(`${agent.riskScore ?? 0}/100 ${agent.riskLevel || 'low'}`, 18), pad(servers.length, 9), pad(caps.size, 14), top ? `${severityBadge(top.highestPath.severity, useColor)} ${top.highestPath.label}` : s.dim('none'));
      if (options.verbose) {
        for (const server of servers) {
          out(s.dim(`      ${server.name}${server.command ? ` (${server.command}${server.arguments?.length ? ' ' + server.arguments[0] : ''})` : ''} · trust: ${server.trustStatus} · capabilities: ${(server.capabilities || []).join(', ') || 'none evidenced'}`));
        }
      }
    }
  }

  if (command === 'paths' || command === 'scan') {
    out('');
    const shown = options.verbose ? report.paths : report.paths.slice(0, 5);
    out(s.bold(`EXPOSURE PATHS (${report.paths.length})`), s.dim(report.paths.length > shown.length ? `  showing ${shown.length}; --verbose for all` : ''));
    if (!report.paths.length) out(s.dim('  No potential exposure paths from the evidenced inventory. Good sign — re-scan after config changes.'));
    for (const p of shown) {
      out('  ', severityBadge(p.severity, useColor), '  ', s.bold(p.label), s.dim(`  [${p.templateId} · confidence ${p.confidence}${p.stale ? ' · stale evidence' : ''}]`));
      out('     ', s.cyan(chainFor(p)));
      out('     ', s.dim('why: '), p.whyItMatters);
      out('     ', s.dim('fix: '), p.remediation);
      if (options.verbose) out('     ', s.dim(`evidence: ${p.evidenceCount} source(s) · ${p.disclaimer}`));
      out('');
    }
  }

  const ranked = (command === 'paths' || command === 'scan') ? rankPredictions(report.predictions || [], report.paths) : [];
  if (ranked.length) {
    out('');
    const { prediction: top, eliminatedSeverity } = ranked[0];
    const total = report.paths.length;
    out(s.bold('ROOT CAUSE  '), s.dim('the single config edit that breaks the most exposures, checked by rescanning without it'));
    out('  ', s.green('▸ '), s.bold(`Fix: ${editSentence(top)}`));
    for (const line of editLocations(top, report)) out('    ', s.dim('edit: '), line);
    const brk = [`${top.predictedEliminated.length} of ${total} exposure${total === 1 ? '' : 's'}`];
    if (eliminatedSeverity.critical) brk.push(`${eliminatedSeverity.critical} critical`);
    if (eliminatedSeverity.high) brk.push(`${eliminatedSeverity.high} high`);
    out('    ', s.dim('breaks '), s.bold(brk.join(' · ')), s.dim(`  (leaves ${total - top.predictedEliminated.length})`));
    const plan = report.remediationPlan;
    if (plan && plan.steps.length > 1) {
      out('  ', s.dim(`Full plan to break all ${plan.targetedExposures} high-or-critical exposures, ${plan.steps.length} changes${plan.breaksAll ? '' : ` (${plan.residualExposureKeys.length} would remain)`}:`));
      plan.steps.forEach((step, i) => {
        out(s.dim(`     ${i + 1}. `), editSentence(step), s.dim(` (breaks ${step.breaksCount})`));
        for (const line of editLocations(step, report)) out(s.dim('        edit: '), line);
      });
    }
  }

  if (command === 'scan') {
    const covered = coveredKeys(report.paths);
    const open = report.inventory.findings.filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status));
    const standalone = open.filter(f => !covered.has(`${f.agentId}:${f.ruleId}`));
    const list = options.verbose ? open : standalone;
    out(s.bold(`FINDINGS (${open.length})`), s.dim(options.verbose ? '' : standalone.length < open.length ? `  ${open.length - standalone.length} shown above as exposure paths; --verbose for all` : ''));
    if (!list.length) out(s.dim(open.length ? '  All open findings are represented in the exposure paths above.' : '  No rule-engine findings from the evidenced inventory.'));
    const agentName = id => report.inventory.agents.find(a => a.id === id)?.name || id;
    for (const f of [...list].sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0))) {
      out('  ', severityBadge(f.severity, useColor), '  ', pad(f.ruleId, 8), pad(agentName(f.agentId), 16), f.title);
      if (options.verbose) out(s.dim(`       ${f.recommendation}`));
    }
    out('');
    out(s.dim('  Findings and capabilities from config scans are inferred from evidenced identity (package names,'));
    out(s.dim('  directory arguments, environment variable names). Every claim carries its evidence in --json.'));
  }

  out('');
  out(s.bold('NEXT  '), s.dim('boppi scan --html report.html (shareable report) · boppi scan --json export.json (full evidence)'));
  out('');
  out(s.bold('PRIVACY'), s.dim('  Files read this run — metadata only, sanitized in memory, nothing left this machine:'));
  for (const file of report.filesRead) out(s.dim(`  - ${file}`));
  if (!report.filesRead.length) out(s.dim('  - none (no configuration files were found)'));
  out(s.dim('  Secret values, file contents, and raw path names are never collected. Paths become fingerprints.'));

  return lines.join('\n');
}

module.exports = { renderReport, summaryLine, PATH_RULE_FOR_TEMPLATE };
