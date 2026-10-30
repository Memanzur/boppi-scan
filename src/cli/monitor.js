/**
 * boppi monitor: continuous monitoring that survives a closed terminal, sleep
 * and restarts. `enable` installs one per-user macOS LaunchAgent that runs
 * `boppi monitor run` (boppi watch --push with a token read from an owner-only
 * file) at login and again if it exits with an error. It asks first and lists
 * every file it writes. `disable` unloads it and removes the agent and the
 * token. `status` reports installed, running and the last check-in.
 *
 * Nothing runs as root, nothing is installed outside the user's home, and the
 * token never appears in the agent definition, its arguments or a log.
 * Windows and Linux are not supported yet: they keep `boppi watch --push`.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { openNoFollow } = require('./platform');
const watchPush = require('./watchPush');

const SUBCOMMANDS = Object.freeze(['enable', 'disable', 'status', 'run']);
const LABEL = 'io.boppi.monitor';
const REVOKED_EXIT = 6;

const agentFile = home => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const monitorDir = home => path.join(home, '.boppi', 'monitor');
const tokenFile = home => path.join(monitorDir(home), 'token');
const stateFile = home => path.join(monitorDir(home), 'state.json');
const logFile = home => path.join(monitorDir(home), 'watch.log');
const outputFile = home => path.join(monitorDir(home), 'service.log');

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** What launchd starts: the running Node and script, or the standalone executable on its own. */
function programArguments({ execPath, script, home, ingestUrl }) {
  return [execPath, ...(script ? [script] : []), 'monitor', 'run', '--url', ingestUrl.toString(), '--home', home];
}

/**
 * The agent definition. RunAtLoad starts it at login; KeepAlive restarts it only after a failed exit, at most once
 * a minute, so a refused token (which `monitor run` turns into a clean exit) does not loop.
 */
