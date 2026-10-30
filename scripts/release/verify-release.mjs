#!/usr/bin/env node
/**
 * Verify a release directory before anyone hosts or installs it.
 *
 *   node scripts/release/verify-release.mjs --dir <release dir> --pub <boppi-release.pub you trust>
 *   node scripts/release/verify-release.mjs --dir <release dir> --fingerprint SHA256:...
 *
 * Checks, in order: the expected key (from --pub, or the key in the directory
 * only when its fingerprint equals --fingerprint), the SSHSIG signature over
 * SHA256SUMS with namespace boppi-release, every file against SHA256SUMS, no
 * file present that is not listed (and nothing listed that is absent), and
 * release.json against all of it. The key shipped in the same directory is
 * never trusted on its own; --trust-shipped-key does that explicitly and
 * prints that the result proves integrity only, not origin.
 * Exit 0 when everything holds; exit 1 with the first reason otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sshsig from './sshsig.mjs';
import * as layout from './layout.mjs';

function check(condition, message) { if (!condition) throw new Error(message); }

export function verifyRelease({ dir, pubText = null, fingerprint = null, trustShipped = false }) {
  const read = name => fs.readFileSync(path.join(dir, name));
  const exists = name => fs.existsSync(path.join(dir, name));
  check(exists(layout.SUMS), `${layout.SUMS} is missing`);
  check(exists(layout.SIG), `${layout.SIG} is missing`);
  check(exists(layout.MANIFEST), `${layout.MANIFEST} is missing`);

  let expected;
  if (pubText) expected = sshsig.parsePublicLine(pubText);
  else if (fingerprint || trustShipped) {
    check(exists(layout.PUB), `${layout.PUB} is missing`);
    expected = sshsig.parsePublicLine(read(layout.PUB).toString('utf8'));
    if (fingerprint) check(expected.fingerprint === fingerprint, `the key in ${layout.PUB} is ${expected.fingerprint}, expected ${fingerprint}`);
  } else throw new Error('name the trusted key with --pub <file> or --fingerprint SHA256:... (the key inside the release directory is not trusted on its own)');

  const sumsBytes = read(layout.SUMS);
  sshsig.verify(sumsBytes, read(layout.SIG).toString('utf8'), expected);
  const sums = layout.parseSums(sumsBytes.toString('utf8'));

  let manifest;
  try { manifest = JSON.parse(read(layout.MANIFEST).toString('utf8')); } catch (_) { throw new Error(`${layout.MANIFEST} is not JSON`); }
  check(manifest.schema === layout.SCHEMA, `${layout.MANIFEST}: schema is not ${layout.SCHEMA}`);
  check(layout.VERSION_RE.test(String(manifest.version)), `${layout.MANIFEST}: bad version`);
  check(/^[0-9a-f]{40}$/.test(String(manifest.commit)), `${layout.MANIFEST}: commit is not a 40-hex git commit`);
  check(Number.isInteger(manifest.sourceDateEpoch) && manifest.sourceDateEpoch > 0, `${layout.MANIFEST}: bad sourceDateEpoch`);
  check(manifest.node && typeof manifest.node.version === 'string' && manifest.node.runtimes && typeof manifest.node.runtimes === 'object', `${layout.MANIFEST}: node block missing`);

  const want = layout.expectedFiles(manifest.version);
  const listed = [...sums.keys()].sort();
  check(JSON.stringify(listed) === JSON.stringify([...want.keys()].sort()), `${layout.SUMS} lists ${listed.join(', ')}; a ${manifest.version} release has exactly ${[...want.keys()].sort().join(', ')}`);
  const allowed = new Set([...sums.keys(), layout.SUMS, layout.SIG, layout.MANIFEST]);
  const unlisted = layout.listDir(dir).filter(name => !allowed.has(name));
  check(unlisted.length === 0, `files not covered by the signature: ${unlisted.join(', ')}`);

  for (const [name, hash] of sums) {
    check(exists(name), `${name} is listed in ${layout.SUMS} but missing`);
    const actual = layout.sha256(read(name));
    check(actual === hash, `${name}: sha256 ${actual} does not match ${layout.SUMS} (${hash})`);
  }

  check(Array.isArray(manifest.files) && manifest.files.length === sums.size, `${layout.MANIFEST}: files does not list exactly the ${sums.size} signed files`);
  for (const entry of manifest.files) {
    const meta = want.get(entry.name);
    check(meta && sums.get(entry.name) === entry.sha256, `${layout.MANIFEST}: ${entry.name} does not match ${layout.SUMS}`);
    check(entry.kind === meta.kind && entry.os === meta.os && entry.arch === meta.arch, `${layout.MANIFEST}: ${entry.name} has the wrong kind/os/arch`);
    check(entry.size === fs.statSync(path.join(dir, entry.name)).size, `${layout.MANIFEST}: ${entry.name} size differs`);
  }
  check(manifest.checksums && manifest.checksums.file === layout.SUMS && manifest.checksums.sha256 === layout.sha256(sumsBytes), `${layout.MANIFEST}: checksums block does not match ${layout.SUMS}`);
  const sig = manifest.signature || {};
  check(sig.file === layout.SIG && sig.scheme === 'sshsig-ed25519' && sig.namespace === sshsig.NAMESPACE, `${layout.MANIFEST}: signature block has the wrong file, scheme or namespace`);
  check(sig.fingerprint === expected.fingerprint, `${layout.MANIFEST}: signature fingerprint ${sig.fingerprint} is not the trusted key ${expected.fingerprint}`);
  check(sshsig.parsePublicLine(String(sig.publicKey)).fingerprint === expected.fingerprint, `${layout.MANIFEST}: signature publicKey is not the trusted key`);
  check(sshsig.parsePublicLine(read(layout.PUB).toString('utf8')).fingerprint === expected.fingerprint, `${layout.PUB} is not the trusted key`);
  check(layout.installerPublicKey(read(layout.INSTALLER).toString('utf8')) === `ssh-ed25519 ${expected.blob.toString('base64')} boppi-release`, `${layout.INSTALLER} does not embed the trusted key`);
  return { version: manifest.version, commit: manifest.commit, fingerprint: expected.fingerprint, files: sums.size, dirty: Boolean(manifest.dirty) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  const dir = value('--dir');
  const pubFile = value('--pub');
  try {
    if (!dir) throw new Error('usage: verify-release.mjs --dir <release dir> (--pub <file> | --fingerprint SHA256:...)');
    const trustShipped = args.includes('--trust-shipped-key');
    const result = verifyRelease({ dir: path.resolve(dir), pubText: pubFile ? fs.readFileSync(pubFile, 'utf8') : null, fingerprint: value('--fingerprint'), trustShipped });
    if (trustShipped && !pubFile && !value('--fingerprint')) process.stderr.write('verify-release: WARNING: trusted the key shipped in the same directory; this proves the files match each other, not who made them.\n');
    if (result.dirty) process.stderr.write('verify-release: WARNING: this release was built from a dirty tree (--allow-dirty); never host it.\n');
    process.stdout.write(`OK: boppi ${result.version} (commit ${result.commit}), ${result.files} files, signed by ${result.fingerprint}\n`);
  } catch (error) {
    process.stderr.write(`verify-release: FAILED: ${error.message}\n`);
    process.exit(1);
  }
}
