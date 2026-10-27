# Intelligence evaluation COMPLETED locally — 2026-10-27 (Claude)

Claude resumed the paused slice below. The keyboard-focus defect is fixed, the complete browser journey passes, app verify passes, and the work is committed locally. Nothing pushed, published, deployed or run against a hosted target.

## What changed this session

- `apps/control-plane/app/dashboard/intelligence/evaluate/[id]/page.tsx`: both scrolling `<pre className="evaluation-json">` evidence blocks are now `tabIndex={0}` regions with accessible names (frozen corpus; per-evaluation evidence). `app/globals.css` gives the region a visible focus ring.
- `scripts/browser-validation/intelligence-evaluation.js`: two new checks prove Tab from the disclosure summary lands on the named region at 1280 and 390.
- The old scratch stack directory `/tmp/boppi-beta-local.8AQeHU` no longer existed on disk (containers and volume remain in Docker), so a fresh disposable stack `/tmp/boppi-beta-local.Y5YejS` was created with `supabase init/start` and `local-beta.mjs prepare`. All 24 repository migrations applied cleanly, so the scratch `evaluate_correction_rule` matches the committed migration file. No hosted target.

## Evidence

`~/Desktop/Boppi-hybrid-2026-10-27-evidence/intelligence-evaluation/` (README inside).

| Check | Result |
| --- | --- |
| `next build` with the fix | exit 0 |
| `BOPPI_SCAN_DIR=~/Desktop/boppi-scan-auto npm run verify` | exit 0, 311 remediation state checks |
| Real scanner → intake → review → inactive evaluation → download browser journey | 25/25 (first pass 23/23 before the keyboard checks were added); zero axe violations, zero overflow, zero console errors at 1280 and 390 |

The in-progress bundle `intelligence-evaluation-in-progress/` is preserved unchanged.

## Services

App 3097 and the `Y5YejS` stack were stopped at the end of the session; the volume is kept. Restart:

```sh
cd ~/Desktop/Boppi-auto/apps/control-plane
supabase start --workdir /tmp/boppi-beta-local.Y5YejS --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node scripts/local-beta.mjs serve /tmp/boppi-beta-local.Y5YejS
```

## Exact next operation

The next independent roadmap slice is **interrupted connector rescan recovery** (roadmap map row 9). See the section at the end of this file for the design notes written this session. Candidate rebuild is still unnecessary for Cloud-only edits.

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