function agentPlist({ args, home }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map(a => `    <string>${xml(a)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>',
    '  <key>ThrottleInterval</key><integer>60</integer>',
    '  <key>ProcessType</key><string>Background</string>',
    '  <key>LowPriorityIO</key><true/>',
    '  <key>Nice</key><integer>10</integer>',
    `  <key>StandardOutPath</key><string>${xml(outputFile(home))}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(outputFile(home))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function writeOwnerOnly(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, file);
}

/** The stored token, refused when anyone but the owner can read it, as ssh refuses a loose key. */
function readToken(home) {
  const file = tokenFile(home);
  let fd;
  try { fd = openNoFollow(file, fs.constants.O_RDONLY); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`no token at ${file}; run boppi monitor enable`);
    throw new Error(`cannot read ${file}: ${error.code === 'ELOOP' ? 'it is a symbolic link' : error.message}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error(`refusing ${file}: other accounts on this machine can read it (mode ${(stat.mode & 0o777).toString(8)}). Run boppi monitor enable again to replace it.`);
    const token = fs.readFileSync(fd, 'utf8').trim();
    if (!token) throw new Error(`${file} is empty; run boppi monitor enable`);
    return token;
  } finally { fs.closeSync(fd); }
}

function readState(home) {
  try { return JSON.parse(fs.readFileSync(stateFile(home), 'utf8')); } catch { return {}; }
}

function lastCheckIn(home) {
  let text;
  try { text = fs.readFileSync(logFile(home), 'utf8'); } catch { return null; }
  const lines = text.trim().split('\n').reverse();
  for (const line of lines) {
    try { const entry = JSON.parse(line); if (entry.kind === 'heartbeat') return entry; } catch { /* a torn last line */ }
  }
  return null;
}

/**
 * launchctl, or the stand-in a test names in BOPPI_LAUNCHCTL. The real one is only used for this account's own
 * home, so a run with --home pointing elsewhere can write files there but never loads a service.
 */
function launchctl(args, home) {
  if (!process.env.BOPPI_LAUNCHCTL && path.resolve(home) !== path.resolve(os.homedir())) return { code: 125, stdout: '', stderr: '--home is not this account\'s home, so launchd was not asked to load it' };
  const binary = process.env.BOPPI_LAUNCHCTL || '/bin/launchctl';
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  return { code: result.status === null ? 1 : result.status, stdout: result.stdout || '', stderr: result.stderr || (result.error ? result.error.message : '') };
}

const domain = () => `gui/${process.getuid()}`;

/** Where this copy of Boppi runs from, or why a background service cannot point at it. */
function installedProgram(deps) {
  const execPath = deps.execPath || process.execPath;
  const script = deps.script === undefined ? require.main && require.main.filename : deps.script;
  if (script && /[\\/]_npx[\\/]/.test(script)) {
    return { problem: 'this copy of Boppi runs from the npx cache, which npm can delete at any time, and the service would stop working. Install it first with npm install -g boppi (or the standalone installer), then run boppi monitor enable from that copy.' };
  }
  return { execPath, script: script || null };
}

function supported(options, err) {
  if (options.platform === 'darwin') return true;
  err(`monitor: the background service supports macOS for now. On this machine run boppi watch --push in a terminal for continuous monitoring.`);
  return false;
}

async function enable(options, deps) {
  const { out, err } = deps;
  if (!supported(options, err)) return 2;
  const program = installedProgram(deps);
  if (program.problem) { err(`monitor enable: ${program.problem}`); return 2; }
  if (!options.token) {
    options.token = await deps.promptForToken();
    if (!options.token) { err('monitor enable: no token entered'); return 2; }
  }
  const args = programArguments({ ...program, home: options.home, ingestUrl: options.ingestUrl });
  const workspace = options.ingestUrl.origin;
  out([
    'BOPPI · MONITOR  turn on continuous monitoring',
    '',
    'This installs a background service for your user account only (no administrator rights). It starts when you log in,',
    'restarts if it stops with an error, and does what boppi watch --push does in a terminal:',
    `  - rescans your AI client configuration when a file changes and every minute`,
    `  - sends the sanitized inventory to ${workspace} only when it changed. ${watchPush.PRIVACY_LINE}`,
    `  - checks in every ${watchPush.HEARTBEAT_SECONDS / 60} minutes, so the workspace can show "monitoring on", or "stopped" when this machine is off or asleep`,
    '',
    'It writes:',
    `  ${agentFile(options.home)}  the service definition (no token inside)`,
    `  ${tokenFile(options.home)}  the collector token, readable only by you`,
    `  ${monitorDir(options.home)}  its logs`,
    '',
    'It never changes a configuration file and never applies a fix. boppi monitor disable removes it.',
  ].join('\n'));
  if (!options.yes) {
    const answer = await deps.confirm('Install and start it now? [y/N] ');
    if (!answer) { out('Nothing was installed.'); return 1; }
  }
  writeOwnerOnly(tokenFile(options.home), `${options.token}\n`);
  writeOwnerOnly(agentFile(options.home), agentPlist({ args, home: options.home }), 0o644);
  try { fs.rmSync(stateFile(options.home), { force: true }); } catch { /* none */ }
  launchctl(['bootout', `${domain()}/${LABEL}`], options.home);
  const loaded = launchctl(['bootstrap', domain(), agentFile(options.home)], options.home);
  if (loaded.code !== 0) {
    err(`monitor enable: the service is written but macOS did not start it (launchctl exit ${loaded.code}${loaded.stderr.trim() ? `: ${loaded.stderr.trim()}` : ''}). It will start at your next login; boppi monitor disable removes it.`);
    return 4;
  }
  out(`Monitoring is on. boppi monitor status shows it; boppi monitor disable turns it off.`);
  return 0;
}

/** Unload the service and delete its definition, token and state; returns the files removed. */
function disableService(home) {
  launchctl(['bootout', `${domain()}/${LABEL}`], home);
  const removed = [];
  for (const file of [agentFile(home), tokenFile(home), stateFile(home)]) {
    if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); removed.push(file); }
  }
  return removed;
}

function disable(options, deps) {
  const { out } = deps;
  const removed = disableService(options.home);
  if (!removed.length) { out('Monitoring was not installed. Nothing to remove.'); return 0; }
  out(`Monitoring is off. Removed ${removed.join(', ')}. Logs stay in ${monitorDir(options.home)}; boppi uninstall removes them.`);
  out('The workspace shows this machine as stopped after its next missed check-in. A token you no longer need can be revoked on the Collectors page.');
  return 0;
}

function status(options, deps) {
  const { out } = deps;
  const installed = fs.existsSync(agentFile(options.home));
  if (!installed) { out('Monitoring: off (no background service installed). Turn it on with boppi monitor enable.'); return 0; }
  const printed = launchctl(['print', `${domain()}/${LABEL}`], options.home);
  const running = printed.code === 0 && /\bstate = running\b/.test(printed.stdout);
  const state = readState(options.home);
  const beat = lastCheckIn(options.home);
  const lines = [`Monitoring: ${state.revokedAt ? 'stopped, the workspace refused the token' : running ? 'on, running' : printed.code === 0 ? 'installed, not running right now' : 'installed, not loaded (starts at next login)'}`];
  lines.push(`  service: ${agentFile(options.home)}`);
  lines.push(`  last check-in: ${beat ? `${beat.at} (${beat.ok ? 'accepted' : `failed${beat.status ? `, HTTP ${beat.status}` : ''}`})` : 'none yet'}`);
  if (state.revokedAt) lines.push(`  The token was refused at ${state.revokedAt}. Create a new one on the Collectors page and run boppi monitor enable, or boppi monitor disable.`);
  out(lines.join('\n'));
  return 0;
}

/** The service entry point: watch --push with the stored token. A refused token exits cleanly so launchd stops. */
async function run(options, deps) {
  let token;
  try { token = readToken(options.home); } catch (error) { deps.err(`monitor run: ${error.message}`); return 2; }
  const code = await deps.runWatch({ ...options, command: 'watch', push: true, token, log: logFile(options.home), interval: 60, duration: 0, once: false });
  if (code === REVOKED_EXIT) {
    writeOwnerOnly(stateFile(options.home), JSON.stringify({ revokedAt: new Date().toISOString() }) + '\n');
    return 0;
  }
  return code;
}

async function runMonitor(options, deps) {
  if (options.subcommand === 'enable') return enable(options, deps);
  if (options.subcommand === 'disable') return disable(options, deps);
  if (options.subcommand === 'status') return status(options, deps);
  return run(options, deps);
}

module.exports = { SUBCOMMANDS, LABEL, launchctl, disableService, agentFile, monitorDir, tokenFile, stateFile, logFile, programArguments, agentPlist, readToken, installedProgram, runMonitor };
