# Boppi handoff, 2026-10-25T063755Z

Written by Claude Fable 5.1 after the full-product recovery directive and the "stop research, implement" follow-up. Nothing was pushed, published, deployed, merged, or applied to a real machine. Both repos are clean on `codex/live-brand-alignment`.

## Where things stand

- Scanner `~/Desktop/boppi-scan-auto`: c863007 (engine 1.1.1 at 53e5d0e and 82c0095). `npm test` 36/36 on macOS after both engine commits. Candidate 0.4.0-2d65a09 is untouched and carries engine 1.1.0; `npm run verify-versions` now reports the candidate's engine behind source, which is expected until the founder decides on a rebuild (D-11).
- Control plane `~/Desktop/Boppi-auto`: 02b6c3e (code in 7431a93). `npm run verify` 311, `verify:engine` 45, Chromium `drive.js builtin` 29 steps. Vendor pin is scanner 82c0095.
- Website `~/Desktop/Boppi-website-positioning` at 0345934: untouched this session; claim inventory in `Boppi-auto/docs/requirements/extractions-2026-10-25/extract-D-website.md`.
- Disposable stack `/tmp/boppi-beta-local.jTedw9` holds the synthetic push with built-in grants (collector "Synthetic developer laptop"); stopped with volumes kept. Docker Desktop left running.

## What this session changed (code)

1. Dashboard built-in residual parity: `lib/engine/builtin-residual.ts`, card on remediation and paths pages (RELEASE_BLOCKERS DASH-PLAN-01).
2. Shared engine: built-in-held nodes never proposed as config edits; an MCP server entry removed as one whole with `removedNodeIds`; permission nodes carry `grantedBy`; adapter builds servers before permissions (DASH-PLAN-02).
3. Scanner wording: one unreadable client reads "is missing".

## Read first

`docs/requirements/CHECKPOINT_2026-10-25.md` (confirmed gaps, what already satisfies requirements, open questions), `docs/release/ROADMAP_TO_BUILD_2026-10-25.md` (phase by phase: implemented, verified, human-tested, published, missing), `docs/release/RELEASE_BLOCKERS.md`, `BOPPI_TASK_LEDGER.md` section "Built-in residual parity", `docs/validation/FOUNDER_DECISION_PACKET_2026-10-25.md`.

## Next session, in order

1. Website claims (local only, no deploy): fix `ScanTerminal.tsx:62,66`, `Hero.tsx:36`, `Terms.tsx:69-70`, `Privacy.tsx:90-91` (remove the false Google Fonts sentence), `Platform.tsx:11` ("release" for an unpublished candidate), label "Sign in" and "Create a workspace" as beta/hosted-pending, add a Vercel deploy guard; run the Vite build.
2. Cursor residual sentence and the agent-id remap fixture (ledger P1-14 leftovers).
3. If the founder chooses a rebuild (D-11): `npm run release-candidate` from a clean scanner head, then the kit and `verify-versions`.
4. Founder gates stay as listed in the decision packet; never mark a human or review gate done.

## Rules carried forward

No push, publish, deploy, staging or production change, real scan, hook activation, or external account change without explicit authorization. Git identity for commits: `-c user.name="Melody Manzur" -c user.email="melodymanzur@Melodys-MacBook-Air.local"`.
