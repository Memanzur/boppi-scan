(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('boppi-demo-data').textContent);
  var nav = document.getElementById('demo-nav');
  var fixes = document.getElementById('demo-fixes');
  var result = document.getElementById('demo-result');
  var activeScenario = null;
  function text(id, value) { document.getElementById(id).textContent = value; }
  function summarize(view) {
    text('demo-agent-count',view.agents.length);
    text('demo-server-count',view.nodes.filter(function(n){return n.kind==='server';}).length);
    text('demo-path-count',view.paths.length);
    text('demo-after',view.paths.length);
    var path = view.paths[0];
    var investigate = document.getElementById('demo-investigate');
    investigate.hidden = !path;
    investigate.onclick = path ? function(){document.dispatchEvent(new CustomEvent('boppi-select-path',{detail:{id:path.id}}));} : null;
    text('demo-risk-title',path ? path.label : 'No potential paths in this sample');
    text('demo-risk-why',path ? path.whyItMatters : 'No supported exposure template matches this configuration. This does not establish that an environment is safe.');
    text('demo-risk-action',path ? 'Next: inspect the path below or preview a server removal. Nothing will be applied.' : 'Next: choose another sample to explore a risk and its trade-offs.');
    var inventory = document.getElementById('demo-inventory');
    inventory.replaceChildren();
    view.nodes.filter(function(n){return n.kind==='server';}).forEach(function(server){
      var row=document.createElement('tr');
      var agent=view.agents.filter(function(a){return a.id===server.agentId;})[0];
      var capabilities=server.evidence.filter(function(e){return e.title==='Capabilities';})[0];
      [server.label,agent?agent.name:'Unknown',server.evidenceLabel||server.evidenceClass,capabilities?capabilities.detail:'Unknown, not assumed safe'].forEach(function(value){var cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);});
      inventory.appendChild(row);
    });
    if (!inventory.children.length) { var row=document.createElement('tr'), cell=document.createElement('td');cell.colSpan=4;cell.textContent='No MCP servers in this preview state.';row.appendChild(cell);inventory.appendChild(row); }
  }
  function update(view) {
    summarize(view);
    document.dispatchEvent(new CustomEvent('boppi-demo-view', { detail: view }));
  }
  function simulate(fix) {
    update(fix.after);
    result.textContent = 'Simulated. No file was changed. ' + fix.eliminated.length + ' path(s) removed; ' + fix.after.paths.length + ' remain. Lost capabilities: ' + (fix.loses.join(', ') || 'none');
  }
  function button(label, action) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = 'btn';
    node.textContent = label;
    node.addEventListener('click', action);
    return node;
  }
  function show(index) {
    var scenario = data.scenarios[index];
    activeScenario = scenario;
    Array.prototype.forEach.call(nav.children, function (node, i) {
      node.setAttribute('aria-pressed', i === index ? 'true' : 'false');
    });
    document.getElementById('demo-title').textContent = scenario.title;
    document.getElementById('demo-summary').textContent = scenario.summary;
    fixes.replaceChildren();
    result.textContent = scenario.view.paths.length + ' potential exposure paths in this synthetic configuration.';
    text('demo-before',scenario.view.paths.length);
    update(scenario.view);
    scenario.remediations.forEach(function (fix) {
      fixes.appendChild(button('Preview removal of ' + fix.server, function () {
        simulate(fix);
      }));
    });
    fixes.appendChild(button('Reset simulation', function () { show(index); }));
  }
  data.scenarios.forEach(function (scenario, index) {
    nav.appendChild(button(scenario.title, function () { show(index); }));
  });
  document.addEventListener('boppi-demo-simulate',function(event){
    var fix=activeScenario.remediations.filter(function(candidate){return candidate.id===event.detail.id;})[0];
    if(fix) simulate(fix);
  });
  show(data.scenarios.length>1 ? 1 : 0);
})();
