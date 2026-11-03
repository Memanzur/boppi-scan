# boppi

See what your local AI agents can reach.

`boppi scan` reads the MCP and tool configs for the AI clients on your machine (Claude Desktop, Claude Code, Cursor, VS Code, GitHub Copilot, Windsurf, Cline, Roo Code, Continue, Zed, Gemini CLI, Codex CLI, Amazon Q, JetBrains, Goose, LM Studio, plus installed chat apps and known browser extensions), builds a graph of what each agent can touch, and reports the potential exposure paths that fall out of it. The scan runs locally. No account, no telemetry, no dependencies.

```sh
npx boppi scan
```

Node 18 or newer. **0.4.0** adds VS Code, GitHub Copilot, Windsurf, Cline, Roo Code, Continue, Zed, Gemini CLI, Codex CLI, Amazon Q, JetBrains, Goose, and LM Studio, plus installed chat apps, known browser extensions, and provider-key names (values are never collected). Tested on macOS. Linux and Windows config locations are looked up but not yet verified on real machines.

## Free beta

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
  CRIT  Potential credential exposure path  [EP-B · confidence 0.7]
     Claude Desktop -> 1password -> access credentials -> desktop-commander (shell_access) -> run shell commands -> fetch (network_access) -> call external api
     why: Credential references combined with execution and network access create a potential path for credential material to leave the environment.
     fix: Restrict shell or credential access and remove network capabilities this agent does not need.

  CRIT  Potential data exfiltration path  [EP-A · confidence 0.7]
     Claude Desktop -> filesystem (filesystem_access) -> read files -> fetch (network_access) -> call external api -> External destination
     why: If this agent were compromised or misdirected, data it can read could potentially reach an untrusted external destination.
     fix: Remove external messaging or API access, or restrict the sensitive-data grants feeding this path.

  HIGH  Potential privilege path  [EP-E · confidence 0.7]
     Claude Desktop -> fetch (untrusted_external_content) -> untrusted external content -> desktop-commander (shell_access) -> run shell commands
     why: Instructions hidden in untrusted content could potentially influence an agent with privileged local capabilities.
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
  3. Working with a team? BOPPI_TOKEN=<token> boppi push sends this sanitized inventory to your Boppi workspace. Nothing else ever leaves the machine.

PRIVACY  Files read this run (metadata only, sanitized in memory, nothing left this machine):
  - ~/Library/Application Support/Claude/claude_desktop_config.json
  - ~/.claude.json
  - ~/.cursor/mcp.json
  Secret values, file contents, and raw path names are never collected. Paths become fingerprints.

