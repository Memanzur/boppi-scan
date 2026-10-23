/** ANSI terminal report renderer for the Boppi CLI. */
'use strict';
const { rankPredictions } = require('../predict');
const { builtinCapabilities, builtinResidualSentences } = require('../builtinTools');
const recognition = require('../recognition');
const evidence = require('../evidence');
const securityGraph = require('../../engine/securityGraph');
const { filesHolding } = require('../configFiles');

const PATH_RULE_FOR_TEMPLATE = Object.freeze({ 'EP-A': 'AE-001', 'EP-B': 'AE-002', 'EP-C': 'AE-004', 'EP-D': 'AE-003', 'EP-E': 'AE-007', 'EP-F': 'AE-005' });
const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

function makeStyle(useColor) {
  const wrap = (open, close) => value => (useColor ? `[${open}m${value}[${close}m` : String(value));
  return {
    bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39),
    green: wrap(32, 39), cyan: wrap(36, 39), magenta: wrap(35, 39), orange: wrap(33, 39),
  };
}

/** One line per server with a stored tool list from `boppi discover`: what it advertised, what maps to a reach category, what stays unknown, or that the list is stale. */
/** Text from a configuration file, with control characters replaced so a crafted name cannot forge terminal lines or colors. */
function safeText(value) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?'); }

/** The observed-layer line for a server from the scan's evidence layers, or null when the export carries none. */
/** One sentence naming every cap the path search reached. */
function traversalSentence(traversal) {
  const parts = (traversal.truncated || []).map(t => `${t.cap} cap of ${t.limit}${t.agentId ? ` at ${safeText(t.agentId)}` : ''}`);
  return `the path search stopped at the ${parts.join(', ')} (${traversal.agentsSearched} of ${traversal.agents} agents searched).`;
}

function observedSentence(report, server) {
  const layers = report.evidenceLayers && report.evidenceLayers.servers ? report.evidenceLayers.servers.find(s => s.serverId === server.id) : null;
  return layers ? safeText(evidence.observedSentence(layers)) : null;
}

function advertisedSentence(report, server) {
  const clientList = Array.isArray(report.discovery) ? report.discovery : (report.discovery && report.discovery.clients) || [];
  const client = clientList.find(c => c.agentId === server.agentId);
  const inference = client && report.inferenceByClient && report.inferenceByClient[client.clientKey] && report.inferenceByClient[client.clientKey][server.name];
  const a = inference && inference.advertised;
  if (!a || a.status === 'none') return null;
  if (a.status === 'stale') return `advertised list stale (${a.reason.replace(/^advertised list is stale \(/, '').replace(/\)$/, '')}); run boppi discover --server ${JSON.stringify(server.name)} again`;
  const when = a.discoveredAt ? a.discoveredAt.slice(0, 10) : 'unknown date';
  const parts = [`advertised: ${a.tools} tool${a.tools === 1 ? '' : 's'} from a consented discovery on ${when}${a.partial ? ' (partial list)' : ''}, not verified`];
  if (a.unmapped.length) parts.push(`${a.unmapped.length} with no known reach (${a.unmapped.slice(0, 5).join(', ')}${a.unmapped.length > 5 ? ', ...' : ''}): advertised, reach unknown`);
  if (a.catalogNotAdvertised.length) parts.push(`catalog lists ${a.catalogNotAdvertised.slice(0, 3).join(', ')}${a.catalogNotAdvertised.length > 3 ? ', ...' : ''}, which the running server did not advertise; the catalog capability is kept`);
  return parts.join('; ');
}

