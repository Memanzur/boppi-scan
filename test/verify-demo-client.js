#!/usr/bin/env node
/** The demo page's client keeps the sample's actual scan separate from a simulated removal: counters and the "Understand the exposure" card describe the sample, the Preview counter and inventory follow the simulation. Runs the real client script against a small DOM stand-in. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cli = require('../src/cli/boppi');
const demo = require('../src/cli/demo');

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }

function element(tag) {
  const listeners = {};
  let content = '';
  const el = {
    tagName: tag, children: [], attributes: {}, hidden: false, onclick: null,
    get textContent() { return content; },
    set textContent(value) { content = String(value); },
    appendChild(child) { el.children.push(child); return child; },
    replaceChildren() { el.children = []; },
    setAttribute(name, value) { el.attributes[name] = String(value); },
    getAttribute(name) { return el.attributes[name] ?? null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    click() { for (const fn of listeners.click || []) fn({}); if (el.onclick) el.onclick({}); },
  };
  return el;
}
function makeDocument(dataJson) {
  const byId = {};
  for (const id of ['boppi-demo-data', 'demo-nav', 'demo-fixes', 'demo-result', 'demo-agent-count', 'demo-server-count', 'demo-path-count', 'demo-after', 'demo-before', 'demo-investigate', 'demo-risk-title', 'demo-risk-why', 'demo-risk-action', 'demo-inventory', 'demo-title', 'demo-summary']) byId[id] = element('div');
  byId['boppi-demo-data'].textContent = dataJson;
  const listeners = {};
  return {
    byId,
    getElementById: id => byId[id],
    createElement: tag => element(tag),
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event); return true; },
  };
}

(async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-demo-client-'));
  const bundle = await demo.buildBundle({ home, cwd: home, platform: 'darwin' }, { performScan: cli.performScan, version: cli.VERSION });
  const document = makeDocument(JSON.stringify({ scenarios: bundle.scenarios }));
  const context = { document, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'render', 'demo.client.js'), 'utf8'), context);
  const text = id => document.byId[id].textContent;
  const buttons = () => document.byId['demo-fixes'].children;
  const nav = document.byId['demo-nav'].children;
  const broadIndex = bundle.scenarios.findIndex(s => /Broad filesystem/.test(s.title));
  const broad = bundle.scenarios[broadIndex];
  nav[broadIndex].click();
  const basePaths = broad.view.paths.length;
  const topPath = broad.view.paths[0];
  ok('the sample opens with its actual path count and top path', text('demo-path-count') === String(basePaths) && text('demo-before') === String(basePaths) && text('demo-risk-title') === topPath.label && text('demo-risk-action').startsWith('Next: inspect the path below'));
  const preview = buttons().find(b => b.textContent.startsWith('Preview removal of'));
  const fix = broad.remediations.find(r => preview.textContent === `Preview removal of ${r.server}`);
  ok('the fixture has a removal that closes every path, the case that used to blank the card', !!fix && fix.after.paths.length === 0 && basePaths > 0);
  preview.click();
  ok('the Preview counter and result line follow the simulation', text('demo-after') === '0' && text('demo-result').startsWith('Simulated. No file was changed.') && preview.getAttribute('aria-pressed') === 'true');
  ok('the headline counters still describe the actual sample', text('demo-path-count') === String(basePaths) && text('demo-before') === String(basePaths));
  ok('the Understand card keeps the actual path and says a preview is active', text('demo-risk-title') === topPath.label && text('demo-risk-why') === topPath.whyItMatters && text('demo-risk-action').startsWith('Simulated preview active: Removing "') && text('demo-risk-action').includes('The sample itself is unchanged'));
  ok('the card never claims the sample has no paths during a preview', !text('demo-risk-title').includes('No potential paths') && !text('demo-risk-action').includes('choose another sample'));
  ok('the inventory follows the preview state', document.byId['demo-inventory'].children.every(row => row.children[0].textContent !== fix.server));
  buttons().find(b => b.textContent === 'Reset simulation').click();
  ok('reset restores the counters and the next-step sentence', text('demo-after') === String(basePaths) && text('demo-risk-action').startsWith('Next: inspect the path below') && buttons().every(b => b.getAttribute('aria-pressed') !== 'true'));
  const tidyIndex = bundle.scenarios.findIndex(s => s.view.paths.length === 0);
  nav[tidyIndex].click();
  ok('a sample with no path says so on its own card', text('demo-risk-title') === 'No potential paths in this sample' && text('demo-risk-action').startsWith('Next: choose another sample') && document.byId['demo-investigate'].hidden === true);
  fs.rmSync(home, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
