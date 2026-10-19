#!/usr/bin/env node
/** Verify the synthetic browser demo is separate from real configuration scans. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cli = require('../src/cli/boppi');
const demo = require('../src/cli/demo');
const html = require('../src/cli/render/html');

(async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-demo-'));
  const bundle = await demo.buildBundle({ home, cwd: home, platform: 'darwin' }, { performScan: cli.performScan, version: cli.VERSION });
  const page = html.renderDemoHtml(bundle);
  const ok = (name, condition) => { if (!condition) throw new Error(`FAIL: ${name}`); console.log(`  ✓ ${name}`); };
  ok('bundle contains synthetic scenarios', bundle.scenarios.length >= 4 && /synthetic|simulated/i.test(bundle.banner));
  ok('demo page is self-contained and CSP constrained', page.startsWith('<!doctype html>') && page.includes('Content-Security-Policy') && !/<script src=|<link rel|https?:\/\//.test(page.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')));
  ok('demo page embeds no live token or real home path', !page.includes('<meta name="boppi-live"') && !page.includes(os.homedir()));
  ok('demo page uses text rendering for scenario data', page.includes('textContent') && page.includes('Simulated remediation previews'));
  fs.rmSync(home, { recursive: true, force: true });
  console.log('\n4 passed, 0 failed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
