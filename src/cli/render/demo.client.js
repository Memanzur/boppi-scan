(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('boppi-demo-data').textContent);
  var nav = document.getElementById('demo-nav');
  var fixes = document.getElementById('demo-fixes');
  var result = document.getElementById('demo-result');
  function update(view) {
    document.dispatchEvent(new CustomEvent('boppi-demo-view', { detail: view }));
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
    Array.prototype.forEach.call(nav.children, function (node, i) {
      node.setAttribute('aria-pressed', i === index ? 'true' : 'false');
    });
    document.getElementById('demo-title').textContent = scenario.title;
    document.getElementById('demo-summary').textContent = scenario.summary;
    fixes.replaceChildren();
    result.textContent = scenario.view.paths.length + ' potential exposure paths in this synthetic configuration.';
    update(scenario.view);
    scenario.remediations.forEach(function (fix) {
      fixes.appendChild(button('Preview removal of ' + fix.server, function () {
        update(fix.after);
        result.textContent = 'Simulated. No file was changed. ' + fix.eliminated.length + ' path(s) removed; ' + fix.after.paths.length + ' remain. Lost capabilities: ' + (fix.loses.join(', ') || 'none');
      }));
    });
    fixes.appendChild(button('Reset simulation', function () { show(index); }));
  }
  data.scenarios.forEach(function (scenario, index) {
    nav.appendChild(button(scenario.title, function () { show(index); }));
  });
  show(0);
})();
