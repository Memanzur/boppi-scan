/**
 * The remediation sequence behind boppi fix, as stage events a terminal or a
 * loopback stream can consume: preview (hash-bound), backup, apply (refused
 * when the file changed since the preview, restored when the edit does not
 * validate), rescan, verify, result. Every number in the result comes from
 * the rescan, never from the prediction.
 */
'use strict';
const { SEVERITY_RANK } = require('./simulate');
const fs = require('fs');
const fix = require('./fix');
const verify = require('./verify');

const CONTEXT_LINES = 3;
const HIDDEN = '[not shown]';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const stamp = () => new Date().toISOString();

/** A server entry as boppi records it: sanitized command, arguments and endpoint, env names with their values hidden. */
function sanitizedEntry(raw, record) {
  if (!isObject(raw)) return HIDDEN;
  if (!record) return { [HIDDEN]: 'no sanitized record for this entry' };
  const out = {};
  for (const key of Object.keys(raw)) {
    if (key === 'command') out.command = record.command;
    else if (key === 'args') out.args = record.arguments || [];
    else if (key === 'url' || key === 'endpoint') out[key] = record.endpoint;
    else if (key === 'env') out.env = Object.fromEntries((record.environmentVariableNames || []).map(name => [name, '[hidden]']));
    else out[key] = HIDDEN;
  }
  return out;
}

function projectServers(servers, recordsByName) {
  return Object.fromEntries(Object.entries(servers).map(([name, raw]) => [name, sanitizedEntry(raw, recordsByName.get(name))]));
}

/**
 * The file as the diff shows it: the mcpServers blocks a client reads, with
 * every entry sanitized, and every other value hidden. Secret values cannot
 * reach the preview because nothing from the raw file survives except keys.
 */
function projection(json, cwd, recordsByName) {
  const out = {};
  for (const [key, value] of Object.entries(json)) {
    if (key === 'mcpServers' && isObject(value)) out[key] = projectServers(value, recordsByName);
    else if (key === 'projects' && isObject(value) && cwd) out[key] = Object.fromEntries(Object.entries(value).map(([project, body]) => [project, project === cwd && isObject(body) ? projection(body, null, recordsByName) : HIDDEN]));
    else out[key] = HIDDEN;
  }
  return out;
}

function middleOps(a, b) {
  const plain = [...a.map(text => ({ type: '-', text })), ...b.map(text => ({ type: '+', text }))];
  if (!a.length || !b.length || a.length * b.length > 250000) return plain;
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: ' ', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ type: '-', text: a[i++] });
    else ops.push({ type: '+', text: b[j++] });
  }
  while (i < a.length) ops.push({ type: '-', text: a[i++] });
  while (j < b.length) ops.push({ type: '+', text: b[j++] });
  return ops;
}

/** Line operations between two texts. Common head and tail are trimmed first so the LCS runs on the changed region only. */
function lineDiff(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return [
    ...a.slice(0, start).map(text => ({ type: ' ', text })),
    ...middleOps(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(text => ({ type: ' ', text })),
  ];
}

/** Unified-diff hunks with a few lines of context around each change. */
function hunks(ops, context = CONTEXT_LINES) {
  const changed = ops.map((op, index) => (op.type === ' ' ? -1 : index)).filter(index => index >= 0);
  const lines = [];
  let cursor = 0, oldLine = 1, newLine = 1;
  const advance = upTo => { for (; cursor < upTo; cursor++) { if (ops[cursor].type !== '+') oldLine++; if (ops[cursor].type !== '-') newLine++; } };
  let index = 0;
  while (index < changed.length) {
    const from = Math.max(0, changed[index] - context);
    let to = changed[index] + context;
    while (index + 1 < changed.length && changed[index + 1] - context <= to) { index++; to = changed[index] + context; }
    to = Math.min(ops.length - 1, to);
    advance(from);
    const slice = ops.slice(from, to + 1);
    const oldCount = slice.filter(op => op.type !== '+').length, newCount = slice.filter(op => op.type !== '-').length;
    lines.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const op of slice) lines.push(`${op.type}${op.text}`);
    advance(to + 1);
    index++;
  }
  return lines;
}

