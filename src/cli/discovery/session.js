/**
 * One consented stdio MCP discovery session: launch the configured program,
 * initialize, list tools, shut down. Boppi sends initialize,
 * notifications/initialized, tools/list, and notifications/cancelled, and
 * nothing else; the recorder is the proof. See docs/phase3/DISCOVERY_SPIKE.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const projection = require('./projection');
const { createRecorder } = require('./recorder');

const TIMEOUTS = Object.freeze({ initializeMs: 10000, pageMs: 10000, sessionMs: 60000, closeMs: 2000, termMs: 2000, killMs: 1000 });
const PACKAGE_LAUNCHERS = /^(npx|uvx|pipx|bunx|docker|podman)(\.exe|\.cmd|\.bat)?$/i;
/** Launchers that fetch when given a subcommand: `npm exec`, `npm x`, `bun x`, `pnpm dlx`, `yarn dlx`, `uv tool run`, `uv tool uvx`, `pipx run`, `deno run npm:…`. */
function fetchingSubcommand(command, args) {
  const base = path.basename(command).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  const list = Array.isArray(args) ? args.filter(a => typeof a === 'string') : [];
  const first = (list[0] || '').toLowerCase(), second = (list[1] || '').toLowerCase();
  if (base === 'npm' && (first === 'exec' || first === 'x')) return `${base} ${first}`;
  if (base === 'bun' && first === 'x') return 'bun x';
  if ((base === 'pnpm' || base === 'yarn') && first === 'dlx') return `${base} dlx`;
  if (base === 'uv' && first === 'tool' && (second === 'run' || second === 'uvx')) return `uv tool ${second}`;
  if (base === 'uv' && first === 'run' && list.slice(1).some(a => /^--with(=|$)/.test(a))) return 'uv run --with';
  if (base === 'pipx' && first === 'run') return 'pipx run';
  if (base === 'deno' && first === 'run' && list.slice(1).some(a => /^(npm:|jsr:|https?:\/\/)/i.test(a))) return 'deno run <remote module>';
  return null;
}
/**
 * The variables a discovered server inherits from Boppi's environment, by
 * platform: enough to find its runtime and its own config and temp folders,
 * never a token. Windows programs need their system and profile folders,
 * PATHEXT and COMSPEC; Linux programs read the XDG folders. Display and
 * session-bus variables are left out: a server being listed has no need to
 * open windows or reach the keyring.
 */
const BASE_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'];
const INHERITED_ENV = Object.freeze({
  darwin: Object.freeze(BASE_ENV),
  linux: Object.freeze([...BASE_ENV, 'USER', 'LOGNAME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']),
  win32: Object.freeze([...BASE_ENV, 'SystemRoot', 'SystemDrive', 'windir', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'PATHEXT', 'COMSPEC', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']),
});
const inheritedNames = platform => INHERITED_ENV[platform] || INHERITED_ENV.linux;
const PROTOCOL_VERSION = '2025-11-25';

const WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** A file in `dir` named `name` regardless of case, as Windows matches it; null when absent. */
function caseInsensitive(dir, name) {
  try { return fs.readdirSync(dir).find(entry => entry.toLowerCase() === name.toLowerCase()) || null; } catch { return null; }
}

/**
 * The installed program a config entry names, or null. On win32 a bare name
 * is tried with each PATHEXT extension, PATH splits on ';', names match
 * without regard to case, and there is no execute bit to check.
 */
function resolveProgram(command, cwd, { platform = process.platform, env = process.env } = {}) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const windows = platform === 'win32';
  const explicit = path.isAbsolute(command) || command.includes('/') || command.includes('\\') || command.startsWith('.');
  const dirs = explicit ? [path.dirname(path.resolve(cwd, command))] : (env.PATH || env.Path || '').split(windows ? ';' : path.delimiter).filter(Boolean);
  const base = explicit ? path.basename(command) : command;
  const names = windows && !path.extname(base) ? (env.PATHEXT || WINDOWS_PATHEXT).split(';').filter(Boolean).map(ext => base + ext) : [base];
  for (const dir of dirs) {
    for (const name of names) {
      const found = windows ? caseInsensitive(dir, name) : name;
      if (!found) continue;
      const candidate = path.join(dir, found);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (!windows) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* next */ }
    }
  }
  return null;
}

