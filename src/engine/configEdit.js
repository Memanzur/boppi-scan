/**
 * Boppi config edits applied to a normalized inventory.
 *
 * A remediation is a config edit. Where the raw config is available the CLI
 * re-runs the scan without the server; where only the inventory exists (the
 * control plane) this module removes the same records. Both routes must agree,
 * and the CLI test suite asserts that on every fixture.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiConfigEdit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTIONS = Object.freeze(['remove_server']);

  function fail(message) { throw new TypeError(`Config edit: ${message}`); }

  /** Pure: a new inventory with the server record and every permission derived from it removed. */
  function applyEdit(inventory, edit) {
    if (!inventory || !Array.isArray(inventory.mcpServers)) fail('an inventory with mcpServers is required');
    if (!edit || edit.action !== 'remove_server') fail(`unsupported action ${edit && edit.action}`);
    const server = inventory.mcpServers.find(s => s.id === edit.serverId && s.agentId === edit.agentId);
    if (!server) fail(`server ${edit.serverId} is not in the inventory for agent ${edit.agentId}`);
    return {
      ...inventory,
      mcpServers: inventory.mcpServers.filter(s => s.id !== server.id),
      permissions: (inventory.permissions || []).filter(p => p.integrationId !== server.id),
    };
  }

  return { ACTIONS, applyEdit };
});
