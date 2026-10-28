# Current checkpoint (read first) — updated 2026-10-27 23:03 MDT

Melody's standing instruction (2026-10-27): the Mac restarts unexpectedly, so work in small verified milestones, commit each locally, and keep this file current. At the start of every session:

1. Run `bash ~/Desktop/Boppi-auto/scripts/session-preflight.sh` (read-only). It shows uncommitted changes, interrupted git operations, leftover processes, ports, Docker and disposable databases, plus the scanner test state.
2. Never discard uncommitted changes. Read the diff, compare it with "In progress" below, then finish or commit it.
3. Check for partial side effects before you restart anything. Never repeat a migration against any Supabase project. The disposable test databases (`npm run test:db:local`, plain Postgres in a mktemp dir on port 54391) are safe to rerun. Local Supabase Docker stacks hold volumes, so inspect them before you reset them.
4. Rerun only the tests you need. In the scanner, `npm test -- --resume` skips suites that already passed on identical code, and `npm test -- --only a.js,b.js` runs a subset.

Not authorized: push, merge, deploy, publish, Gate B/C, any production or hosted change, billing, DNS, credentials, Soccer App (`abmxjvstbepetqskipby`).

## Goal

An externally testable beta: a stranger signs up on hosted Boppi Cloud, installs the Agent on their own computer, pairs, sees findings, approves a supported fix, verifies it and returns later. Plan: `docs/release/BUILD_ROADMAP_2026-10-27.md` (Milestones A to E, the next ten tasks) and `docs/release/EXTERNAL_BETA_READINESS_2026-10-27.md`. The full Agent + Cloud + Intelligence vision stays in `BOPPI_PRODUCT_VISION.md`, including planned JIT privileges (`docs/design/JIT_PRIVILEGE_MANAGEMENT_2026-10-27.md`, decisions D-34 to D-37).

## Repositories (all local, nothing pushed)

| Repo | Branch | Head at this checkpoint |
| --- | --- | --- |
| Scanner `~/Desktop/boppi-scan-auto` | codex/live-brand-alignment | b61416c (T-9) + mirror ff7fa9b |
| Control `~/Desktop/Boppi-auto` | codex/live-brand-alignment | 31aaab6 (routes probe fix) + this handoff commit |
| Website `~/Desktop/Boppi-website-positioning` | codex/homepage-positioning | 49aa147 (B-4/B-5, not deployed) |

The Desktop paths are links into `~/Desktop/Boppi Workspace/Worktrees/` (folders regrouped 2026-10-27 21:09; see `~/Desktop/Boppi Workspace/START HERE.md`). Keep the links.

## Milestone A progress (roadmap section 4)

| Task | State | Commit | Verification |
| --- | --- | --- | --- |
| T-1 finding verifies only from complete, comparable snapshots | done | control d3a446f | test:db:local 390 PASS (rerun 2026-10-27 22:15 after the restart) |
| T-2 complete collector erasure | done | control ad8ba18 | same run; `npm run verify` exit 0, 311 remediation checks |
| T-3 same-name Claude Code servers | done (recovered after the restart) | scanner 9116f44 | `npm test` 39/39 suites, new verify-same-name-servers 19, connector 65 |
| (tooling) resumable scanner test runner | done | scanner 6bf3b43 | --resume and --only smoke-tested |
| (tooling) session preflight script | done | control, this commit | ran clean |
| T-4 connector executes only removals this device offered | done | scanner 61dcbb3 | `npm test` 39/39, connector 74 (mock workspace). Real-route journey not rerun: Docker is off after the restart; rerun it when a disposable stack is up |
| T-5 CLI fix/rollback use the connector's safe write path | done | scanner a233b19 | `npm test` 40/40, new verify-safe-writes 18 |
| T-6 approval origin decided server-side | done (scoped, see D-38) | control 4398c0f | test:db:local 390 PASS, verify exit 0. New migration 20261027130000 + down file, so 20 migrations are now pending on production on top of its 8 (Gate C plan must include the new ones). The routes and connector-journey scripts need a local Supabase stack: not rerun |
| T-7 login CSRF, signup enumeration, CSV injection | done (enumeration deferred, D-39) | control 5ac116b | test:auth-callback 16 (real route handler, forged + same-origin posts), verify exit 0 |
| T-10 push --file re-sanitize; fix predictions file out of the project | done | scanner 2621c8b, control resync 1fe2912 | `npm test` 40/40 (push 61 with planted-canary test), control verify exit 0 |
| T-8 rollback harness + down files for the newest migrations | done | control 1f1171e | test:db:rollback OK: 20 pending files each round-trip and all roll back together; negative control fails as expected; test:db:local 390 |
| T-9 documentation truth pass | done (website copy moved to B-4/B-5) | scanner b61416c, control dd00843 | scanner 40/40 (events push now exits 5 as documented), control verify exit 0 |
| B-1 specific dashboard error messages | done | control 67b53f3 | verify:flash 6 (in npm run verify), verify exit 0; signed-in Chromium on stack n89Sdo: specific texts shown, a crafted free-text error shows only the generic sentence, 0 console errors |
| B-2 applied-age display (D-27a, display only) | done | control 2d7e01c | verify:remediation 316; Chromium on stack n89Sdo shows "Applied 30 hours ago and not verified since. Run boppi connect run..." for a synthetic proposal aged by SQL |
| B-3 Intelligence label vocabulary | done | control 608b29e | verify:intelligence 8 (new parity test: every label is an engine permission category and fits the intake constraint), verify exit 0. Added run_shell_commands, execute_code, read_files, write_files, call_external_api, browse_internet; no migration |
| B-4/B-5 website copy, privacy draft, security headers | done (draft; publish is a founder call) | website 49aa147 | build + lint (same 7 warnings); under the vercel.json headers via `scripts/serve-with-headers.mjs`: guest 32, 10-25 claims 36, new `docs/release/evidence-2026-10-27-b4/check.cjs` 26; negative control: inline script, external fetch, framing all blocked. Untracked `undefined/` in the website repo is screenshot output from a 10-25 claims run without an out dir (22:48); left untouched |
| Candidate 0.4.0-32a9667 | done | candidate `~/Desktop/Boppi-candidate-0.4.0-32a9667` (read-only, sha256 1def0c21d7f397f93731afb0927beb195e3bbd147fa06ea40ad99c5d95b14ed3); demos website 89fd4e6, Cloud 8cc5131; manifest 3792103 | packaging 29/29, kit 6 cases (same outputs as 104147d), website guest 32 + claims 36, Cloud guest 16, manifest verifier 28. Docker stack n89Sdo (22:30-22:57): exact-tarball beta journey 27, remediation routes 63, real-CLI connector journey 31, browser remediation drive 59 steps. Logs in `~/Desktop/Boppi-hybrid-2026-10-27-evidence/candidate-32a9667/` |

