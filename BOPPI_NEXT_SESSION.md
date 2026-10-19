# Boppi: next session (October 18, 2026 end of day)

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
