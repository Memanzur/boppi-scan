# Boppi next-day handoff, 2026-10-25 05:30 UTC

Founder local date at this checkpoint: October 24, 2026 (America/Denver). Start with this file, then `docs/release/RELEASE_BLOCKERS.md` (authoritative states), `docs/release/RELEASE_DECISION_2026-10-25.md` (now with a fresh-reviewer continuation section) and `docs/validation/FOUNDER_DECISION_PACKET_2026-10-25.md` (what the founder decides, in order). Do not infer release status from older candidate labels or summaries.

## A. Executive summary

A different model and session (Claude Fable 5.1) picked up the 04:27 UTC Codex handoff after Codex ran out of usage. It retested candidate 0.4.0-2d65a09 through the separate review package without touching the frozen artifact, then worked the five eligible tasks the handoff listed. Everything the earlier session claimed held up on the real tarball. Three new findings came out of the work the earlier session could not run: a Linux-only collector defect (low, fixed in scanner source), a backup role blind to RLS-protected auth rows (high, backup script now refuses), and a fresh-platform restore that silently widened privileges on every table (high, rehearsal script and runbook now align default privileges first and compare grants). Candidate 2d65a09 is unchanged and remains recommended for the human sessions.

Overall: **NO-GO for public release**, unchanged. Founder, human, external-review and hosted gates are the only open items. Nothing was pushed, published, deployed or queried on a hosted project. No secret was read or set.

## B. Exact repository state

| Repository | Branch | Implementation commit this session | Final documentation commit | Unpushed before this session |
| --- | --- | --- | --- | --- |
| `~/Desktop/boppi-scan-auto` | codex/live-brand-alignment | `976f998` hook segment names unique; plan-fix test padding | see FINAL_STATE.json | 14 |
| `~/Desktop/Boppi-auto` | codex/live-brand-alignment | `b65dfb2` backup RLS precheck, platform rehearsal, runbook, register, decision, packet | see FINAL_STATE.json | 15 |
| `~/Desktop/Boppi-website-positioning` | codex/homepage-positioning | none | none | 3 (unchanged, untracked review doc still untracked) |

Worktrees, the dirty `~/Desktop/Boppi` family, and `~/Desktop/boppi-scan-dev-5a` (5a(b), `3447992`, dirty) were not touched. The frozen candidates under `~/Boppi-release-completion-20261025T033847Z/` and `~/Boppi-beta-blocker-repairs-20261025/` were read only; the candidate directory's checksums still verify.

## C. What was done, with evidence

Evidence root: `/Users/melodymanzur/Boppi-release-continuation-20261025T050716Z` (`logs/`, `evidence/`, `scratch/`). Synthetic data only. The `scratch/` folder holds installed runtimes and a plaintext dump of the synthetic source database and may be deleted.

| Task from the 04:27 handoff | Result | Evidence |
| --- | --- | --- |
| 1. Fresh reviewer retest of 2d65a09 | `run-review.sh`: 210 checksums OK, offline install, 34/29/31/22, all probes PASS, backup rehearsal PASS. Sha256 `85f8065f7bcbcc97b0cdca11fc7b5c337148d257109b18fbc332b8bf52b9b6fc` confirmed | logs/fresh-review-*.log |
| 2. Node 18 | Exact tarball suites 34/29/31/22 under Node 18.20.8 Linux, network disabled. Full source suite 34/36 before fixes (SCAN-SEGMENT-01 plus a brittle test), 36/36 after, with `--init`. Node 22 Linux reproduced and confirmed both fixes. One `verify-discover` grandchild-wait flake in 1 of 10 container runs, recorded, no code change | logs/node18-linux-*.log; logs/node22-linux-*.log; logs/linux-failure-debug.log |
| 3. axe pass | Static: candidate report, demo, kit demo/report, six case pages, 1280 and 390 px: 0 violations, 0 overflow. Live app on a fresh disposable stack: nine routes, history, signup to welcome: 0 violations, consent unchecked, no token | logs/axe-static-html.log; logs/browser-*.log |
| 4. Platform restore rehearsal | Two disposable stacks, image 17.6.1.095. Run 1 exposed OPS-RESTORE-02 and OPS-RESTORE-03. Final run: plain restore PASS, 12 tolerated platform statements, counts equal (15), grants equal (35 rows), 115 post-restore assertions PASS, garbage token refused 28000 | logs/platform-rehearsal.log; evidence/platform-rehearsal*/ |
| 5. Decision packet and kit review | `docs/validation/FOUNDER_DECISION_PACKET_2026-10-25.md` orders eight decisions; kit README updated with the axe evidence; consent/session sheets reviewed, no change needed | repo |
| Also | Integrated journey on the fresh stack 27/27 with the frozen candidate; `npm audit` 0 vulnerabilities; security package section 9 statuses filled where locally verifiable; `test:backup:local` 5 checks | logs/integrated-journey-fresh-stack.log; evidence/npm-audit-*.json; logs/backup-local-regression-final.log |

