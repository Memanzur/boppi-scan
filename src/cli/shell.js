'use strict';
const os = require('os');
const path = require('path');

function shellArgument(value) {
  const text = String(value);
  return /[$`'"\\\r\n]/.test(text) ? "'" + text.replace(/'/g, "'\\''") + "'" : JSON.stringify(text);
}

function shellPath(value) {
  if (/^[~a-zA-Z0-9_./-]+$/.test(value)) return value;
  return value.startsWith('~/') ? '~/' + shellArgument(value.slice(2)) : shellArgument(value);
}

/** ` --home <dir>` when a run used a home other than the user's, so a follow-up command reads the same ~/.boppi state; otherwise ''. */
function homeFlag(options) {
  return options.home && path.resolve(options.home) !== path.resolve(os.homedir()) ? ` --home ${shellPath(path.resolve(options.home))}` : '';
}

/**
 * The scan scope a run was given (--config and --source, --home, --cwd,
 * --platform) as flags to append to a printed follow-up command, so that
 * command reads and edits the same files the run did instead of the real ones.
 */
function scopeFlags(options) {
  let flags = '';
  if (options.config) flags += ` --config ${shellPath(path.resolve(options.config))} --source ${options.source}`;
  flags += homeFlag(options);
  if (options.cwd && path.resolve(options.cwd) !== process.cwd()) flags += ` --cwd ${shellPath(path.resolve(options.cwd))}`;
  if (options.platform && options.platform !== process.platform) flags += ` --platform ${options.platform}`;
  return flags;
}

module.exports = { shellArgument, shellPath, homeFlag, scopeFlags };