JSON export written to boppi-scan.json
```

A plain `npx boppi scan` with no export flags ends with one more line, `See history, teams and approvals: npx boppi push`.

The root cause section is computed, not guessed. The engine removes the grant from the graph, reruns the path search, and reports how many paths are gone. `boppi verify boppi-scan.json` then checks that prediction against the real machine after you make the edit.

## Security score

`boppi` and `boppi scan` print a security score from 0 to 100. Higher is safer. 100, grade A, means no risky exposure paths. Grades are A at 100, B from 75 to 99, C from 50 to 74, D from 25 to 49, and F from 0 to 24.

The score counts exposure paths only, not rule-engine findings. Within one severity the nth path subtracts weight/n: 28 for critical, 16 for high, 6 for medium, and 2 for low. That sum is rounded once and capped at 100, and the score is 100 minus that penalty. The same function, `securityScore` in `src/cli/securityScore.js`, is what the control plane uses (`lib/risk-score.ts`). The shared cases are in `test/fixtures/security-score-vector.json`.

The same screen lists how many AI tools, tool servers, and exposed key names were found, then the tools that are actually installed, even when they have no MCP servers. Claude Code permission mode is read from `~/.claude/settings.json` (and the project settings files): only the mode and the tool name are kept. A bypass or "don't ask" mode is a hygiene finding and does not by itself change the score, which still counts exposure paths only. Key names are shown with the file they were found in; values are not. When there is no exposure path, the report says what was checked, what is in good shape, and three next steps, including the sample workspace at https://beta.boppi.io. Coverage and privacy stay one line on this screen. `boppi scan --verbose` prints the full file list and the coverage limits. `--json <file>` writes the same score, counts, risks, and first-run notes.

## How it works

1. **Discover.** Locate each client's MCP config files. A missing file is reported as not found, never as an error.
2. **Infer capabilities.** Config files rarely declare what a server can do, so the scanner infers capabilities from evidenced identity: the package name, the command, directory arguments, and environment variable names. Every inference is labeled with what matched and carries evidence class `inferred`.
3. **Build the graph.** Agents, servers, capabilities, data, credentials, and destinations become nodes. Every edge records where it came from.
4. **Find paths.** Six templates describe chains that matter. A path is reported when the graph contains the whole chain.
5. **Rank the fix.** For each grant, remove it and rerun the search. The grant that breaks the most paths is the recommended fix.
6. **Verify.** After you edit the config, `boppi verify` rescans and grades each prediction: CONFIRMED, PARTIAL, CONTRADICTED, or UNRESOLVED. A wrong prediction writes a self-contained fixture you can attach to an issue.

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
--only <clients>    limit discovery to client ids (claude-desktop, cursor, vscode, windsurf, cline, roo, continue, zed, gemini-cli, codex, amazon-q, jetbrains, goose, lmstudio, copilot, browsers, ...)
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
  #  edit                                               breaks   critical  new  agent loses
  1  remove "fetch" from Claude Desktop                 3/4      2         0    network_access, untrusted_external_content
  2  move "fetch" from Claude Desktop to Cursor         3/4      2         1    network_access, untrusted_external_content
  3  remove "filesystem" from Claude Desktop            1/4      1         0    filesystem_access
```

Every row is a rescan of the configuration with that one edit applied. A move is rescanned on both clients, so the `new` column is what would appear on the target. `agent loses` lists capabilities no other server on that agent provides, which is the workflow cost of the edit.

`boppi fix --server fetch` removes that entry from the file that holds it. It prints the file, the modeled effect, and the backup location, asks for confirmation (or takes `--yes`), copies the file to `~/.boppi/backups/` with mode 600, deletes the key, saves the predictions it used as `boppi-fix-<time>.json`, rescans, and grades the prediction. Exit 0 means CONFIRMED. Only removals are applied; a move is two edits you make by hand, and `boppi verify` grades the source side.

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

`boppi push` sends a full snapshot by default: records from that collector's earlier pushes that are absent from this scan are removed in the workspace, so a machine that gets fixed shows up fixed. `--merge` adds without removing and sends in batches of 1000.

Arguments in a server entry are redacted before they leave: anything that looks like a credential, anything after a flag whose name says credential (`--api-key x`, `--token x`, `-p x`), and the value side of `--key=...` or `NAME_PASSWORD=...`.

Exit codes: 0 clean, 1 threshold hit under `--fail-on`, 2 bad arguments, 3 scan failed, 4 a client could not be analyzed, 5 the workspace rejected or could not receive a push.

### Use it in CI

```
npx boppi scan --config .mcp.json --source claude-code --fail-on high --sarif boppi.sarif
```

Fails the job when a path or finding at or above the threshold exists in that file, when the policy is violated, or when the config could not be analyzed (exit 4, even without `--fail-on`). Without `--config` the scan reads the runner's user-level configs, which is rarely what CI wants.

As a GitHub Action, with the SARIF uploaded to code scanning:

