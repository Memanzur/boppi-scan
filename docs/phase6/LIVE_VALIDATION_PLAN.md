# Live validation: one consented Claude Code session

Written 2026-10-23. **Prepared, not run.** This is a founder-run procedure, not authorization to install hooks or start a real session. Human sessions completed: 0.

## Compatibility facts and open observations

The [official hooks reference](https://code.claude.com/docs/en/hooks#permissiondenied), checked 2026-10-23, limits `PermissionDenied` to auto mode; manual rejection and deny rules do not trigger it. A deny-rule exercise cannot establish denied-event coverage. The same reference says cancelling a running tool need not produce `PostToolUseFailure`. Record what this installed version reports; missing outcomes remain unknown. The [CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags) documents `--strict-mcp-config` for restricting MCP servers to an explicit file.

| Check | Observation to record | Acceptance |
| --- | --- | --- |
| L1 payload and pairing | Successful calls, paired outcomes, uncorrelated/orphan counters, source if supplied | Successful calls pair; unsupported source fields stay explicitly unknown |
| L2 denial visibility | Deny-rule behavior and whether an event exists | Record the gap; do not call absent events evidence that no denial occurred. Auto-mode denial coverage remains untested unless a separately consented safe exercise produces one |
| L3 error result | Outcome for `error_tool` (`isError: true`) | Reports error; otherwise reopen response-shape support |
| L4 interruption | Outcome, or missing outcome, after interrupting `slow_tool` | Record it; absence stays unknown, never ok |
| L5 name normalization | Names from `/mcp`, events and scan for both fixture entries | No calls credited to the wrong server; known split/normalization limits remain open when observed |
| L6 availability and latency | Whether allowed calls complete, health counters, separately measured hook-process latency | No blocking attributable to the hook. Latency unmeasured unless individual hook execution durations are recorded; model round-trip timing cannot prove a hook p95 |

These are observations of one machine/version. They establish no tool effects, field accuracy, cloud transport, or other-client support. Do not mark all six passed when an exercise was unavailable.

## Consent and isolation

The device owner reads and initials:

> I consent to a test-project hook that stores event/time, server/tool/source, keyed session/call hashes, a working-folder fingerprint, duration and outcome in this test project's isolated event home. It persists no prompt, tool input/output, error text, transcript path, or file contents. Boppi uploads none of these records. Claude Code itself uses its normal model service and may keep its own session history. I can stop the session and remove the project hook. At the end I will review the summary, keep only the evidence I approve, and delete only this check's event records.

Do not use `--dangerously-skip-permissions` for the check. Do not edit global settings or run an unqualified `hook --forget`: that would target existing Boppi history. This plan never deletes it.

## Preparation (typed by the founder)

Record `claude --version`, scanner `git rev-parse HEAD`, date and consent. First run `node test/verify-live-check-fixture.js` in the scanner checkout (7 synthetic checks).

Create a **new** test project; refuse to overwrite an earlier one:

```sh
mkdir ~/Desktop/boppi-live-check
cd ~/Desktop/boppi-live-check
mkdir .claude event-home
cat > .mcp.json <<'JSON'
{"mcpServers":{
  "live.check":{"command":"node","args":["/Users/melodymanzur/Desktop/boppi-scan-auto/test/fixtures/mcp-servers/live-check.js"]},
  "live__check":{"command":"node","args":["/Users/melodymanzur/Desktop/boppi-scan-auto/test/fixtures/mcp-servers/live-check.js"]}
}}
JSON
node ~/Desktop/boppi-scan-auto/bin/boppi.js hook --print-config
```

Paste the printed `hooks` block into the project's new `.claude/settings.json`. In **every** hook entry replace `boppi hook` with:

```text
node /Users/melodymanzur/Desktop/boppi-scan-auto/bin/boppi.js hook --home /Users/melodymanzur/Desktop/boppi-live-check/event-home
```

Keep the matcher and timeout. Read the final file before launching. Never install this block in user settings. Check your installed client's `claude --help` supports the isolation flags below; stop if it does not.

```sh
claude --permission-mode default --setting-sources project --strict-mcp-config --mcp-config .mcp.json
```

In `/mcp` verify only the two fixture servers are available, and in `/hooks` verify the project hooks target `event-home`. Stop if unrelated servers or hooks are active. Managed policy may still affect the session; record it and stop if isolation cannot be established. Only request the fixture tools; approve allowed calls individually.

## Exercise

1. Record the server/tool names listed by `/mcp`.
2. Request `ok_tool` on each server, then `error_tool` on each. Record which calls actually ran.
3. Request `slow_tool` and press Escape within two seconds. Record the interruption without assuming which hook will fire.
4. Exit. Add a deny rule for one fixture `error_tool` using the exact name shown by this client. Restart with the same launch command; attempt that tool and record whether it was blocked. This is a deny-rule control, **not** a `PermissionDenied` trigger test. Remove the rule afterward. Do not switch to auto mode or invent risky actions to force a denial.
5. Optionally request ten sequential `ok_tool` calls to check completion. Record end-to-end time only as user-perceived latency; it cannot measure the hook's overhead.
6. Exit, then read the isolated records:

   ```sh
   node ~/Desktop/boppi-scan-auto/bin/boppi.js events --home ~/Desktop/boppi-live-check/event-home --json ~/Desktop/boppi-live-check/events-summary.json
   node ~/Desktop/boppi-scan-auto/bin/boppi.js events --home ~/Desktop/boppi-live-check/event-home
   node ~/Desktop/boppi-scan-auto/bin/boppi.js scan --config ~/Desktop/boppi-live-check/.mcp.json --source claude-code --home ~/Desktop/boppi-live-check/event-home --cwd ~/Desktop/boppi-live-check
   ```

Compare event names/outcomes and each server's `runtime:` line. Retain only the summary and observations the owner has reviewed. Do not attach raw hook payloads, Claude transcripts or debug logs to a repository.

## Cleanup and stop conditions

Stop if a non-fixture tool is requested, an unrelated server appears, the hook blocks a call, or input/output text appears in event records. A blocked call with no outcome is a coverage gap to report, not grounds to relax the permission rule.

After the owner reviews the summary, remove the project's hook block and deny rule. Delete this check's raw events only:

```sh
node ~/Desktop/boppi-scan-auto/bin/boppi.js hook --forget --home ~/Desktop/boppi-live-check/event-home
```

The isolated fingerprint key and test files remain until the owner chooses to remove the test folder. Global Boppi records remain untouched.

## Recording sheet

Copy to `LIVE_CHECK_<date>.md` only after the session, omitting private identifiers:

```text
Date / Claude Code version / scanner commit:
Consent initialed / isolation flags and hooks reviewed:
Final project snippet / deny rule:
/mcp names and tools:
L1 paired / uncorrelated / orphan counts / source availability:
L2 blocked-by-rule result / event availability (auto mode untested):
L3 error outcome:
L4 interruption outcome or unknown:
L5 events and scan attribution for each server:
L6 calls completed / health counters / latency unmeasured or method and samples:
Per check: pass / partial / fail / not exercised, with reason:
Summary reviewed / project hook removed / isolated --forget run:
```

File any limitation against `RUNTIME_COLLECTOR.md` and log it in `DECISIONS.tsv`. A synthetic fixture passing or a procedure being written never closes P6-1's live check.
