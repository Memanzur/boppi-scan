# Boppi master task ledger

Living record of every roadmap item the autonomous sessions work through, with its state, the evidence, and what blocks it. Updated at every checkpoint; the same file is mirrored in `~/Desktop/Boppi-auto/BOPPI_TASK_LEDGER.md`. Roadmap: `~/Desktop/Boppi-auto/BOPPI_ROADMAP_2026.md`. Decision trail: `docs/milestone1/DECISIONS.tsv`. Adjudicated findings: `docs/milestone1/ADJUDICATION.md`.

States: `done` (implemented, tested, committed locally), `open` (safe local work not started), `in progress`, `blocked: founder` (needs a decision or an authorization), `blocked: human gate` (a human study or an external review that an agent must never mark complete), `deferred` (recorded follow-up, not scheduled).

Nothing in this ledger was pushed, published, deployed, or applied to a real configuration. Scanner worktree `~/Desktop/boppi-scan-auto` (branch `codex/live-brand-alignment`), control plane `~/Desktop/Boppi-auto`.

## Phase 0: five-user beta and understandable findings

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P0-1 | Synthetic test kit, scoring sheet, observation CSV, questionnaire, demo, fix/verify/rollback exercise | done (2026-10-20) | `~/Desktop/Boppi-phase0-beta-2026-10-20/` (frozen on package 0.3.1) | Founder decision: run the sessions on the frozen 0.3.1 kit or on the 0.4.0 candidate kit (`~/Desktop/Boppi-candidate-0.4.0/kit`). Recommended: 0.4.0, because the Phase 1 explanations changed. |
| P0-2 | Five completed sessions, scores, questionnaires, adjudication ledger | blocked: human gate | 0 of 5 run | Recruitment and facilitation are the founder's. Never simulated. |

