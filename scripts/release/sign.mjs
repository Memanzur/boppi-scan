#!/usr/bin/env node
/**
 * Sign a release directory, or make a throwaway test key.
 *
 *   node scripts/release/sign.mjs --key <private key> --dir <release dir>
 *     Writes boppi-release.pub, SHA256SUMS (every release file, sorted),
 *     SHA256SUMS.sig (OpenSSH SSHSIG, namespace boppi-release) and the files,
 *     checksums and signature blocks of release.json. The key is an OpenSSH
 *     Ed25519 private key; a passphrase-protected one is handed to
 *     `ssh-keygen -Y sign`, which asks for the passphrase. Refuses unknown
 *     files in the directory and an install.sh that embeds a different key.
 *
 *   node scripts/release/sign.mjs --generate-test-key <dir>
 *     Writes <dir>/boppi-release-test (0600) and .pub. The directory must be
 *     outside this git worktree. Test keys are never release keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as sshsig from './sshsig.mjs';
import * as layout from './layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fail(message) { process.stderr.write(`sign: ${message}\n`); process.exit(1); }

function arg(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  if (!args[at + 1] || args[at + 1].startsWith('--')) fail(`${name} needs a value`);
  return args[at + 1];
}

/** Absolute, symlink-resolved path, also for a directory that does not exist yet. */
function realish(target) {
  let dir = path.resolve(target);
  const rest = [];
  while (!fs.existsSync(dir)) { rest.unshift(path.basename(dir)); dir = path.dirname(dir); }
  return path.join(fs.realpathSync(dir), ...rest);
}

function insideWorktree(target) {
  const top = spawnSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const root = fs.realpathSync(top.status === 0 ? top.stdout.trim() : ROOT);
  const rel = path.relative(root, realish(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function generateTestKey(dir) {
  if (insideWorktree(dir)) throw new Error(`refusing ${dir}: a key directory must be outside the git worktree ${ROOT}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'boppi-release-test');
  if (fs.existsSync(file) || fs.existsSync(`${file}.pub`)) throw new Error(`${file} already exists; not overwriting a key`);
  const key = sshsig.generateKey();
  fs.writeFileSync(file, key.privateText, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(`${file}.pub`, key.publicLine + '\n', { flag: 'wx' });
  return { file, publicFile: `${file}.pub`, fingerprint: key.fingerprint };
}

function signSums(keyFile, parsed, sumsFile) {
  const message = fs.readFileSync(sumsFile);
  if (!parsed.encrypted) return sshsig.sign(message, parsed.privateKey, parsed.publicKey);
  // Passphrase-protected key: ssh-keygen asks for the passphrase and writes <file>.sig.
  fs.rmSync(`${sumsFile}.sig`, { force: true });
  const run = spawnSync('ssh-keygen', ['-Y', 'sign', '-f', keyFile, '-n', sshsig.NAMESPACE, sumsFile], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('ssh-keygen -Y sign failed');
  return fs.readFileSync(`${sumsFile}.sig`, 'utf8');
}

export function signRelease({ keyFile, dir }) {
  const parsed = sshsig.parsePrivateKey(fs.readFileSync(keyFile, 'utf8'));
  const pub = parsed.publicKey;
  const manifestFile = path.join(dir, layout.MANIFEST);
  let draft;
  try { draft = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_) { throw new Error(`${manifestFile} is missing or not JSON; build.mjs writes it`); }
  if (draft.schema !== layout.SCHEMA || !layout.VERSION_RE.test(String(draft.version))) throw new Error(`${manifestFile} is not a ${layout.SCHEMA} manifest`);
  const expected = layout.expectedFiles(draft.version);

  const installerKey = layout.installerPublicKey(fs.readFileSync(path.join(dir, layout.INSTALLER), 'utf8'));
  if (installerKey !== pub.line) throw new Error(`install.sh embeds ${installerKey ? sshsig.parsePublicLine(installerKey).fingerprint : 'no key'}, but the signing key is ${pub.fingerprint}; rebuild with this key`);
  fs.writeFileSync(path.join(dir, layout.PUB), pub.line + '\n');

  const allowed = new Set([...expected.keys(), layout.SUMS, layout.SIG, layout.MANIFEST]);
  const unknown = layout.listDir(dir).filter(name => !allowed.has(name));
  if (unknown.length) throw new Error(`unknown files in ${dir}: ${unknown.join(', ')}`);
  const missing = [...expected.keys()].filter(name => !fs.existsSync(path.join(dir, name)));
  if (missing.length) throw new Error(`missing release files: ${missing.join(', ')}`);

  const files = [...expected.entries()].map(([name, meta]) => {
    const bytes = fs.readFileSync(path.join(dir, name));
    return { name, kind: meta.kind, os: meta.os, arch: meta.arch, sha256: layout.sha256(bytes), size: bytes.length };
  }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const sumsFile = path.join(dir, layout.SUMS);
  fs.writeFileSync(sumsFile, layout.formatSums(files));
  const signature = signSums(keyFile, parsed, sumsFile);
  sshsig.verify(fs.readFileSync(sumsFile), signature, pub);
  fs.writeFileSync(path.join(dir, layout.SIG), signature);

  const manifest = {
    schema: layout.SCHEMA, version: draft.version, commit: draft.commit, sourceDateEpoch: draft.sourceDateEpoch,
    ...(draft.dirty ? { dirty: true } : {}),
    node: draft.node,
    files,
    checksums: { file: layout.SUMS, sha256: layout.sha256File(sumsFile) },
    signature: { file: layout.SIG, scheme: 'sshsig-ed25519', namespace: sshsig.NAMESPACE, publicKey: `ssh-ed25519 ${pub.blob.toString('base64')}`, fingerprint: pub.fingerprint },
  };
  layout.writeJson(manifestFile, manifest);
  return { fingerprint: pub.fingerprint, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const testDir = arg(args, '--generate-test-key');
    if (testDir) {
      const made = generateTestKey(testDir);
      process.stdout.write(`Test key written: ${made.file} (0600) and ${made.publicFile}\nFingerprint: ${made.fingerprint}\nThis is a TEST key. It must never sign a published release.\n`);
    } else {
      const keyFile = arg(args, '--key');
      const dir = arg(args, '--dir');
      if (!keyFile || !dir) fail('usage: sign.mjs --key <private key> --dir <release dir> | --generate-test-key <dir outside the repo>');
      const result = signRelease({ keyFile, dir: path.resolve(dir) });
      process.stdout.write(`Signed ${result.files} files in ${path.resolve(dir)} with ${result.fingerprint}\n`);
    }
  } catch (error) { fail(error.message); }
}
