# boppi

See what your local AI agents can reach.

`boppi scan` reads the MCP server configs for Claude Desktop, Claude Code, and Cursor on your machine, builds a graph of what each agent can touch, and reports the potential exposure paths that fall out of it. Everything runs locally. No account, no telemetry, no dependencies.

```
npx boppi scan
```

Node 18 or newer. Tested on macOS. Linux and Windows config locations are looked up but not yet verified on real machines.

## What you see

A machine with a filesystem server, a shell server, a fetch server, and a 1Password server configured in Claude Desktop:

```
BOPPI · AI Agent Security scan · v0.1.0
2026-09-18T01:23:47.625Z · completed in 0.02s · everything ran locally

DISCOVERY
  ✓ Claude Desktop  ~/Library/Application Support/Claude/claude_desktop_config.json  4 servers
  ✓ Claude Code     ~/.claude.json  0 servers
  · Claude Code     ~/.mcp.json  not found
  ✓ Cursor          ~/.cursor/mcp.json  1 server

INVENTORY  3 agents · 5 MCP servers · 3 exposure paths (2 critical) · 3 findings (2 critical)

AGENTS (3)
  agent             risk              servers  capabilities  worst exposure path
  Claude Desktop    100/100 critical  4        5             CRIT Potential data exfiltration path
  Cursor            2/100 low         1        1             none
  Claude Code       0/100 low         0        0             none

EXPOSURE PATHS (3)
  CRIT  Potential data exfiltration path  [EP-A · confidence 0.7]
     Claude Desktop -> filesystem (filesystem_access) -> read files -> fetch (network_access) -> call external api -> External destination
     why: If this agent were compromised or misdirected, data it can read could potentially reach an untrusted external destination.
     fix: Remove external messaging or API access, or restrict the sensitive-data grants feeding this path.

  CRIT  Potential credential exposure path  [EP-B · confidence 0.7]
     Claude Desktop -> 1password (credential_access) -> access credentials -> desktop-commander (shell_access) -> run shell commands -> fetch (network_access) -> call external api
     why: Credential references combined with execution and network access create a potential path for credential material to leave the environment.
     fix: Restrict shell or credential access and remove network capabilities this agent does not need.

  HIGH  Potential privilege path  [EP-E · confidence 0.7]
     Claude Desktop -> fetch (untrusted_external_content) -> untrusted external content -> desktop-commander (shell_access) -> run shell commands
     why: Instructions hidden in untrusted content could potentially influence an agent with privileged local capabilities.
     fix: Isolate untrusted content from privileged tools, or remove shell, code-execution, or destructive file capabilities.

ROOT CAUSE  the single change that breaks the most exposure paths
  ▸ Fix: Remove the server entry "fetch" from Claude Desktop's MCP configuration to revoke its "call external api" grant. Rescan afterward to verify the change landed.
    edit: remove the "fetch" entry from ~/Library/Application Support/Claude/claude_desktop_config.json
    breaks 2 of 3 paths · 2 critical  (leaves 1)

PRIVACY  Files read this run — metadata only, sanitized in memory, nothing left this machine:
  - ~/Library/Application Support/Claude/claude_desktop_config.json
  - ~/.claude.json
  - ~/.cursor/mcp.json
  Secret values, file contents, and raw path names are never collected. Paths become fingerprints.
```

The root cause section is computed, not guessed. The engine removes the grant from the graph, reruns the path search, and reports how many paths are gone.

## How it works

1. **Discover.** Locate each client's MCP config files. A missing file is reported as not found, never as an error.
2. **Infer capabilities.** Config files rarely declare what a server can do, so the scanner infers capabilities from evidenced identity: the package name, the command, directory arguments, and environment variable names. Every inference is labeled with what matched and carries evidence class `inferred`.
3. **Build the graph.** Agents, servers, capabilities, data, credentials, and destinations become nodes. Every edge records where it came from.
4. **Find paths.** Six templates describe chains that matter. A path is reported when the graph contains the whole chain.
5. **Rank the fix.** For each grant, remove it and rerun the search. The grant that breaks the most paths is the recommended fix.

## What it looks for

Exposure path templates:

| Id | Path | Severity |
|----|------|----------|
| EP-A | Data exfiltration: readable data reaches an external destination | critical |
| EP-B | Credential exposure: credential access reaches execution and the network | critical |
| EP-C | Software supply chain: source modification reaches production | critical |
| EP-D | Supply-chain exposure: sensitive data sits behind an unverified server | high |
| EP-E | Privilege: untrusted content reaches shell, code, or destructive file tools | high |
| EP-F | Impersonation: untrusted content reaches email or messaging | high |

Rule-engine findings (AE-001 through AE-007) cover the same combinations per agent, plus one data-governance check: broad file access granted to a vendor whose data-training posture is unknown.

Every path is potential. The scanner sees configuration, not behavior. It cannot tell you an agent has been exploited, only that the grants would allow it.

## Commands and flags

```
boppi scan                     discover configs, scan, print the full report
boppi agents                   inventory table only
boppi paths                    exposure paths only

--json <file>       machine-readable export with full evidence per claim
--html <file>       self-contained HTML report you can share
--only <clients>    limit discovery: claude-desktop, claude-code, cursor
--config <path>     scan one explicit config file, skip discovery
--source <id>       client type for --config
--fail-on <sev>     exit 1 if any finding or path is at or above this severity
--quiet             one summary line
--verbose           all paths, per-server capability provenance
--no-color          plain text (NO_COLOR is also respected)
--version           print the version
```

Exit codes: 0 clean, 1 threshold hit under `--fail-on`, 2 bad arguments, 3 scan failed, 4 a client could not be analyzed under `--fail-on`.

### Use it in CI

```
npx boppi scan --fail-on critical --quiet
```

Fails the job when a critical path exists on the runner, or when a client config could not be analyzed.

## Privacy

The scanner reads configuration metadata only. It never collects secret values, environment variable values, file contents, or raw filesystem paths. Paths become fingerprints before they reach the report. Every file that was read is listed at the end of the run so you can check the claim yourself.

Nothing leaves the machine. There is no network code in this package.

If a server entry contains something that looks like a secret, the scanner refuses that client's config and prints the reason instead of a result. Move the secret out of the config and rescan.

## Discovery targets

| Client | Files |
|--------|-------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\\Claude\\claude_desktop_config.json` on Windows |
| Claude Code | `~/.claude.json`, plus `.mcp.json` in the working directory |
| Cursor | `~/.cursor/mcp.json`, plus `.cursor/mcp.json` in the working directory |

Windsurf and VS Code are not discovered yet. Pull requests welcome. Each client is one file under `src/cli/discovery/`.

## Development

```
git clone https://github.com/Memanzur/boppi-scan
cd boppi-scan
npm test
node bin/boppi.js scan
```

The suites under `test/` are executable checks, not unit tests. `npm test` runs all of them and exits non-zero on any failure. See CONTRIBUTING.md before changing anything under `src/engine/`.

## Part of Boppi

This scanner is the local collector for [Boppi](https://github.com/Memanzur), an AI-agent exposure platform that runs the same engine across an organization. The scanner is complete on its own and stays free.

## License

Apache-2.0. See LICENSE.
