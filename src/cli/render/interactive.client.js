/* Boppi interactive report. Runs inside the HTML report, from the embedded
 * view model only. In static mode it never talks to anything; in live mode
 * (served by `boppi ui`) it calls the loopback API for apply and rollback.
 * Every string shown comes from the view model and goes through textContent. */
(function () {
  'use strict';
  var dataEl = document.getElementById('boppi-data');
  if (!dataEl) return;
  var view = JSON.parse(dataEl.textContent);
  var liveMeta = document.querySelector('meta[name="boppi-live"]');
  var live = liveMeta && liveMeta.content ? { token: liveMeta.content } : null;
  var SEV = { critical: 4, high: 3, medium: 2, low: 1 };
  var COLUMN = { agent: 0, server: 1, capability: 2, data: 3, credential: 3, destination: 4 };
  var COLUMN_TITLES = ['Agents', 'MCP servers', 'Capabilities', 'Data and credentials', 'Destinations'];
  var ROW = 46, PAD = 16, HEADER = 26;
  var state = { agent: 'all', path: null, node: null, remediation: null, busy: false, backups: [] };
  var index = {};
  function reindex() {
    index.node = {}; index.edge = {}; index.path = {}; index.remediation = {};
    view.nodes.forEach(function (n) { index.node[n.id] = n; });
    view.edges.forEach(function (e) { index.edge[e.id] = e; });
    view.paths.forEach(function (p) { index.path[p.id] = p; });
    view.remediations.forEach(function (r) { index.remediation[r.id] = r; });
  }
  reindex();

  function h(tag, attrs, children) {
    var node = tag.indexOf('svg:') === 0 ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.setAttribute('class', attrs[key]);
      else if (key === 'text') node.textContent = attrs[key];
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), attrs[key]);
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child === null || child === undefined) return; node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child); });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function badge(severity) { return h('span', { class: 'sev sev-' + severity, text: severity }); }
  function worst(ids) { return ids.map(function (id) { return index.path[id]; }).filter(Boolean).reduce(function (acc, p) { return (SEV[p.severity] || 0) > (SEV[acc] || 0) ? p.severity : acc; }, null); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function agentName(id) { var a = view.agents.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }
  function visibleNodes() { return view.nodes.filter(function (n) { return state.agent === 'all' || n.agentId === state.agent; }); }
  function visiblePaths() { return view.paths.filter(function (p) { return state.agent === 'all' || p.agentId === state.agent; }); }
  function remediationTitle(r) {
    var base = (r.action === 'move_server' ? 'Move' : 'Remove') + ' "' + r.server + '" from ' + r.clientLabel;
    return r.action === 'move_server' && r.target ? base + ' to ' + r.target.label : base;
  }

  /* ---------- graph ---------- */
  var svg = document.getElementById('graph-svg');
  var graphWrap = document.getElementById('graph-wrap');
  function renderGraph() {
    clear(svg);
    var nodes = visibleNodes();
    var width = Math.max(720, graphWrap.clientWidth - 2);
    var colW = (width - PAD * 2) / 5;
    var boxW = Math.min(190, colW - 28);
    var columns = [[], [], [], [], []];
    nodes.sort(function (a, b) { return agentName(a.agentId).localeCompare(agentName(b.agentId)) || ((SEV[b.severity] || 0) - (SEV[a.severity] || 0)) || a.label.localeCompare(b.label); });
    nodes.forEach(function (n) { columns[COLUMN[n.kind] === undefined ? 2 : COLUMN[n.kind]].push(n); });
    var rows = Math.max.apply(null, columns.map(function (c) { return c.length; }).concat([1]));
    var height = HEADER + rows * ROW + PAD;
    svg.setAttribute('width', width); svg.setAttribute('height', height); svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    var defs = h('svg:defs');
    ['none', 'critical', 'high', 'medium', 'low'].forEach(function (sev) {
      defs.appendChild(h('svg:marker', { id: 'arrow-' + sev, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, [h('svg:path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrowhead sev-' + sev })]));
    });
    svg.appendChild(defs);
    COLUMN_TITLES.forEach(function (title, i) { svg.appendChild(h('svg:text', { x: PAD + i * colW + colW / 2, y: 16, class: 'col-title', 'text-anchor': 'middle', text: title })); });
    var pos = {};
    columns.forEach(function (col, ci) {
      var offset = (rows - col.length) * ROW / 2;
      col.forEach(function (n, ri) { pos[n.id] = { x: PAD + ci * colW + (colW - boxW) / 2, y: HEADER + offset + ri * ROW + 6, w: boxW, h: ROW - 12 }; });
    });
    var pathEdgeSev = {}, pathNodeSev = {};
    visiblePaths().forEach(function (p) {
      p.edgeIds.forEach(function (id) { if ((SEV[p.severity] || 0) > (SEV[pathEdgeSev[id]] || 0)) pathEdgeSev[id] = p.severity; });
      p.nodeIds.forEach(function (id) { if ((SEV[p.severity] || 0) > (SEV[pathNodeSev[id]] || 0)) pathNodeSev[id] = p.severity; });
    });
    var selected = state.path ? index.path[state.path] : null;
    var onEdges = selected ? selected.edgeIds : null, onNodes = selected ? selected.nodeIds : null;
    var edgeLayer = h('svg:g', { class: 'edges' });
    view.edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      if (b.x <= a.x) { x1 = a.x + a.w / 2; y1 = a.y + a.h; x2 = b.x + b.w / 2; y2 = b.y; }
      var mx = (x1 + x2) / 2;
      var sev = pathEdgeSev[e.id] || 'none';
      var cls = 'edge sev-' + sev;
      if (onEdges) cls += onEdges.indexOf(e.id) >= 0 ? ' on' : ' dim';
      edgeLayer.appendChild(h('svg:path', { d: 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2, class: cls, 'marker-end': 'url(#arrow-' + sev + ')', 'data-edge': e.id }, [h('svg:title', { text: e.kind.replace(/_/g, ' ') + ' · ' + e.evidenceClass + ' · confidence ' + e.confidence })]));
    });
    svg.appendChild(edgeLayer);
    var nodeLayer = h('svg:g', { class: 'nodes' });
    nodes.forEach(function (n) {
      var p = pos[n.id];
      var sev = pathNodeSev[n.id] || 'none';
      var cls = 'node kind-' + n.kind + ' sev-' + sev;
      if (onNodes) cls += onNodes.indexOf(n.id) >= 0 ? ' on' : ' dim';
      if (state.node === n.id) cls += ' selected';
      var label = n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label;
      var g = h('svg:g', { class: cls, transform: 'translate(' + p.x + ',' + p.y + ')', 'data-node': n.id, tabindex: 0, role: 'button', onclick: function () { selectNode(n.id); }, onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectNode(n.id); } } }, [
        h('svg:rect', { width: p.w, height: p.h, rx: 8 }),
        h('svg:text', { x: 10, y: p.h / 2 + 4, class: 'node-label', text: label }),
        h('svg:title', { text: n.label + ' (' + n.kind + ')' + (n.pathIds.length ? ' · on ' + plural(n.pathIds.length, 'potential exposure path') : '') }),
      ]);
      if (n.pathIds.length) g.appendChild(h('svg:circle', { cx: p.w - 10, cy: 10, r: 5, class: 'dot' }));
      nodeLayer.appendChild(g);
    });
    svg.appendChild(nodeLayer);
  }

  /* ---------- agent filter + path list ---------- */
  function renderToolbar() {
    var bar = clear(document.getElementById('graph-agents'));
    var all = [{ id: 'all', name: 'All agents' }].concat(view.agents);
    all.forEach(function (a) {
      bar.appendChild(h('button', { class: 'pill' + (state.agent === a.id ? ' active' : ''), type: 'button', text: a.name + (a.id === 'all' ? '' : ' · ' + plural(view.paths.filter(function (p) { return p.agentId === a.id; }).length, 'path')), onclick: function () { state.agent = a.id; if (state.path && index.path[state.path].agentId !== a.id && a.id !== 'all') state.path = null; renderAll(); } }));
    });
  }
  function renderPathList() {
    var list = clear(document.getElementById('graph-paths'));
    var paths = visiblePaths().slice().sort(function (a, b) { return (SEV[b.severity] || 0) - (SEV[a.severity] || 0) || a.label.localeCompare(b.label); });
    if (!paths.length) { list.appendChild(h('div', { class: 'muted small', text: 'No potential exposure paths for this selection.' })); return; }
    paths.forEach(function (p) {
      list.appendChild(h('button', { class: 'path-row' + (state.path === p.id ? ' active' : ''), type: 'button', 'data-path-row': p.id, onclick: function () { selectPath(p.id); } }, [
        badge(p.severity), h('span', { class: 'path-row-label', text: p.label }),
        h('span', { class: 'muted small', text: agentName(p.agentId) + ' · ' + plural(p.remediationIds.length, 'fix option') }),
      ]));
    });
  }

  function selectPath(id) { state.path = id; state.node = null; state.remediation = null; renderAll(); scrollPanel(); }
  function selectNode(id) { state.node = id; state.path = null; state.remediation = null; renderAll(); scrollPanel(); }
  function scrollPanel() { var panel = document.getElementById('graph-panel'); if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  /* ---------- detail panel ---------- */
  function evidenceList(lines) {
    return h('dl', { class: 'evidence' }, lines.map(function (line) { return h('div', {}, [h('dt', { text: line.title }), h('dd', { text: line.detail })]); }));
  }
  function renderPanel() {
    var panel = clear(document.getElementById('graph-panel'));
    if (state.path) return renderPathPanel(panel, index.path[state.path]);
    if (state.node) return renderNodePanel(panel, index.node[state.node]);
    panel.appendChild(h('div', { class: 'panel-empty' }, [
      h('b', { text: 'Click a node or a path.' }),
      h('p', { class: 'muted small', text: 'Nodes open the evidence behind them. Paths show why they matter and the exact change that would remove them. ' + view.scope }),
    ]));
  }
  function renderNodePanel(panel, n) {
    panel.appendChild(h('div', { class: 'panel-head' }, [h('span', { class: 'kind kind-' + n.kind, text: n.kind }), h('h3', { text: n.label }), n.severity ? badge(n.severity) : null]));
    panel.appendChild(h('div', { class: 'muted small', text: 'Agent: ' + agentName(n.agentId) + ' · ' + n.evidenceClass + ' · confidence ' + n.confidence + (n.stale ? ' · stale' : '') }));
    panel.appendChild(h('h4', { text: 'Evidence' }));
    panel.appendChild(evidenceList(n.evidence));
    panel.appendChild(h('h4', { text: n.pathIds.length ? 'Potential exposure paths through this node (' + n.pathIds.length + ')' : 'Not on any potential exposure path' }));
    n.pathIds.forEach(function (id) { var p = index.path[id]; panel.appendChild(h('button', { class: 'path-row', type: 'button', onclick: function () { selectPath(id); } }, [badge(p.severity), h('span', { class: 'path-row-label', text: p.label })])); });
    var fixes = view.remediations.filter(function (r) { return r.serverId === n.recordId || r.serverId === n.id; });
    if (fixes.length) { panel.appendChild(h('h4', { text: 'Fix options for this server' })); fixes.forEach(function (r) { panel.appendChild(remediationRow(r)); }); }
    panel.appendChild(h('p', { class: 'muted small disclaimer', text: view.disclaimer }));
  }
  function remediationRow(r) {
    return h('button', { class: 'fix-row' + (state.remediation === r.id ? ' active' : ''), type: 'button', 'data-remediation': r.id, onclick: function () { state.remediation = r.id; renderAll(); } }, [
      h('b', { text: remediationTitle(r) + (r.guided ? ' (guided)' : '') }),
      h('span', { class: 'small', text: 'Removes ' + plural(r.eliminates.length, 'path') + (r.survives.length ? ', ' + r.survives.length + ' remain' : ', none remain') + (r.loses.length ? ' · loses ' + r.loses.join(', ') : ' · loses nothing it does not get elsewhere') }),
    ]);
  }
  function renderPathPanel(panel, p) {
    panel.appendChild(h('div', { class: 'panel-head' }, [badge(p.severity), h('h3', { text: p.label })]));
    panel.appendChild(h('div', { class: 'muted small', text: p.templateId + ' · agent: ' + p.agentName + ' · confidence ' + p.confidence + (p.stale ? ' · stale evidence' : '') + ' · ' + plural(p.evidenceCount, 'evidence source') }));
    panel.appendChild(h('div', { class: 'chain' }, p.chain.reduce(function (acc, label, i) { if (i) acc.push(h('span', { class: 'arr', text: '→' })); acc.push(h('button', { class: 'chip', type: 'button', text: label, onclick: function () { selectNode(p.nodeIds[i]); } })); return acc; }, [])));
    panel.appendChild(h('h4', { text: 'What this means' }));
    panel.appendChild(h('p', { text: p.explanation }));
    panel.appendChild(h('h4', { text: 'Why it matters' }));
    panel.appendChild(h('p', { text: p.whyItMatters }));
    panel.appendChild(h('h4', { text: 'Evidence' }));
    panel.appendChild(h('ul', { class: 'small' }, p.evidence.map(function (e) { return h('li', { text: e.name + ' · ' + e.evidenceClass + (e.type ? ' · ' + e.type : '') }); })));
    panel.appendChild(h('p', { class: 'muted small disclaimer', text: p.disclaimer + ' ' + view.scope }));
    panel.appendChild(h('h4', { text: p.remediationIds.length ? 'Remediate' : 'Remediate (no automatic option)' }));
    if (!p.remediationIds.length) panel.appendChild(h('p', { class: 'small', text: p.remediation }));
    p.remediationIds.map(function (id) { return index.remediation[id]; }).forEach(function (r) { panel.appendChild(remediationRow(r)); });
    if (state.remediation && index.remediation[state.remediation]) panel.appendChild(renderRemediate(index.remediation[state.remediation]));
  }

  /* ---------- remediation preview + apply ---------- */
  function renderRemediate(r) {
    var box = h('div', { class: 'remediate', 'data-remediate': r.id });
    box.appendChild(h('h4', { text: 'Exact change' }));
    var dl = h('dl', { class: 'evidence' });
    dl.appendChild(h('div', {}, [h('dt', { text: r.action === 'move_server' ? 'Remove from' : 'File' }), h('dd', {}, r.files.from.length ? r.files.from.map(function (f) { return h('code', { text: f }); }) : [h('span', { class: 'muted', text: 'file not recorded' })])]));
    if (r.action === 'move_server') dl.appendChild(h('div', {}, [h('dt', { text: 'Add to' }), h('dd', {}, r.files.to.map(function (f) { return h('code', { text: f }); }))]));
    dl.appendChild(h('div', {}, [h('dt', { text: 'Key' }), h('dd', {}, [h('code', { text: r.keyPath })])]));
    if (r.entry) dl.appendChild(h('div', {}, [h('dt', { text: 'Entry (sanitized)' }), h('dd', {}, [h('pre', { text: JSON.stringify(entryForDisplay(r.entry), null, 2) })])]));
    box.appendChild(dl);
    box.appendChild(h('h4', { text: 'Paths that disappear (' + r.eliminates.length + ')' }));
    box.appendChild(h('ul', { class: 'small' }, r.eliminates.map(function (id) { var p = index.path[id]; return h('li', {}, [badge(p.severity), ' ', p.label]); })));
    box.appendChild(h('h4', { text: 'Paths that remain (' + r.survives.length + ')' }));
    box.appendChild(r.survives.length ? h('ul', { class: 'small' }, r.survives.map(function (id) { var p = index.path[id]; return h('li', {}, [badge(p.severity), ' ', p.label, h('span', { class: 'muted', text: ' · not reached through "' + r.server + '"' })]); })) : h('p', { class: 'small muted', text: 'None of the paths found for this agent would remain.' }));
    box.appendChild(h('h4', { text: 'What the agent loses' }));
    box.appendChild(h('p', { class: 'small', text: r.loses.length ? r.loses.join(', ') : 'No capability it does not also get from another server.' + (r.keeps.length ? ' Keeps ' + r.keeps.join(', ') + '.' : '') }));
    if (r.target) box.appendChild(h('p', { class: 'small muted', text: 'Moving creates ' + plural(r.target.appears, 'new path') + ' for ' + r.target.label + '.' }));
    box.appendChild(h('p', { class: 'small safety', text: 'A backup of the file is written to ~/.boppi/backups before anything changes, and the result is graded by a fresh scan. Nothing is sent off this machine.' }));
    if (r.guided) {
      box.appendChild(h('p', { class: 'small', text: 'Guided change: Boppi removes the entry; adding it to ' + (r.target ? r.target.label : 'the other client') + ' is a manual step. Then run boppi verify on the export to grade it.' }));
    }
    if (live && !r.guided) {
      var check = h('input', { type: 'checkbox', id: 'confirm-' + r.id });
      box.appendChild(h('label', { class: 'confirm', for: 'confirm-' + r.id }, [check, ' I understand this removes "' + r.server + '" from ' + r.clientLabel + ' after a backup.']));
      var apply = h('button', { class: 'btn primary', type: 'button', text: 'Apply fix', disabled: 'disabled', onclick: function () { openConfirm(r); } });
      check.addEventListener('change', function () { if (check.checked) apply.removeAttribute('disabled'); else apply.setAttribute('disabled', 'disabled'); });
      box.appendChild(h('div', { class: 'actions' }, [apply]));
    } else {
      box.appendChild(h('h4', { text: live ? 'Run from a terminal' : 'Apply from a terminal' }));
      var pre = h('pre', { class: 'command', text: r.command });
      box.appendChild(pre);
      box.appendChild(h('div', { class: 'actions' }, [
        h('button', { class: 'btn', type: 'button', text: 'Copy command', onclick: function (ev) { copyText(r.command, ev.target); } }),
        h('span', { class: 'muted small', text: 'boppi fix shows this same preview and asks for confirmation before editing.' }),
      ]));
      box.appendChild(stageList(null, 'These steps run when you execute the command. The outcome comes from the rescan, never from this page.'));
    }
    return box;
  }
  function entryForDisplay(entry) {
    var out = {};
    if (entry.command) out.command = entry.command;
    if (entry.arguments && entry.arguments.length) out.args = entry.arguments;
    if (entry.endpoint) out.url = entry.endpoint;
    if (entry.environmentVariableNames && entry.environmentVariableNames.length) { out.env = {}; entry.environmentVariableNames.forEach(function (name) { out.env[name] = '<value never read>'; }); }
    return out;
  }
  function copyText(text, button) {
    var done = function () { var old = button.textContent; button.textContent = 'Copied'; setTimeout(function () { button.textContent = old; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var area = h('textarea', { text: text, style: 'position:fixed;left:-9999px' }); document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); } catch (e) { /* the command is still visible to copy by hand */ }
    document.body.removeChild(area);
  }

  var STAGES = [
    { key: 'backup', label: 'Preparing backup', help: 'Copies the config file to ~/.boppi/backups so the change can be undone.' },
    { key: 'apply', label: 'Applying change', help: 'Removes only the named server entry. Everything else in the file is left as is.' },
    { key: 'rescan', label: 'Rescanning', help: 'Runs the same scan again on the edited file.' },
    { key: 'verify', label: 'Verifying', help: 'Compares the new scan with the prediction: did the paths really disappear?' },
  ];
  function stageList(statusByKey, note) {
    var list = h('ol', { class: 'stages' }, STAGES.map(function (s) {
      var st = statusByKey && statusByKey[s.key] ? statusByKey[s.key] : { status: 'pending' };
      return h('li', { class: 'stage ' + st.status, 'data-stage': s.key }, [h('span', { class: 'stage-mark' }), h('span', { class: 'stage-label', text: s.label }), h('span', { class: 'stage-help muted small', text: st.detail || s.help })]);
    }));
    return h('div', { class: 'stage-box' }, [h('h4', { text: 'What happens' }), list, note ? h('p', { class: 'muted small', text: note }) : null]);
  }

  /* ---------- confirmation modal ---------- */
  function openConfirm(r) {
    closeModal();
    var modal = h('div', { class: 'modal-back', id: 'modal', role: 'dialog', 'aria-modal': 'true' }, [h('div', { class: 'modal' }, [
      h('h3', { text: 'Remove "' + r.server + '" from ' + r.clientLabel + '?' }),
      h('p', { class: 'small' }, ['Boppi will back up ', h('code', { text: r.files.from.join(', ') }), ', delete the ', h('code', { text: r.keyPath }), ' entry, rescan, and grade the result. ' + plural(r.eliminates.length, 'potential exposure path') + ' should disappear' + (r.survives.length ? '; ' + r.survives.length + ' will remain.' : '.')]),
      r.loses.length ? h('p', { class: 'small', text: 'The agent loses: ' + r.loses.join(', ') + '.' }) : null,
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeModal }),
        h('button', { class: 'btn danger', type: 'button', text: 'Yes, remove "' + r.server + '"', onclick: function () { closeModal(); applyFix(r); } }),
      ]),
    ])]);
    modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });
    document.body.appendChild(modal);
  }
  function closeModal() { var m = document.getElementById('modal'); if (m) m.parentNode.removeChild(m); }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeModal(); });

  /* ---------- live apply: stream stage events ---------- */
  function applyFix(r) {
    if (state.busy) return;
    state.busy = true;
    var box = document.querySelector('[data-remediate="' + r.id + '"]');
    var status = {};
    var stageHost = h('div');
    if (box) { Array.prototype.slice.call(box.querySelectorAll('.actions, .confirm')).forEach(function (n) { n.parentNode.removeChild(n); }); box.appendChild(stageHost); }
    var paint = function () { clear(stageHost).appendChild(stageList(status, null)); };
    paint();
    streamJson('/api/fix', { remediationId: r.id, previewHash: r.previewHash, confirm: true }, function (event) {
      if (event.stage === 'result') { stageHost.appendChild(resultCard(event, r)); return; }
      status[event.stage] = event; paint();
    }).catch(function (error) {
      stageHost.appendChild(resultCard({ outcome: 'failed', detail: String(error && error.message || error), remaining: [] }, r));
    }).then(function () { state.busy = false; return refreshState(); });
  }
  function resultCard(result, r) {
    var titles = { removed: 'Exposure removed', reduced: 'Exposure reduced', unresolved: 'Unresolved', failed: 'Not applied', restored: 'Backup restored' };
    var card = h('div', { class: 'result ' + result.outcome }, [h('h4', { text: titles[result.outcome] || result.outcome })]);
    if (result.outcome === 'removed') card.appendChild(h('p', { class: 'small', text: plural((result.eliminated || []).length, 'potential exposure path') + ' no longer appear in the rescan.' }));
    if (result.outcome === 'reduced') card.appendChild(h('p', { class: 'small', text: plural((result.eliminated || []).length, 'path') + ' gone, ' + plural((result.remaining || []).length, 'path') + ' remain.' }));
    if (result.outcome === 'unresolved') card.appendChild(h('p', { class: 'small', text: 'The change was applied, but the rescan still finds the paths below.' }));
    if (result.detail) card.appendChild(h('p', { class: 'small', text: result.detail }));
    if (result.remaining && result.remaining.length) card.appendChild(h('ul', { class: 'small' }, result.remaining.map(function (item) { return h('li', {}, [badge(item.severity || 'low'), ' ', item.label, h('span', { class: 'muted', text: ' · ' + item.reason })]); })));
    if (result.backup) card.appendChild(h('p', { class: 'small muted' }, ['Backup: ', h('code', { text: result.backup }), result.backupId && live ? h('button', { class: 'btn small', type: 'button', text: 'Roll back', onclick: function () { openRollback(result.backupId, result.backup); } }) : null]));
    if (result.exportFile) card.appendChild(h('p', { class: 'small muted' }, ['Before/after export: ', h('code', { text: result.exportFile })]));
    return card;
  }
  function streamJson(url, body, onEvent) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + live.token }, body: JSON.stringify(body) }).then(function (res) {
      if (!res.ok) return res.text().then(function (text) { throw new Error(text || ('HTTP ' + res.status)); });
      var reader = res.body.getReader(), decoder = new TextDecoder(), buffer = '';
      var pump = function () { return reader.read().then(function (chunk) {
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        var lines = buffer.split('\n'); buffer = chunk.done ? '' : lines.pop();
        lines.filter(Boolean).forEach(function (line) { onEvent(JSON.parse(line)); });
        if (!chunk.done) return pump();
      }); };
      return pump();
    });
  }
  function refreshState() {
    if (!live) return Promise.resolve();
    return fetch('/api/state', { headers: { authorization: 'Bearer ' + live.token } }).then(function (res) { return res.json(); }).then(function (next) {
      if (next.view) { view = next.view; reindex(); }
      state.backups = next.backups || [];
      if (state.path && !index.path[state.path]) state.path = null;
      if (state.node && !index.node[state.node]) state.node = null;
      state.remediation = null;
      renderAll();
    }).catch(function () { /* keep the current view; the stage output already told the user what happened */ });
  }

  /* ---------- rollback (live) ---------- */
  function openRollback(backupId, backupPath) {
    closeModal();
    var modal = h('div', { class: 'modal-back', id: 'modal', role: 'dialog', 'aria-modal': 'true' }, [h('div', { class: 'modal' }, [
      h('h3', { text: 'Restore this backup?' }),
      h('p', { class: 'small' }, ['The config file goes back to the copy at ', h('code', { text: backupPath }), '. The removed server returns, and so do the paths it enabled. Boppi rescans afterwards.']),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeModal }),
        h('button', { class: 'btn danger', type: 'button', text: 'Yes, restore', onclick: function () { closeModal(); rollback(backupId); } }),
      ]),
    ])]);
    document.body.appendChild(modal);
  }
  function rollback(backupId) {
    if (state.busy) return;
    state.busy = true;
    var host = document.getElementById('backups-status') || document.getElementById('graph-panel');
    var out = h('div', { class: 'stage-box' }, [h('h4', { text: 'Rolling back' })]);
    clear(host).appendChild(out);
    streamJson('/api/rollback', { backupId: backupId, confirm: true }, function (event) {
      if (event.stage === 'result') out.appendChild(resultCard(event, null));
      else out.appendChild(h('div', { class: 'stage ' + event.status, text: (event.stage === 'restore' ? 'Restoring file' : event.stage === 'rescan' ? 'Rescanning' : event.stage) + (event.detail ? ' · ' + event.detail : '') }));
    }).catch(function (error) { out.appendChild(resultCard({ outcome: 'failed', detail: String(error && error.message || error), remaining: [] }, null)); })
      .then(function () { state.busy = false; return refreshState(); });
  }
  function renderBackups() {
    var host = document.getElementById('graph-backups');
    if (!host) return;
    clear(host);
    if (!live) return;
    host.appendChild(h('h4', { text: 'Backups' }));
    if (!state.backups.length) { host.appendChild(h('p', { class: 'muted small', text: 'No backups yet. Every fix writes one before editing.' })); return; }
    state.backups.forEach(function (b) {
      host.appendChild(h('div', { class: 'backup-row small' }, [h('code', { text: b.original }), h('span', { class: 'muted', text: ' · removed "' + b.server + '" · ' + b.createdAt }), h('button', { class: 'btn small', type: 'button', text: 'Restore', onclick: function () { openRollback(b.id, b.backup); } })]));
    });
    host.appendChild(h('div', { id: 'backups-status' }));
  }

  /* ---------- wiring ---------- */
  function renderAll() { renderToolbar(); renderGraph(); renderPathList(); renderPanel(); renderBackups(); }
  if (!live && document.getElementById('boppi-demo-data')) {
    document.addEventListener('boppi-demo-view', function (event) {
      view = event.detail;
      state.agent = 'all'; state.path = null; state.node = null; state.remediation = null;
      reindex();
      renderAll();
    });
  }
  Array.prototype.slice.call(document.querySelectorAll('[data-show-path]')).forEach(function (btn) {
    btn.addEventListener('click', function () { var id = btn.getAttribute('data-show-path'); var p = index.path[id]; if (p && state.agent !== 'all' && p.agentId !== state.agent) state.agent = 'all'; selectPath(id); document.getElementById('graph').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  });
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderGraph, 120); });
  var modeTag = document.getElementById('graph-mode');
  if (modeTag) modeTag.textContent = live ? 'Live: fixes apply on this machine through boppi ui, after confirmation and a backup.' : 'Configuration evidence. Select a path or node to inspect its evidence; supported local fixes run from the terminal.';
  renderAll();
  if (live) refreshState();
})();