## Recovered after the 2026-10-27 ~21:49 restart

- The session before the restart committed the JIT design (ebb12e3), the gap audit and roadmap (2c167cc), T-1 (d3a446f) and T-2 (ad8ba18). It did not update this handoff.
- It left T-3 uncommitted in the scanner (7 files, last write 21:48). With it, `npm test` showed 37/38: connector dashboard rollback broke because `rollbackTarget` passed a location without a key path. Fixed: the rollback relabels the backup's entries and checks the key path recorded in the manifest. Added the missing regression suite, then committed.
- No interrupted git operation, no leftover process, no stale disposable database. The Docker daemon was not running, so no local Supabase stack was up and none was touched. Leftover `boppi-*` temp dirs in $TMPDIR are test homes, harmless, not deleted.

## In progress

Nothing. Stack `/tmp/boppi-beta-local.n89Sdo` is stopped (volume kept) and port 3097 is free. The routes run found a test bug from T-6: the "removed origin flag" probe sent a valid approval. Fixed in 31aaab6 (63/63 after the fix). Do not reuse n89Sdo for `prepare`; make a fresh mktemp stack next time.

## Exact next steps (next five tasks)

1. B-8: local `delete_my_account` SQL test across remediation, governance and intelligence rows (disposable DB).
2. B-7: in-app privacy link.
3. B-9: deterministic demo build.
4. B-6: EP-D README wording.
5. Website leftovers from the audit: stale sitemap lastmod, Lovable README.

After that: Milestone C (signed overlay bundles), D (coverage: rebase 5a, Desktop extensions, Windows), E (operations). D-11 should now choose candidate 32a9667 (manifest `docs/release/RELEASE_MANIFEST_0.4.0-32a9667.json`); 104147d stays as the fallback.

Known pre-existing failures, not caused by this session (they fail the same on 4398c0f): legacy `node scripts/verify-exposure-paths.js` ("EP-C must fire") and `node scripts/verify-cli-scan.js` ("minimal remediation plan is shown") in Boppi-auto. They exercise the legacy extension copy and are not in `npm run verify`. Triage later.

---

# Historical: saved and stopped after release consolidation, 2026-10-27 17:13 (superseded by the checkpoint above)

Melody requested a complete local save and stop. This supersedes older feature-development instructions below. Resume only after the next user instruction. No push, merge, deploy, publish, production operation, Gate B/C, Soccer App access, or DNS/credential/account/billing/project change is authorized.

## Saved repositories and exact commits

- Scanner: ~/Desktop/boppi-scan-auto, codex/live-brand-alignment. Release-input HEAD c6d507d8440017f6381a3245ed562bf4c97bbf63; implementation 104147d48e43b5af21c8cb498a038fd9ac6e1f6b. This save adds only a handoff commit; runtime is unchanged.
- Control: ~/Desktop/Boppi-auto, codex/live-brand-alignment. Verified release-consolidation payload 0aa8bfce85d17ca00a60d66f60cc7c4ecf281995; preceding input HEAD ca68c02736a79e6d3db7e4117e01af45ad710bc4; implementation ef4cfe5e3e24cd67665fb72a37a39106bde01d02; guest sync 63213f38d1060e29464f312dfabc474ce4713300.
- Website: ~/Desktop/Boppi-website-positioning, codex/homepage-positioning. Final saved HEAD 67aa3ee88d455f46f7b98bda13e0c556ae3af682 preserves the pre-existing October 22 positioning review unchanged. Runtime/demo remains dbb8f0d5f712c2edf708609c9061d8899147b93c, base f67f264af5a1def6ad0fb848c125efc929177871.
- Pre-existing control CLI cache v2.122.0 saved separately in b99d979bfef5080f18b125741e6acf3578c04b55. This is a local metadata save, not a Supabase project or credential change.

The final handoff commits follow these payload hashes. Exact final checkout heads, commit subjects and clean statuses are saved in:
/Users/melodymanzur/Desktop/Boppi-hybrid-2026-10-27-evidence/release-revalidation-20261027T230332Z/save-checkpoint-20261027T231040Z/FINAL_REPOSITORY_REFS.json
To identify the commit containing this handoff: git log -1 --format='%H %s' -- BOPPI_NEXT_SESSION.md. This file pins payload commits; the external final-ref record identifies the subsequent handoff commits without a self-referencing hash.

## Work and completed verification

