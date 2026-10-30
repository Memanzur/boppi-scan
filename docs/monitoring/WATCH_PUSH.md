# `boppi watch --push`

`boppi watch --push` keeps the workspace inventory for this machine current while `boppi watch` runs. When a rescan changes the inventory, it sends the same body `boppi push` sends. When nothing changed, it sends nothing.

It is off unless you pass `--push` on the command line. No environment variable, setting, or workspace request turns it on (founder decision D-21). Boppi installs nothing to run it in the background. Code: `src/cli/watchPush.js`. Tests: `test/verify-watch-push.js`.

## Command

```
boppi watch --push [--url <workspace>] [--token <token>] [--once] [--interval <s>] [--duration <s>] [--log <file>] [--only <clients>]
```

| Flag | Meaning |
| --- | --- |
| `--push` | Send the inventory to the workspace when it changed. Without this flag, `watch` makes no network request. |
| `--url <workspace>` | Workspace origin or ingest URL, resolved by `push.resolveIngestUrl`. Default `https://app.boppi.io`. `http` is accepted only for `localhost`, `127.0.0.1`, and `[::1]`. |
| `--token <token>` | Collector token from the **Collectors** page. `BOPPI_TOKEN` is read when the flag is absent. In a terminal with neither, Boppi asks for the token with hidden input. Without a terminal and without a token, the command exits 2 before it scans. |
| `--once` | Scan once, send any queued pushes for this origin, push if the inventory changed, and exit. |
| `--log <file>` | Append one JSON line per event to an owner-only file. Push events are listed under [Log lines](#log-lines). |

`--interval`, `--duration`, and `--only` work as they do without `--push` (see `docs/phase4/WATCH_DESIGN.md`). With `--only`, the coverage scope is `selected`, so each push merges into the workspace and removes nothing. Full discovery (no `--only`) sends a full snapshot.

## What is sent

The body is built by `push.prepareIngest`, the function `boppi push` uses. For the same home it equals what `boppi push --dry-run` prints, except for `snapshot_at`. Only sanitized inventory metadata is sent: no secret values, file contents, or raw paths. Before a body is queued or sent, `push.unsafeFields` checks it. If any field could carry a secret or is not a Boppi id, the body is neither queued nor sent. `--once` then exits 2.

The baseline banner names the workspace and states what leaves the machine. The stop line says that only sanitized inventory metadata was sent and to which workspace.

## When it pushes

1. Boppi computes a digest: sha256 of the body as canonical JSON (keys sorted), without `snapshot_at`.
2. Boppi compares the digest with the newest queued entry for this origin. If no entry is queued, it compares with the last digest it sent to this origin with this token.
3. If the digests are equal, nothing is sent. A file rewritten with the same servers, a `touch`, and a restart with an unchanged inventory all send nothing.
4. If the digests differ, Boppi adds the body to the queue, then sends queued entries for this origin oldest first.

Boppi pushes only after a rescan in which no client was held. A held client is a file that is missing during the 2 s grace period, unreadable, or not analyzed. The same rule decides when `watch` writes local history. Rescans run after the 500 ms file-event debounce or on the `--interval` timer, so a burst of writes produces a few pushes, and the last one carries the final state.

The last sent digest is kept per origin and per token. The key is the origin plus the first 16 hex characters of a sha256 of the token, so the token itself is not stored. A token for a different workspace on the same origin pushes its first scan.

## Queue

Every changed body is written to the queue before it is sent. If the process stops during a send, the next run sends the entry again. The workspace either stores the same inventory again or refuses it as a stale snapshot, and Boppi drops it.

| Item | Value |
| --- | --- |
| Folder | `<home>/.boppi/watch-push/`, mode 0700 |
| Queue | `queue.json`, mode 0600: `{ "schemaVersion": 1, "entries": [{ "id", "origin", "digest", "queuedAt", "body" }] }` |
| Sent digests | `state.json`, mode 0600: `{ "schemaVersion": 1, "pushed": { "<origin> <token tag>": { "digest", "at" } } }` |
| Token | Never written to either file |
| Caps | 20 entries, 24 hours, 8 MB in total, across all origins. The oldest entries are dropped first, and each drop prints a line to stderr. |
| Order | Oldest first, only entries whose `origin` matches the current `--url` |

Each write goes to a temp file in the same folder, opened with `O_EXCL` and mode 0600 and never through a symbolic link. Boppi fsyncs the temp file, renames it over the target, and then fsyncs the folder. If `queue.json` or `state.json` is a symbolic link, the command exits 2 and does not read the link target. A file that does not parse, or has the wrong shape, is renamed to `queue.json.corrupt-<timestamp>` (or `state.json.corrupt-<timestamp>`), mode 0600, with a warning on stderr. Boppi then continues with an empty file. Temp files left by an earlier run are deleted on load.

Run only one `watch --push` per home at a time. Two sessions on one home do not corrupt the files, but one can overwrite the other's queue.

## Responses

| Response | Action |
| --- | --- |
| 2xx | Remove the entry and store its digest. `snapshotId` from the response body goes to the log. |
| 401, 403 | Stop. See [Refused token](#refused-token). |
| 409 `stale_snapshot` | Drop the entry, print a note, and continue with the next entry. |
| 413, 422, other 4xx | Drop the entry, print the reason, and continue. No retry. |
| 429, 5xx, network error | Keep the entry and retry later. |

In long-running mode, a retry waits 2 s for the first attempt and doubles for each later attempt, up to 5 minutes. Each wait is a random value between half and all of that step. A `Retry-After` header, or `retryAfterSeconds` in the body, replaces the computed wait. New changes join the queue while Boppi waits. In `--once` mode, Boppi retries twice after short waits (at most 0.5 s and 1 s), then leaves the entry queued and exits 5.

`BOPPI_WATCH_PUSH_BACKOFF_MS` is for tests only. It replaces the 2 s base and scales `Retry-After` by the same factor. It does not turn pushing on.

### Refused token

On 401 or 403 the workspace no longer accepts the collector token: it was revoked or is wrong. Boppi then does the following:

1. Prints that the token was refused and that you create a new token on the **Collectors** page.
2. Deletes every queued entry for this origin and prints how many it deleted. With a new token, those entries would go to whichever collector that token belongs to.
3. Deletes the sent digest for this origin and token, so the next run with a working token pushes a fresh scan.
4. Closes the file watchers and timers, logs a `revoked` push line and a `stopped` line, and exits 6.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Sent, or unchanged. A long-running session stopped by Ctrl-C, `SIGTERM`, or `--duration` also exits 0, even when entries are still queued. The stop line gives the count. |
| 2 | Bad flags, no token without a terminal, an unusable `--log` or push store (for example a symbolic link), or an unsafe body with `--once`. |
| 3 | The baseline scan failed. |
| 5 | `--once` only: the workspace was unreachable or answered 429 or 5xx, and at least one entry is queued. |
| 6 | The token was refused (401 or 403), in `--once` mode or in a long-running session. |

## Log lines

With `--log`, each push decision appends one line:

```
{"kind":"push","at":"<ISO time>","outcome":"sent","digest":"sha256:<64 hex>","status":200,"snapshotId":"<id>","queued":0}
```

| Field | Meaning |
| --- | --- |
| `outcome` | `sent`: a new entry delivered on its first attempt. `flushed`: a queued entry delivered later. `unchanged`: digest equal, nothing sent. `queued`: a send failed and the entry waits; logged once per entry. `dropped`: entry removed after a 4xx, a cap, or an unsafe body. `revoked`: token refused. |
| `digest` | Digest of the entry, or `null` for an unsafe body |
| `status` | HTTP status, when there was a response |
| `snapshotId` | `snapshotId` from the response body, when the workspace returned one |
| `queued` | Entries queued for this origin after this decision |
| `reason`, `code`, `discarded` | Present on some `dropped` and `revoked` lines |

A periodic rescan that saw no change logs nothing. The baseline and each rescan that reported a change log `unchanged` when the digest is equal.

## Optional: run it as a user service

Boppi does not install, start, or recommend a background service. Founder decision D-21 keeps continuous push off by default in the beta, so the examples below are not recommended for beta testers. Use them only on your own machine, at your own decision. Each one stores your collector token in a file. Keep that file readable only by you, and revoke the token on the **Collectors** page when you stop.

### macOS launchd agent

Save as `~/Library/LaunchAgents/io.boppi.watch-push.plist` and set the mode to 0600. Replace the node path, the boppi path, and the token.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>io.boppi.watch-push</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/local/bin/node</string>
		<string>/usr/local/lib/node_modules/boppi/bin/boppi.js</string>
		<string>watch</string>
		<string>--push</string>
		<string>--log</string>
		<string>/Users/YOU/.boppi/watch-push.log</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict><key>BOPPI_TOKEN</key><string>bpc_REPLACE_ME</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
```

Load it with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.boppi.watch-push.plist`. `KeepAlive` restarts the agent after a failure but not after exit 0. Exit 6 (refused token) also restarts it, and each restart is refused again until you replace the token.

To remove it, run these commands:

```
launchctl bootout gui/$(id -u)/io.boppi.watch-push
rm ~/Library/LaunchAgents/io.boppi.watch-push.plist
```

### Linux systemd user unit

Save as `~/.config/systemd/user/boppi-watch-push.service` and set the mode to 0600. Replace the paths and the token.

```ini
[Unit]
Description=Boppi watch --push (user-run, not installed by Boppi)

[Service]
Environment=BOPPI_TOKEN=bpc_REPLACE_ME
ExecStart=/usr/bin/node /usr/lib/node_modules/boppi/bin/boppi.js watch --push --log %h/.boppi/watch-push.log
Restart=on-failure
RestartPreventExitStatus=2 6

[Install]
WantedBy=default.target
```

Start it with `systemctl --user daemon-reload && systemctl --user enable --now boppi-watch-push`. `RestartPreventExitStatus` stops restarts after a refused token (6) or bad flags (2).

To remove it, run these commands:

```
systemctl --user disable --now boppi-watch-push
rm ~/.config/systemd/user/boppi-watch-push.service
systemctl --user daemon-reload
```

`boppi uninstall` deletes `~/.boppi`, including the push queue. It does not remove a service file you created.
