/**
 * boppi hook: a metadata-only Claude Code hook adapter (Phase 6 local
 * collector). Reads one hook payload on stdin and appends one JSON line to
 * <home>/.boppi/events.jsonl with the keys in EVENT_KEYS and nothing else.
 * tool_input, tool_response contents, error text, transcript_path, prompts,
 * and file contents never reach disk. The adapter exits 0 on every input so
 * it can never block a tool, and writes nothing to stdout because Claude
 * Code interprets a hook's stdout.
 *
 * Supported payload shape: Claude Code hooks as documented on 2026-10-23
 * (PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied; each with
 * tool_use_id, and mcp_server.source for MCP tools). An event without
 * tool_use_id is recorded with invocation null and cannot be paired.
 *
 * Recording is append-only (one line under PIPE_BUF, so concurrent hooks
 * never interleave) and rotation renames the active file to a segment, so a
 * hook that already opened the file keeps writing into the segment and no
 * line is lost. Retention deletes whole segments once every record in them
 * has expired. Design: docs/phase6/RUNTIME_COLLECTOR.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 2;
const EVENT_KEYS = Object.freeze(['schema', 'id', 'at', 'event', 'kind', 'server', 'source', 'tool', 'session', 'invocation', 'cwd', 'outcome', 'durationMs']);
const OUTCOME_BY_EVENT = Object.freeze({ PreToolUse: 'invoked', PostToolUse: 'ok', PostToolUseFailure: 'failed', PermissionDenied: 'denied' });
const STDIN_TIMEOUT_MS = 2000;
const STDIN_MAX_BYTES = 1024 * 1024;
const SAFE_TOOL_NAME = /^[a-zA-Z0-9_-]{1,200}$/;
const SAFE_SOURCE = /^[a-z][a-z0-9_-]{0,23}$/;
const ERROR_FIELD = /^(is_?error|error|errors)$/i;
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;
const SEGMENT_BYTES = Number(process.env.BOPPI_HOOK_SEGMENT_BYTES) > 0 ? Number(process.env.BOPPI_HOOK_SEGMENT_BYTES) : 1024 * 1024;
const MAX_SEGMENTS = 16;
const LOCK_STALE_MS = 10000;
const LINE_CAP = 10000;
const HEALTH_REASONS = Object.freeze(['oversized', 'timeout', 'invalid_json', 'unsupported_event', 'bad_tool_name', 'write_failed', 'segment_cap', 'bad_flags']);
const HEALTH_BYTES = 256 * 1024;
const HEALTH_KEEP_LINES = 2000;
const hasEvent = name => typeof name === 'string' && Object.hasOwn(OUTCOME_BY_EVENT, name);

const dir = home => path.join(home, '.boppi');
function eventsFile(home) { return path.join(dir(home), 'events.jsonl'); }
function healthFile(home) { return path.join(dir(home), 'events.health.jsonl'); }
function disabledFile(home) { return path.join(dir(home), 'hook.disabled'); }
function segmentFiles(home) {
  try { return fs.readdirSync(dir(home)).filter(f => /^events\.\d{8}T\d{6}\d{3}Z\.\d+\.jsonl$/.test(f)).sort().map(f => path.join(dir(home), f)); } catch { return []; }
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

/** The sanitized record for one payload, or null when the payload is not a supported hook event. */
function toRecord(payload, { now, fingerprint, keyedDigest = digest }) {
  if (!payload || typeof payload !== 'object' || !hasEvent(payload.hook_event_name)) return null;
  const toolName = typeof payload.tool_name === 'string' && SAFE_TOOL_NAME.test(payload.tool_name) ? payload.tool_name : null;
  if (!toolName) return null;
  const mcp = MCP_TOOL.exec(toolName);
  const event = payload.hook_event_name;
  const session = typeof payload.session_id === 'string' && payload.session_id.length <= 200 ? keyedDigest(payload.session_id) : null;
  const invocation = typeof payload.tool_use_id === 'string' && payload.tool_use_id.length > 0 && payload.tool_use_id.length <= 200 ? keyedDigest(payload.tool_use_id) : null;
  const source = mcp && payload.mcp_server && typeof payload.mcp_server === 'object' && typeof payload.mcp_server.source === 'string' && SAFE_SOURCE.test(payload.mcp_server.source) ? payload.mcp_server.source : null;
  let outcome = OUTCOME_BY_EVENT[event];
  if (event === 'PostToolUse' && responseFailed(payload.tool_response)) outcome = 'error';
  if (event === 'PostToolUseFailure' && payload.is_interrupt === true) outcome = 'interrupted';
  const record = {
    schema: SCHEMA,
    // Deterministic for a delivered-twice payload, so the timeline can count the duplicate instead of the invocation.
    id: invocation && session ? digest(`${event}|${session}|${invocation}`) : crypto.randomBytes(8).toString('hex'),
    at: now,
    event,
    kind: mcp ? 'mcp' : 'builtin',
    server: mcp ? mcp[1] : null,
    source,
    tool: mcp ? mcp[2] : toolName,
    session,
    invocation,
    cwd: typeof payload.cwd === 'string' ? fingerprint(payload.cwd) : null,
    outcome,
    durationMs: Number.isFinite(payload.duration_ms) && payload.duration_ms >= 0 ? Math.min(Math.round(payload.duration_ms), 86400000) : null,
  };
  return record;
}