Retained the existing candidate and both already-correct demo refreshes. Updated the existing release manifest, launch checklist and blocker checkpoint in docs/release; added scripts/verify-release-manifest.mjs; mirrored this handoff. No second candidate or manifest was created. The verifier pins release inputs, permits later documentation/local-bookkeeping saves, and refuses runtime drift.

Candidate: ~/Desktop/Boppi-candidate-0.4.0-104147d. Package 0.4.0 / engine 1.1.1 / rubric 1.0.3. Frozen package/boppi-0.4.0.tgz SHA-256:
1de37969ccb1ae094c69b48800b5d27303308ead12dca7e73fb8d938da2c16d0
Candidate manifests/tarball content and permissions were preserved. Both demos match this checksum and each other.

Fresh completed checks: scanner 38/38 suites (connector 65); control verify/build exit 0 (311 remediation); disposable loopback PostgreSQL 25 migrations/368 PASS; website build/lint exit 0 (7 existing warnings), guest 32/32, claims 36/36; Cloud anonymous guest 16/16. Fresh offline exact-tarball regressions passed beta-blockers 29, config-shapes 34, review-findings 31 and no-network 27. Initial release verifier 25 checks; save-aware verifier 28 plus bad-checksum/runtime-drift/demo-hash negative controls. Syntax, diff, version and mirrored-handoff checks passed; post-commit results are in the save checkpoint.

No functionality loss detected from d154b2f to 104147d: same 69-file set, only README/connect.js differ, identical CLI help, six fresh scan exports equal with a fixed clock except duration. Runtime delta adds interrupted-rescan recovery. Control prior-pointer diff has no deleted tracked files; evaluation and recovery are retained. These are local synthetic results, not universal real-client/production proof.

Earlier completed evidence retained, not rerun: packaging 29, exact-tarball Cloud journey 27, installed connector journey 31 including severed rescan recovery, authenticated Intelligence evaluation browser 25. The initial parity-harness timestamp failure and corrected fixed-clock result are both preserved.

Evidence root: ~/Desktop/Boppi-hybrid-2026-10-27-evidence/release-revalidation-20261027T230332Z/
Final save directory: /Users/melodymanzur/Desktop/Boppi-hybrid-2026-10-27-evidence/release-revalidation-20261027T230332Z/save-checkpoint-20261027T231040Z/
It contains before/after refs, original patches/pre-existing artifacts, latest manifest copy, test logs/results and checksums. Evidence is local outside Git; no remote backup occurred. All existing branches, worktrees, candidates and earlier evidence remain preserved.

## Remaining blockers and resume instructions

Public beta remains HOLD. D-11 must select candidate 104147d; D-12 must name facilitator/participants and fill consent Notes accessible to / Notes deleted on. Human sessions remain 0/5. Rubric 1.0.3 sign-off, independent security/recovery review, applicable real-device/client consent and operational-policy decisions remain open. Hosted inventory/security, backup restore, migration parity, production auth/email/consent/withdrawal/erasure/tenant isolation, alerts, deployment, publication and live guest checks remain separately gated. Production was not queried; older live observations below are historical. Real Windows/Linux clients and live hooks remain unverified.

Sequence: local save (done) → candidate/consent/rubric and five sessions → independent review/approved pilots → authorized hosted inventory/recovery plan → separately approved Gate B → separately approved Gate C → approved Cloud deploy/live verification/operations → approved scanner publication → approved website/live checks → announcement go/no-go.

All verification runs finished. Owned loopback servers on 3097/4178 stopped; the disposable plain-Postgres suite cleaned up its cluster. Existing Docker stacks/containers/volumes were not changed. No watch/connector/hook loop was activated. All three active worktrees are checked clean at this stop checkpoint; historical worktrees remain preserved.

