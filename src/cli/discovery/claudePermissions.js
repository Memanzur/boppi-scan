/**
 * Claude Code permission settings, names and modes only.
 *
 * Documented files (code.claude.com/docs/en/settings):
 *   ~/.claude/settings.json
 *   <project>/.claude/settings.json
 *   <project>/.claude/settings.local.json
 *
 * permissions.defaultMode and the tool name in each permissions.allow entry
 * (the part before "(") are kept. The rest of an allow rule can be a path or
 * a command, so it is not stored. Values that look like secrets are dropped.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk']);

function insideHome(home, file) {
  let root;
  let resolved;
  try { root = fs.realpathSync(home); } catch (_) { return false; }
  try { resolved = fs.realpathSync(file); } catch (_) { return false; }
  return resolved === root || resolved.startsWith(root + path.sep);
}

function toolName(rule) {
  if (typeof rule !== 'string') return null;
  const name = rule.split('(')[0].trim();
  if (!name || name.length > 40 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return null;
  return name;
}

function summarize(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const perms = json.permissions && typeof json.permissions === 'object' && !Array.isArray(json.permissions) ? json.permissions : {};
  const allow = Array.isArray(perms.allow) ? perms.allow : (Array.isArray(json.allowedTools) ? json.allowedTools : []);
  const mode = typeof perms.defaultMode === 'string' && MODES.has(perms.defaultMode) ? perms.defaultMode : null;
  const tools = [];
  let unscopedShell = false;
  for (const rule of allow) {
    const name = toolName(rule);
    if (!name) continue;
    if (!tools.includes(name)) tools.push(name);
    if (name === 'Bash' && rule.trim() === 'Bash') unscopedShell = true;
  }
  if (!mode && !tools.length && !allow.length) return { mode: null, allowCount: 0, tools: [], unscopedShell: false, empty: true };
  return { mode, allowCount: allow.filter(rule => typeof rule === 'string').length, tools: tools.slice(0, 12), unscopedShell, empty: false };
}

function locations(home, cwd) {
  return [
    { scope: 'user', file: path.join(home, '.claude', 'settings.json') },
    { scope: 'project', file: path.join(cwd, '.claude', 'settings.json') },
    { scope: 'project', file: path.join(cwd, '.claude', 'settings.local.json') },
  ];
}

/** Read permission modes. `filesRead` receives files that were opened. */
function readClaudePermissions({ home, cwd, filesRead }) {
  const settings = [];
  for (const entry of locations(home, cwd)) {
    let stat;
    try { stat = fs.lstatSync(entry.file); } catch (_) { continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) continue;
    if (!insideHome(home, entry.file) && !insideHome(cwd, entry.file)) continue;
    let text;
    try { text = fs.readFileSync(entry.file, 'utf8'); } catch (_) { continue; }
    if (filesRead) filesRead.push(entry.file);
    let json;
    try { json = JSON.parse(text); } catch (_) {
      settings.push({ scope: entry.scope, file: entry.file, unreadable: true });
      continue;
    }
    const summary = summarize(json);
    if (summary) settings.push({ scope: entry.scope, file: entry.file, ...summary });
  }
  return settings;
}

function hygieneFrom(settings) {
  const findings = [];
  for (const item of settings) {
    if (item.unreadable) continue;
    if (item.mode === 'bypassPermissions') {
      findings.push({
        severity: 'high',
        tool: 'Claude Code',
        sentence: `Claude Code is set to bypass permission prompts (${item.scope} settings, permissions.defaultMode).`,
      });
    } else if (item.mode === 'dontAsk') {
      findings.push({
        severity: 'high',
        tool: 'Claude Code',
        sentence: `Claude Code is set not to ask before tools run (${item.scope} settings, permissions.defaultMode).`,
      });
    } else if (item.mode === 'acceptEdits') {
      findings.push({
        severity: 'medium',
        tool: 'Claude Code',
        sentence: `Claude Code accepts edits without a prompt (${item.scope} settings, permissions.defaultMode).`,
      });
    }
    if (item.unscopedShell) {
      findings.push({
        severity: 'medium',
        tool: 'Claude Code',
        sentence: `Claude Code allows Bash with no command restriction (${item.scope} settings).`,
      });
    }
  }
  return findings;
}

module.exports = { readClaudePermissions, hygieneFrom, summarize, MODES };