/** Why no single removal helps when the agent has no built-in residual: more than one server completes each path. */
function noSingleEditSentence(paths) {
  const servers = [...new Set(paths.flatMap(p => (p.nodes || []).filter(n => n.entityType === 'mcp_server').map(n => n.label)))].sort();
  return servers.length
    ? `Each path is completed by more than one server on the same agent (${servers.join(', ')}), so removing any one of them leaves the path open; boppi plan lists the smallest set of removals that closes them.`
    : 'No single configuration edit changes these paths.';
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

/** What a server reaches beyond its capability ids: the file scope label and the tool-derived categories, read from its permission records. */
function serverReach(report, server) {
  const mine = (report.inventory.permissions || []).filter(p => p.integrationId === server.id);
  const scoped = mine.find(p => p.normalizedCategory === 'read_files' && /^.*\(filesystem_access: (.+)\)$/.test(p.rawPermission));
  const scope = scoped ? /\(filesystem_access: (.+)\)$/.exec(scoped.rawPermission)[1] : null;
  const categories = mine.filter(p => p.source && typeof p.source.id === 'string' && p.source.id.startsWith('tool-reach:')).map(p => p.normalizedCategory.replace(/_/g, ' '));
  return { scope, categories };
}

/** A permission settings file's DISCOVERY status: rule counts and mode, never rule text. */
function settingsStatus(file) {
  const rules = file.rules || {};
  const parts = [];
  if (rules.mode) parts.push(`mode ${rules.mode}`);
  if (rules.allow) parts.push(`${rules.allow} allow`);
  if (rules.deny) parts.push(`${rules.deny} deny`);
  if (rules.ask) parts.push(`${rules.ask} ask`);
  return `permission settings (${parts.length ? parts.join(' · ') : 'no permission rules'})`;
}

function editSentence(step) {
  if (step.edit.action === 'move_server') return `Move the "${step.edit.server}" entry from ${step.client.label}'s MCP configuration to ${step.target ? step.target.label : step.edit.toClient}. Rescan afterward to verify the change landed.`;
  return `Remove the "${step.edit.server}" entry from ${step.client.label}'s MCP configuration. Rescan afterward to verify the change landed.`;
}

/** The scanned config files the edit applies to, so the instruction names a real file. */
function editLocations(step, report) {
  const client = (report.discovery || []).find(c => c.clientKey === step.client.key);
  const verb = step.edit.action === 'move_server' ? 'move' : 'remove';
  return filesHolding(client, step.edit.server).map(file => `${verb} the "${step.edit.server}" entry from ${file}`);
}

/** What the agent gives up, from the prediction's inventory-derived disruption. */
function disruptionSentence(prediction) {
  const d = prediction.disruption;
  if (!d) return null;
  const builtin = d.builtin || [];
  const viaServers = d.kept.filter(c => !builtin.includes(c));
  const keeps = [
    viaServers.length ? `${viaServers.join(', ')} through other servers` : '',
    builtin.length ? `${builtin.join(', ')} through its own built-in tools` : '',
  ].filter(Boolean).join(' and ');
  if (!d.lost.length) return `the agent loses no capability it does not also have elsewhere${keeps ? ` (it keeps ${keeps})` : ''}`;
  return `the agent loses ${d.lost.join(', ')}${keeps ? ` and keeps ${keeps}` : ''}`;
}

const GATE_WORD = Object.freeze({ unprompted: 'no prompt', prompted: 'prompts', denied: 'denied', unknown: 'not checked' });

/** One line per built-in grant of a scanned client: the agent, the capability and its tools, then what the permission settings say. */
function builtinLines(report) {
  const lines = [];
  for (const client of report.discovery || []) {
    if (!client.builtin || !client.agentId) continue;
    const agent = report.inventory.agents.find(a => a.id === client.agentId);
    const name = agent ? agent.name : client.label;
    for (const grant of client.builtin.grants) lines.push({ name, text: `${grant.label} (${grant.tools.map(t => t.tool).join(', ')})`, gate: grant.gate, detail: grant.summary });
    for (const grant of client.builtin.denied) lines.push({ name, text: `${grant.label} (${grant.tools.map(t => t.tool).join(', ')})`, gate: 'denied', detail: `${grant.summary}; not in the graph` });
  }
  return lines;
}

function summaryLine(report) {
  const { inventory, paths } = report;
  const criticalPaths = paths.filter(p => p.severity === 'critical').length;
  const criticalFindings = inventory.findings.filter(f => f.severity === 'critical' && f.status === 'open').length;
  const unknown = recognition.unrecognized(report.recognition).length;
  return `${plural(inventory.agents.length, 'agent')} · ${plural(inventory.mcpServers.length, 'MCP server')}${unknown ? ` (${unknown} unrecognized, unknown reach)` : ''} · ${plural(paths.length, 'exposure path')} (${criticalPaths} critical) · ${plural(inventory.findings.length, 'finding')} (${criticalFindings} critical)`;
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
  const labelWidth = Math.max(16, ...report.discovery.map(client => client.label.length + 2));
  for (const client of report.discovery) {
    for (const file of client.files) {
      const mark = file.status === 'found' ? s.green('  ✓ ') : file.status === 'unreadable' ? s.red('  ! ') : s.dim('  · ');
      const status = file.status === 'found'
        ? (file.kind === 'settings' ? settingsStatus(file) : `${file.serverCount} server${file.serverCount === 1 ? '' : 's'}`)
        : file.status === 'unreadable' ? `could not be scanned (${file.reason || 'invalid JSON'})` : 'not found';
      out(mark, pad(client.label, labelWidth), pad(file.path, 64), '  ', s.dim(status));
    }
    if (client.scanError) out(s.red('  ! '), pad(client.label, labelWidth), s.red(`analysis failed (${client.scanError}) · this client is missing from every section below`));
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
      const own = builtinCapabilities(report.inventory, agent.id);
      const caps = new Set([...own, ...servers.flatMap(m => m.capabilities || [])]);
      const top = byAgent.get(agent.id);
      out('  ', pad(agent.name, 18), pad(`${agent.riskScore ?? 0}/100 ${agent.riskLevel || 'low'}`, 18), pad(servers.length, 9), pad(caps.size, 14), top ? `${severityBadge(top.highestPath.severity, useColor)} ${top.highestPath.label}` : s.dim('none'));
      if (options.verbose) {
        if (own.length) out(s.dim(`      built-in tools · capabilities: ${own.join(', ')}`));
        for (const server of servers) {
          out(s.dim(`      ${server.name}${server.command ? ` (${server.command}${server.arguments?.length ? ' ' + server.arguments[0] : ''})` : ''} · trust: ${server.trustStatus} · capabilities: ${(server.capabilities || []).join(', ') || 'none evidenced'}`));
        }
      }
    }
  }

  if (command === 'scan') {
    out('');
    out(s.bold(`MCP SERVERS (${report.inventory.mcpServers.length})`));
    if (!report.inventory.mcpServers.length) out(s.dim('  No supported MCP servers were found in the examined configuration files.'));
    const recognitionById = new Map((report.recognition || []).filter(r => r.serverId).map(r => [r.serverId, r]));
    for (const server of report.inventory.mcpServers) {
      const agent = report.inventory.agents.find(candidate => candidate.id === server.agentId);
      const capabilities = (server.capabilities || []).join(', ') || 'no supported capability identified';
      const known = recognitionById.get(server.id);
      const tags = [];
      if (known && !known.recognized) tags.push(s.yellow('unrecognized'));
      if (known && known.pin === 'unpinned') tags.push(s.yellow('unpinned'));
      if (known && known.pin === 'tagged') tags.push(s.yellow('tagged image'));
      const reach = serverReach(report, server);
      out('  ', s.bold(safeText(server.name)), s.dim(` · ${agent ? agent.name : 'unknown agent'} · capabilities: ${capabilities}`), tags.length ? s.dim(' · ') + tags.join(s.dim(' · ')) : '');
      if (reach.scope) out(s.dim(`      file scope: ${reach.scope}`));
      if (reach.categories.length) out(s.dim('      reach through tools: '), reach.categories.join(', '));
      const advertised = advertisedSentence(report, server);
      if (advertised) out(s.dim(`      ${advertised}`));
      const observed = observedSentence(report, server);
      if (observed) out(s.dim(`      ${observed}`));
    }
    const unmatched = report.evidenceLayers ? evidence.unmatchedSentence(report.evidenceLayers) : null;
    if (unmatched) out('  ', s.dim(safeText(unmatched)));
    const unknownServers = recognition.unrecognized(report.recognition);
    if (unknownServers.length) {
      out('');
      out(s.bold(`UNRECOGNIZED SERVERS (${unknownServers.length})`), s.dim('  Boppi could not establish what these can do; they sit in no exposure path, which is not the same as safe'));
      for (const item of unknownServers) {
        const server = report.inventory.mcpServers.find(m => m.id === item.serverId);
        out('  ', s.bold(safeText(item.server)), s.dim(` · ${item.clientLabel} · `), safeText(recognition.launchSummary(item, server)), s.dim(` · ${safeText(item.reasons.join(', '))}`));
      }
      out(s.dim(`  ${recognition.ADVICE}`));
    }
    const launched = recognition.packageLaunched(report.recognition);
    const loose = recognition.unpinned(report.recognition);
    const movable = recognition.tagged(report.recognition);
    if (loose.length || movable.length) {
      out('');
      const parts = [];
      if (loose.length) parts.push(`${loose.length} of ${launched.length} package-launched server${launched.length === 1 ? '' : 's'} ${loose.length === 1 ? 'is' : 'are'} unpinned: ${loose.map(r => r.server).join(', ')}.`);
      if (movable.length) parts.push(`${movable.length} Docker image${movable.length === 1 ? '' : 's'} run${movable.length === 1 ? 's' : ''} by tag, not digest: ${movable.map(r => r.server).join(', ')}.`);
      out(s.bold('PACKAGE PINS  '), parts.join(' '));
      if (loose.length) out(s.dim(`  ${recognition.UNPINNED_ADVICE}`));
      if (movable.length) out(s.dim(`  ${recognition.TAGGED_ADVICE}`));
    }
    const builtin = builtinLines(report);
    if (builtin.length) {
      out('');
      out(s.bold(`BUILT-IN TOOLS (${builtin.length})`), s.dim('  the agent\'s own tools, no MCP server involved; removing a server never removes these'));
      for (const line of builtin) {
        const gate = line.gate === 'unprompted' ? s.yellow(GATE_WORD[line.gate]) : line.gate === 'denied' ? s.green(GATE_WORD[line.gate]) : s.dim(GATE_WORD[line.gate]);
        out('  ', s.bold(line.name), s.dim(' · '), line.text, s.dim(' · '), gate, s.dim(` · ${line.detail}`));
      }
    }
    out('');
    out(s.bold('COVERAGE'));
    const grantCount = builtin.filter(line => line.gate !== 'denied').length;
    out('  ', s.green('Established: '), `${report.inventory.agents.length} agent${report.inventory.agents.length === 1 ? '' : 's'}, ${report.inventory.mcpServers.length} MCP server${report.inventory.mcpServers.length === 1 ? '' : 's'}, ${grantCount} built-in tool grant${grantCount === 1 ? '' : 's'}, and ${report.filesRead.length} configuration file${report.filesRead.length === 1 ? '' : 's'} examined.`);
    const unknownSentence = recognition.coverageSentence(report.recognition);
    const hints = report.graph ? securityGraph.productionHints(report.graph) : [];
    out('  ', s.dim('Not established: '), `runtime behavior, activity that did not appear in configuration, or access not evidenced by the scanned metadata.${unknownSentence ? ` ${unknownSentence}` : ''}${hints.length ? ` ${plural(hints.length, 'permission')} named like production access with no tool list behind ${hints.length === 1 ? 'it' : 'them'} (${hints.join(', ')}): treated as unknown, not as a production path.` : ''}`);
    if (report.incomplete?.length) out('  ', s.yellow('Incomplete: '), `these sources could not be fully analyzed: ${report.incomplete.join(', ')}.`);
    else out('  ', s.dim('Scan status: '), 'complete for the supported configuration sources that were found.');
    if (report.traversal && !report.traversal.complete) out('  ', s.yellow('Search limit: '), `${traversalSentence(report.traversal)} Paths beyond the limit were not examined; a missing path is not evidence of absence.`);
  }

  if (command === 'paths' || command === 'scan') {
    out('');
    const shown = options.verbose ? report.paths : report.paths.slice(0, 5);
    out(s.bold(`EXPOSURE PATHS (${report.paths.length})`), s.dim(report.paths.length > shown.length ? `  showing ${shown.length}; --verbose for all` : ''));
    if (!report.paths.length) {
      const unknown = recognition.unrecognized(report.recognition).length;
      out(s.dim(`  No potential exposure paths from the evidenced inventory. This is not proof that the environment is safe${unknown ? `: ${plural(unknown, 'unrecognized server')} ha${unknown === 1 ? 's' : 've'} unknown reach` : ''}; re-scan after config changes.`));
    }
    for (const p of shown) {
      out('  ', severityBadge(p.severity, useColor), '  ', s.bold(p.label), s.dim(`  [${p.templateId} · evidence confidence ${p.confidence}${p.stale ? ' · stale evidence' : ''} · likelihood not assessed]`));
      out('     ', s.cyan(chainFor(p)));
      out('     ', s.dim('why: '), p.whyItMatters);
      if (p.assessment) {
        out('     ', s.dim('based on: '), p.assessment.facts.join('; '));
        if (p.assessment.assumptions.length) out('     ', s.dim('assumes: '), p.assessment.assumptions.join('; '));
        out('     ', s.dim('not checked: '), p.assessment.unknowns.join('; '));
        if (p.assessment.priority !== p.assessment.impact) out('     ', s.dim('priority: '), `${p.assessment.priority}, stepped down from ${p.assessment.impact} because the weakest evidence is ${p.assessment.weakestStrength}`);
      }
      out('     ', s.dim('fix: '), p.remediation);
      if (options.verbose) out('     ', s.dim(`evidence: ${p.evidenceCount} source(s) · ${p.disclaimer}`));
      out('');
    }
  }

  if (command === 'scan' && report.historyChanges) {
    if (!report.paths.length) out('');
    out(s.bold('CHANGES SINCE LAST SCAN'), s.dim(`  compared with ${report.historyChanges.comparedAt}`));
    out('  ', `${report.historyChanges.newPaths} new exposure path${report.historyChanges.newPaths === 1 ? '' : 's'} · ${report.historyChanges.resolvedPaths} resolved/no longer present · ${report.historyChanges.agentDelta >= 0 ? '+' : ''}${report.historyChanges.agentDelta} agents · ${report.historyChanges.serverDelta >= 0 ? '+' : ''}${report.historyChanges.serverDelta} MCP servers`);
  } else if (command === 'scan') {
    if (!report.paths.length) out('');
    out(s.bold('CHANGES SINCE LAST SCAN'));
    out('  ', s.dim('First local scan. Run Boppi again after changing your environment to see what changed.'));
  }

  const ranked = (command === 'paths' || command === 'scan') ? rankPredictions(report.predictions || [], report.paths) : [];
  if (ranked.length) {
    out('');
    const { prediction: top, eliminatedSeverity, lowered } = ranked[0];
    const total = report.paths.length;
    const lowersOnly = top.predictedEliminated.length === 0;
    out(s.bold('ROOT CAUSE  '), s.dim(`the single config edit that ${lowersOnly ? 'lowers the most exposures; none closes one' : 'breaks the most exposures'}, checked by rescanning without it`));
    out('  ', s.green('▸ '), s.bold(`${lowersOnly ? 'Lower' : 'Fix'}: ${editSentence(top)}`));
    for (const line of editLocations(top, report)) out('    ', s.dim('edit: '), line);
    const brk = [`${top.predictedEliminated.length} of ${total} exposure${total === 1 ? '' : 's'}`];
    if (eliminatedSeverity.critical) brk.push(`${eliminatedSeverity.critical} critical`);
    if (eliminatedSeverity.high) brk.push(`${eliminatedSeverity.high} high`);
    if (lowered.length) brk.push(`lowers ${lowered.length} (${lowered.map(step => `${step.from} to ${step.to}`).join(', ')})`);
    out('    ', s.dim('breaks '), s.bold(brk.join(' · ')), s.dim(`  (leaves ${total - top.predictedEliminated.length})`));
    const cost = disruptionSentence(top);
    if (cost) out('    ', s.dim('cost: '), cost);
    out('    ', s.dim('compare every candidate fix with '), s.bold('boppi plan'), s.dim(', apply one with '), s.bold(`boppi fix --server ${JSON.stringify(top.edit.server)}`));
    const plan = report.remediationPlan;
    if (plan && plan.steps.length > 1) {
      out('  ', s.dim(`Full plan to break ${plan.breaksAll ? 'all' : `${plan.targetedExposures - plan.residualExposureKeys.length} of`} ${plan.targetedExposures} high-or-critical exposures, ${plan.steps.length} changes${plan.breaksAll ? '' : ` (${plan.residualExposureKeys.length} would remain)`}:`));
      plan.steps.forEach((step, i) => {
        out(s.dim(`     ${i + 1}. `), editSentence(step), s.dim(` (breaks ${step.breaksCount})`));
        for (const line of editLocations(step, report)) out(s.dim('        edit: '), line);
      });
    }
    if (plan && !plan.breaksAll) for (const sentence of builtinResidualSentences(report.builtinResidual, plan.residualExposureKeys)) out('  ', s.dim(sentence));
  } else if ((command === 'paths' || command === 'scan') && report.paths.length) {
    out('');
    out(s.bold('ROOT CAUSE  '), s.dim('no MCP config edit closes or lowers a path on this scan'));
    const sentences = builtinResidualSentences(report.builtinResidual, report.paths.map(p => p.exposureKey));
    for (const sentence of sentences) out('  ', s.dim(sentence));
    if (!sentences.length) out('  ', s.dim(noSingleEditSentence(report.paths)));
  }

  if (command === 'scan') {
    const covered = coveredKeys(report.paths);
    const open = report.inventory.findings.filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status));
    const standalone = open.filter(f => !covered.has(`${f.agentId}:${f.ruleId}`));
    const list = options.verbose ? open : standalone;
    out('');
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
  out(s.bold('NEXT STEPS'));
  if (report.paths.length && options.json) {
    out('  ', `1. Apply the fix above, then run ${s.bold(`boppi verify ${options.json}`)} to confirm the paths are gone.`);
  } else if (report.paths.length) {
    out('  ', `1. Rerun with ${s.bold('--json boppi-scan.json')} to save these predictions, apply the fix, then ${s.bold('boppi verify boppi-scan.json')} confirms it.`);
  } else {
    out('  ', `1. Rescan after you add or change an MCP server; ${s.bold('boppi history')} shows what changed between runs.`);
  }
  out('  ', `2. ${s.bold('boppi scan --html boppi-report.html')} writes a shareable report with the evidence for every claim.`);
  out('  ', `3. Working with a team? ${s.bold('boppi push')} sends this sanitized inventory to your Boppi workspace (it asks for your collector token). Nothing else ever leaves the machine.`);
  out('');
  out(s.bold('PRIVACY'), s.dim('  Files read this run (metadata only, sanitized in memory, nothing left this machine):'));
  for (const file of report.filesRead) out(s.dim(`  - ${file}`));
  if (!report.filesRead.length) out(s.dim('  - none (no configuration files were found)'));
  out(s.dim('  Secret values, file contents, and raw path names are never collected. Paths become fingerprints.'));

  return lines.join('\n');
}

/** The closing line of a plain `boppi scan`, so solo users find the team dashboard. Nothing for exports, --quiet, or other commands. */
function pushHint(options = {}) {
  if (options.command !== 'scan' || options.quiet || options.json || options.html || options.sarif) return '';
  return makeStyle(options.color !== false).dim('See this across your team: npx boppi push   (free beta, https://app.boppi.io)');
}

module.exports = { renderReport, summaryLine, pushHint, noSingleEditSentence, advertisedSentence, observedSentence, traversalSentence, safeText, PATH_RULE_FOR_TEMPLATE };
