/**
 * Rules that differ by platform, in one place: how paths compare, how a
 * Windows-style key or home-relative argument is read, how config text is
 * decoded, and how a replace-by-rename survives Windows file locks. Every
 * function takes the platform as an argument (default: this host), so the
 * Windows rules are testable on any machine.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const pathFor = platform => (platform === 'win32' ? path.win32 : path.posix);

/** A path in the form comparisons use: resolved, and lower-cased on win32, whose file systems ignore case. */
function comparable(p, platform = process.platform) {
  const resolved = pathFor(platform).resolve(p);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a, b, platform = process.platform) {
  return comparable(a, platform) === comparable(b, platform);
}

/** Whether `child` is strictly inside `parent`. A root such as / or C:\ contains every other path on it. */
function isInside(child, parent, platform = process.platform) {
  const c = comparable(child, platform), p = comparable(parent, platform);
  const sep = pathFor(platform).sep;
  return c !== p && c.startsWith(p.endsWith(sep) ? p : p + sep);
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
/** C:\x, c:/x and C:/x name the same folder; the separator and the drive letter's case do not matter to Windows. */
const windowsKey = key => key.replace(/\//g, '\\').replace(/^[A-Za-z]:/, drive => drive.toLowerCase());

/**
 * The key under `projects` in ~/.claude.json that names `cwd`. An exact key
 * wins. For a Windows path, a key with the other separator or drive-letter
 * case is accepted too, since Claude Code may write either. Otherwise cwd.
 */
function projectKey(projects, cwd) {
  if (!projects || typeof projects !== 'object' || Object.prototype.hasOwnProperty.call(projects, cwd) || !DRIVE_PATH.test(cwd)) return cwd;
  const wanted = windowsKey(cwd);
  return Object.keys(projects).find(key => DRIVE_PATH.test(key) && windowsKey(key) === wanted) || cwd;
}

/**
 * Parse config bytes as JSON. A UTF-8 byte order mark (PowerShell 5.1's
 * Set-Content -Encoding utf8 writes one) is skipped. UTF-16 text throws
 * Error('utf16_config') so the reason can name the encoding.
 */
function parseJson(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) throw new Error('utf16_config');
  const text = buffer.toString('utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

const RENAME_RETRY = Object.freeze({ attempts: 8, firstDelayMs: 20 });
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * fs.renameSync, retried on win32 while another process (antivirus, the
 * search indexer, OneDrive) briefly holds the target open: EPERM, EACCES and
 * EBUSY are retried with a doubling wait, about five seconds in all. Other
 * platforms and other errors throw at once.
 */
function renameRetry(from, to, { platform = process.platform, rename = fs.renameSync } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return rename(from, to); } catch (error) {
      const transient = platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (!transient || attempt >= RENAME_RETRY.attempts) throw error;
      pause(RENAME_RETRY.firstDelayMs * 2 ** (attempt - 1));
    }
  }
}

/**
 * fs.openSync for a user-named output file that never writes through a
 * symbolic link, also where O_NOFOLLOW does not exist (Windows): the path
 * is lstat'ed before the open, and the opened file must be that same
 * regular file. Throws ELOOP for a link and ENOTREG for anything else that
 * is not a regular file. nofollow is overridable so tests can drop it.
 */
function openNoFollow(file, flags, mode, { nofollow = fs.constants.O_NOFOLLOW || 0 } = {}) {
  const refuse = (code, what) => Object.assign(new Error(`${file} ${what}`), { code });
  let before = null;
  try { before = fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (before && before.isSymbolicLink()) throw refuse('ELOOP', 'is a symbolic link');
  if (before && !before.isFile()) throw refuse('ENOTREG', 'is not a regular file');
  const fd = fs.openSync(file, flags | nofollow, mode);
  try {
    const opened = fs.fstatSync(fd);
    if (fs.lstatSync(file).isSymbolicLink() || (before && (opened.ino !== before.ino || opened.dev !== before.dev))) throw refuse('ELOOP', 'is a symbolic link');
    if (!opened.isFile()) throw refuse('ENOTREG', 'is not a regular file');
  } catch (error) { fs.closeSync(fd); throw error; }
  return fd;
}

/** A directory argument that names a place on disk: /x, ~, ~/x, ~\x, %USERPROFILE%\x, C:\x, C:/x, or a bare drive C:. */
const DIRECTORY_ARG = /^(\/|~$|~[\\/]|%USERPROFILE%(?:[\\/]|$)|[A-Za-z]:([\\/]|$))/i;

/** A home-relative directory argument as an absolute path; any other value unchanged. A bare drive C: is its root. */
function expandHomeArg(value, home) {
  if (typeof value !== 'string') return value;
  const relative = value.match(/^(?:~|%USERPROFILE%)(?:[\\/](.*))?$/i);
  if (relative) return path.join(home, ...(relative[1] || '').split(/[\\/]/).filter(Boolean));
  if (/^[A-Za-z]:$/.test(value)) return `${value}\\`;
  return value;
}

/**
 * A variable that moves a client's config (APPDATA, XDG_CONFIG_HOME,
 * CLAUDE_CONFIG_DIR), honored only when the scan reads the live user's
 * home: it belongs to that user, and --home of another folder reads that
 * folder's default locations. null when unset, relative, or not live.
 */
function liveEnv(name, home, env = process.env) {
  const value = env[name];
  return value && path.isAbsolute(value) && samePath(home, os.homedir()) ? value : null;
}

/** Claude Code's user config folder: $CLAUDE_CONFIG_DIR for the live user, else <home>/.claude. */
function claudeConfigDir(home, env = process.env) {
  return liveEnv('CLAUDE_CONFIG_DIR', home, env) || path.join(home, '.claude');
}

/** Claude Code's global config file: .claude.json in $CLAUDE_CONFIG_DIR for the live user, else in <home>. */
function claudeJsonPath(home, env = process.env) {
  return path.join(liveEnv('CLAUDE_CONFIG_DIR', home, env) || home, '.claude.json');
}

/** How a file Boppi writes for the user alone is protected here. Windows has no file modes; the file inherits its folder's ACL and Boppi does not narrow it. */
function ownerOnlyNote(platform = process.platform) {
  return platform === 'win32' ? 'protected only by your Windows profile folder\'s permissions; Boppi does not narrow them' : 'owner-only';
}

/** True inside Windows Subsystem for Linux. */
function isWsl({ platform = process.platform, release = os.release(), env = process.env } = {}) {
  return platform === 'linux' && (!!env.WSL_DISTRO_NAME || /microsoft/i.test(release));
}

/** One line telling a WSL user how to scan the Windows-side clients, or null outside WSL or when --home or --platform was given. */
function wslHint(options, probe) {
  if (!isWsl(probe) || options.homeGiven || options.platformGiven) return null;
  return 'Running inside WSL: this scans the Linux home. Claude Desktop and Cursor on Windows keep their configs in the Windows profile; to scan those, add --home /mnt/c/Users/<you> --platform win32.';
}

module.exports = { liveEnv, claudeConfigDir, claudeJsonPath, comparable, samePath, isInside, projectKey, parseJson, renameRetry, RENAME_RETRY, openNoFollow, DIRECTORY_ARG, expandHomeArg, ownerOnlyNote, isWsl, wslHint };
