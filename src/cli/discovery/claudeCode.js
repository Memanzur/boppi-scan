/** Locator for Claude Code MCP configuration (user config + project .mcp.json) and its permission settings. */
'use strict';
const path = require('path');
const { claudeCodeSettingsFiles } = require('../builtinTools');
const ccSettings = require('../claudeCodeSettings');

function locate({ home, cwd, platform, managedDir }) {
  return {
    clientKey: 'claude-code',
    label: 'Claude Code',
    source: 'claude-code',
    // Read for the built-in tool grades only; these files hold no mcpServers.
    settingsFiles: claudeCodeSettingsFiles({ home, cwd, platform, managedDir }),
    files: [
      {
        path: path.join(home, '.claude.json'),
        scope: 'user',
        // ~/.claude.json holds much more than MCP config; only these two
        // blocks are read. The second is Claude Code's local scope.
        blocks: [{ keyPath: ['mcpServers'], scope: 'user' }, { keyPath: ['projects', cwd, 'mcpServers'], scope: 'local' }],
        // The documented per-project enablement lists for the current project; server names only.
        policy: json => ccSettings.projectPolicy(json, cwd),
      },
      { path: path.join(cwd, '.mcp.json'), scope: 'project', blocks: [{ keyPath: ['mcpServers'], scope: 'project' }] },
    ],
  };
}

module.exports = { locate };
