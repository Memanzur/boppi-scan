/**
 * Optional capability overlay. Loads a claims file passed with --overlay and matches
 * claims to servers by public package identifier. The default run never loads one.
 * Only two statuses matter here: validated claims add an inferred permission with
 * claim provenance; experimental claims are reported in shadow and change nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const normalizer = require('../engine/permissionNormalizer');

const ACTIVE_STATUSES = new Set(['validated', 'experimental']);
const NPM_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const NPM_EXEC = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PYPI_RUNNERS = new Set(['uvx', 'pipx', 'uv']);
const TAKES_VALUE = new Set(['-p', '--package', '-c', '--call', '--registry']);

function stripVersion(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

function pinnedVersion(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(at + 1) : null;
}

/** Public package identifier a server entry runs, or null when the command is not a package runner. */
function packageIdentifier(server) {
  if (!server || typeof server.command !== 'string') return null;
  const command = server.command.trim().split(/[\\/]/).pop();
  const args = Array.isArray(server.args) ? server.args.filter(v => typeof v === 'string') : [];
  let list = null;
  let kind = null;
  if (NPM_RUNNERS.has(command)) { list = args; kind = 'npm_package'; }
  else if (NPM_EXEC.has(command)) {
    const i = args.findIndex(a => a === 'exec' || a === 'dlx' || a === 'x');
    if (i >= 0) { list = args.slice(i + 1); kind = 'npm_package'; }
  } else if (PYPI_RUNNERS.has(command)) {
    list = command === 'uv' ? args.slice(args.indexOf('run') + 1) : args;
    kind = 'pypi_package';
  }
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (TAKES_VALUE.has(arg)) { i++; if (arg === '-p' || arg === '--package') return { kind, name: stripVersion(list[i] || ''), version: pinnedVersion(list[i] || '') }; continue; }
    if (arg.startsWith('-')) continue;
    return { kind, name: stripVersion(arg), version: pinnedVersion(arg) };
  }
  return null;
}

function claimError(claim) {
  if (!claim || typeof claim !== 'object') return 'not an object';
  if (typeof claim.id !== 'string' || !claim.id) return 'missing id';
  if (typeof claim.subject !== 'string' || !claim.subject) return 'missing subject';
  if (!['npm_package', 'pypi_package', 'command'].includes(claim.subjectKind)) return 'unknown subjectKind';
  if (!normalizer.CATEGORIES.includes(claim.capability) || claim.capability === 'unknown') return 'capability not in taxonomy';
  if (!['candidate', 'experimental', 'validated', 'rejected', 'deprecated'].includes(claim.status)) return 'unknown status';
  if (!Array.isArray(claim.evidence) || !claim.evidence.length) return 'no evidence';
  const onlyLlm = claim.evidence.every(e => e && e.kind === 'llm');
  if (onlyLlm && claim.status !== 'candidate') return 'llm-only evidence cannot carry a status beyond candidate';
  const cited = claim.evidence.find(e => e && e.kind === 'inspector');
  if (cited && (typeof cited.file !== 'string' || !Number.isInteger(cited.line))) return 'inspector evidence lacks file and line';
  return null;
}

/** Read and validate an overlay file. Invalid claims are dropped and reported, never applied. */
function loadOverlay(file) {
  const resolved = path.resolve(file);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed.claims) ? parsed.claims : null;
  if (!raw) throw new Error('overlay must be an array of claims or an object with a claims array');
  const claims = [];
  const rejected = [];
  for (const claim of raw) {
    const error = claimError(claim);
    if (error) { rejected.push({ id: claim && claim.id || null, error }); continue; }
    if (ACTIVE_STATUSES.has(claim.status)) claims.push(claim);
  }
  const bySubject = new Map();
  for (const claim of claims) {
    const key = `${claim.subjectKind}:${claim.subject}`;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(claim);
  }
  return { file: resolved, claimCount: raw.length, activeCount: claims.length, rejected, bySubject };
}

function majorOf(version) {
  const m = /^v?(\d+)/.exec(version || '');
  return m ? m[1] : null;
}

/** Claims that apply to one raw server entry, split by status. Shadow entries change nothing. */
function matchClaims(overlay, serverName, server) {
  const empty = { package: null, validated: [], experimental: [] };
  if (!overlay) return empty;
  const pkg = packageIdentifier(server);
  if (!pkg || !pkg.name) return empty;
  const result = { package: pkg, validated: [], experimental: [] };
  for (const claim of overlay.bySubject.get(`${pkg.kind}:${pkg.name}`) || []) {
    // A claim pinned to another major version of the package is not about this server.
    if (pkg.version && claim.subjectVersion && majorOf(pkg.version) !== majorOf(claim.subjectVersion)) continue;
    result[claim.status].push(claim);
  }
  return result;
}

function citedEvidence(claim) {
  const e = claim.evidence.find(item => item && item.kind === 'inspector') || claim.evidence[0];
  return e && e.file ? `${e.file}:${e.line}` : e && e.kind === 'human' ? `human approval by ${e.actorId}` : 'evidence on file';
}

module.exports = { loadOverlay, matchClaims, packageIdentifier, citedEvidence };
