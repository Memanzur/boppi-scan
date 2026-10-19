# Boppi scanner progress: end-of-day checkpoint

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
