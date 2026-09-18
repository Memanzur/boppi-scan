/** Locator for Claude Desktop MCP configuration files. */
'use strict';
const path = require('path');

function locate({ home, platform }) {
  const file = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  return {
    clientKey: 'claude-desktop',
    label: 'Claude Desktop',
    source: 'claude-desktop',
    files: [{ path: file, scope: 'user', extract: json => json.mcpServers || {} }],
  };
}

module.exports = { locate };
