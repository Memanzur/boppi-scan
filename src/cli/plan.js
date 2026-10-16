/**
 * boppi plan: every candidate fix side by side, then the exact config edits,
 * without touching anything. Each row is a rescanned prediction; the edit
 * preview shows the sanitized server record, never the raw config.
 */
'use strict';
const { rankPredictions } = require('./predict');

function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function editLabel(prediction) {
  return prediction.edit.action === 'move_server'
    ? `move "${prediction.edit.server}" from ${prediction.client.label} to ${prediction.target.label}`
    : `remove "${prediction.edit.server}" from ${prediction.client.label}`;
}

/** Files on disk where the edit applies, from the scan's discovery. */
function editFiles(prediction, discovery) {
  const client = (discovery || []).find(c => c.clientKey === prediction.client.key);
  const found = client ? client.files.filter(f => f.status === 'found').map(f => f.path) : [];
  if (prediction.edit.action !== 'move_server') return { from: found, to: [] };
  const target = (discovery || []).find(c => c.clientKey === prediction.target.key);
  return { from: found, to: target ? [target.primaryPath].filter(Boolean) : [] };
}

/** Rows for the comparison table, best first. */
function candidateRows(report) {
  return rankPredictions(report.predictions || [], report.paths).map(entry => {
    const p = entry.prediction;
    return {
      prediction: p,
      edit: editLabel(p),
      breaks: p.predictedEliminated.length,
      critical: entry.eliminatedSeverity.critical,
      high: entry.eliminatedSeverity.high,
      remain: p.predictedSurviving.length + (p.target ? p.target.predictedAppeared.length : 0),
      appears: p.target ? p.target.predictedAppeared.length : 0,
      loses: p.disruption ? p.disruption.lost : [],
      keeps: p.disruption ? p.disruption.kept : [],
    };
  });
}

function renderPlan(report, options = {}) {
  const lines = [];
  const out = (...parts) => lines.push(parts.join(''));
  const rows = candidateRows(report);
  const total = report.paths.length;
  out(`BOPPI · FIX PLAN · ${total} exposure path${total === 1 ? '' : 's'} across ${report.inventory.agents.length} agent${report.inventory.agents.length === 1 ? '' : 's'}`);
  out('Every number below comes from rescanning the configuration with that one edit applied. Nothing was changed.');
  out('');
  if (!rows.length) {
    out('No candidate fix: there are no exposure paths to break.');
    return lines.join('\n');
  }
  out('CANDIDATE FIXES  best first');
  out('  ', pad('#', 3), pad('edit', 58), pad('breaks', 10), pad('critical', 10), pad('new', 6), 'agent loses');
  rows.forEach((row, i) => {
    const loses = row.loses.length ? row.loses.join(', ') : 'nothing it does not already have elsewhere';
    out('  ', pad(i + 1, 3), pad(row.edit, 58), pad(`${row.breaks}/${total}`, 10), pad(row.critical, 10), pad(row.appears, 6), loses);
  });
  out('');
  out('  breaks: exposure paths that disappear on the agent being edited. new: paths that appear on the target when a server is moved.');
  out('  agent loses: capabilities that no other server on that agent provides; the workflow cost of the edit.');

  const plan = report.remediationPlan;
  if (plan && plan.steps.length) {
    out('');
    out(`SMALLEST SET  ${plan.steps.length} removal${plan.steps.length === 1 ? '' : 's'} break all ${plan.targetedExposures} high-or-critical exposures${plan.breaksAll ? '' : ` (${plan.residualExposureKeys.length} would remain)`}`);
    plan.steps.forEach((step, i) => out(`  ${i + 1}. remove "${step.edit.server}" from ${step.client.label} (breaks ${step.breaksCount})`));
  }

  out('');
  out('EDITS  what to change, per file');
  const shown = rows.slice(0, options.limit || 5);
  for (const row of shown) {
    const files = editFiles(row.prediction, report.discovery);
    const server = report.inventory.mcpServers.find(s => s.id === row.prediction.serverId);
    out(`  ${row.edit}`);
    for (const file of files.from) out(`    in ${file}: delete the key mcpServers.${JSON.stringify(row.prediction.edit.server)}`);
    for (const file of files.to) out(`    in ${file}: add the same entry under mcpServers`);
    if (server) out(`    entry (sanitized): ${server.command || server.endpoint || '?'}${server.arguments.length ? ' ' + server.arguments.join(' ') : ''}`);
    out(`    then: boppi fix --server ${JSON.stringify(row.prediction.edit.server)} --client ${row.prediction.client.key}${row.prediction.edit.action === 'move_server' ? '  (fix applies removals only; add the entry to the target by hand)' : ''}`);
  }
  if (rows.length > shown.length) out(`  ${rows.length - shown.length} more candidate${rows.length - shown.length === 1 ? '' : 's'} not shown; --json keeps every prediction.`);
  out('');
  out('Apply one edit, then boppi verify <export.json> grades the prediction against a fresh scan.');
  return lines.join('\n');
}

module.exports = { candidateRows, renderPlan, editLabel };
