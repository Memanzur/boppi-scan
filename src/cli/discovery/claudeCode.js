/** Locator for Claude Code MCP configuration (user config + project .mcp.json) and its permission settings. */
'use strict';
const path = require('path');
const { claudeCodeSettingsFiles } = require('../builtinTools');
const plugins = require('./claudePlugins');

function locate({ home, cwd, pluginRoot = null }) {
  // Installed plugins' MCP servers, read-only (claudePlugins.js); the index entry is coverage only.
  const installed = plugins.pluginFiles({ home, cwd, pluginRoot });
  return {
    clientKey: 'claude-code',
    label: 'Claude Code',
    source: 'claude-code',
    // Read for the built-in tool grades only; these files hold no mcpServers.
    settingsFiles: claudeCodeSettingsFiles({ home, cwd }),
    files: [
      {
        path: path.join(home, '.claude.json'),
        scope: 'user',
        // ~/.claude.json holds much more than MCP config; only these two
        // blocks are read. The second is Claude Code's local scope.
        blocks: [{ keyPath: ['mcpServers'], scope: 'user' }, { keyPath: ['projects', cwd, 'mcpServers'], scope: 'local' }],
      },
      { path: path.join(cwd, '.mcp.json'), scope: 'project', blocks: [{ keyPath: ['mcpServers'], scope: 'project' }] },
      ...installed.files,
    ],
    pluginIndex: installed.index,
  };
}

module.exports = { locate };
