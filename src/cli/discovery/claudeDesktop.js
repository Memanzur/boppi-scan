/** Locator for Claude Desktop MCP configuration files. */
'use strict';
const os = require('os');
const path = require('path');

function locate({ home, platform }) {
  const file = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : platform === 'win32'
      // APPDATA belongs to the live user; a scan of any other home (--home) reads that home's AppData.
      ? path.join(process.env.APPDATA && path.resolve(home) === path.resolve(os.homedir()) ? process.env.APPDATA : path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  return {
    clientKey: 'claude-desktop',
    label: 'Claude Desktop',
    source: 'claude-desktop',
    files: [{ path: file, scope: 'user', blocks: [{ keyPath: ['mcpServers'], scope: 'user' }] }],
  };
}

module.exports = { locate };
