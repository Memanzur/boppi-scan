/**
 * Client-level approval bypass. A bare shell stays high. The same shell is
 * critical when one of these configs turns prompting off:
 * Claude Code permissions.defaultMode bypassPermissions,
 * Codex approval_policy never,
 * Cursor CLI approvalMode unrestricted (the persisted yolo / run-everything mode).
 * Cline autoApprove is read from the server entry itself.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function claudeBypass(clientKey, claudeSettings) {
  if (clientKey !== 'claude-code') return null;
  const hit = (claudeSettings || []).find(item => item && item.mode === 'bypassPermissions');
  return hit ? 'Claude Code permissions.defaultMode is bypassPermissions' : null;
}

function codexBypass(client) {
  if (!client || client.clientKey !== 'codex') return null;
  for (const file of client.files || []) {
    if (file.status !== 'found' || !file.path) continue;
    let text = '';
    try { text = fs.readFileSync(file.path, 'utf8'); } catch (_) { continue; }
    if (/^\s*approval_policy\s*=\s*["']?never["']?\s*$/m.test(text)) return 'Codex approval_policy is never';
  }
  return null;
}

function cursorBypass(client, home, cwd, filesRead) {
  if (!client || client.clientKey !== 'cursor') return null;
  const files = [
    home ? path.join(home, '.cursor', 'cli-config.json') : null,
    cwd ? path.join(cwd, '.cursor', 'cli.json') : null,
  ].filter(Boolean);
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    const resolved = path.resolve(file);
    if (Array.isArray(filesRead)) filesRead.push(resolved);
    else if (filesRead && typeof filesRead.add === 'function') filesRead.add(resolved);
    let json;
    try { json = JSON.parse(text); } catch (_) { continue; }
    if (json && json.approvalMode === 'unrestricted') return 'Cursor approvalMode is unrestricted';
  }
  return null;
}

function clientBypassReason({ client, claudeSettings, home, cwd, filesRead }) {
  if (!client) return null;
  return claudeBypass(client.clientKey, claudeSettings)
    || codexBypass(client)
    || cursorBypass(client, home, cwd, filesRead)
    || null;
}

module.exports = { clientBypassReason };
