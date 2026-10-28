# Release candidate: boppi 0.4.0 (local, unpublished)

**Current frozen candidate (2026-10-27):** `~/Desktop/Boppi-candidate-0.4.0-104147d`, source `104147d`, sha256 `1de37969ccb1ae094c69b48800b5d27303308ead12dca7e73fb8d938da2c16d0`; cross-component manifest in control `docs/release/RELEASE_MANIFEST_0.4.0-104147d.json`. Source has moved on since (Milestone A safety fixes, see `BOPPI_NEXT_SESSION.md`), so a newer candidate will supersede it; until then 104147d is the one to select. The 2026-10-25 candidate `2d65a09` and everything below are history.

## October 25 continuation: three verified beta blockers repaired locally; independent confirmation pending

Scanner source `3fde321`, control-plane implementation `ce2b2aa`. Full scanner 35/35; source and packaged blocker regressions 29; exact-package privacy 31 and no-network 22; fresh-install journey 29; control verify exit 0; DB 124 with no security-advisor issues; recovery barrier and all consent suites pass. Candidate `~/Boppi-beta-blocker-repairs-20261025/candidate-0.4.0-3fde321`, sha256 `2e78a28cdc326c7ec14779578b7d119d9669d8831d2155b9e7d7482bcee4c747`.

History is coverage-bound; moves require both endpoints, matching server configuration and destination exposure evidence; unknown/partial/legacy evidence never confirms. Consent migration is non-reversible: only file-6 rollback or forward repair is supported after consent installation, and older down files refuse direct bypass attempts. Full reversal to the pre-consent API is unsupported.

Decision: HOLD pending Codex independent retest. The review package and evidence are at `~/Boppi-beta-blocker-repairs-20261025/review/`; active report `docs/release/RELEASE_DECISION_2026-10-25.md` in the control repo. Human sessions 0/5, rubric unapproved; all founder, external security, real-device and hosted gates remain. No push, merge, publication, deployment, hosted migration or founder approval. Prior candidates and independent continuation preserved. The dirty 5a(b) worktree remains at `3447992`, excluded and untouched. Do not rebuild old candidates or restart these repairs without checking the new evidence first.


Built by `npm run release-candidate` from the commit named in the candidate's `CANDIDATE.json`; `npm run verify-versions` checks that package, engine, rubric, changelog, this document, and the manifest agree, and `scripts/candidate-kit/prepare-fixtures.py <candidate dir>` rebuilds the six-case facilitator kit from the tarball; the manifest also carries the tarball sha256, engine 1.1.0, the rubric version (1.0.3 as of 2026-10-23; earlier builds are kept beside the current one as `Boppi-candidate-0.4.0-superseded-rubric-<version>`), and the journey check results. Publishing to npm, tagging, and any website change need separate founder authorization and are not part of this document.

## October 24 rebuild

Rebuilt from the clean scanner head after the control plane's snapshot comparison work (U-5) and the product vision checkpoint. Scanner source is unchanged from the October 23 build apart from documentation; 33 of 33 suites passed before the rebuild and the journey passed 29 of 29 checks. `CANDIDATE.json` names the exact commit and sha256; the October 23 build is preserved as `~/Desktop/Boppi-candidate-0.4.0-superseded-20261024T174429Z-pre-u5`. Package 0.4.0, engine 1.1.0, rubric 1.0.3 (unapproved). Still unpublished; human sessions 0 of 5.

## October 23 preparation snapshot

The candidate was rebuilt locally after correcting the demo's printed client and quoting a saved scan path with spaces. Its manifest is the authority for the exact commit/checksum (older builds remain beside it). The journey now has 29 checks, including an interactive QA-only participant wrapper; human sessions remain 0/5. The kit's sandbox wrapper requires Python 3.9 or newer in addition to Node. The wrapper's `fix` and `rollback` keep their confirmation prompts.

This snapshot includes the later opt-in discovery, foreground watch and hook/evidence code in the current source tree. Those commands are outside the usability exercise, and their live-client, consent and release-scope gates remain open. The baseline limits below describe a passive scan; they do not claim that an explicitly launched discovery server has no network or process side effects. Read the founder decision register and review package in the control-plane repo before choosing a publication scope.

## Supported

| Platform | Status | Config locations read |
| --- | --- | --- |
| macOS (Node 18 or newer) | verified by the candidate journey on the build machine | Claude Desktop, Claude Code (`~/.claude.json`, `.mcp.json`, settings files), Cursor |
| Linux | experimental; locations are looked up, not verified on a real machine. Exact 2d65a09 tarball suites (34/29/31/22) pass under Node 18.20.8 and 22.23.3 in network-disabled containers (2026-10-25); the full source suite exposed one Linux-only collector defect, fixed in source after the candidate | same clients, XDG paths |
| Windows | experimental; locations are looked up, not verified on a real machine | same clients, `%APPDATA%` paths |

