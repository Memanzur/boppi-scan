/**
 * Ed25519 keys and OpenSSH signatures (PROTOCOL.sshsig) with node:crypto only.
 *
 * Release signatures use the SSHSIG format so that install.sh can check them
 * with `ssh-keygen -Y verify`, which ships with macOS and Linux (macOS's
 * LibreSSL cannot verify Ed25519). Keys are stored in the OpenSSH formats:
 * "ssh-ed25519 AAAA... comment" public lines and unencrypted
 * "OPENSSH PRIVATE KEY" files, so ssh-keygen reads keys made here and this
 * module reads keys made by `ssh-keygen -t ed25519 -N ''`.
 */
import crypto from 'node:crypto';

export const NAMESPACE = 'boppi-release';
const MAGIC = Buffer.from('SSHSIG');
const KEY_TYPE = 'ssh-ed25519';

// SSH wire encoding: uint32 big-endian lengths before strings.
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function str(value) { const b = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'); return Buffer.concat([u32(b.length), b]); }

class Reader {
  constructor(buf) { this.buf = buf; this.at = 0; }
  take(n) {
    if (n < 0 || this.at + n > this.buf.length) throw new Error('truncated SSH data');
    const out = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  u32() { return this.take(4).readUInt32BE(0); }
  str() { return this.take(this.u32()); }
  done() { return this.at === this.buf.length; }
}

function armor(label, bytes) {
  const lines = bytes.toString('base64').match(/.{1,70}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function unarmor(label, text) {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`).exec(String(text));
  if (!match) throw new Error(`not an armored ${label}`);
  const body = match[1].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) throw new Error(`${label} is not valid base64`);
  return Buffer.from(body, 'base64');
}

/** The SSH wire blob of an Ed25519 public key (string "ssh-ed25519", string 32 bytes). */
export function publicBlob(raw32) { return Buffer.concat([str(KEY_TYPE), str(raw32)]); }

function rawFromBlob(blob) {
  const r = new Reader(blob);
  if (r.str().toString() !== KEY_TYPE) throw new Error('not an ssh-ed25519 key');
  const raw = r.str();
  if (raw.length !== 32 || !r.done()) throw new Error('malformed ssh-ed25519 key');
  return Buffer.from(raw);
}

/** "SHA256:<base64 without padding>", exactly as ssh-keygen -lf prints it. */
export function fingerprintOfBlob(blob) { return `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`; }

/** Parse "ssh-ed25519 AAAA... [comment]". Returns { raw, blob, line, fingerprint, keyObject }. */
export function parsePublicLine(text) {
  const parts = String(text).trim().split(/\s+/);
  if (parts[0] !== KEY_TYPE || !parts[1]) throw new Error('expected an "ssh-ed25519 AAAA..." public key line');
  const blob = Buffer.from(parts[1], 'base64');
  const raw = rawFromBlob(blob);
  return publicFromRaw(raw);
}

export function publicFromRaw(raw) {
  const blob = publicBlob(raw);
  const keyObject = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  return { raw, blob, line: `${KEY_TYPE} ${blob.toString('base64')} ${NAMESPACE}`, fingerprint: fingerprintOfBlob(blob), keyObject };
}

/** A fresh key pair as file contents: { privateText, publicLine, fingerprint }. */
export function generateKey(comment = NAMESPACE) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d, 'base64url');
  const raw = Buffer.from(jwk.x, 'base64url');
  const pub = publicFromRaw(raw);
  const check = crypto.randomBytes(4);
  let section = Buffer.concat([check, check, str(KEY_TYPE), str(raw), str(Buffer.concat([seed, raw])), str(comment)]);
  const pad = [];
  for (let i = 1; (section.length + pad.length) % 8 !== 0; i++) pad.push(i);
  section = Buffer.concat([section, Buffer.from(pad)]);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0'), str('none'), str('none'), str(''), u32(1), str(pub.blob), str(section)]);
  return { privateText: armor('OPENSSH PRIVATE KEY', body), publicLine: pub.line, fingerprint: pub.fingerprint };
}

/**
 * Read an OpenSSH Ed25519 private key file. Returns { encrypted: true } for a
 * passphrase-protected key (sign.mjs hands those to ssh-keygen), otherwise
 * { encrypted: false, privateKey, publicKey: parsePublicLine-shaped }.
 */
export function parsePrivateKey(text) {
  const body = unarmor('OPENSSH PRIVATE KEY', text);
  const magic = Buffer.from('openssh-key-v1\0');
  if (!body.subarray(0, magic.length).equals(magic)) throw new Error('not an openssh-key-v1 private key');
  const r = new Reader(body.subarray(magic.length));
  const cipher = r.str().toString();
  r.str(); r.str();
  if (r.u32() !== 1) throw new Error('expected exactly one key in the private key file');
  const pubBlob = r.str();
  const raw = rawFromBlob(pubBlob);
  if (cipher !== 'none') return { encrypted: true, publicKey: publicFromRaw(raw) };
  const s = new Reader(r.str());
  if (!s.take(4).equals(s.take(4))) throw new Error('private key check bytes differ (corrupt file)');
  if (s.str().toString() !== KEY_TYPE) throw new Error('not an ssh-ed25519 private key');
  if (!s.str().equals(raw)) throw new Error('private key public half does not match');
  const both = s.str();
  if (both.length !== 64 || !both.subarray(32).equals(raw)) throw new Error('malformed ssh-ed25519 private key');
  const privateKey = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: both.subarray(0, 32).toString('base64url'), x: raw.toString('base64url') }, format: 'jwk' });
  return { encrypted: false, privateKey, publicKey: publicFromRaw(raw) };
}

function signedData(namespace, hashAlg, message) {
  const digest = crypto.createHash(hashAlg).update(message).digest();
  return Buffer.concat([MAGIC, str(namespace), str(''), str(hashAlg), str(digest)]);
}

/** Armored SSHSIG signature of `message` (Buffer). Deterministic: Ed25519 has no random nonce. */
export function sign(message, privateKey, publicKey, namespace = NAMESPACE) {
  const sig = crypto.sign(null, signedData(namespace, 'sha512', message), privateKey);
  const blob = Buffer.concat([MAGIC, u32(1), str(publicKey.blob), str(namespace), str(''), str('sha512'), str(Buffer.concat([str(KEY_TYPE), str(sig)]))]);
  return armor('SSH SIGNATURE', blob);
}

/**
 * Verify an armored SSHSIG over `message` against `expected` (a parsed public
 * key; never the key inside the signature on its own). Throws with the reason
 * on any mismatch; returns { fingerprint } on success.
 */
export function verify(message, armored, expected, namespace = NAMESPACE) {
  const r = new Reader(unarmor('SSH SIGNATURE', armored));
  if (!r.take(6).equals(MAGIC)) throw new Error('signature: not an SSHSIG blob');
  if (r.u32() !== 1) throw new Error('signature: unsupported SSHSIG version');
  const keyBlob = r.str();
  const ns = r.str().toString();
  r.str();
  const hashAlg = r.str().toString();
  const sigBlob = new Reader(r.str());
  if (!r.done()) throw new Error('signature: trailing data');
  if (!keyBlob.equals(expected.blob)) throw new Error(`signature: made by ${fingerprintOfBlob(keyBlob)}, expected ${expected.fingerprint}`);
  if (ns !== namespace) throw new Error(`signature: namespace "${ns}", expected "${namespace}"`);
  if (hashAlg !== 'sha512' && hashAlg !== 'sha256') throw new Error(`signature: hash algorithm ${hashAlg} not allowed`);
  if (sigBlob.str().toString() !== KEY_TYPE) throw new Error('signature: not ssh-ed25519');
  const sig = sigBlob.str();
  if (sig.length !== 64 || !sigBlob.done()) throw new Error('signature: malformed Ed25519 signature');
  if (!crypto.verify(null, signedData(ns, hashAlg, message), expected.keyObject, sig)) throw new Error('signature: does not verify (the file or the signature was changed)');
  return { fingerprint: expected.fingerprint };
}
