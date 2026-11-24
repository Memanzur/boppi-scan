#!/usr/bin/env node
/** boppi guard runs a command only when the policy passes, and never through a shell. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const SECRET = 'sk-ant-guardplaintextvalue123456';
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')], env: { OPENAI_API_KEY: SECRET } },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    },
  }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  return home;
}

function runCli(args, home, cwd, extraEnv = {}) {
  const separator = args.indexOf('--');
  const head = separator === -1 ? args : args.slice(0, separator);
  const tail = separator === -1 ? [] : args.slice(separator);
  return spawnSync(process.execPath, [CLI, ...head, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json'), ...tail], {
    encoding: 'utf8',
    env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', ...extraEnv },
  });
}

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-guard-'));
  const home = makeHome(root);
  const cwd = path.join(root, 'project');
  fs.mkdirSync(cwd, { recursive: true });
  const marker = path.join(root, 'ran.txt');
  const command = [process.execPath, '-e', 'require("fs").writeFileSync(process.env.BOPPI_GUARD_MARKER, "ran"); process.exit(7)'];

  section('help and arguments');
  const help = runCli(['guard', '--help'], home, cwd);
  ok('guard --help exits 0 and names the wrapper', help.status === 0 && help.stdout.includes('boppi guard -- <command>') && help.stdout.includes('policy guard passes'));
  const bare = runCli(['guard'], home, cwd);
  ok('guard without a policy exits 2 and does not scan as a success', bare.status === 2 && /requires a policy/.test(bare.stderr) && !fs.existsSync(marker));
  const empty = runCli(['guard', '--policy', path.join(cwd, 'missing.json'), '--'], home, cwd);
  ok('guard -- with no command exits 2', empty.status === 2 && /requires a command/.test(empty.stderr));
  const scanDash = runCli(['scan', '--', 'echo'], home, cwd);
  ok('-- is rejected on scan', scanDash.status === 2 && /only valid with boppi guard/.test(scanDash.stderr));

  section('a failing policy does not run the command');
  const deny = path.join(cwd, 'deny.json');
  fs.writeFileSync(deny, JSON.stringify({ denyServers: ['filesystem'] }));
  const blocked = runCli(['guard', '--policy', deny, '--', ...command], home, cwd, { BOPPI_GUARD_MARKER: marker });
  ok('a denied server exits 1', blocked.status === 1 && blocked.stdout.includes('POL-DENY-SERVER') && blocked.stderr.includes('was not run'));
  ok('the wrapped command did not run', !fs.existsSync(marker));
  ok('the planted secret value is not printed', !blocked.stdout.includes(SECRET) && !blocked.stderr.includes(SECRET));

  section('a passing policy runs the command');
  const allow = path.join(cwd, 'allow.json');
  fs.writeFileSync(allow, JSON.stringify({ allowServers: ['filesystem', 'fetch', 'mcp-server'] }));
  const allowed = runCli(['guard', '--policy', allow, '--', ...command], home, cwd, { BOPPI_GUARD_MARKER: marker });
  ok('the command exit code is returned', allowed.status === 7);
  ok('the command ran after the guard passed', fs.readFileSync(marker, 'utf8') === 'ran' && allowed.stdout.includes('POLICY  passed'));

  section('dry-run does not run the command');
  fs.rmSync(marker);
  const dry = runCli(['guard', '--dry-run', '--policy', allow, '--', ...command], home, cwd, { BOPPI_GUARD_MARKER: marker });
  ok('dry-run exits 0 and names the command', dry.status === 0 && dry.stdout.includes('Would run:') && dry.stdout.includes(process.execPath));
  ok('dry-run does not run the command', !fs.existsSync(marker));

  section('a check with no wrapped command');
  const check = runCli(['guard', '--policy', allow], home, cwd);
  ok('a passing guard with no command exits 0', check.status === 0 && check.stdout.includes('No command was wrapped'));

  section('an incomplete scan does not run the command');
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-guard-broken-'));
  const brokenHome = path.join(brokenRoot, 'home');
  const brokenCwd = path.join(brokenRoot, 'project');
  const brokenConfigDir = path.join(brokenHome, 'Library', 'Application Support', 'Claude');
  fs.mkdirSync(brokenConfigDir, { recursive: true });
  fs.mkdirSync(brokenCwd, { recursive: true });
  const brokenConfig = path.join(brokenConfigDir, 'claude_desktop_config.json');
  const brokenMarker = path.join(brokenRoot, 'ran.txt');
  const brokenDeny = path.join(brokenCwd, 'deny.json');
  fs.writeFileSync(brokenDeny, JSON.stringify({ denyServers: ['filesystem'] }));
  const wrapped = [process.execPath, '-e', 'require("fs").writeFileSync(process.env.BOPPI_GUARD_MARKER, "ran")'];

  function makeUnreadable(file) {
    fs.writeFileSync(file, JSON.stringify({
      mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', brokenHome] } },
    }));
    fs.chmodSync(file, 0o000);
    try {
      fs.readFileSync(file);
      fs.chmodSync(file, 0o644);
      fs.rmSync(file);
      fs.mkdirSync(file);
    } catch (error) {
      if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    }
  }
  function restoreConfig(file) {
    try { fs.chmodSync(file, 0o644); } catch (_) { /* a directory has no mode we need */ }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) fs.rmdirSync(file);
  }

  makeUnreadable(brokenConfig);
  const unreadable = runCli(['guard', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  ok('an unreadable config exits 4 and does not run the command', unreadable.status === 4 && /Scan incomplete:/.test(unreadable.stderr) && unreadable.stderr.includes('Claude Desktop') && !fs.existsSync(brokenMarker) && !unreadable.stdout.includes('POLICY  passed') && !unreadable.stdout.includes('Would run:'));
  restoreConfig(brokenConfig);

  fs.writeFileSync(brokenConfig, '{ not json');
  const malformed = runCli(['guard', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  ok('malformed JSON exits 4 and does not run the command', malformed.status === 4 && /Scan incomplete:/.test(malformed.stderr) && malformed.stderr.includes('Claude Desktop') && !fs.existsSync(brokenMarker) && !malformed.stdout.includes('POLICY  passed'));

  fs.writeFileSync(brokenConfig, '{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] } ');
  const deniedBroken = runCli(['guard', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  const deniedScan = runCli(['scan', '--policy', brokenDeny, '--quiet'], brokenHome, brokenCwd);
  ok('a denied server inside a broken config exits 4 and does not run the command', deniedBroken.status === 4 && deniedScan.status === 4 && /Scan incomplete:/.test(deniedBroken.stderr) && !fs.existsSync(brokenMarker) && !deniedBroken.stdout.includes('POLICY  passed') && !deniedBroken.stdout.includes('RAN'));
  const dryBroken = runCli(['guard', '--dry-run', '--policy', brokenDeny, '--', ...wrapped], brokenHome, brokenCwd, { BOPPI_GUARD_MARKER: brokenMarker });
  ok('dry-run on an incomplete scan exits 4 and does not run the command', dryBroken.status === 4 && !fs.existsSync(brokenMarker) && !dryBroken.stdout.includes('Would run:') && /Scan incomplete:/.test(dryBroken.stderr));

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(brokenRoot, { recursive: true, force: true });

  section('hidden configs are incomplete and do not run the command');
  function freshHome() {
    const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-guard-hide-'));
    const caseHome = path.join(caseRoot, 'home');
    const caseCwd = path.join(caseRoot, 'project');
    const configDir = path.join(caseHome, 'Library', 'Application Support', 'Claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(caseCwd, { recursive: true });
    const config = path.join(configDir, 'claude_desktop_config.json');
    const denyFile = path.join(caseCwd, 'deny.json');
    fs.writeFileSync(denyFile, JSON.stringify({ denyServers: ['filesystem'] }));
    const caseMarker = path.join(caseRoot, 'ran.txt');
    return { caseRoot, caseHome, caseCwd, configDir, config, denyFile, caseMarker };
  }
  const filesystemConfig = (dir) => JSON.stringify({
    mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', dir] } },
  });
  function hidden(args, home, dir, marker) {
    return runCli(args, home, dir, { BOPPI_GUARD_MARKER: marker });
  }
  function refused(result, marker) {
    return result.status === 4 && /Scan incomplete:/.test(result.stderr) && !fs.existsSync(marker) && !result.stdout.includes('POLICY  passed') && !result.stdout.includes('Would run:');
  }
  function modeBlocks(target) {
    try {
      fs.readdirSync(target);
      return false;
    } catch (error) {
      return error.code === 'EACCES' || error.code === 'EPERM';
    }
  }

  const deniedDir = freshHome();
  fs.writeFileSync(deniedDir.config, filesystemConfig(deniedDir.caseHome));
  fs.mkdirSync(path.join(deniedDir.caseHome, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(deniedDir.caseHome, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  fs.chmodSync(deniedDir.configDir, 0o000);
  const dirBlocked = modeBlocks(deniedDir.configDir);
  const dirGuard = hidden(['guard', '--policy', deniedDir.denyFile, '--', ...wrapped], deniedDir.caseHome, deniedDir.caseCwd, deniedDir.caseMarker);
  const dirDry = hidden(['guard', '--dry-run', '--policy', deniedDir.denyFile, '--', ...wrapped], deniedDir.caseHome, deniedDir.caseCwd, deniedDir.caseMarker);
  const dirScan = hidden(['scan', '--policy', deniedDir.denyFile, '--quiet'], deniedDir.caseHome, deniedDir.caseCwd, deniedDir.caseMarker);
  ok('a permission denied config directory exits 4 and does not run the command', !dirBlocked || (refused(dirGuard, deniedDir.caseMarker) && refused(dirDry, deniedDir.caseMarker) && dirScan.status === 4));
  fs.chmodSync(deniedDir.configDir, 0o755);
  fs.rmSync(deniedDir.caseRoot, { recursive: true, force: true });

  const selfLink = freshHome();
  let selfLinked = true;
  try { fs.symlinkSync(path.basename(selfLink.config), selfLink.config); } catch (_) { selfLinked = false; }
  const selfGuard = selfLinked ? hidden(['guard', '--policy', selfLink.denyFile, '--', ...wrapped], selfLink.caseHome, selfLink.caseCwd, selfLink.caseMarker) : null;
  const selfDry = selfLinked ? hidden(['guard', '--dry-run', '--policy', selfLink.denyFile, '--', ...wrapped], selfLink.caseHome, selfLink.caseCwd, selfLink.caseMarker) : null;
  ok('a config symlink that points at itself exits 4 and does not run the command', !selfLinked || (refused(selfGuard, selfLink.caseMarker) && refused(selfDry, selfLink.caseMarker)));
  fs.rmSync(selfLink.caseRoot, { recursive: true, force: true });

  const pair = freshHome();
  const other = path.join(pair.configDir, 'other.json');
  let paired = true;
  try {
    fs.symlinkSync('other.json', pair.config);
    fs.symlinkSync(path.basename(pair.config), other);
  } catch (_) { paired = false; }
  const pairGuard = paired ? hidden(['guard', '--policy', pair.denyFile, '--', ...wrapped], pair.caseHome, pair.caseCwd, pair.caseMarker) : null;
  const pairScan = paired ? hidden(['scan', '--policy', pair.denyFile, '--quiet'], pair.caseHome, pair.caseCwd, pair.caseMarker) : null;
  ok('two config names that point at each other exit 4 and do not run the command', !paired || (refused(pairGuard, pair.caseMarker) && pairScan.status === 4));
  fs.rmSync(pair.caseRoot, { recursive: true, force: true });

  const huge = freshHome();
  fs.writeFileSync(huge.config, filesystemConfig(huge.caseHome) + ' '.repeat(2_000_001));
  const hugeGuard = hidden(['guard', '--policy', huge.denyFile, '--', ...wrapped], huge.caseHome, huge.caseCwd, huge.caseMarker);
  const hugeDry = hidden(['guard', '--dry-run', '--policy', huge.denyFile, '--', ...wrapped], huge.caseHome, huge.caseCwd, huge.caseMarker);
  const hugeScan = hidden(['scan', '--policy', huge.denyFile, '--quiet'], huge.caseHome, huge.caseCwd, huge.caseMarker);
  ok('a config larger than 2MB exits 4 and does not run the command', refused(hugeGuard, huge.caseMarker) && refused(hugeDry, huge.caseMarker) && hugeScan.status === 4);
  fs.rmSync(huge.caseRoot, { recursive: true, force: true });

  const project = freshHome();
  fs.writeFileSync(project.config, JSON.stringify({ mcpServers: {} }));
  const secret = path.join(project.caseHome, 'Projects', 'secret');
  fs.mkdirSync(path.join(secret, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(secret, '.cursor', 'mcp.json'), filesystemConfig(project.caseHome));
  fs.chmodSync(secret, 0o000);
  const projectBlocked = modeBlocks(secret);
  const projectGuard = hidden(['guard', '--policy', project.denyFile, '--', ...wrapped], project.caseHome, project.caseCwd, project.caseMarker);
  const projectDry = hidden(['guard', '--dry-run', '--policy', project.denyFile, '--', ...wrapped], project.caseHome, project.caseCwd, project.caseMarker);
  const projectScan = hidden(['scan', '--policy', project.denyFile, '--quiet'], project.caseHome, project.caseCwd, project.caseMarker);
  ok('an unreadable project directory exits 4 and does not run the command', !projectBlocked || (refused(projectGuard, project.caseMarker) && refused(projectDry, project.caseMarker) && projectScan.status === 4));
  fs.chmodSync(secret, 0o755);
  fs.rmSync(project.caseRoot, { recursive: true, force: true });

  section('project configs are covered the same way as home configs');
  function projectHome() {
    const made = freshHome();
    fs.writeFileSync(made.config, JSON.stringify({ mcpServers: {} }));
    return made;
  }
  function denied(result, marker) {
    return result.status === 1 && result.stdout.includes('POL-DENY-SERVER') && result.stderr.includes('was not run') && !fs.existsSync(marker);
  }

  const cursorLink = projectHome();
  const cursorDir = path.join(cursorLink.caseHome, 'Projects', 'app', '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(path.join(cursorDir, 'real.json'), filesystemConfig(cursorLink.caseHome));
  fs.symlinkSync('real.json', path.join(cursorDir, 'mcp.json'));
  const cursorLinked = hidden(['guard', '--policy', cursorLink.denyFile, '--', ...wrapped], cursorLink.caseHome, cursorLink.caseCwd, cursorLink.caseMarker);
  ok('a project .cursor/mcp.json symlink to a denied config does not run the command', denied(cursorLinked, cursorLink.caseMarker));
  fs.rmSync(cursorLink.caseRoot, { recursive: true, force: true });

  const mcpLink = projectHome();
  const mcpApp = path.join(mcpLink.caseHome, 'Projects', 'app');
  fs.mkdirSync(mcpApp, { recursive: true });
  fs.writeFileSync(path.join(mcpApp, 'real-mcp.json'), filesystemConfig(mcpLink.caseHome));
  fs.symlinkSync('real-mcp.json', path.join(mcpApp, '.mcp.json'));
  const mcpLinked = hidden(['guard', '--policy', mcpLink.denyFile, '--', ...wrapped], mcpLink.caseHome, mcpLink.caseCwd, mcpLink.caseMarker);
  ok('a project .mcp.json symlink to a denied config does not run the command', denied(mcpLinked, mcpLink.caseMarker));
  fs.rmSync(mcpLink.caseRoot, { recursive: true, force: true });

  const homeLink = freshHome();
  fs.writeFileSync(path.join(homeLink.configDir, 'real.json'), filesystemConfig(homeLink.caseHome));
  fs.symlinkSync('real.json', homeLink.config);
  const homeLinked = hidden(['guard', '--policy', homeLink.denyFile, '--', ...wrapped], homeLink.caseHome, homeLink.caseCwd, homeLink.caseMarker);
  ok('a home config symlink to a denied config does not run the command', denied(homeLinked, homeLink.caseMarker));
  fs.rmSync(homeLink.caseRoot, { recursive: true, force: true });

  const cursorLoop = projectHome();
  const cursorLoopFile = path.join(cursorLoop.caseHome, 'Projects', 'app', '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorLoopFile), { recursive: true });
  fs.symlinkSync('mcp.json', cursorLoopFile);
  const cursorLoopRun = hidden(['guard', '--policy', cursorLoop.denyFile, '--', ...wrapped], cursorLoop.caseHome, cursorLoop.caseCwd, cursorLoop.caseMarker);
  ok('a project .cursor/mcp.json symlink loop exits 4 and does not run the command', refused(cursorLoopRun, cursorLoop.caseMarker));
  fs.rmSync(cursorLoop.caseRoot, { recursive: true, force: true });

  const mcpLoop = projectHome();
  const mcpLoopFile = path.join(mcpLoop.caseHome, 'Projects', 'app', '.mcp.json');
  fs.mkdirSync(path.dirname(mcpLoopFile), { recursive: true });
  fs.symlinkSync('.mcp.json', mcpLoopFile);
  const mcpLoopRun = hidden(['guard', '--policy', mcpLoop.denyFile, '--', ...wrapped], mcpLoop.caseHome, mcpLoop.caseCwd, mcpLoop.caseMarker);
  ok('a project .mcp.json symlink loop exits 4 and does not run the command', refused(mcpLoopRun, mcpLoop.caseMarker));
  fs.rmSync(mcpLoop.caseRoot, { recursive: true, force: true });

  const cursorHuge = projectHome();
  const cursorHugeFile = path.join(cursorHuge.caseHome, 'Projects', 'app', '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorHugeFile), { recursive: true });
  fs.writeFileSync(cursorHugeFile, filesystemConfig(cursorHuge.caseHome) + ' '.repeat(2_000_001));
  const cursorHugeRun = hidden(['guard', '--policy', cursorHuge.denyFile, '--', ...wrapped], cursorHuge.caseHome, cursorHuge.caseCwd, cursorHuge.caseMarker);
  ok('an oversize project .cursor/mcp.json exits 4 and does not run the command', refused(cursorHugeRun, cursorHuge.caseMarker));
  fs.rmSync(cursorHuge.caseRoot, { recursive: true, force: true });

  const mcpHuge = projectHome();
  const mcpHugeFile = path.join(mcpHuge.caseHome, 'Projects', 'app', '.mcp.json');
  fs.mkdirSync(path.dirname(mcpHugeFile), { recursive: true });
  fs.writeFileSync(mcpHugeFile, filesystemConfig(mcpHuge.caseHome) + ' '.repeat(2_000_001));
  const mcpHugeRun = hidden(['guard', '--policy', mcpHuge.denyFile, '--', ...wrapped], mcpHuge.caseHome, mcpHuge.caseCwd, mcpHuge.caseMarker);
  ok('an oversize project .mcp.json exits 4 and does not run the command', refused(mcpHugeRun, mcpHuge.caseMarker));
  fs.rmSync(mcpHuge.caseRoot, { recursive: true, force: true });

  const cursorLocked = projectHome();
  const cursorLockedFile = path.join(cursorLocked.caseHome, 'Projects', 'app', '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorLockedFile), { recursive: true });
  fs.writeFileSync(cursorLockedFile, filesystemConfig(cursorLocked.caseHome));
  fs.chmodSync(cursorLockedFile, 0o000);
  let cursorLockedBlocked = false;
  try { fs.readFileSync(cursorLockedFile); } catch (error) { cursorLockedBlocked = error.code === 'EACCES' || error.code === 'EPERM'; }
  const cursorLockedRun = hidden(['guard', '--policy', cursorLocked.denyFile, '--', ...wrapped], cursorLocked.caseHome, cursorLocked.caseCwd, cursorLocked.caseMarker);
  ok('an unreadable project .cursor/mcp.json exits 4 and does not run the command', !cursorLockedBlocked || refused(cursorLockedRun, cursorLocked.caseMarker));
  fs.chmodSync(cursorLockedFile, 0o644);
  fs.rmSync(cursorLocked.caseRoot, { recursive: true, force: true });

  const linkedDir = projectHome();
  const outside = path.join(linkedDir.caseHome, 'outside');
  fs.mkdirSync(path.join(outside, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(outside, '.cursor', 'mcp.json'), filesystemConfig(linkedDir.caseHome));
  fs.mkdirSync(path.join(linkedDir.caseHome, 'Projects'), { recursive: true });
  fs.symlinkSync(outside, path.join(linkedDir.caseHome, 'Projects', 'link'));
  const linkedDirRun = hidden(['guard', '--policy', linkedDir.denyFile, '--', ...wrapped], linkedDir.caseHome, linkedDir.caseCwd, linkedDir.caseMarker);
  ok('a symlinked project directory exits 4 and does not run the command', refused(linkedDirRun, linkedDir.caseMarker));
  fs.rmSync(linkedDir.caseRoot, { recursive: true, force: true });

  section('a large shell startup file is a warning, not an incomplete scan');
  const shellHome = freshHome();
  fs.writeFileSync(path.join(shellHome.caseHome, '.zshrc'), '# ' + 'x'.repeat(1_000_001));
  const shellScanPath = path.join(shellHome.caseRoot, 'scan.json');
  const shellScan = runCli(['scan', '--quiet', '--json', shellScanPath, '--policy', shellHome.denyFile], shellHome.caseHome, shellHome.caseCwd);
  const shellExport = JSON.parse(fs.readFileSync(shellScanPath, 'utf8'));
  const shellGuard = hidden(['guard', '--policy', shellHome.denyFile, '--', ...command], shellHome.caseHome, shellHome.caseCwd, shellHome.caseMarker);
  ok('a .zshrc over 1MB does not fail the scan and warns', shellScan.status === 0 && (shellExport.configFindings || []).some(item => item.ruleId === 'BOPPI-SHELL-RC-SIZE' && /zshrc/.test(item.title || item.file || '')));
  ok('guard still runs the command when the only gap is a large shell startup file', shellGuard.status === 7 && fs.readFileSync(shellHome.caseMarker, 'utf8') === 'ran');
  fs.rmSync(shellHome.caseRoot, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
