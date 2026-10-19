# Changelog

## 0.3.1

Local candidate additions (unpublished):

- Built-in agent tools are in the graph. Claude Code (Bash, Read, Edit, Write) and Cursor (terminal, file edits) carry shell and file access as grants on the agent itself, so Claude Code with one `fetch` server now reports the privilege path (EP-E) it always had, exfiltration paths include the agent's own file access, and removing an MCP shell server is never offered as the fix for a shell the agent keeps. Claude Code's permission settings (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`) grade each tool as prompts, no prompt, or denied; a whole-tool deny removes the capability. Only rule counts and the mode are recorded. The terminal and HTML reports list BUILT-IN TOOLS separately from MCP servers, the settings files appear in DISCOVERY and the privacy footer, and every prediction, plan, fix, and verify rescan includes the built-in grants, so "removing X breaks N paths" stays true. Demo scenarios now show the same paths a real Claude Code machine would.
- Unrecognized servers are named instead of silent. A server that matches no catalog entry, name rule, url, directory argument, or declared capability is tagged `unrecognized` in MCP SERVERS, listed under UNRECOGNIZED SERVERS with its launch and the reasons nothing matched, named in the COVERAGE not-established line, shown in the HTML report, exported as `recognition` in JSON, and reported in SARIF as `BOPPI-UNRECOGNIZED`. Package launches now keep their version: `npx pkg@1.2.3`, `uvx pkg==1.2.3`, and `docker run image:tag` are pinned; no version, `latest`, or a range is `unpinned` (PACKAGE PINS section, SARIF `BOPPI-UNPINNED`). A catalog server with no capability, such as the time server, stays recognized.
- Per-tool reach and file scope. Tool names from the catalog and the config map to the engine's finer categories (`push_files` modifies source, `kubectl_apply` reaches production, `slack_post_message` sends an external message, a Gmail server reads and sends email), and each filesystem directory argument is graded as the whole home directory, a system-wide directory, a dotfile or secrets folder, a source tree, or a folder elsewhere before the path is discarded. Each category becomes one more permission on the server (source id `tool-reach:<server>:<category>`), so the supply-chain path (EP-C) and the impersonation path (EP-F) now fire from real configurations, and a filesystem server at `~/` is no longer graded like one at a photos folder. The terminal report prints `file scope:` and `reach through tools:` under each server, the HTML report shows them under capabilities, and the graph carries them as server evidence. No path is recorded.
- Collector version/platform and discovery coverage are transported through scan exports and pushes. Selected or incomplete scans merge safely; older files do not inherit a fabricated producer version. Dry runs show the envelope, and redirects are refused.
- Exact-identity MCP catalog with capability/tool provenance; analysis engine 1.0.1 marks catalog-derived reach as inferred.
- Synthetic interactive browser demo with shared graph evidence, removal previews, and reset.
- Sanitized `plan --diff`, integrity-checked local backups, staged fixes, and rollback that protects later configuration changes.
- Optional, manually configured local hook capture with bounded inputs and retention; no automatic installation or runtime upload.

- `boppi push` sends `snapshot_at` (the export's `exportedAt`) with every snapshot, so the workspace can refuse a snapshot older than the one it already holds from this machine. An export without a timestamp is still pushed, without the field.
- A `409 stale_snapshot` rejection prints the server message and the time of the snapshot the workspace kept; a `429 rate_limited` rejection prints the server message and how many seconds to wait (from the body, or the `Retry-After` header). Both exit 5, like every other rejected push. The client never retries on its own.
- `boppi plan` prints the POLICY section and exits 1 when `boppi.policy.json` (or `--policy`) is violated, the same as `boppi scan`. Before, it evaluated the policy and ignored the result.
- `boppi scan` ends its terminal report with a `boppi push` hint.
- Docs: the local history file keeps the last 40 entries, not 20 as the 0.2.0 notes said; `boppi plan` and `boppi fix` are listed with the commands that make no network requests; the Linux Claude Desktop path is in the discovery table.

## 0.3.0

- `boppi plan`: compare every candidate fix side by side (paths broken, new paths it would create, capabilities the agent loses) and print the exact file and key for each edit. Changes nothing.
- `boppi fix --server <name>`: remove one server entry from the config that holds it, after a mode-600 backup under `~/.boppi/backups/` and a confirmation (`--yes` for scripts), save the predictions it used, rescan, and grade the result. Exit 0 means CONFIRMED.
- Predictions now simulate moving a server between clients, rescanned on both the source and the target, and every prediction names the capabilities the agent would lose that no other server provides. Ranking prefers fewer new exposures and less lost capability.
- `boppi history` reports verified exposure reduction: eliminations confirmed by `verify` or `fix` that are still absent from the latest scan.
- Policy guard: `boppi.policy.json` in the working directory (or `--policy <file>`) declares denied servers, capabilities, capability combinations, an allow list, a severity floor, and whether unrecognized servers are allowed. Violations print in a POLICY section, land in the JSON and SARIF exports, and exit 1. Unknown keys and invalid values exit 2.
- `--sarif <file>` writes a SARIF 2.1.0 report with the exposure templates, findings, and policy rules as rules, using portable config paths.
- A GitHub Action (`action.yml`) runs the scan on a repository's MCP config in CI and can upload the SARIF to code scanning.
- The secret-value redaction now requires a boundary before each token prefix, so package names such as `@wonderwhy-er/desktop-commander` are no longer redacted and can be matched by a policy.
- `npm test` proves that every command except `push` makes no network request: the suite runs each command with sockets, DNS, and `fetch` disabled.

## 0.2.0

The free beta release.

- `boppi push`: send one scan's sanitized inventory to a Boppi workspace with a collector token (`npx boppi push`, then paste the token at the hidden prompt; `BOPPI_TOKEN` or `--token` for scripts). This is the only command that uses the network. It sends agent, MCP server, permission, and integration records as a snapshot, so a machine that gets fixed shows up fixed. `--dry-run` prints exactly what would be sent; `--file` pushes an earlier `--json` export; `--merge` keeps records absent from the scan.
- `boppi history`: the last 40 local scan summaries and what changed between them. Scans now record a sanitized summary in `~/.boppi/history.json`; `--history-file` moves it.
- Credential arguments are redacted. Values that look like tokens, keys, bearer or JWT values, or connection strings with embedded passwords; the value after a flag whose name says credential (`--api-key x`, `--token x`, `-p x`); and the value side of `--key=...` or `NAME_PASSWORD=...` never reach a model, export, history file, or verifier bundle. Previously only env values and flag names were protected, and the value after `--token` went through untouched.
- The report gains an MCP SERVERS table, a COVERAGE section that separates what the scan established from what it cannot know, a CHANGES SINCE LAST SCAN comparison, and a NEXT STEPS footer that names the exact `boppi verify` command for the export you just wrote.
- `boppi verify` explains each grade in plain words next to its reason code and ends with the next action. Contradiction fixture names are sanitized and proven to stay inside the output directory.
- Argument errors are no longer silent: an unknown `--only` client or a missing `--config` file exits 2 with the reason instead of reporting a clean machine. A config that is a directory or unreadable says so instead of "invalid JSON". A config rejected for secret material says what to do about it.
- Path fingerprints are keyed with a per-machine secret (`~/.boppi/fingerprint-key`, created once, owner-only), so a common path such as a home directory cannot be recovered by hashing guesses. Fingerprints stay stable on one machine and differ across machines.
- A clean scan ("no exposure paths") no longer says "good sign". It says it is not proof the environment is safe.

## 0.1.0

First public release.

- One-command local scan: `boppi scan` discovers Claude Desktop, Claude Code, and Cursor MCP configurations on this machine.
- Builds an evidence-backed inventory of agents, MCP servers, capabilities, and permissions, then maps potential exposure paths between them.
- Root-cause clustering names the single highest-leverage fix and a minimal remediation plan.
- Machine-readable JSON export (export v2 schema plus exposure paths) and a self-contained HTML report.
- CI-friendly: `--fail-on <severity>` exits non-zero when findings or paths reach the threshold.
- Runs 100% locally; reads only MCP configuration metadata and lists every file it read in a privacy footer.
