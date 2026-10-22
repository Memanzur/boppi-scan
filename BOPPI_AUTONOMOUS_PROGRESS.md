# Boppi scanner progress: end-of-day checkpoint

## October 22, 2026: Milestone 1 (trustworthy checkup v1) code complete, human gates open

Autonomous session under the founder's directive. All work is local; nothing was pushed, published, deployed, or migrated. Scanner head `870cd81` on `codex/live-brand-alignment` in `~/Desktop/boppi-scan-auto` (package 0.4.0 unpublished, engine 1.1.0). Control plane head `829d474` in `~/Desktop/Boppi-auto`.

What changed, in order (each unit committed with its tests green):

- Unit 1 (3887b33): deny rules win over Read's never-prompts default; unreadable settings grade unknown; built-in permissions carry rubric attributes.
- Unit 2 (fcd3792): `boppi verify` says how many paths closed and what remains; a zero-benefit edit is never reported as a fix that worked; `boppi fix` warns before applying one.
- Unit 3 (1d32b63): read-only cluster tools reach no production system; environment graded only from explicit words; Docker tags are `tagged`, not pinned; reach and capability permissions carry attributes.
- Corpus (21be9f0): 50 labeled synthetic setups (16 negative, 16 limited, 18 high-impact, 15 held out) frozen before tuning, with `test/verify-rubric-corpus.js`.
- Unit 4 (7688849): risk rubric 1.0.0 in `src/engine/riskRubric.js`. Priority is the template impact stepped down by the weakest evidence; every path carries facts, assumptions, unknowns, and `likelihood: not assessed` on the terminal, HTML, interactive panel, JSON, and the dashboard paths page. Findings covered by a path take its priority. Push sends permission attributes.
- Push (66532fd): each MCP server record carries recognition (recognized, pin, launcher).
- Docs (870cd81): `docs/milestone1/RISK_RUBRIC_v1.0.0.md` (the reviewable rule with four open questions) and `docs/milestone1/ADJUDICATION.md` (eleven objections, each with outcome, fixture, and what stays unknown). Decision trail: `docs/milestone1/DECISIONS.tsv`.
- Control plane (829d474): rubric vendored from scanner 87d6a3a, permission attributes ingested, paths page shows what supports each path, what it assumes, and what was not checked.

Verified by running, this session: scanner `node test/run-all.js` 23 of 23 suites; corpus 50 of 50, held-out critical precision 5/5 and recall 5/5, 0 unjustified criticals; control plane `BOPPI_SCAN_DIR=~/Desktop/boppi-scan-auto npm run verify` in `apps/control-plane` fully green (typecheck, lint, vendor sync, engine port 23 checks, ingest 45, route 21, reduction 15, staging safeguards, org workflows, actions). A sample scan was rendered on the terminal and to HTML and read by eye.

Open human gates (cannot be closed by an agent): founder and security reviewer sign-off on the rubric; five uncoached users re-checking comprehension; the Phase 0 sessions themselves (still 0 of 5).

Not done, by choice: the dashboard does not yet display the pushed recognition field (ingest accepts it; display is Phase 3 scope). `~/Desktop/boppi-scan` (the main checkout) is behind this worktree, so the control plane vendor check must be run with `BOPPI_SCAN_DIR` pointing at `boppi-scan-auto` until the branch is merged.

Milestone 2 (roadmap Phase 2, individual beta release gate) slice 1, same session: `npm run release-candidate` (`scripts/release-candidate.js`, commit 496eb50) packs the tarball, installs it into a throwaway prefix, runs version, scan, demo, plan, fix, verify, rollback, and uninstall on a synthetic home, checks the JSON, HTML, and SARIF for secret values and raw home paths, and writes `CANDIDATE.json`. Result 20 of 20 checks. Candidate at `~/Desktop/Boppi-candidate-0.4.0/` (package/boppi-0.4.0.tgz, sha256 836f2784…, built from clean 496eb50). `docs/release/CANDIDATE-0.4.0.md` states supported clients and platforms, install and removal, known limits, reporting, and withdrawal. README shows the 0.4.0 path lines and how priority is set; `BETA_TESTER_GUIDE.md` in the control plane repo now targets 0.4.0 and asks testers about `based on:` and `assumes:` lines. Still unpublished; Linux and Windows remain experimental; the five-tester install run is a human gate.