/** Everything fix shows before asking, bound to the bytes it was computed from. Reads the file, writes nothing. */
function previewRemoval({ located, serverName, cwd, recordsByName }) {
  const bytes = fs.readFileSync(located.file);
  const json = JSON.parse(bytes.toString('utf8'));
  const keyPaths = fix.serverBlocks(json, cwd).filter(block => hasOwn(block.servers, serverName)).map(block => `${block.keyPath}.${JSON.stringify(serverName)}`);
  const before = JSON.stringify(projection(json, cwd, recordsByName), null, 2);
  const edited = JSON.parse(JSON.stringify(json));
  fix.deleteServer(edited, serverName, cwd);
  const after = JSON.stringify(projection(edited, cwd, recordsByName), null, 2);
  const entry = sanitizedEntry(fix.serverBlocks(json, cwd).map(block => block.servers[serverName]).find(Boolean), recordsByName.get(serverName));
  return { file: located.file, scope: located.scope, server: serverName, keyPaths, entry, diff: hunks(lineDiff(before, after)), fileHashes: { [located.file]: fix.sha256(bytes) } };
}

function renderPreview(preview, indent = '  ') {
  const lines = [];
  for (const keyPath of preview.keyPaths) lines.push(`${indent}key:     ${keyPath}`);
  lines.push(`${indent}entry:   ${JSON.stringify(preview.entry)}  (sanitized; env values are never shown)`);
  lines.push(`${indent}diff:    sanitized view of ${preview.file}; values outside server entries are not shown`);
  for (const line of preview.diff) lines.push(`${indent}  ${line}`);
  return lines.join('\n');
}

/** Why the written file is not the planned edit, or null when it is. */
function validateEdited({ bytes, expected, serverName, cwd }) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch (_) { return 'the written file is not valid JSON'; }
  if (!isObject(parsed)) return 'the written file is not a JSON object';
  const blocksExpected = fix.serverBlocks(expected, cwd);
  const blocksAfter = fix.serverBlocks(parsed, cwd);
  if (blocksAfter.length !== blocksExpected.length) return 'an mcpServers block is no longer an object';
  for (const [index, block] of blocksExpected.entries()) {
    const after = blocksAfter[index];
    if (after.keyPath !== block.keyPath) return `${block.keyPath} is missing`;
    if (hasOwn(after.servers, serverName)) return `${JSON.stringify(serverName)} is still in ${block.keyPath}`;
    for (const [name, entry] of Object.entries(block.servers)) if (JSON.stringify(after.servers[name]) !== JSON.stringify(entry)) return `entry ${JSON.stringify(name)} in ${block.keyPath} changed`;
    if (Object.keys(after.servers).length !== Object.keys(block.servers).length) return `${block.keyPath} gained an entry`;
  }
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) return 'the file changed outside its mcpServers blocks';
  return null;
}

function clientOf(scan, clientKey) { return scan.discovery.clients.find(c => c.clientKey === clientKey) || null; }

/** Paths of one agent after the edit, compared with the same agent before it. Keys are compared in the before-agent's id space, as verify does. */
function outcome({ scanBefore, scanAfter, clientKey, prediction }) {
  const before = clientOf(scanBefore, clientKey), after = clientOf(scanAfter, clientKey);
  const beforePaths = before && before.agentId ? scanBefore.paths.filter(p => p.agentId === before.agentId) : [];
  const afterPaths = after && after.agentId ? scanAfter.paths.filter(p => p.agentId === after.agentId) : [];
  const asBefore = key => (after && before && after.agentId !== before.agentId ? key.replace(after.agentId, before.agentId) : key);
  const present = new Set(afterPaths.map(p => asBefore(p.exposureKey)));
  const priorityAfter = new Map(afterPaths.map(p => [asBefore(p.exposureKey), p.severity]));
  const eliminated = beforePaths.filter(p => !present.has(p.exposureKey));
  const lowered = beforePaths
    .filter(p => present.has(p.exposureKey) && (SEVERITY_RANK[priorityAfter.get(p.exposureKey)] || 0) < (SEVERITY_RANK[p.severity] || 0))
    .map(p => ({ pathId: p.id, exposureKey: p.exposureKey, label: p.label, from: p.severity, to: priorityAfter.get(p.exposureKey) }));
  const idsByKey = new Map(beforePaths.map(p => [p.exposureKey, p.id]));
  const predictedIds = prediction ? prediction.predictedEliminated.map(key => idsByKey.get(key) || key) : [];
  const remaining = afterPaths.map(p => ({
    pathId: p.id, label: p.label, severity: p.severity,
    reason: `still reachable through ${p.nodes.filter(n => n.entityType === 'mcp_server').map(n => n.label).join(', ') || 'this agent'}${prediction && prediction.predictedSurviving.includes(asBefore(p.exposureKey)) ? ' (predicted to survive)' : ''}`,
  }));
  const kind = !beforePaths.length ? 'unresolved' : !afterPaths.length ? 'removed' : eliminated.length || lowered.length ? 'reduced' : 'unresolved';
  return { outcome: kind, eliminated: eliminated.map(p => p.id), lowered, predicted: predictedIds, remaining, capabilitiesLost: prediction ? prediction.disruption.lost : [] };
}

