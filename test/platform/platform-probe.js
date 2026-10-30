#!/usr/bin/env node
/**
 * Platform probe (AG-19): runs the real CLI against client layouts for this
 * host's platform, with no BOPPI_SCAN_PLATFORM override, in a throwaway home
 * that stands in for the live user's (HOME and USERPROFILE point at it).
 * run-all.js forces macOS rules so fixtures stay identical; this is the
 * check that Linux and Windows read their own locations.
 *
 *   node test/platform/platform-probe.js [repo]
 *
 * In a container, start it with an init so exited processes are reaped:
 *   docker run --rm --init -v "$PWD:/src:ro" node:22 sh -c 'cp -r /src /tmp/r && node /tmp/r/test/platform/platform-probe.js /tmp/r'
 *
 * Exit 0 when every check passes or is a listed known gap. Nothing outside
 * the throwaway home is read or written.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
// Checks that fail today for a reason fixed on another branch. Remove an entry once that branch lands.
const KNOWN = { 'history.json': 'AG-19 row 16 (history.json written 0644), fixed on the QA branch' };

const results = [];
function check(name, passed, detail) {
  results.push(passed);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-probe-')));
const project = path.join(home, 'proj');
fs.mkdirSync(project);
const server = dir => ({ command: process.execPath, args: ['-e', '0', dir] });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function scan(extraEnv = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  for (const name of ['BOPPI_SCAN_PLATFORM', 'BOPPI_SCAN_HOME', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'APPDATA']) if (!(name in extraEnv)) delete env[name];
  const out = path.join(home, 'scan.json');
  fs.rmSync(out, { force: true });
  const run = spawnSync(process.execPath, [path.join(repo, 'bin', 'boppi.js'), 'scan', '--home', home, '--cwd', project, '--json', out, '--no-color'], { env, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { /* reported by the checks */ }
  return { run, json, text: JSON.stringify(json || {}) };
}
const files = json => (json && json.discovery ? json.discovery.clients : []).flatMap(c => (c.files || []).map(f => ({ client: c.clientKey, ...f })));

try {
  console.log(`platform ${process.platform}, node ${process.version}, repo ${repo}`);
  const desktop = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : process.platform === 'win32' ? path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
      : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  write(desktop, JSON.stringify({ mcpServers: { desk: server(home) } }));
  write(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { cur: server(project) } }));
  const forward = project.split(path.sep).join('/');
  const projects = { [project]: { mcpServers: { native: server(project) } } };
  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { cc: server(project) }, projects }));

  const base = scan();
  check('scan exits 0, 1 or 2', base.run.status !== null && base.run.status < 3, `status ${base.run.status} ${(base.run.stderr || '').slice(0, 200)}`);
  const found = files(base.json).filter(f => f.status === 'found').map(f => `${f.client}:${path.basename(f.path)}`);
  check(`Claude Desktop config found at the ${process.platform} location`, found.includes('claude-desktop:claude_desktop_config.json'), found.join(','));
  check('Cursor user config found', found.includes('cursor:mcp.json'));
  check('Claude Code local-scope server keyed by the native cwd is read', base.text.includes('"native"'));

  if (forward !== project) {
    write(path.join(home, '.claude.json'), JSON.stringify({ projects: { [forward]: { mcpServers: { slashkey: server(project) } } } }));
    check('Claude Code local-scope server keyed with forward slashes is read', scan().text.includes('"slashkey"'));
  }

  if (process.platform === 'linux') {
    const xdg = path.join(home, 'xdgconf');
    write(path.join(xdg, 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { xdgdesk: server(home) } }));
    check('XDG_CONFIG_HOME is honored for Claude Desktop', scan({ XDG_CONFIG_HOME: xdg }).text.includes('"xdgdesk"'));
  }

  const claudeDir = path.join(home, 'claude-config');
  write(path.join(claudeDir, '.claude.json'), JSON.stringify({ mcpServers: { ccdir: server(project) } }));
  check('CLAUDE_CONFIG_DIR is honored for Claude Code', scan({ CLAUDE_CONFIG_DIR: claudeDir }).text.includes('"ccdir"'));

  write(path.join(home, '.cursor', 'mcp.json'), '﻿' + JSON.stringify({ mcpServers: { bom: server(project) } }));
  const bom = files(scan().json).find(f => f.client === 'cursor' && f.scope === 'user');
  check('a UTF-8 BOM config (PowerShell 5.1 Set-Content -Encoding utf8) is read', bom && bom.status === 'found', bom && `${bom.status} ${bom.reason || ''}`);

  if (process.platform === 'win32') console.log('SKIP ~/.boppi file modes (Windows has ACLs; check them with icacls on a device)');
  else {
    const dir = path.join(home, '.boppi');
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile()) : [];
    for (const name of entries) {
      const mode = (fs.statSync(path.join(dir, name)).mode & 0o777).toString(8);
      const passed = mode === '600';
      if (!passed && KNOWN[name]) console.log(`KNOWN ~/.boppi/${name} is mode ${mode}: ${KNOWN[name]}`);
      else check(`~/.boppi/${name} is owner-only`, passed, `mode ${mode}`);
    }
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

const failed = results.filter(passed => !passed).length;
console.log(`\n${results.length - failed} of ${results.length} probe checks passed`);
process.exitCode = failed ? 1 : 0;