## Phase 1: trustworthy findings v1 (Milestone 1)

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P1-1 | Deny precedence, unreadable settings, built-in grant attributes | done | 3887b33; `test/verify-builtin-tools.js` | |
| P1-2 | `boppi verify` states what closed and what remains; zero-benefit edits never read as fixes | done | fcd3792; `test/verify-predictions.js` | |
| P1-3 | Read-only cluster tools are not production write; Docker tags are not pins | done | 1d32b63; corpus L03, L09, L10, H03, N11 | |
| P1-4 | Labeled corpus, 54 cases, 17 held out, labels before rules | done | 21be9f0, dc055b1; `test/verify-rubric-corpus.js` | Four corrections logged; corrected cases leave the held-out split. |
| P1-5 | Rubric 1.0.0 (priority = impact stepped down by evidence; facts, assumptions, unknowns on every surface) | done | 7688849, 87d6a3a | |
| P1-6 | Independent cross-model review of 1.0.0 and rubric 1.0.1 closing its eight findings | done | 0df3b3e; ADJUDICATION rows 12 to 19 | |
| P1-7 | Founder review of 1.0.1: plain-English answers to the five questions, metrics with denominators, remaining wrong answers, 0.4.0 versus 0.3.1, beta-blocking problems | done (2026-10-22) | Reply of 2026-10-22; DECISIONS row "founder asked for plain-English review" | |
| P1-8 | Rubric 1.0.2: production access by evidence tier (question 5 resolved on the founder's instruction); Claude Code WebFetch and WebSearch modeled; lowered-priority predictions; built-in residual; cost line honest about built-in coverage | done (2026-10-23) | 7cce8b5, d3defa9; ADJUDICATION rows 20 to 23; 23 of 23 suites; corpus 54 of 54 (held-out critical 5/5 and 5/5, high-or-critical 21/21 and 21/21); control plane 71af421, engine port 26 checks | Cross-model review of 1.0.2 requested 2026-10-23 (findings to be adjudicated when it lands). |
| P1-14 | Independent cross-model review of 1.0.2 and rubric 1.0.3 closing its seventeen findings (WebFetch and WebSearch as separate grants, AGENTS band pinned to the worst open finding or path, `rubricVersion` on predictions, honest residual sentence, credentialed connectors never covered by built-in web, Lower label, fix lists a lowered path once, directory arguments out of the catalog haystack) | done (2026-10-23) | d98e700; ADJUDICATION rows 24 to 41; 24 of 24 suites; corpus 54 of 54 unchanged | Still open from the review: lowered prediction across an agent id remap (no fixture reaches it); Cursor residual sentence; `builtinResidual` is not in the push payload. |
| P1-9 | Rubric sign-off by the founder and a security reviewer | blocked: human gate | `docs/milestone1/RISK_RUBRIC_v1.0.3.md` open questions 1 to 4, 6, and 7 | Never marked approved on the founder's behalf. |
| P1-10 | Five uncoached comprehension sessions after the changes | blocked: human gate | 0 of 5 | |
| P1-11 | Question 1 follow-up: names-only secret-marker check in an ordinary folder | deferred | Recommended in the 2026-10-22 review | Needs the founder's answer; labels first, then a rubric version bump. |
| P1-12 | Settings-based fix action (offer a `permissions.deny` edit for a built-in tool, with preview, backup, and rescan) | deferred | Residual sentence names the location today; Boppi never edits settings | Design needs the founder's consent model; today's report only points at the file. |
| P1-13 | Claude Desktop and Cursor web features | deferred | Not modeled; reported as unknowns | Needs evidence of each client's tool table. |

## Phase 2: individual beta release gate (Milestone 2)

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P2-1 | Candidate journey: pack, fresh install, version, scan, demo, plan, fix, verify, rollback, uninstall | done | 496eb50; `npm run release-candidate` originally 20/20; resumed preparation extends it to 29/29 with interactive QA-wrapper checks | |
| P2-2 | Candidate manifest, release note (supported, install, remove, limits, reporting, withdrawal) | done | `~/Desktop/Boppi-candidate-0.4.0/CANDIDATE.json` (authoritative commit/checksum; package 0.4.0, rubric 1.0.3); `docs/release/CANDIDATE-0.4.0.md` | Earlier builds kept as `Boppi-candidate-0.4.0-superseded-rubric-1.0.0` and `-1.0.1`. |
| P2-3 | Version agreement check (package, engine, rubric, changelog, README, manifest) | done | 1c34b24; `npm run verify-versions` | |
| P2-4 | Six-case facilitator kit rebuilt from the exact tarball | done | fbaed03; `scripts/candidate-kit/prepare-fixtures.py`; `~/Desktop/Boppi-candidate-0.4.0/kit` | |
| P2-5 | Linux and Windows config-location lookups exercised by the journey on macOS (path lookup only, platforms stay experimental) | done (2026-10-23) | 35cb3be; `npm run release-candidate` (22 checks) | Platforms stay experimental until a tester runs the candidate there. |
| P2-6 | Tester-facing wording pass on the candidate note and BETA_TESTER_GUIDE for 0.4.0 | done (2026-10-23) | `docs/release/CANDIDATE-0.4.0.md` (what is new, known limits); `BETA_TESTER_GUIDE.md` (lowered versus closed, built-in paths on Claude Code, question for testers) | Re-read after the 1.0.2 review is adjudicated. |
| P2-7 | Five testers complete install and demo without code edits | blocked: human gate | | |
| P2-8 | Publish to npm, tag, website link | blocked: founder | NPM_TOKEN missing; publication needs explicit authorization | |

## Phase 3: real MCP tools and permission-scope accuracy

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P3-1 | Feasibility and threat-model spike document (transport and version support, consent, process side effects, hostile descriptions) | done (2026-10-23) | `docs/phase3/DISCOVERY_SPIKE.md` | Four founder decisions in section 12 (package-fetch launchers, description storage, HTTP scope, cache age). P3-2 fixtures can start without them. |
| P3-2 | Fixture MCP servers (paginated tools, changed lists, no tools, malformed and oversized data, timeout, auth rejection, misleading read-only annotations, hostile descriptions), projection validator, protocol recorder | done (2026-10-23) | `test/fixtures/mcp-servers/` (eight fixtures, frozen projections), `src/cli/discovery/projection.js`, `recorder.js`; `test/verify-discovery-fixtures.js` 29 checks; passive commands now refuse `child_process` in `verify-no-network.js` | The test driver is test-only; the product session is P3-3. |
| P3-3 | Consented discovery adapter with bounded `initialize` and `tools/list`, cancellation, timeout, cache invalidation, protocol recorder proving no `tools/call` | done (2026-10-23) | `boppi discover`: `src/cli/discovery/{session,discover}.js`; `test/verify-discover.js` (25 checks: consent, refusals, bounds, rejection, hostile canaries, record method set, cache mode and staleness, lock, forget); `test/verify-no-network.js` (passive commands start no process; a consented discover is the only spawn) | Section-12 decisions applied as recommended until the founder decides (package-fetching launchers refused outright, 160-character descriptions, no HTTP, 7-day cache). The passive scan does not read the cache yet (P3-4). The 0.4.0 candidate stays at the Milestone 2 scope (d6bc40f); discover ships in a later candidate. |
| P3-4 | Per-tool read, write, action scope and advertised versus established authorization | done (2026-10-23) | `basis: advertised` in `models.ATTRIBUTE_SCHEMA`, `knownServers.inferCapabilities` (stored list via `discover.advertisedLookup`, entry hash and 7-day age), provider reason text, rubric text, terminal and HTML server lines, export `advertised` summary; `test/verify-discover.js` scan section | Advertised = 0 steps for existence (same as catalog), reason says not verified; rubric stays 1.0.3 because no existing grade changes and the rule applies only after a consented discovery. Per-tool read/write/action scope beyond the existing reach table is not modeled; `readOnlyHint` annotations are stored, not graded. |
| P3-5 | One consented real integration compared with an independently inspected inventory | blocked: founder | | Needs a real server the founder designates. |

## Phase 4: opt-in configuration monitoring

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P4-1 | Foreground `boppi watch` design and implementation (explicit watched clients, debounce, periodic rescan, atomic-write recovery, own-edit suppression, local change summaries) | done (2026-10-23) | `src/cli/watch.js`; `docs/phase4/WATCH_DESIGN.md`; `test/verify-watch.js` (37 checks: change seen in 0.6 s with a 1 s interval, 20-write burst into 2 summaries, atomic rename, delete, invalid JSON, own edit labelled by fix id); `test/verify-no-network.js` (`watch --once` starts no process, no network) | Own edits are labelled (`changed by boppi fix <id>`), not suppressed, so a fix is never hidden. Soak measurement is P4-3. |
| P4-2 | Retirement semantics for unreadable, deleted, empty, and limited scans | done (2026-10-23) | `docs/phase4/WATCH_DESIGN.md` table; `watch.reconcile` pure-function checks in `test/verify-watch.js` | Missing or unreadable: hold one 2 s grace rescan; then deleted retires with cause, unreadable stays stale with no closure; zero servers from a readable file retires; failed client held as not analyzed; `--only` never changes an unwatched client. |
| P4-3 | Soak and burst measurements against the stated budget | done, bounded (2026-10-23); 24-hour soak open: founder | `scripts/watch-soak.js`; `docs/phase4/SOAK_2026-10-23.md` (160 s run on an Apple M1: idle median CPU 0.00%, max 3.9% at the periodic rescan, max RSS 67.3 MiB; 200 writes in 10 s coalesced into 1 summary with the final state) | Budget (roadmap): median idle CPU under 1%, memory under 100 MiB. The 24-hour run is `node scripts/watch-soak.js --idle 86400` on the founder's reference machine; not run by an agent. |
| P4-4 | Background installation and cloud heartbeat opt-ins | blocked: founder | | Persistent services are not authorized. |

## Phase 5: team beta and hosted parity

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P5-1 | Migration reconciliation note for the four pending migrations and a restore rehearsal plan | done, document (2026-10-23) | `docs/release/MIGRATION_RECONCILIATION_2026-10-23.md` (control plane): per-migration table (changes, dependents, reversibility), fixed order and why, failure handling, six-step founder rehearsal, what the note does not claim | Execution (backup secrets, restore, `migrate-production.sh --apply`, app promotion) is the founder's. |
| P5-2 | Dashboard shows the pushed recognition field | done (2026-10-23) | `lib/engine/inventory.ts` parses `metadata.recognition` with a value allowlist into `recognitionByServerId`; `lib/engine/analyze.ts` carries it; AI inventory page lists every MCP server as recognized, not recognized, or not reported, with the launcher and a pin label; `scripts/verify-engine-port.ts` (30 checks: carried, stray values dropped, absent stays absent) | A server pushed by a scanner older than 0.3.1 shows not reported with a rescan hint. |
| P5-3 | Disposable-stack rehearsal, staging, production promotion, cohort | blocked: founder | Docker off; staging writes need separate authorization | |

## Phases 6 to 10

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P6-1 | Local runtime collector slice: event ids, pre/post correlation, concurrency-safe recording, local timeline | done, local (2026-10-23) | `src/cli/hook.js` (schema 2: keyed invocation and session ids, source, six outcomes, O_APPEND lines, rename rotation, segment retention with a counted `segment_cap`, capped health file, exit 0 on every input and flag, disable/enable/forget), `src/cli/events.js` (`boppi events` timeline with every gap, partial-window line), `docs/phase6/RUNTIME_COLLECTOR.md`, `test/verify-hook-collector.js` (39 checks: 10 concurrent sessions, 1,000 records, rotation, canaries, review cases); review rows 68-75 fixed | Live calls and the version pin are founder-run (`docs/phase6/LIVE_VALIDATION_PLAN.md`); deny rules/manual rejection do not trigger PermissionDenied, and cancellation can leave an unknown outcome; cloud runtime transport stays gated. Segment cap versus partial window is a founder choice. |
| P7-1 | Suspicious-prompt feasibility spike | done, document (2026-10-23) | `docs/phase7/SUSPICIOUS_PROMPT_SPIKE.md`: which hook fields expose content (prompt, tool_input, tool_response, error, reason), what stays invisible (system and loaded instructions, non-hook content channels, the transcript), a bounded design with separate content consents, acceptance plan, stop conditions | Implementation needs the founder's content-consent decision; no prompt content is read today. |
| P8-1 | Evidence layers (configured, advertised, observed, hypothesis) and mixed-evidence fixtures | done, local (2026-10-23) | `src/cli/evidence.js` builds `evidenceLayers` per server and path (source, basis, versions, window, uncertainty, coverage; observed calls carry `callKeys`, match Claude Code servers on the tool-name charset, strip a scope suffix only when the scan added it, `ambiguous` on collisions, unmatched calls listed and printed; paths stay possible reach); terminal and HTML `runtime:` line; `docs/phase8/EVIDENCE_LAYERS.md`; `test/verify-evidence-layers.js` (23 fixtures, 143 checks); review rows 76-78 fixed; 29 of 29 suites | Not done: dashboard agreement (push does not send layers; founder consent decision for hashed ids), five explanation checks (human gate). |
| P8-2 | Traversal budget visible and large-graph measurement | done, local (2026-10-23) | `exposurePathEngine.analyze` returns `traversal` (depth 6, visited 2,000 per agent, paths 200; which cap, which agent; `complete`); `findPaths` unchanged; scan export `traversal`, terminal and HTML search-limit line, dashboard paths banner; `scripts/large-graph-bench.js` (1,153 nodes, 6,002 edges, p95 7.5 ms on Apple M1, `docs/phase8/LARGE_GRAPH_2026-10-23.md`); `test/verify-traversal-budget.js` drives each cap; control plane engine synced (verify-engine-port 31) | A real configuration of that size was not scanned; memory not measured. |
| P9-1 | Dashboard-initiated remediation threat model and local state machine | done, design and local tests (2026-10-23) | `lib/remediation/proposal.ts` (typed allowlisted `remove_server` and `rollback` proposals bound to org, device, client, project, target file, server, config hash, versions, preview hash, expected keys, capability loss, nonce, expiry; binding built from a validated key list; binding hash and record hash recomputed on every transition; proposed, previewed, approved, executing, applied, verified, verification_failed, declined, expired, cancelled, conflicted, rolled_back; abandon; per-device per-file lock; consumed nonces; collector principals and analyst or read-only roles refused; expiry never erases an executing or applied edit); `scripts/verify-remediation-state.ts` 311 checks in `npm run verify`; `docs/phase9/REMEDIATION_THREAT_MODEL.md`; review rows 58-67 fixed | No tables, connector, pairing, routes, or dashboard screens; independent security review and the consented real-device pilot are founder gates; two-person rule and rollback window are founder decisions. |
| P10-1 | Governance discovery note | blocked: founder | | Needs two design partners the founder recruits; no local work exists that does not presume their answers. |

## Interrupted-session preparation completed (2026-10-23)

- Tester demo commands now use the sandbox's actual client and quote a saved scan path containing spaces; `test/verify-demo.js` 9 checks. `scripts/candidate-kit/session.py` runs only sandbox actions against the installed candidate, with interactive confirmation retained. Fresh package journey: 29/29, including QA start, plan, fix, verify, rollback, preservation, and no T1-T5 homes.
- The control-plane ledger mirror is reconciled with this file and checked by `npm run verify:ledger`; an explicitly configured missing scanner ledger fails. Match, mismatch and extra-line handling checked locally.
- Founder decisions: `Boppi-auto/docs/validation/FOUNDER_DECISION_REGISTER.md`; rubric companion: scanner `docs/milestone1/RUBRIC_1.0.3_FOUNDER_QUESTIONS.md`. Recommendations are proposals, not approvals.
- Human-session materials: `Boppi-auto/docs/beta/usability-kit-0.4.0/` (README, consent, blank session sheet). Install evidence is separate from an already prepared runtime. Human sessions remain 0/5.
- Security review brief: `Boppi-auto/docs/validation/SECURITY_REVIEW_PACKAGE.md`. Live-check procedure isolates the event home and cleanup, records unavailable outcomes, and makes no stopwatch-based hook p95 claim. Fixture 7 checks and static HTML accessibility 26 checks are included in the scanner's 31 suites; these are limited synthetic/static checks, not a live-client or full accessibility audit.
- The local unpublished candidate is rebuilt for the demo fix, with the prior directory preserved; its manifest names the source commit and checksum. This snapshot includes later local discovery/monitoring code and needs explicit release-scope review before publication.

## Updated founder directive — Agent, Cloud, Intelligence (2026-10-23)

Current product authority: `BOPPI_MASTER_PLAN.md` in the control-plane repo (supersedes enterprise-only historical architecture). Detailed older phase acceptance remains in `BOPPI_ROADMAP_2026.md`; previous founder/human gates remain unchanged. The current directive authorizes the independent local slices below.

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| U-1 | Recover all worktrees/versions and assess current Opal, Snyk Agent Scan, Zenity, Astrix, Runlayer | done, local/research | `docs/validation/STATE_RECOVERY_2026-10-23.md`; `docs/research/COMPETITIVE_GAPS_2026-10-23.md` (control plane); 24 worktree statuses recorded, four dirty historical trees preserved | Competitor pages document overlapping capabilities; differentiation/adoption remain unvalidated |
| U-2 | Explicit cloud-sync enrollment/consent, withdrawal and scoped collector erasure | done, local code/SQL | control-plane `docs/validation/SYNC_PRIVACY_2026-10-23.md`; 65 database checks including four real transaction races; control-plane verify green, consent tests 4, remediation 311; synthetic shared-form browser proof at 1280/390px | Migration `20261024043421_collector_sync_privacy.sql` remains local/unapplied. Full authenticated browser journey, hosted review and deployment remain gated/unrun. Ingestion collector is not a paired remediation device |
| U-3 | Grounded read-only access questions over explicitly supplied local exports | open | Reuse inventory, rubric/path facts, prediction seams | Deterministic supported questions only; no LLM, invented relationships, private collection or inferred unused-permission claim |
| U-4 | Synthetic Observe → Propose → Evaluate → Review → Version → Distribute → Verify demonstration | open | Existing overlay and prediction verification are reusable; static inspector experiment remains failed | Frozen/held-out evaluation, poisoned proposals refused, signed versioned inactive bundles, human review required; no production rule activation |

## Standing rules

- Human gates (P0-2, P1-9, P1-10, P2-7) are never marked done by an agent.
- Every unit ends with: tests run and recorded, security and privacy check, local commit, a `DECISIONS.tsv` row, this ledger, and the handoff files.
- When a task is blocked by a founder decision, record it here and move to the next open item.
