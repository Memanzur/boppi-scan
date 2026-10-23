# Phase 3 spike: consented MCP tool discovery, feasibility and threat model

Status: design document, 2026-10-23; slices P3-2 (fixtures, projection, recorder) and P3-3 (`boppi discover`, stdio only: `src/cli/discovery/`, `test/verify-discover.js`) are implemented as of 2026-10-23 with the four section-12 decisions applied as recommended until the founder decides (package-fetching launchers refused outright, 160-character description excerpts, no HTTP, seven-day cache). Section 8's passive-scan use of the cache and section 7's `advertised` basis are slice P3-4. No passive command launches a process; only `boppi discover` does, after consent. Roadmap Phase 3 asks for a 3 to 5 day spike before code; this is its written output, sized to what one engineer can verify locally. Decisions marked "founder" need the founder's answer before the matching slice starts. Protocol facts are from the MCP specification 2025-11-25 (lifecycle, transports, server/tools pages), read on 2026-10-23.

## 1. What Phase 3 changes and what it must not change

Today every capability of an MCP server comes from configuration metadata: the catalog entry, the package or command name, directory arguments, environment variable names, and declared tool names when a config carries them. The rubric grades those as `catalog` or `inferred` basis. Phase 3 adds one new evidence source: the tool list the server itself advertises over the protocol, obtained by a separately consented command.

Invariants that stay true:

- `boppi scan`, `plan`, `fix`, `verify`, `demo`, `push --dry-run` launch no process and make no network request (`test/verify-no-network.js` keeps proving it; the discovery command is added to that test's deny list for the passive commands and exercised only with fixture servers).
- Boppi never sends `tools/call`. The protocol recorder (section 6) is the proof, not a comment.
- Advertised metadata is untrusted text (the specification says clients MUST treat tool annotations as untrusted unless the server is trusted). It never establishes backend authorization, production reach, or credential access on its own; the existing rubric rules for environment, credential kind, and file scope still decide those.
- No automatic installation. A launcher that fetches a package at start (`npx -y`, `uvx` without a pinned, cached package, `docker run` of an absent image) is refused by default.

## 2. Transport and version scope

| Transport | Slice | Reason |
| --- | --- | --- |
| stdio (client launches the server as a child process; newline-delimited JSON-RPC on stdin/stdout; stderr is free-form log text and never parsed as protocol) | first | The specification says clients SHOULD support stdio; every configured local server in the three supported clients is stdio today. |
| Streamable HTTP (single MCP endpoint; POST per message with `Accept: application/json, text/event-stream`; `MCP-Session-Id` echoed on every later request; `MCP-Protocol-Version` header after negotiation; SSE responses possible) | second, founder decision | A remote endpoint means a network request from Boppi with whatever auth the config carries. It needs its own consent text, an explicit allowlist of the configured URL only, no redirects, no DNS rebinding exposure (Boppi is the client here, but it must refuse to follow a redirect to another host), and a decision on sending bearer tokens from the config. Not in the first slice. |
| Deprecated HTTP+SSE (2024-11-05) | never | Fallback probing (`GET` expecting an `endpoint` event) is extra network behavior for a deprecated transport. Report "unsupported transport" instead. |

Protocol version: Boppi sends `protocolVersion: "2025-11-25"` and accepts a server that answers with `2025-11-25`, `2025-06-18`, or `2025-03-26` (the `tools/list` shape is the same across them). Any other answer ends the session with "unsupported protocol version" and no tool list.

## 3. Consent and the command surface

New command, explicit opt-in per run: `boppi discover --client <key> --server <name>` (one server per invocation in the first slice; `--all` is a later decision).

Before anything starts, the command prints and asks for confirmation (or takes `--yes` only together with `--server`, never with `--all`):

- the exact launch: command, arguments (sanitized the same way the scan sanitizes them), working directory;
- the names of environment variables the entry sets (never values) and the note that the process receives them;
- whether the launcher is a package fetcher (refused unless `--allow-package-fetch`, founder decision whether to offer that flag at all);
- what Boppi will send: `initialize`, `notifications/initialized`, `tools/list` (paged), and nothing else; what it will never send: `tools/call`, `resources/read`, `prompts/get`, `sampling`, `elicitation`;
- the side-effect statement: starting the program itself may have effects Boppi cannot see (a server can act on start); Boppi cannot make that safe, only visible.

Boppi does not connect to a client's already-running server session. The roadmap prefers that in principle, but none of the three clients exposes a permissioned inspection interface for a running stdio child; the only path would be attaching to another process, which is out of scope and arguably a privacy violation. This is recorded as "not feasible without client support" and revisited if a client ships one.

## 4. Process safety

| Control | Rule |
| --- | --- |
| Program resolution | The configured `command` is resolved on PATH or as an absolute path before launch; an unresolved program is reported, not installed. Shell is never used (`spawn` with an argument array, `shell: false`). |
| Environment | Only the entry's own `env` plus a minimal inherited set (`PATH`, `HOME`, `TMPDIR`, locale). Boppi's own tokens (`BOPPI_TOKEN`) are explicitly removed. |
| Working directory | The client's project folder for project-scoped entries, the home directory otherwise; printed in the consent text. |
| Timeouts | `initialize` 10 s; each `tools/list` page 10 s; whole session 60 s; a timeout sends `notifications/cancelled` for the pending request id, then shuts down. |
| Shutdown | Close stdin; wait 2 s; `SIGTERM`; wait 2 s; `SIGKILL`. Cancellation by the user (Ctrl-C) runs the same ladder before Boppi exits. Only processes Boppi started are signalled, by pid and start time check, never by name. |
| Message bounds | A line over 256 KiB, a page over 500 tools, more than 20 pages, or a total over 2 MiB ends the session with "oversized response" and keeps what was validated so far, labelled partial. |
| Line discipline | Only newline-delimited JSON objects on stdout are parsed; a line that is not valid JSON-RPC is counted and ignored (the specification says servers MUST NOT write anything else to stdout, but Boppi must not crash on a server that does). |
| Concurrency | One discovery session at a time per Boppi process; a lock file under `~/.boppi/discovery/` prevents two Boppi processes from launching the same server concurrently. |

## 5. Handling hostile or oversized data

Every field from the server is data, never instruction, never markdown.

| Field | Validation | Stored projection |
| --- | --- | --- |
| `serverInfo.name`, `serverInfo.version`, `serverInfo.title` | string, 1 to 128 chars, printable, no control characters | kept (identity evidence) |
| `instructions` | ignored | not stored (it is prompt text addressed to a model, and Boppi is not a model) |
| `capabilities.tools.listChanged` | boolean | kept |
| tool `name` | 1 to 128 chars, `[A-Za-z0-9_.-]` only (the specification's SHOULD rules applied as MUST for storage); duplicates within a server collapse to one with a `duplicate` flag | kept; this is the key the reach table maps |
| tool `title` | string, 1 to 128 chars, printable | kept |
| tool `description` | string; truncated to 500 chars; control characters stripped; stored as `untrusted text`; never rendered as markdown or HTML; shown only behind an "advertised description" label | kept truncated |
| `inputSchema`, `outputSchema` | must be an object; depth at most 8; at most 200 keys in total; `default`, `examples`, `const`, `enum` values longer than 64 chars, and any string value over 128 chars are dropped before storage | stored as a pruned shape, used only to count parameters and to detect path-like, url-like, or command-like parameter names |
| `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) | booleans | kept, labelled advertised; a `readOnlyHint: true` never lowers a grade (misleading read-only annotations are an explicit fixture) |
| `icons`, `execution` | ignored | not stored |
| anything else | ignored | not stored |

Nothing advertised reaches the control plane until the push contract is extended; the first slice keeps discovery results local. When it is extended, the same `ATTRIBUTE_SCHEMA` allowlist pattern applies: an enumerated `basis` value (`advertised`), counts, booleans, and tool names validated by the same charset, no free text.

## 6. Protocol recorder (the acceptance proof)

Every JSON-RPC message Boppi writes is appended, before it is written, to an in-memory recorder that the command can dump with `--record <file>`. Tests assert the recorded method set is exactly `{initialize, notifications/initialized, tools/list}` plus `notifications/cancelled` on timeout, on every fixture. The recorder is also how the "no process during passive scans" claim is tested: the scan path has no code path that constructs a session, and `verify-no-network.js` gains a `child_process.spawn` hook for the passive commands.

## 7. Evidence vocabulary and grading

- New attribute value `basis: advertised` (added to `models.ATTRIBUTE_SCHEMA`; the control plane's allowlist copy follows by sync).
- An advertised tool whose name maps through the existing reach table (`toolCategories.TOOL_TABLE` and rules) creates the same permission categories a declared tool creates today, with `basis: advertised`. For the step rule, `advertised` grades like `catalog` for the existence of a capability (0 steps: the server itself says the tool exists) and changes nothing for environment, credential kind, or file scope.
- An advertised tool with no mapping is recorded as `unmapped` with its name; it creates no capability and is listed under the server as "advertised, reach unknown", so an unknown is visible instead of silent.
- A server that was discovered and advertises no tool mapping to a category the catalog assigned keeps the catalog capability with a note "catalog says X; the running server did not advertise a tool for it", because absence in one `tools/list` page set is not proof of absence (a list can change).
- Discovery results carry `discoveredAt`, the config entry hash they were made for, the negotiated protocol version, `serverInfo`, page count, and `partial: true` when any bound was hit.

## 8. Cache and invalidation

- Stored at `~/.boppi/discovery/<serverId>.json`, mode 600, one file per server identity, with the sanitized launch, the config entry hash, `discoveredAt`, and the stored projection.
- A passive scan reads the cache only when the current config entry hash matches; otherwise the entry is reported as "advertised list is stale (configuration changed)" and treated as if no discovery had happened.
- A `notifications/tools/list_changed` received during the session marks the result `listChanged: true` and triggers one more `tools/list` pass within the session budget; after the session, Boppi has no way to receive it, so the cache carries a `maxAge` (founder decision; proposal 7 days) after which the scan labels it stale.
- `boppi discover --forget --server <name>` deletes the file; `--forget --all` deletes the directory.

## 9. Threat model

| Threat | Where | Control | Residual |
| --- | --- | --- | --- |
| Starting the server has side effects (writes, network calls, credential use on start) | process launch | consent text names the launch and env names; no package fetch by default; only already-installed programs | Boppi cannot see or prevent what the program does on start. Stated in the consent text. |
| Launcher fetches and runs an unpinned package (supply chain) | `npx -y`, `uvx`, `docker run` | refused by default; the scan's existing pin state is shown in the consent text | A pinned package can still be malicious; Boppi does not vet packages. |
| Credential exposure: env values passed to a process Boppi started | env | only the entry's own env; values never logged, never stored, never printed | The server receives them as it would under the client. |
| Hostile descriptions or schemas (prompt injection aimed at a model that later reads Boppi's output, or at a reviewer) | tool metadata | truncation, control-character stripping, plain-text rendering, no markdown, label "advertised"; the control plane receives no free text in the first slice | A human reader can still be misled by text; the label is the mitigation. |
| Oversized or endless responses (resource exhaustion) | `tools/list` | page, tool, byte, and time bounds; partial results labelled | None beyond the bounds. |
| Misleading annotations (`readOnlyHint` on a destructive tool) | annotations | annotations never lower a grade; fixture required | None. |
| Stdout noise or malformed JSON | transport | per-line parse, counted and ignored | A server that interleaves garbage can delay the session until timeout. |
| Zombie or orphan processes | shutdown | close stdin, SIGTERM, SIGKILL ladder; pid and start-time check; lock file | A server that double-forks escapes the ladder; reported as "process may still be running (pid)". |
| Concurrent launches of the same server | lock | lock file with pid | Stale lock after a crash: the command reports it and refuses until `--forget-lock`. |
| HTTP transport: DNS rebinding, redirects, token leakage | not in slice 1 | deferred; when added: configured URL only, no redirect following, explicit decision on bearer tokens, `Origin` is not Boppi's concern as a client but redirect-to-other-host is | Deferred. |
| Boppi's own recorder or cache leaks | files | mode 600, sanitized launch only, no env values, no descriptions beyond 500 chars | Descriptions are still stored; founder decision whether to store them at all. |

## 10. Fixture servers (slice P3-2)

Eight synthetic stdio servers under `test/fixtures/mcp-servers/`, each a small Node script with no dependencies, launched only by the discovery tests, never by a passive scan:

1. `paged`: 3 pages of tools via `nextCursor`, 40 tools in total, two with reach-table names (`get_file_contents`, `push_files`).
2. `list-changed`: advertises `listChanged: true`, sends `notifications/tools/list_changed` after the first page, then a different second list.
3. `no-tools`: `tools` capability declared, empty list.
4. `malformed`: non-JSON lines on stdout, a tool with a null `inputSchema`, a 200-char tool name with spaces, a duplicate name.
5. `oversized`: one 600 KiB line, then 2,000 tools on one page.
6. `timeout`: answers `initialize` and never answers `tools/list`; must receive `notifications/cancelled` and exit on stdin close.
7. `auth-rejection`: answers `initialize` with a JSON-RPC error (`-32602`, "Unsupported protocol version") and a second mode that answers `tools/list` with an error.
8. `hostile`: tool descriptions containing markdown, HTML, ANSI escapes, control characters, "ignore previous instructions" text, a `readOnlyHint: true` on a tool named `delete_repository`, and schema defaults holding path-like and secret-like strings.

Each fixture's expected stored projection is a frozen JSON file next to it, so the test is "projection equals expected" and the recorder is "method set equals expected".

## 11. Acceptance mapping (roadmap Phase 3)

| Roadmap criterion | How it is met | Slice |
| --- | --- | --- |
| At least three fixture servers covering paginated, changed, empty, malformed or oversized, timeout, auth rejection, misleading read-only, hostile descriptions | eight fixtures, section 10 | P3-2 |
| Cancellation stops Boppi-owned processes and leaves existing servers intact | shutdown ladder, pid and start-time check, test with a fixture that ignores SIGTERM | P3-3 |
| Protocol recorder shows no `tools/call` | section 6, asserted on every fixture | P3-3 |
| Passive scans start no process and make no discovery network request | `verify-no-network.js` spawn hook; no code path | P3-3 |
| One consented real integration matches an independently inspected inventory | needs a server the founder designates; run on the founder's machine | P3-5 (founder) |
| Exports and logs carry no credentials, raw sensitive paths, or private payloads | stored projection rules, mode 600, canary test with planted values in env and descriptions | P3-3 |
| Unknown effective permissions stay unknown | `unmapped` tools, `advertised` never grades authorization | P3-4 |

## 12. Founder decisions before P3-3 starts

1. Offer `--allow-package-fetch` at all, or refuse package-fetching launchers outright in the first slice? Recommended: refuse outright; a tester with an unpinned `npx` entry gets "pin it or install it first" and the scan's pin advice.
2. Store advertised descriptions (truncated to 500 chars) locally, or store only names, titles, counts, and annotations? Recommended: store names, titles, counts, annotations, and a 160-char description excerpt; the full text adds little to grading and is the main injection surface.
3. Streamable HTTP in Phase 3 at all, or defer remote servers to a later phase? Recommended: defer; local stdio covers the supported clients' common case.
4. Cache `maxAge`: recommended 7 days, after which the advertised list is labelled stale.

## 13. Slices and estimates

| Slice | Content | Size |
| --- | --- | --- |
| P3-2 | fixtures and frozen projections, projection validator, recorder | 2 days |
| P3-3 | `boppi discover` (stdio only), consent text, process ladder, lock, cache, no-network and no-spawn tests, canaries | 4 to 6 days |
| P3-4 | `basis: advertised` in the rubric and reach table, "advertised, reach unknown" rendering on terminal, HTML, interactive page, export; control plane allowlist sync | 3 days |
| P3-5 | one real integration on the founder's machine, compared with a hand inspection | founder |

Total inside the roadmap's 15 to 25 day range, with HTTP deferred.
