/**
 * boppi hook: a metadata-only Claude Code hook adapter.
 *
 * Reads one hook payload on stdin and appends one JSON line to
 * <home>/.boppi/events.jsonl with these keys and nothing else:
 *   at, event, kind, server, tool, session, cwd, outcome
 * tool_input, tool_response contents, transcript_path, prompts, and file
 * contents never reach disk. The adapter exits 0 on every input so it can
 * never block a tool, and writes nothing to stdout because Claude Code
 * interprets a hook's stdout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EVENT_KEYS = Object.freeze(['at', 'event', 'kind', 'server', 'tool', 'session', 'cwd', 'outcome']);
const LINE_CAP = 10000;
const STDIN_TIMEOUT_MS = 2000;
const ERROR_FIELD = /^(is_?error|error|errors)$/i;
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

function eventsFile(home) { return path.join(home, '.boppi', 'events.jsonl'); }

/** The sanitized record for one payload, or null when the payload is not a hook event. */
function toRecord(payload, { now, fingerprint }) {
  if (!payload || typeof payload !== 'object' || typeof payload.hook_event_name !== 'string') return null;
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.slice(0, 200) : null;
  const mcp = toolName ? MCP_TOOL.exec(toolName) : null;
  const record = {
    at: now,
    event: payload.hook_event_name.slice(0, 60),
    kind: mcp ? 'mcp' : 'builtin',
    server: mcp ? mcp[1] : null,
    tool: mcp ? mcp[2] : toolName,
    session: typeof payload.session_id === 'string' ? crypto.createHash('sha256').update(payload.session_id).digest('hex').slice(0, 16) : null,
    cwd: typeof payload.cwd === 'string' ? fingerprint(payload.cwd) : null,
  };
  if (payload.hook_event_name === 'PostToolUse') record.outcome = responseFailed(payload.tool_response) ? 'error' : 'ok';
  return record;
}

/** Only whether an error-ish field is set, never what it says. */
function responseFailed(response) {
  if (!response || typeof response !== 'object') return false;
  return Object.entries(response).some(([key, value]) => ERROR_FIELD.test(key) && Boolean(value));
}

function append(home, record, retentionDays) {
  const file = eventsFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) { /* platforms without POSIX modes */ }
  trim(file, retentionDays);
}

/** Drop lines older than the retention window and cap the file. Rewrites only when something must go. */
function trim(file, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86400000;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter(line => {
    try { return Date.parse(JSON.parse(line).at) >= cutoff; } catch (_) { return false; }
  }).slice(-LINE_CAP);
  if (kept.length === lines.length) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve(null);
    const chunks = [];
    const timer = setTimeout(() => resolve(null), STDIN_TIMEOUT_MS);
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

function claudeCodeConfig() {
  const entry = { matcher: 'mcp__.*', hooks: [{ type: 'command', command: 'boppi hook' }] };
  return { hooks: { PreToolUse: [entry], PostToolUse: [entry] } };
}

const PRINT_CONFIG_NOTE = [
  'Paste the snippet above into your Claude Code settings (~/.claude/settings.json or a project .claude/settings.json), merging it with any hooks you already have.',
  'Boppi does not install it: nothing here edits your Claude Code settings, and `boppi hook --install` is not available in this version.',
  'What it records: event name, server and tool name, a hashed session id, a fingerprinted working directory, and ok/error for PostToolUse. Nothing else from the payload is kept.',
  'If boppi is not on PATH for Claude Code, use the full path to the binary (`which boppi`) as the command.',
].join('\n');

/** Entry point for every `boppi hook` invocation. Returns the exit code. */
async function runHook(options, { fingerprint, settings }) {
  if (options.install) {
    process.stderr.write('hook --install requires your approval and is not available in this version. Run `boppi hook --print-config` and add the snippet to your Claude Code settings yourself.\n');
    return 2;
  }
  if (options.printConfig) {
    process.stdout.write(JSON.stringify(claudeCodeConfig(), null, 2) + '\n');
    process.stderr.write(PRINT_CONFIG_NOTE + '\n');
    return 0;
  }
  try {
    const raw = await readStdin();
    if (raw === null) {
      if (process.stdin.isTTY) process.stderr.write('boppi hook reads one Claude Code hook payload on stdin. Run `boppi hook --print-config` to see how to wire it up.\n');
      return 0;
    }
    const record = toRecord(JSON.parse(raw), { now: new Date().toISOString(), fingerprint });
    if (record) append(options.home, record, settings.retentionDays);
  } catch (_) { /* a hook must never fail the tool call it observes */ }
  return 0;
}

module.exports = { runHook, toRecord, eventsFile, append, trim, claudeCodeConfig, EVENT_KEYS, LINE_CAP };
