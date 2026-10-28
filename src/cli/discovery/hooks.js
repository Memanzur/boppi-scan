/**
 * Hook configuration as counts. Cursor (`hooks.json`, cursor.com/docs/agent/hooks)
 * and Codex CLI (`hooks.json` or an inline `[hooks]` table,
 * learn.chatgpt.com/docs/hooks) both keep a `hooks` object keyed by event
 * name whose arrays hold handler objects; Codex groups handlers under a
 * matcher like Claude Code does. This module counts handlers and events and
 * records which files were read. It never runs a hook and never keeps a
 * command, matcher, prompt, URL, or any other handler field.
 *
 * `BOPPI_CURSOR_ENTERPRISE_DIR` moves the enterprise location for fixtures only.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CURSOR_ENTERPRISE_DIR = Object.freeze({ darwin: '/Library/Application Support/Cursor', linux: '/etc/cursor', win32: 'C:\\ProgramData\\Cursor' });
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

function emptyCounts() { return { handlers: 0, events: 0, byEvent: {}, malformed: false }; }

/**
 * Counts from one `hooks` block: `{ event: [handler | { matcher, hooks: [handler] }] }`.
 * A handler is any object; a group is an object whose `hooks` is an array.
 * Nothing but the shape is inspected.
 */
function countHooks(block) {
  const out = emptyCounts();
  if (block === undefined) return out;
  if (!isObject(block)) return { ...out, malformed: true };
  for (const [event, handlers] of Object.entries(block)) {
    if (!EVENT_NAME.test(event) || !Array.isArray(handlers)) { out.malformed = true; continue; }
    let count = 0;
    for (const item of handlers) {
      if (!isObject(item)) { out.malformed = true; continue; }
      if (Array.isArray(item.hooks)) { for (const handler of item.hooks) { if (isObject(handler)) count += 1; else out.malformed = true; } continue; }
      if (item.hooks !== undefined) { out.malformed = true; continue; }
      count += 1;
    }
    out.byEvent[event] = count;
    out.handlers += count;
    out.events += 1;
  }
  return out;
}

/** Add one block's counts into a running total. */
function addCounts(total, counts) {
  total.handlers += counts.handlers;
  total.malformed = total.malformed || counts.malformed;
  for (const [event, count] of Object.entries(counts.byEvent)) total.byEvent[event] = (total.byEvent[event] || 0) + count;
  total.events = Object.keys(total.byEvent).length;
  return total;
}

/** Cursor hooks.json locations, lowest precedence first. The enterprise directory is the documented one for the platform unless a fixture overrides it. */
function cursorLocations({ home, cwd, platform, enterpriseDir = null }) {
  const dir = enterpriseDir || CURSOR_ENTERPRISE_DIR[platform] || null;
  const join = enterpriseDir ? path.join : platform === 'win32' ? path.win32.join : path.posix.join;
  const out = [
    { path: path.join(home, '.cursor', 'hooks.json'), scope: 'user', kind: 'hooks' },
    { path: path.join(cwd, '.cursor', 'hooks.json'), scope: 'project', kind: 'hooks' },
  ];
  if (dir) out.push({ path: join(dir, 'hooks.json'), scope: 'enterprise', kind: 'hooks' });
  return out;
}

/**
 * Read hooks.json files and return one discovery entry per location plus the
 * combined counts. An entry carries path, scope, kind, status, and counts;
 * an unreadable file is recorded with a fixed reason, never its contents.
 * `blockOf(json)` picks the hooks object out of a parsed document.
 */
function readHookFiles(locations, blockOf = json => (isObject(json) ? json.hooks : undefined)) {
  const total = { ...emptyCounts(), files: 0, unreadable: 0 };
  const entries = [];
  const seen = new Set();
  for (const location of locations) {
    const resolved = path.resolve(location.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const entry = { path: resolved, scope: location.scope, kind: 'hooks', status: 'not_found', serverCount: 0 };
    if (fs.existsSync(resolved)) {
      try {
        const json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        const counts = countHooks(isObject(json) ? blockOf(json) : null);
        if (!isObject(json)) counts.malformed = true;
        entry.status = 'found';
        entry.hooks = counts;
        if (isObject(json) && json.version !== undefined) entry.version = Number.isInteger(json.version) ? json.version : 'unrecognized';
        addCounts(total, counts);
        total.files += 1;
      } catch (error) {
        entry.status = 'unreadable';
        entry.reason = error.code === 'EACCES' || error.code === 'EPERM' ? 'permission denied' : error.code === 'EISDIR' ? 'this is a directory, not a config file' : 'invalid JSON';
        total.unreadable += 1;
      }
    }
    entries.push(entry);
  }
  return { entries, hooks: total };
}

/** One COVERAGE sentence for a client whose only settings evidence is hook counts, or '' when no hooks file exists. */
function coverageSentence(hooks, label) {
  if (!hooks || (!hooks.files && !hooks.unreadable)) return '';
  const parts = [];
  if (hooks.unreadable) parts.push(`${label} hooks: ${hooks.unreadable} hooks file${hooks.unreadable === 1 ? '' : 's'} could not be read, so the hook count is incomplete.`);
  if (hooks.files) parts.push(`${label} hooks: ${hooks.handlers} handler${hooks.handlers === 1 ? '' : 's'} across ${hooks.events} event${hooks.events === 1 ? '' : 's'} in ${hooks.files} file${hooks.files === 1 ? '' : 's'}${hooks.malformed ? ' (malformed entries were skipped)' : ''}; none were run, and no command text was recorded.`);
  return parts.join(' ');
}

/** DISCOVERY status text for a hooks file entry. */
function statusText(entry) {
  const h = entry.hooks || emptyCounts();
  const base = h.handlers ? `hooks (${h.handlers} handler${h.handlers === 1 ? '' : 's'} across ${h.events} event${h.events === 1 ? '' : 's'})` : 'hooks (none configured)';
  return h.malformed ? `${base} · malformed entries skipped` : base;
}

module.exports = { CURSOR_ENTERPRISE_DIR, countHooks, addCounts, emptyCounts, cursorLocations, readHookFiles, coverageSentence, statusText };
