# Phase 4: foreground `boppi watch` and retirement semantics

Status: implemented 2026-10-23 as `src/cli/watch.js` (slice P4-1) with the retirement rules below (slice P4-2). Foreground only. Nothing is installed, no background service exists, no cloud push or heartbeat is sent; those are separate opt-ins the founder has not authorized (ledger P4-4). Soak and burst measurements against the roadmap budget are slice P4-3.

## What it does

`boppi watch [--only <clients>] [--interval <seconds>] [--duration <seconds>] [--once] [--log <file>]`

1. Runs one passive scan (the same code path as `boppi scan`; no process is started, no network is used) and prints the baseline: clients watched, files watched, servers, exposure paths.
2. Watches the parent directory of every configuration and permission-settings file the scan would read (directories only, never recursive, never a project tree the user did not name). A directory that does not exist yet is not watched; the periodic rescan covers files that appear there later.
3. Coalesces file events with a 500 ms debounce, rescans, and prints a change summary only when the evidence changed. A periodic rescan (default every 60 s, minimum 1 s) covers events the OS watcher missed. Rescans never overlap; a request during a rescan runs once more afterwards.
4. Appends each evidence change to the local history (`~/.boppi/history.json`) and, with `--log`, one JSON line per summary to a file created owner-only.
5. Stops on Ctrl-C, SIGTERM, or when `--duration` elapses; `--once` prints the baseline and exits, which is also how the no-network suite proves the command is passive.

## Change summary

For each rescan whose evidence differs from the last accepted state: the time, the files whose bytes changed with a cause label, servers added or removed per client, exposure paths opened, closed, raised, or lowered (by exposure key and priority), and any client that is now incomplete. A file whose bytes changed but whose servers and paths did not is reported as "rewritten, same evidence".

Cause labels, from the local fix manifest (`~/.boppi/backups/index.json`): a new file hash equal to a fix entry's `appliedHash` is "changed by boppi fix <id>"; equal to a fix entry's `backupHash` after a rollback is "restored by boppi rollback"; anything else is "changed outside Boppi". Boppi never suppresses the summary; it names the cause so its own edits are not mistaken for someone else's.

## Retirement semantics (P4-2)

The roadmap requires that unreadable, deleted, empty, and limited scans have defined semantics before any synchronization, so that a transition never deletes another collector's evidence or falsely verifies a fix. The watcher applies these rules locally; a cloud opt-in would carry the same states.

| Transition | Rule | Why |
| --- | --- | --- |
| A file that was found is missing or unreadable on a rescan | Hold the last accepted state for that client, print "holding: <file> missing or unreadable (an editor may be writing it)", rescan again after a 2 s grace. | Atomic writes (temp file plus rename) and partial writes make a file briefly absent or invalid; reporting closures at that moment would be a false closure. |
| Still missing after the grace rescan | Retire: accept the new state, report the servers and paths that went with the file with cause "file deleted". | A complete, successful scope may retire its own old evidence. |
| Still unreadable after the grace rescan | Keep holding, label the client "stale: unreadable since <time> (<reason>)"; never report closures from it; keep rescanning. | A failed source retains its evidence with a visible stale label; an unreadable file proves nothing about the servers it held. |
| File found with zero servers | Genuine retirement: report the removals and closures. | An empty inventory from a successful read is a real state. |
| A client's scan failed (`scanError`) | Hold its last accepted state, label it "not analyzed: <error>". | Same as unreadable. |
| `--only` limits the scope | Only the named clients are watched or changed; the summary says so and unwatched clients are never mentioned as closed. | A limited scan retains everything outside its scope. |
| A watcher that stopped (Ctrl-C, crash, machine asleep) | Nothing is written; the next start prints a fresh baseline and compares it with the last history entry. | "Not reporting" is a state, not evidence of what happened meanwhile. |

Fix verification is unchanged: only `boppi verify` and `boppi fix` grade a prediction, and they rescan on their own. The watcher's closures are observations, never a verification.

## Limits

- Symlinked configuration directories are watched at the symlink's parent only; a change through another path is caught by the periodic rescan.
- The OS watcher can drop events under burst load; the periodic rescan is the guarantee and the acceptance target (interval plus five seconds) is measured in `test/verify-watch.js` with a one-second interval on synthetic files.
- Memory and idle CPU over a 24-hour soak are not measured by the suite; P4-3 is a bounded synthetic run and a founder-scheduled soak.