/**
 * The stages of one remove_server fix. Yields { stage, status, detail, at }
 * and also passes each event to emit when given. expectedHashes are the
 * file hashes captured by previewRemoval; apply refuses when they no longer
 * match. rescan(options) is performScan, injected so this module does not
 * depend on the CLI entry point. io.writeFile exists for tests that need the
 * write to go wrong.
 */
async function* runRemediation({ options, server, clientKey, scanBefore, expectedHashes, exportFile = null, rescan, io = {} }, emit) {
  const writeFile = io.writeFile || ((file, text) => fs.writeFileSync(file, text));
  const events = [];
  const event = (stage, status, detail = {}) => { const e = { stage, status, detail, at: stamp() }; events.push(e); if (emit) emit(e); return e; };
  const fail = (stage, detail) => event(stage, 'failed', detail);

  const client = clientOf(scanBefore, clientKey);
  const descriptor = fix.descriptorsFor(options).find(d => d.clientKey === clientKey);
  const located = client && descriptor ? fix.locateServer(client, descriptor, server) : null;
  const prediction = scanBefore.predictions.find(p => p.edit.action === 'remove_server' && p.edit.server === server && p.client.key === clientKey) || null;

  yield event('backup', 'running', { file: located ? located.file : null });
  if (!located) { yield fail('backup', { reason: `no readable ${clientKey} file holds ${JSON.stringify(server)}` }); return; }
  let backup;
  try { backup = fix.writeBackup({ file: located.file, home: options.home, now: scanBefore.startedAt }); } catch (error) { yield fail('backup', { reason: error.message }); return; }
  yield event('backup', 'done', { file: located.file, backup });

  yield event('apply', 'running', { file: located.file });
  const current = fix.fileHash(located.file);
  const expected = expectedHashes ? expectedHashes[located.file] : null;
  if (!expected || current !== expected) {
    fs.rmSync(backup, { force: true });
    yield fail('apply', { reason: `${located.file} changed since the preview (expected ${expected ? expected.slice(0, 12) : 'no hash'}, found ${current.slice(0, 12)}); nothing was written, run boppi fix again`, written: false });
    return;
  }
  const originalBytes = fs.readFileSync(located.file);
  const edited = JSON.parse(originalBytes.toString('utf8'));
  if (!fix.deleteServer(edited, server, options.cwd)) {
    fs.rmSync(backup, { force: true });
    yield fail('apply', { reason: `${JSON.stringify(server)} was not found in ${located.file} at write time`, written: false });
    return;
  }
  try { writeFile(located.file, JSON.stringify(edited, null, 2) + '\n'); } catch (error) {
    fs.writeFileSync(located.file, originalBytes);
    yield fail('apply', { reason: `write failed (${error.message}); the original bytes were restored`, written: false, restored: true });
    return;
  }
  const problem = validateEdited({ bytes: fs.readFileSync(located.file), expected: edited, serverName: server, cwd: options.cwd });
  if (problem) {
    fs.copyFileSync(backup, located.file);
    yield fail('apply', { reason: `the edited file did not validate (${problem}); restored from ${backup}`, written: true, restored: true });
    return;
  }
  let manifestEntry;
  try {
    manifestEntry = fix.appendManifestEntry(options.home, { createdAt: stamp(), backup, original: located.file, clientKey, server, action: 'remove_server', scanExport: exportFile, backupHash: fix.sha256(originalBytes), appliedHash: fix.fileHash(located.file) });
  } catch (_) {
    fs.writeFileSync(located.file, originalBytes);
    yield fail('apply', { reason: 'could not record the rollback manifest; the original bytes were restored', written: true, restored: true });
    return;
  }
  yield event('apply', 'done', { file: located.file, keyPaths: fix.serverBlocks(JSON.parse(originalBytes.toString('utf8')), options.cwd).filter(b => hasOwn(b.servers, server)).map(b => `${b.keyPath}.${JSON.stringify(server)}`), manifestId: manifestEntry.id, backup });

  yield event('rescan', 'running', {});
  const scanAfter = await rescan(options);
  if (scanAfter.failed) { yield fail('rescan', { reason: `${scanAfter.failed}. The edit stays applied; boppi rollback --id ${manifestEntry.id} restores the backup`, exitCode: scanAfter.exitCode || 3 }); return; }
  yield event('rescan', 'done', { pathsBefore: scanBefore.paths.length, pathsAfter: scanAfter.paths.length, scan: scanAfter });

  yield event('verify', 'running', {});
  const grade = prediction ? verify.resolveAll({ predictions: [prediction] }, scanAfter, { explicitConfig: !!options.config }) : null;
  yield event('verify', 'done', grade ? { status: grade.resolutions[0].status, result: grade } : { status: null, reason: 'no exposure path was modeled for this server, so there is no prediction to grade' });

  yield event('result', 'done', { ...outcome({ scanBefore, scanAfter, clientKey, prediction }), backup, exportFile, manifestId: manifestEntry.id, grade: grade ? grade.resolutions[0].status : null });
}