/**
 * Decide whether an entry may be launched and with what. Refuses remote
 * endpoints (not in this slice), package-fetching launchers, and programs
 * that are not already installed. Never consults the network.
 */
function launchPlan(entry, { cwd, platform = process.platform, env: environment = process.env }) {
  if (!entry || typeof entry !== 'object') return { refused: 'the configuration entry is not an object' };
  if (!entry.command && (entry.url || entry.endpoint)) return { refused: 'a remote endpoint (Streamable HTTP) is not supported by discovery in this release; only stdio servers are' };
  if (typeof entry.command !== 'string' || !entry.command.trim()) return { refused: 'the entry has no command to launch' };
  if (PACKAGE_LAUNCHERS.test(path.basename(entry.command))) return { refused: `"${path.basename(entry.command)}" fetches a package at start; Boppi never installs or fetches on your behalf. Install the server as a local program (or pin and pre-install it) and point the entry at it.` };
  const fetching = fetchingSubcommand(entry.command, entry.args);
  if (fetching) return { refused: `"${fetching}" fetches a package at start; Boppi never installs or fetches on your behalf. Install the server as a local program (or pin and pre-install it) and point the entry at it.` };
  const program = resolveProgram(entry.command, cwd, { platform, env: environment });
  if (!program) return { refused: `the program "${entry.command}" is not installed where Boppi can find it (not an executable file on PATH or at that path)` };
  // A .cmd or .bat file runs only through cmd.exe, and Boppi never starts a server through a shell.
  if (/\.(cmd|bat)$/i.test(program)) return { refused: `"${path.basename(program)}" is a .cmd or .bat launcher, which needs a shell to run; Boppi never starts servers through a shell. Point the entry at the program itself (for example node.exe and the script it runs) and rescan.` };
  const args = Array.isArray(entry.args) ? entry.args.filter(a => typeof a === 'string') : [];
  const env = {};
  for (const key of inheritedNames(platform)) if (process.env[key] !== undefined) env[key] = process.env[key];
  const inherited = Object.keys(env);
  const envNames = [];
  if (entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)) {
    for (const [key, value] of Object.entries(entry.env)) if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { env[key] = value; envNames.push(key); }
  }
  delete env.BOPPI_TOKEN;
  return { program, command: entry.command, args, cwd, env, envNames: envNames.sort(), inherited };
}

function processExited(child) { return child.exitCode !== null || child.signalCode !== null; }

/**
 * Whether a process group on Linux still has a member that is not a zombie.
 * An exited process stays in the table (state Z) until its parent reaps it,
 * and in a container whose PID 1 never reaps, kill(-pgid, 0) keeps
 * succeeding for a group that has finished. Unreadable /proc counts as running.
 */
function linuxGroupRunning(pgid, procRoot = '/proc') {
  let names;
  try { names = fs.readdirSync(procRoot); } catch { return true; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let stat;
    try { stat = fs.readFileSync(path.join(procRoot, name, 'stat'), 'utf8'); } catch { continue; }
    // pid (comm) state ppid pgrp ...; comm may hold spaces and parentheses, so read after the last ')'.
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (Number(pgrp) === pgid && state !== 'Z') return true;
  }
  return false;
}

/** End a Windows process and every process it started, while it is still alive to name them. True when taskkill succeeded. */
function killTreeWindows(pid) {
  const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  return spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false }).status === 0;
}

const HOST = Object.freeze({ platform: process.platform, killTree: killTreeWindows, groupRunning: linuxGroupRunning });

/**
 * Signal the whole process group (the server and anything it started),
 * falling back to the child alone. Windows has no process groups and no
 * graceful signal, so both rungs end the tree with taskkill /T /F.
 * Returns whether the whole tree was reached.
 */
