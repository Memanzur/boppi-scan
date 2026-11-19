/** Locator for Cursor MCP configuration files (user + project). */
'use strict';
const path = require('path');
const { mapServers } = require('./parse');

function locate({ home, cwd }) {
  return {
    clientKey: 'cursor',
    label: 'Cursor',
    source: 'cursor',
    files: [
      { path: path.join(home, '.cursor', 'mcp.json'), scope: 'user', extract: json => mapServers(json && json.mcpServers) },
      { path: path.join(cwd, '.cursor', 'mcp.json'), scope: 'project', extract: json => mapServers(json && json.mcpServers) },
    ],
  };
}

module.exports = { locate };
