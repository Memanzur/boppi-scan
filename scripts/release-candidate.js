#!/usr/bin/env node
/**
 * Build the local release candidate and prove it from a fresh install.
 *
 * Packs the tarball, installs it into a throwaway prefix, and runs the beta
 * journey (version, scan, demo, plan, fix, verify, rollback) against a synthetic
 * home. Writes the tarball and CANDIDATE.json to --out (default
 * ~/Desktop/Boppi-candidate-<version>). Publishes nothing.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const ENGINE_VERSION = require(path.join(ROOT, 'src/engine/models.js')).ENGINE_VERSION;
const RUBRIC_VERSION = require(path.join(ROOT, 'src/engine/riskRubric.js')).RUBRIC_VERSION;
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > -1 ? process.argv[outArg + 1] : path.join(os.homedir(), 'Desktop', `Boppi-candidate-${pkg.version}`));

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), ...(detail ? { detail } : {}) });
  console.log(`  ${condition ? '✓' : '✗'} ${name}${!condition && detail ? `  (${detail})` : ''}`);
}
function sh(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options, env: { ...process.env, BOPPI_SCAN_PLATFORM: process.platform, ...(options.env || {}) } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const git = args => sh('git', ['-C', ROOT, ...args]).stdout.trim();

(function main() {
  if (fs.existsSync(path.join(OUT, 'CANDIDATE.json'))) {
    throw new Error(`Candidate already exists at ${OUT}; move it aside or choose a new --out directory.`);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-candidate-'));
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`\nPack ${pkg.name}@${pkg.version}`);
  const packed = sh('npm', ['pack', '--pack-destination', work, '--json'], { cwd: ROOT });
  check('npm pack succeeds', packed.code === 0, packed.stderr.trim().split('\n').pop());
  const tarballName = packed.code === 0 ? JSON.parse(packed.stdout)[0].filename : null;
  const tarball = tarballName ? path.join(work, tarballName) : null;
  const packedFiles = packed.code === 0 ? JSON.parse(packed.stdout)[0].files.map(f => f.path) : [];
  check('tarball ships bin, src, README, LICENSE and nothing else', packedFiles.length > 0 && packedFiles.every(f => /^(bin|src)\/|^(README\.md|LICENSE|package\.json)$/.test(f)), packedFiles.filter(f => !/^(bin|src)\/|^(README\.md|LICENSE|package\.json)$/.test(f)).join(', '));
  check('tarball carries no tests, fixtures, or docs', !packedFiles.some(f => /^(test|docs|scripts)\//.test(f)));
  const sha256 = tarball ? crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex') : null;

  console.log('\nFresh install');
  const prefix = path.join(work, 'prefix');
  const installed = tarball ? sh('npm', ['install', '-g', '--prefix', prefix, tarball]) : { code: 1, stderr: 'no tarball' };
  check('installs into an empty prefix', installed.code === 0, installed.stderr.trim().split('\n').pop());
  const bin = path.join(prefix, 'bin', 'boppi');
  check('bin/boppi exists', fs.existsSync(bin));
  const B = (args, options) => sh(process.execPath, [bin, ...args], options);
  check(`--version prints ${pkg.version}`, B(['--version']).stdout.trim() === pkg.version);

  console.log('\nJourney on a synthetic home');
  const home = path.join(work, 'home');
  const proj = path.join(home, 'proj');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const desktopConfig = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const originalConfig = JSON.stringify({ mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    commander: { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'], env: { API_TOKEN: 'synthetic-secret-value-0000' } },
  } }, null, 2);
  fs.writeFileSync(desktopConfig, originalConfig);
  const common = ['--home', home, '--cwd', proj, '--no-color'];
  const scanJson = path.join(work, 'scan.json');
  const html = path.join(work, 'report.html');
  const sarif = path.join(work, 'report.sarif');
  const scan = B(['scan', ...common, '--json', scanJson, '--html', html, '--sarif', sarif]);
  check('scan exits 0 and reports critical paths', scan.code === 0 && /EXPOSURE PATHS \(\d+\)/.test(scan.stdout) && scan.stdout.includes('CRIT'));
  check('every path states evidence confidence, likelihood not assessed, and what it is based on', /evidence confidence [\d.]+ · likelihood not assessed/.test(scan.stdout) && scan.stdout.includes('based on:') && scan.stdout.includes('not checked:'));
  const artifacts = [scanJson, html, sarif].map(f => fs.readFileSync(f, 'utf8'));
  check('exports carry no secret value', artifacts.every(t => !t.includes('synthetic-secret-value-0000')));
  check('exports carry no raw home path', artifacts.every(t => !t.includes(home)));
  const exported = JSON.parse(artifacts[0]);
  check('export records engine and rubric versions', exported.engineVersion === ENGINE_VERSION && exported.exposurePaths.every(p => p.assessment && p.assessment.rubricVersion === RUBRIC_VERSION), `engineVersion=${exported.engineVersion}`);

  const demo = B(['demo', ...common, '--quiet']);
  check('demo scans the sandbox copy, never the real config', demo.code === 0 && fs.existsSync(path.join(home, '.boppi', 'demo', 'mcp.json')) && fs.readFileSync(desktopConfig, 'utf8') === originalConfig);
  const demoHtml = path.join(work, 'demo.html');
  const demoPage = B(['demo', '--html', demoHtml, ...common]);
  check('demo page is written and self-contained', demoPage.code === 0 && fs.existsSync(demoHtml) && !fs.readFileSync(demoHtml, 'utf8').includes(home));

  const plan = B(['plan', ...common]);
  check('plan lists candidate fixes and changes nothing', plan.code === 0 && plan.stdout.includes('CANDIDATE FIXES') && fs.readFileSync(desktopConfig, 'utf8') === originalConfig);

  const fix = B(['fix', '--server', 'fetch', '--yes', ...common]);
  check('fix applies the edit, rescans, and confirms with counts', fix.code === 0 && fix.stdout.includes('CONFIRMED') && /\d+ paths closed, as predicted/.test(fix.stdout));
  check('fix removed only the fetch entry', (() => { const c = JSON.parse(fs.readFileSync(desktopConfig, 'utf8')); return !c.mcpServers.fetch && c.mcpServers.filesystem && c.mcpServers.commander; })());

  const verify = B(['verify', scanJson, ...common]);
  check('verify grades the earlier export with closed and remaining counts', verify.code === 0 && /\d+ paths? closed, \d+ remaining/.test(verify.stdout));

  const backups = B(['rollback', ...common]);
  const id = (backups.stdout.match(/^\s+(remove_server-[0-9a-f]+)\s/m) || [])[1];
  check('rollback lists the backup', Boolean(id));
  const restored = id ? B(['rollback', '--id', id, '--yes', ...common]) : { code: 1, stdout: '' };
  check('rollback restores the exact original bytes and rescans', restored.code === 0 && fs.readFileSync(desktopConfig, 'utf8') === originalConfig && restored.stdout.includes('Rescan:'));

  console.log('\nParticipant wrapper against the installed tarball (QA only)');
  const kit = path.join(work, 'kit');
  const modules = path.join(kit, 'runtime', 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  fs.symlinkSync(path.join(prefix, 'lib', 'node_modules', pkg.name), path.join(modules, pkg.name), 'dir');
  const wrapper = path.join(kit, 'session.py');
  fs.copyFileSync(path.join(ROOT, 'scripts', 'candidate-kit', 'session.py'), wrapper);
  const participant = (action, confirm = false) => sh('python3', [...(confirm ? [path.join(ROOT, 'test', 'helpers', 'confirm-in-pty.py')] : []), wrapper, 'QA', action], { timeout: 30000 });
  const started = participant('start');
  const sandboxConfig = path.join(kit, 'participants', 'QA', 'synthetic-home', '.boppi', 'demo', 'mcp.json');
  const sandboxOriginal = fs.existsSync(sandboxConfig) ? fs.readFileSync(sandboxConfig, 'utf8') : '';
  check('QA start creates a synthetic sandbox and prints a matching Desktop fix', started.code === 0 && sandboxOriginal.includes('github') && /--client claude-desktop .*--source claude-desktop/.test(started.stdout));
  const preview = participant('plan');
  check('QA plan previews without editing the sandbox', preview.code === 0 && fs.readFileSync(sandboxConfig, 'utf8') === sandboxOriginal);
  const applied = participant('fix', true);
  check('QA fix confirms interactively and removes github from the sandbox', applied.code === 0 && !JSON.parse(fs.readFileSync(sandboxConfig, 'utf8')).mcpServers.github, applied.stderr);
  const graded = participant('verify');
  check('QA verify grades the saved sandbox scan', graded.code === 0 && /paths? closed/.test(graded.stdout));
  const rollback = participant('rollback', true);
  check('QA rollback restores the exact sandbox bytes', rollback.code === 0 && fs.readFileSync(sandboxConfig, 'utf8') === sandboxOriginal, rollback.stderr);
  const again = participant('start');
  check('QA start preserves an existing sandbox', again.code === 0 && again.stdout.includes('Earlier work is preserved') && fs.readFileSync(sandboxConfig, 'utf8') === sandboxOriginal);
  check('QA rehearsal creates no T1-T5 participant homes', ['T1', 'T2', 'T3', 'T4', 'T5'].every(id => !fs.existsSync(path.join(kit, 'participants', id))) && fs.readFileSync(desktopConfig, 'utf8') === originalConfig);

  console.log('\nConfig lookup on the experimental platforms (path lookup only; nothing here proves a Linux or Windows machine)');
  const linuxHome = path.join(work, 'linux-home');
  fs.mkdirSync(path.join(linuxHome, '.config', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(linuxHome, '.config', 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }));
  const linux = B(['scan', '--only', 'claude-desktop', '--platform', 'linux', '--home', linuxHome, '--cwd', linuxHome, '--no-color', '--history-file', path.join(work, 'linux-history.json')]);
  check('linux: Claude Desktop is read from ~/.config/Claude', linux.code === 0 && linux.stdout.includes('.config/Claude/claude_desktop_config.json') && linux.stdout.includes('1 MCP server'));
  const winHome = path.join(work, 'win-home');
  fs.mkdirSync(path.join(winHome, 'AppData', 'Roaming', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(winHome, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }));
  const win = B(['scan', '--only', 'claude-desktop', '--platform', 'win32', '--home', winHome, '--cwd', winHome, '--no-color', '--history-file', path.join(work, 'win-history.json')], { env: { APPDATA: '' } });
  check('win32: Claude Desktop is read from AppData/Roaming/Claude when APPDATA is unset', win.code === 0 && win.stdout.includes(path.join('AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')) && win.stdout.includes('1 MCP server'));

  console.log('\nUninstall');
  const removed = sh('npm', ['uninstall', '-g', '--prefix', prefix, pkg.name]);
  check('npm uninstall from the prefix leaves no bin', removed.code === 0 && !fs.existsSync(bin));

  const failed = checks.filter(c => !c.passed);
  const manifest = {
    name: pkg.name,
    package_version: pkg.version,
    engine_version: ENGINE_VERSION,
    rubric_version: RUBRIC_VERSION,
    scanner_commit: git(['rev-parse', 'HEAD']),
    scanner_branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    worktree_clean: git(['status', '--porcelain']) === '',
    artifact: tarballName ? `package/${tarballName}` : null,
    sha256,
    built_at: new Date().toISOString(),
    built_with: { node: process.version, npm: sh('npm', ['--version']).stdout.trim(), platform: `${process.platform} ${os.release()}` },
    supported: { node: pkg.engines.node, platforms_verified: [process.platform], platforms_experimental: ['linux', 'win32'].filter(p => p !== process.platform), clients: ['claude-desktop', 'claude-code', 'cursor'] },
    journey_checks: { passed: checks.length - failed.length, failed: failed.length, failures: failed.map(f => f.name) },
    human_sessions_completed: 0,
    published: false,
  };
  if (tarball) { fs.mkdirSync(path.join(OUT, 'package'), { recursive: true }); fs.copyFileSync(tarball, path.join(OUT, 'package', tarballName)); }
  fs.writeFileSync(path.join(OUT, 'CANDIDATE.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\n${manifest.journey_checks.passed} passed, ${failed.length} failed`);
  console.log(`candidate: ${OUT}/CANDIDATE.json${tarball ? ` · ${OUT}/package/${tarballName} · sha256 ${sha256}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