function signal(child, name, host = HOST) {
  if (host.platform === 'win32') {
    if (child.pid && !processExited(child) && host.killTree(child.pid)) return true;
  } else if (child.pid) { try { process.kill(-child.pid, name); return true; } catch { /* group gone or not a leader */ } }
  try { child.kill(name); } catch { /* gone */ }
  return false;
}

/** True while any process in the child's group is running (the group outlives a leader that exited and left children). Never true on Windows, which cannot tell. */
function groupAlive(child, host = HOST) {
  if (host.platform === 'win32' || !child.pid) return false;
  try { process.kill(-child.pid, 0); } catch { return false; }
  return host.platform !== 'linux' || host.groupRunning(child.pid);
}

/**
 * Close stdin, then SIGTERM, then SIGKILL, each after its wait. When the
 * server exits but left processes behind in its group, they get the same
 * ladder. Resolves with how the process ended and whether anything it
 * started was still running. On Windows a server that exits on its own
 * leaves no way to find what it started, so childrenUnchecked says so.
 */
function shutdown(child, timeouts, host = HOST) {
  return new Promise(resolve => {
    let forced = null, treeEnded = false;
    const force = name => { forced = name; treeEnded = signal(child, name, host) || treeEnded; };
    const unchecked = () => (host.platform === 'win32' && !treeEnded ? { childrenUnchecked: true } : {});
    const finish = () => {
      if (!groupAlive(child, host)) return resolve({ exitCode: child.exitCode, signal: child.signalCode, forced, mayStillBeRunning: !processExited(child), leftoverSignalled: false, ...unchecked() });
      signal(child, 'SIGTERM', host);
      setTimeout(() => {
        if (groupAlive(child, host)) signal(child, 'SIGKILL', host);
        setTimeout(() => resolve({ exitCode: child.exitCode, signal: child.signalCode, forced, mayStillBeRunning: !processExited(child), leftoverSignalled: true, leftoverStillRunning: groupAlive(child, host) }), 200);
      }, timeouts.termMs);
    };
    if (processExited(child)) return finish();
    child.once('exit', () => setImmediate(finish));
    try { child.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => {
      if (processExited(child)) return;
      force('SIGTERM');
      setTimeout(() => {
        if (processExited(child)) return;
        force('SIGKILL');
        setTimeout(() => { if (!processExited(child)) finish(); }, timeouts.killMs);
      }, timeouts.termMs);
    }, timeouts.closeMs);
  });
}