```yaml
- uses: Memanzur/boppi-scan@v0.4.0
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

If a server entry contains something that looks like a secret in a place the scanner cannot redact, the scanner refuses that client's config and prints the reason instead of a result. Move the secret into an environment variable the server reads and rescan.

## Discovery targets

Paths below are the ones each product documents. On macOS, editor data lives under `~/Library/Application Support`; on Linux, `~/.config`; on Windows, `%APPDATA%` (or `%LOCALAPPDATA%` for browser profiles). A missing file is reported as not found.

| Client | What is read |
|--------|----------------|
| Claude Desktop | `claude_desktop_config.json` in the Claude config directory |
| Claude Code | `~/.claude.json`, plus project `.mcp.json` in the working directory and (bounded) under common code folders |
| Cursor | `~/.cursor/mcp.json`, plus project `.cursor/mcp.json` in the working directory and under those same folders |
| VS Code | User `settings.json` key `mcp`, user `mcp.json`, and workspace `.vscode/mcp.json`. The `servers` object is the current file shape; the settings `mcp` key is the older one |
| GitHub Copilot | `~/.copilot/mcp-config.json` (or `$COPILOT_HOME` when scanning the real home) and project `.mcp.json`, which Copilot documents as its portable config |
| Windsurf | `~/.codeium/windsurf/mcp_config.json`. Devin Desktop also documents `~/.config/devin/mcp_config.json` (`%APPDATA%\\devin\\mcp_config.json` on Windows) and `.devin/mcp_config.json`; those are read on the same client |
| Cline | `cline_mcp_settings.json` in the VS Code globalStorage directory `saoudrizwan.claude-dev` (also Cursor and Windsurf, which use the same layout) |
| Roo Code | `mcp_settings.json` in `rooveterinaryinc.roo-cline` globalStorage, and the legacy `cline_mcp_settings.json` name |
| Continue | `~/.continue/config.yaml` (list under `mcpServers`), legacy `config.json`, and `mcpServers/*` block files |
| Zed | `settings.json` key `context_servers` (macOS and Linux paths are in Zed's docs; Windows is `%APPDATA%\\Zed\\settings.json`) |
| Gemini CLI | `~/.gemini/settings.json` and `.gemini/settings.json`, key `mcpServers` |
| Codex CLI | `~/.codex/config.toml` (`$CODEX_HOME` when scanning the real home) and `.codex/config.toml`, tables `[mcp_servers.<name>]` |
| Amazon Q | `~/.aws/amazonq/default.json` and legacy `mcp.json`, plus `.amazonq/` in the project. Per-tool allow/deny toggles are not in the public file schema, so they are not read |
| JetBrains / Junie | `~/.junie/mcp/mcp.json` and `.junie/mcp/mcp.json` (Junie's documented paths). AI Assistant's help page only documents the Settings UI; `JetBrains/AIAssistant/mcp.json` and `JetBrains/<Product><Version>/mcp.json` are also checked |
| Goose | `~/.config/goose/config.yaml` (`%APPDATA%\\Block\\goose\\config\\config.yaml` on Windows). Enabled extensions are the tool servers; the bundled `developer` extension is file and shell access |
| LM Studio | `~/.lmstudio/mcp.json` |

Project `.mcp.json` and `.cursor/mcp.json` are also collected under `~/Projects`, `~/Developer`, `~/dev`, `~/code`, `~/src`, `~/repos`, `~/source`, `~/work`, `~/github`, `~/GitHub`, `~/workspace`, and `~/Documents/GitHub`, two levels deep. `node_modules` and other dependency directories are not entered.

Installed desktop apps (ChatGPT, Claude, Microsoft Copilot, Perplexity, Ollama) and browser extensions are inventory only: the scanner checks that the app or extension directory exists and does not read the bundle. Extension ids are the Chrome Web Store ids in `src/cli/discovery/presence.js` (ChatGPT, Claude, Perplexity, Grammarly). Gemini in Chrome is part of the browser, not a store extension. No first-party Copilot extension id is published, so none is guessed.

Provider key **names** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `HF_TOKEN`, and the AWS credential names Bedrock uses) are detected in the environment and in a fixed list of dotfiles (`~/.zshrc`, `~/.bashrc`, `~/.aws/credentials`, Goose `secrets.yaml`, and the other shells listed in code). Values are not recorded. A credential-shaped value inside an MCP config is flagged and redacted.

## Support

- Bugs and feature requests: [GitHub issues](https://github.com/Memanzur/boppi-scan/issues). Attach the `boppi-contradiction-*.json` fixture if `verify` wrote one.
- Email: boppii.ioo@gmail.com for anything you would rather not post publicly.
- Security reports: see [SECURITY.md](SECURITY.md).

## Development

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
