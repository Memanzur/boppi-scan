/**
 * Self-contained HTML report renderer for the Boppi CLI.
 *
 * The page carries the scan's view model as embedded JSON and an inline
 * script that draws the exposure graph from it. No external resource is
 * referenced, so the file works over file:// and under a strict CSP. In live
 * mode (`boppi ui`) the same page gets a token meta tag and calls the
 * loopback API to apply and roll back fixes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { rankPredictions } = require('../predict');
const { buildGraphView } = require('./graphData');

const CLIENT_SCRIPT = fs.readFileSync(path.join(__dirname, 'interactive.client.js'), 'utf8');
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'";

/** JSON safe inside a <script> element: no `<` (so no `</script` or `<!--`) and no line separators. */
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sevBadge(severity) {
  return `<span class="sev sev-${esc(severity)}">${esc(severity)}</span>`;
}

const STYLES = `  :root { --bg:#f4f6fa; --surface:#fff; --ink:#171c26; --muted:#5b6474; --line:#e4e7ee; --accent:#3b5bfd;
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
  .lede { font-size:15px; margin:-16px 0 24px; color:var(--ink); }
  .graph-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
  .pill { border:1px solid var(--line); background:var(--surface); border-radius:999px; padding:5px 12px; font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; color:var(--ink); }
  .pill.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  .legend { display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:var(--muted); margin-left:auto; }
  .legend i { display:inline-block; width:14px; height:3px; vertical-align:middle; margin-right:5px; border-radius:2px; }
  .graph-wrap { background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow-x:auto; }
  #graph-svg { display:block; font-family:inherit; }
  .col-title { font-size:11px; font-weight:700; fill:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
  .edge { fill:none; stroke:#c5cbd8; stroke-width:1.4; transition:opacity .2s, stroke-width .2s; }
  .edge.sev-critical { stroke:var(--crit); stroke-width:2; } .edge.sev-high { stroke:var(--high); stroke-width:2; }
  .edge.sev-medium { stroke:var(--med); } .edge.on { stroke-width:3.2; } .edge.dim { opacity:.12; }
  .arrowhead { fill:#c5cbd8; } .arrowhead.sev-critical { fill:var(--crit); } .arrowhead.sev-high { fill:var(--high); } .arrowhead.sev-medium { fill:var(--med); }
  .node { cursor:pointer; transition:opacity .2s; } .node rect { fill:#fff; stroke:#c5cbd8; stroke-width:1.5; }
  .node.kind-agent rect { fill:#eef1ff; stroke:var(--accent); } .node.kind-server rect { fill:#f7f8fb; }
  .node.kind-data rect, .node.kind-credential rect { fill:#fffaf0; } .node.kind-destination rect { fill:#fff5f5; }
  .node.sev-critical rect { stroke:var(--crit); stroke-width:2.2; } .node.sev-high rect { stroke:var(--high); stroke-width:2.2; } .node.sev-medium rect { stroke:var(--med); }
  .node.on rect { stroke-width:3.5; } .node.dim { opacity:.18; } .node.selected rect { stroke:var(--accent); stroke-width:3.5; }
  .node:focus { outline:none; } .node:focus rect { stroke-dasharray:4 2; }
  .node-label { font-size:12.5px; font-weight:600; fill:var(--ink); pointer-events:none; }
  .node .dot { fill:var(--crit); } .node.sev-high .dot { fill:var(--high); } .node.sev-medium .dot { fill:var(--med); } .node.sev-none .dot { display:none; }
  .explorer { display:grid; grid-template-columns:minmax(260px,1fr) minmax(320px,1.6fr); gap:14px; margin-top:14px; align-items:start; }
  @media (max-width:760px) { .explorer { grid-template-columns:1fr; } }
  .path-list { display:flex; flex-direction:column; gap:6px; }
  .path-row, .fix-row { display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; width:100%; text-align:left; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:9px 12px; font:inherit; cursor:pointer; color:var(--ink); }
  .path-row.active, .fix-row.active { border-color:var(--accent); box-shadow:0 0 0 2px #dfe5ff; }
  .path-row-label { font-weight:700; flex:1 1 auto; }
  .fix-row { flex-direction:column; align-items:flex-start; gap:3px; margin-bottom:6px; }
  .panel { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px 18px; position:sticky; top:12px; max-height:calc(100vh - 24px); overflow:auto; }
  .panel h3 { font-size:16px; font-weight:800; margin:0; } .panel h4 { font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:16px 0 6px; }
  .panel p { margin:4px 0; } .panel ul { margin:4px 0 0 18px; } .panel li { margin:3px 0; }
  .panel-head { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:4px; }
  .panel-empty b { font-size:15px; }
  .kind { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); background:#f2f4f9; border-radius:6px; padding:2px 8px; }
  .evidence div { display:grid; grid-template-columns:150px 1fr; gap:4px 10px; padding:5px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .evidence dt { color:var(--muted); font-weight:600; } .evidence dd { margin:0; word-break:break-word; }
  .evidence pre, .command { background:#171c26; color:#e6e9f2; border-radius:8px; padding:10px 12px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; margin:4px 0; }
  .panel code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; background:#f2f4f9; border-radius:4px; padding:1px 5px; }
  .chip { font:inherit; cursor:pointer; }
  .disclaimer { border-top:1px solid var(--line); padding-top:8px; margin-top:12px !important; }
  .remediate { border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:0 10px 10px 0; padding:4px 14px 14px; margin-top:10px; }
  .safety { background:#eef1ff; border-radius:8px; padding:8px 10px; }
  .confirm { display:flex; gap:8px; align-items:flex-start; font-size:13px; margin:10px 0; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:8px; }
  .btn { font:inherit; font-size:13px; font-weight:700; border:1px solid var(--line); background:var(--surface); color:var(--ink); border-radius:8px; padding:7px 14px; cursor:pointer; }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; } .btn.danger { background:var(--crit); border-color:var(--crit); color:#fff; }
  .btn.small { padding:3px 9px; font-size:12px; margin-left:8px; } .btn[disabled] { opacity:.45; cursor:not-allowed; }
  .stage-box { margin-top:12px; } .stages { list-style:none; margin:0; padding:0; }
  .stage { display:grid; grid-template-columns:18px 150px 1fr; gap:6px 10px; align-items:baseline; padding:6px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .stage-mark { display:inline-block; width:12px; height:12px; border-radius:50%; border:2px solid #c5cbd8; position:relative; top:1px; }
  .stage.running .stage-mark { border-color:var(--accent); border-top-color:transparent; animation:spin .8s linear infinite; }
  .stage.done .stage-mark { border-color:#1d8a4a; background:#1d8a4a; } .stage.failed .stage-mark { border-color:var(--crit); background:var(--crit); }
  .stage.done .stage-label { color:#1d8a4a; } .stage.failed .stage-label { color:var(--crit); }
  @keyframes spin { to { transform:rotate(360deg); } }
  .result { border-radius:10px; padding:10px 14px 12px; margin-top:12px; border:1px solid var(--line); }
  .result h4 { margin-top:2px !important; } .result.removed, .result.restored { background:#e9f7ee; border-color:#1d8a4a; } .result.removed h4, .result.restored h4 { color:#1d8a4a; }
  .result.reduced { background:var(--high-bg); border-color:var(--high); } .result.reduced h4 { color:var(--high); }
  .result.unresolved, .result.failed { background:var(--crit-bg); border-color:var(--crit); } .result.unresolved h4, .result.failed h4 { color:var(--crit); }
  .modal-back { position:fixed; inset:0; background:rgba(23,28,38,.55); display:flex; align-items:center; justify-content:center; z-index:10; padding:16px; }
  .modal { background:var(--surface); border-radius:14px; padding:20px 22px; max-width:520px; width:100%; }
  .modal h3 { font-size:17px; font-weight:800; margin-bottom:8px; }
  .backup-row { display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--line); }
  .link { font:inherit; font-size:12.5px; color:var(--accent); background:none; border:none; padding:0; cursor:pointer; text-decoration:underline; }
  .mode { font-size:12.5px; color:var(--muted); margin:6px 0 12px; }
`;