Clients: Claude Desktop, Claude Code, Cursor. Other clients are not discovered; `--config <file> --source <client>` scans one file explicitly.

## Install, run, remove

```sh
mkdir -p ~/boppi-beta && cd ~/boppi-beta
shasum -a 256 boppi-0.4.0.tgz              # compare with CANDIDATE.json sha256
npm install -g --prefix ~/boppi-beta ./boppi-0.4.0.tgz
~/boppi-beta/bin/boppi --version           # 0.4.0
~/boppi-beta/bin/boppi demo                # synthetic sandbox, never your configs
~/boppi-beta/bin/boppi scan --json scan.json --html report.html
```

Remove: `npm uninstall -g --prefix ~/boppi-beta boppi`, then delete `~/boppi-beta` and `~/.boppi` (history, demo sandbox, fix backups). Nothing else is written. No account, no network call except `boppi push`, which is never run by any other command.

## What is new in 0.4.0 for a tester

- Each exposure path shows a priority badge, `based on:`, `assumes:`, and `not checked:` lines, `evidence confidence`, and `likelihood not assessed`. The badge can be lower than the template's worst case when evidence is weak; it is never raised.
- A filesystem server at an ordinary folder plus a network server is medium, not critical, until the scan can show the files are sensitive. The home directory or a secrets folder stays critical.
- `boppi verify` and `boppi fix` say how many paths closed, how many stayed open at a lower priority, and what remains; an edit that closes or lowers nothing says so before it is applied.
- Claude Code's own WebFetch and WebSearch count as two grants that ask before each use (WebFetch is an exit and untrusted content; WebSearch is untrusted content only, and a settings rule for one never changes the other). A Claude Code install with no MCP server therefore shows a high exfiltration path and a medium privilege path, each stating that an approved prompt is the assumption. Removing an MCP fetch server from Claude Code lowers such a path rather than closing it, and the report says which built-in tools keep it open and where a settings deny rule would go. Boppi never edits settings.
- A permission whose name suggests production access (for example `cluster.viewer`) is not a production path unless a tool list or an access level shows what it can change; such a record is listed under COVERAGE as named like production access with nothing behind it when it is imported; a local scan never creates one, because it only derives production reach from write-verb tool names.
- Unrecognized servers are counted in the INVENTORY line as unknown reach. Docker images run by tag are listed as tagged.

## Known limits

- Configuration evidence only. No runtime observation, no blocking, no alerting, no background process.
- Managed (machine-wide) Claude Code settings are not read; every built-in grant says so.
- Whether a client prompts before an MCP tool call is not checked.
- Sensitivity of files in an ordinary folder is not established; the path is kept at assumed strength.
- Symlinks and mounts in filesystem arguments are not resolved.
- Claude Desktop's and Cursor's web features are not modeled; Claude Code's WebFetch and WebSearch are.
- The AGENTS band is the worst open finding or path on the agent; the score is the engine's points within that band.
- Likelihood of exploitation is never estimated.

## Builds

- 2026-10-24 (current): commit `cd44081`, sha256 `95c6a425d4ef6a1538db6f84ad62bc7b64798f662cf85c3533a44d55e3d8da42`, journey 29/29, kit rebuilt from this tarball. Change since the previous build: scrollable tables in the HTML report and demo are keyboard-focusable named regions (axe clean at 1280 and 390 px in Chromium). Previous build preserved as `~/Desktop/Boppi-candidate-0.4.0-superseded-20261025T003103Z-pre-a11y`.

## Reporting a problem

Email boppii.ioo@gmail.com or open an issue at https://github.com/Memanzur/boppi-scan/issues. Send the terminal output or a screenshot, the `boppi --version` line, and the one thing you expected. Never send tokens, passwords, config file contents, or the JSON export from a work machine. If any Boppi output shows a secret value or a raw path from your machine, send the field name only; that is a bug we fix first.

## Withdrawal

If a candidate is found to produce an unsafe edit, leak private data, or report an unjustified critical, the founder marks it withdrawn in this file and in `CANDIDATE.json` (`withdrawn: true`, reason, date), testers are emailed to uninstall, and the next candidate carries a new version. Backups under `~/.boppi/backups` let any applied fix be rolled back with `boppi rollback`.
