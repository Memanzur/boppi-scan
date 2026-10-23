# Evidence layers (Phase 8, slice P8-1)

Status: implemented locally, 2026-10-23. Scanner 0.4.0 (unpublished), engine 1.1.0, rubric 1.0.3, events schema 2.

## What this slice adds

Every scan now carries `evidenceLayers` in the JSON export and in the terminal and HTML reports. For every MCP server and every exposure path the scan keeps four layers apart. Each layer names its source, what it is based on, its time range, its uncertainty, and how much of the machine it covers. The layers are never summed into one score and no layer upgrades another.

| Layer | Source | What it can say | What it cannot say |
| --- | --- | --- | --- |
| configured | configuration files read by the passive scan | which servers, built-in tools, and grants exist; the graph and every path are built from this | that anything was ever called |
| advertised | the tool list a consented `boppi discover --server` stored (seven days, entry hash) | which tool names the server itself offers; names that map through the reach table become `basis: advertised` permissions | what a tool does; the list is unverified names |
| observed | Claude Code hook events recorded by `boppi hook` and paired by `boppi events` | that Claude Code invoked a tool on a server, with ok, error, failed, interrupted, denied, or unknown outcome | what the call did to files or the network; anything on a client with no hook |
| hypothesis | investigative content analysis (Phase 7) | nothing yet; status is always `not_available` | |

Module: `src/cli/evidence.js`. Built in `performScan` after the graph, paths, predictions, and history exist, so the layers describe the scan that was just run and never change it.

## Per-server layers

`evidenceLayers.servers[]` has one row per MCP server in the inventory (`serverId`, `name`, `agentId`, `client`).

- `configured`: `status: present`, the config path, the rubric bases found on its permissions (`configured`, `inferred`, `advertised`), permission and edge counts, first and last seen, `uncertainty` as one minus the server confidence, and `coverage` (`complete` for a full scan, `selected clients only` for `--only`, `one explicit file` for `--config`).
- `advertised`: `none` (no stored discovery), `stale` (entry changed or expired, nothing used), or `usable` with the discovered time, the tool names, which mapped and which did not, and whether the list was partial.
- `observed`: `not_monitored` (any client other than Claude Code), `no_hook_events` (nothing recorded on this machine), `none` (events exist, none for this server in the window), or `observed` with `calls`, `outcomes` by kind, `tools`, `sessions`, `firstAt`, `lastAt`, up to 50 `callKeys` (`session:invocation`, the pairing keys `boppi events --json` lists; `-` stands for a missing id), `reportedAs` (the exact names hooks used), the window, and a `coverage` string that counts records, unreadable lines, duplicates, and records dropped at the segment cap (then the window is partial and the oldest retained time is named). A fifth status, `ambiguous`, is used when two configured names would reach hooks as the same name; neither is credited. The `uncertainty` text is fixed: an invocation says the client called the tool, not what it did; a call with no outcome is unknown.
- `hypothesis`: `not_available`.

### Observed matching rules

- Only Claude Code is monitored (`MONITORED_CLIENTS`). A Cursor or Claude Desktop server never gets observed calls, even when a Claude Code hook reported the same server name (fixture E03, E20).
- Events match a configured server on the form Claude Code puts in tool names: characters outside `A-Za-z0-9_-` become `_`, so `my.server` meets `my_server` (E21). A scope suffix is stripped only when the scan itself added it because two files held the same name (`shellA (project)`, recorded as `renamed` on the discovery file), so both rows show the same calls (E16); a server literally named `x (project)` keeps its name and is never credited with `x`'s calls (E22). Two configured names that reach hooks identically are `ambiguous` and neither is credited (E23). Hooks report the server name, not the file it came from, so the scan cannot attribute a call to one of two files.
- Calls are the pairs `boppi events` builds from `session:invocation`. A pre event without an invocation id is an unknown call and is never paired (E15). A duplicate delivery of the same pair is one call and is counted in coverage as a duplicate (E13). Torn lines are counted, not guessed (E14).
- The window is 30 days back from the scan start. Older events do not count (E07).
- `unmatchedObserved[]` lists every server name with calls in the window that is not in the current Claude Code configuration (removed since, or a project the scan did not cover) (E06, E20). Nothing is invented for it. The terminal and HTML reports print one line for it under the MCP servers.
- An explicit `--config` scan reads no events (E19); `--only` reads events but reports selected coverage (E17).

