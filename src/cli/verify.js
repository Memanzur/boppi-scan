/**
 * Deterministic grading of earlier predictions against a fresh scan.
 * No model, no heuristics: set comparisons on exposure keys.
 */
'use strict';
const models = require('../engine/models');

const STATUS = Object.freeze({ CONFIRMED: 'CONFIRMED', PARTIAL: 'PARTIAL', CONTRADICTED: 'CONTRADICTED', UNRESOLVED: 'UNRESOLVED' });

/** Per-agent view of the fresh scan: which servers the config still has and which exposures exist. */
function currentState(scan) {
  const byAgent = new Map();
  for (const client of scan.discovery.clients) {
    if (!client.agentId || client.scanError) continue;
    byAgent.set(client.agentId, { agentId: client.agentId, client: { key: client.clientKey, label: client.label }, serverNames: new Set(), exposureKeys: [] });
  }
  for (const server of scan.inventory.mcpServers) byAgent.get(server.agentId)?.serverNames.add(server.name);
  for (const path of scan.paths) byAgent.get(path.agentId)?.exposureKeys.push(path.exposureKey);
  for (const state of byAgent.values()) state.exposureKeys.sort();
  return byAgent;
}

function locateAgent(prediction, byAgent, options) {
  if (byAgent.has(prediction.agentId)) return { state: byAgent.get(prediction.agentId), flags: [] };
  // An explicit --config names which client the file stands for, so the
  // operator has asserted the match even though the path fingerprint differs.
  if (options.explicitConfig && byAgent.size === 1) {
    const [state] = byAgent.values();
    if (state.client.key === prediction.client.key) return { state, flags: ['agent_matched_by_client'] };
  }
  return { state: null, flags: [] };
}

/**
 * Rules, in order:
 * 1. agent absent from the new scan: UNRESOLVED agent_not_scanned
 * 2. server key still present: UNRESOLVED edit_not_applied
 * 3. every predicted-eliminated key absent and every predicted-surviving key present: CONFIRMED
 * 4. some predicted-eliminated keys present: PARTIAL, survivors listed
 * 5. all predicted-eliminated keys present: CONTRADICTED
 * 6. keys in neither list are reported as appeared and do not change status
 * 7. a different engine version is flagged engine_changed, status still computed
 */
function resolvePrediction(prediction, byAgent, options = {}) {
  const flags = [];
  if (prediction.engineVersion !== models.ENGINE_VERSION) flags.push('engine_changed');
  const base = { predictionId: prediction.predictionId, agentId: prediction.agentId, client: prediction.client, edit: prediction.edit, predicted: { eliminated: prediction.predictedEliminated, surviving: prediction.predictedSurviving }, flags };
  const located = locateAgent(prediction, byAgent, options);
  flags.push(...located.flags);
  if (!located.state) return { ...base, status: STATUS.UNRESOLVED, reason: 'agent_not_scanned', observed: null };
  const { state } = located;
  if (state.serverNames.has(prediction.edit.server)) return { ...base, status: STATUS.UNRESOLVED, reason: 'edit_not_applied', observed: { exposureKeys: state.exposureKeys } };

  // Exposure keys embed the agent id, so a client-matched agent is compared in the prediction's own id space.
  const asPredicted = key => (state.agentId === prediction.agentId ? key : key.replace(state.agentId, prediction.agentId));
  const current = state.exposureKeys.map(asPredicted);
  const present = new Set(current);
  const survivors = prediction.predictedEliminated.filter(key => present.has(key));
  const vanished = prediction.predictedSurviving.filter(key => !present.has(key));
  const known = new Set([...prediction.predictedEliminated, ...prediction.predictedSurviving]);
  const appeared = current.filter(key => !known.has(key));
  const observed = { exposureKeys: state.exposureKeys, eliminated: prediction.predictedEliminated.filter(key => !present.has(key)), survivors, vanished, appeared };

  if (!survivors.length && !vanished.length) return { ...base, status: STATUS.CONFIRMED, reason: null, observed };
  if (prediction.predictedEliminated.length && survivors.length === prediction.predictedEliminated.length) return { ...base, status: STATUS.CONTRADICTED, reason: 'all_predicted_eliminated_present', observed };
  return { ...base, status: STATUS.PARTIAL, reason: survivors.length ? 'some_predicted_eliminated_present' : 'predicted_surviving_absent', observed };
}

function resolveAll(previous, scan, options = {}) {
  const byAgent = currentState(scan);
  const resolutions = previous.predictions.map(prediction => resolvePrediction(prediction, byAgent, options));
  const summary = { confirmed: 0, partial: 0, contradicted: 0, unresolved: 0 };
  for (const r of resolutions) summary[r.status.toLowerCase()] += 1;
  return { resolutions, summary, engineChanged: resolutions.some(r => r.flags.includes('engine_changed')) };
}

function inventoryFor(inventory, agentId) {
  const mine = records => (records || []).filter(r => r.agentId === agentId);
  return models.safeValue({ agents: (inventory.agents || []).filter(a => a.id === agentId), permissions: mine(inventory.permissions), mcpServers: mine(inventory.mcpServers), findings: mine(inventory.findings) }, 'inventory');
}

