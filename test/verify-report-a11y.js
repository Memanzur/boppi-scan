#!/usr/bin/env node
/**
 * Static accessibility checks on the HTML Boppi writes (scan report and demo
 * page): document language and title, one h1 and no skipped heading levels,
 * alt text on images, names on buttons, links, and form controls, no positive
 * tabindex, a viewport meta, and an accessible name or aria-hidden on every
 * inline SVG. Markup the client scripts build at runtime is not covered here.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      shell: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] },
    },
  }, null, 2));
  return home;
}
function run(args, home) {
  return spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
}

const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, 'x').trim();
const attrs = tag => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)=("[^"]*"|'[^']*')/g)].map(m => [m[1].toLowerCase(), m[2].slice(1, -1)]));
function elements(html, name) {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi');
  return [...html.matchAll(re)].map(m => ({ attrs: attrs(m[1] || ''), inner: m[2] }));
}
function voids(html, name) { return [...html.matchAll(new RegExp(`<${name}(\\s[^>]*)?\\/?>`, 'gi'))].map(m => attrs(m[1] || '')); }
const hasName = (el, inner = true) => Boolean(el.attrs['aria-label'] || el.attrs['aria-labelledby'] || el.attrs.title || (inner && stripTags(el.inner)) || (inner && /<img[^>]*alt="[^"]+"/i.test(el.inner)));

function check(label, html) {
  console.log(`\n── ${label} ──`);
  ok('document declares its language', /<html[^>]*\slang="[a-z]{2}/i.test(html));
  ok('document has a non-empty title', elements(html, 'title').some(t => stripTags(t.inner).length > 0));
  ok('viewport meta is present', /<meta[^>]*name="viewport"/i.test(html));
  const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map(m => Number(m[1]));
  ok('exactly one h1', headings.filter(h => h === 1).length === 1, `h1 count ${headings.filter(h => h === 1).length}`);
  const skips = headings.filter((h, i) => i > 0 && h > headings[i - 1] + 1);
  ok('heading levels never skip when descending', skips.length === 0, `sequence ${headings.join(',')}`);
  const imgs = voids(html, 'img');
  ok(`every img has alt text (${imgs.length} images)`, imgs.every(a => typeof a.alt === 'string'));
  const buttons = elements(html, 'button');
  ok(`every button has a name (${buttons.length} buttons)`, buttons.every(b => hasName(b)));
  const links = elements(html, 'a');
  ok(`every link has a name (${links.length} links)`, links.every(a => hasName(a)));
  const labelsFor = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/gi)].map(m => m[1]));
  const controls = [...voids(html, 'input'), ...elements(html, 'select').map(e => e.attrs), ...elements(html, 'textarea').map(e => e.attrs)].filter(a => a.type !== 'hidden');
  ok(`every form control has a label (${controls.length} controls)`, controls.every(a => a['aria-label'] || a['aria-labelledby'] || (a.id && labelsFor.has(a.id))));
  ok('no positive tabindex', !/tabindex="[1-9]/i.test(html));
  const svgs = elements(html, 'svg');
  ok(`every inline svg is named or hidden from assistive tech (${svgs.length} svgs)`, svgs.every(s => s.attrs['aria-hidden'] === 'true' || hasName(s, false) || /<title>[^<]+<\/title>/i.test(s.inner)));
  ok('no element relies on color alone for the severity badge (badge text present)', !/class="[^"]*badge[^"]*"[^>]*>\s*</i.test(html));
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-a11y-'));
  try {
    const home = makeHome(root);
    const report = path.join(root, 'report.html');
    const scan = run(['scan', '--html', report], home);
    ok('scan wrote the HTML report', scan.status === 0 && fs.existsSync(report), scan.stderr.slice(0, 200));
    if (fs.existsSync(report)) check('scan report', fs.readFileSync(report, 'utf8'));
    const demo = path.join(root, 'demo.html');
    const demoRun = run(['demo', '--html', demo], home);
    ok('demo wrote the HTML page', demoRun.status === 0 && fs.existsSync(demo), demoRun.stderr.slice(0, 200));
    if (fs.existsSync(demo)) check('demo page', fs.readFileSync(demo, 'utf8'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log(`\nReport accessibility: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
