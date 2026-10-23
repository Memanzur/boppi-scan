# Phase 6: local runtime collector (slice P6-1)

Status: implemented 2026-10-23, local only. No cloud transport, no new table, RPC, or route; the coverage envelope still reports `runtime: not_observed` for every push, because runtime evidence has no ingest contract yet (a separate consent and isolation slice, founder-gated). Live calls on a real Claude Code (the roadmap's "controlled live calls on one consented supported client") have not been run; everything below is proven on synthetic payloads.

## Supported client and payload shape

Claude Code only, hook payloads as documented at code.claude.com/docs/en/hooks on 2026-10-23: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `PermissionDenied`, each carrying `tool_use_id`, and `mcp_server.source` for MCP tools. `PermissionRequest` is not captured (it has no `tool_use_id`, so it could not be paired). The hook records `schema: 2`; a payload without `tool_use_id` is stored with `invocation: null` and the timeline counts it as uncorrelated instead of guessing a pair. Any other client shows as not monitored.

## What one record holds

`schema, id, at, event, kind, server, source, tool, session, invocation, cwd, outcome, durationMs`. `session` and `invocation` are 16-hex-digit SHA-256 prefixes of `session_id` and `tool_use_id`; `cwd` is the keyed fingerprint the scanner already uses; `source` is allowlisted to a short lowercase token; `durationMs` is a bounded integer. `id` is deterministic (`event | session | invocation`) when both ids exist, so a payload delivered twice is a duplicate, not a second call. Tool input, tool response, error text, denial reason, transcript path, prompts, and raw paths never reach disk; `test/verify-hook-collector.js` plants canaries for each and greps every stored file.

Outcomes are modeled separately and never default to success: `invoked` (PreToolUse), `ok` (PostToolUse), `error` (PostToolUse whose response carries an error flag), `failed` (PostToolUseFailure), `interrupted` (PostToolUseFailure with `is_interrupt`), `denied` (PermissionDenied). A call whose outcome event never arrives is `unknown`.

## Recording that survives concurrency

Each hook invocation appends exactly one line, under 4 KiB, with `O_APPEND`, so concurrent sessions cannot interleave or overwrite each other. Rotation never rewrites in place: when the active file exceeds 1 MiB or its oldest record has expired, it is renamed (atomic) to `events.<stamp>.<pid>.jsonl` under a lock file with a 10 s stale timeout. A hook that opened the old file keeps appending to the segment, so no line is lost by rotation. Retention deletes a whole segment once its newest record is older than `retentionDays`, and the oldest segments beyond 16. The timeline reads segments and the active file alike and drops expired records on read. A line cut mid-write is counted as unreadable, never silently skipped.

Health counters (`events.health.jsonl`, one `{at, reason}` line each) record payloads the hook refused: `oversized`, `timeout`, `invalid_json`, `unsupported_event`, `bad_tool_name`, `write_failed`. They are the drop counters the timeline shows.

## Commands

- `boppi hook --print-config`: the snippet for the four events with a 5 s timeout and matcher `mcp__.*`. Boppi never edits settings; `--install` is refused.
- `boppi hook --disable` / `--enable`: a local flag file (`~/.boppi/hook.disabled`) that makes the hook exit without recording; the snippet stays.
- `boppi hook --forget`: deletes every event file and health counter and tells the user to remove the snippet.
- `boppi events [--since <days>] [--json <file>]`: calls per server and tool with per-outcome counts, then every gap: unknown outcomes, orphan outcomes (dropped or reordered PreToolUse), uncorrelated records, duplicates, unreadable lines, refused payloads.

## Acceptance measured (`test/verify-hook-collector.js`, 29 checks)

- 10 concurrent synthetic sessions, 500 invocations, 1,000 records, with 2 planned drops and 2 duplicate deliveries per session and a reordered outcome every seventh call, written with a 20 KiB segment cap so rotation ran 12 times under load: every line read back, 20 duplicates counted, 20 unknown, 0 orphans, 0 cross-session pairs, no torn line.
- Outcome counts: ok 240, error 60, failed 60, interrupted 60, denied 60, unknown 20.
- A torn line is reported as unreadable with every other record intact.
- Hook overhead through the real command: p95 82 ms, median 81 ms on an Apple M1 (roadmap target p95 under 100 ms on a stated reference machine; the suite's hard bound is 400 ms so a slow CI runner does not fail it).
- Disable stops capture, enable resumes it, forget removes everything; `--print-config` installs nothing.

## Not done, by design or by gate

- Live calls on a consented Claude Code and the tested version pin (founder-run, after the snippet is added by hand).
- Cloud transport and storage for runtime events: needs separate data-scope consent, new isolated table, RPC, route, expiry, rate limit, retention, and deletion tests (roadmap Phase 6, gated).
- Local hashes are correlation aids, not tamper-proof attestation; a process on the same account can write to the file. The timeline says a reported call is not evidence of what the tool did.
