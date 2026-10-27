# Boppi handoff, 2026-10-27: connector rollback complete

The requested rollback-through-the-connector slice is implemented, verified and committed locally. Nothing was pushed, published, deployed, merged, changed in a hosted environment or applied to a real device. All older worktrees and candidates are preserved.

## Current checkpoints

- Scanner implementation `9954750` on `codex/live-brand-alignment` in `~/Desktop/boppi-scan-auto`. Package 0.4.0, engine 1.1.1, rubric 1.0.3. Full scanner 38/38; final connector suite 61 checks. Later commits carry handoff documentation only.
- Control-plane implementation `6c5730f` on the same branch in `~/Desktop/Boppi-auto`. Full `npm run verify`, final lint and local app build pass. Later commits carry handoff documentation only. The sole uncommitted file is `apps/control-plane/supabase/.temp/cli-latest`, an existing CLI side effect; leave it.
- New fourth candidate `~/Desktop/Boppi-candidate-0.4.0-9954750` (read-only after validation), from the clean scanner implementation commit. Tarball SHA-256 `890d3f9f458f5f5df30505a172e58b512bdb679b3874193271b0aff2aa6ee8de`. Packaging journey 29/29, version checks agree, kit contains six synthetic cases and matching KIT.json. Previous candidate 363a725 is preserved. Founder D-11 selection remains open.
- Exact tarball against built app: beta journey 27 checks; installed-tarball connector journey 29 checks (including dashboard/RPC rollback and the original fix ending `rolled_back`).
- Chromium remediation journey: 59 steps, no failures; zero axe violations at 1280 and 390 px across pairing, preview, verified removal and verified rollback; zero overflow and console errors.
- Source connector journey 29 checks; routes suite 63. All integration evidence uses disposable `/tmp/boppi-beta-local.8AQeHU`, whose app/stack are stopped after validation, volume retained. Docker Desktop left open.
- Website remains `655ee09` in `~/Desktop/Boppi-website-positioning`; untouched, not deployed.

Full implementation details and evidence: `docs/validation/CONNECTOR_ROLLBACK_2026-10-27.md`. Local logs/screenshots: `~/Desktop/Boppi-candidate-0.4.0-9954750-evidence/`.

## What changed

The scanner now offers intact, unrestored connector backups while the config still matches the applied hash. Rollback gets a separate sanitized reversed preview, approval and local restore confirmation. Both file and backup hashes are checked again under the file lock after claim; restoration is atomic, preserves mode, and records the rollback proposal and `restoredFrom` in the manifest. Rescan grading marks the original fix rolled back. Local replay and interrupted-report recovery cover both actions. Dashboard and terminal descriptions explain restoration and returning potential exposure paths.

New connector manifests bind the project locally. Older entries without a project still rely on the SQL binding-project guard, so run from the original working directory. Tests cover missing/tampered/symlinked backups, symlinked targets, newer config, project mismatch, claim-time races, byte-exact restore, returning exposures and replay. Automatic rescan retry after an interrupted report is outside this slice.

## Next work and unchanged gates

The requested slice and candidate rebuild are complete. No new engineering slice is selected by this handoff. Follow the founder decision register before choosing more work. D-11 artifact choice may now consider the 9954750 candidate; no selection was inferred. D-12 consent blanks and participants, rubric sign-off, external reviewer, hosted staging/inventory/recovery/migrations, two-person and rollback policies, push/publication and website deployment remain open. Human sessions remain 0/5.

Consent document `docs/beta/usability-kit-0.4.0/CONSENT.md` still leaves "Notes accessible to" and "Notes deleted on" blank. Suggested surrounding wording remains: "Session notes and the scoring sheet are stored on the facilitator's machine only and are shared with ________ (the founder alone, or the founder and the named reviewer). They are deleted on ________ (a date no later than 90 days after the last session). No recording is made, no personal configuration is scanned, and nothing is uploaded."

## Restarting the disposable stack

```sh
cd ~/Desktop/Boppi-auto/apps/control-plane
supabase start --workdir /tmp/boppi-beta-local.8AQeHU --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node scripts/local-beta.mjs serve /tmp/boppi-beta-local.8AQeHU
```

If `/tmp` is cleared, follow `docs/LOCAL_BETA_RUNBOOK.md` with a fresh scratch directory. Every helper refuses remotely linked scratch directories. Use the new candidate manifest through `BOPPI_BETA_CANDIDATE` when verifying the artifact.

## Rules carried forward

No push, publication, merge, deployment, production/shared-staging operation, infrastructure/credential change, personal scan, real-device remediation, untrusted MCP execution, or persistent hook installation is authorized. Use synthetic fixtures and disposable local infrastructure only. Never commit environment values, tokens, personal configs, sensitive exports, scratch credentials or remediation backups. Git identity for local commits: `-c user.name="Melody Manzur" -c user.email="melodymanzur@Melodys-MacBook-Air.local"`.
