# Boppi scanner progress: end-of-day checkpoint

## October 19, 2026 late afternoon session (Claude Code): detection Gap 2 landed

Read this block first. The Gap 1 block below it, the morning block, and
the October 18 handoff stay accurate except where this block says otherwise.

### Where things stand

| Repository | Checkout | Branch | Tip after this session |
| --- | --- | --- | --- |
| Memanzur/boppi-scan | ~/Desktop/boppi-scan-auto | codex/live-brand-alignment | 1b85c36 (Gap 2 implementation), then this handoff commit; run `git rev-parse HEAD` |
| Memanzur/boppii | ~/Desktop/Boppi-auto | codex/live-brand-alignment | efa3a10 plus a docs-only commit noting Gap 2; run `git rev-parse HEAD` |

Nothing was pushed, published, merged, deployed, or applied to any shared
database. A throwaway worktree of 0513ea5 was created under the session
scratchpad for the before/after comparison and removed again (`git
worktree list` is back to 9 entries). `src/engine` is unchanged, so the
control plane's vendored engine copy needs no resync.

### What changed (scanner 1b85c36)

Gap 2 from the coverage review: an unrecognized server was invisible to
every path and to every sentence of the report.

- `src/cli/recognition.js` (new): one record per scanned server with
  `recognized` (catalog match, name rule, url, directory argument, or a
  declared `capabilities` array; a catalog entry with no capability such
  as the time server counts as recognized), `reasons` when not,
  `launcher` (npm, pypi, docker, url, local, unknown), `identity` with the
  version as written, and `pin` (pinned, unpinned, not_applicable).
- `serverCatalog.identityOf` now returns `{ kind, name, version }`;
  `splitNpmVersion`, `splitPypiVersion`, `splitDockerTag` replace the
  strip helpers. Catalog matching is unchanged (still by name).
- `boppi.js performScan` builds `recognition` per client after
  inference and carries it to the report and the JSON export.
- Terminal: `unrecognized` and `unpinned` tags on MCP SERVERS lines, an
  UNRECOGNIZED SERVERS section (launch summary, reasons, advice), a
  PACKAGE PINS section, and the unrecognized servers named in the
  COVERAGE not-established line. HTML: Recognition column plus the two
  cards. SARIF: `BOPPI-UNRECOGNIZED` (warning) and `BOPPI-UNPINNED`
  (note). Interactive view: a Recognition evidence line on server nodes.
  Local programs print their runtime (`node`), never the script path.
- The second step the review listed, an opt-in local `tools/list`
  handshake that would add the `observed` basis, was not built. It starts
  a server process and needs explicit consent design first.

### Verified this session

| Check | Result |
| --- | --- |
| `npm test` at 1b85c36 | 20 of 20 suites, including new `test/verify-recognition.js` (24 checks) |
| Before/after on Claude Desktop with `weather` (`npx -y weather-mcp-server`), `local-notes` (`node ~/tools/notes-server.js`), and an unpinned `fetch` | 0513ea5: three inventory lines, two saying "no supported capability identified", nothing else. 1b85c36: both tagged unrecognized, UNRECOGNIZED SERVERS names them with launch and reasons, PACKAGE PINS says 2 of 2 unpinned, COVERAGE names them |
| Existing suites | `verify-catalog` asserts the version is kept; `verify-policy-sarif` counts the two new result kinds |

### Decisions to confirm with Melody

1. Unrecognized servers stay out of the graph (no invented reach). The
   review's wording was "a stated unknown", which is what this does. If
   you want them to count toward risk, that is a separate modeling call.
2. The Gap 1 decisions (built-in file access makes most Claude Code
   setups with a network server critical; WebFetch not modeled; no
   Claude Desktop rows) are still open.

### Next priorities

1. Melody reviews both before/after examples and the decision lists.
2. Gap 3 (per-tool categories in the catalog so EP-C and EP-F can fire
   from real scans, and a coarse filesystem scope grade).
3. Everything in the earlier blocks' next-priorities lists still stands.

## October 19, 2026 afternoon session (Claude Code): detection Gap 1 landed

Read this block first. The morning block below it (usability pass, test
kit, coverage review) and the October 18 handoff stay accurate except
where this block says otherwise.

### Recovery note