The cached .next build uses loopback placeholder Supabase settings (http://127.0.0.1:9) for anonymous guest verification. Rebuild with the verified disposable-stack environment before a later authorized authenticated journey; this cached build is not production configuration.

On the next user-directed session, read this checkpoint, docs/release/RELEASE_MANIFEST_0.4.0-104147d.json, LAUNCH_CHECKLIST_2026-10-27.md and FINAL_REPOSITORY_REFS.json. Check active Git statuses; run node scripts/verify-release-manifest.mjs from ~/Desktop/Boppi-auto. Do not restart completed repairs or rebuild the frozen candidate. The next substantive release dependency is D-11/D-12 and five human sessions. Work is stopped pending Melody's next instruction.

---


# Release consolidation revalidated locally — 2026-10-27 (Codex)

Current committed heads: scanner c6d507d (implementation 104147d), control ca68c02 (implementation ef4cfe5 + guest sync 63213f3), website dbb8f0d. The earlier completed consolidation was retained: both guest demos already carry SHA-256 `1de37969ccb1ae094c69b48800b5d27303308ead12dca7e73fb8d938da2c16d0`. No asset rewrite, candidate rebuild, or duplicate manifest was needed.

Updated the existing control-plane release manifest/checklist/blocker checkpoint and added `scripts/verify-release-manifest.mjs`; those edits and this mirrored handoff are uncommitted. Pre-existing CLI temp and website review files remain untouched. Fresh scanner 38/38 (connector 65), control verify/build exit 0 (311 remediation), disposable DB 25 migrations/368 PASS, website build/lint exit 0 (7 existing warnings), website guest 32, claims 36, Cloud guest 16. Exact-artifact offline regression suites pass (29/34/31/27). Release identity verifier 25 checks plus three negative controls. d154b2f → 104147d: 69 files each, only README/connect.js differ, help identical, six fresh fixture exports equal with a fixed clock except duration. No functionality loss detected; no real-device or production proof implied.

Evidence: `~/Desktop/Boppi-hybrid-2026-10-27-evidence/release-revalidation-20261027T230332Z/`. Earlier packaging 29, exact-tarball Cloud 27, installed connector 31 and Intelligence evaluation browser 25 evidence retained, not rerun. No live requests, Gate B/C, push/merge/deploy/publish, production/DNS/account/credential/billing changes, project deletion, or Soccer App operation. Owned loopback web servers stopped; Docker stacks/volumes untouched.

Next: complete D-11/D-12 candidate 104147d selection and consent note recipients/deletion date, then five human sessions. Rubric sign-off, independent review, real-client consent and hosted/live release checks remain gates. See `docs/release/LAUNCH_CHECKLIST_2026-10-27.md`; the user's current scope is release consolidation, not the older feature-development instructions below.

---

# Release consolidation 2026-10-27 (Claude, after the session below)

Melody asked to consolidate the latest candidate for the free public beta. Done locally, nothing pushed or deployed:

- `docs/release/RELEASE_MANIFEST_0.4.0-104147d.json` links scanner 104147d, control plane ef4cfe5 (+63213f3), website dbb8f0d and the frozen tarball sha256 `1de37969…`; it was generated by a script that asserted the tarball, KIT.json, website `boppi-demo.json` and Cloud `guest-demo.json` all name the same checksum and that both demo HTML files are byte-identical.
- Website `public/boppi-demo.{html,json}` regenerated from candidate 104147d (commit dbb8f0d) and synced to Cloud `public/guest-demo.{html,json}` (commit 63213f3). Website build/lint clean, guest entry 32/32, claims regression 36/36 (the regression script must be copied to a `.cjs` name because the website package is ESM); Cloud rebuilt, guest entry 16/16.
- No functionality lost between candidates: the two tarballs have 69 files each and differ only in `src/cli/connect.js` and README; `boppi --help` identical; the six kit cases differ only in per-run identifiers and durations; packaging 29/29, beta journey 27/27, connector journey 31/31 on the new artifact.
- Live state observed read-only: npm `boppi` 0.3.0; app.boppi.io has no guest demo (look-only deploy); boppi.io serves the old 0.3.0 build with SPA fallbacks for `/checkup` and `/boppi-demo.html`.
- `docs/release/LAUNCH_CHECKLIST_2026-10-27.md` lists the twelve remaining steps in dependency order. First action: Melody approves the backup push of the three branches.

Services: app 3097, website preview 4178 and stack `Y5YejS` stopped at the end; volume kept.

---

# Claude session 2026-10-27: Intelligence evaluation completed, connector rescan recovery landed, fifth candidate frozen

Claude resumed the paused Intelligence slice, finished it, then built the next roadmap slice (interrupted connector rescan recovery) and froze a new candidate. Everything is local. Nothing pushed, published, deployed or run against a hosted target. Human, independent-review, consent, real-device and hosted gates are unchanged.

## Commits this session (all local, branch `codex/live-brand-alignment`)

| Repo | Commit | What |
| --- | --- | --- |
| Control | 2a5a809 | Inactive rule evaluation slice (Codex's uncommitted work plus the keyboard-focus fix on both evidence regions) |
| Control | 7a51630 | Ledger/map/handoff for the evaluation slice |
| Scanner | 420ce9d | Mirrored checkpoint |
| Scanner | 104147d | `boppi connect run` grades an applied proposal whose rescan was lost; README paragraph |
| Control | ef4cfe5 | `device_poll` returns applied proposals; applied-state dashboard copy; real-route journey with a severed rescan |
| both | (this save) | Ledger rows H-10/H-11, roadmap map row 9, kit README pointer, this handoff |

## Slice 1: Intelligence inactive evaluation (H-9, done)

Fix: both scrolling `<pre className="evaluation-json">` blocks are `tabIndex={0}` regions with accessible names and a focus ring. Harness gained two keyboard checks. Fresh disposable stack `/tmp/boppi-beta-local.Y5YejS` (the 8AQeHU directory no longer existed on disk; its containers and volume remain in Docker). Build exit 0, app verify exit 0 (311 remediation checks), browser journey 25/25 with zero axe/overflow/errors at 1280 and 390. Evidence `~/Desktop/Boppi-hybrid-2026-10-27-evidence/intelligence-evaluation/`.

## Slice 2: interrupted connector rescan recovery (H-10, done)

Gap: after a successful applied report, a failed scan, a dropped rescan POST or a killed process left the workspace proposal `applied` forever; `device_poll` only returned proposed/approved/executing and `boppi connect run` only acted on proposed/approved.

Design (server-driven, idempotent, no new local state): `device_poll` also returns the device's `applied` proposals (migration 20261027041727, CREATE OR REPLACE; `device_report_rescan` gates are unchanged, so a replay after verification is refused `wrong_state`). Each `connect run` cycle, after proposed/approved handling, grades every applied proposal whose id this machine's backup manifest names, from the scan the cycle already took; a proposal with no manifest entry is named and never graded. The same cycle that reconciles an unanswered claim now also grades it.

Evidence `~/Desktop/Boppi-hybrid-2026-10-27-evidence/connector-rescan-recovery/`: scanner connector suite 65/65 (severed rescan, next-run grade, foreign applied proposal), `npm test` 38/38; SQL suite 25 migrations/368 PASS; real-CLI real-route journey 31/31 where a loopback proxy severs the first rescan, the workspace holds `applied`, and the next run grades `verified` without writing or reporting again; app verify exit 0.

## Candidate (H-11)

`~/Desktop/Boppi-candidate-0.4.0-104147d` (read-only): scanner 104147d, 0.4.0 / engine 1.1.1 / rubric 1.0.3, tarball sha256 `1de37969ccb1ae094c69b48800b5d27303308ead12dca7e73fb8d938da2c16d0`, packaging 29/29, six-case kit (KIT.json matches), exact-tarball beta journey 27, installed-artifact connector journey 31, control pointer ef4cfe5, supersedes d154b2f (preserved). Kit README points at it. Evidence `~/Desktop/Boppi-hybrid-2026-10-27-evidence/candidate-104147d/`.

Not done: website `public/boppi-demo.json` and Cloud `public/guest-demo.json` still carry d154b2f provenance. The demo command is unchanged between the two candidates; regenerate and re-verify the website guest journey when the website is next touched.

## Services

App 3097 and the `Y5YejS` stack are STOPPED; the volume is kept; Docker Desktop left running. The `.next` build includes every change above. Restart:

```sh
cd ~/Desktop/Boppi-auto/apps/control-plane
supabase start --workdir /tmp/boppi-beta-local.Y5YejS --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node scripts/local-beta.mjs serve /tmp/boppi-beta-local.Y5YejS
```

Known dirty file: control `apps/control-plane/supabase/.temp/cli-latest` (CLI side effect, leave it).

## Exact next operation

Remaining authorized local roadmap work, pick one: explicit-consent transient prompt-investigation implementation with a frozen evaluation corpus (map row 7); advertised/effective scope agreement; collection-gap transport; further observation-mode policy workflows; the two-person/rollback-window policy design for row 9. Regenerating the demo assets from candidate 104147d is small and independent. Do not push without Melody's explicit backup authorization; the GitHub backup proposal in `docs/release/GITHUB_BACKUP_PROPOSAL_2026-10-27.md` predates these commits.

---

# Paused for Claude — 2026-10-27, Intelligence evaluation (historical, resolved above)

Melody explicitly requested a stop before the usage limit. Implementation is stopped. No tests or audits were started after that request. All source changes remain **uncommitted** for review; no new commits, pushes, deployments, resets or deletions this run. The previous handoff is preserved below.

## Exact next operation for Claude

1. Read applicable AGENTS.md/app CLAUDE.md and this checkpoint. Do not call the Intelligence slice complete.
2. Fix the confirmed accessibility failure in `apps/control-plane/app/dashboard/intelligence/evaluate/[id]/page.tsx`: both scrollable `<pre className="evaluation-json">` evidence blocks need keyboard focus (`tabIndex={0}`) and accessible region names. This fix was **not made** before stopping.
3. Align the disposable scratch RPC with the current migration before browser verification: the initial migration draft was applied to `/tmp/boppi-beta-local.8AQeHU`; later source tightened record UUID/array validation and made thresholds reference the frozen policy. Fresh PostgreSQL tests used the final file. On a verified loopback target, replace only `evaluate_correction_rule` from the current migration using CREATE OR REPLACE (do not rerun the CREATE TABLE migration over existing tables), or use a new disposable stack. No hosted target.
4. With Melody's resumed implementation authorization, rebuild the app (server stopped first) and rerun `BOPPI_BETA_STACK=/tmp/boppi-beta-local.8AQeHU node scripts/browser-validation/intelligence-evaluation.js`. The latest full journey stopped at the expanded-evidence axe assertion, before its phone/withdrawal/legacy/download-isolation checks. Run app verify after the source fix. Preserve failures.
5. Only after the complete journey passes, record limitations, make a scoped local commit, and update the existing ledger/map. Candidate rebuild is unnecessary for these Cloud-only edits. The next independent roadmap slice is interrupted connector rescan recovery; **not started** this run (only read `src/cli/connect.js` and existing tests).

## Changes made, all uncommitted

- Added inactive workspace rule-evaluation UI, authenticated minimized result download, strict typed forms/results, and a migration containing frozen synthetic development/held-out examples, a bounded exact/prefix matcher, immutable evaluation records, metrics/denominators/corpus checksum, role/RLS/same-org guards and minimized audit.
- Database checks current accepted review revision and provenance under the same correction lock as review/withdrawal. Explicit human mapping is required. Both passing and failed experiments are saved; nothing activates a rule or changes findings.
- Added rubric provenance for NEW corrections, using the actual analysis engine/rubric instead of the workspace's latest unrelated snapshot. Existing incomplete provenance is never backfilled.
- Real browser work discovered and fixed an existing unknown-server labeling break: graph IDs were sent where the intake action requires stored security-record UUIDs. The adapter now retains the UUID and the form uses it; missing identities are visible and cannot submit a guessed target.
- Added real SQL negative/concurrency tests and a real scanner → intake → review → inactive evaluation → download browser harness. This is a synthetic mechanism experiment only, not actual detection quality, effective access, independent review, a contribution channel or a production update service.

Modified control-plane paths (relative to `apps/control-plane/`):
```
app/dashboard/intelligence/actions.ts
app/dashboard/intelligence/page.tsx
app/globals.css
lib/domain.ts
lib/engine/inventory.ts
lib/intelligence.ts
lib/supabase/database.types.ts
scripts/verify-engine-port.ts
scripts/verify-intelligence.ts
supabase/tests/local/run.sh
```
New untracked implementation files:
```
app/api/intelligence/evaluations/[id]/route.ts
app/dashboard/intelligence/evaluate/[id]/actions.ts
app/dashboard/intelligence/evaluate/[id]/page.tsx
lib/intelligence-evaluation.ts
scripts/browser-validation/intelligence-evaluation.js
supabase/migrations/20261027033802_inactive_intelligence_evaluation.sql
supabase/tests/local/intelligence-evaluation.sql
supabase/tests/local/intelligence-evaluation-concurrency.py
```
Also dirty: mirrored BOPPI_NEXT_SESSION.md and BOPPI_TASK_LEDGER.md checkpoint saves in scanner/control; pre-existing control `apps/control-plane/supabase/.temp/cli-latest` and website untracked `docs/HOMEPAGE_POSITIONING_REVIEW_2026-10-22.md` remain preserved. No website/runtime scanner implementation changes this run.

## Passed, failed and evidence

Evidence: `~/Desktop/Boppi-hybrid-2026-10-27-evidence/intelligence-evaluation-in-progress/`. Source, logs and synthetic scratch files are preserved; no private credentials copied into the evidence bundle.

- Final app `npm run verify`: **exit 0**, including typecheck/lint/engine/typed forms and 311 remediation state checks. Next production build: **exit 0**.
- Current migration on fresh PostgreSQL: **24 migrations, 364 PASS lines**, including 32 new evaluation assertions and four real review/withdrawal race cases. Security advisor: **No issues found**. An initial SQL harness grant failure for the anonymous negative case was corrected; final DB suite passed.
- Latest browser run: **13 checks passed, then exit 1** on axe `scrollable-region-focusable`, target `details[open] > pre`. The expanded frozen-corpus panel scrolls but cannot receive keyboard focus. This is the remaining known application defect; full browser validation did **not** pass.
- Before that failure the real scanner/synthetic push, unknown-server intake, provenance, accepted review packet, keyboard evaluation, persisted passing record/download, stale-form refusal, failed-result preservation and unchanged inventory/findings all passed. Expanded evidence had no desktop page overflow. The latest run did not reach phone and remaining negative browser checks.
- Earlier browser failures: login button selector omitted its arrow; a generic details selector hit the hidden mobile workspace switcher; both harness selectors corrected. Actual graph-ID intake bug described above was fixed and its real UI path now passes.
- A separate diagnostic **Node command exit 1** was caused by using Playwright `browser.newPage()` with AxeBuilder, which requires an explicit `browser.newContext()`. Corrected diagnosis exited 0 and identified the focusability violation. No evidence of a Node installation failure. The latest journey's exit 1 is the accessibility assertion, not this diagnostic error.

## Git, candidate and services

| Repo | Branch | HEAD | Ahead of stored origin |
| --- | --- | --- | --- |
| Scanner | codex/live-brand-alignment | 219d20e77a9c2ff7a26e1c2e09ca2be446981e97 | 36 |
| Cloud | codex/live-brand-alignment | 5bd014805794164e9c3fdc1fbaa8f1348d588b18 | 47 |
| Website | codex/homepage-positioning | f67f264af5a1def6ad0fb848c125efc929177871 | 7 |

No remote fetch or push. Existing backup proposal remains accurate for committed refs; it would NOT back up these uncommitted changes.

Frozen candidate unchanged: `~/Desktop/Boppi-candidate-0.4.0-d154b2f`, scanner source d154b2f82ba06886c757efbbd38d6fc5d3525f5b, package 0.4.0/engine 1.1.1/rubric 1.0.3, SHA256 `5554dbaa0f3700e86a8429df8b27667bd46177bd516f67d31c93f73aae2d8d9a`. Cloud pointer 37fd3d9. It does **not** include this uncommitted Intelligence work. OBS-001–004 builder status and all human/external gates remain as below; no new independent retest.

Owned app and five source-stack containers were stopped for this pause. Containers, database volumes, synthetic fixtures and evidence were retained; Docker Desktop remains open. No website, Agent/watch/connector loop or browser test remains running. Restart the exact existing source stack using the instructions below, then rebuild before serve. No real device or hook was activated.

---

# Boppi Claude handoff — 2026-10-27

Melody asked to save the work and prepare this handoff as the session approached its limit. Feature work has stopped. The full Agent + Cloud + Intelligence objective remains active for the next implementation session; this is not a claim that the product or all authorized work is complete. No push, merge, package publication, deployment, hosted operation, personal scan, real-device remediation or persistent hook activation occurred.

## Start here

Recipient: **Claude**. Resume the existing hybrid-product implementation from the next step below.

Read AGENTS.md, this file, BOPPI_MASTER_PLAN.md, BOPPI_TASK_LEDGER.md and control-plane `docs/release/ROADMAP_TO_BUILD_2026-10-25.md`. The current directive authorizes continued reversible LOCAL implementation across all roadmap phases. Earlier scanner-release-only freezes are superseded. Preserve human, independent-review, consent, real-device and hosted gates. Do not restart a broad extraction or requirements audit.

**Exact next implementation step:** Connect accepted workspace-review-v1 evidence packets to a local, inactive rule-candidate evaluation record using explicit human-reviewed mappings and frozen development/held-out fixtures. Reject missing or incompatible provenance and stale review revisions. Do not infer capabilities from a correction alone, transfer private content, activate rules, introduce a paid model, or claim the synthetic signing demo is a production update service.

Other authorized local work remains: explicit-consent transient prompt-investigation implementation and a frozen evaluation corpus; advertised/effective scope agreement; collection-gap transport; further observation-mode policy workflows; interrupted connector rescan recovery. Actual content access, real hooks/devices, enforcement, publication and hosted operations remain separately gated. Continue independent local work when a gate blocks one path.

## Active repositories and checkpoints

| Repository | Worktree | Branch | Implementation HEAD before documentation-only save |
| --- | --- | --- | --- |
| Scanner, canonical engine and connector | `~/Desktop/boppi-scan-auto` | `codex/live-brand-alignment` | `d154b2f` |
| Cloud control plane | `~/Desktop/Boppi-auto` | `codex/live-brand-alignment` | `37fd3d9` |
| Website | `~/Desktop/Boppi-website-positioning` | `codex/homepage-positioning` | `f67f264` |

Use `git log -1` for final documentation-save commits. Source commits this run:

- Scanner `d154b2f`: unknown capability loss is explicit before approval; connector and terminal/HTML predictions use bounded language.
- Control `3a9ba2e`: fail on restore ACL mismatch; verify known source canary values and parent/child/auth relationships.
- Control `7531968`: consented Agent activity reaches exposure investigations with collector/client/name guards and separate outcomes.
- Control `b72c78f`: pin ten existing helper search paths; local security advisor clears.
- Control `1b73c7b`: correction review, stale/concurrent decision guards, bounded audit history, minimized inactive evidence download.
- Control `cd09172`: time-bounded finding exception request, approval, expiry and revocation, strictly observation-only.
- Control `37fd3d9`: anonymous Cloud landing → actual bundled synthetic demo → optional real signup.
- Website `b55dc68`: guest checkup guide and interactive candidate-backed demo; `f67f264`: refresh demo from the new artifact.

Expected dirty files after saving docs: control `apps/control-plane/supabase/.temp/cli-latest` (existing Supabase CLI side effect); website untracked `docs/HOMEPAGE_POSITIONING_REVIEW_2026-10-22.md` (pre-existing note). Leave both. Older dirty worktrees were inspected read-only and preserved. Recovery inventory is in the evidence directory's `recovery.json` (initial heads were scanner 8d5841c, control 0d7b547, website 655ee09; inventory captured after the first website commit).

The usage-limited Phase 9 cloud agent's work was integrated in control `2e7889b`, followed by real route/CLI/DB fixes and rollback verification. It was not discarded or assumed complete without testing.

## What a person can do in the local build

1. Enter the website's `/checkup` without an account, understand scope/privacy/setup, copy the real public scanner command, and use `/demo` to investigate fictional connections and simulate changes. Cloud `/` also serves the same guest demo at `/guest-demo.html` and reaches optional signup. No browser page scans a device.
2. Run a supported guest checkup with the Agent. The public npm registry was freshly checked as 0.3.0; advanced 0.4.0 behavior is in the private candidate. The website makes this distinction.
3. Use optional accounts/workspaces, separately consented inventory and activity, token lifecycle, Fleet/history/findings and existing team workflows on a disposable local stack.
4. Inspect device-reported activity alongside configured exposure paths. Same collector, supported Claude Code client and unambiguous normalized server names are required. Invocation/completion reports, denial, failure and missing/conflicting outcomes remain separate. Activity never proves a path was used, effective permission, file access or transfer, and never changes severity.
5. Submit corrections with provenance, record an owner/security-admin workspace review, request more evidence or reject, and explicitly download a minimized inactive review packet. Free-text reasons, server names and reviewer identities are excluded from the packet. Acceptance is not an independent audit and never activates a rule. The external contribution/update channel is still absent; the signed research pipeline remains synthetic and inactive.
6. Track a computed path as a finding, then request an expiring observation-only exception. Approval binds to the finding version; stale, expired, cross-tenant and unauthorized decisions are refused. Requesters can revoke. Findings/status/severity/access are unchanged; no enforcement is enabled.
7. Use the typed dashboard connector for removal and rollback on synthetic fixtures with preview, dashboard/local approval, hash checks, atomic writes, backups, audit and rescan. Collector credentials remain separate from remediation authority.

## Tests and actual evidence

Evidence bundle: `/Users/melodymanzur/Desktop/Boppi-hybrid-2026-10-27-evidence`. Contains logs, responsive screenshots, manifests and read-only recovery inventory; encrypted dumps and raw scratch auth state were not bundled.

| Check | Result |
| --- | --- |
| Scanner `npm test` at d154b2f | 38/38 suites |
| Focused fix preview / connector | 32 / 61 checks |
| Final control-plane `BOPPI_SCAN_DIR=... npm run verify` | exit 0; includes typecheck/lint/engine/ledger, new runtime/governance tests and 311 remediation state checks |
| Fresh PostgreSQL migrations / SQL suite | 23 migrations, 328 PASS lines including review/governance and concurrency cases |
| Real remediation routes | 63 checks after helper search-path hardening |
| Source and installed-artifact connector rollback | installed artifact 29 checks; original fix ends rolled_back |
| Activity Agent → API → DB → responsive investigation UI | 26 checks, including consent refusal, metadata canaries, replay, disable, cross-user isolation, withdrawal/erase; zero axe/overflow/errors at 1280/390 |
| Intelligence actual intake → review → export | 24 checks, including stale browser form, concurrent reviewers, role/tenant guards, direct-write refusal, withdrawal and private-field exclusion; zero axe/overflow/errors at 1280/390 |
| Governance actual track → request → approval → expiry → revoke | 18 checks; unchanged finding status/severity, role/tenant guards, minimized audit; zero axe/overflow/errors at 1280/390 |
| Website guest journey / existing website regression | 32 / 36 checks; zero axe/errors; guest flow sends no external requests |
| Cloud anonymous guest → demo → signup | 16 checks, keyboard and desktop/phone; zero axe/overflow/errors |
| Backup regression on current complete schema | 7 positive/negative checks; encryption, restore, canary values, count-preserving corruption, bad passphrase, wrong target, grant failure, auth RLS visibility guard |
| Two-stack platform rehearsal | skipped ACL alignment fails; aligned restore passes with 121 post-restore SQL assertions; restored value and auth-identity mutations fail without count changes. This rehearsal preceded the three new migrations; the final plain-Postgres backup regression and fresh schema suite include them. |
| Local security advisor | no warning/error findings after pinning ten existing helper search paths |

Failures found and corrected during implementation: phone form overflow; using serialization SQLSTATE 40001 for a durable stale-review conflict (PostgREST retries it). Stale review now uses PT409 and the actual API/browser/concurrency tests pass. A generated duplicate Next type file was preserved under `/tmp/boppi-hybrid-generated-duplicates/`; later builds/typechecks passed. A static active-workspace verifier required the established `formData` naming convention, now aligned. Initial browser harness timing/case mismatches were corrected against actual UI behavior; final results above passed. No failed classifier experiment was reclassified as success.

## Candidate and supervised beta

Current proposed candidate: `/Users/melodymanzur/Desktop/Boppi-candidate-0.4.0-d154b2f`.

- Scanner `d154b2f82ba06886c757efbbd38d6fc5d3525f5b`; package 0.4.0, engine 1.1.1, rubric 1.0.3.
- Tarball `package/boppi-0.4.0.tgz`; SHA-256 `5554dbaa0f3700e86a8429df8b27667bd46177bd516f67d31c93f73aae2d8d9a`.
- Packaging/fresh-install journey 29/29, exact tarball beta journey 27, installed connector rollback 29, versions/checksum agree.
- Six synthetic cases in `kit/`; CANDIDATE.json and KIT.json match. Control implementation pointer is 37fd3d9. Website and Cloud guest assets have identical verified bytes and demo provenance.
- Candidate/kit made read-only after verification; earlier 9954750, 363a725 and older candidates preserved.
- Human sessions remain 0/5. D-11 founder selection is OPEN. Update/read the existing usability kit; use a writable COPY and QA only until participant decisions are made.

Consent blanks remain in `docs/beta/usability-kit-0.4.0/CONSENT.md`: **Notes accessible to** and **Notes deleted on**. Proposed wording, not a decision: “Session notes and the scoring sheet are stored on the facilitator's machine only and shared with ________ (the founder alone, or the founder and the named reviewer). They are deleted on ________ (a date no later than 90 days after the last session). No recording is made, no personal configuration is scanned, and nothing is uploaded.” Melody still chooses facilitator, participants (include people without cybersecurity backgrounds), recipients and deletion date. No participant uploads or real-device tasks are authorized.

## Observer findings and gates

Original observer files: `~/Boppi-observer-20261026T0130Z/FINDINGS.md` and CHECKPOINT.md, read and left unchanged.

- OBS-001 artifact/source drift: addressed by builder rebuild and exact-artifact verification; D-11 selection remains open.
- OBS-002 ACL mismatch: Melody explicitly approved local fix; mismatch now fails the rehearsal and aligned target passes.
- OBS-003 restored source values: explicitly approved; fixed canary values and relationships pass after restore, count-preserving mutations fail.
- OBS-004 approval uncertainty: explicitly approved; unknown server capabilities are explicit before confirmation; modeled loss no longer promises no functionality loss.
- OBS-005 website axe issues: prior fix retained; website regression remains zero-axe.

These are builder verifications, not a new independent observer retest. No additional approval is needed to continue the already authorized local work. Rubric sign-off, real users, independent security review, design partners, real-client/runtime/content activation, two-person/rollback policy decisions, staging security/inventory/recovery, hosted migration parity, publication, deployment and enforcement gates remain. Intelligence's production contribution channel, evaluated real held-out evidence, reviewed signing/distribution and durable receiver trust remain incomplete.

## Services and safe restart

All owned services are STOPPED: app 3097, website preview 4178, source stack `/tmp/boppi-beta-local.8AQeHU`, restore target `/tmp/boppi-restore-hybrid.w277mq5a`. Docker volumes were retained and Docker Desktop left open. No background Agent/watch/hook was installed.

```sh
cd ~/Desktop/Boppi-auto/apps/control-plane
supabase start --workdir /tmp/boppi-beta-local.8AQeHU --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node scripts/local-beta.mjs serve /tmp/boppi-beta-local.8AQeHU
# Website, only when needed:
cd ~/Desktop/Boppi-website-positioning
npm run preview -- --host 127.0.0.1 --port 4178 --strictPort
```

The existing build includes all current application source. If rebuilding, stop the owned app first. Fresh stack creation follows `docs/LOCAL_BETA_RUNBOOK.md`; apply only repository migrations to a verified disposable loopback target, never a remotely linked directory. New migration files this run are 20261027024014_intelligence_workspace_review.sql, 20261027024909_pin_helper_search_paths.sql and 20261027030104_shadow_finding_exceptions.sql. They are local only.

## Backup proposal and boundaries

See `docs/release/GITHUB_BACKUP_PROPOSAL_2026-10-27.md` for exact final refs/dirty state and commands. No push was executed. Melody's section 8 requires explicit approval before push/merge/publication/deployment. Vercel Git-deploy guards remain disabled; a future push may still run GitHub CI. Candidate and evidence directories are local artifacts, not Git files to push.

Continue locally on these existing branches. Preserve unrelated dirty worktrees and the two known dirty files. Never commit environment values, tokens, raw private configs, participant notes/exports, scratch auth state or remediation backups. Never request production credentials. Local commit identity: `-c user.name="Melody Manzur" -c user.email="melodymanzur@Melodys-MacBook-Air.local"`.