/** Run the session for a launch plan. Never throws for server behaviour; only a spawn failure yields outcome 'failed'. */
function runSession(plan, options = {}) {
  const timeouts = { ...TIMEOUTS, ...(options.timeouts || {}) };
  const recorder = createRecorder();
  const startedAt = Date.now();
  return new Promise(resolve => {
    let child;
    try {
      // Its own process group, so shutdown can signal the server and every process it started.
      child = spawn(plan.program, plan.args, { cwd: plan.cwd, env: plan.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (error) {
      return resolve({ outcome: 'failed', reason: `could not start the program: ${error.message}`, protocolVersion: PROTOCOL_VERSION, initialize: null, list: null, listError: null, listChangedDuringSession: false, record: recorder.dump(), methods: recorder.methods(), violations: recorder.violations(), process: null, durationMs: Date.now() - startedAt });
    }
    const pending = new Map();
    const pages = [];
    let nextId = 1, buffer = '', totalBytes = 0, partial = null, stderrLines = 0, listChanged = false, ended = false, spawnError = null;
    const sessionTimer = setTimeout(() => stop('session time limit reached'), timeouts.sessionMs);

    const send = message => { recorder.sent(message); try { child.stdin.write(JSON.stringify(message) + '\n'); } catch { /* closed */ } };
    const request = (method, params, timeoutMs) => new Promise(res => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } });
        res({ timeout: true });
      }, timeoutMs);
      pending.set(id, reply => { clearTimeout(timer); res(reply); });
      send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    });
    const stop = reason => { if (!partial) partial = reason; };

    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        const bytes = Buffer.byteLength(line);
        totalBytes += bytes;
        if (bytes > projection.LIMITS.lineBytes) { recorder.receivedLine('', null); stop(`a response line exceeded ${projection.LIMITS.lineBytes} bytes`); continue; }
        if (totalBytes > projection.LIMITS.totalBytes) { recorder.receivedLine('', null); stop(`the session exceeded ${projection.LIMITS.totalBytes} bytes`); continue; }
        let parsed = null;
        try { parsed = JSON.parse(line); } catch { parsed = null; }
        recorder.receivedLine(line, parsed && typeof parsed === 'object' ? parsed : null);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        if (parsed.method === 'notifications/tools/list_changed') listChanged = true;
        if (parsed.id !== undefined && pending.has(parsed.id)) pending.get(parsed.id)(parsed);
      }
      if (Buffer.byteLength(buffer) > projection.LIMITS.lineBytes) { buffer = ''; stop(`a response line exceeded ${projection.LIMITS.lineBytes} bytes`); }
    });
    child.stderr.on('data', chunk => { stderrLines += String(chunk).split('\n').length - 1; });
    child.on('error', error => { spawnError = error; });

    (async () => {
      const init = await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'boppi', version: options.version || '0' } }, timeouts.initializeMs);
      let initialize;
      if (spawnError) initialize = { accepted: false, reason: `could not start the program: ${spawnError.message}` };
      else if (init.timeout) initialize = { accepted: false, reason: 'the server did not answer initialize in time' };
      else if (init.error) initialize = { accepted: false, reason: `initialize error ${typeof init.error.code === 'number' ? init.error.code : '?'}: ${projection.cleanText(init.error.message, 80) || 'no message'}` };
      else initialize = projection.projectInitialize(init.result);
      let listError = null;
      if (initialize.accepted) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        let cursor, passes = 0;
        for (let page = 0; page < projection.LIMITS.pages && !partial; page += 1) {
          const reply = await request('tools/list', cursor ? { cursor } : undefined, timeouts.pageMs);
          if (reply.timeout) { stop('the server did not answer tools/list in time'); break; }
          if (reply.error) { listError = { code: typeof reply.error.code === 'number' ? reply.error.code : null, message: projection.cleanText(reply.error.message, 80) }; break; }
          pages.push(reply.result);
          cursor = reply.result && typeof reply.result.nextCursor === 'string' ? reply.result.nextCursor.slice(0, 512) : null;
          if (!cursor && listChanged && passes === 0) { passes = 1; pages.length = 0; continue; }
          if (!cursor) break;
          if (page === projection.LIMITS.pages - 1) stop(`the list exceeded ${projection.LIMITS.pages} pages`);
        }
      }
      clearTimeout(sessionTimer);
      ended = true;
      const processResult = await shutdown(child, timeouts);
      const list = initialize.accepted ? projection.projectToolList(pages, { partial }) : null;
      const outcome = spawnError ? 'failed' : !initialize.accepted ? 'rejected' : listError ? 'rejected' : 'discovered';
      resolve({
        outcome,
        reason: outcome === 'failed' ? initialize.reason : outcome === 'rejected' ? (listError ? `tools/list error ${listError.code === null ? '?' : listError.code}: ${listError.message || 'no message'}` : initialize.reason) : null,
        protocolVersion: PROTOCOL_VERSION,
        initialize,
        list,
        listError,
        listChangedDuringSession: listChanged,
        record: recorder.dump(),
        methods: recorder.methods(),
        violations: recorder.violations(),
        process: { pid: child.pid || null, ...processResult, stderrLines },
        durationMs: Date.now() - startedAt,
      });
    })();
  });
}

module.exports = { TIMEOUTS, PACKAGE_LAUNCHERS, PROTOCOL_VERSION, INHERITED_ENV, resolveProgram, fetchingSubcommand, launchPlan, runSession, shutdown, linuxGroupRunning };
