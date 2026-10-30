/**
 * Entry point of the standalone Boppi executable (a Node single executable
 * application). Inside it, `require` loads only Node builtins, so the
 * scanner's CommonJS files (everything the npm package ships under bin/ and
 * src/, plus package.json) are embedded as SEA assets under their package
 * paths, listed in the asset boppi-assets.json. This file is a small module
 * loader over that map: relative specifiers resolve against the requiring
 * file (exact, .js, .json, /index.js), JSON is parsed, JavaScript is compiled
 * with the CommonJS wrapper, and anything else is a builtin. Then it runs
 * bin/boppi.js, the same entry as the npm install.
 *
 * Under plain node (tests) createLoader is exported with a disk reader, so
 * the loader itself is tested without building an executable.
 */
'use strict';
const path = require('path');
const vm = require('vm');

const ASSET_LIST = 'boppi-assets.json';
const ENTRY = 'bin/boppi.js';

/** names: the embedded package paths; readText(name): their UTF-8 contents; builtin: the host require for builtins. */
function createLoader({ names, readText, builtin, virtualRoot }) {
  const known = new Set(names);
  const cache = new Map();

  function resolve(spec, fromDir) {
    const base = path.posix.normalize(path.posix.join(fromDir, spec));
    for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}/index.js`]) {
      if (known.has(candidate)) return candidate;
    }
    const error = new Error(`Cannot find embedded module '${spec}' from '${fromDir || '.'}'`);
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }

  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const filename = path.join(virtualRoot, ...name.split('/'));
    const module = { id: name, filename, exports: {}, loaded: false, children: [], paths: [] };
    cache.set(name, module);
    const source = readText(name);
    if (name.endsWith('.json')) {
      module.exports = JSON.parse(source);
      module.loaded = true;
      return module.exports;
    }
    const dir = path.posix.dirname(name);
    const localRequire = spec => (spec.startsWith('./') || spec.startsWith('../') ? load(resolve(spec, dir)) : builtin(spec));
    localRequire.cache = Object.create(null);
    // A shebang line is valid only at the very start of a script, not inside the wrapper.
    const body = source.startsWith('#!') ? `//${source.slice(2)}` : source;
    const fn = vm.compileFunction(body, ['exports', 'require', 'module', '__filename', '__dirname'], { filename });
    try {
      fn.call(module.exports, module.exports, localRequire, module, filename, path.dirname(filename));
    } catch (error) {
      cache.delete(name);
      throw error;
    }
    module.loaded = true;
    return module.exports;
  }

  return { load, resolve };
}

function runEmbedded() {
  const sea = require('node:sea');
  const names = JSON.parse(sea.getAsset(ASSET_LIST, 'utf8'));
  const loader = createLoader({
    names,
    readText: name => sea.getAsset(name, 'utf8'),
    builtin: spec => require(spec),
    virtualRoot: path.join(path.dirname(process.execPath), 'boppi-embedded'),
  });
  loader.load(ENTRY);
}

let standalone = false;
try { standalone = require('node:sea').isSea(); } catch (_) { standalone = false; }
if (standalone) runEmbedded();
else module.exports = { createLoader, ASSET_LIST, ENTRY };
