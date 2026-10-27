# Boppi handoff, 2026-10-27T02:20Z

Written by Claude Fable 5.1 after recovering the seventh session's interruption. Nothing was pushed, published, deployed, merged, or applied to a real machine. The founder asked for the work to be saved so Codex can continue.

## Where things stand

- Scanner `~/Desktop/boppi-scan-auto` at 363a725 on `codex/live-brand-alignment`, clean. Engine 1.1.1, rubric 1.0.3, package 0.4.0. `npm test` 38 of 38 on macOS at this commit.
- Control plane `~/Desktop/Boppi-auto` at the commit that carries this file, same branch. `supabase/.temp/cli-latest` is a Supabase CLI side effect and stays uncommitted.
- Website `~/Desktop/Boppi-website-positioning` at 655ee09 on `codex/homepage-positioning`: bounded claims and zero axe violations, not deployed, `vercel.json` disables Git deploys.
- Third candidate `~/Desktop/Boppi-candidate-0.4.0-363a725` (read-only): scanner 363a725, engine 1.1.1, tarball sha256 `75f3f72ff0239031baaa24afd1dea62f20a42fff2d0db0ff86e046f9dd98290c`, 29 of 29 journey checks, `verify-versions` agrees, `kit/` prepared with six synthetic cases (KIT.json). It supersedes 2d65a09. It is the artifact for D-11 if the founder picks (b).
- Disposable stack `/tmp/boppi-beta-local.8AQeHU`: stopped, Docker volume kept, app server stopped. The reboot erased the older `/tmp` stacks; their volumes remain. Docker Desktop is running.

## What this session did

1. Recovery: committed the two interrupted fixes after verifying them (scanner 363a725 nonce in the preview report, `verify-connector` 42; control plane 3edc2da keyed-fingerprint rule, `typecheck`, `verify:remediation` 311, `verify:remediation:routes` 63).
2. Connector journey with the real CLI against the real routes and database: `npm run verify:connector-journey -- <stack>` passes 22 checks (pair, offers without paths, propose, preview without a write, approve against the previewed hash, claim, apply to the synthetic fixture, backup and manifest, rescan graded verified, replay applies nothing, audit rows without path or credential, `boppi rollback` restores the bytes, unpair, revoke). Negative cases are proven by the routes suite on the same stack and the scanner connector suite.
3. Candidate rebuilt from 363a725 (above). The tarball was checked to carry engine 1.1.1 with `builtinHeldNodeIds`, the nonce fix, `builtinResidual` in push, `connect.js`, and the bounded redaction sentence; the only remaining "never collected" wording is about environment variable values, which the scanner really does not read.
4. The candidate tarball verified against the stack through the built app: `local-beta.mjs verify` 27 checks (install, push, ingest guards, fix, verify, rollback, consent withdrawal, erasure, reconsent).
5. Chromium `remediation.js` on the stack: pairing, propose, preview, approve, executing, applied, verified, decline, revoke; zero axe violations at 1280 and 390 px, no console errors. It needs an inventory first (`local-beta.mjs verify` provides one).

## Next slice, designed and not started: rollback through the connector

The dashboard offers "Propose rollback" and the twin, routes and SQL already handle a `rollback` proposal (routes suite proves it with a fake device), but `boppi connect` never offers a rollback, so the button can never activate on a real device. Build it in the scanner, then prove it in the journey:

- Offer: for each manifest entry with `action: 'remove_server'` and a `proposalId`, not yet restored (no entry with `restoredFrom` equal to its id), whose backup exists with sha256 equal to `backupHash`, and whose original file is a regular file whose current hash equals `appliedHash`: post `{ action: 'rollback', client, project: fingerprint(cwd), targetFile: fingerprint(original), server, configHash: current hash, previewHash: sha256(rollback preview text), expectedExposureKeys: [], capabilityLoss: [], versions, computedAt, backupManifestId: entry.id }`. `project` must equal the fix proposal's binding project (same cwd), or `propose_rollback` refuses with `rollback_blocked`.
- Preview text: reuse `remediate.previewRemoval` on the backup bytes and render the hunks with `+` and `-` swapped, under a "restore" header. Never print env values.
- `targetForBinding` and `execute` branch on `binding.action === 'rollback'`: the local confirmation says "restore", the write copies the backup bytes atomically after re-checking that the file hash equals `binding.configHash` and the backup hash equals `backupHash`, then appends a manifest entry `{ action: 'rollback', restoredFrom, backup, original, clientKey, server, proposalId, backupHash: hash at write, appliedHash: backup hash }` so `boppi rollback` lists the fix as rolled back. The applied report sends `appliedHash` (the original file's hash) and the new entry id; the rescan report is unchanged (the SQL ignores expected keys for a rollback and checks the hash).
- `manifestEntryFor` must match any action by `proposalId`.
- Tests: a "rollback from the dashboard" section in `test/verify-connector.js` after "--once twice is idempotent" (the mock workspace needs `proposeRollback` and a rescan rule for rollback; later sections' manifest counts change from 1 to 2); the journey script replaces its CLI rollback step with `propose_rollback` through the real RPC and asserts the fix ends `rolled_back`; `remediation.js` can post a rollback offer from the fake device and click the button.
- After it lands: `npm test`, rebuild the candidate from the new head, rerun `verify-versions`, update KIT.json.

## Founder gates (unchanged, never marked by an agent)

D-11 artifact choice (recommend the 363a725 candidate), D-12 consent blanks and participants, rubric 1.0.3 sign-off, external reviewer, staging suite and hosted inventory, hosted recovery and migrations, push and publication, two-person rule, website deploy and the "Release draft" wording.

## Consent blanks (docs/beta/usability-kit-0.4.0/CONSENT.md)

"Notes accessible to" and "Notes deleted on" are blank until the founder decides. Suggested surrounding language, blanks kept: "Session notes and the scoring sheet are stored on the facilitator's machine only and are shared with ________ (the founder alone, or the founder and the named reviewer). They are deleted on ________ (a date no later than 90 days after the last session). No recording is made, no personal configuration is scanned, and nothing is uploaded."

## How to restart the stack

```
cd ~/Desktop/Boppi-auto/apps/control-plane
supabase start --workdir /tmp/boppi-beta-local.8AQeHU --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node scripts/local-beta.mjs serve /tmp/boppi-beta-local.8AQeHU
```
If `/tmp` was cleared again, follow `docs/LOCAL_BETA_RUNBOOK.md` from `mktemp`. If Docker auto-restarts an orphaned `supabase_*_boppi-beta-local.*` set on ports 54321/54322, `docker stop` those containers (volumes stay).

## Rules carried forward

No push, publish, deploy, staging or production change, real scan, hook activation, or external account change without explicit authorization. Git identity for commits: `-c user.name="Melody Manzur" -c user.email="melodymanzur@Melodys-MacBook-Air.local"`.
