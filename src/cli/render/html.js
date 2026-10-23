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
const { buildGraphView, capabilityLabel } = require('./graphData');
const { builtinCapabilities, builtinResidualSentences } = require('../builtinTools');
const recognition = require('../recognition');
const terminal = require('./terminal');
const securityGraph = require('../../engine/securityGraph');

const CLIENT_SCRIPT = fs.readFileSync(path.join(__dirname, 'graphLayout.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'interactive.client.js'), 'utf8');
const BRAND_TOKENS = fs.readFileSync(path.join(__dirname, '../../design/tokens.css'), 'utf8');
const BRAND_STYLES = fs.readFileSync(path.join(__dirname, '../../design/report.css'), 'utf8');
const BRAND_LOGO = fs.readFileSync(path.join(__dirname, '../../design/boppi-logo.png')).toString('base64');
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

function brandHeader() {
  return `<a class="skip-link" href="#main">Skip to checkup</a><header class="appbar"><div class="appbar-inner"><a class="brand" href="#main"><img src="data:image/png;base64,${BRAND_LOGO}" alt="" width="30" height="30">boppi</a><nav aria-label="Checkup navigation"><a href="#graph">Exposure graph</a><a href="#coverage">Coverage</a><a href="#inventory">Inventory</a></nav></div></header>`;
}

function evidenceGuide() {
  return `<details class="details"><summary>What configured, inferred, observed, and verified mean</summary><div class="details-body"><p><b>Configured:</b> present in a supported configuration file. <b>Inferred:</b> derived from metadata or the known server catalog, not a runtime handshake.</p><p><b>Observed:</b> requires runtime evidence. This checkup does not observe tool calls. <b>Verified:</b> a subsequent supported rescan checked a specific predicted change, not that an entire device is safe. Demo changes are simulated, not verified on your machine.</p></div></details>`;
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
  <p class="graph-guide">Columns group access types. Arrows show evidenced relationships, not execution order; a potential path can combine separate grants to the same agent. Dashed lines are inferred. Select a path to isolate its evidence. Scroll inside the graph for full labels.<span class="narrow-only"> On a narrow screen, swipe sideways inside the graph to reach all five columns.</span></p>
  <div class="graph-wrap" id="graph-wrap" role="region" tabindex="0" aria-label="Scrollable exposure graph"><svg id="graph-svg" role="group" aria-label="Exposure graph: agents, MCP servers, capabilities, data, and destinations, with potential exposure paths highlighted by severity"></svg></div>
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
  const recognitionById = new Map((report.recognition || []).filter(r => r.serverId).map(r => [r.serverId, r]));
  const recognitionCell = known => {
    if (!known) return '<span class="muted">not assessed</span>';
    const parts = [known.recognized ? 'Recognized' : '<b>Unrecognized</b>'];
    if (known.pin === 'unpinned') parts.push('<b>unpinned</b>');
    else if (known.pin === 'tagged') parts.push(`<b>tag ${esc(known.identity.version)}</b> (a tag can move; a digest pins)`);
    else if (known.pin === 'pinned') parts.push(`pinned ${esc(known.identity.version)}`);
    return `${parts.join(' · ')}<div class="muted small">${esc(recognition.launchSummary(known, inventory.mcpServers.find(m => m.id === known.serverId)))}</div>`;
  };
  const serverRows = inventory.mcpServers.map(server => {
    const agent = inventory.agents.find(candidate => candidate.id === server.agentId);
    const capabilities = (server.capabilities || []).map(capabilityLabel).join(', ') || 'No supported capability identified';
    const mine = (inventory.permissions || []).filter(p => p.integrationId === server.id);
    const scoped = mine.map(p => /\(filesystem_access: (.+)\)$/.exec(p.rawPermission || '')).find(Boolean);
    const reach = mine.filter(p => p.source && typeof p.source.id === 'string' && p.source.id.startsWith('tool-reach:')).map(p => p.normalizedCategory.replace(/_/g, ' '));
    const advertised = terminal.advertisedSentence(report, server);
    const observed = terminal.observedSentence(report, server);
    const detail = [scoped ? `file scope: ${esc(scoped[1])}` : '', reach.length ? `reach through tools: ${esc(reach.join(', '))}` : '', advertised ? esc(advertised) : '', observed ? esc(observed) : ''].filter(Boolean).join('<br>');
    return `<tr><td><b>${esc(server.name)}</b></td><td>${esc(agent?.name || 'Unknown agent')}</td><td>${esc(capabilities)}${detail ? `<div class="muted small">${detail}</div>` : ''}</td><td class="small">${recognitionCell(recognitionById.get(server.id))}</td></tr>`;
  }).join('');
  const unknownServers = recognition.unrecognized(report.recognition);
  const loose = recognition.unpinned(report.recognition);
  const movable = recognition.tagged(report.recognition);
  const hints = report.graph ? securityGraph.productionHints(report.graph) : [];
  const unknownSentence = [recognition.coverageSentence(report.recognition), hints.length ? `${hints.length} permission${hints.length === 1 ? '' : 's'} named like production access with no tool list behind ${hints.length === 1 ? 'it' : 'them'} (${hints.join(', ')}): treated as unknown, not as a production path.` : ''].filter(Boolean).join(' ');
  const coverageNote = (report.incomplete?.length
    ? `Incomplete sources: ${report.incomplete.join(', ')}.`
    : 'Complete for the supported configuration sources that were found.')
    + (report.traversal && !report.traversal.complete ? ` Search limit: ${terminal.traversalSentence(report.traversal)} Paths beyond the limit were not examined.` : '');
  const GATE_WORD = { unprompted: 'No prompt', prompted: 'Prompts', denied: 'Denied', unknown: 'Not checked' };
  const builtinRows = (report.discovery || []).filter(c => c.builtin && c.agentId).flatMap(client => {
    const name = agentName(client.agentId);
    const row = (grant, gate, note) => `<tr><td><b>${esc(name)}</b></td><td>${esc(grant.label)}</td><td>${esc(grant.tools.map(t => t.tool).join(', '))}</td><td>${esc(GATE_WORD[gate])}<div class="muted small">${esc(grant.summary)}${note}</div></td></tr>`;
    return [...client.builtin.grants.map(g => row(g, g.gate, '')), ...client.builtin.denied.map(g => row(g, 'denied', '; not in the graph'))];
  }).join('');
  const builtinCount = (report.discovery || []).filter(c => c.builtin && c.agentId).reduce((sum, c) => sum + c.builtin.grants.length, 0);
  const costSentence = d => {
    const builtin = d.builtin || [];
    const viaServers = d.kept.filter(c => !builtin.includes(c));
    const keeps = [viaServers.length ? `${esc(viaServers.join(', '))} through other servers` : '', builtin.length ? `${esc(builtin.join(', '))} through its own built-in tools` : ''].filter(Boolean).join(' and ');
    if (!d.lost.length) return `the agent loses no capability it does not also have elsewhere${keeps ? ` (it keeps ${keeps})` : ''}`;
    return `the agent loses ${esc(d.lost.join(', '))}${keeps ? ` and keeps ${keeps}` : ''}`;
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
${liveToken ? `<meta name="boppi-live" content="${esc(liveToken)}">` : ''}
<title>Boppi Scan Report</title>
<style>${BRAND_TOKENS}${STYLES}${BRAND_STYLES}</style>
</head>
<body>${brandHeader()}<main class="wrap" id="main">
  <div class="eyebrow"><span class="status-dot"></span>Local security checkup</div>
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

  <h2 id="coverage">What this scan established</h2>
  <div class="card">
    <div class="kv"><b>Established:</b> ${inventory.agents.length} agent${inventory.agents.length === 1 ? '' : 's'}, ${inventory.mcpServers.length} MCP server${inventory.mcpServers.length === 1 ? '' : 's'}, ${builtinCount} built-in tool grant${builtinCount === 1 ? '' : 's'}, and ${report.portableFilesRead.length} configuration file${report.portableFilesRead.length === 1 ? '' : 's'} examined.</div>
    <div class="kv"><b>Not established:</b> runtime behavior, activity absent from configuration, or access not evidenced by the scanned metadata.${unknownSentence ? ` ${esc(unknownSentence)}` : ''}</div>
    <div class="kv muted small">${esc(coverageNote)} A clean result is not proof that the environment is safe.</div>
  </div>

  ${evidenceGuide()}
  <h2 id="inventory">Discovered MCP servers and capabilities</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Server</th><th>Agent</th><th>Supported capabilities</th><th>Recognition</th></tr></thead>
    <tbody>${serverRows || '<tr><td colspan="4" class="muted">No supported MCP servers were found in the examined files.</td></tr>'}</tbody>
  </table></div>
${unknownServers.length ? `
  <h2 id="unrecognized">Unrecognized servers (${unknownServers.length})</h2>
  <div class="card" style="border-left:3px solid var(--warn, #d08a00)">
    <div class="kv">Boppi could not establish what these servers can do. They sit in no exposure path, which is not the same as safe.</div>
    <ul class="small" style="margin:6px 0 0 18px">${unknownServers.map(item => `<li><b>${esc(item.server)}</b> · ${esc(item.clientLabel)} · ${esc(recognition.launchSummary(item, inventory.mcpServers.find(m => m.id === item.serverId)))} <span class="muted">· ${esc(item.reasons.join(', '))}</span></li>`).join('')}</ul>
    <div class="kv muted small">${esc(recognition.ADVICE)}</div>
  </div>` : ''}
${loose.length ? `<div class="card"><div class="kv"><b>Package pins:</b> ${loose.length} of ${recognition.packageLaunched(report.recognition).length} package-launched server${recognition.packageLaunched(report.recognition).length === 1 ? '' : 's'} ${loose.length === 1 ? 'is' : 'are'} unpinned: ${esc(loose.map(r => r.server).join(', '))}.</div><div class="kv muted small">${esc(recognition.UNPINNED_ADVICE)}</div></div>` : ''}
${movable.length ? `<div class="card"><div class="kv"><b>Docker tags:</b> ${movable.length} image${movable.length === 1 ? '' : 's'} run${movable.length === 1 ? 's' : ''} by tag, not digest: ${esc(movable.map(r => r.server).join(', '))}.</div><div class="kv muted small">${esc(recognition.TAGGED_ADVICE)}</div></div>` : ''}
${builtinRows ? `
  <h2 id="builtin">Built-in tools</h2>
  <p class="muted small">The agent's own tools, with no MCP server involved. Removing a server never removes these. "Prompts" means the client asks before each use; "No prompt" means a permission setting lets the tool run without asking.</p>
  <div class="table-scroll"><table>
    <thead><tr><th>Agent</th><th>Capability</th><th>Tools</th><th>Permission settings</th></tr></thead>
    <tbody>${builtinRows}</tbody>
  </table></div>` : ''}

  ${report.historyChanges ? `<h2>Changes since last scan</h2><div class="card"><div class="kv">${report.historyChanges.newPaths} new exposure paths · ${report.historyChanges.resolvedPaths} resolved/no longer present · ${report.historyChanges.agentDelta >= 0 ? '+' : ''}${report.historyChanges.agentDelta} agents · ${report.historyChanges.serverDelta >= 0 ? '+' : ''}${report.historyChanges.serverDelta} MCP servers.</div></div>` : '<h2>Changes since last scan</h2><div class="card muted">First local scan. Run Boppi again after changing the environment to compare results.</div>'}

  ${ranked.length ? `
  <h2>Root cause: the single config edit that ${ranked[0].prediction.predictedEliminated.length ? 'breaks the most exposures' : 'lowers the most exposures (none closes one)'}</h2>
  <div class="card" style="border-left:3px solid var(--accent)">
    <b>${esc(editSentence(ranked[0].prediction))}</b>
    <div class="kv">Breaks <b>${ranked[0].prediction.predictedEliminated.length} of ${paths.length}</b> exposures${ranked[0].eliminatedSeverity.critical ? ` (${ranked[0].eliminatedSeverity.critical} critical)` : ''}${ranked[0].lowered.length ? `, lowers ${ranked[0].lowered.length} (${esc(ranked[0].lowered.map(step => `${step.from} to ${step.to}`).join(', '))})` : ''}; ${paths.length - ranked[0].prediction.predictedEliminated.length} would remain. Checked by rescanning without the server.</div>
    ${ranked[0].prediction.disruption ? `<div class="kv muted small">Cost: ${costSentence(ranked[0].prediction.disruption)}.</div>` : ''}
    ${plan && plan.steps.length > 1 ? `<div class="kv muted small">Plan to break ${plan.breaksAll ? 'all' : `${plan.targetedExposures - plan.residualExposureKeys.length} of`} ${plan.targetedExposures} high-or-critical exposures (${plan.steps.length} changes):</div><ol class="small muted" style="margin:6px 0 0 18px">${plan.steps.map(st => `<li>${esc(editSentence(st))} <b>(breaks ${st.breaksCount})</b></li>`).join('')}</ol>` : ''}
    ${plan && !plan.breaksAll ? builtinResidualSentences(report.builtinResidual, plan.residualExposureKeys).map(sentence => `<div class="kv muted small">${esc(sentence)}</div>`).join('') : ''}
  </div>` : paths.length ? `
  <h2>Root cause</h2>
  <div class="card muted small">No MCP config edit closes or lowers a path on this scan. ${(builtinResidualSentences(report.builtinResidual, paths.map(p => p.exposureKey)).map(esc).join(' ')) || esc(terminal.noSingleEditSentence(paths))}</div>` : ''}

${graphSection(view)}

  <h2>Potential exposure paths (${paths.length})</h2>
  ${paths.length ? paths.map(p => `
  <div class="card">
    ${sevBadge(p.severity)} <b>${esc(p.label)}</b> <span class="muted small">· ${esc(p.templateId)} · agent: ${esc(p.agentName)} · evidence confidence ${esc(p.confidence)}${p.stale ? ' · stale evidence' : ''} · likelihood not assessed</span> <button class="link" type="button" data-show-path="${esc(p.id)}">Show in graph</button>
    <div class="chain">${p.nodes.map(n => `<span class="chip">${esc(n.label)}</span>`).join('<span class="arr">→</span>')}</div>
    <div class="kv"><b>Why it matters:</b> ${esc(p.whyItMatters)}</div>
    ${p.assessment ? `<div class="kv"><b>What supports this:</b><ul class="small" style="margin:4px 0 0 18px">${p.assessment.facts.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    ${p.assessment.assumptions.length ? `<div class="kv"><b>What this assumes:</b><ul class="small" style="margin:4px 0 0 18px">${p.assessment.assumptions.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="kv"><b>What was not checked:</b><ul class="small" style="margin:4px 0 0 18px">${p.assessment.unknowns.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="kv muted small">Priority ${esc(p.assessment.priority)} = worst case ${esc(p.assessment.impact)} stepped down by the weakest evidence (${esc(p.assessment.weakestStrength)}). Rubric ${esc(p.assessment.rubricVersion)}.</div>` : ''}
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
      <td class="small">${[...(builtinCapabilities(inventory, a.id).length ? [`built-in tools <span class="muted">(${builtinCapabilities(inventory, a.id).map(capabilityLabel).map(esc).join(', ')})</span>`] : []), ...servers.map(m => `${esc(m.name)} <span class="muted">(trust: ${esc(m.trustStatus)}${(m.capabilities || []).length ? ' · ' + m.capabilities.map(esc).join(', ') : ''})</span>`)].join('<br>') || '<span class="muted">none</span>'}</td>
      <td class="small">${top ? `${sevBadge(top.highestPath.severity)} ${esc(top.highestPath.label)}` : '<span class="muted">none</span>'}</td></tr>`;
    }).join('')}</tbody>
  </table></div>

  <div class="privacy">
    <b>Privacy.</b> This report was generated entirely on this machine. Files read (metadata only, sanitized in memory):
    ${report.portableFilesRead.length ? `<br>${report.portableFilesRead.map(f => `<code>${esc(f)}</code>`).join('<br>')}` : ' none.'}
    <br>Secret values, file contents, and raw path names are never collected; paths become fingerprints. Capabilities marked as inferred come from the server's evidenced identity (package names, directory arguments, environment variable names).
    ${liveToken ? '<br>Live mode: this page is served by <code>boppi ui</code> on 127.0.0.1 only. Fixes run on this machine after an explicit confirmation and a backup.' : '<br>The interactive graph runs from the data embedded in this file and makes no network requests.'}
  </div>
</main>
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
<title>Boppi · Interactive security checkup</title><style>${BRAND_TOKENS}${STYLES}${BRAND_STYLES}</style></head>
<body>${brandHeader()}<main class="wrap" id="main">
<div class="eyebrow"><span class="status-dot"></span>Interactive demo · sample data</div>
<h1>Find the path.<br>Try the smallest change.</h1>
<p class="intro-copy">Boppi reads the MCP server configuration of AI agents such as Claude Desktop, Claude Code, and Cursor. It shows which grants could combine into a potential exposure path, why that matters, and what the smallest fix would cost, before anything changes.</p>
<p class="demo-note"><strong>Nothing on your device is scanned or changed.</strong> ${esc(bundle.banner)} All fixes below are simulated.</p>
<div class="checkup-grid" aria-label="Selected synthetic environment">
  <div class="checkup-stat"><strong id="demo-agent-count">0</strong><span>configured agents</span></div>
  <div class="checkup-stat"><strong id="demo-server-count">0</strong><span>MCP servers</span></div>
  <div class="checkup-stat risk"><strong id="demo-path-count">0</strong><span>potential exposure paths</span></div>
  <div class="checkup-stat scope"><strong>Configuration only</strong><span>No runtime observation</span></div>
</div>
<div class="section-label"><span>01</span>Choose a sample environment</div>
<nav class="demo-nav scenario-nav" id="demo-nav" aria-label="Synthetic scenarios"></nav>
<h2 class="scenario-heading" id="demo-title"></h2><p class="scenario-summary" id="demo-summary"></p>
<div class="journey-grid">
  <section class="card"><div class="eyebrow">Understand the exposure</div><h3 id="demo-risk-title"></h3><p class="risk-copy" id="demo-risk-why"></p><div class="risk-summary" id="demo-risk-action"></div><button type="button" class="btn primary" id="demo-investigate" style="margin-top:16px">Investigate this path →</button></section>
  <section class="card"><div class="eyebrow">Preview, then decide</div><h3>Simulated remediation previews</h3><p class="risk-copy">Removing a server can break a risky path, but also remove useful capabilities. Compare both.</p><div class="simulation-compare"><span>Before <strong id="demo-before">0</strong></span><span aria-hidden="true">→</span><span>Preview <strong id="demo-after">0</strong></span><span>potential paths</span></div><div class="demo-nav" id="demo-fixes"></div><p id="demo-result" role="status" aria-live="polite"></p></section>
</div>
${graphSection(first)}
<h2 id="inventory">Agent and MCP inventory</h2>
<p class="muted small">Configured identities from the sample. Capabilities may be inferred; select a graph node to inspect the evidence.</p>
<div class="table-scroll"><table class="demo-inventory"><thead><tr><th>MCP server</th><th>Agent</th><th>Evidence</th><th>Capabilities (inferred where labeled)</th></tr></thead><tbody id="demo-inventory"></tbody></table></div>
<h2 id="coverage">Know what was checked</h2>
<div class="coverage-strip"><section class="card"><h3>Included in this demo</h3><p>Synthetic MCP configuration, configured servers, metadata-derived capabilities, and potential paths evaluated by the real Boppi engine.</p></section><section class="card"><h3>Not checked</h3><p>Your device, secret values, file contents, actual tool calls, installed package behavior, or whether an agent has been exploited. A clean sample is not proof of safety.</p></section></div>
${evidenceGuide()}
<p class="footer-note">Local by default. Evidence before action. Monitoring is an optional manual prototype, not active here.</p>
</main>
<script type="application/json" id="boppi-data">${embedJson(first)}</script>
<script type="application/json" id="boppi-demo-data">${embedJson(bundle)}</script>
<script>${CLIENT_SCRIPT}</script>
<script>${fs.readFileSync(path.join(__dirname, 'demo.client.js'), 'utf8')}</script>
</body></html>`;
}

module.exports = { renderHtml, renderDemoHtml };