## Per-path layers

`evidenceLayers.paths[]` has one row per exposure path (`pathId`, `exposureKey`, `templateId`, `severity`, `agentId`, the server ids on the path).

- `configured.status` is always `possible_reach`, with the counts of facts, assumptions, and unknowns from the path assessment. A path is a template that matched the configured graph. It is not an incident.
- `observed.status` is `servers_invoked` when at least one server on the path has observed calls, listing each with its call count and last time, or `possible_reach_only`. `servers_invoked` means a tool on the path was used. It does not mean the path was walked end to end, and the note says so.

## Alternate routes

Closure is decided by the existing prediction engine, not by the layers. Removing one of two equivalent servers predicts no eliminated path and keeps the surviving exposure keys (E09, `predictedEliminated` empty, `predictedSurviving` non-empty). `boppi fix` already prints this as "Lower:" or "changed nothing about exposure" and `boppi verify` checks it after the edit.

## Versions and baselines

`evidenceLayers.versions` names the scanner, engine, rubric, and events schema. History keeps the old baseline with the engine version it was computed under and the new entry with the current one (E08). A finding that changes because the engine or rubric changed is reported as `rubric_changed` by `boppi verify`, never as fixed or newly exploited.

## Surfaces

- Terminal: one `runtime:` line under each MCP SERVERS row (`not monitored`, `no hook events recorded`, `0 calls observed in the last 30 days`, or `observed N calls ... across S sessions, last <time>; an observed call shows the tool was invoked, not what it did`). The whole line passes through `safeText`, and so does every name `boppi events` prints, because stored records are writable by the same user.
- HTML report: the same line under each server.
- JSON export: the whole `evidenceLayers` object.
- `boppi push`: unchanged. No layer, event, or event id leaves the machine; the push envelope still says `runtime: not_observed`.

## Fixtures

`test/verify-evidence-layers.js` builds 23 homes (`test/fixtures/evidence/cases.json`), writes real hook events through `hook.append`, stored discoveries through `discover.writeCache`, and history files, runs the real CLI with `--json`, and checks 143 assertions. The roadmap's acceptance list maps as follows.

| Acceptance item | Fixtures |
| --- | --- |
| same-name servers on different machines or clients | E03, E16, E20, E21, E22, E23 |
| concurrent sessions | E04 |
| missing telemetry | E01, E05, E14, E15 |
| old configurations | E06, E07 |
| new engine versions | E08 |
| alternate routes never read as closure | E09 |
| advertised layer usable and stale | E10, E11 |
| outcomes kept apart | E12, E13 |
| coverage statuses for selected and explicit scans | E17, E19 |
| hypothesis never available | E18 |

Every observed claim in every fixture links to stored event ids and carries the fixed uncertainty text; every path is `possible_reach` from the configured layer; the layers note says they never merge.

## Not done in this slice

- Revoked collectors: the scanner has no collector state to revoke locally; the dashboard side (hiding evidence from a revoked collector) is a control plane task and is not covered by these fixtures.
- Dashboard agreement: the control plane does not yet read `evidenceLayers` from a push, because push does not send it. Whether the layers travel with a push is a consent decision for the founder (the observed layer contains hashed session ids and event ids).
- Large graph budget: no 1,000-node, 5,000-edge fixture, no documented traversal budget, no p95 measurement on a reference machine. The current path search is bounded to one path per template and agent; a completeness claim must wait for that review.
- Explanation checks: the five human sessions that must distinguish possible reach from observed activity cannot be simulated and stay open.
