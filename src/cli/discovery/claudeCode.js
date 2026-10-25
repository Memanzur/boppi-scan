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
        // ~/.claude.json holds much more than MCP config; extract ONLY the
        // mcpServers blocks (global + the current project's) and nothing else.
        extract: json => ({
          ...(json.mcpServers && typeof json.mcpServers === 'object' ? json.mcpServers : {}),
          ...(json.projects && json.projects[cwd] && typeof json.projects[cwd].mcpServers === 'object' ? json.projects[cwd].mcpServers : {}),
        }),
        // The documented per-project enablement lists for the current project; server names only.
        policy: json => ccSettings.projectPolicy(json, cwd),
      },
      { path: path.join(cwd, '.mcp.json'), scope: 'project', extract: json => json.mcpServers || {} },
    ],
  };
}

module.exports = { locate };
