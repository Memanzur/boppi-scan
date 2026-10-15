# Changelog

## 0.2.0

The free beta release.

- `boppi push`: send one scan's sanitized inventory to a Boppi workspace with a collector token (`npx boppi push`, then paste the token at the hidden prompt; `BOPPI_TOKEN` or `--token` for scripts). This is the only command that uses the network. It sends agent, MCP server, permission, and integration records as a snapshot, so a machine that gets fixed shows up fixed. `--dry-run` prints exactly what would be sent; `--file` pushes an earlier `--json` export; `--merge` keeps records absent from the scan.
- `boppi history`: the last 20 local scan summaries and what changed between them. Scans now record a sanitized summary in `~/.boppi/history.json`; `--history-file` moves it.
- Credential arguments are redacted. Values that look like tokens, keys, bearer or JWT values, or connection strings with embedded passwords; the value after a flag whose name says credential (`--api-key x`, `--token x`, `-p x`); and the value side of `--key=...` or `NAME_PASSWORD=...` never reach a model, export, history file, or verifier bundle. Previously only env values and flag names were protected, and the value after `--token` went through untouched.
- The report gains an MCP SERVERS table, a COVERAGE section that separates what the scan established from what it cannot know, a CHANGES SINCE LAST SCAN comparison, and a NEXT STEPS footer that names the exact `boppi verify` command for the export you just wrote.
- `boppi verify` explains each grade in plain words next to its reason code and ends with the next action. Contradiction fixture names are sanitized and proven to stay inside the output directory.
- Argument errors are no longer silent: an unknown `--only` client or a missing `--config` file exits 2 with the reason instead of reporting a clean machine. A config that is a directory or unreadable says so instead of "invalid JSON". A config rejected for secret material says what to do about it.
- A clean scan ("no exposure paths") no longer says "good sign". It says it is not proof the environment is safe.

## 0.1.0

First public release.

- One-command local scan: `boppi scan` discovers Claude Desktop, Claude Code, and Cursor MCP configurations on this machine.
- Builds an evidence-backed inventory of agents, MCP servers, capabilities, and permissions, then maps potential exposure paths between them.
- Root-cause clustering names the single highest-leverage fix and a minimal remediation plan.
- Machine-readable JSON export (export v2 schema plus exposure paths) and a self-contained HTML report.
- CI-friendly: `--fail-on <severity>` exits non-zero when findings or paths reach the threshold.
- Runs 100% locally; reads only MCP configuration metadata and lists every file it read in a privacy footer.
