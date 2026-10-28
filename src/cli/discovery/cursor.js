/** Locator for Cursor MCP configuration files (user + project). */
'use strict';
const path = require('path');

function locate({ home, cwd }) {
  return {
    clientKey: 'cursor',
    label: 'Cursor',
    source: 'cursor',
    files: [
      { path: path.join(home, '.cursor', 'mcp.json'), scope: 'user', blocks: [{ keyPath: ['mcpServers'], scope: 'user' }] },
      { path: path.join(cwd, '.cursor', 'mcp.json'), scope: 'project', blocks: [{ keyPath: ['mcpServers'], scope: 'project' }] },
    ],
  };
}

module.exports = { locate };
