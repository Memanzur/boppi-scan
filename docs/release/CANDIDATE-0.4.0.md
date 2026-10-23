# Release candidate: boppi 0.4.0 (local, unpublished)

Built by `npm run release-candidate` from the commit named in the candidate's `CANDIDATE.json`; `npm run verify-versions` checks that package, engine, rubric, changelog, this document, and the manifest agree, and `scripts/candidate-kit/prepare-fixtures.py <candidate dir>` rebuilds the six-case facilitator kit from the tarball; the manifest also carries the tarball sha256, engine 1.1.0, the rubric version (1.0.3 as of 2026-10-23; earlier builds are kept beside the current one as `Boppi-candidate-0.4.0-superseded-rubric-<version>`), and the journey check results. Publishing to npm, tagging, and any website change need separate founder authorization and are not part of this document.

## Supported

| Platform | Status | Config locations read |
| --- | --- | --- |
| macOS (Node 18 or newer) | verified by the candidate journey on the build machine | Claude Desktop, Claude Code (`~/.claude.json`, `.mcp.json`, settings files), Cursor |
| Linux | experimental; locations are looked up, not verified on a real machine | same clients, XDG paths |
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

## Reporting a problem

Email boppii.ioo@gmail.com or open an issue at https://github.com/Memanzur/boppi-scan/issues. Send the terminal output or a screenshot, the `boppi --version` line, and the one thing you expected. Never send tokens, passwords, config file contents, or the JSON export from a work machine. If any Boppi output shows a secret value or a raw path from your machine, send the field name only; that is a bug we fix first.

## Withdrawal

If a candidate is found to produce an unsafe edit, leak private data, or report an unjustified critical, the founder marks it withdrawn in this file and in `CANDIDATE.json` (`withdrawn: true`, reason, date), testers are emailed to uninstall, and the next candidate carries a new version. Backups under `~/.boppi/backups` let any applied fix be rolled back with `boppi rollback`.