/** A self-contained fixture for an engine issue: the claim, the evidence before and after, and both engine versions. */
function contradictionBundle(prediction, resolution, previous, scan) {
  const previousInventory = previous.inventory && previous.inventory.real ? previous.inventory.real : { agents: [], permissions: [], mcpServers: [], findings: [] };
  return {
    schemaVersion: 1,
    kind: 'boppi-contradiction',
    createdAt: scan.startedAt,
    engineVersions: { prediction: prediction.engineVersion, verifier: models.ENGINE_VERSION },
    prediction,
    resolution,
    before: { inventory: inventoryFor(previousInventory, prediction.agentId), exposureKeys: prediction.before.exposureKeys },
    after: { inventory: inventoryFor(scan.inventory, resolution.agentId), exposureKeys: resolution.observed ? resolution.observed.exposureKeys : [] },
  };
}

function pad(value, width) { const text = String(value ?? ''); return text.length >= width ? text : text + ' '.repeat(width - text.length); }

const REASON_TEXT = Object.freeze({
  agent_not_scanned: 'that agent was not in this scan',
  edit_not_applied: 'the server is still configured',
  all_predicted_eliminated_present: 'every path predicted to vanish is still present',
  some_predicted_eliminated_present: 'some paths predicted to vanish are still present',
  predicted_surviving_absent: 'paths predicted to survive are gone too',
  engine_changed: 'engine version changed since the prediction',
  agent_matched_by_client: 'agent matched by client, its id changed',
});
const describeReason = code => (REASON_TEXT[code] ? `${REASON_TEXT[code]} (${code})` : code);

const NEXT_STEP = Object.freeze({
  CONFIRMED: 'The fix worked as predicted. Run boppi scan --json again to record the new baseline.',
  PARTIAL: 'The fix did less than predicted. A contradiction fixture was written; attach it to an issue so the engine can be corrected.',
  CONTRADICTED: 'The fix did not remove the predicted paths. A contradiction fixture was written; attach it to an issue so the engine can be corrected.',
  UNRESOLVED: 'Nothing could be graded yet. Apply the recommended edit (remove the named server entry), then run boppi verify again.',
});
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The one sentence after the table. A contradiction or partial result wins; otherwise a mix of graded and ungraded edits says so instead of calling the graded ones "nothing". */
function nextStep(summary) {
  if (summary.contradicted) return NEXT_STEP.CONTRADICTED;
  if (summary.partial) return NEXT_STEP.PARTIAL;
  if (summary.confirmed && summary.unresolved) {
    return `${plural(summary.confirmed, 'fix')} confirmed as predicted; ${plural(summary.unresolved, 'other prediction')} not graded because that edit was not applied. Run boppi scan --json again to record the new baseline, or apply another recommended edit and verify again.`;
  }
  if (summary.unresolved) return NEXT_STEP.UNRESOLVED;
  if (summary.confirmed) return NEXT_STEP.CONFIRMED;
  return null;
}

function renderTable(result, useColor) {
  const color = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[39m` : text);
  const tint = { CONFIRMED: 32, PARTIAL: 33, CONTRADICTED: 31, UNRESOLVED: 2 };
  const lines = [];
  const rows = result.resolutions.map(r => {
    const total = r.predicted.eliminated.length + r.predicted.surviving.length;
    const observed = r.observed && r.observed.eliminated ? `${r.observed.eliminated.length} of ${total} gone` : 'n/a';
    return { status: r.status, agent: r.client.label, edit: `remove ${r.edit.server}`, outcome: `${r.predicted.eliminated.length} of ${total} gone / ${observed}`, reason: [r.reason, ...r.flags].filter(Boolean).map(describeReason).join('; ') };
  });
  const width = key => Math.max(key.length, ...rows.map(row => row[key].length)) + 2;
  const widths = { status: width('status'), agent: width('agent'), edit: width('edit'), outcome: Math.max('predicted vs observed'.length, ...rows.map(row => row.outcome.length)) + 2 };
  lines.push(pad('status', widths.status) + pad('agent', widths.agent) + pad('edit', widths.edit) + pad('predicted vs observed', widths.outcome) + 'reason');
  for (const row of rows) {
    const statusText = useColor ? color(tint[row.status], pad(row.status, widths.status)) : pad(row.status, widths.status);
    lines.push(statusText + pad(row.agent, widths.agent) + pad(row.edit, widths.edit) + pad(row.outcome, widths.outcome) + row.reason);
  }
  const s = result.summary;
  lines.push('');
  lines.push(`${s.confirmed} confirmed · ${s.partial} partial · ${s.contradicted} contradicted · ${s.unresolved} unresolved`);
  if (result.engineChanged) lines.push(`engine version changed since the predictions were made (now ${models.ENGINE_VERSION}); statuses are still computed`);
  const next = nextStep(s);
  if (next) lines.push('', `Next: ${next}`);
  return lines.join('\n');
}

module.exports = { STATUS, currentState, resolvePrediction, resolveAll, contradictionBundle, renderTable, nextStep };
