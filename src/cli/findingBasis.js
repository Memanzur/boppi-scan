/**
 * What a rule-engine finding rests on, in the same words an exposure path
 * uses: each contributing grant with its basis (configuration, catalog,
 * built-in tool), and the fixed sentence that nothing was seen at runtime.
 * The stored evidenceClass stays as it is; this only words it for people.
 */
'use strict';
const { BASIS_TEXT } = require('../engine/riskRubric');

const NOT_CHECKED = 'no tool call, data transfer, or attack was observed; this is configured potential access';

function basisOf(permission) {
  const declared = permission && permission.attributes && permission.attributes.basis;
  if (declared) return declared;
  return permission && permission.source && permission.source.evidenceClass === 'inferred' ? 'inferred' : 'configured';
}

/** { basedOn, notChecked } for one finding, given the inventory's permissions. */
function findingBasis(finding, permissions) {
  const byId = new Map((permissions || []).map(p => [p.id, p]));
  const groups = new Map(), notes = [];
  for (const item of finding.evidence || []) {
    if (!item.rawPermission && !item.category) { if (item.evidence) notes.push(item.evidence); continue; }
    const basis = basisOf(byId.get(item.id));
    const text = BASIS_TEXT[basis] || basis;
    groups.set(text, [...(groups.get(text) || []), item.rawPermission || item.category]);
  }
  const facts = [...[...groups].map(([text, grants]) => `${grants.join(', ')} (${text})`), ...notes];
  const basedOn = facts.length ? facts.join('; ') : 'no contributing grant was recorded';
  return { basedOn, notChecked: NOT_CHECKED };
}

module.exports = { findingBasis, NOT_CHECKED };