/** The interactive graph block shared by the scan report and the demo page. */
function graphSection(view) {
  return `  <h2 id="graph">Exposure graph</h2>
  <p class="mode" id="graph-mode"></p>
  <div class="graph-toolbar">
    <div id="graph-agents" class="graph-toolbar"></div>
    <div class="legend"><span><i style="background:var(--crit)"></i>critical path</span><span><i style="background:var(--high)"></i>high path</span><span><i style="background:var(--med)"></i>medium path</span><span><i style="background:#c5cbd8"></i>access, no path</span></div>
  </div>
  <div class="graph-wrap" id="graph-wrap"><svg id="graph-svg" role="img" aria-label="Exposure graph: agents, MCP servers, capabilities, data, and destinations, with potential exposure paths highlighted by severity"></svg></div>
  <div class="explorer">
    <div>
      <div class="kv muted small" style="margin-bottom:6px">Potential exposure paths, most severe first. Click one to highlight it and see fix options.</div>
      <div id="graph-paths" class="path-list"></div>
      <div id="graph-backups"></div>
    </div>
    <div id="graph-panel" class="panel"></div>
  </div>
  <p class="muted small" style="margin-top:10px">${esc(view.scope)} ${esc(view.disclaimer)}</p>
`;
}

function renderHtml(report, options = {}) {
  const { inventory, paths, prioritization } = report;
  const view = buildGraphView(report);
  const liveToken = options.live && options.live.token ? options.live.token : null;
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
  const serverRows = inventory.mcpServers.map(server => {
    const agent = inventory.agents.find(candidate => candidate.id === server.agentId);
    const capabilities = (server.capabilities || []).join(', ') || 'No supported capability identified';
    return `<tr><td><b>${esc(server.name)}</b></td><td>${esc(agent?.name || 'Unknown agent')}</td><td>${esc(capabilities)}</td></tr>`;
  }).join('');
  const coverageNote = report.incomplete?.length
    ? `Incomplete sources: ${report.incomplete.join(', ')}.`
    : 'Complete for the supported configuration sources that were found.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
${liveToken ? `<meta name="boppi-live" content="${esc(liveToken)}">` : ''}
<title>Boppi Scan Report</title>
<style>${STYLES}</style>
</head>
<body><div class="wrap">
  <h1><span>Boppi</span> · AI Agent Security scan report</h1>
  <div class="meta">${esc(report.startedAt)} · ran locally in ${(report.durationMs / 1000).toFixed(2)}s · nothing left this machine · boppi-cli v${esc(report.version)}</div>
  <p class="lede">See what your AI agents can access, understand the potential exposure paths, fix dangerous access, and verify that the risk is gone.</p>

  <div class="tiles">
    <div class="tile"><div class="label">AI agents</div><div class="value">${inventory.agents.length}</div></div>
    <div class="tile"><div class="label">MCP servers</div><div class="value">${inventory.mcpServers.length}</div></div>
    <div class="tile"><div class="label">Declared tools</div><div class="value">${toolCount}</div></div>
    <div class="tile"><div class="label">Critical paths</div><div class="value crit">${counts.critical || 0}</div></div>
    <div class="tile"><div class="label">High paths</div><div class="value high">${counts.high || 0}</div></div>
    <div class="tile"><div class="label">Open findings</div><div class="value">${openFindings.length}</div></div>
  </div>

  <h2>What this scan established</h2>
  <div class="card">
    <div class="kv"><b>Established:</b> ${inventory.agents.length} agent${inventory.agents.length === 1 ? '' : 's'}, ${inventory.mcpServers.length} MCP server${inventory.mcpServers.length === 1 ? '' : 's'}, and ${report.portableFilesRead.length} configuration file${report.portableFilesRead.length === 1 ? '' : 's'} examined.</div>
    <div class="kv"><b>Not established:</b> runtime behavior, activity absent from configuration, or access not evidenced by the scanned metadata.</div>
    <div class="kv muted small">${esc(coverageNote)} A clean result is not proof that the environment is safe.</div>
  </div>

  <h2>Discovered MCP servers and capabilities</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Server</th><th>Agent</th><th>Supported capabilities</th></tr></thead>
    <tbody>${serverRows || '<tr><td colspan="3" class="muted">No supported MCP servers were found in the examined files.</td></tr>'}</tbody>
  </table></div>

  ${report.historyChanges ? `<h2>Changes since last scan</h2><div class="card"><div class="kv">${report.historyChanges.newPaths} new exposure paths · ${report.historyChanges.resolvedPaths} resolved/no longer present · ${report.historyChanges.agentDelta >= 0 ? '+' : ''}${report.historyChanges.agentDelta} agents · ${report.historyChanges.serverDelta >= 0 ? '+' : ''}${report.historyChanges.serverDelta} MCP servers.</div></div>` : '<h2>Changes since last scan</h2><div class="card muted">First local scan. Run Boppi again after changing the environment to compare results.</div>'}

  ${ranked.length ? `
  <h2>Root cause: the single config edit that breaks the most exposures</h2>
  <div class="card" style="border-left:3px solid var(--accent)">
    <b>${esc(editSentence(ranked[0].prediction))}</b>
    <div class="kv">Breaks <b>${ranked[0].prediction.predictedEliminated.length} of ${paths.length}</b> exposures${ranked[0].eliminatedSeverity.critical ? ` (${ranked[0].eliminatedSeverity.critical} critical)` : ''}; ${paths.length - ranked[0].prediction.predictedEliminated.length} would remain. Checked by rescanning without the server.</div>
    ${ranked[0].prediction.disruption ? `<div class="kv muted small">Cost: ${ranked[0].prediction.disruption.lost.length ? `the agent loses ${esc(ranked[0].prediction.disruption.lost.join(', '))}` : 'the agent loses no capability it does not also get from another server'}.</div>` : ''}
    ${plan && plan.steps.length > 1 ? `<div class="kv muted small">Plan to break all ${plan.targetedExposures} high-or-critical exposures (${plan.steps.length} changes):</div><ol class="small muted" style="margin:6px 0 0 18px">${plan.steps.map(st => `<li>${esc(editSentence(st))} <b>(breaks ${st.breaksCount})</b></li>`).join('')}</ol>` : ''}
  </div>` : ''}

${graphSection(view)}

  <h2>Potential exposure paths (${paths.length})</h2>
  ${paths.length ? paths.map(p => `
  <div class="card">
    ${sevBadge(p.severity)} <b>${esc(p.label)}</b> <span class="muted small">· ${esc(p.templateId)} · agent: ${esc(p.agentName)} · confidence ${esc(p.confidence)}${p.stale ? ' · stale evidence' : ''}</span> <button class="link" type="button" data-show-path="${esc(p.id)}">Show in graph</button>
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
    ${report.portableFilesRead.length ? `<br>${report.portableFilesRead.map(f => `<code>${esc(f)}</code>`).join('<br>')}` : ' none.'}
    <br>Secret values, file contents, and raw path names are never collected; paths become fingerprints. Capabilities marked as inferred come from the server's evidenced identity (package names, directory arguments, environment variable names).
    ${liveToken ? '<br>Live mode: this page is served by <code>boppi ui</code> on 127.0.0.1 only. Fixes run on this machine after an explicit confirmation and a backup.' : '<br>The interactive graph runs from the data embedded in this file and makes no network requests.'}
  </div>
</div>
<script type="application/json" id="boppi-data">${embedJson(view)}</script>
<script>${CLIENT_SCRIPT}</script>
</body></html>`;
}

/** Self-contained synthetic demo page. It never receives a live token or calls a network endpoint. */
/** Self-contained synthetic demo. Uses the report explorer with precomputed rescans. */
function renderDemoHtml(bundle) {
  const first = bundle.scenarios[0].view;
  return `<!doctype html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>BOPPI · Interactive synthetic demo</title><style>${STYLES}
.demo-nav { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
.demo-note { border-left:3px solid var(--accent); padding:12px 16px; background:var(--surface); }
#demo-result { margin:12px 0; font-weight:600; }
</style></head>
<body><main class="wrap">
<h1><span>BOPPI</span> · Interactive synthetic demo</h1>
<p class="meta">Explore configuration evidence and try a simulated fix.</p>
<p class="demo-note">${esc(bundle.banner)} All fixes below are simulated.</p>
<nav class="demo-nav" id="demo-nav" aria-label="Synthetic scenarios"></nav>
<h2 id="demo-title"></h2><p id="demo-summary"></p>
<h3>Simulated remediation previews</h3>
<div class="demo-nav" id="demo-fixes"></div><p id="demo-result" role="status" aria-live="polite"></p>
${graphSection(first)}
</main>
<script type="application/json" id="boppi-data">${embedJson(first)}</script>
<script type="application/json" id="boppi-demo-data">${embedJson(bundle)}</script>
<script>${CLIENT_SCRIPT}</script>
<script>${fs.readFileSync(path.join(__dirname, 'demo.client.js'), 'utf8')}</script>
</body></html>`;
}

module.exports = { renderHtml, renderDemoHtml };
