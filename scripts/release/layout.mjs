/**
 * The release directory layout (dist/release/<version>/), shared by build,
 * sign, verify and the tests, so every tool agrees on which files exist and
 * what they are.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'boppi-agent-release-v1';
export const SUMS = 'SHA256SUMS';
export const SIG = 'SHA256SUMS.sig';
export const MANIFEST = 'release.json';
export const PUB = 'boppi-release.pub';
export const INSTALLER = 'install.sh';
export const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]+)?$/;

/** Every executable target, as release file suffix -> os/arch. */
export const TARGETS = Object.freeze({
  'darwin-arm64': { os: 'darwin', arch: 'arm64', suffix: '' },
  'darwin-x64': { os: 'darwin', arch: 'x64', suffix: '' },
  'linux-x64': { os: 'linux', arch: 'x64', suffix: '' },
  'win-x64': { os: 'win32', arch: 'x64', suffix: '.exe' },
});

export function executableName(version, target) { return `boppi-${version}-${target}${TARGETS[target].suffix}`; }
export function tarballName(version) { return `boppi-${version}.tgz`; }

/** The files SHA256SUMS lists for a version, by name, with their release.json kind/os/arch. */
export function expectedFiles(version) {
  const files = new Map();
  files.set(tarballName(version), { kind: 'npm', os: null, arch: null });
  for (const [target, t] of Object.entries(TARGETS)) files.set(executableName(version, target), { kind: 'executable', os: t.os, arch: t.arch });
  files.set(INSTALLER, { kind: 'installer', os: null, arch: null });
  files.set(PUB, { kind: 'key', os: null, arch: null });
  return files;
}

export function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
export function sha256File(file) { return sha256(fs.readFileSync(file)); }

/** "<hex>  <name>\n" lines, sorted by name (byte order). */
export function formatSums(entries) {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(e => `${e.sha256}  ${e.name}\n`).join('');
}

/** Parse SHA256SUMS strictly: every line "<64 hex>  <name>", no duplicates, no path separators. */
export function parseSums(text) {
  const out = new Map();
  const lines = String(text).split('\n');
  if (lines.pop() !== '') throw new Error(`${SUMS} must end with a newline`);
  for (const line of lines) {
    const m = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    if (!m) throw new Error(`${SUMS}: malformed line "${line.slice(0, 80)}"`);
    if (out.has(m[2])) throw new Error(`${SUMS}: ${m[2]} listed twice`);
    out.set(m[2], m[1]);
  }
  return out;
}

/** Files of an npm pack listing that are not allowed in the published package. Allowed: bin/, src/, README.md, LICENSE, package.json; never tests, docs, scripts, fixtures, dotfiles or source maps. */
export function disallowedPackFiles(paths) {
  return paths.filter(p => {
    if (!/^(bin|src)\/|^(README\.md|LICENSE|package\.json)$/.test(p)) return true;
    if (p.split('/').some(part => part.startsWith('.'))) return true;
    if (/\.map$/.test(p)) return true;
    if (/(^|\/)(test|tests|docs|scripts|fixtures|__tests__)\//.test(p)) return true;
    return false;
  });
}

/** install.sh with the version, default base URL and public key filled in. */
export function stampInstaller(template, { version, publicLine, baseUrl = '' }) {
  if (!VERSION_RE.test(version)) throw new Error(`bad version ${version}`);
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ boppi-release$/.test(publicLine)) throw new Error('bad public key line');
  if (baseUrl && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(baseUrl)) throw new Error('the default base URL must be a plain https URL');
  const fields = { '@@BOPPI_VERSION@@': version, '@@BOPPI_PUBLIC_KEY@@': publicLine, '@@BOPPI_DEFAULT_BASE_URL@@': baseUrl };
  let out = template;
  for (const [token, value] of Object.entries(fields)) {
    if (!out.includes(token)) throw new Error(`installer template lacks ${token}`);
    out = out.split(token).join(value);
  }
  if (/@@BOPPI_[A-Z_]+@@/.test(out)) throw new Error('installer template has an unknown placeholder');
  return out;
}

/** The public key line stamped into an installer, or null. */
export function installerPublicKey(text) {
  const m = /^BOPPI_PUBLIC_KEY='(ssh-ed25519 [A-Za-z0-9+/=]+ boppi-release)'$/m.exec(text);
  return m ? m[1] : null;
}

export function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
export function listDir(dir) { return fs.readdirSync(dir).sort(); }
export const join = path.join;
