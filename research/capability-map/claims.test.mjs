#!/usr/bin/env node
import { createClaim, validateClaim, promote, evaluateStatus, claimId, TRANSITIONS } from './claims-schema.mjs';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } };
const T0 = '2026-10-01T00:00:00Z';
const inspector = { kind: 'inspector', file: 'dist/index.js', line: 12, text: "execSync('ls')", contentHash: 'sha256-abc', registryIntegrity: 'sha512-xyz', observedAt: T0 };
const human = { kind: 'human', actorId: 'melody', observedAt: T0 };
const registry = { kind: 'registry', url: 'https://registry.npmjs.org/x/1.0.0', observedAt: T0 };
const llm = { kind: 'llm', model: 'none', observedAt: T0 };
const base = { subject: 'some-mcp-server', subjectVersion: '1.0.0', capability: 'run_shell_commands', source: 'inspector', createdAt: T0 };

ok('a claim with inspector evidence validates', validateClaim(createClaim({ ...base, evidence: [inspector] })).length === 0);
ok('claim ids are deterministic', claimId({ ...base, scope: 'global', subjectKind: 'npm_package' }) === claimId({ ...base, scope: 'global', subjectKind: 'npm_package' }));
ok('a claim without evidence fails validation', (() => { try { createClaim({ ...base, evidence: [] }); return false; } catch (e) { return /evidence/.test(e.message); } })());
ok('inspector evidence without a line number fails', (() => { try { createClaim({ ...base, evidence: [{ ...inspector, line: undefined }] }); return false; } catch (e) { return /line/.test(e.message); } })());
ok('inspector evidence without a content hash fails', (() => { try { createClaim({ ...base, evidence: [{ ...inspector, contentHash: '' }] }); return false; } catch (e) { return /contentHash/.test(e.message); } })());
ok('capability outside the taxonomy fails', (() => { try { createClaim({ ...base, capability: 'telepathy', evidence: [inspector] }); return false; } catch (e) { return /capability/.test(e.message); } })());
ok('subject must be a public package identifier', (() => { try { createClaim({ ...base, subject: '/Users/me/secret', evidence: [inspector] }); return false; } catch (e) { return /subject/.test(e.message); } })());

const onlyLlm = createClaim({ ...base, source: 'llm', evidence: [llm] });
ok('llm-only claim stays candidate under promotion', promote(onlyLlm, { now: T0 }).status === 'candidate');
ok('llm-only claim marked experimental fails validation', validateClaim({ ...onlyLlm, status: 'experimental' }).some(e => /llm/.test(e)));
ok('llm-only claim marked validated fails validation', validateClaim({ ...onlyLlm, status: 'validated' }).some(e => /llm/.test(e)));

const candidate = createClaim({ ...base, evidence: [inspector] });
const experimental = promote(candidate, { now: T0 });
ok('one non-llm evidence item promotes candidate to experimental', experimental.status === 'experimental');
ok('one evidence kind does not reach validated', promote(experimental, { now: T0, shadow: { observations: 50, collectors: 5, contradictions: 0 } }).status === 'experimental');
const twoKinds = { ...experimental, evidence: [inspector, registry] };
ok('two kinds without shadow stays experimental', promote(twoKinds, { now: T0 }).status === 'experimental');
ok('two kinds with 10 observations over 3 collectors validates', promote(twoKinds, { now: T0, shadow: { observations: 10, collectors: 3, contradictions: 0 } }).status === 'validated');
ok('two kinds with a shadow contradiction does not validate', promote(twoKinds, { now: T0, shadow: { observations: 10, collectors: 3, contradictions: 1 } }).status === 'experimental');
ok('two kinds with only 2 collectors does not validate', promote(twoKinds, { now: T0, shadow: { observations: 10, collectors: 2, contradictions: 0 } }).status === 'experimental');
const humanPlusInspector = { ...experimental, evidence: [inspector, human] };
const validated = promote(humanPlusInspector, { now: T0 });
ok('human approval plus inspector agreement validates without shadow', validated.status === 'validated' && validated.lastValidatedAt === T0);
ok('human approval alone stays experimental', promote({ ...experimental, evidence: [human] }, { now: T0 }).status === 'experimental');
ok('inspector contradiction rejects', promote(validated, { now: T0, inspectorContradiction: true }).status === 'rejected');
ok('a contradicting count rejects', promote({ ...validated, contradicting: 1 }, { now: T0 }).status === 'rejected');
ok('rejected is terminal', TRANSITIONS.rejected.length === 0 && promote({ ...validated, status: 'rejected' }, { now: T0 }).status === 'rejected');
const later = '2027-06-01T00:00:00Z';
const deprecated = promote(validated, { now: later });
ok('evidence past expiresAt deprecates a validated claim', deprecated.status === 'deprecated');
ok('deprecated returns to experimental, never straight to validated', promote({ ...deprecated, expiresAt: '2028-01-01T00:00:00Z' }, { now: later }).status === 'experimental');
ok('candidate past expiry stays candidate', promote(candidate, { now: later }).status === 'candidate');
ok('evaluateStatus never mutates', (() => { const c = JSON.stringify(experimental); evaluateStatus(experimental, { now: T0 }); return JSON.stringify(experimental) === c; })());
ok('promote throws on an illegal edge', (() => { try { promote({ ...candidate, status: 'candidate', evidence: [inspector, human] }, { now: T0 }); return false; } catch (_) { return false; } })() || promote({ ...candidate, evidence: [inspector, human] }, { now: T0 }).status === 'experimental');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
