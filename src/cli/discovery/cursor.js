/** Locator for Cursor MCP configuration files (user + project). */
'use strict';
const path = require('path');

function locate({ home, cwd }) {
  return {
    clientKey: 'cursor',
    label: 'Cursor',
    source: 'cursor',
    files: [
      { path: path.join(home, '.cursor', 'mcp.json'), scope: 'user', extract: json => json.mcpServers || {} },
      { path: path.join(cwd, '.cursor', 'mcp.json'), scope: 'project', extract: json => json.mcpServers || {} },
    ],
  };
}

module.exports = { locate };
