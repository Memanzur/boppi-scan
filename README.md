# boppi

See what your local AI agents can reach.

`boppi scan` reads the MCP server configs for Claude Desktop, Claude Code, and Cursor on your machine, builds a graph of what each agent can touch, and reports the potential exposure paths that fall out of it. The scan runs locally. No account, no telemetry, no dependencies.

```sh
npx boppi scan
```

Node 18 or newer. Tested on macOS. Linux and Windows config locations are looked up but not yet verified on real machines.

## Free beta

The work on `claude/autonomous-platform` is a local, unpublished beta candidate. To try this exact checkout, use `node bin/boppi.js` from its repository directory. Registry commands may run an older release.

```sh
# Synthetic browser demo; only bundled examples are read.
node bin/boppi.js demo --html boppi-demo.html
# Synthetic CLI sandbox with scan, plan, fix, and verify follow-up commands.
node bin/boppi.js demo
```

Open `boppi-demo.html` in a browser. Choose a scenario, inspect graph evidence, preview a simulated removal, and reset the simulation. The browser demo applies no real configuration changes. Local fixes run from the terminal; `boppi ui` is not available in this candidate.

Boppi is useful without an account. The scanner reads supported MCP configuration locally, reports the agents, servers, capabilities, files, and evidence it examined, models configuration changes, and verifies a real change on the next scan.

```sh
npx boppi scan --json boppi-scan.json --html boppi-report.html
# edit the configuration using the recommended fix, then:
npx boppi verify boppi-scan.json
npx boppi history
```

