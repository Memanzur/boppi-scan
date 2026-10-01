// Capability claim schema and lifecycle. Pure functions, no I/O.
// Lifecycle: candidate -> experimental -> validated | rejected | deprecated, per LEARNING_ARCHITECTURE.md section 8.
import crypto from 'node:crypto';

export const CATEGORIES = Object.freeze(['read_files','write_files','delete_files','read_email','send_email','read_calendar','modify_calendar','read_source_code','modify_source_code','access_customer_data','access_financial_data','access_health_data','access_hr_data','execute_code','run_shell_commands','browse_internet','call_external_api','send_external_message','create_or_modify_records','make_purchase','access_credentials','access_environment_variables','browser_automation','access_production_system','untrusted_external_content','unknown']);
export const STATUSES = Object.freeze(['candidate', 'experimental', 'validated', 'rejected', 'deprecated']);
export const SOURCES = Object.freeze(['catalog', 'registry', 'inspector', 'human', 'llm']);
export const SUBJECT_KINDS = Object.freeze(['npm_package', 'pypi_package', 'command']);
export const EVIDENCE_KINDS = Object.freeze(['inspector', 'human', 'registry', 'config', 'prediction', 'llm']);
export const PACKAGE_CLAIM_TTL_DAYS = 180;

// Allowed edges. Deprecated drops back to experimental, never straight to validated.
export const TRANSITIONS = Object.freeze({
  candidate: ['experimental', 'rejected'],
  experimental: ['validated', 'rejected', 'deprecated'],
  validated: ['rejected', 'deprecated'],
  deprecated: ['experimental', 'rejected'],
  rejected: [],
});

// Fields each evidence kind must carry. Inspector evidence pins the exact bytes it was read from.
const EVIDENCE_FIELDS = Object.freeze({
  inspector: ['file', 'line', 'text', 'contentHash', 'registryIntegrity', 'observedAt'],
  human: ['actorId', 'observedAt'],
  registry: ['url', 'observedAt'],
  config: ['ref', 'observedAt'],
  prediction: ['predictionId', 'observedAt'],
  llm: ['model', 'observedAt'],
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SAFE_SUBJECT = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function claimId(claim) {
  const key = [claim.scope, claim.subjectKind, claim.subject, claim.subjectVersion || '', claim.capability].join('\0');
  return 'claim-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Returns a list of schema errors. Empty means valid. */
export function validateClaim(claim) {
  const errors = [];
  if (!claim || typeof claim !== 'object') return ['claim must be an object'];
  if (typeof claim.id !== 'string' || !claim.id.startsWith('claim-')) errors.push('id must be a claim- string');
  if (claim.scope !== 'global' && typeof claim.scope !== 'string') errors.push('scope must be global or an org id');
  if (!SUBJECT_KINDS.includes(claim.subjectKind)) errors.push('subjectKind invalid');
  if (typeof claim.subject !== 'string' || !SAFE_SUBJECT.test(claim.subject)) errors.push('subject must be a public package identifier');
  if (claim.subjectVersion != null && typeof claim.subjectVersion !== 'string') errors.push('subjectVersion must be a string');
  if (!CATEGORIES.includes(claim.capability) || claim.capability === 'unknown') errors.push('capability must be one of the 25 named categories');
  if (!STATUSES.includes(claim.status)) errors.push('status invalid');
  if (!SOURCES.includes(claim.source)) errors.push('source invalid');
  if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) errors.push('evidence must be a non-empty array');
  else claim.evidence.forEach((e, i) => {
    if (!e || !EVIDENCE_KINDS.includes(e.kind)) { errors.push(`evidence[${i}].kind invalid`); return; }
    for (const field of EVIDENCE_FIELDS[e.kind]) {
      const v = e[field];
      if (v == null || v === '' || (field === 'line' && !(Number.isInteger(v) && v > 0))) errors.push(`evidence[${i}].${field} missing (${e.kind})`);
    }
    if (e.observedAt && !ISO.test(e.observedAt)) errors.push(`evidence[${i}].observedAt not ISO`);
  });
  for (const field of ['supporting', 'contradicting']) if (!Number.isInteger(claim[field]) || claim[field] < 0) errors.push(`${field} must be a non-negative integer`);
  for (const field of ['createdAt', 'expiresAt']) if (!ISO.test(claim[field] || '')) errors.push(`${field} must be ISO`);
  if (claim.lastValidatedAt != null && !ISO.test(claim.lastValidatedAt)) errors.push('lastValidatedAt must be ISO or null');
  if (typeof claim.engineVersionMin !== 'string') errors.push('engineVersionMin must be a string');
  if (Array.isArray(claim.evidence) && claim.status !== 'candidate' && claim.status !== 'rejected' && !hasNonLlmEvidence(claim)) errors.push('only llm evidence: status may not leave candidate');
  return errors;
}

export function hasNonLlmEvidence(claim) {
  return (claim.evidence || []).some(e => e.kind !== 'llm');
}

function evidenceKinds(claim) {
  return new Set((claim.evidence || []).filter(e => e.kind !== 'llm').map(e => e.kind));
}

function isExpired(claim, now) {
  return new Date(claim.expiresAt).getTime() <= new Date(now).getTime();
}

/**
 * Compute the status a claim has earned. Pure: never mutates.
 * context: { now, shadow: { observations, collectors, contradictions }, inspectorContradiction }
 */
export function evaluateStatus(claim, context = {}) {
  const now = context.now || new Date().toISOString();
  const shadow = context.shadow || { observations: 0, collectors: 0, contradictions: 0 };
  if (claim.status === 'rejected') return 'rejected';
  if (context.inspectorContradiction || claim.contradicting > 0) return 'rejected';
  if (!hasNonLlmEvidence(claim)) return 'candidate';
  if (isExpired(claim, now)) return claim.status === 'candidate' ? 'candidate' : 'deprecated';
  const kinds = evidenceKinds(claim);
  const humanAndInspector = kinds.has('human') && kinds.has('inspector');
  const shadowEarned = shadow.observations >= 10 && shadow.collectors >= 3 && shadow.contradictions === 0;
  const validated = kinds.size >= 2 && (shadowEarned || humanAndInspector);
  if (claim.status === 'deprecated') return 'experimental';
  if (claim.status === 'validated') return validated ? 'validated' : 'experimental';
  if (validated && claim.status === 'experimental') return 'validated';
  return 'experimental';
}

/** Apply one lifecycle step. Returns a new claim; throws on an edge the lifecycle forbids. */
export function promote(claim, context = {}) {
  const target = evaluateStatus(claim, context);
  if (target === claim.status) return claim;
  if (!TRANSITIONS[claim.status].includes(target)) throw new Error(`illegal transition ${claim.status} -> ${target}`);
  const now = context.now || new Date().toISOString();
  return { ...claim, status: target, lastValidatedAt: target === 'validated' ? now : claim.lastValidatedAt };
}

export function createClaim(fields) {
  const createdAt = fields.createdAt || new Date().toISOString();
  const expiresAt = fields.expiresAt || new Date(new Date(createdAt).getTime() + PACKAGE_CLAIM_TTL_DAYS * 86400000).toISOString();
  const claim = {
    scope: 'global', subjectKind: 'npm_package', status: 'candidate', supporting: 0, contradicting: 0,
    lastValidatedAt: null, engineVersionMin: '0.1.0', ...fields, createdAt, expiresAt,
  };
  claim.id = fields.id || claimId(claim);
  const errors = validateClaim(claim);
  if (errors.length) throw new Error('invalid claim: ' + errors.join('; '));
  return claim;
}
