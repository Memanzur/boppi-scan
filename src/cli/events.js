/**
 * boppi events: the local timeline of recorded hook events. Pairs each
 * PreToolUse with its outcome event through the hashed invocation id inside
 * the same hashed session, and makes every gap visible: an invocation with
 * no outcome is "unknown", an outcome with no invocation is an orphan, a
 * payload delivered twice is a duplicate, an unparseable line is a torn
 * write, and refused payloads are health counters. Nothing here asserts
 * what a tool did to files or the network; it records that a supported
 * client reported the call.
 */
'use strict';
const fs = require('fs');
const hook = require('./hook');

const OUTCOMES = Object.freeze(['ok', 'error', 'failed', 'interrupted', 'denied', 'unknown']);
const FINAL = new Set(['ok', 'error', 'failed', 'interrupted', 'denied']);

/** Every record on disk within the window, oldest first, with torn-line and duplicate counts. */
function readEvents(home, { sinceDays = 30, now = Date.now() } = {}) {
  const cutoff = now - sinceDays * 86400000;
  const records = [];
  const seen = new Set();
  let torn = 0, duplicates = 0, expired = 0, uncorrelated = 0;
  for (const file of hook.storedFiles(home)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { torn++; continue; }
      if (!record || typeof record !== 'object' || typeof record.at !== 'string' || typeof record.event !== 'string') { torn++; continue; }
      if (Date.parse(record.at) < cutoff) { expired++; continue; }
      if (record.id && seen.has(record.id)) { duplicates++; continue; }
      if (record.id) seen.add(record.id);
      if (!record.invocation) uncorrelated++;
      records.push(record);
    }
  }
  records.sort((a, b) => a.at.localeCompare(b.at));
  const health = {};
  try {
    for (const line of fs.readFileSync(hook.healthFile(home), 'utf8').split('\n')) {
      if (!line) continue;
      try { const entry = JSON.parse(line); if (Date.parse(entry.at) >= cutoff && hook.HEALTH_REASONS.includes(entry.reason)) health[entry.reason] = (health[entry.reason] || 0) + 1; } catch { torn++; }
    }
  } catch { /* no health file */ }
  return { records, torn, duplicates, expired, uncorrelated, health };
}

/** Pair invocations with outcomes. An invocation is one tool call seen by the client. */
function timeline(records) {
  const byKey = new Map();
  const orphans = [];
  for (const record of records) {
    if (!record.invocation || !record.session) {
      if (record.outcome === 'invoked') byKey.set(`loose:${record.id}`, { ...calling(record), outcome: 'unknown', unpaired: true });
      else orphans.push(record);
      continue;
    }
    const key = `${record.session}:${record.invocation}`;
    const call = byKey.get(key) || { ...calling(record), outcome: 'unknown', invokedAt: null, outcomeAt: null };
    if (record.outcome === 'invoked') { call.invokedAt = call.invokedAt || record.at; }
    else if (FINAL.has(record.outcome)) { call.outcome = record.outcome; call.outcomeAt = record.at; call.durationMs = record.durationMs ?? call.durationMs; }
    byKey.set(key, call);
  }
  const calls = [...byKey.values()];
  for (const call of calls) if (!call.invokedAt && call.outcomeAt) orphans.push(call);
  return { calls: calls.filter(c => c.invokedAt || !c.outcomeAt), orphans };
}
function calling(record) { return { at: record.at, event: record.event, kind: record.kind, server: record.server, source: record.source || null, tool: record.tool, session: record.session, invocation: record.invocation, cwd: record.cwd, durationMs: record.durationMs ?? null }; }

/** Per server and tool: how many calls ended each way. */
function summarize(calls) {
  const rows = new Map();
  for (const call of calls) {
    const key = `${call.kind}:${call.server || ''}:${call.tool}`;
    const row = rows.get(key) || { kind: call.kind, server: call.server, source: call.source, tool: call.tool, calls: 0, first: call.at, last: call.at, ...Object.fromEntries(OUTCOMES.map(o => [o, 0])) };
    row.calls++;
    row[call.outcome] = (row[call.outcome] || 0) + 1;
    if (call.at < row.first) row.first = call.at;
    if (call.at > row.last) row.last = call.at;
    if (!row.source && call.source) row.source = call.source;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.calls - a.calls || String(a.server).localeCompare(String(b.server)) || a.tool.localeCompare(b.tool));
}

function render(result, { sinceDays }) {
  const { records, torn, duplicates, uncorrelated, health } = result;
  const { calls, orphans } = timeline(records);
  const rows = summarize(calls);
  const lines = [`BOPPI · EVENTS  last ${sinceDays} day${sinceDays === 1 ? '' : 's'} · ${calls.length} tool call${calls.length === 1 ? '' : 's'} reported by Claude Code hooks · ${records.length} records`];
  if (!records.length) {
    lines.push('  no events recorded. Capture starts only after you add the snippet from `boppi hook --print-config` to your Claude Code settings.');
  } else {
    lines.push(`  ${'server / tool'.padEnd(44)} ${'calls'.padStart(5)} ${OUTCOMES.map(o => o.padStart(11)).join('')}`);
    for (const row of rows) {
      const name = `${row.kind === 'mcp' ? `${row.server}${row.source ? ` (${row.source})` : ''} / ` : ''}${row.tool}`.slice(0, 44);
      lines.push(`  ${name.padEnd(44)} ${String(row.calls).padStart(5)} ${OUTCOMES.map(o => String(row[o] || 0).padStart(11)).join('')}`);
    }
  }
  const gaps = [];
  const unknown = calls.filter(c => c.outcome === 'unknown').length;
  if (unknown) gaps.push(`${unknown} invocation${unknown === 1 ? '' : 's'} with no outcome event (unknown, not success)`);
  if (orphans.length) gaps.push(`${orphans.length} outcome event${orphans.length === 1 ? '' : 's'} with no invocation (dropped or reordered PreToolUse)`);
  if (uncorrelated) gaps.push(`${uncorrelated} record${uncorrelated === 1 ? '' : 's'} without an invocation id (unsupported client version; cannot be paired)`);
  if (duplicates) gaps.push(`${duplicates} duplicate deliver${duplicates === 1 ? 'y' : 'ies'} ignored`);
  if (torn) gaps.push(`${torn} unreadable line${torn === 1 ? '' : 's'} (a hook was interrupted mid-write)`);
  for (const [reason, count] of Object.entries(health)) gaps.push(`${count} payload${count === 1 ? '' : 's'} refused: ${reason.replace('_', ' ')}`);
  lines.push(gaps.length ? `  gaps: ${gaps.join('; ')}` : '  gaps: none');
  lines.push('  only Claude Code is monitored, and only the MCP tool calls its hooks report; other clients are not monitored. A reported call is not evidence of what the tool did to files or the network.');
  return lines.join('\n');
}

function runEvents(options) {
  const sinceDays = options.since || 30;
  const result = readEvents(options.home, { sinceDays });
  if (options.json) {
    const { calls, orphans } = timeline(result.records);
    fs.writeFileSync(options.json, JSON.stringify({ schemaVersion: 1, sinceDays, calls, orphans, summary: summarize(calls), records: result.records.length, torn: result.torn, duplicates: result.duplicates, uncorrelated: result.uncorrelated, health: result.health, monitored: ['claude-code'] }, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(`wrote ${options.json}\n`);
  } else {
    process.stdout.write(render(result, { sinceDays }) + '\n');
  }
  return 0;
}

module.exports = { OUTCOMES, readEvents, timeline, summarize, render, runEvents };