/** Only whether an error-ish field holds something, never what it says. An empty list or object is not an error. */
function responseFailed(response) {
  if (!response || typeof response !== 'object') return false;
  const present = value => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value);
  return Object.entries(response).some(([key, value]) => ERROR_FIELD.test(key) && present(value));
}

function ensureDir(home) { fs.mkdirSync(dir(home), { recursive: true, mode: 0o700 }); }

/** One line, under PIPE_BUF, O_APPEND: concurrent hooks cannot interleave or lose it. */
function append(home, record, retentionDays) {
  ensureDir(home);
  const file = eventsFile(home);
  const line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line) > 4096) throw new Error('event line too long');
  fs.appendFileSync(file, line, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* platforms without POSIX modes */ }
  rotate(home, retentionDays);
}

/** Append a health counter line ({at, reason, dropped?}); never throws. The file keeps its newest lines when it grows past HEALTH_BYTES. */
function recordHealth(home, reason, extra = {}) {
  if (!HEALTH_REASONS.includes(reason)) return;
  try {
    ensureDir(home);
    const file = healthFile(home);
    const line = JSON.stringify({ at: new Date().toISOString(), reason, ...(Number.isInteger(extra.dropped) ? { dropped: extra.dropped } : {}) }) + '\n';
    fs.appendFileSync(file, line, { mode: 0o600 });
    if (fs.statSync(file).size > HEALTH_BYTES) {
      const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-HEALTH_KEEP_LINES).join('\n') + '\n';
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, kept, { mode: 0o600 });
      fs.renameSync(temp, file);
    }
  } catch { /* best effort */ }
}

function withLock(home, fn) {
  const lock = path.join(dir(home), 'events.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx', 0o600); } } catch { /* another process holds it */ }
    if (fd === undefined) return false;
  }
  try { fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch { /* already gone */ } }
  return true;
}

function lastLineAt(file) {
  try {
    const size = fs.statSync(file).size;
    if (!size) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const length = Math.min(size, 4096);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) { try { const at = Date.parse(JSON.parse(lines[i]).at); if (!Number.isNaN(at)) return at; } catch { /* partial line */ } }
    } finally { fs.closeSync(fd); }
  } catch { /* missing */ }
  return null;
}
function firstLineAt(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const read = fs.readSync(fd, buffer, 0, 4096, 0);
      const first = buffer.toString('utf8', 0, read).split('\n')[0];
      const at = Date.parse(JSON.parse(first).at);
      return Number.isNaN(at) ? null : at;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

/**
 * Rotate the active file into a segment when it is over the size cap or its
 * oldest record has expired; delete segments whose newest record has
 * expired, and the oldest beyond MAX_SEGMENTS. Rename is atomic and a hook
 * that opened the old inode keeps appending to the segment, so nothing is
 * lost; the timeline reads segments and the active file alike.
 */
function rotate(home, retentionDays) {
  const file = eventsFile(home);
  const cutoff = Date.now() - retentionDays * 86400000;
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return; }
  const oldest = firstLineAt(file);
  const due = size > SEGMENT_BYTES || (oldest !== null && oldest < cutoff);
  if (!due) return;
  withLock(home, () => {
    try { if (fs.statSync(file).size === 0) return; } catch { return; }
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    fs.renameSync(file, path.join(dir(home), `events.${stamp}.${process.pid}.jsonl`));
    const segments = segmentFiles(home);
    for (const segment of segments) { const newest = lastLineAt(segment); if (newest !== null && newest < cutoff) { try { fs.unlinkSync(segment); } catch { /* gone */ } } }
    const remaining = segmentFiles(home);
    let dropped = 0;
    for (const segment of remaining.slice(0, Math.max(0, remaining.length - MAX_SEGMENTS))) {
      try { dropped += fs.readFileSync(segment, 'utf8').split('\n').filter(Boolean).length; } catch { /* unreadable; counted as zero */ }
      try { fs.unlinkSync(segment); } catch { /* gone */ }
    }
    if (dropped) recordHealth(home, 'segment_cap', { dropped });
  });
}

/** Every stored file, oldest first: segments then the active file. */
function storedFiles(home) { return [...segmentFiles(home), eventsFile(home)].filter(f => fs.existsSync(f)); }

