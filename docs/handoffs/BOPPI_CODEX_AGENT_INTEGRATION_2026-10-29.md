# JIT/platform Agent integration — 2026-10-29

Isolated branch `codex/enterprise-recovery-2026-10-29` starts at primary scanner 7f69ed9 and integrates `claude/jit-device` 922e0a6. Original worktrees and primary branch remain intact.

Resolved `src/cli/boppi.js` so leases expire offline before normal commands, hooks retain their separate gate behavior, and the current platform branch's WSL hint and update notice still execute once. Resolved `src/cli/uninstall.js` by preserving both platform-aware config handling and the live-JIT-grant uninstall refusal. Other merges were reviewed through the full tests.

Fresh `npm test`: **60 of 60 suites passed**, including `verify-jit.js` (75 checks), platform/discovery/safe-write/connector/narrow/rollback/privacy suites. Zero runtime dependencies retained. This is a local macOS test run, not proof of a remote Windows CI run.

This integrated source is being used as the synthetic device for the Cloud integration journey, on a disposable loopback stack. No personal configurations, untrusted MCP execution, real device pairing or persistent service installation. JIT leases remain unsigned; removal from configuration does not stop an already running client process; offline cleanup requires an invocation or foreground watch. These limitations still prevent a full public-readiness claim.
