# Sealed held-out set (v2)

This directory is a fresh held-out set for the detection engine. It is not part of `npm test`. Do not add `harness.js` to `test/run-all.js`.

The previous held-out set was used to judge rule changes, so it is no longer a clean release check. Melody's bar is 80% critical recall on a sealed set. This one has not been used to edit rules.

## Order of work

`RUBRIC.md` was written from `docs/EVALUATION.md` and the README before any case was labeled. `build-cases.js` records those labels and writes `cases.json`. It does not scan. `LABEL_CHANGELOG.md` is empty of corrections until a label is shown to contradict the rubric.

## What a case is

Each case is one Linux home: client config files for Claude Desktop, Claude Code, Cursor, Codex, Cline, Windsurf, VS Code, and the other clients the scanner reads. Paths use `{{HOME}}` and `{{CWD}}`. The harness fills those in under a temporary directory and deletes it. Configs follow public MCP server READMEs and the client formats cited in the rubric. No file holds a credential value.

The set has 128 homes. 56 are benign (expected highest `none` or `medium`). The homes include several clients in one home, disabled servers, approval bypass settings, remote URLs, `npx`, `uvx`, and `docker` launches, and adversarial names.

## Sealing

`node test/heldout-v2/harness.js` scans every home locally, with no network, and prints only aggregate precision and recall by severity, critical combo recall, and p95 scan time. It does not print case ids, rationales, or per-case diffs, so a rule change cannot be tuned against a single miss.

A case is predicted at its highest open finding or exposure path. Precision and recall use that one label. Combo recall is the share of homes with a non-empty `expectedCriticalCombos` list whose predicted highest is critical. Config hygiene notes from the fixer are not scored.

The first beta scores are recorded in `docs/EVALUATION.md`. They are not copied back into the labels.

## Papers

The rubric cites the papers that justify a fresh sealed set and a written labeling scheme: Dwork et al., Science 2015; Recht et al., ICML 2019; Oren et al., ICLR 2024; Artstein and Poesio, Computational Linguistics 2008. Full citations are in `RUBRIC.md`.
