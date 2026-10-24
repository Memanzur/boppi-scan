/** Read-only, deterministic questions over an explicitly selected scan export. */
'use strict';
const fs = require('fs');
const normalizer = require('../engine/permissionNormalizer');
const MAX_BYTES = 16 * 1024 * 1024;
const LIMIT = 50;
const ID = /^[a-zA-Z0-9_:.-]{1,180}$/;
const QUESTIONS = Object.freeze({
  access: 'What can my AI tools access?',
  sensitive: 'Which agents have potentially sensitive permissions?',
  removal: 'What would happen if I removed this connection?',
  unused: 'Which permissions appear unnecessary?',
  changes: 'Which integrations changed recently?',
});
const safe = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '?').slice(0, 500);
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ');
const INTENTS = new Map(Object.entries(QUESTIONS).map(([key, question]) => [normalize(question), key]));
INTENTS.set('what can my agents access', 'access');
INTENTS.set('what can my ai agents access', 'access');
INTENTS.set('what happens if i remove this connection', 'removal');

function readExport(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error();
    const bytes = Buffer.alloc(Math.min(MAX_BYTES + 1, stat.size + 1));
    const read = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (read > MAX_BYTES) throw new Error();
    return validate(JSON.parse(bytes.subarray(0, read).toString('utf8')));
  } catch { throw new Error('Cannot read a supported scan export (regular JSON file, at most 16 MiB). No scan was run.'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function validate(payload) {
  const inventory = payload?.inventory?.real || payload?.inventory;
  if (!inventory || !['agents', 'mcpServers', 'permissions'].every(key => Array.isArray(inventory[key]) && inventory[key].length <= 20000)) throw new Error('Unsupported inventory');
  const agents = new Map();
  const servers = new Map();
  const unique = (rows, map) => rows.forEach((row, index) => {
    if (!row || (typeof row.id !== 'string' || !ID.test(row.id)) || map.has(row.id)) throw new Error('Invalid record identity');
    map.set(row.id, { ...row, index });
  });
  unique(inventory.agents, agents);
  unique(inventory.mcpServers, servers);
  const permissions = new Map();
  unique(inventory.permissions, permissions);
  for (const row of [...servers.values(), ...permissions.values()]) {
    if (!agents.has(row.agentId)) throw new Error('Unknown agent reference');
    if (row.integrationId && (!servers.has(row.integrationId) || servers.get(row.integrationId).agentId !== row.agentId)) throw new Error('Cross-agent permission reference');
  }
  const paths = payload.exposurePaths;
  if (!Array.isArray(paths) || paths.length > 20000 || paths.some(p => !p || !agents.has(p.agentId) || (typeof p.id !== 'string' || !ID.test(p.id)))) throw new Error('Unsupported path evidence');
  return { payload, agents, servers, permissions, paths, prefix: payload.inventory.real ? '/inventory/real' : '/inventory' };
}

function answer(snapshot, question, { server, client } = {}) {
  const { payload, agents, servers, permissions, paths, prefix } = snapshot;
  const intent = INTENTS.get(normalize(question));
  const result = {
    schemaVersion: 1, intent: intent || 'unsupported', status: 'answered',
    snapshot: { exportedAt: typeof payload.exportedAt === 'string' && Number.isFinite(Date.parse(payload.exportedAt)) ? payload.exportedAt : null, engineVersion: safe(payload.engineVersion || 'not reported') },
    boundary: 'This is evidence from the selected export, not a fresh scan or a check of effective permissions. No model, network request, server launch or configuration change is used.',
    items: [], unknowns: ['An export is locally editable and is not an authenticated statement of effective access.'],
  };
  const cite = (kind, row) => ({ kind, id: row.id, location: `${prefix}/${kind === 'agent' ? 'agents' : kind === 'server' ? 'mcpServers' : 'permissions'}/${row.index}` });
  if (payload.traversal?.complete === false) result.unknowns.push('Path search was capped in this export; absence of a path is not complete coverage.');
  if (payload.coverage?.scope && payload.coverage.scope !== 'full') result.unknowns.push('The selected export has limited discovery scope.');
  const grantsByAgent = new Map();
  for (const grant of permissions.values()) {
    if (!grantsByAgent.has(grant.agentId)) grantsByAgent.set(grant.agentId, []);
    grantsByAgent.get(grant.agentId).push(grant);
  }
  const pathIndex = new Map(paths.map((p, i) => [p, i]));
  if (!intent) {
    result.status = 'unsupported';
    result.message = 'This local interface supports only the listed questions; it does not interpret instructions or execute actions.';
    result.supportedQuestions = Object.values(QUESTIONS);
  } else if (intent === 'access') {
    result.message = 'Configured and inferred access reported in this snapshot; advertised tools and built-in grants keep their basis.';
    for (const agent of agents.values()) {
      const grants = grantsByAgent.get(agent.id) || [];
      result.items.push({ agent: safe(agent.name), citations: [cite('agent', agent)], permissions: grants.slice(0, LIMIT).map(p => ({
        category: normalizer.CATEGORIES.includes(p.normalizedCategory) ? p.normalizedCategory : 'unknown',
        basis: ['configured', 'catalog', 'advertised', 'builtin', 'inferred'].includes(p.attributes?.basis) ? p.attributes.basis : 'unknown',
        approval: ['prompted', 'unprompted', 'denied', 'unknown'].includes(p.attributes?.gate) ? p.attributes.gate : 'unknown',
        server: p.integrationId ? safe(servers.get(p.integrationId).name) : p.source?.type === 'builtin-tool' ? 'built-in tool' : 'not attributed',
        citations: [cite('permission', p)],
      })), omittedPermissions: Math.max(0, grants.length - LIMIT) });
    }
    if (!agents.size) result.unknowns.push('No agents are included in this export; that does not establish that no agents exist.');
    if (!permissions.size) result.unknowns.push('No permission records were reported; unknown reach is not proof of safety.');
  } else if (intent === 'sensitive') {
    result.message = 'Potentially sensitive reach in existing EP-A, EP-B, EP-C and EP-F paths; priority is the export’s rubric result, not an attack likelihood.';
    result.items = paths.filter(p => ['EP-A', 'EP-B', 'EP-C', 'EP-F'].includes(p.templateId)).map(p => ({
      agent: safe(agents.get(p.agentId).name), template: p.templateId,
      priority: ['critical', 'high', 'medium', 'low'].includes(p.severity) ? p.severity : 'unknown',
      facts: (Array.isArray(p.assessment?.facts) ? p.assessment.facts : []).slice(0, 10).map(safe),
      assumptions: (Array.isArray(p.assessment?.assumptions) ? p.assessment.assumptions : []).slice(0, 10).map(safe),
      unknowns: (Array.isArray(p.assessment?.unknowns) ? p.assessment.unknowns : ['No rubric explanation in this export.']).slice(0, 10).map(safe),
      citations: [{ kind: 'path', id: p.id, location: `/exposurePaths/${pathIndex.get(p)}` }],
    }));
    if (!result.items.length) result.unknowns.push('No matching potential path was reported; this does not rule out sensitive access outside scan coverage.');
  } else if (intent === 'removal') {
    const matches = [...servers.values()].filter(s => s.name === server);
    if (Array.isArray(payload.predictions) && payload.predictions.length > 20000) throw new Error('Too many predictions');
    const matchingIds = new Map(matches.map(s => [s.id, s.agentId]));
    let predictions = Array.isArray(payload.predictions) ? payload.predictions.filter(p => p?.edit?.action === 'remove_server' && p.edit.server === server && matchingIds.has(p.serverId) && matchingIds.get(p.serverId) === p.agentId) : [];
    if (client) predictions = predictions.filter(p => p.client?.key === client);
    if (!server || predictions.length !== 1) {
      result.status = 'unknown';
      result.message = !server ? 'Choose the exact connection with --server; use --client when names repeat.' : predictions.length > 1 ? 'Several stored predictions match. Choose --client; no action was taken.' : 'No matching stored removal prediction is available. Run a separately chosen scan/plan to obtain one; no action was taken.';
    } else {
      const p = predictions[0];
      if (![p.before?.exposureKeys, p.predictedEliminated, p.predictedLowered, p.predictedSurviving, p.disruption?.lost, p.disruption?.kept].every(Array.isArray) || typeof p.predictionId !== 'string' || !ID.test(p.predictionId)) throw new Error('Unsupported prediction');
      const before = new Set(p.before.exposureKeys);
      const after = new Set(p.predictedSurviving);
      const closed = new Set(p.predictedEliminated);
      const known = new Set(paths.filter(path => path.agentId === p.agentId).map(path => path.exposureKey));
      if (before.size !== p.before.exposureKeys.length || after.size !== p.predictedSurviving.length || closed.size !== p.predictedEliminated.length || before.size !== after.size + closed.size || [...before].some(key => !known.has(key)) || [...after, ...closed].some(key => !before.has(key)) || [...closed].some(key => after.has(key)) || p.predictedLowered.some(step => !step || !after.has(step.exposureKey))) throw new Error('Inconsistent prediction');
      if (p.engineVersion !== payload.engineVersion) throw new Error('Prediction engine mismatch');
      result.message = 'Stored prediction only. Preview the current file with boppi plan before deciding; a supported fix needs approval, backup, rescan and rollback.';
      result.items = [{ server: safe(server), agent: safe(agents.get(p.agentId).name), predictedClosed: p.predictedEliminated.length, predictedLowered: p.predictedLowered.length, predictedRemaining: p.predictedSurviving.length,
        lostCapabilities: p.disruption.lost.slice(0, LIMIT).map(safe), keptCapabilities: p.disruption.kept.slice(0, LIMIT).map(safe),
        verification: 'Compare a new scan against the saved prediction with boppi verify after an explicitly approved change. This answer did not verify or apply it.',
        citations: [{ kind: 'prediction', id: p.predictionId, location: `/predictions/${payload.predictions.indexOf(p)}` }],
      }];
    }
  } else if (intent === 'unused') {
    result.status = 'unknown';
    result.message = 'Configuration and observed inactivity cannot establish which permissions are unnecessary. Review the intended workflow with its owner; partial or absent runtime evidence is not proof of non-use.';
  } else if (intent === 'changes') {
    result.status = 'unknown';
    result.message = 'One export cannot establish which integrations changed recently. Use local history/watch for recorded changes; this command does not assume that two unrelated devices or exports are comparable.';
  }
  result.omittedItems = Math.max(0, result.items.length - LIMIT);
  result.items = result.items.slice(0, LIMIT);
  return result;
}

function render(result) {
  const label = value => safe(value).replace(/_/g, ' ');
  const basisLabel = { configured: 'configuration', catalog: 'known-server catalog (inferred)', advertised: 'advertised by server, not verified', builtin: 'client built-in tool model', inferred: 'inferred', unknown: 'not established' };
  const lines = ['BOPPI · LOCAL ACCESS QUESTIONS', result.boundary, `Snapshot: ${result.snapshot.exportedAt || 'time not reported'} · engine ${result.snapshot.engineVersion}`, '', safe(result.message)];
  for (const item of result.items) {
    lines.push('', `${item.agent}${item.server ? ` / ${item.server}` : ''}${item.template ? ` · ${item.template} ${item.priority}` : ''}`);
    if (item.permissions) {
      for (const grant of item.permissions) lines.push(`  ${label(grant.category)} via ${grant.server}; based on: ${basisLabel[grant.basis]}; approval model: ${grant.approval}`, `    evidence: ${grant.citations[0].location}`);
      if (!item.permissions.length) lines.push('  No permission records reported; reach remains unknown.');
      if (item.omittedPermissions) lines.push(`  ${item.omittedPermissions} more permission records are in the selected export.`);
    }
    for (const fact of item.facts || []) lines.push(`  Based on: ${fact}`);
    for (const assumption of item.assumptions || []) lines.push(`  Assumes: ${assumption}`);
    for (const unknown of item.unknowns || []) lines.push(`  Not checked: ${unknown}`);
    if (item.predictedClosed !== undefined) {
      lines.push(`  Predicted: ${item.predictedClosed} paths closed, ${item.predictedLowered} lowered, ${item.predictedRemaining} remaining.`, `  Access lost: ${item.lostCapabilities.map(label).join(', ') || 'none reported beyond other routes'}.`, `  Access kept: ${item.keptCapabilities.map(label).join(', ') || 'none reported'}.`, `  Verify: ${item.verification}`);
    }
    lines.push(`  Evidence: ${item.citations.map(c => c.location).join(', ')}`);
  }
  for (const unknown of result.unknowns) lines.push(`Unknown: ${safe(unknown)}`);
  if (result.omittedItems) lines.push(`${result.omittedItems} additional items omitted; inspect the selected export for complete recorded details.`);
  if (result.supportedQuestions) lines.push('', ...result.supportedQuestions.map(q => `  ${q}`));
  return lines.join('\n');
}

function runAsk(options) {
  try {
    const result = answer(readExport(options.file), options.question, options);
    process.stdout.write((options.json === '-' ? JSON.stringify(result, null, 2) : render(result)) + '\n');
    return 0;
  } catch { process.stderr.write('ask: cannot answer from this export. Use a supported Boppi scan export; no scan or action was run.\n'); return 2; }
}
module.exports = { readExport, validate, answer, render, runAsk, QUESTIONS, MAX_BYTES };