Next session: start from `docs/milestone1/NEXT_SESSION_PROMPT.md` in the scanner repo.

## October 20, 2026: Phase 0 synthetic testing environment prepared

Founder authorized local preparation, not a public release or phase 1 code work.
Start with `~/Desktop/Boppi-phase0-beta-2026-10-20/START_HERE.md` and its
five owner-only blank forms under `feedback/`. Current preparation report:
`Boppi-auto/docs/beta/first-time-user-test/PHASE0_PREPARATION_2026-10-20.md`.

- Source heads remain scanner 14278e8 and control plane 15dd7b2; frozen local
  package 0.3.1 / engine 1.0.2. Package checksum is in the kit CANDIDATE.json.
- Fresh automated verification: scanner 22/22 suites, local dashboard build,
  existing isolated integrated journey 17/17, browser demo/report and synthetic
  sign-in/Overview/Fleet/History. Initial sandbox socket denial was resolved;
  it was an environment restriction, not a remaining failing scanner test.
- Six synthetic accuracy cases and a QA-only zero-benefit removal reproduce
  permission/severity/name-inference concerns. The zero-benefit edit prints
  CONFIRMED despite 0 paths closed. These remain review items, not code fixes.
- **Human usability sessions: 0.** T1-T5 sandboxes remain unused; only QA was
  rehearsed. Participant commands always target separate synthetic homes and
  require interactive approval for the recommended github fix and rollback.
- Local demo/report: http://127.0.0.1:3098/demo.html and /report.html.
  Local dashboard: http://127.0.0.1:3097/login. Servers are left running for
  founder testing. Restart/stop instructions are in START_HERE.md.
- New disposable stack: /private/tmp/boppi-beta-local.phase0-2026-10-20.3ALpWR,
  project boppi-phase0-beta-2026-10-20; API/DB/mail ports 55321/55322/55324.
  Its published Docker ports were restricted to 127.0.0.1 and verified. Docker
  Desktop resumed an older founder stack; that stack/data remain preserved.
- No personal scan, real config remediation, live MCP execution, persistent
  hook installation, participant recruitment, sensitive feedback collection,
  cloud operation, public push/publish/merge/deployment or commit occurred.
  Only preparation artifacts, docs and disposable local runtime/build state
  changed; product source code is unchanged.

Next: conduct the first real consenting T1 session using START_HERE.md;
record actual answers and disagreements, then repeat through T5. Phase 0 is
not complete until human sessions and review meet the roadmap gates.


## October 20, 2026: authoritative roadmap and five-user beta plan

Read this newest block first. The single authoritative forward roadmap is
[BOPPI_ROADMAP_2026.md](../Boppi-auto/BOPPI_ROADMAP_2026.md)
(`Memanzur/boppii`, repository root). Do not treat the October 18 playbook,
old P0-P4 labels, or earlier next-priority blocks as the current roadmap.
Historical implementation/test evidence below is preserved.

### Verified local state before planning edits

- Scanner: `~/Desktop/boppi-scan-auto`, `codex/live-brand-alignment`,
  `14278e8e2ecf91ead5b4da4e7ca191237a523367`; package 0.3.1, engine 1.0.2.
- Control plane: `~/Desktop/Boppi-auto`, same branch,
  `15dd7b2a42c93e943f021d637832bd0f59cf1d7f`.
- Both active checkouts were clean. All 24 worktrees were checked read-only.
  Four older control-plane checkouts remain dirty and preserved: Boppi (55
  status entries), Boppi-phases (2), Boppi-rc (3), Boppi-release-prep (1).
  All other worktrees were clean. The roadmap appendix records all heads/branches.
- The five dashboard engine hashes and vendored bodies match scanner
  `70978968c4e75681a00d28c712e5fba4c24e9171`. The old e73ff75 / 1.0.1 pin
  statements below are historical. No test suites were rerun in this task;
  22/22 scanner suites and the final dashboard checks are recorded October 19
  results, not fresh production or real-client validation.
- No remote fetch or hosted schema/version/secrets check was performed.
  npm 0.3.0 and app.boppi.io at 938e9d1 with four missing migrations are the
  last October 19 reports, not newly verified public state.

### Planning deliverables and next step