The Mac restarted at 12:05 local during the gap between sessions. A
recovery check at 13:04 found both worktrees clean at their recorded tips
(scanner 3579245, control plane 28f17eb), no stash, no dirty file, and no
transcript in which Gap 1 had started. Nothing was lost; Gap 1 began from
zero in this session.

### Where things stand

| Repository | Checkout | Branch | Tip after this session |
| --- | --- | --- | --- |
| Memanzur/boppi-scan | ~/Desktop/boppi-scan-auto | codex/live-brand-alignment | 0513ea5 (Gap 1 implementation), then this handoff commit; run `git rev-parse HEAD` |
| Memanzur/boppii | ~/Desktop/Boppi-auto | codex/live-brand-alignment | 28f17eb plus a docs-only commit noting Gap 1 status; run `git rev-parse HEAD` |

Nothing was pushed, published, merged, deployed, or applied to any shared
database. Older dirty worktrees were not touched. A throwaway worktree of
3579245 was created under the session scratchpad for the before/after
comparison and removed again (`git worktree list` is back to 9 entries).

### What changed (scanner 0513ea5)

Gap 1 from `docs/research/SCANNER_DETECTION_COVERAGE_2026-10-19.md` in
the control plane: the agent's own built-in tools were not in the graph.

- `src/cli/builtinTools.js` (new): per-client table of built-in tools
  (Claude Code: Bash, Read, Edit, Write; Cursor: terminal, file edits),
  the Claude Code settings reader (`~/.claude/settings.json`,
  `.claude/settings.json`, `.claude/settings.local.json` under the scan
  cwd; managed settings are not read), per-tool grading (unprompted,
  prompted, denied, unknown), the roll-up to one grant per capability
  (least gated tool wins; a capability whose every tool is denied is
  reported but creates no reach), and `builtinPermissions`, which turns
  each grant into a permission record on the agent with
  `source.type = 'builtin-tool'` and `source.id = builtin:<client>:<cap>`.
  Rule text is never kept, only counts and the mode.
