/**
 * boppi connect: dashboard-requested fixes. The connector pairs this machine
 * with one workspace, then pulls: it offers the removals the local plan
 * would make, narrowings of a broad folder argument to the project folder it
 * runs from, and intact backups it can restore (hashes, fingerprints, key
 * names, counts, versions; never a path, a file's contents or a preview),
 * reports previews for proposals the dashboard built from those offers,
 * and applies an approved removal, narrowing or rollback only after showing
 * the exact sanitized preview here and getting local confirmation. The workspace never pushes a command; every write goes
 * through the fix.js primitives with a backup and a manifest entry, and the
 * workspace grades the result from a rescan, not from the acknowledgement.
 * An applied proposal the workspace has not graded yet comes back on every
 * poll until a rescan from this machine's current scan grades it.
 *
 * Local state, all under <home>/.boppi, mode 0600 on POSIX (Windows: the profile folder's ACL):
 *   connector.json         { url, deviceId, organizationId, credential, credentialExpiresAt, workspaceName, deviceName, pairedAt }
 *   connector-claims.json  { pending: { [proposalId]: { nonce, targetFile, client, server, claimedAt } }, consumed: [nonce] }
 *   locks/<targetFile>.lock  held while one proposal or grant writes that file
 *   jit-leases.json        just-in-time grant leases (jit.js)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const models = require('../engine/models');
const riskRubric = require('../engine/riskRubric');
const scanner = require('../engine/localMcpScanner');
const fix = require('./fix');
const fingerprint = require('./fingerprint');
const remediate = require('./remediate');
const narrowPlan = require('./narrowPlan');
const evidenceIdentity = require('./evidenceIdentity');
const { ownerOnlyNote, parseJson, renameRetry } = require('./platform');
const updateNotice = require('./updateNotice');
const agentRequest = require('./agentRequest');
const { homeFlag } = require('./shell');
const jit = require('./jit');
const { openRegular, acquireLock } = fix;

const SCHEMA_VERSION = 1;
const ROUTES = Object.freeze({ pair: '/api/connector/pair', poll: '/api/connector/poll', preview: '/api/connector/preview', claim: '/api/connector/claim', applied: '/api/connector/applied', rescan: '/api/connector/rescan', rotate: '/api/connector/rotate', unpair: '/api/connector/unpair', 'jit/poll': '/api/connector/jit/poll', 'jit/claim': '/api/connector/jit/claim', 'jit/applied': '/api/connector/jit/applied', 'jit/revoked': '/api/connector/jit/revoked' });
const SUBCOMMANDS = Object.freeze(['pair', 'status', 'unpair', 'run', 'rotate', 'revert-grants']);
// connect run rotates the device credential once it has this long left.
const ROTATE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const OFFER_MAX = 64;
const CONSUMED_MAX = 256;
const HEX64 = /^[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{8,128}$/;
const EMPTY_HASH = fix.sha256(Buffer.alloc(0));
const WAITING = "reported, awaiting the workspace's rescan grade";

const clip = (value, max) => String(value).slice(0, max);
const stamp = () => new Date().toISOString();

function versionsOf(scannerVersion) { return { scanner: clip(scannerVersion, 32), engine: models.ENGINE_VERSION, rubric: riskRubric.RUBRIC_VERSION }; }

/** The workspace origin. https, or http only to this machine; no credentials, no path. */
function resolveWorkspaceUrl(input) {
  let url;
  try { url = new URL(input); } catch (_) { throw new Error(`the workspace URL is not a valid URL: ${input}`); }
  if (url.username || url.password) throw new Error('the workspace URL must not contain credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) throw new Error('the workspace URL must use https (http is allowed only for localhost)');
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash) throw new Error('the workspace URL must be the workspace origin, with no path');
  return url.origin;
}

function pairingFile(home) { return path.join(home, '.boppi', 'connector.json'); }
function claimsFile(home) { return path.join(home, '.boppi', 'connector-claims.json'); }

function writeOwnerOnly(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameRetry(temp, file);
}

/**
 * The stored pairing, or null. On POSIX a connector.json that group or
 * others can read throws, as ssh refuses a loose private key, so a credential
 * other accounts could copy is not used silently. allowExposed is for
 * uninstall, which only deletes the file.
 */
function loadPairing(home, { allowExposed = false, platform = process.platform } = {}) {
  const file = pairingFile(home);
  let raw, mode;
  try { mode = fs.statSync(file).mode & 0o777; raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string' || typeof raw.credential !== 'string' || typeof raw.deviceId !== 'string') return null;
  if (platform !== 'win32' && (mode & 0o077) && !allowExposed) {
    throw new Error(`refusing ${file}: other accounts on this machine can read it (mode ${mode.toString(8)}). Run chmod 600 "${file}", then boppi connect rotate if anyone else could have copied the credential.`);
  }
  return raw;
}

function loadClaims(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(claimsFile(home), 'utf8'));
    if (raw && typeof raw.pending === 'object' && Array.isArray(raw.consumed)) return { schemaVersion: SCHEMA_VERSION, pending: raw.pending, consumed: raw.consumed };
  } catch (_) { /* none yet */ }
  return { schemaVersion: SCHEMA_VERSION, pending: {}, consumed: [] };
}

function saveClaims(home, claims) {
  claims.consumed = claims.consumed.slice(-CONSUMED_MAX);
  writeOwnerOnly(claimsFile(home), claims);
}