- Created `Boppi-auto/BOPPI_ROADMAP_2026.md`: current baseline, phase-by-phase
  reuse/implementation/dependencies/risks/acceptance/effort/user benefit;
  individual and team release gates; opt-in discovery/monitoring/runtime;
  scoped prompt investigation; evidence-backed paths; reviewed device
  remediation; later enterprise governance and enforcement.
- Created the [five-user beta checklist](../Boppi-auto/docs/beta/first-time-user-test/BOPPI_FIVE_USER_BETA_CHECKLIST_2026.md).
  Five-user sessions are prepared, not performed. The existing kit is reused.
- Next: run five supervised local beta sessions, then implement phase 1,
  **Trustworthy findings v1** (10-15 focused engineer-days): adjudicated
  false positives and false negatives, calibrated severity, versioned evidence,
  readable explanations, and effective/safe remediation predictions.
- Open modeling decisions must be resolved from evidence, not by globally
  lowering scores or deleting built-in grants. Code inspection also found
  Read's default grade precedes deny evaluation in builtinTools.gradeTool;
  phase 1 must investigate supported client semantics and add a fixture.
- Continuous watching, live MCP tools/list, prompt investigation, runtime
  correlation/cloud events, and dashboard-initiated real fixes are still
  proposed work. The hook is a metadata-only prototype. Advertised tools
  are not proof of effective permission; observed calls are not proof of
  file/network effects or prompt causation.

Only planning/documentation files changed and remain uncommitted. No code
implementation, test-generated runtime state, personal scan, MCP execution,
hook installation, service start, database operation, production/shared-staging
access, commit, push, publish, merge, deployment, or credential change occurred.
The roadmap is a plan, not authorization for those operations.


## October 19, 2026 night session (Claude Code): four report corrections, engine 1.0.2

Read this block first. The Gap 3, Gap 2, and Gap 1 blocks below it stay
accurate except where this block says otherwise.

### Where things stand

| Repository | Checkout | Branch | Tip after this session |
| --- | --- | --- | --- |
| Memanzur/boppi-scan | ~/Desktop/boppi-scan-auto | codex/live-brand-alignment | 7097896 (0a6b19b fixes + 7097896 blast radius), then this handoff commit; run `git rev-parse HEAD` |
| Memanzur/boppii | ~/Desktop/Boppi-auto | codex/live-brand-alignment | 834bf0d (vendored engine resynced to 7097896) plus a docs commit; run `git rev-parse HEAD` |

Nothing was pushed, published, merged, deployed, or applied to any shared
database. `node test/run-all.js` is 22 of 22 suites. The control plane's
`verify:engine` (21 checks), `verify:reduction`, `verify:ingest`, vendor
sync, and typecheck pass against the resynced engine.

### What changed (scanner 0a6b19b, 7097896)

The validation-kit run (control plane `docs/beta/first-time-user-test/
VALIDATION_RUN_2026-10-19.md`) logged four wording issues; all four are
fixed, each with a regression test, and a fifth defect surfaced while
testing.

1. `boppi verify` next step. `src/cli/verify.js` `nextStep(summary)`:
   a confirmed row next to ungraded rows now reads "1 fix confirmed as
   predicted; 1 other prediction not graded because that edit was not
   applied. ..." instead of "Nothing could be graded yet". Contradicted
   and partial still win; all-unresolved keeps the old sentence.
   Test: verify-predictions.js.
2. Edit file targeting. Discovery records `servers: [keys]` per config
   file (names only, exported in `discovery`). New `src/cli/configFiles.js`
   (`filesHolding`, `editFiles`) replaces three copies in plan.js,
   graphData.js, and terminal.js, so ROOT CAUSE, `boppi plan`, and the
   HTML report name only the files that hold the server. Older exports
   without the field fall back to every found file. Test: verify-plan-fix.js
   (two-file Cursor fixture).
3. Graph permission labels. `graphData.permissionLabel`: permission nodes
   read `file access (the whole home directory)`, `modify source code`,
   `production system access`; built-in grants keep their label. The raw
   permission text is a `Permission` evidence line. Tool nodes keep their
   tool names. Test: verify-tool-reach.js.
4. Demo page card. `demo.client.js` `describe(base, simulation)` and
   `inventoryOf(view)`: the headline counters and the "Understand the
   exposure" card always describe the sample's actual scan; a preview
   changes the Preview counter, graph, and inventory, and the card's
   next-step line reads "Simulated preview active: ... The sample itself
   is unchanged". Test: new verify-demo-client.js runs the real client
   script against a DOM stand-in (registered in run-all.js).
