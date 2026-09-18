# Changelog

## 0.1.0

First public release.

- One-command local scan: `boppi scan` discovers Claude Desktop, Claude Code, and Cursor MCP configurations on this machine.
- Builds an evidence-backed inventory of agents, MCP servers, capabilities, and permissions, then maps potential exposure paths between them.
- Root-cause clustering names the single highest-leverage fix and a minimal remediation plan.
- Machine-readable JSON export (export v2 schema plus exposure paths) and a self-contained HTML report.
- CI-friendly: `--fail-on <severity>` exits non-zero when findings or paths reach the threshold.
- Runs 100% locally; reads only MCP configuration metadata and lists every file it read in a privacy footer.