- `discovery/claudeCode.js` exposes `settingsFiles`; `boppi.js discover`
  reads them when the client was found (never in explicit `--config`
  mode), lists them in DISCOVERY with `kind: 'settings'`, and adds found
  ones to the privacy footer. `provider.js` prepends the built-in
  permissions; `simulate.js`, `predict.js` carry `builtin` through every
  counterfactual rescan, so predictions, plan, fix, verify, rollback, and
  the demo all include the grants. `capabilitiesLost` now reports
  `builtin` (capabilities kept through the agent's own tools) and never
  lists those as lost.
- Terminal: BUILT-IN TOOLS section after MCP SERVERS, grants counted in
  COVERAGE, built-in capabilities in the AGENTS count and `--verbose`
  rows, cost sentence names what the agent keeps through its own tools.
  HTML: a Built-in tools table and the same cost sentence; agents table
  lists built-in capabilities. `graphData` agent evidence shows the
  grants and the settings files read; edit-location helpers skip
  settings files.
- Demo scenario summaries and `expect` lists updated to what the engine
  now reports for a Claude Code source (Broad filesystem: EP-A, EP-B;
  Sensitive files: EP-A, EP-B, EP-E; Untrusted: EP-A, EP-B, EP-E).
- README (How it works, What it looks for, Discovery targets) and
  CHANGELOG 0.3.1 describe the behavior.

### Verified this session

| Check | Result |
| --- | --- |
| `npm test` at 0513ea5 | 19 of 19 suites, including new `test/verify-builtin-tools.js` (37 checks) |
| Before/after on Claude Code + one `fetch` server (`--only claude-code`) | 3579245: 0 exposure paths, risk 4/100. 0513ea5: EP-A critical and EP-E high through the built-in file and shell tools, risk 79/100 |
| Prediction honesty | Claude Code + fetch + desktop-commander: removing the commander leaves EP-E (built-in shell remains); removing fetch breaks it |
| Settings grading | whole-tool allow, deny, `bypassPermissions` in `.claude/settings.local.json` under the cwd, and `acceptEdits` each grade as documented; rule text absent from stdout and export |
| Privacy | fixture home path and username absent from exports; settings files appear by `~` path |

### Decisions to confirm with Melody

1. Built-in file access is modeled as `filesystem_access` (read files, a
   sensitive-data category). Consequence: Claude Code or Cursor with any
   network-capable server (GitHub, Slack, fetch) now reports EP-A
   critical, because the agent can read files and the server can reach
   the network. This is true potential access and matches the review's
   own framing, but it makes most real Claude Code setups critical. If
   that is too loud for the beta, the one-line alternative is to drop the
   `filesystem_access` rows from `BUILTIN_TOOLS` in
   `src/cli/builtinTools.js` and keep only the shell rows; EP-E would
   still fire for Claude Code + fetch.
2. WebFetch and WebSearch are also Claude Code built-ins (network plus
   untrusted content). They are not modeled; adding them would make every
   Claude Code install show EP-E with zero servers. Left out on purpose.
3. Claude Desktop has no built-in rows. Its newer local features
   (computer use, Cowork) are not modeled.

### Next priorities

1. Melody reviews the decision list above and the before/after example.
2. Gap 2 (unrecognized server is invisible to every path), then Gap 3
   (per-tool categories and filesystem scope grade), per the coverage
   review's order.
3. Everything in the morning block's next-priorities list still stands
   (scanner 0.3.1 release needs `NPM_TOKEN`; prod migrations need
   Melody's DB password; nothing pushed).

## October 19, 2026 session (Claude Code, resumed from the Codex handoff)

Read this block first; the sections below it are the October 18 handoff and
remain accurate except where this block says otherwise.

### Where things stand

| Repository | Checkout | Branch | Tip after this session |
| --- | --- | --- | --- |
| Memanzur/boppi-scan | ~/Desktop/boppi-scan-auto | codex/live-brand-alignment | run `git rev-parse HEAD`; implementation commits c220dfd and the DISCOVERY label fix after it |
| Memanzur/boppii | ~/Desktop/Boppi-auto | codex/live-brand-alignment | run `git rev-parse HEAD`; implementation commit 257d836 |

Handoff heads fe933df and 6f2e6f6 were verified against Git before any change.
The four older dirty worktrees (Boppi, Boppi-phases, Boppi-rc,
Boppi-release-prep) were not touched. Live boppi.io still served
`/assets/index-DFc36zh3.css` with the October 18 tokens, so the brand spec in
scanner `docs/BOPPI_DESIGN_SYSTEM.md` is still current. Nothing was pushed,
published, merged, deployed, or applied to any shared database.

### What changed

Scanner (c220dfd, then the DISCOVERY fix):

- Interactive report and demo keep keyboard focus through every rerender
  (focus used to drop to `<body>` after Enter on a graph node, a path row, or a
  toolbar pill). Path and fix rows expose `aria-pressed`.
- Engine capability ids reach users as plain language through
  `graphData.capabilityLabel` and `view.capabilityLabels`
  (`shell_access` is "shell access (run commands)"). The report inventory,
  demo inventory, fix previews, and simulation results all use it. The
  terminal report still prints ids; that is deliberate for CLI users.
- Simulating a removal from the evidence panel now reports in that panel, with
  correct plurals and a pressed state on the matching preview button.
- The demo lede says what Boppi reads and which agents it covers before the
  sample picker. Narrow screens get a swipe hint for the five-column graph;
  the inventory table scrolls instead of breaking identifiers mid-word.
- `boppi scan --config` no longer runs the client label into the path in the
  DISCOVERY table.

Control plane (257d836):

- At 390px, AI inventory, Fleet, History, Settings, and Security graph were
  wider than the viewport (643, 653, 651, 599, 397 px). Every settings table
  now sits in the existing `.table-scroll` region and the graph toolbar's
  select and button are constrained to their card.
- The arrow inside the overview's cyan Investigate button inherited the panel
  footer's muted gray (1.4:1); it now inherits the button color.
- `apps/control-plane/scripts/ui-audit/` holds the Playwright scripts that
  found and re-checked all of the above (`PLAYWRIGHT_DIR` required; README
  inside). `docs/design/review-2026-10-19/review.html` is the before/after
  gallery with `browser-checks.json` and the raw audit JSON.
- `BETA_TESTER_GUIDE.md` was rewritten for five testers installing scanner
  0.3.1 from `npm pack` output, demo first, with the workspace push step
  deferred (see blockers).

### Verified this session

| Check | Result |
| --- | --- |
| Scanner `npm test` | 18/18 suites after each commit (demo suite now 7 checks, interactive report +5) |
| Control plane `BOPPI_SCAN_DIR=... npm run verify` | green before and after (typecheck, lint, engine/brand sync, graph layout, engine, ingest, route, reduction, staging, org 91, actions) |
| Fresh disposable stack `/tmp/boppi-beta-local.0MRAUx` | `local-beta.mjs` prepare, build, serve, verify: journey 17/17 |
| Demo interaction script at 1440 and 390 | 14/14 (focus retention x3, panel feedback, labels, plurals, mobile table, swipe hint, no console errors) |
| Static audit, demo and 11 dashboard pages, both widths | no page overflow, no AA contrast failures in HTML text, no unnamed focusables, no heading skips, no console errors (the `.graph-badge` hit is a dark digit on a colored badge, a probe false positive) |
| Packed `boppi-0.3.1.tgz` | installs with `npm install -g --prefix`, `--version`, `demo --html`, and `scan` run from the installed binary |

Still not verified: a human timed on the 30-second task, VoiceOver or NVDA,
real touch hardware, Windows or Linux clients. The demo lede is a best effort
until five real first-time readers say what they think Boppi is for.

### Release blockers found or reconfirmed

1. app.boppi.io runs `deploy/look-only` 938e9d1 and lacks four migrations
   present here: phase2 inventory workflows, exposure snapshots, ingest guard,
   collector envelope. Its ingest schema is a non-strict zod object, so a
   0.3.1 `push` is accepted but the collector/coverage envelope and
   `snapshot_at` are silently dropped. Fleet and History as built here will
   not match production until the migrations and app are promoted (Melody's
   call; needs her DB password and a reviewed migration plan).
2. Scanner 0.3.1 is unpublished (NPM_TOKEN). Testers get the tarball.
3. Engine pin e73ff75 is local; remote CI cannot fetch it until a push is
   approved.
4. Backup workflow secrets and the Vercel plan decision are unchanged.

### Suggested next session

1. Put the demo in front of five people with a stopwatch; use the three
   questions at the end of the beta guide. Fix demonstrated confusion only.
2. If Melody approves, publish 0.3.1 and promote the migrations plus app, in
   that order, then re-enable the push step in the guide.
3. Priorities 3 to 5 from the October 18 list (evidence retention semantics,
   remediation precision, fixture-first monitoring validation) are untouched.

Local services from this session were stopped; the scratch stack's data volume
was kept (`supabase stop --workdir /tmp/boppi-beta-local.0MRAUx`). Docker
Desktop was started by this session and left running.

Current checkout: ~/Desktop/boppi-scan-auto, codex/live-brand-alignment.
Verified implementation: dee1381301711728f34bc32adcce8c30af3934d0.
This handoff adds documentation only; use git rev-parse HEAD for its final tip.

| Phase | Status |
| --- | --- |
| P0 security/correctness foundations and canonical engine | Integrated and locally verified |
| P1 checkup/catalog and collector-envelope v2 integration | Integrated and locally verified with control plane |
| P2 synthetic interactive demo | Functional; current live-brand design implemented; founder/usability approval pending |
| P3 remediation preview, supported removal, verify and rollback | Implemented and fixture-verified; directory narrowing and automated moves incomplete |
| P4 monitoring | Manual opt-in prototype only; no silent installation; real delivery/concurrency unverified |
| Current brand/graph alignment | Implemented, browser-checked, committed as dee1381 |

Final scanner run: 18/18 suites, including interactive report 48 checks and
brand/layout 19 checks. Broader local beta tests passed as detailed in
BOPPI_NEXT_SESSION.md. End-of-day rerun logs are in
~/Desktop/Boppi-eod-handoff-2026-10-18.RZbIUy/.

Known gaps: actual-client/OS validation, timed first-time usability, complete
accessibility, very large graphs, retained evidence after empty discovery,
pattern-limited redaction, full-original local backups, and prototype monitoring.
No deployment, publication, remote push/merge, production/shared-staging
operation, personal scan, real-device fix, or persistent hook installation.

All scanner worktrees were clean before this documentation checkpoint. Older
dirty private-repository work is preserved in its original worktrees, not mixed
into this candidate. The full combined progress record remains at
~/Desktop/Boppi-auto/BOPPI_AUTONOMOUS_PROGRESS.md. Read BOPPI_NEXT_SESSION.md
before resuming; its next five priorities and safety gates apply to both agents.