5. Engine 1.0.2 (`src/engine/exposurePathEngine.js`, `models.js`).
   Equal-length routes were ordered by record id; ids are content hashes
   that differ per machine (the fingerprint key is per home), so the same
   configuration printed a different EP-A chain and prediction set on
   different machines, and two suites were flaky. Adjacency and branch
   groups now order by node label first. `blastRadius` shares the same
   adjacency. Tests: verify-exposure-paths.js (id-mirrored graph picks
   the same route; blast radius covered). verify-interactive-report.js
   asserts the Claude Code EP-A path's shape, not its route.
   Consequence: `boppi verify` on an export made before this change flags
   `engine_changed`; statuses are still computed.

Control plane: `apps/control-plane/scripts/sync-engine-from-scanner.mjs`
was referenced by the vendor banner and the verify script but did not
exist; it is reinstated (copies src/engine under the banner, records the
scanner commit and sha256s in SOURCE.json, refuses a dirty engine).

### Before and after

- verify: "Next: Nothing could be graded yet. Apply the recommended edit"
  with one CONFIRMED row -> "Next: 1 fix confirmed as predicted; 1 other
  prediction not graded because that edit was not applied. Run boppi scan
  --json again ...".
- ROOT CAUSE on a two-file Cursor setup: edit lines for ~/.cursor/mcp.json
  and ~/proj/.cursor/mcp.json -> only ~/.cursor/mcp.json (the file that
  holds kubernetes).
- Graph boxes: `repo (filesystem_access: a source tree)`,
  `kubernetes (access_production_system: kubectl_get, kubectl_describe +14)`
  -> `file access (a source tree)`, `production system access`.
- Demo card during "Preview removal of github": "No potential paths in
  this sample ... Next: choose another sample" -> title and why stay on
  the actual path, action reads "Simulated preview active: Removing
  "github" closes 2 potential paths; 0 paths remain. ... The sample itself
  is unchanged; press Reset simulation to clear the preview."

### Next

- Melody's decisions from the Gap 1, 2, and 3 blocks are still open.
- Push of `codex/live-brand-alignment` and the 0.3.1 release remain
  unauthorized; `NPM_TOKEN` is still missing.
- The validation kit's `05` and `04` walkthroughs describe the fixed
  behaviour only where noted as "known issue"; those two notes can be
  removed once this build is the tarball testers receive.

## October 19, 2026 evening session (Claude Code): detection Gap 3 landed

Read this block first. The Gap 2 and Gap 1 blocks below it, the morning
block, and the October 18 handoff stay accurate except where this block
says otherwise.

### Where things stand

| Repository | Checkout | Branch | Tip after this session |
| --- | --- | --- | --- |
| Memanzur/boppi-scan | ~/Desktop/boppi-scan-auto | codex/live-brand-alignment | cbcad29 (Gap 3 implementation), then this handoff commit; run `git rev-parse HEAD` |
| Memanzur/boppii | ~/Desktop/Boppi-auto | codex/live-brand-alignment | bb24282 plus a docs-only commit noting Gap 3; run `git rev-parse HEAD` |

Nothing was pushed, published, merged, deployed, or applied to any shared
database. A throwaway worktree of 1b85c36 was created under the session
scratchpad for the before/after comparison and removed again (`git
worktree list` is back to 9 entries). `src/engine` is unchanged, so the
control plane's vendored engine copy needs no resync. All three gaps from
`docs/research/SCANNER_DETECTION_COVERAGE_2026-10-19.md` (control plane
repo) are now implemented locally.

### What changed (scanner cbcad29)

Gap 3 from the coverage review: capabilities were server-wide and stopped
at one of eight category ids, so EP-C (supply chain) and EP-F
(impersonation) could never fire from a real configuration, and a
filesystem server at `~/` graded the same as one at a photos folder.

