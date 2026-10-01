/** Self-contained HTML report renderer for the Boppi CLI. */
'use strict';
const { rankPredictions } = require('../predict');

const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sevBadge(severity) {
  return `<span class="sev sev-${esc(severity)}">${esc(severity)}</span>`;
}

function renderHtml(report) {
  const { inventory, paths, prioritization } = report;
  const byAgent = new Map(prioritization.perAgent.map(a => [a.agentId, a]));
  const agentName = id => inventory.agents.find(a => a.id === id)?.name || id;
  const openFindings = inventory.findings
    .filter(f => !['resolved', 'accepted_risk', 'false_positive'].includes(f.status))
    .sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));
  const toolCount = inventory.mcpServers.reduce((sum, m) => sum + (m.exposedTools || []).length, 0);
  const counts = prioritization.counts;
  const ranked = rankPredictions(report.predictions || [], paths);
  const plan = report.remediationPlan;
  const editSentence = step => `Remove the "${step.edit.server}" entry from ${step.client.label}'s MCP configuration.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boppi Scan Report</title>
<style>
  :root { --bg:#f4f6fa; --surface:#fff; --ink:#171c26; --muted:#5b6474; --line:#e4e7ee; --accent:#3b5bfd;
    --crit:#d33030; --crit-bg:#fdecec; --high:#c66a00; --high-bg:#fff3e0; --med:#8f7500; --med-bg:#fdf7dd; --low:#4a5568; --low-bg:#edf0f4; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.55; }
  .wrap { max-width:960px; margin:0 auto; padding:36px 24px 80px; }
  h1 { font-size:22px; font-weight:800; } h1 span { color:var(--accent); }
  .meta { color:var(--muted); font-size:13px; margin:4px 0 26px; }
  h2 { font-size:16px; font-weight:800; margin:30px 0 12px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .tile { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .tile .label { font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .tile .value { font-size:26px; font-weight:800; }
  .tile .value.crit { color:var(--crit); } .tile .value.high { color:var(--high); }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:12px; }
  .sev { display:inline-block; font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; padding:2px 9px; border-radius:6px; }
  .sev-critical { background:var(--crit-bg); color:var(--crit); } .sev-high { background:var(--high-bg); color:var(--high); }
  .sev-medium { background:var(--med-bg); color:var(--med); } .sev-low { background:var(--low-bg); color:var(--low); }
  .chain { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:10px 0; }
  .chip { background:#f2f4f9; border:1px solid var(--line); border-radius:7px; padding:3px 10px; font-size:12.5px; font-weight:600; }
  .arr { color:#9aa3b5; font-size:12px; }
  .kv { font-size:13px; margin-top:6px; } .kv b { font-weight:700; }
  .muted { color:var(--muted); } .small { font-size:12.5px; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th { text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); padding:9px 14px; background:#fafbfd; border-bottom:1px solid var(--line); }
  td { padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .privacy { border-left:3px solid var(--accent); background:var(--surface); border-radius:0 12px 12px 0; padding:14px 18px; margin-top:30px; font-size:13px; color:var(--muted); }
  .privacy code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; }
  .table-scroll { overflow-x:auto; }
</style>
</head>
<body><div class="wrap">
  <h1><span>Boppi</span> · AI Agent Security scan report</h1>
  <div class="meta">${esc(report.startedAt)} · ran locally in ${(report.durationMs / 1000).toFixed(2)}s · nothing left this machine · boppi-cli v${esc(report.version)}</div>

  <div class="tiles">
    <div class="tile"><div class="label">AI agents</div><div class="value">${inventory.agents.length}</div></div>
    <div class="tile"><div class="label">MCP servers</div><div class="value">${inventory.mcpServers.length}</div></div>
    <div class="tile"><div class="label">Declared tools</div><div class="value">${toolCount}</div></div>
    <div class="tile"><div class="label">Critical paths</div><div class="value crit">${counts.critical || 0}</div></div>
    <div class="tile"><div class="label">High paths</div><div class="value high">${counts.high || 0}</div></div>
    <div class="tile"><div class="label">Open findings</div><div class="value">${openFindings.length}</div></div>
  </div>

  ${ranked.length ? `
  <h2>Root cause: the single config edit that breaks the most exposures</h2>
  <div class="card" style="border-left:3px solid var(--accent)">
    <b>${esc(editSentence(ranked[0].prediction))}</b>
    <div class="kv">Breaks <b>${ranked[0].prediction.predictedEliminated.length} of ${paths.length}</b> exposures${ranked[0].eliminatedSeverity.critical ? ` (${ranked[0].eliminatedSeverity.critical} critical)` : ''}; ${paths.length - ranked[0].prediction.predictedEliminated.length} would remain. Checked by rescanning without the server.</div>
    ${plan && plan.steps.length > 1 ? `<div class="kv muted small">Plan to break all ${plan.targetedExposures} high-or-critical exposures (${plan.steps.length} changes):</div><ol class="small muted" style="margin:6px 0 0 18px">${plan.steps.map(st => `<li>${esc(editSentence(st))} <b>(breaks ${st.breaksCount})</b></li>`).join('')}</ol>` : ''}
  </div>` : ''}

  <h2>Potential exposure paths (${paths.length})</h2>
  ${paths.length ? paths.map(p => `
  <div class="card">
    ${sevBadge(p.severity)} <b>${esc(p.label)}</b> <span class="muted small">· ${esc(p.templateId)} · agent: ${esc(p.agentName)} · confidence ${esc(p.confidence)}${p.stale ? ' · stale evidence' : ''}</span>
    <div class="chain">${p.nodes.map(n => `<span class="chip">${esc(n.label)}</span>`).join('<span class="arr">→</span>')}</div>
    <div class="kv"><b>Why it matters:</b> ${esc(p.whyItMatters)}</div>
    <div class="kv"><b>Suggested fix:</b> ${esc(p.remediation)}</div>
    <div class="kv muted small">${esc(p.disclaimer)} Evidence sources: ${p.evidenceCount}.</div>
  </div>`).join('') : '<div class="card muted">No potential exposure paths from the evidenced inventory.</div>'}

  <h2>Findings (${openFindings.length})</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Severity</th><th>Rule</th><th>Agent</th><th>Finding</th><th>Suggested fix</th></tr></thead>
    <tbody>${openFindings.length ? openFindings.map(f => `
      <tr><td>${sevBadge(f.severity)}</td><td>${esc(f.ruleId)}</td><td>${esc(agentName(f.agentId))}</td>
      <td><b>${esc(f.title)}</b><div class="muted small">${esc(f.description)}</div></td><td class="small">${esc(f.recommendation)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">No rule-engine findings from the evidenced inventory.</td></tr>'}</tbody>
  </table></div>

  <h2>Agents (${inventory.agents.length})</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Agent</th><th>Risk</th><th>MCP servers</th><th>Worst exposure path</th></tr></thead>
    <tbody>${inventory.agents.map(a => {
      const servers = inventory.mcpServers.filter(m => m.agentId === a.id);
      const top = byAgent.get(a.id);
      return `<tr><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.vendor || '')} · ${esc(a.type || '')}</div></td>
      <td>${a.riskScore ?? 0}/100 ${sevBadge(a.riskLevel || 'low')}</td>
      <td class="small">${servers.length ? servers.map(m => `${esc(m.name)} <span class="muted">(trust: ${esc(m.trustStatus)}${(m.capabilities || []).length ? ' · ' + m.capabilities.map(esc).join(', ') : ''})</span>`).join('<br>') : '<span class="muted">none</span>'}</td>
      <td class="small">${top ? `${sevBadge(top.highestPath.severity)} ${esc(top.highestPath.label)}` : '<span class="muted">none</span>'}</td></tr>`;
    }).join('')}</tbody>
  </table></div>

  <div class="privacy">
    <b>Privacy.</b> This report was generated entirely on this machine. Files read (metadata only, sanitized in memory):
    ${report.filesRead.length ? `<br>${report.filesRead.map(f => `<code>${esc(f)}</code>`).join('<br>')}` : ' none.'}
    <br>Secret values, file contents, and raw path names are never collected; paths become fingerprints. Capabilities marked as inferred come from the server's evidenced identity (package names, directory arguments, environment variable names).
  </div>
</div></body></html>`;
}

module.exports = { renderHtml };
