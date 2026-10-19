# Boppi: next session (October 18, 2026 end of day)

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

## Start here, Claude Code or Codex

This is the current scanner development checkout, not the older main checkout.
Read this document and `docs/DESIGN_PROGRESS.md`, then the combined handoff at
`~/Desktop/Boppi-auto/BOPPI_NEXT_SESSION.md` and its worktree inventory.
Do not start a new recovery from scratch or reintegrate P1-P4 agent branches.

| Repository | Active local checkout | Branch | Verified implementation checkpoint |
| --- | --- | --- | --- |
| Memanzur/boppi-scan, public canonical engine | ~/Desktop/boppi-scan-auto | codex/live-brand-alignment | dee1381301711728f34bc32adcce8c30af3934d0 |
| Memanzur/boppii, private dashboard/control plane | ~/Desktop/Boppi-auto | codex/live-brand-alignment | 6b755c78c207df2827cc29030a6f1201a50ef5aa |

The end-of-day commits add documentation only after these implementation
checkpoints. Get the exact current tip with `git rev-parse HEAD`; get this
handoff's commit with `git log -1 --format=%H -- BOPPI_NEXT_SESSION.md`.
Package 0.3.1 / engine 1.0.1 remain unpublished. Plain `npx boppi` may run an
older published scanner; do not use it to validate these local changes.

## What works locally

- Supported Claude Desktop, Claude Code, and Cursor configuration discovery,
  metadata sanitization, evidence-backed inventory, potential exposure paths,
  confidence, and catalog inference. No MCP server is launched.
- Collector envelope v2: producing version/platform, client coverage/status/
  counts/errors, and explicit runtime-not-observed. Tested through the actual
  local ingest handler, Auth/PostgREST/Postgres, and dashboard.
- JSON/HTML/SARIF exports, plan --diff, supported server removal with owner-only
  backup, rescan/verify, and hash-checked rollback that protects later edits.
  End-to-end apply/rollback tests used synthetic files, never personal configs.
- Offline interactive browser demo: four synthetic environments, real-engine
  counts and rescans, before/after simulation, reset, inventory, coverage, and
  expandable evidence. Demo interactions never apply real configuration edits.
- Current live-brand alignment: dark/cyan tokens and actual public logo,
  measured full labels, variable node heights, inferred-edge styling, path
  isolation, context/tool disclosure, and responsive local report/demo.

The live palette was verified at public https://boppi.io/ and its served CSS
before editing, not taken from previous mockups. Canonical specification:
`docs/BOPPI_DESIGN_SYSTEM.md`; tokens: `src/design/tokens.css`. The dashboard
uses a checked identical copy. The vendored security engine remains pinned to
e73ff75 and matches the current scanner engine; the design commit did not alter
the engine, so do not resync solely because the documentation HEAD changed.

## Prototypes, partial work, and boundaries

- Monitoring is a manual, opt-in Claude Code hook prototype. Normal commands
  install no hooks; --install is refused. Actual live hook delivery, concurrency,
  alerting and continuous watching remain unverified or unimplemented.
- `boppi ui` and browser application of real fixes are not implemented. Unused
  live-renderer scaffolding does not make those features real.
- Automatic remediation supports whole-server removal, not directory-level
  narrowing. Moves are guided, not fully automatic.
- Personal real-client behavior, Windows integrations, full screen-reader/
  keyboard/touch behavior, large-fleet readability, and timed first-time
  comprehension still need validation. Linux/Node 22 passed the pre-redesign
  17-suite candidate, not a newly claimed 18-suite cross-platform rerun.
- No production or shared-staging database, deployment, publication, push,
  merge, or infrastructure action was performed. Cloud auth/email/recovery,
  backup rehearsal and release approval are not established by local tests.
- Pattern-based redaction cannot recognize all opaque secrets. Names/commands
  can be confidential; backups contain full originals. Never add those files,
  scratch tokens, .env files, or personal scan exports to Git or a handoff.
- Empty discovery sends nothing, leaving prior workspace evidence. Selected or
  failed scans merge deliberately. Token revocation stops new pushes but does
  not erase existing records.

## Tests and saved artifacts

The final development run passed 18/18 scanner suites, including 48 interactive
report checks and 19 brand/layout/contrast checks. Control-plane verify/build,
7 graph checks, database 34 PASS assertions, auth 14/14, security surface 24/24,
and packed local installation journey 17/17 passed. Browser tests covered all
four scenarios, simulation/reset, evidence, and mobile navigation; full graphs
had no labels outside the checked 53 demo / 65 dashboard node rectangles.
No timed usability or full accessibility certification is claimed.

Fresh end-of-day scanner/control-plane verification logs:
`~/Desktop/Boppi-eod-handoff-2026-10-18.RZbIUy/`.
Broader earlier test logs and screenshots:
`~/Desktop/Boppi-brand-review-2026-10-18.x4Yo9Z/`.
The gallery is also committed in the control plane at
`docs/design/review-2026-10-18/review.html`, alongside the offline demo.
The older pre-redesign package/demo in
`~/Desktop/Boppi-local-beta-2026-10-18.5vh5tc/` is preserved unchanged; it is not
the newly branded artifact. No personal scan was run during development.

## Safe restart commands

```sh
cd /Users/melodymanzur/Desktop/boppi-scan-auto
git status --short --branch
git log -3 --oneline
npm test
node scripts/preview-design.js
```

The last command starts only a fixture-backed, loopback preview at
http://127.0.0.1:3187. Stop it with Ctrl+C. The committed offline HTML needs no
server or account. Do not scan real configurations or run real fixes/hooks
without the founder's current authorization. Do not run scripts that use the
default remote workspace merely to test UI.

All 9 scanner worktrees were clean at end-of-day inspection. The older main
checkout is `~/Desktop/boppi-scan` at a63e4f0; leave it and the source-agent
worktrees intact. Exact branches/SHAs and the four dirty control-plane worktrees
are recorded in `Boppi-auto/docs/EOD_WORKTREES_2026-10-18.md`.

## Next five priorities

1. Get founder approval of the saved screenshots/demo; time the first-30-second
   task and audit keyboard/screen-reader/touch behavior before more styling.
2. Run five supervised personal-environment scanner/demo trials and validate
   discovery/error coverage across actual supported clients and more OSes.
   Keep uploads/hooks off and real changes approval-gated.
3. Design and test safe empty-inventory retirement and distinguish retained
   historical evidence from current complete/partial discovery.
4. Improve remediation precision and disruption explanations while preserving
   evidence, backup integrity, verification, rollback, and confirmation gates.
5. Validate the optional monitoring prototype's delivery/concurrency/privacy
   in fixtures first. Real-device installation and all remote release actions
   remain separate approval gates, not implied next steps.