const STAGE_WIDTH = 8;
/** One terminal line per stage event; running events print nothing so the output reads as a checklist. */
function renderStage(event, indent = '  ') {
  if (event.status === 'running') return null;
  const d = event.detail;
  const label = `${indent}${event.stage.padEnd(STAGE_WIDTH)} ${event.status.padEnd(7)}`;
  if (event.status === 'failed') return `${label} ${d.reason}`;
  switch (event.stage) {
    case 'backup': return `${label} ${d.backup}`;
    case 'apply': return `${label} removed ${d.keyPaths.join(', ')}; manifest ${d.manifestId}`;
    case 'rescan': return `${label} ${d.pathsBefore} exposure path${d.pathsBefore === 1 ? '' : 's'} before, ${d.pathsAfter} after`;
    case 'verify': return `${label} ${d.status || d.reason}`;
    case 'result': return renderResult(d, indent);
    default: return label;
  }
}

function renderResult(result, indent = '  ') {
  const lines = [];
  const predicted = result.predicted.length;
  const gone = result.predicted.filter(id => result.eliminated.includes(id)).length;
  const lowered = result.lowered || [];
  const summary = result.outcome === 'removed' ? 'every exposure path on this agent is gone'
    : result.outcome === 'reduced' ? `${result.remaining.length} exposure path${result.remaining.length === 1 ? '' : 's'} remain${result.remaining.length === 1 ? 's' : ''}${lowered.length ? `, ${lowered.length} at a lower priority` : ''}`
    : result.remaining.length ? 'nothing modeled was eliminated or lowered' : 'no exposure path was modeled for this server';
  lines.push(`${indent}${'result'.padEnd(STAGE_WIDTH)} ${result.outcome.padEnd(7)} ${summary}; predicted ${predicted} eliminated, observed ${gone} of ${predicted}${result.eliminated.length > gone ? ` (+${result.eliminated.length - gone} not predicted)` : ''}`);
  for (const step of lowered) lines.push(`${indent}${''.padEnd(STAGE_WIDTH)} ${'lowered'.padEnd(7)} ${step.from} to ${step.to} ${step.label || step.exposureKey.split(':')[0]} [${step.pathId}]`);
  for (const path of result.remaining) lines.push(`${indent}${''.padEnd(STAGE_WIDTH)} ${'remains'.padEnd(7)} ${path.severity} ${path.label} [${path.pathId}]: ${path.reason}`);
  if (result.capabilitiesLost.length) lines.push(`${indent}${''.padEnd(STAGE_WIDTH)} ${'lost'.padEnd(7)} ${result.capabilitiesLost.join(', ')}`);
  lines.push(`${indent}${''.padEnd(STAGE_WIDTH)} ${'undo'.padEnd(7)} boppi rollback --id ${result.manifestId}`);
  return lines.join('\n');
}

module.exports = { previewRemoval, renderPreview, validateEdited, lineDiff, hunks, projection, sanitizedEntry, outcome, runRemediation, renderStage, renderResult };