/** One POST. Resolves to { ok, status, body } or { ok: false, networkError }. */
async function request({ url, credential, route, body, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('this Node version has no fetch(); Node 18 or newer is required');
  let response;
  try {
    response = await fetchImpl(`${url}${ROUTES[route]}`, {
      method: 'POST',
      redirect: 'error',
      headers: agentRequest.agentHeaders(credential ? { authorization: `Bearer ${credential}` } : {}),
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, networkError: error && error.cause && error.cause.message ? error.cause.message : (error.message || String(error)) };
  }
  const parsed = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed, origin: url };
}

function describeFailure(route, result) {
  if (result.networkError) return `could not reach the workspace for ${route}: ${result.networkError}`;
  const code = result.body && result.body.error ? result.body.error : 'unknown error';
  const outdated = agentRequest.describeOutdated(result);
  if (outdated) return `the workspace refused ${route} (HTTP 426: agent_outdated): ${outdated}`;
  const wait = Number(result.body && result.body.retryAfterSeconds);
  if (result.status === 429) return `the workspace refused ${route} (HTTP 429: ${code}): this device made too many calls; retry in ${Number.isInteger(wait) && wait > 0 ? `${wait} seconds` : 'a few minutes'}. boppi does not retry on its own`;
  if (result.status === 401 && route === 'pair') return `the workspace refused the pairing code (HTTP 401: ${code}): it is wrong, already used, or older than ten minutes. Create a new code on the Collectors page and run boppi connect pair again`;
  if (result.status === 401) return `the workspace no longer accepts this device (HTTP 401: ${code}): it was revoked or unpaired there, or its credential expired. Pair again: create a code on the Collectors page, then boppi connect pair --url <workspace> --code <code>`;
  return `the workspace refused ${route} (HTTP ${result.status}: ${code})`;
}

/**
 * Open a config file without following a symlink and read it once. The
 * hash, the preview and the write all come from these bytes.
 */

function previewHashOf(text) { return fix.sha256(Buffer.from(text, 'utf8')); }

/** A removal target, or with candidate (narrowPlan.candidateFor) a narrow target, as the connector sees it: the local file plus what the cloud may know about it. */
function describeTarget({ options, scan, client, located, server, candidate = null }) {
  const file = located.file;
  const opened = openRegular(file);
  const narrow = candidate ? { index: candidate.index, from: candidate.from, to: candidate.to } : null;
  const base = { client: client.clientKey, project: scanner.pathFingerprint(path.resolve(options.cwd)), targetFile: scanner.pathFingerprint(file), server, file, located, ...(candidate ? { action: 'narrow_scope', candidate, narrow } : {}), ...opened };
  if (!opened.regularFile) return { ...base, configHash: EMPTY_HASH, previewHash: EMPTY_HASH };
  let preview;
  try {
    const recordsByName = new Map(scan.inventory.mcpServers.filter(s => s.agentId === client.agentId).map(s => [s.name, s]));
    preview = remediate.previewEdit({ located, serverName: server, cwd: options.cwd, recordsByName, bytes: opened.bytes, narrow });
  } catch (_) { return { ...base, regularFile: false, failureCode: 'other', configHash: EMPTY_HASH, previewHash: EMPTY_HASH }; }
  const previewText = remediate.renderPreview(preview);
  return { ...base, serverRecord: scan.inventory.mcpServers.find(s => s.agentId === client.agentId && s.name === server), preview, previewText, configHash: fix.sha256(opened.bytes), previewHash: previewHashOf(previewText) };
}

/** Every remove_server candidate the local plan predicts to close at least one path, then every narrow candidate toward this project folder, with its file. */
function localTargets(scan, options) {
  const descriptors = fix.descriptorsFor(options);
  const out = [];
  for (const client of scan.discovery.clients) {
    if (!client.agentId || client.scanError || !client.primaryPath) continue;
    const descriptor = descriptors.find(d => d.clientKey === client.clientKey);
    if (!descriptor) continue;
    for (const prediction of scan.predictions) {
      if (prediction.client.key !== client.clientKey || prediction.edit.action !== 'remove_server' || !prediction.predictedEliminated.length) continue;
      const located = fix.locateServer(descriptor, prediction.edit.server, options.cwd);
      if (!located) continue;
      const target = describeTarget({ options, scan, client, located, server: prediction.edit.server });
      if (target.regularFile) out.push({ ...target, prediction });
    }
  }
  for (const candidate of narrowPlan.candidates(scan, options)) {
    const target = describeTarget({ options, scan, client: candidate.client, located: candidate.located, server: candidate.server, candidate });
    if (target.regularFile) out.push({ ...target, prediction: candidate.prediction });
  }
  return out;
}

/** Priorities a narrow lowers, as predict.js names them, capped like every offer list. */
function loweredFields(lowered) { return lowered.slice(0, 64).map(step => ({ exposureKey: clip(step.exposureKey, 160), from: step.from, to: step.to })); }

function toOffer(target, scannerVersion, computedAt) {
  if (target.action === 'narrow_scope') {
    return {
      action: 'narrow_scope', client: target.client, project: target.project, targetFile: target.targetFile, server: clip(target.server, 128),
      configHash: target.configHash, previewHash: target.previewHash,
      argIndex: target.narrow.index, narrowFrom: target.candidate.edit.from, expectedIdentity: target.candidate.edit.expectedIdentity,
      expectedExposureKeys: target.prediction.predictedEliminated.slice(0, 64).map(key => clip(key, 160)),
      expectedLowered: loweredFields(target.prediction.predictedLowered || []),
      capabilityLoss: [],
      versions: versionsOf(scannerVersion), computedAt,
    };
  }
  return {
    client: target.client, project: target.project, targetFile: target.targetFile, server: clip(target.server, 128),
    configHash: target.configHash, previewHash: target.previewHash,
    ...(target.action === 'rollback' ? { action: 'rollback', backupManifestId: target.entry.id } : {}),
    expectedExposureKeys: target.action === 'rollback' ? [] : target.prediction.predictedEliminated.slice(0, 64).map(key => clip(key, 160)),
    capabilityLoss: target.action === 'rollback' ? [] : (target.prediction.disruption ? target.prediction.disruption.lost : []).slice(0, 32).map(c => clip(c, 64)),
    versions: versionsOf(scannerVersion), computedAt,
  };
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const sameLowered = (a, b) => Array.isArray(a) && Array.isArray(b) && sameList(a.map(step => JSON.stringify([step && step.exposureKey, step && step.from, step && step.to])), b.map(step => JSON.stringify([step && step.exposureKey, step && step.from, step && step.to])));

/**
 * Whether a proposal binding is exactly one of this run's offers: same
 * action, client, project, file, entry, hashes, rollback manifest, and the
 * same expected paths and capability loss the confirmation will print. The
 * device executes nothing else, whatever the workspace sends.
 */
function offerMatches(offer, binding) {
  const action = binding.action;
  if (action !== 'rollback' && action !== 'remove_server' && action !== 'narrow_scope') return false;
  if ((offer.action || 'remove_server') !== action) return false;
  for (const key of ['client', 'project', 'targetFile', 'server', 'configHash', 'previewHash']) if (offer[key] !== binding[key]) return false;
  if (action === 'rollback') return offer.backupManifestId === binding.backupManifestId;
  if (action === 'narrow_scope' && !(offer.argIndex === binding.argIndex && offer.narrowFrom === binding.narrowFrom && offer.expectedIdentity === binding.expectedIdentity && sameLowered(offer.expectedLowered, binding.expectedLowered))) return false;
  return sameList(offer.expectedExposureKeys, binding.expectedExposureKeys) && sameList(offer.capabilityLoss, binding.capabilityLoss || []);
}

/**
 * The local file a binding's target fingerprint names, among the files a scan with these options reads, or null.
 * A binding from before the upgrade to HMAC fingerprints names it in the legacy form; `format` says which.
 */
function fileForBinding(options, binding) {
  for (const descriptor of fix.descriptorsFor(options)) {
    if (descriptor.clientKey !== binding.client) continue;
    for (const file of descriptor.files) {
      const resolved = path.resolve(file.path);
      const format = fingerprint.formatOf(binding.targetFile, resolved);
      if (format) return { file: resolved, scope: file.scope, format };
    }
  }
  return null;
}

/** The entry a removal binding names, read from the files as they are now, or null when its label no longer resolves inside the bound file. */
function locateBinding(options, binding) {
  const descriptor = fix.descriptorsFor(options).find(d => d.clientKey === binding.client);
  const located = descriptor ? fix.locateServer(descriptor, binding.server, options.cwd) : null;
  return located && fingerprint.formatOf(binding.targetFile, located.file) ? located : null;
}

/** Recompute a proposal's target from the file as it is now. A target with no local file reports as missing. */
function targetForBinding(options, scan, binding) {
  if (binding.action === 'rollback') return rollbackTarget(options, scan, binding);
  const located = locateBinding(options, binding);
  const client = scan.discovery.clients.find(c => c.clientKey === binding.client);
  if (!located || !client) return { client: binding.client, project: binding.project, targetFile: binding.targetFile, server: binding.server, file: null, regularFile: false, failureCode: 'file_missing', configHash: EMPTY_HASH, previewHash: EMPTY_HASH };
  if (binding.action !== 'narrow_scope') return describeTarget({ options, scan, client, located, server: binding.server });
  // A narrow is recomputed from the file and the project folder as they are now. Its preview names the argument and both folders by fingerprint, so any drift changes the preview hash; with no candidate the preview is a removal's, which never matches.
  return describeTarget({ options, scan, client, located, server: binding.server, candidate: narrowPlan.candidateFor(scan, options, client, binding.server) });
}

/** Only a connector removal in the current scan scope can be restored. */
function rollbackTarget(options, scan, binding) {
  const missing = { client: binding.client, project: binding.project, targetFile: binding.targetFile, server: binding.server, file: null, regularFile: false, failureCode: 'backup_failed', configHash: EMPTY_HASH, previewHash: EMPTY_HASH };
  const entries = fix.readManifest(options.home).entries;
  const entry = entries.find(e => e.id === binding.backupManifestId && fix.FIX_ACTIONS.includes(e.action) && e.proposalId);
  const found = fileForBinding(options, binding);
  if (!entry || !found || entry.original !== found.file || entry.clientKey !== binding.client || entry.server !== binding.server
    || fingerprint.formatOf(binding.project, path.resolve(options.cwd)) !== found.format || (entry.project && entry.project !== binding.project)
    || entries.some(e => e.restoredFrom === entry.id)) return missing;
  const opened = openRegular(found.file);
  if (!opened.regularFile) return { ...missing, file: found.file, failureCode: opened.failureCode };
  const configHash = fix.sha256(opened.bytes);
  const base = { ...missing, file: found.file, configHash };
  if (configHash !== entry.appliedHash) return { ...base, failureCode: 'hash_changed' };
  const backup = openRegular(entry.backup);
  if (!backup.regularFile || fix.sha256(backup.bytes) !== entry.backupHash) return base;
  try {
    const client = scan.discovery.clients.find(c => c.clientKey === binding.client);
    const recordsByName = new Map(scan.inventory.mcpServers.filter(s => client && s.agentId === client.agentId).map(s => [s.name, s]));
    // Label the backup's entries as the scan did before the removal, then restore exactly the entry that was removed.
    const descriptor = fix.descriptorsFor(options).find(d => d.clientKey === binding.client);
    const located = descriptor && fix.locateServer(descriptor, entry.server, options.cwd, new Map([[found.file, JSON.parse(backup.bytes.toString('utf8'))]]));
    if (!located || located.file !== found.file || (entry.keyPath && JSON.stringify(located.keyPath) !== JSON.stringify(entry.keyPath))) return base;
    const narrow = entry.action === 'narrow_scope' ? narrowBack(located, entry, opened.bytes, recordsByName) : null;
    if (entry.action === 'narrow_scope' && !narrow) return base;
    const preview = remediate.previewEdit({ located, serverName: entry.server, cwd: options.cwd, recordsByName, bytes: backup.bytes, narrow });
    // Reverse both the operation signs and the old/new hunk coordinates, then keep removed lines ahead of added ones in each run of changes.
    preview.diff = reorderChanges(preview.diff.map(line => line.startsWith('@@ ')
      ? line.replace(/^@@ -(\d+,\d+) \+(\d+,\d+) @@$/, '@@ -$2 +$1 @@')
      : line.startsWith('-') ? `+${line.slice(1)}` : line.startsWith('+') ? `-${line.slice(1)}` : line));
    const previewText = `  restore ${JSON.stringify(entry.server)} from the verified local backup\n${remediate.renderPreview(preview)}`;
    return { ...base, ...opened, action: 'rollback', entry, backupBytes: backup.bytes, preview, previewText, previewHash: previewHashOf(previewText) };
  } catch (_) { return base; }
}

function reorderChanges(lines) {
  const out = [];
  let run = [];
  const flush = () => { out.push(...run.filter(l => l.startsWith('-')), ...run.filter(l => l.startsWith('+'))); run = []; };
  for (const line of lines) {
    if (/^[-+]/.test(line)) run.push(line);
    else { flush(); out.push(line); }
  }
  flush();
  return out;
}

/**
 * The narrow a restore undoes, as previewEdit reads it from the backup: the
 * backed-up argument becomes the one the file holds now. The server's record
 * is shown with the backed-up arguments, since the scan saw the narrowed ones.
 */
function narrowBack(located, entry, currentBytes, recordsByName) {
  const backed = fix.objectAt(located.json, located.keyPath.slice(0, -1));
  const now = fix.objectAt(JSON.parse(currentBytes.toString('utf8')), located.keyPath.slice(0, -1));
  const before = backed && backed[located.name], after = now && now[located.name];
  const index = entry.argIndex;
  if (!before || !after || !Array.isArray(before.args) || !Array.isArray(after.args) || typeof before.args[index] !== 'string' || typeof after.args[index] !== 'string') return null;
  const record = recordsByName.get(entry.server);
  if (record) recordsByName.set(entry.server, { ...record, arguments: scanner.sanitizeArguments(before.args) });
  return { index, from: before.args[index], to: after.args[index] };
}

/** Rollback offers. A fix recorded before the upgrade to HMAC fingerprints is offered in the legacy form its workspace proposal was bound with. */
function rollbackTargets(scan, options) {
  const cwd = path.resolve(options.cwd);
  return fix.readManifest(options.home).entries.filter(e => fix.FIX_ACTIONS.includes(e.action) && e.proposalId).map(entry => {
    const format = fingerprint.formatOf(entry.project, cwd) || 'current';
    return rollbackTarget(options, scan, {
      client: entry.clientKey, project: fingerprint.inFormat(format, cwd), targetFile: fingerprint.inFormat(format, entry.original), server: entry.server, backupManifestId: entry.id,
    });
  }).filter(target => target.regularFile);
}


/** Take the per-file lock, or null when another live process holds it. A lock left by a dead process is cleared. */

/**
 * Write one approved removal or narrow: lock the file, reopen it without
 * following a symlink, compare its hash (and for a narrow, the narrow
 * recomputed now and its preview) with the binding at the write boundary,
 * back it up, replace it atomically, validate, record the manifest entry.
 * The edit and its check are the ones boppi fix makes (remediate.editedJson,
 * validateEdited). Returns what the applied report needs; a failure names
 * one fixed code and leaves the file as it was.
 */
function applyEdit({ options, scan, binding, proposalId, now }) {
  const release = acquireLock(options.home, binding.targetFile);
  if (!release) return { ok: false, failureCode: 'lock_busy', hashAtWrite: EMPTY_HASH, regularFile: false };
  try {
    const narrowing = binding.action === 'narrow_scope';
    const target = narrowing ? targetForBinding(options, scan, binding) : null;
    const found = narrowing ? (target.file ? target.located : null) : locateBinding(options, binding);
    if (!found) return { ok: false, failureCode: 'file_missing', hashAtWrite: EMPTY_HASH, regularFile: false };
    const opened = openRegular(found.file);
    if (!opened.regularFile) return { ok: false, failureCode: opened.failureCode, hashAtWrite: EMPTY_HASH, regularFile: false };
    const hashAtWrite = fix.sha256(opened.bytes);
    const report = { hashAtWrite, regularFile: true };
    if (hashAtWrite !== binding.configHash) return { ok: false, failureCode: 'hash_changed', ...report };
    if (narrowing && (!target.narrow || target.configHash !== hashAtWrite || target.previewHash !== binding.previewHash)) return { ok: false, failureCode: 'hash_changed', ...report };
    let edited;
    try { edited = remediate.editedJson(parseJson(opened.bytes), found.keyPath, narrowing ? target.narrow : null); } catch (_) { return { ok: false, failureCode: 'other', ...report }; }
    if (!edited) return { ok: false, failureCode: 'other', ...report };
    let backup;
    try { backup = fix.writeBackup({ file: found.file, home: options.home, now, bytes: opened.bytes }); } catch (_) { return { ok: false, failureCode: 'backup_failed', ...report }; }
    const text = JSON.stringify(edited, null, 2) + '\n';
    try { fix.writeAtomic(found.file, text, opened.mode); } catch (error) {
      fs.rmSync(backup, { force: true });
      return { ok: false, failureCode: error.code === 'EACCES' || error.code === 'EPERM' ? 'permission_denied' : 'other', ...report };
    }
    const written = fs.readFileSync(found.file);
    const problem = remediate.validateEdited({ bytes: written, expected: edited, keyPath: found.keyPath, removed: !narrowing });
    if (problem) {
      fix.writeAtomic(found.file, opened.bytes, opened.mode);
      fs.rmSync(backup, { force: true });
      return { ok: false, failureCode: 'validation_failed', ...report };
    }
    const appliedHash = fix.sha256(written);
    let entry;
    try {
      entry = fix.appendManifestEntry(options.home, { createdAt: stamp(), backup, original: found.file, clientKey: binding.client, server: binding.server, keyPath: found.keyPath, project: binding.project, action: narrowing ? 'narrow_scope' : 'remove_server', ...(narrowing ? { argIndex: target.narrow.index } : {}), scanExport: null, backupHash: hashAtWrite, appliedHash, proposalId });
    } catch (_) {
      fix.writeAtomic(found.file, opened.bytes, opened.mode);
      fs.rmSync(backup, { force: true });
      return { ok: false, failureCode: 'other', ...report };
    }
    return { ok: true, appliedHash, backupManifestId: entry.id, backup, ...report };
  } finally { release(); }
}

/** Restore only verified bytes, under the same per-file lock as removal. */
function applyRollback({ options, scan, binding, proposalId }) {
  const release = acquireLock(options.home, binding.targetFile);
  if (!release) return { ok: false, failureCode: 'lock_busy', hashAtWrite: EMPTY_HASH, regularFile: false };
  try {
    const target = rollbackTarget(options, scan, binding);
    const report = { hashAtWrite: target.configHash, regularFile: target.regularFile };
    if (!target.regularFile) return { ok: false, failureCode: target.failureCode, ...report };
    if (target.configHash !== binding.configHash || target.previewHash !== binding.previewHash) return { ok: false, failureCode: 'hash_changed', ...report };
    const appliedHash = fix.sha256(target.backupBytes);
    try { fix.writeAtomic(target.file, target.backupBytes, target.mode); } catch (error) {
      return { ok: false, failureCode: error.code === 'EACCES' || error.code === 'EPERM' ? 'permission_denied' : 'other', ...report };
    }
    const written = openRegular(target.file);
    if (!written.regularFile || fix.sha256(written.bytes) !== appliedHash) {
      fix.writeAtomic(target.file, target.bytes, target.mode);
      return { ok: false, failureCode: 'validation_failed', ...report };
    }
    let entry;
    try {
      entry = fix.appendManifestEntry(options.home, { createdAt: stamp(), action: 'rollback', restoredFrom: target.entry.id, backup: target.entry.backup, original: target.file, clientKey: binding.client, server: binding.server, project: binding.project, proposalId, backupHash: target.configHash, appliedHash });
    } catch (_) {
      fix.writeAtomic(target.file, target.bytes, target.mode);
      return { ok: false, failureCode: 'other', ...report };
    }
    return { ok: true, ...report, appliedHash, backupManifestId: entry.id, backup: entry.backup };
  } finally { release(); }
}

function manifestEntryFor(home, proposalId) { return fix.readManifest(home).entries.find(e => e.proposalId === proposalId) || null; }

/** Exposure keys the rescan shows on the agent of one client, in the agent id space of the binding, the file's hash now, and the evidence identity of the bound server's entry (null when absent). */
function rescanReport(scan, binding, options) {
  const client = scan.discovery.clients.find(c => c.clientKey === binding.client);
  const found = fileForBinding(options, binding);
  const agentId = client && (found && found.format === 'legacy' ? fingerprint.legacyAgentId(client) : client.agentId);
  const exposureKeys = agentId ? scan.paths.filter(p => p.agentId === client.agentId).map(p => clip(p.exposureKey.replace(client.agentId, agentId), 160)) : [];
  const opened = found ? openRegular(found.file) : { regularFile: false };
  const entry = client && client.mergedServers && Object.prototype.hasOwnProperty.call(client.mergedServers, binding.server) ? client.mergedServers[binding.server] : null;
  return { exposureKeys: exposureKeys.slice(0, 64), configHash: opened.regularFile ? fix.sha256(opened.bytes) : EMPTY_HASH, serverIdentity: entry ? evidenceIdentity.digest('moved-server', entry) : null };
}

/** Everything a workspace cycle does, as a class of small steps so the terminal shows each honest state. */
class Cycle {
  constructor({ options, pairing, deps, out, err }) {
    Object.assign(this, { options, pairing, deps, out, err });
    this.versions = versionsOf(deps.version);
    this.claims = loadClaims(options.home);
    this.problems = 0;
  }

  async post(route, body) {
    const result = await request({ url: this.pairing.url, credential: this.pairing.credential, route, body, fetchImpl: this.deps.fetchImpl });
    if (!result.ok) this.problems += 1;
    if (result.status === 401) this.credentialRefused = true;
    if (result.status === agentRequest.OUTDATED_STATUS) this.outdated = true;
    return result;
  }

  rememberNonce(nonce) {
    if (!this.claims.consumed.includes(nonce)) this.claims.consumed.push(nonce);
  }

  /** A claim this device took but never answered: report the manifest entry if the write finished, else `other`. */
  async reconcilePending() {
    for (const [proposalId, claim] of Object.entries(this.claims.pending)) {
      const entry = manifestEntryFor(this.options.home, proposalId);
      const body = entry
        ? { proposalId, nonce: claim.nonce, hashAtWrite: entry.backupHash, regularFile: true, appliedHash: entry.appliedHash, backupManifestId: entry.id }
        : { proposalId, nonce: claim.nonce, hashAtWrite: EMPTY_HASH, regularFile: false, failureCode: 'other' };
      const result = await this.post('applied', body);
      if (result.networkError) { this.err(`  ${proposalId}  unanswered claim kept: ${describeFailure('applied', result)}`); continue; }
      delete this.claims.pending[proposalId];
      this.rememberNonce(claim.nonce);
      this.out(`  ${proposalId}  unanswered claim from an earlier run ${entry ? `reported with manifest ${entry.id}` : 'reported as not written (other)'}; workspace state ${result.body.state || result.body.error || result.status}`);
    }
    saveClaims(this.options.home, this.claims);
  }

  async reportPreview(proposal, scan) {
    const target = targetForBinding(this.options, scan, proposal.binding);
    const result = await this.post('preview', { proposalId: proposal.id, nonce: proposal.binding.nonce, configHash: target.configHash, previewHash: target.previewHash, regularFile: target.regularFile, versions: this.versions });
    if (!result.ok) { this.err(`  ${proposal.id}  preview: ${describeFailure('preview', result)}`); return; }
    const local = target.regularFile ? (target.configHash === proposal.binding.configHash && target.previewHash === proposal.binding.previewHash ? 'preview matches the proposal' : 'the file or its preview changed since the proposal') : `the target is not a regular file (${target.failureCode})`;
    this.out(`  ${proposal.id}  preview reported for "${proposal.binding.server}" on ${proposal.binding.client}: ${local}; workspace state ${result.body.state || result.status}`);
  }

  async confirmLocally(proposal, target) {
    const b = proposal.binding;
    const verb = { rollback: 'restore', narrow_scope: 'narrow', remove_server: 'remove' }[b.action];
    const preposition = { rollback: 'to', narrow_scope: 'on', remove_server: 'from' }[b.action];
    this.out(`\n  ${proposal.id}  approved in ${this.pairing.workspaceName || 'the workspace'}${proposal.approvedAt ? ` at ${proposal.approvedAt}` : ''}: ${verb} "${b.server}" ${preposition} ${b.client}`);
    if (b.action === 'rollback') this.out('    restores the entire backed-up configuration; its capabilities and potential exposure paths may return');
    else if (b.action === 'narrow_scope') {
      this.out(`    keeps the server and all its tools; its folder access ${target.narrow.from} becomes this project folder, ${target.narrow.to}`);
      this.out(`    expected to close ${b.expectedExposureKeys.length} exposure path${b.expectedExposureKeys.length === 1 ? '' : 's'}${b.expectedExposureKeys.length ? `: ${b.expectedExposureKeys.join(', ')}` : ''}`);
      if (b.expectedLowered.length) this.out(`    expected to lower ${b.expectedLowered.map(step => `${step.exposureKey} ${step.from} to ${step.to}`).join(', ')}`);
    } else {
      this.out(`    expected to close ${b.expectedExposureKeys.length} exposure path${b.expectedExposureKeys.length === 1 ? '' : 's'}: ${b.expectedExposureKeys.join(', ')}`);
      this.out(`    the agent loses: ${remediate.capabilityLossText(b.capabilityLoss, target.serverRecord)}`);
    }
    this.out(`    file:    ${target.file}`);
    this.out(target.previewText);
    if (this.options.yes) { this.out('    local confirmation skipped (--yes)'); return true; }
    if (!process.stdin.isTTY) { this.out('    waiting: no terminal to confirm on; the proposal stays approved in the workspace. Run boppi connect run in a terminal, or pass --yes.'); return false; }
    if (await this.deps.confirm(b.action === 'rollback' ? '    Restore this file? [y/N] ' : '    Apply this edit? [y/N] ')) return true;
    this.out('    not applied here; the proposal stays approved in the workspace until it is cancelled there or expires.');
    return false;
  }

  async execute(proposal, scan, offers) {
    const b = proposal.binding;
    const already = manifestEntryFor(this.options.home, proposal.id);
    if (already) { this.out(`  ${proposal.id}  already applied on this machine as manifest ${already.id}; not applying again`); return; }
    if (b.expiresAt && Date.parse(b.expiresAt) < Date.now()) { this.out(`  ${proposal.id}  expired at ${b.expiresAt}; not claiming`); return; }
    const target = targetForBinding(this.options, scan, b);
    const sameFile = target.regularFile && target.configHash === b.configHash;
    const current = sameFile && target.previewHash === b.previewHash;
    // The same bytes with a different preview (a narrow whose project folder changed) is not this run's offer either; claiming it would only strand the proposal.
    if (sameFile && !offers.some(offer => offerMatches(offer, b))) {
      this.out(`  ${proposal.id}  refused (not_offered): "${clip(String(b.server), 128)}" on ${clip(String(b.client), 32)} is not a change this device offered in this run; not claimed, nothing written. Offers belong to the folder boppi connect run started in and to the file as it was; run it from the same folder as before, or let this run's fresh offer be proposed again`);
      return;
    }
    if (current && !await this.confirmLocally(proposal, target)) return;
    if (!current) this.out(`  ${proposal.id}  "${b.server}" on ${b.client}: ${target.regularFile ? 'the file or its preview changed since the proposal' : `the target is not a regular file (${target.failureCode})`}; claiming so the workspace records the conflict, nothing will be written`);

    const claimed = await this.post('claim', { proposalId: proposal.id, configHash: target.configHash, regularFile: target.regularFile, versions: this.versions });
    if (!claimed.ok) { this.err(`    claim: ${describeFailure('claim', claimed)}`); return; }
    const nonce = claimed.body.nonce;
    if (!current || typeof nonce !== 'string') { this.out(`    claim answered with state ${claimed.body.state || 'unknown'}; nothing written`); return; }
    if (!NONCE.test(nonce)) { this.out('    the workspace handed a malformed nonce; nothing written'); return; }
    if (this.claims.consumed.includes(nonce)) { this.out('    the workspace handed a nonce this device already answered; nothing written'); return; }
    this.claims.pending[proposal.id] = { nonce, targetFile: b.targetFile, client: b.client, server: b.server, claimedAt: stamp() };
    saveClaims(this.options.home, this.claims);

    const applied = (b.action === 'rollback' ? applyRollback : applyEdit)({ options: this.options, scan, binding: b, proposalId: proposal.id, now: stamp() });
    const body = { proposalId: proposal.id, nonce, hashAtWrite: applied.hashAtWrite, regularFile: applied.regularFile, ...(applied.ok ? { appliedHash: applied.appliedHash, backupManifestId: applied.backupManifestId } : { failureCode: applied.failureCode }) };
    const reported = await this.post('applied', body);
    if (applied.ok) this.out(b.action === 'rollback'
      ? `    applied locally: restored the verified backup ${applied.backup}; manifest ${applied.backupManifestId}`
      : `    applied locally: backup ${applied.backup}; manifest ${applied.backupManifestId}; undo with boppi rollback --id ${applied.backupManifestId}${homeFlag(this.options)}`);
    else this.out(`    not written (${applied.failureCode}); the file is as it was${applied.failureCode === 'hash_changed' ? `. The file changed after the preview you approved${b.client === 'claude-code' ? ' (Claude Code rewrites ~/.claude.json while it runs; quit it first)' : ''}. Run boppi connect run --once to send a fresh offer, then propose and approve again` : ''}`);
    if (reported.networkError) { this.err(`    applied: ${describeFailure('applied', reported)}; the report is kept and sent on the next run`); return; }
    delete this.claims.pending[proposal.id];
    this.rememberNonce(nonce);
    saveClaims(this.options.home, this.claims);
    if (!reported.ok) { this.err(`    applied: ${describeFailure('applied', reported)}${applied.ok ? '; the local edit stands, see the manifest above' : ''}`); return; }
    this.out(`    ${WAITING} (workspace state ${reported.body.state || reported.status})`);
    if (!applied.ok || reported.body.state !== 'applied') return;

    const after = await this.deps.performScan(this.options);
    if (after.failed) { this.err(`    rescan failed: ${after.failed}; the edit stays applied and the workspace still waits for a rescan, sent on the next run`); return; }
    await this.gradeRescan(proposal, after);
  }

  /** Report one scan for an applied proposal and print the workspace's grade. */
  async gradeRescan(proposal, scan) {
    const b = proposal.binding;
    const report = rescanReport(scan, b, this.options);
    const graded = await this.post('rescan', { proposalId: proposal.id, ...report, versions: this.versions, scannedAt: scan.startedAt });
    if (!graded.ok) { this.err(`    rescan: ${describeFailure('rescan', graded)}${graded.networkError ? '; the workspace still waits for a rescan, sent on the next run' : ''}`); return; }
    const remaining = Array.isArray(graded.body.remainingKeys) ? graded.body.remainingKeys : [];
    if (graded.body.state === 'verified') this.out(b.action === 'rollback'
      ? `    rescan graded verified: the configuration hash matches the restored backup; ${report.exposureKeys.length} potential exposure path${report.exposureKeys.length === 1 ? '' : 's'} reported on this agent`
      : b.action === 'narrow_scope'
        ? `    rescan graded verified: the server entry was observed narrowed to the predicted entry, and the expected paths no longer appear (${report.exposureKeys.length} exposure path${report.exposureKeys.length === 1 ? '' : 's'} remain on this agent; the device does not regrade lowered priorities here, boppi verify does)`
        : `    rescan graded verified: the server entry was observed absent from the scanned configuration and the expected paths no longer appear (${report.exposureKeys.length} exposure path${report.exposureKeys.length === 1 ? '' : 's'} remain on this agent)`);
    else this.out(`    rescan graded ${graded.body.state || graded.status}${remaining.length ? `: ${remaining.length} expected exposure key${remaining.length === 1 ? '' : 's'} still present (${remaining.join(', ')})` : ''}`);
  }

  /**
   * A proposal the workspace holds as applied without a graded rescan: an
   * earlier run died, its scan failed or its report never arrived. This
   * cycle's scan grades it, but only when this machine's manifest names the
   * proposal; another device's edit is never graded from here.
   */
  async gradeApplied(proposal, scan) {
    const entry = manifestEntryFor(this.options.home, proposal.id);
    if (!entry) { this.out(`  ${proposal.id}  applied, awaiting a rescan, but this machine holds no manifest entry for it; no rescan sent`); return; }
    this.out(`  ${proposal.id}  applied as manifest ${entry.id} in an earlier run; the workspace still waits for a rescan`);
    await this.gradeRescan(proposal, scan);
  }

  /** Remediation, then just-in-time grants. A refused remediation poll does not skip the grants, whose expiry matters more. */
  async run() {
    await this.reconcilePending();
    const scan = await this.deps.performScan(this.options);
    if (scan.failed) { this.err(`Scan failed: ${scan.failed}`); return scan.exitCode || 3; }
    const code = await this.remediate(scan);
    if (this.credentialRefused) {
      const failed = jit.revertForRefusedDevice(this.options.home, this.deps.now ? this.deps.now() : Date.now(), this.out, this.err);
      return failed ? 3 : code;
    }
    const jitProblems = await jit.runCycle({ options: this.options, pairing: this.pairing, deps: this.deps, post: (route, body) => request({ url: this.pairing.url, credential: this.pairing.credential, route, body, fetchImpl: this.deps.fetchImpl }), describe: describeFailure, out: this.out, err: this.err, versions: this.versions, scan });
    return code || (jitProblems ? 5 : 0);
  }

  async remediate(scan) {
    const offers = [...rollbackTargets(scan, this.options), ...localTargets(scan, this.options)].slice(0, OFFER_MAX).map(target => toOffer(target, this.deps.version, scan.startedAt));
    const polled = await this.post('poll', { versions: this.versions, offers });
    if (!polled.ok) { this.err(describeFailure('poll', polled)); return 5; }
    const proposals = Array.isArray(polled.body.proposals) ? polled.body.proposals.filter(p => p && typeof p.id === 'string' && p.binding && typeof p.binding === 'object') : [];
    const rollbacks = offers.filter(o => o.action === 'rollback').length;
    const narrows = offers.filter(o => o.action === 'narrow_scope').length;
    this.out(`BOPPI · CONNECT  ${scan.startedAt}  ${offers.length - rollbacks - narrows} removal offer(s), ${narrows ? `${narrows} narrowing offer(s), ` : ''}${rollbacks} rollback offer(s) sent (hashes, fingerprints, key names, counts, versions; no paths or contents), ${proposals.length} proposal${proposals.length === 1 ? '' : 's'} returned`);
    for (const proposal of proposals.filter(p => p.state === 'proposed')) await this.reportPreview(proposal, scan);
    for (const proposal of proposals.filter(p => p.state === 'approved')) await this.execute(proposal, scan, offers);
    for (const proposal of proposals.filter(p => p.state === 'applied')) await this.gradeApplied(proposal, scan);
    return this.problems ? 5 : 0;
  }
}

async function runPair(options, deps, out, err) {
  let url;
  try { url = resolveWorkspaceUrl(options.url); } catch (error) { err(`connect pair: ${error.message}`); return 2; }
  // Checked before the code is sent, so a refusal never burns it.
  let existing;
  try { existing = loadPairing(options.home); } catch (error) { err(`connect pair: ${error.message}`); return 2; }
  if (existing && !options.yes) {
    err(`connect pair: this machine is already paired with ${existing.workspaceName || existing.url} as "${existing.deviceName || existing.deviceId}". Run boppi connect unpair first (it revokes that device there), or add --yes to replace it here only (the old device stays listed and usable in that workspace until someone revokes it).`);
    return 2;
  }
  const deviceName = clip(options.name || os.hostname() || 'this machine', 64);
  const device = { name: deviceName, platform: clip(options.platform, 16), versions: versionsOf(deps.version) };
  const result = await request({ url, route: 'pair', body: { code: options.code, device }, fetchImpl: deps.fetchImpl });
  if (!result.ok) { err(`connect pair: ${describeFailure('pair', result)}`); return 5; }
  const b = result.body;
  if (typeof b.credential !== 'string' || typeof b.deviceId !== 'string') { err('connect pair: the workspace answered without a device credential'); return 5; }
  const pairing = { schemaVersion: SCHEMA_VERSION, url, deviceId: b.deviceId, organizationId: b.organizationId, credential: b.credential, credentialExpiresAt: b.credentialExpiresAt, workspaceName: b.workspaceName, deviceName, pairedAt: stamp() };
  writeOwnerOnly(pairingFile(options.home), pairing);
  // Claims and consumed nonces belong to the old device; carrying them over would mis-grade or refuse its proposals.
  if (existing) fs.rmSync(claimsFile(options.home), { force: true });
  out(`Paired with ${pairing.workspaceName || url} as "${deviceName}". Stored in ${pairingFile(options.home)} (${ownerOnlyNote()}): url, device id, organization id, credential (expires ${pairing.credentialExpiresAt || 'unknown'}).`);
  out(`The workspace now knows: device name, platform ${device.platform}, scanner ${device.versions.scanner}, engine ${device.versions.engine}, rubric ${device.versions.rubric}. No path was sent.`);
  out('boppi connect run pulls fix proposals from the workspace; nothing is applied without local confirmation on this machine.');
  return 0;
}

function renderStatus(options, pairing) {
  if (!pairing) return [`Not paired. ${pairingFile(options.home)} does not exist; boppi connect pair --url <workspace> --code <code> creates it.`, ...jit.renderLeases(options.home)].join('\n');
  const expired = pairing.credentialExpiresAt && Date.parse(pairing.credentialExpiresAt) < Date.now();
  return [
    `BOPPI · CONNECT  paired (credential not shown)`,
    `  workspace:  ${pairing.workspaceName || '?'} at ${pairing.url}`,
    `  device:     ${pairing.deviceName || '?'} (${pairing.deviceId})`,
    `  org:        ${pairing.organizationId || '?'}`,
    `  paired at:  ${pairing.pairedAt || '?'}`,
    `  credential: expires ${pairing.credentialExpiresAt || 'unknown'}${expired ? ' (expired; pair again)' : ''}${pairing.rotatedAt ? `, rotated ${pairing.rotatedAt}` : ''}; connect run rotates it when 7 days or less remain, boppi connect rotate does it now`,
    `  pending:    ${Object.keys(loadClaims(options.home).pending).length} unanswered claim(s)`,
    ...jit.renderLeases(options.home),
    'Status reads the local files only; nothing was sent.',
  ].join('\n');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function rotationDue(pairing, now = Date.now()) {
  const expires = Date.parse(pairing.credentialExpiresAt);
  return Number.isFinite(expires) && expires - now <= ROTATE_WITHIN_MS;
}

/**
 * Ask the workspace for a new credential and store it. The workspace keeps
 * the current one valid until the new one is first used, so a lost answer or
 * a failed write leaves this device working with the old credential.
 * Resolves to the updated pairing, or null after printing why not.
 */
async function rotateCredential(options, pairing, deps, out, err) {
  const result = await request({ url: pairing.url, credential: pairing.credential, route: 'rotate', body: { versions: versionsOf(deps.version) }, fetchImpl: deps.fetchImpl });
  if (!result.ok) { err(`connect rotate: ${describeFailure('rotate', result)}; the current credential stays in use`); return null; }
  const b = result.body;
  if (typeof b.credential !== 'string' || !/^bpd_[0-9a-f]{64}$/.test(b.credential) || Number.isNaN(Date.parse(b.credentialExpiresAt))) { err('connect rotate: the workspace answered without a usable credential; the current one stays in use'); return null; }
  const next = { ...pairing, credential: b.credential, credentialExpiresAt: b.credentialExpiresAt, rotatedAt: stamp() };
  writeOwnerOnly(pairingFile(options.home), next);
  out(`Credential rotated: the new one expires ${next.credentialExpiresAt} and replaces the old one in the workspace on its first use. Stored in ${pairingFile(options.home)} (${ownerOnlyNote()}).`);
  return next;
}

/** Revoke this device in the workspace, then delete the local pairing. A workspace that cannot be reached keeps both. */
async function runUnpair(options, pairing, deps, out, err) {
  if (!pairing) { out('Nothing to unpair.'); return 0; }
  let url;
  try { url = resolveWorkspaceUrl(pairing.url); } catch (error) {
    err(`connect unpair: the stored workspace URL is refused (${error.message}); nothing was sent. Revoke the device on the Collectors page, then delete ${pairingFile(options.home)} yourself.`);
    return 2;
  }
  const result = await request({ url, credential: pairing.credential, route: 'unpair', body: {}, fetchImpl: deps.fetchImpl });
  const refused = !result.ok && result.status === 401;
  if (!result.ok && !refused) {
    err(`connect unpair: ${describeFailure('unpair', result)}. Nothing deleted, so you can retry. To give up on the workspace, revoke the device on its Collectors page, or delete ${pairingFile(options.home)} yourself (boppi uninstall removes it with everything else).`);
    return 5;
  }
  fs.rmSync(pairingFile(options.home), { force: true });
  fs.rmSync(claimsFile(options.home), { force: true });
  out(refused
    ? `The workspace no longer accepts this device's credential (revoked or expired), so there was nothing to revoke there. ${pairingFile(options.home)} deleted.`
    : `Unpaired: the workspace revoked this device, and ${pairingFile(options.home)} is deleted. Its credentials stop working everywhere.`);
  return 0;
}

/** Exit code. deps: performScan, confirm, version, fetchImpl (tests). */
async function runConnect(options, deps) {
  const out = line => process.stdout.write(line + '\n');
  const err = line => process.stderr.write(line + '\n');
  deps = { ...deps, fetchImpl: updateNotice.watching(options.home, deps.fetchImpl || globalThis.fetch) };
  if (options.subcommand === 'pair') return runPair(options, deps, out, err);
  let pairing;
  try { pairing = loadPairing(options.home); } catch (error) { err(`connect ${options.subcommand}: ${error.message}`); return 2; }
  if (options.subcommand === 'status') { out(renderStatus(options, pairing)); return 0; }
  if (options.subcommand === 'revert-grants') return jit.runRevertGrants(options, out, err);
  if (options.subcommand === 'unpair') return runUnpair(options, pairing, deps, out, err);
  if (!pairing) { err(`connect ${options.subcommand}: not paired. ${renderStatus(options, null)}`); return 2; }
  try { pairing.url = resolveWorkspaceUrl(pairing.url); } catch (error) { err(`connect ${options.subcommand}: refusing the stored workspace URL: ${error.message}`); return 2; }
  if (options.subcommand === 'rotate') return (await rotateCredential(options, pairing, deps, out, err)) ? 0 : 5;
  let current = pairing;
  for (;;) {
    if (rotationDue(current)) current = (await rotateCredential(options, current, deps, out, err)) || current;
    const cycle = new Cycle({ options, pairing: current, deps, out, err });
    const code = await cycle.run();
    if (options.once) return code;
    if (code === 5 && cycle.credentialRefused) { err('  stopping: the workspace refuses this device, so polling again cannot succeed.'); return 5; }
    if (code === 5 && cycle.outdated) { err('  stopping: the workspace requires a newer Agent, so polling again cannot succeed.'); return 5; }
    updateNotice.announce(options.home, deps.version, err);
    out(`  next poll in ${options.interval} s (Ctrl-C stops; nothing is applied without confirmation here${options.watch ? '; just-in-time grants are removed at their local expiry meanwhile' : ''})`);
    if (options.watch) await watchExpiries(options, options.interval * 1000, out, err);
    else await sleep(options.interval * 1000);
  }
}

/** Between polls, wake every second (or at the next local expiry, if sooner) and revert what expired, offline. */
async function watchExpiries(options, total, out, err) {
  const until = Date.now() + total;
  while (Date.now() < until) {
    const next = jit.nextExpiry(options.home);
    const toNext = next !== null && next > Date.now() ? next - Date.now() + 5 : 1000;
    await sleep(Math.max(10, Math.min(1000, until - Date.now(), toNext)));
    const result = jit.enforceLeases(options.home);
    for (const lease of result.reverted) out(`  jit ${lease.grantId}  "${lease.server}" on ${lease.client}: local lease expired; entry ${lease.removed ? 'removed from' : 'already absent from'} the configuration (a client already running keeps it until restart); reported on the next poll`);
    for (const { lease, failureCode } of result.failed) err(`  jit ${lease.grantId}  "${lease.server}" on ${lease.client}: expired but not removed (${failureCode}); retried in a second`);
  }
}

module.exports = { SUBCOMMANDS, ROUTES, ROTATE_WITHIN_MS, request, rotationDue, rotateCredential, resolveWorkspaceUrl, pairingFile, claimsFile, loadPairing, loadClaims, versionsOf, openRegular, localTargets, rollbackTargets, toOffer, offerMatches, applyEdit, applyRollback, rescanReport, runConnect };
