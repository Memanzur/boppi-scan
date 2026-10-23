#!/usr/bin/env node
/** One synthetic Claude Code session for test/verify-hook-collector.js: 50 invocations with a planned mix of outcomes, reorders, drops, and duplicate deliveries, appended through the real hook module. Arguments: home, session name. */
'use strict';
const hook = require('../../src/cli/hook');
const [home, session] = process.argv.slice(2);
const fingerprint = value => `fp-${value.length}`;
const canaries = { tool_input: { path: '/Users/private/CANARY_INPUT.txt', token: 'ghp_CANARY_TOKEN_000' }, transcript_path: '/Users/private/.claude/CANARY_TRANSCRIPT.jsonl', cwd: '/Users/private/CANARY_CWD' };
const outcomes = ['ok', 'ok', 'error', 'failed', 'interrupted', 'denied', 'ok', 'ok'];
let now = Date.parse('2026-10-23T10:00:00.000Z') + Number(session.replace(/\D/g, '')) * 1000;
const stamp = () => new Date(now++).toISOString();
const pre = i => ({ hook_event_name: 'PreToolUse', tool_name: `mcp__srv${i % 3}__tool${i % 5}`, session_id: `session-${session}`, tool_use_id: `toolu_${session}_${i}`, mcp_server: { name: `srv${i % 3}`, source: 'user' }, ...canaries });
const post = (i, outcome) => {
  const base = { ...pre(i) };
  if (outcome === 'ok') return { ...base, hook_event_name: 'PostToolUse', tool_response: { content: 'CANARY_RESPONSE' }, duration_ms: 12 };
  if (outcome === 'error') return { ...base, hook_event_name: 'PostToolUse', tool_response: { is_error: true, error: 'CANARY_ERROR_TEXT' } };
  if (outcome === 'failed') return { ...base, hook_event_name: 'PostToolUseFailure', error: 'CANARY_FAILURE_TEXT' };
  if (outcome === 'interrupted') return { ...base, hook_event_name: 'PostToolUseFailure', error: 'x', is_interrupt: true };
  return { ...base, hook_event_name: 'PermissionDenied', reason: '[CANARY_REASON]' };
};
const write = payload => hook.append(home, hook.toRecord(payload, { now: stamp(), fingerprint }), 30);
for (let i = 0; i < 50; i++) {
  const outcome = outcomes[i % outcomes.length];
  const dropped = i % 25 === 0;
  const reordered = i % 7 === 3;
  if (reordered && !dropped) write(post(i, outcome));
  write(pre(i));
  if (i % 40 === 0) write(pre(i));
  if (!dropped && !reordered) write(post(i, outcome));
}
