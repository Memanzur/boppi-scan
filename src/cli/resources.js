/**
 * The one reader for files the Agent ships that are not JavaScript modules
 * (report scripts and styles, the logo, demo fixtures). Names are paths
 * relative to the package root, with forward slashes, e.g.
 * 'src/design/tokens.css'.
 *
 * Under node or npx they are read from the installed package on disk. Inside
 * the standalone executable (a Node single executable application) the same
 * files are embedded as assets under the same names by
 * scripts/release/build.mjs, and are read from there. fs is never patched.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function seaModule() {
  try {
    const sea = require('node:sea');
    return sea.isSea() ? sea : null;
  } catch (_) { return null; }
}

/** The file's bytes as a Buffer, or as a string when `encoding` is given. Throws when the resource does not exist. */
function read(name, encoding) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`invalid resource name: ${name}`);
  const sea = seaModule();
  const bytes = sea ? Buffer.from(sea.getRawAsset(name)) : fs.readFileSync(path.join(ROOT, ...name.split('/')));
  return encoding ? bytes.toString(encoding) : bytes;
}

module.exports = { read };
