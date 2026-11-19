# Security Policy

## Reporting a vulnerability

Email boppii.ioo@gmail.com with a description of the issue, steps to reproduce, and the version affected. You will get an acknowledgement within a few days.

Please give us up to 90 days to ship a fix before public disclosure. We will credit you in the release notes unless you ask otherwise.

## What the scanner reads

`boppi` runs on your machine. It reads only local MCP configuration files (for example `claude_desktop_config.json`, `.claude.json`, `.cursor/mcp.json`, and any file you pass with `--config`), and only their metadata: server names, commands, arguments, and environment variable *names*.

It never collects:

- secret or credential values (environment variable values are never read into findings, and positional arguments that look like credentials are redacted),
- file contents from directories a server can access,
- raw path names in exports (paths become fingerprints keyed with a per-machine secret in `~/.boppi/fingerprint-key`, so common paths cannot be recovered by hashing guesses).

Every file read during a run is listed in the PRIVACY footer of the report, so what was read is always inspectable. `boppi history` keeps sanitized scan summaries in `~/.boppi/history.json`; it holds counts and path ids, never config values.

## What leaves the machine

`scan`, `agents`, `paths`, `plan`, `fix`, `verify`, and `history` make no network requests. There is no telemetry.

`boppi push` and `boppi watch` send data only when you run them. Both POST the sanitized inventory of one scan (agent, MCP server, permission, and integration records: names, commands, redacted arguments, capabilities, fingerprinted paths) over HTTPS to the workspace URL you give them, authenticated with the collector token you pass. `watch` repeats that POST in the foreground until Ctrl+C and includes `expected_interval_seconds`. `push` is one shot and does not include that field. `~/.boppi/history.json` is not uploaded. Watch does not protect the machine and does not observe agent activity. `--dry-run` prints the payload without sending it. Plain HTTP is refused except for localhost.

`boppi ask` sends data only after a separate confirmation (`y` at the prompt, or `--yes`). `boppi ask --no-network` answers from the local fix catalog and does not use the network. A confirmed ask POSTs `{ question, findings, context? }` to `/api/ai/ask`. Findings are limited to id, title, severity, category, tool, a remediation string, and a `fixId` only when this scan can apply that fix. The body is at most 96 KB and at most 25 findings. File contents, environment values, header values, tokens, usernames, and absolute home paths are removed first. No session cookie is sent, so the request counts against the anonymous limit of 20 questions per IP per UTC day. The reply is not executed. A reply that tells you to pipe a download into a shell is not shown.
