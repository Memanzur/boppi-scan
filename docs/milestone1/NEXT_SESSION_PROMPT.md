# Next session prompt (written 2026-10-23, after P8-1 and P9-1)

Paste this as the first message of the next autonomous session.

---

BOPPI, continue autonomous development under the standing rules (local code, tests, docs, synthetic fixtures only; never push, merge, publish, deploy, migrate, change staging or production, install persistent services, scan real private configurations, collect user data, apply real fixes, approve security exceptions, or mark human tests complete; stop for a serious unresolved security issue or when nothing safe remains).

State: scanner `~/Desktop/boppi-scan-auto` (branch `codex/live-brand-alignment`, package 0.4.0 unpublished, engine 1.1.0, rubric 1.0.3, NOT founder-approved; 28 of 28 suites); control plane `~/Desktop/Boppi-auto` (engine synced; `BOPPI_SCAN_DIR=~/Desktop/boppi-scan-auto npm run verify` in `apps/control-plane` passes, including `verify:remediation` 235 checks). Read, in order: `BOPPI_TASK_LEDGER.md` (whole file; it is the master ledger in both repos), `BOPPI_NEXT_SESSION.md` (top section), `docs/milestone1/ADJUDICATION.md` (latest section), `docs/phase8/EVIDENCE_LAYERS.md` ("Not done"), `apps/control-plane/docs/phase9/REMEDIATION_THREAT_MODEL.md` ("What the next slices need"). Run `git status` in both repos first and keep anything uncommitted.

Every roadmap row that can be implemented locally without a founder decision is done. The open ledger rows are founder gates: P0-2, P1-9, P1-10, P2-7 (human sessions), P2-8 (publication, NPM_TOKEN), P3-5 (a real server), P4-4 (background install, 24-hour soak), P5-3 (staging, production migrations, backup secrets), P10-1 (design partners). Also founder decisions: rubric questions 1 to 4, 6, 7; Phase 3 section-12 decisions; Phase 0 kit version; Phase 7 content consent; whether evidence layers travel with `boppi push`.

If the founder has answered any of those, that answer is new authorization for that gate only; do exactly what it covers and nothing adjacent. If a cross-model review left findings in `docs/milestone1/ADJUDICATION.md` marked open, reproduce and fix them first. Otherwise, safe local work that remains optional and unprioritized: a Phase 8 large-graph fixture (1,000 nodes, 5,000 edges) with a documented traversal budget and a p95 measurement on this machine; a control plane reader for `evidenceLayers` behind a flag that does nothing until push sends them; connector-side pseudocode for the write boundary in `docs/phase9`. Do not start a connector, pairing, tables, or routes without the security review the roadmap requires.

At every unit: tests green, a `DECISIONS.tsv` row, ledger and handoff files updated in both repos, a local commit. If `src/` changes in a way that belongs in the candidate, rebuild `~/Desktop/Boppi-candidate-0.4.0` after moving the previous build aside (never delete). Never mark P0-2, P1-9, P1-10, P2-7, or any other human gate complete. End the reply with an "Attention" section listing what needs the founder.
