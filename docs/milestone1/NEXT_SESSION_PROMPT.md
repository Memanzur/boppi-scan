# Next session prompt (written 2026-10-23, after the rubric 1.0.3 checkpoint)

Paste this as the first message of the next autonomous session.

---

BOPPI, continue autonomous development under the standing rules (local code, tests, docs, synthetic fixtures only; never push, merge, publish, deploy, migrate, change staging or production, install persistent services, scan real private configurations, collect user data, apply real fixes, approve security exceptions, or mark human tests complete; stop for a serious unresolved security issue or when nothing safe remains).

State: scanner `~/Desktop/boppi-scan-auto` (branch `codex/live-brand-alignment`, package 0.4.0 unpublished, engine 1.1.0, rubric 1.0.3, NOT founder-approved); control plane `~/Desktop/Boppi-auto` with the engine synced. Read, in order: `BOPPI_TASK_LEDGER.md` (top section and Phase 3), `BOPPI_NEXT_SESSION.md` (top section), `docs/milestone1/ADJUDICATION.md` rows 24 to 41, `docs/phase3/DISCOVERY_SPIKE.md`. Run `git status` in both repos first; an untracked or modified `src/cli/discovery/session.js` is P3-3 work in flight, keep it.

Do, in order:

1. Finish P3-3 `boppi discover --client <key> --server <name> [--yes] [--record <file>] [--forget]` per DISCOVERY_SPIKE sections 3, 4, 6, 8: wire the command into `src/cli/boppi.js` (COMMANDS, parseArgs, usage), consent text (sanitized launch line, env names only, the four methods Boppi will send), `src/cli/discovery/session.js` for the session, a cache at `~/.boppi/discovery/<serverId>.json` (mode 600, entry hash, 7-day age), a lock file, tests in `test/verify-discover.js` that drive the eight fixtures through the real command with canaries and the recorder's method-set proof, and `test/verify-no-network.js` assertions that passive commands never spawn. Log the decision, mark P3-3 done in both ledgers, commit.
2. P3-4: `basis: advertised` in `models.ATTRIBUTE_SCHEMA`, the rubric row ("advertised, reach unknown"), renderers, and the control plane allowlist; rubric version bump only if a step count changes.
3. P4-1 and P4-2 (`boppi watch`, foreground only, `docs/phase4/WATCH_DESIGN.md`) are done. P4-3 bounded run done (`scripts/watch-soak.js`, `docs/phase4/SOAK_2026-10-23.md`); the 24-hour soak is the founder's. Then P5-1 (migration reconciliation note), P5-2 (dashboard recognition field), in ledger order.

At every unit: tests green (`node test/run-all.js`, `BOPPI_SCAN_DIR=~/Desktop/boppi-scan-auto npm run verify` in `apps/control-plane` when the engine changes), a `DECISIONS.tsv` row, ledger and handoff files updated in both repos, a local commit. If `src/` changes in a way that belongs in the candidate, rebuild `~/Desktop/Boppi-candidate-0.4.0` after moving the previous build aside (never delete). Never mark P0-2, P1-9, P1-10, or P2-7 complete. End the reply with an "Attention" section listing what needs the founder: rubric questions 1 to 4, 6, 7; Phase 3 section-12 decisions; Phase 0 kit version; publication.
