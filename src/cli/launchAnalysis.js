/**
 * Static launch analysis for servers the scan could not recognize. Every
 * fact comes from the config text or from local file metadata (one stat, one
 * bounded package.json read): nothing is run, fetched, resolved on PATH, or
 * contacted. The facts describe how a server starts, never what it can do,
 * so nothing here feeds capability inference or grading.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { identityOf } = require('./serverCatalog');
const scanner = require('../engine/localMcpScanner');

// Package launchers the catalog identity does not parse, rewritten to the npx or uvx form it does.
const PACKAGE_LAUNCHERS = Object.freeze([
  { command: 'bunx', prefix: [], as: 'npx', via: 'bunx' },
  { command: 'pnpx', prefix: [], as: 'npx', via: 'pnpx' },
  { command: 'pnpm', prefix: ['dlx'], as: 'npx', via: 'pnpm dlx' },
  { command: 'npm', prefix: ['exec'], as: 'npx', via: 'npm exec' },
  { command: 'npm', prefix: ['x'], as: 'npx', via: 'npm exec' },
  { command: 'yarn', prefix: ['dlx'], as: 'npx', via: 'yarn dlx' },
  { command: 'bun', prefix: ['x'], as: 'npx', via: 'bun x' },
  { command: 'pipx', prefix: ['run'], as: 'uvx', via: 'pipx run' },
  { command: 'uv', prefix: ['tool', 'run'], as: 'uvx', via: 'uv tool run' },
]);
const DIRECT_VIA = Object.freeze({ npx: 'npx', uvx: 'uvx', docker: 'docker run' });

// Runtimes that take a program argument. `values` take the next argument; `inline` means the code is in the config; `module` names an importable module.
const RUNTIMES = Object.freeze({
  node: { family: 'node', values: ['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions'], inline: ['-e', '--eval', '-p', '--print'] },
  nodejs: { family: 'node', values: ['-r', '--require', '--import', '--loader'], inline: ['-e', '--eval', '-p', '--print'] },
  bun: { family: 'node', skip: ['run'], values: ['-r', '--preload'], inline: ['-e', '--eval'] },
  deno: { family: 'deno', skip: ['run'], values: ['--config', '-c', '--import-map'], inline: ['eval'] },
  python: { family: 'python', values: ['-W', '-X'], inline: ['-c'], module: ['-m'] },
  python3: { family: 'python', values: ['-W', '-X'], inline: ['-c'], module: ['-m'] },
  python2: { family: 'python', values: ['-W', '-X'], inline: ['-c'], module: ['-m'] },
  ruby: { family: 'ruby', values: ['-I', '-r'], inline: ['-e'] },
  php: { family: 'php', values: ['-c', '-d'], inline: ['-r'] },
  java: { family: 'java', values: ['-cp', '-classpath', '--class-path'], inline: [], jar: ['-jar'] },
  sh: { family: 'shell', values: [], inline: ['-c'] },
  bash: { family: 'shell', values: [], inline: ['-c'] },
  zsh: { family: 'shell', values: [], inline: ['-c'] },
});

const LOCATION_LABEL = Object.freeze({
  installed_package: 'in an installed package folder',
  system: 'in a system folder',
  downloads: 'in Downloads',
  temporary: 'in a temporary folder',
  home_tools: 'in a hidden tool folder in your home',
  home: 'in your home folder',
  elsewhere: 'outside your home folder',
  relative: 'at a relative path (resolved against a folder Boppi cannot know)',
  path_lookup: 'looked up on PATH at launch (Boppi does not resolve it)',
});

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,39}$/;
const MANIFEST_MAX_BYTES = 256 * 1024;
const MANIFEST_MAX_LEVELS = 6;

function basename(command) {
  return typeof command === 'string' ? command.trim().split(/[\\/]/).pop() : '';
}

function stringArgs(server) {
  return Array.isArray(server.args) ? server.args.filter(v => typeof v === 'string') : [];
}

function startsWith(args, prefix) {
  return prefix.every((part, i) => args[i] === part);
}

/** The package launch a server entry describes, or null: { via, identity } with identity in identityOf's shape. */
function packageLaunch(server) {
  const command = basename(server && server.command);
  const identity = identityOf(server);
  if (identity && identity.kind !== 'url') return { via: DIRECT_VIA[command] || command, identity };
  const args = stringArgs(server || {});
  const launcher = PACKAGE_LAUNCHERS.find(l => l.command === command && startsWith(args, l.prefix));
  if (!launcher) return null;
  const rewritten = identityOf({ command: launcher.as, args: args.slice(launcher.prefix.length) });
  return rewritten ? { via: launcher.via, identity: rewritten } : null;
}

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Where a program sits, as an enum: the raw path never leaves this function. */
function locationOf(file, home, tmpdir) {
  const parts = file.split(/[\\/]/);
  if (parts.includes('node_modules') || parts.includes('site-packages') || parts.includes('dist-packages')) return 'installed_package';
  if (isInside(file, home)) {
    const first = path.relative(home, file).split(/[\\/]/)[0];
    if (first === 'Downloads') return 'downloads';
    if (first.startsWith('.')) return 'home_tools';
    return 'home';
  }
  if ([tmpdir, '/tmp', '/private/tmp', '/var/tmp', '/var/folders', '/private/var/folders'].some(dir => dir && isInside(file, dir))) return 'temporary';
  if (/^(\/(usr|bin|sbin|opt|nix|Applications|Library|System)\/|[A-Za-z]:[\\/](Program Files|Windows))/i.test(file)) return 'system';
  return 'elsewhere';
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}

