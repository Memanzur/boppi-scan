/**
 * One consented stdio MCP discovery session: launch the configured program,
 * initialize, list tools, shut down. Boppi sends initialize,
 * notifications/initialized, tools/list, and notifications/cancelled, and
 * nothing else; the recorder is the proof. See docs/phase3/DISCOVERY_SPIKE.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const projection = require('./projection');
const { createRecorder } = require('./recorder');

const TIMEOUTS = Object.freeze({ initializeMs: 10000, pageMs: 10000, sessionMs: 60000, closeMs: 2000, termMs: 2000, killMs: 1000 });
const PACKAGE_LAUNCHERS = /^(npx|uvx|pipx|bunx|docker)(\.exe|\.cmd)?$/i;
const INHERITED_ENV = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SystemRoot', 'USERPROFILE']);
const PROTOCOL_VERSION = '2025-11-25';

function resolveProgram(command, cwd) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const candidates = [];
  if (path.isAbsolute(command) || command.includes(path.sep) || command.startsWith('.')) candidates.push(path.resolve(cwd, command));
  else for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(dir, command));
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

/**
 * Decide whether an entry may be launched and with what. Refuses remote
 * endpoints (not in this slice), package-fetching launchers, and programs
 * that are not already installed. Never consults the network.
 */
function launchPlan(entry, { cwd }) {
  if (!entry || typeof entry !== 'object') return { refused: 'the configuration entry is not an object' };
  if (!entry.command && (entry.url || entry.endpoint)) return { refused: 'a remote endpoint (Streamable HTTP) is not supported by discovery in this release; only stdio servers are' };
  if (typeof entry.command !== 'string' || !entry.command.trim()) return { refused: 'the entry has no command to launch' };
  if (PACKAGE_LAUNCHERS.test(path.basename(entry.command))) return { refused: `"${path.basename(entry.command)}" fetches a package at start; Boppi never installs or fetches on your behalf. Install the server as a local program (or pin and pre-install it) and point the entry at it.` };
  const program = resolveProgram(entry.command, cwd);
  if (!program) return { refused: `the program "${entry.command}" is not installed where Boppi can find it (not an executable file on PATH or at that path)` };
  const args = Array.isArray(entry.args) ? entry.args.filter(a => typeof a === 'string') : [];
  const env = {};
  for (const key of INHERITED_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
  const envNames = [];
  if (entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)) {
    for (const [key, value] of Object.entries(entry.env)) if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { env[key] = value; envNames.push(key); }
  }
  delete env.BOPPI_TOKEN;
  return { program, command: entry.command, args, cwd, env, envNames: envNames.sort() };
}

function processExited(child) { return child.exitCode !== null || child.signalCode !== null; }

/** Close stdin, then SIGTERM, then SIGKILL, each after its wait. Resolves with how the process ended. */
function shutdown(child, timeouts) {
  return new Promise(resolve => {
    let forced = null;
    const finish = () => resolve({ exitCode: child.exitCode, signal: child.signalCode, forced, mayStillBeRunning: !processExited(child) });
    if (processExited(child)) return finish();
    child.once('exit', () => setImmediate(finish));
    try { child.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => {
      if (processExited(child)) return;
      forced = 'SIGTERM'; try { child.kill('SIGTERM'); } catch { /* gone */ }
      setTimeout(() => {
        if (processExited(child)) return;
        forced = 'SIGKILL'; try { child.kill('SIGKILL'); } catch { /* gone */ }
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
      child = spawn(plan.program, plan.args, { cwd: plan.cwd, env: plan.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
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

module.exports = { TIMEOUTS, PACKAGE_LAUNCHERS, PROTOCOL_VERSION, resolveProgram, launchPlan, runSession, shutdown };