- `src/cli/toolCategories.js` (new): `TOOL_TABLE` maps exact catalog and
  common tool names to the engine's finer categories (`push_files` to
  modify_source_code, `get_file_contents` to read_source_code,
  `kubectl_apply` / `execute_sql` / `deploy_edge_function` to
  access_production_system, `slack_post_message` / `create_issue` to
  send_external_message, Stripe tools to financial or customer data);
  `TOOL_RULES` are name patterns for tools the table does not list;
  `IDENTITY_RULES` give Gmail/Outlook/IMAP servers read_email and
  send_email, and SMTP/SendGrid/Mailgun/Resend send_email only.
  `scopeOf(dir, home)` grades a directory as system, home, secrets
  (`.ssh`, `.aws`, `.kube`, `credentials`, any dotfolder under home),
  source (a `.git`, `package.json`, `pyproject.toml`, or similar marker),
  or other. `scopeReach` adds access_credentials for home/system/secrets,
  read_source_code for home/system/source, and modify_source_code when
  the server also has write tools. Only labels leave the module.
- `knownServers.inferCapabilities` returns `filesystemScope` and `reach`
  alongside the existing fields; the grading happens while the raw path
  is still known, before fingerprinting.
- `provider.js`: `reachPermissions` creates one permission per reach
  category on the server (`source.id = tool-reach:<server>:<category>`,
  `rawPermission` = `server (category: tool1, tool2 +N)`); catalog or
  name-rule reach is `inferred` 0.7, directory-derived reach is
  `observed` 0.85. The filesystem permission is now labeled
  `server (filesystem_access: <scope label>)` and graded `broad` for
  home and system scopes, `scoped` otherwise. `CATEGORY_RISK_WEIGHT`
  gained the new categories.
- Terminal: `file scope:` and `reach through tools:` lines under each
  MCP SERVERS entry. HTML: the same under the capabilities cell. Graph
  data: `File scope` and `Reach: <category>` evidence on the server node.
  Nothing else changed in the engine, exports, SARIF, plan, or fix.
- `test/verify-tool-reach.js` (46 checks) covers the table, rules,
  identity rules, scope grades, mixed scope lists, inference output,
  the scan report (EP-C and EP-F from a real config, no path printed or
  exported, graph evidence, HTML), and a clean fixture that stays at
  zero paths. `node test/run-all.js` is 21 of 21 suites. No existing
  expectation shifted.
- README "Per-tool reach and file scope" subsection; CHANGELOG 0.3.1
  bullet.

### Before and after (same synthetic Claude Desktop config)

Fixture: github, kubernetes, gmail, fetch, and three filesystem servers
pointed at the home directory, a repo with `.git`, and a notes folder.

Before (1b85c36): 1 exposure path. Each server showed only its coarse
capability ids; EP-A via repo-files reading files to gmail's network.

After (cbcad29): 4 exposure paths (2 critical). Each server lists what it
reaches: github modifies and reads source and sends external messages,
kubernetes reaches production, gmail reads and sends email, home-files is
"the whole home directory" with credentials, read and modify source,
repo-files is "a source tree", notes-files is "a folder elsewhere". New
paths: EP-C critical (home-files modify source -> kubernetes production),
EP-E high (fetch -> home-files modify source), EP-F high (gmail read email
-> github send external message -> fetch untrusted content). EP-A now
starts from gmail's read_email.

### Decisions for Melody (new, in addition to the Gap 1 and Gap 2 ones)

1. A filesystem server at the whole home directory now implies
   credential access and source read/modify (because `~/.ssh` and every
   repo live under it). This is the intended reading of the review but
   it makes `~/` filesystem servers critical on most machines. Drop the
   home case from `scopeReach` in `toolCategories.js` to soften it.
2. Every `kubectl_*` tool, including read-only `kubectl_get`, counts as
   production access. Narrow `TOOL_RULES` to write verbs if that is too
   loud.
3. A server is an email connector by name (gmail, outlook, imap) with no
   tool evidence. That is what lets EP-F fire; it also means a misnamed
   server gets email reach it may not have.
4. The engine's EP-A template now prefers `read_email` over `read_files`
   as the data source when both exist, so the printed EP-A chain changed
   on machines with a Gmail server. Only the wording moved; the count
   did not.

### Next

- Melody reviews the four Gap 3 decisions plus the open Gap 1 and Gap 2
  decisions below, then authorizes a push of `codex/live-brand-alignment`
  and the 0.3.1 release (`NPM_TOKEN` is still missing in the repo).
- `boppi push` does not send `reach` or scope labels as separate fields;
  they travel inside the permission records, so ingest already receives
  them. The control plane UI does not yet render `tool-reach:` source ids
  specially.

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
