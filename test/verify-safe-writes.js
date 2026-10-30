#!/usr/bin/env node
/** boppi fix and boppi rollback write like the connector: per-file lock, no symlinks, hash recheck, atomic rename, mode kept (T-5). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hasMode, symlinkOrSkip } = require('./helpers/platform');
const { spawnSync } = require('child_process');
const fix = require('../src/cli/fix');
const remediate = require('../src/cli/remediate');
const { parseArgs, performScan } = require('../src/cli/boppi');
const { pathFingerprint } = require('../src/engine/localMcpScanner');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root, name) {
  const home = path.join(root, name);
  const dir = path.join(home, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'keep-me', mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] }, time: { command: 'uvx', args: ['mcp-server-time'] } } }, null, 2));
  return { home, file };
}

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const manifest = home => fix.readManifest(home).entries;

async function drain(stages) { const events = []; for await (const e of stages) events.push(e); return events; }

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-safe-writes-'));
  try {
    section('fix refuses a symlinked config');
    {
      const { home, file } = makeHome(root, 'symlink');
      const real = path.join(root, 'symlink-real.json');
      fs.renameSync(file, real);
      if (symlinkOrSkip(real, file, 'fix refuses a symlinked config')) {
        const before = fs.readFileSync(real, 'utf8');
        const result = runCli(['fix', '--server', 'fetch', '--yes'], home);
        ok('fix does not report success', result.code !== 0 && !/removed mcpServers/.test(result.stdout));
        ok('the symlink target is unchanged and still a symlink', fs.readFileSync(real, 'utf8') === before && fs.lstatSync(file).isSymbolicLink());
        ok('no manifest entry was recorded', manifest(home).length === 0);
      }
    }

    section('a direct run: stale preview hash, failed write, lock held');
    {
      const { home, file } = makeHome(root, 'direct');
      const options = parseArgs(['fix', '--server', 'fetch', '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')]);
      options.platform = 'darwin';
      const scanBefore = await performScan(options);
      const original = fs.readFileSync(file);
      const expectedHashes = { [file]: fix.sha256(original) };
      const base = { options, server: 'fetch', clientKey: 'claude-desktop', scanBefore, expectedHashes, rescan: performScan };

      fs.appendFileSync(file, '\n');
      const stale = await drain(remediate.runRemediation(base));
      ok('a file saved after the preview is refused before any backup', stale.some(e => e.status === 'failed' && /changed since the preview/.test(e.detail.reason)) && !stale.some(e => e.stage === 'backup' && e.status === 'done'));
      ok('the newer bytes are kept', fs.readFileSync(file).equals(Buffer.concat([original, Buffer.from('\n')])));
      fs.writeFileSync(file, original);

      const broken = await drain(remediate.runRemediation({ ...base, io: { writeAtomic: () => { throw new Error('disk full'); } } }));
      ok('a failed atomic write reports not written', broken.some(e => e.stage === 'apply' && e.status === 'failed' && e.detail.written === false && /disk full/.test(e.detail.reason)));
      ok('the original bytes are intact, no manifest entry exists, and the unused backup is removed', fs.readFileSync(file).equals(original) && manifest(home).length === 0 && (!fs.existsSync(fix.backupDir(home)) || fs.readdirSync(fix.backupDir(home)).filter(n => n.endsWith('.bak')).length === 0));

      const release = fix.acquireLock(home, pathFingerprint(file));
      const locked = await drain(remediate.runRemediation(base));
      release();
      ok('a held lock refuses the fix and writes nothing', locked.some(e => e.status === 'failed' && /another boppi process/.test(e.detail.reason)) && fs.readFileSync(file).equals(original));
      ok('the lock is the connector lock path', fix.lockPath(home, pathFingerprint(file)).includes(path.join('.boppi', 'locks')));

      fs.chmodSync(file, 0o640);
      const applied = await drain(remediate.runRemediation(base));
      ok('an unchanged file is fixed', applied.some(e => e.stage === 'apply' && e.status === 'done'));
      ok('the file mode is kept', hasMode(file, 0o640));
      ok('only the chosen entry was removed', (() => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return !j.mcpServers.fetch && j.mcpServers.time && j.theme === 'keep-me'; })());
      ok('no lock file is left behind', !fs.existsSync(fix.lockPath(home, pathFingerprint(file))));
      ok('no temp file is left next to the config', fs.readdirSync(path.dirname(file)).every(name => !name.endsWith('.tmp')));
    }

    section('rollback refuses a symlink and keeps the mode');
    {
      const { home, file } = makeHome(root, 'rollback');
      const original = fs.readFileSync(file);
      fs.chmodSync(file, 0o640);
      const applied = runCli(['fix', '--server', 'fetch', '--yes'], home);
      const entry = manifest(home).find(e => e.action === 'remove_server');
      ok('setup: fix applied', applied.code === 0 && entry);
      const fixed = fs.readFileSync(file);
      const real = path.join(root, 'rollback-real.json');
      fs.renameSync(file, real);
      if (symlinkOrSkip(real, file, 'rollback through a symlink is refused')) {
        const viaLink = runCli(['rollback', '--id', entry.id, '--yes'], home);
        ok('rollback through a symlink is refused and writes nothing', viaLink.code === 2 && /not a regular file/.test(viaLink.stderr) && fs.readFileSync(real).equals(fixed) && fs.lstatSync(file).isSymbolicLink());
        fs.unlinkSync(file);
      }
      fs.renameSync(real, file);
      const restored = runCli(['rollback', '--id', entry.id, '--yes'], home);
      ok('rollback restores the exact original bytes', restored.code === 0 && fs.readFileSync(file).equals(original));
      ok('rollback keeps the file mode', hasMode(file, 0o640));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
