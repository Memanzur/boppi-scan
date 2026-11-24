/**
 * Guard wrapper: run a command only after the policy guard passes.
 * The command is spawned directly, never through a shell.
 */
'use strict';
const { spawnSync } = require('child_process');

function formatCommand(argv) {
  return argv.map(part => /[\s"]/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function runWrapped(argv, env = process.env) {
  const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', env, shell: false });
  if (result.error) return { ran: false, code: 127, error: result.error };
  return { ran: true, code: result.status == null ? 1 : result.status, error: null };
}

module.exports = { formatCommand, runWrapped };
