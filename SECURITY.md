# Security Policy

## Reporting a vulnerability

Email manzurmelody@gmail.com with a description of the issue, steps to reproduce, and the version affected. You will get an acknowledgement within a few days.

Please give us up to 90 days to ship a fix before public disclosure. We will credit you in the release notes unless you ask otherwise.

## What the scanner reads

`boppi` runs entirely on your machine. It reads only local MCP configuration files (for example `claude_desktop_config.json`, `.claude.json`, `.cursor/mcp.json`, and any file you pass with `--config`), and only their metadata: server names, commands, arguments, and environment variable *names*.

It never collects or transmits:

- secret or credential values (environment variable values are never read into findings),
- file contents from directories a server can access,
- raw path names in exports (paths become fingerprints),
- anything over the network — no telemetry, no phone-home.

Every file read during a run is listed in the PRIVACY footer of the report, so what was read is always inspectable.
