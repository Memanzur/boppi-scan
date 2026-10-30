/** Locator for Claude Desktop MCP configuration files. */
'use strict';
const path = require('path');
const { liveEnv } = require('../platform');

function locate({ home, platform }) {
  const file = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : platform === 'win32'
      // APPDATA and XDG_CONFIG_HOME belong to the live user; a scan of any other home (--home) reads that home's defaults.
      ? path.join(liveEnv('APPDATA', home) || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : path.join(liveEnv('XDG_CONFIG_HOME', home) || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
  return {
    clientKey: 'claude-desktop',
    label: 'Claude Desktop',
    source: 'claude-desktop',
    files: [{ path: file, scope: 'user', blocks: [{ keyPath: ['mcpServers'], scope: 'user' }] }],
  };
}

module.exports = { locate };
