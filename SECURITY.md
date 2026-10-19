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

`scan`, `agents`, `paths`, `plan`, `fix`, `verify`, and `history` make no network requests. There is no telemetry. `npm test` runs every one of them with sockets, DNS lookups, and `fetch` disabled and fails if any is attempted.

`boppi push` is the one command that sends data, and only when you run it. It POSTs the sanitized inventory of one scan (agent, MCP server, permission, and integration records: names, commands, redacted arguments, capabilities, fingerprinted paths) over HTTPS to the workspace URL you give it, authenticated with the collector token you pass. `boppi push --dry-run` prints the exact payload without sending it. Plain HTTP is refused except for localhost.

The collector envelope adds producing version/platform, discovery scope, client status/counts, and fixed error descriptions. Partial scans merge to preserve earlier evidence. Push refuses HTTP redirects so the payload cannot be silently forwarded to another destination. Review `--dry-run` before sending metadata from a confidential environment; names and commands can themselves be sensitive.

`fix` stores the complete original configuration in an owner-only local backup. Those bytes may contain secrets present in the original configuration. Backup files and manifests are never upload inputs. Rollback checks integrity and refuses to overwrite changes made after the fix.

The optional `hook` prototype reads an explicitly supplied stdin event and keeps bounded metadata locally. It never installs hooks, reads transcripts, or saves tool-input/output content. No runtime log is created by a normal scan, demo, fix, or verification. Event capture requires manual configuration; its identifiers can reveal workflow metadata even though payload content is dropped. Retention is enforced when another hook event runs, not by a persistent background process.
