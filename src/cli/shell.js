'use strict';

function shellArgument(value) {
  const text = String(value);
  return /[$`'"\\\r\n]/.test(text) ? "'" + text.replace(/'/g, "'\\''") + "'" : JSON.stringify(text);
}

function shellPath(value) {
  if (/^[~a-zA-Z0-9_./-]+$/.test(value)) return value;
  return value.startsWith('~/') ? '~/' + shellArgument(value.slice(2)) : shellArgument(value);
}

module.exports = { shellArgument, shellPath };