Commands worth re-running: `bash ~/Boppi-release-completion-20261025T033847Z/review/run-review.sh`; in the scanner `npm test`; in the control plane `npm run test:backup:local`, and with two disposable stacks `BOPPI_REHEARSAL_SOURCE_PORT=<db1> BOPPI_REHEARSAL_TARGET_PORT=<db2> bash scripts/backup/platform-rehearsal.sh <out>` (the target stack must be fresh; `supabase db reset --workdir <stack2>` resets it). The two stacks used here are stopped with volumes kept: `/tmp/boppi-beta-local.jTedw9` and `/tmp/boppi-beta-local.restore.fQBuCQ`. Docker Desktop was started by this session and left running.

## D. New findings and their state

- **OPS-RESTORE-02** (High, VERIFIED, corrected). Backup role without BYPASSRLS sees zero auth rows with no error. The script refuses before dumping; negative control in the regression. Hosted: confirm the production `postgres` role carries BYPASSRLS before the first real backup.
- **OPS-RESTORE-03** (High, VERIFIED, corrected in script and runbook). Restore into a fresh project leaves anon/authenticated with ALL on every table unless default privileges are aligned first. `RESTORE.md` 3b now carries the rehearsed steps.
- **SCAN-SEGMENT-01** (Low, VERIFIED in source, not in candidate). Same-millisecond segment names overwrote records uncounted. Needs more than 1 MiB of hook records per millisecond at production size. Founder chooses whether a new candidate is cut (packet item 1; recommended no).

## E. Remaining blockers

Unchanged set: rubric sign-off (D-01 to D-08), kit and consent and five human sessions (D-11, D-12; 0 of 5), external security review (D-28), staging suite and hosted inventory (D-31, D-30), hosted recovery and migrations (D-30), push and publication (D-14, D-13), policy rows (D-23, D-24, D-26, D-27). Windows and real Linux clients untested on real machines. All listed with recommendations in the decision packet.

## F. Tomorrow's eligible tasks (no founder answer required)

1. If the founder picks packet item 1(b), cut a new candidate from scanner head with `node scripts/release-candidate.js --out <new dir>`, rebuild the kit, and rerun the four artifact suites and the journey against it; otherwise nothing.
2. Add the two-stack rehearsal to the control-plane runbook as a repeatable command block (it is a script now; a `docs/LOCAL_BETA_RUNBOOK.md` paragraph pointing at it is missing).
3. Remove `scratch/` from the evidence root once a reviewer has what they need.
4. Everything else is a founder gate.

## G. Ready-to-paste continuation prompt

Resume Boppi from `~/Desktop/Boppi-auto/BOPPI_NEXT_SESSION.md`. Read `docs/release/RELEASE_BLOCKERS.md`, the continuation section of `docs/release/RELEASE_DECISION_2026-10-25.md`, `docs/validation/FOUNDER_DECISION_PACKET_2026-10-25.md` and `/Users/melodymanzur/Boppi-release-continuation-20261025T050716Z/FINAL_STATE.json`. Candidate 0.4.0-2d65a09 (sha256 85f8065f7bcbcc97b0cdca11fc7b5c337148d257109b18fbc332b8bf52b9b6fc) is unchanged and retested by a second model; scanner source is one low-severity collector fix ahead of it. Do not push, publish, deploy, query hosted projects, change secrets, enable telemetry or pairing, or answer founder decisions. Preserve all worktrees and 5a(b). Only the items in section F are eligible without a founder answer.