/** name and version from the package.json nearest a Node script, when both are safe to report. */
function manifestOf(file, home) {
  let dir = path.dirname(file);
  for (let level = 0; level < MANIFEST_MAX_LEVELS; level++) {
    if (dir === home || dir === path.dirname(dir)) return null;
    const candidate = path.join(dir, 'package.json');
    let stat = null;
    try { stat = fs.statSync(candidate); } catch (_) { stat = null; }
    if (stat && stat.isFile()) {
      if (stat.size > MANIFEST_MAX_BYTES) return null;
      let parsed = null;
      try { parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')); } catch (_) { parsed = null; }
      if (!parsed || typeof parsed !== 'object') return null;
      const name = typeof parsed.name === 'string' && NPM_NAME.test(parsed.name) && !scanner.isSecretShaped(parsed.name) ? parsed.name : null;
      const version = typeof parsed.version === 'string' && VERSION.test(parsed.version) ? parsed.version : null;
      return name || version ? { name, version } : null;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** The program argument a runtime would load: { form, value } where value is the raw argument or module name. */
function runtimeProgram(spec, args) {
  let i = 0;
  if (spec.skip && spec.skip.includes(args[0])) i = 1;
  for (; i < args.length; i++) {
    const arg = args[i];
    if (spec.inline.includes(arg)) return { form: 'inline_code', value: null };
    if (spec.module && spec.module.includes(arg)) return { form: 'module', value: args[i + 1] || null };
    if (spec.jar && spec.jar.includes(arg)) return { form: 'script', value: args[i + 1] || null };
    if (spec.values.includes(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    return { form: 'script', value: arg };
  }
  return null;
}

function expandHome(value, home) {
  return value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
}

function isPathLike(value) {
  return /[\\/]/.test(value);
}

function isAbsoluteLike(value) {
  return /^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

/** Program facts for a local launch: { form, location, exists, manifest }, or null when the entry names no program. */
function localProgram(server, home, tmpdir) {
  const command = typeof server.command === 'string' ? server.command.trim() : '';
  if (!command) return null;
  const spec = RUNTIMES[basename(command).toLowerCase()];
  let form = 'program';
  let target = command;
  if (spec) {
    const found = runtimeProgram(spec, stringArgs(server));
    if (!found) return null;
    if (found.form !== 'script') return { form: found.form, location: null, exists: null, manifest: null };
    form = 'script';
    target = found.value;
    if (!target) return null;
  }
  if (!isPathLike(target)) return { form, location: spec ? 'relative' : 'path_lookup', exists: null, manifest: null };
  if (!isAbsoluteLike(target)) return { form, location: 'relative', exists: null, manifest: null };
  const file = path.resolve(expandHome(target, home));
  const exists = isFile(file);
  const manifest = exists && spec && spec.family === 'node' ? manifestOf(file, path.resolve(home)) : null;
  return { form, location: locationOf(file, path.resolve(home), tmpdir), exists, manifest };
}

const FORM_WORD = Object.freeze({ script: 'script', module: 'module', inline_code: 'inline code' });

function viaOf(server, launch) {
  if (launch) return launch.via;
  const command = basename(server.command).toLowerCase();
  if (!command) return 'unknown';
  const runtime = RUNTIMES[command];
  if (runtime) {
    const found = runtimeProgram(runtime, stringArgs(server));
    return `${command} ${found ? FORM_WORD[found.form] : 'with no program'}`;
  }
  return isPathLike(server.command) ? 'program path' : 'command name';
}

function credentialEnvNames(server) {
  const env = server.env && typeof server.env === 'object' && !Array.isArray(server.env) ? server.env : null;
  try { return scanner.sanitizeEnv(env).credentialReferences; } catch (_) { return []; }
}

/** Static facts about how one raw server entry starts. */
function analyze(server, { home = os.homedir(), tmpdir = os.tmpdir() } = {}) {
  const launch = packageLaunch(server);
  return {
    basis: 'configured',
    via: viaOf(server, launch),
    program: launch ? null : localProgram(server, home, tmpdir),
    credentialEnvNames: credentialEnvNames(server),
  };
}

/** One sentence of facts for an analysis, from enums and allow-listed values only. */
function factsSentence(analysis) {
  if (!analysis) return '';
  const parts = [`starts with ${analysis.via}`];
  const program = analysis.program;
  if (program && program.location) {
    parts.push(`${program.form === 'script' ? 'the script is' : 'the program is'} ${LOCATION_LABEL[program.location]}${program.exists === false ? ' and was not found on disk' : ''}`);
    if (program.manifest) parts.push(`the nearest package.json says ${[program.manifest.name, program.manifest.version].filter(Boolean).join(' ')}`);
  }
  if (analysis.credentialEnvNames.length) parts.push(`it receives credential-named environment variables ${analysis.credentialEnvNames.join(', ')} (names only)`);
  return `From the config, not run: ${parts.join('; ')}. These facts do not show what it can do.`;
}

module.exports = { analyze, packageLaunch, locationOf, factsSentence, LOCATION_LABEL, PACKAGE_LAUNCHERS };