/** Remove every stored event and health line. The settings snippet stays until the user removes it. */
function forget(home) {
  let removed = 0;
  for (const file of [...storedFiles(home), healthFile(home)]) { try { fs.unlinkSync(file); removed++; } catch { /* gone */ } }
  return removed;
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve({ raw: null, reason: null });
    const chunks = [];
    let size = 0;
    const finish = value => {
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
      resolve(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > STDIN_MAX_BYTES) finish({ raw: null, reason: 'oversized' });
      else chunks.push(chunk);
    };
    const onEnd = () => finish({ raw: Buffer.concat(chunks).toString('utf8'), reason: null });
    const onError = () => finish({ raw: null, reason: 'timeout' });
    const timer = setTimeout(() => finish({ raw: null, reason: 'timeout' }), STDIN_TIMEOUT_MS);
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

function claudeCodeConfig() {
  const entry = { matcher: 'mcp__.*', hooks: [{ type: 'command', command: 'boppi hook', timeout: 5 }] };
  return { hooks: { PreToolUse: [entry], PostToolUse: [entry], PostToolUseFailure: [entry], PermissionDenied: [entry] } };
}

const PRINT_CONFIG_NOTE = [
  'Paste the snippet above into your Claude Code settings (~/.claude/settings.json or a project .claude/settings.json), merging it with any hooks you already have.',
  'Boppi does not install it: nothing here edits your Claude Code settings, and `boppi hook --install` is not available in this version.',
  'What it records per MCP tool call: event name, server and tool name, the server source, a hashed session id, a hashed invocation id, a fingerprinted working directory, duration, and one of invoked, ok, error, failed, interrupted, denied. Nothing else from the payload is kept.',
  'Read it back with `boppi events`. Pause capture with `boppi hook --disable`, resume with `--enable`, delete everything recorded with `--forget` (then remove the snippet yourself).',
  'If boppi is not on PATH for Claude Code, use the full path to the binary (`which boppi`) as the command.',
].join('\n');

/** Entry point for every `boppi hook` invocation. Returns the exit code. */
async function runHook(options, { fingerprint, keyedDigest, settings }) {
  if (options.install) {
    // Exit 0 on purpose: a hook that exits 2 blocks the tool call Claude Code was about to make.
    process.stderr.write('hook --install requires your approval and is not available in this version. Run `boppi hook --print-config` and add the snippet to your Claude Code settings yourself.\n');
    return 0;
  }
  if (options.printConfig) {
    process.stdout.write(JSON.stringify(claudeCodeConfig(), null, 2) + '\n');
    process.stderr.write(PRINT_CONFIG_NOTE + '\n');
    return 0;
  }
  if (options.disable) { ensureDir(options.home); fs.writeFileSync(disabledFile(options.home), new Date().toISOString() + '\n', { mode: 0o600 }); process.stderr.write(`hook capture disabled: ${disabledFile(options.home)} exists, so the hook records nothing until \`boppi hook --enable\`. The settings snippet is unchanged.\n`); return 0; }
  if (options.enable) { try { fs.unlinkSync(disabledFile(options.home)); } catch { /* was enabled */ } process.stderr.write('hook capture enabled.\n'); return 0; }
  if (options.forget) { const removed = forget(options.home); process.stderr.write(`removed ${removed} local event file${removed === 1 ? '' : 's'}. Remove the hook snippet from your Claude Code settings yourself to stop capture for good.\n`); return 0; }
  try {
    if (fs.existsSync(disabledFile(options.home))) { await readStdin(); return 0; }
    const { raw, reason } = await readStdin();
    if (raw === null) {
      if (reason) recordHealth(options.home, reason);
      else if (process.stdin.isTTY) process.stderr.write('boppi hook reads one Claude Code hook payload on stdin. Run `boppi hook --print-config` to see how to wire it up.\n');
      return 0;
    }
    let payload;
    try { payload = JSON.parse(raw); } catch { recordHealth(options.home, 'invalid_json'); return 0; }
    const record = toRecord(payload, { now: new Date().toISOString(), fingerprint, keyedDigest });
    if (!record) { recordHealth(options.home, payload && hasEvent(payload.hook_event_name) ? 'bad_tool_name' : 'unsupported_event'); return 0; }
    try { append(options.home, record, settings.retentionDays); } catch { recordHealth(options.home, 'write_failed'); }
  } catch { /* a hook must never fail the tool call it observes */ }
  return 0;
}

module.exports = { runHook, toRecord, eventsFile, healthFile, disabledFile, segmentFiles, storedFiles, append, rotate, forget, recordHealth, claudeCodeConfig, EVENT_KEYS, OUTCOME_BY_EVENT, HEALTH_REASONS, LINE_CAP, SCHEMA, SEGMENT_BYTES, MAX_SEGMENTS, HEALTH_BYTES };
