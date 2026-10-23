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
| P2-1 | Candidate journey: pack, fresh install, version, scan, demo, plan, fix, verify, rollback, uninstall | done | 496eb50; `npm run release-candidate` 20 of 20 | |
| P2-2 | Candidate manifest, release note (supported, install, remove, limits, reporting, withdrawal) | done | `~/Desktop/Boppi-candidate-0.4.0/CANDIDATE.json` (rubric 1.0.2, scanner d3defa9, sha256 9ab93ff6…); `docs/release/CANDIDATE-0.4.0.md` | Earlier builds kept as `Boppi-candidate-0.4.0-superseded-rubric-1.0.0` and `-1.0.1`. |
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
| P4-3 | Soak and burst measurements against the stated budget | open | | Bounded synthetic runs; a 24-hour soak is a founder-scheduled run. |
| P4-4 | Background installation and cloud heartbeat opt-ins | blocked: founder | | Persistent services are not authorized. |

## Phase 5: team beta and hosted parity

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P5-1 | Migration reconciliation note for the four pending migrations and a restore rehearsal plan | open | `BOPPI_NEXT_SESSION.md` (prod migrations pending) | Document only; execution needs the founder's DB authorization. |
| P5-2 | Dashboard shows the pushed recognition field | open | Pushed since 66532fd; not displayed | Small control plane slice. |
| P5-3 | Disposable-stack rehearsal, staging, production promotion, cohort | blocked: founder | Docker off; staging writes need separate authorization | |

## Phases 6 to 10

| Id | Task | State | Evidence | Blocker or next |
| --- | --- | --- | --- | --- |
| P6-1 | Local runtime collector slice: event ids, pre/post correlation, concurrency-safe recording, local timeline | open | Hook prototype exists (`src/cli/hook.js`) | After Phase 3 identity work; local only. |
| P7-1 | Suspicious-prompt feasibility spike | open | | After P6-1; document only. |
| P8-1 | Evidence layers (configured, advertised, observed, hypothesis) and 20 mixed-evidence fixtures | open | | Baseline contract from Phase 1 exists. |
| P9-1 | Dashboard-initiated remediation threat model and local state machine | open | | Design and local tests only; no connector pairing. |
| P10-1 | Governance discovery note | open | | Needs design partners (founder). |

## Standing rules

- Human gates (P0-2, P1-9, P1-10, P2-7) are never marked done by an agent.
- Every unit ends with: tests run and recorded, security and privacy check, local commit, a `DECISIONS.tsv` row, this ledger, and the handoff files.
- When a task is blocked by a founder decision, record it here and move to the next open item.