Teams can create a free workspace at [app.boppi.io](https://app.boppi.io), generate a collector token on the Collectors page, and push scans from every machine:

```sh
npx boppi push
```

It asks for the collector token (typed input is hidden, so the token stays out of your shell history). `BOPPI_TOKEN` or `--token` work for scripts. `push` is the only command that uses the network, and it sends only the sanitized inventory of one scan (see [What leaves the machine](#what-leaves-the-machine)).

## What you see

A machine with a filesystem server, a fetch server, a shell server, and a 1Password server configured in Claude Desktop, plus a browser server in Cursor:

```
BOPPI · AI Agent Security scan · v0.2.0
2026-10-15T01:40:12.004Z · completed in 0.03s · everything ran locally

DISCOVERY
  ✓ Claude Desktop  ~/Library/Application Support/Claude/claude_desktop_config.json  4 servers
  ✓ Claude Code     ~/.claude.json  0 servers
  · Claude Code     ~/.mcp.json  not found
  ✓ Cursor          ~/.cursor/mcp.json  1 server

INVENTORY  3 agents · 5 MCP servers · 3 exposure paths (2 critical) · 3 findings (2 critical)

AGENTS (3)
  agent             risk              servers  capabilities  worst exposure path
  Claude Desktop    100/100 critical  4        5             CRIT Potential credential exposure path
  Cursor            6/100 low         1        3             none
  Claude Code       0/100 low         0        0             none

MCP SERVERS (5)
  filesystem · Claude Desktop · capabilities: filesystem_access
  fetch · Claude Desktop · capabilities: network_access, untrusted_external_content
  desktop-commander · Claude Desktop · capabilities: shell_access
  1password · Claude Desktop · capabilities: credential_access
  puppeteer · Cursor · capabilities: browser_automation, untrusted_external_content, network_access

COVERAGE
  Established: 3 agents, 5 MCP servers, and 3 configuration files examined.
  Not established: runtime behavior, activity that did not appear in configuration, or access not evidenced by the scanned metadata.
  Scan status: complete for the supported configuration sources that were found.

EXPOSURE PATHS (3)
  HIGH  Potential credential exposure path  [EP-B · evidence confidence 0.7 · likelihood not assessed]
     Claude Desktop -> 1password -> access credentials -> desktop-commander (shell_access) -> run shell commands -> fetch (network_access) -> call external api
     why: Credential references combined with execution and network access create a potential path for credential material to leave the environment.
     based on: desktop-commander: can run code or commands (listed in the known-server catalog); fetch: can reach the network (listed in the known-server catalog)
     assumes: "1password" is graded from its name, not from a tool list or catalog entry
     not checked: whether the client asks before each MCP tool call was not checked; no tool call, data transfer, or attack was observed; this is configured potential access
     priority: high, stepped down from critical because the weakest evidence is potential
     fix: Restrict shell or credential access and remove network capabilities this agent does not need.

  CRIT  Potential data exfiltration path  [EP-A · evidence confidence 0.7 · likelihood not assessed]
     Claude Desktop -> filesystem (filesystem_access: the whole home directory) -> read files -> fetch (network_access) -> call external api -> External destination
     why: If this agent were compromised or misdirected, data it can read could potentially reach an untrusted external destination.
     based on: filesystem: reads data that may be sensitive (listed in the known-server catalog); the files in reach cover the whole home directory; fetch: can reach an external destination (listed in the known-server catalog)
     not checked: whether the client asks before each MCP tool call was not checked; no tool call, data transfer, or attack was observed; this is configured potential access
     fix: Remove external messaging or API access, or restrict the sensitive-data grants feeding this path.

  HIGH  Potential privilege path  [EP-E · evidence confidence 0.7 · likelihood not assessed]
     Claude Desktop -> fetch (untrusted_external_content) -> untrusted external content -> desktop-commander (shell_access) -> run shell commands
     why: Instructions hidden in untrusted content could potentially influence an agent with privileged local capabilities.
     based on: fetch: processes untrusted content (listed in the known-server catalog); desktop-commander: holds a privileged capability (listed in the known-server catalog)
     not checked: whether the client asks before each MCP tool call was not checked; no tool call, data transfer, or attack was observed; this is configured potential access
     fix: Isolate untrusted content from privileged tools, or remove shell, code-execution, or destructive file capabilities.

CHANGES SINCE LAST SCAN
  First local scan. Run Boppi again after changing your environment to see what changed.

ROOT CAUSE  the single config edit that breaks the most exposures, checked by rescanning without it
  ▸ Fix: Remove the "fetch" entry from Claude Desktop's MCP configuration. Rescan afterward to verify the change landed.
    edit: remove the "fetch" entry from ~/Library/Application Support/Claude/claude_desktop_config.json
    breaks 3 of 3 exposures · 2 critical · 1 high  (leaves 0)

FINDINGS (3)  2 shown above as exposure paths; --verbose for all
  HIGH  AE-006  Claude Desktop  Broad file access has unknown vendor data-training posture

  Findings and capabilities from config scans are inferred from evidenced identity (package names,
  directory arguments, environment variable names). Every claim carries its evidence in --json.

NEXT STEPS
  1. Apply the fix above, then run boppi verify boppi-scan.json to confirm the paths are gone.
  2. boppi scan --html boppi-report.html writes a shareable report with the evidence for every claim.
  3. Working with a team? boppi push sends this sanitized inventory to your Boppi workspace (it asks for your collector token). Nothing else ever leaves the machine.

PRIVACY  Files read this run (metadata only, sanitized in memory, nothing left this machine):
  - ~/Library/Application Support/Claude/claude_desktop_config.json
  - ~/.claude.json
  - ~/.cursor/mcp.json
  Secret values, file contents, and raw path names are never collected. Paths become fingerprints.

JSON export written to boppi-scan.json
```

A plain `npx boppi scan` with no export flags ends with one more line, `See this across your team: npx boppi push   (free beta, https://app.boppi.io)`.

The root cause section is computed, not guessed. The engine removes the grant from the graph, reruns the path search, and reports how many paths are gone. `boppi verify boppi-scan.json` then checks that prediction against the real machine after you make the edit.

## How it works

1. **Discover.** Locate each client's MCP config files. A missing file is reported as not found, never as an error.
2. **Infer capabilities.** Config files rarely declare what a server can do, so the scanner infers capabilities from evidenced identity: the package name, the command, directory arguments, and environment variable names. Every inference is labeled with what matched and carries evidence class `inferred`. Coding agents also get their built-in shell and file tools, graded from Claude Code's permission settings.
3. **Build the graph.** Agents, servers, capabilities, data, credentials, and destinations become nodes. Every edge records where it came from.
4. **Find paths.** Six templates describe chains that matter. A path is reported when the graph contains the whole chain.
5. **Rank the fix.** For each grant, remove it and rerun the search. The grant that breaks the most paths is the recommended fix.
6. **Verify.** After you edit the config, `boppi verify` rescans and grades each prediction: CONFIRMED, PARTIAL, CONTRADICTED, or UNRESOLVED. A wrong prediction writes a self-contained fixture you can attach to an issue.

## What it looks for

Exposure path templates, with the worst-case impact of each:

| Id | Path | Impact |
|----|------|--------|
| EP-A | Data exfiltration: readable data reaches an external destination | critical |
| EP-B | Credential exposure: credential access reaches execution and the network | critical |
| EP-C | Software supply chain: source modification reaches production | critical |
| EP-D | Supply-chain exposure: sensitive data sits behind an unverified server | high |
| EP-E | Privilege: untrusted content reaches shell, code, or destructive file tools | high |
| EP-F | Impersonation: untrusted content reaches email or messaging | high |

Rule-engine findings (AE-001 through AE-007) cover the same combinations per agent, plus one data-governance check: broad file access granted to a vendor whose data-training posture is unknown. A finding that an exposure path also covers takes the path's priority, so every surface shows one severity per exposure.

### How priority is set

The badge on a path is its priority, not its impact. Impact is the worst case for the template. Priority is that impact stepped down by the weakest evidence on the path, never up, under a versioned rubric (`src/engine/riskRubric.js`, documented in `docs/milestone1/RISK_RUBRIC_v1.0.3.md`):

- established (0 steps): the configuration states it. A catalog capability, a built-in tool that never prompts, a filesystem server at the home directory or a secrets folder, cluster write tools and an environment named production.
- potential (1 step): one named assumption or one unchecked fact. A capability inferred from a server name, a tool the client asks before using, a source tree, a credential known only by its variable name, cluster write tools with no environment named or a non-production name, read-only cluster tools whose role was not checked.
- assumed (2 steps): the scanner cannot tell. File access to one ordinary folder or with no scope evidence. The path stays in the report with its unknowns.

Every path lists `based on:` (facts), `assumes:`, and `not checked:`. `evidence confidence` is how far the scanner trusts the records it read; likelihood of exploitation is never estimated and every path says so.

### Unrecognized and unpinned servers

A server that matches no catalog entry, no name rule, has no `url`, passes no existing directory, and declares no `capabilities` array earns no capability, no graph reach, and no exposure path. That used to make a machine full of unknown servers look like an empty one. Now the report tags each such server `unrecognized` on its inventory line, lists it under UNRECOGNIZED SERVERS with how it launches and why nothing matched, names it in the COVERAGE "not established" line, and repeats it in the HTML report, the JSON export (`recognition`), and SARIF (`BOPPI-UNRECOGNIZED`, warning). Unknown is not the same as safe; a `boppi.policy.json` with `"requireKnownCapabilities": true` fails the scan on them.

The same pass reads the version from `npx <pkg>@version`, `uvx <pkg>==version`, and `docker run <image>:tag`. A package launch with no version, `latest`, or a range is tagged `unpinned` (SARIF `BOPPI-UNPINNED`, note) and counted under PACKAGE PINS, because it runs whatever is published at its next launch. Remote urls and local programs have no pin.

### Built-in agent tools

Claude Code and Cursor run shell commands and read and write files through their own tools, with no MCP server involved. The scanner models those as grants on the agent itself, so Claude Code with a single `fetch` server reports the privilege path (EP-E) that the fetched pages open onto its built-in shell, and removing an MCP shell server is never offered as the fix for a shell the agent already has. Claude Code's `WebFetch` is a prompted grant that is an external destination and untrusted content at once, and `WebSearch` is a separate prompted grant that is untrusted content only, so Claude Code at its defaults carries a high exfiltration path and a medium privilege path before any MCP server is added, each stating that an approved prompt is the assumption; a settings rule for one web tool never changes the grade of the other. The report lists them under BUILT-IN TOOLS, separate from MCP servers.

For Claude Code, the scan reads `~/.claude/settings.json`, `.claude/settings.json`, and `.claude/settings.local.json` in the working directory and grades each tool from the `permissions` block: `prompts` (the client asks before each use, the default), `no prompt` (a whole-tool `allow` rule, `defaultMode` of `bypassPermissions` or `dontAsk`, or `acceptEdits` for edits), or `denied` (a whole-tool `deny` rule, which also removes the capability from the graph). Only rule counts and the mode are kept; the rule text can name commands and paths and is never recorded. Cursor keeps its auto-run setting outside readable configuration, so its built-in tools are reported with prompting `not checked`. Explicit `--config` scans model the built-in tools but do not read settings.

### Per-tool reach and file scope

A capability id is server-wide and stops at one category, so a GitHub server that can push commits used to look the same as one that only reads issues, and a filesystem server pointed at `~/` looked the same as one pointed at a photos folder. The scanner now maps the tool names the catalog and the config already list to the engine's finer categories (`push_files` is modify source code, `kubectl_apply` is access to a production system, `slack_post_message` is an external message, a Gmail server reads and sends email) and attaches one extra permission per category to the server. The terminal report prints them as `reach through tools:` under each MCP SERVERS line, the HTML report shows them under capabilities, the graph carries them as `Reach:` evidence on the server node, and the JSON export records them with source id `tool-reach:<server>:<category>`. Catalog-derived reach is `inferred`; reach from a configured directory is `observed`.

Each existing directory argument is graded before it is fingerprinted: `the whole home directory`, `a system-wide directory`, `a dotfile or secrets folder` (`.ssh`, `.aws`, `.kube`, `credentials`, and the like), `a source tree` (a `.git`, `package.json`, `pyproject.toml`, or similar marker), or `a folder elsewhere`. The grade is the only thing kept; the path never leaves the machine. Home, system, and secrets scopes add credential access; home, system, and source scopes add read source code, and modify source code when the server has write tools. That is why a filesystem server at `~/` next to a Kubernetes server now reports the supply-chain path (EP-C) and a Gmail server next to `fetch` reports the impersonation path (EP-F), neither of which a server-wide capability could reach before.

In every report the actual scan and a simulated change are kept apart: the demo page's counters and "Understand the exposure" card describe the sample's scan, and only the Preview counter, graph, and inventory follow a simulated removal. `boppi plan` and ROOT CAUSE name only the configuration files that hold the server being removed.

Every path is potential. The scanner sees configuration, not behavior. It cannot tell you an agent has been exploited, only that the grants would allow it. A clean scan is not proof the environment is safe; it means the supported configuration files that were found contain no evidenced chain.

## Commands and flags

```
boppi scan                     discover configs, scan, print the full report
boppi agents                   inventory table only
boppi paths                    exposure paths only
boppi plan                     compare every candidate fix side by side and print the exact edits; changes nothing
boppi fix --server <name>      remove one server entry from its config file (backup first), rescan, grade
boppi verify <previous.json>   rescan and grade the predictions in an earlier --json export
boppi history                  recent local scan summaries, what changed, and verified exposure reduction
boppi push                     scan, then send the sanitized inventory to your Boppi workspace

--json <file>       machine-readable export with full evidence per claim
--html <file>       self-contained HTML report you can share
--sarif <file>      SARIF 2.1.0 report for GitHub code scanning or any SARIF viewer
--policy <file>     evaluate a policy file; ./boppi.policy.json is used automatically when present
--only <clients>    limit discovery: claude-desktop, claude-code, cursor
--config <path>     scan one explicit config file, skip discovery
--source <id>       client type for --config
--fail-on <sev>     exit 1 if any finding or path is at or above this severity
--quiet             one summary line
--verbose           all paths, per-server capability provenance
--no-color          plain text (NO_COLOR is also respected)
--version           print the version
--contradictions-dir <dir>  where verify writes boppi-contradiction-<id>.json (default: cwd)
--history-file <file>       where scan keeps its sanitized history (default: ~/.boppi/history.json)

push only:
--url <workspace>   workspace origin or ingest URL (default https://app.boppi.io)
--token <token>     collector token; or set BOPPI_TOKEN; or omit it and paste when prompted (hidden input)
--file <scan.json>  push an earlier --json export instead of scanning now
--dry-run           print the records that would be sent, send nothing
--merge             add to the workspace without removing records absent from this scan

fix only:
--server <name>     the server entry to remove, as boppi scan names it
--client <key>      which config to edit when the name exists in more than one client
--yes               apply without the terminal confirmation (required when stdin is not a terminal)
```

### Plan and fix

`boppi plan` lists every candidate fix with what it breaks, what it would create, and what the agent loses:

```
CANDIDATE FIXES  best first
  #  edit                                               breaks   lowers  critical  new  agent loses
  1  remove "fetch" from Claude Desktop                 3/4      0       2         0    network_access, untrusted_external_content
  2  move "fetch" from Claude Desktop to Cursor         3/4      0       2         1    network_access, untrusted_external_content
  3  remove "filesystem" from Claude Desktop            1/4      1       1         0    filesystem_access
```

Every row is a rescan of the configuration with that one edit applied. `breaks` counts paths that disappear; `lowers` counts paths that stay open at a lower priority, which happens when a built-in tool or another server keeps the path with weaker evidence (removing a catalog-backed fetch server from Claude Code lowers the exfiltration path from critical to high, because the prompted built-in WebFetch remains). A move is rescanned on both clients, so the `new` column is what would appear on the target. `agent loses` lists capabilities no other server on that agent provides, which is the workflow cost of the edit; a generic web capability the agent's own WebFetch also covers is not counted as lost for a plain fetch or search server, but a connector that carries a credential (GitHub, Slack, a database) always counts, because the built-in tools cannot reach what that credential unlocks. When no removal closes a high-or-critical path, the plan says what would stay open with every MCP server removed, which built-in tools hold it, and where a settings deny rule would go. Boppi never edits settings.

`boppi fix --server fetch` removes that entry from the file that holds it. It prints the file, the modeled effect, and the backup location, asks for confirmation (or takes `--yes`), copies the file to `~/.boppi/backups/` with mode 600, deletes the key, saves the predictions it used as `boppi-fix-<time>.json`, rescans, and grades the prediction. Exit 0 means CONFIRMED. Only removals are applied; a move is two edits you make by hand, and `boppi verify` grades the source side.

`boppi plan --diff` shows a sanitized configuration diff. `boppi rollback` lists recorded backups; `boppi rollback --id <id>` asks before restoring one. Rollback verifies the backup hash and refuses if the configuration changed since that fix. Backups contain the complete original configuration, including any original secrets; they stay locally in an owner-only directory and are never uploaded. Review older backups manually if their manifests lack integrity hashes.

### Policy guard

A `boppi.policy.json` in the working directory (or `--policy <file>`) turns configuration facts into violations with exit 1. Every key is optional:

```json
{
  "version": 1,
  "failOn": "high",
  "denyServers": ["desktop-commander", "/shell/i"],
  "allowServers": ["filesystem", "github", "fetch"],
  "denyCapabilities": ["credential_access"],
  "denyCombinations": [["filesystem_access", "network_access"]],
  "requireKnownCapabilities": true
}
```

`denyServers` and `allowServers` match the server name, command, and arguments; `/re/flags` is a regular expression, anything else a case-insensitive substring. `denyCombinations` fires when one agent holds every listed capability across its servers. `requireKnownCapabilities` flags a server the catalog does not recognize. Violations are listed under POLICY with rule ids `POL-*`, included in `--json` and `--sarif`, and an unknown key or value in the file is an error, not a silent skip. The policy is evaluated on this machine against the scanned configuration; nothing is enforced at runtime.

`boppi verify` takes the same discovery flags as `scan`. Each prediction in the export ("removing server X eliminates these exposures") is graded against the fresh scan: CONFIRMED, PARTIAL, CONTRADICTED, or UNRESOLVED when the edit was not applied or the agent was not scanned. PARTIAL and CONTRADICTED write a self-contained fixture file for an engine issue.

`boppi push` sends a full snapshot by default: records from that collector's earlier pushes that are absent from this scan are removed in the workspace, so a machine that gets fixed shows up fixed. Each snapshot carries the export's timestamp, and the workspace refuses a snapshot older than the one it already holds from that collector (HTTP 409; rescan and push again). Pushes are rate limited per token (HTTP 429; the message says how long to wait, and the client does not retry on its own). `--merge` adds without removing and sends in batches of 1000.

Arguments in a server entry are redacted before they leave: anything that looks like a credential, anything after a flag whose name says credential (`--api-key x`, `--token x`, `-p x`), and the value side of `--key=...` or `NAME_PASSWORD=...`.

Exit codes: 0 clean, 1 threshold hit under `--fail-on` or a policy violation (`scan` and `plan`), 2 bad arguments, 3 scan failed, 4 a client could not be analyzed, 5 the workspace rejected or could not receive a push.

### Use it in CI

```
npx boppi scan --config .mcp.json --source claude-code --fail-on high --sarif boppi.sarif
```

Fails the job when a path or finding at or above the threshold exists in that file, when the policy is violated, or when the config could not be analyzed (exit 4, even without `--fail-on`). Without `--config` the scan reads the runner's user-level configs, which is rarely what CI wants.

As a GitHub Action, with the SARIF uploaded to code scanning:

```yaml
- uses: Memanzur/boppi-scan@v0.3.0
  with:
    config: .mcp.json
    source: claude-code
    fail-on: high
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: boppi.sarif
```

Inputs: `config`, `source`, `fail-on`, `policy`, `sarif`, `version`. The action runs `npx boppi@<version>`; pin `version` for reproducible runs.

## What leaves the machine

Nothing, unless you run `boppi push`.

The scanner reads configuration metadata only. It never collects secret values, environment variable values, file contents, or raw filesystem paths. Positional arguments that look like credentials (API keys, tokens, bearer or JWT values, connection strings with passwords) are redacted before they reach any model or export. Paths become fingerprints keyed with a secret that lives only on your machine (`~/.boppi/fingerprint-key`), so they cannot be reversed by guessing common paths. Every file that was read is listed at the end of the run so you can check the claim yourself.

This is tested, not just stated: `npm test` runs every command with sockets, DNS lookups, and `fetch` disabled and fails if any of them is attempted. Only a real `boppi push` is allowed to reach the network, and the same check confirms that it does.

`boppi push` sends the sanitized inventory of one scan (agent, MCP server, permission, and integration records: names, commands, redacted arguments, capabilities, fingerprinted paths) over HTTPS to the workspace you name, authenticated by your collector token. `boppi push --dry-run` prints the exact payload without sending it. No other command makes a network request.

Push also reports the producing scanner's version and platform, discovery scope, and each checked client's status and server count. Errors use fixed descriptions. A complete discovery scan replaces that collector's inventory; selected, explicit-file, unreadable, or legacy scans merge without deleting earlier evidence. Run a full scan after a supported fix to update the complete workspace inventory. A machine with no discoverable configuration currently sends nothing, so an earlier cloud inventory can remain. Revocation stops later pushes but does not erase stored evidence. Old exports without version provenance are not labeled with the uploading scanner's version.

Catalog capabilities and tool names are inferred from package identity, with their provenance preserved in graph edges. They are not a tool handshake, package attestation, or runtime observation. Catalog details can lag installed server versions.

## Optional monitoring prototype

`boppi hook --print-config` prints a Claude Code hook snippet. Boppi never installs it; `--install` is refused. Only manually adding the snippet opts into local event capture. Normal scanning, demos, fixes, verification, and rollback collect no runtime events.

When explicitly configured, the hook keeps event type, server/tool identifiers, a hashed session identifier, a keyed working-directory fingerprint, and an error/success flag. It discards tool inputs, outputs, prompts, transcripts, and file contents; bounded input and retention keep the log limited. Identifiers can still reveal workflow metadata. Events stay in `~/.boppi/events.jsonl`, mode 600, and expire on a subsequent hook invocation (30 days by default). No hook capture is uploaded. `boppi settings --set retentionDays=7` adjusts retention. Telemetry and cloud-sync settings are reserved, default to false, and currently trigger no outbound work even if changed. Live Claude Code hook delivery and concurrent capture remain prototype testing gaps.

If a server entry contains something that looks like a secret in a place the scanner cannot redact, the scanner refuses that client's config and prints the reason instead of a result. Move the secret into an environment variable the server reads and rescan.

## Discovery targets

| Client | Files |
|--------|-------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\\Claude\\claude_desktop_config.json` on Windows, `~/.config/Claude/claude_desktop_config.json` on Linux |
| Claude Code | `~/.claude.json`, plus `.mcp.json` in the working directory; permission settings from `~/.claude/settings.json`, `.claude/settings.json`, and `.claude/settings.local.json` in the working directory (counts and mode only) |
| Cursor | `~/.cursor/mcp.json`, plus `.cursor/mcp.json` in the working directory |

Windsurf and VS Code are not discovered yet. Pull requests welcome. Each client is one file under `src/cli/discovery/`.

## Support

- Bugs and feature requests: [GitHub issues](https://github.com/Memanzur/boppi-scan/issues). Attach the `boppi-contradiction-*.json` fixture if `verify` wrote one.
- Email: boppii.ioo@gmail.com for anything you would rather not post publicly.
- Security reports: see [SECURITY.md](SECURITY.md).

## Development

Release candidate: `npm run release-candidate` packs the tarball, installs it into a throwaway prefix, runs the beta journey (version, scan, demo, plan, fix, verify, rollback, uninstall) on a synthetic home, and writes `CANDIDATE.json` plus the tarball to `~/Desktop/Boppi-candidate-<version>` (`--out <dir>` to change). It publishes nothing.

```
git clone https://github.com/Memanzur/boppi-scan
cd boppi-scan
npm test
node bin/boppi.js scan
```

The suites under `test/` are executable checks, not unit tests. `npm test` runs all of them and exits non-zero on any failure. See CONTRIBUTING.md before changing anything under `src/engine/`.

## Part of Boppi

This scanner is the local collector for [Boppi](https://boppi.io), an AI-agent exposure platform that runs the same engine across an organization. The scanner is complete on its own and stays free.

## License

Apache-2.0. See LICENSE.
