/**
 * Locator for Cursor MCP configuration files (user + project) and, as
 * counts only, its hooks.json files (user, project, and the enterprise
 * location for the platform). No hook is run and no command text is kept.
 */
'use strict';
const path = require('path');
const hooksModule = require('./hooks');

function locate({ home, cwd, platform, cursorEnterpriseDir = null }) {
  const inspectFiles = hooksModule.cursorLocations({ home, cwd, platform, enterpriseDir: cursorEnterpriseDir });
  return {
    clientKey: 'cursor',
    label: 'Cursor',
    source: 'cursor',
    files: [
      { path: path.join(home, '.cursor', 'mcp.json'), scope: 'user', blocks: [{ keyPath: ['mcpServers'], scope: 'user' }] },
      { path: path.join(cwd, '.cursor', 'mcp.json'), scope: 'project', blocks: [{ keyPath: ['mcpServers'], scope: 'project' }] },
    ],
    // Hook files, read by watch and by inspect(); never handed to the built-in tool grader.
    inspectFiles,
    /** Hook counts per location and in total; called by discovery after the config files were read. */
    inspect() {
      const { entries, hooks } = hooksModule.readHookFiles(inspectFiles);
      return { files: entries, hooks };
    },
  };
}

module.exports = { locate };
