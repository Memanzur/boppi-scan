# Phase 7 feasibility spike: suspicious-prompt investigation

Status: document only (ledger P7-1), written 2026-10-23. No prompt content is read, stored, or analyzed by any shipped command. This note answers the spike's one question: which content sources the supported runtime can actually show Boppi, and therefore what a Phase 7 implementation could honestly claim.

## What the supported runtime exposes (Claude Code hooks, docs read 2026-10-23)

| Source | Hook event and field | Observable? | Consent needed to read it | What it does not show |
| --- | --- | --- | --- | --- |
| The user's submitted prompt | `UserPromptSubmit`, field `prompt` (with `prompt_id`, `session_id`) | Yes, exact text at submission | Separate, explicit content consent; Boppi's hook today refuses this event (`unsupported_event` health counter) | Nothing the model added later; system instructions; CLAUDE.md or memory text loaded by the client |
| Tool arguments the model chose | `PreToolUse`, field `tool_input` | Yes, per call, with `tool_use_id` | Content consent; today discarded | Why the model chose them |
| Tool results | `PostToolUse`, field `tool_response` | Yes for supported tools, structured, per call | Content consent; today discarded | Results of tools that ran outside Claude Code; MCP results are whatever the server returned, possibly already truncated by the client |
| Tool failures and denials | `PostToolUseFailure` `error`, `PermissionDenied` `reason` | Yes (text) | Content consent; today reduced to an outcome word | Partial results |
| The transcript | common field `transcript_path` | Readable from disk | Never read by Boppi (roadmap: do not silently read transcripts); would need its own consent and a parser pinned to the client version | Anything compacted away |
| Web page or email content the agent read | Only as a `tool_response` of the fetching tool | Only when the fetch went through a hook-visible tool | Content consent plus a content-source adapter per tool | Content fetched by a server-side tool the client does not route through hooks |
| System prompt, loaded instructions | `InstructionsLoaded` event exists in the docs | Metadata only (that instructions were loaded) | Not planned | The text |

Conclusion of the spike: the runtime can show the submitted prompt and every hook-visible tool input and result, each with a `tool_use_id` or `prompt_id` for correlation. It cannot show indirect injection that arrived through a channel the client does not route through hooks, and it cannot show system or loaded instructions. A Phase 7 implementation is feasible for direct prompts and for tool results of hook-visible tools, and must label everything else uninspected.

## Proposed design, bounded to what the runtime shows

1. Two separately enabled captures, both off by default and both refused by the shipped hook: `boppi hook --content prompts` (reads `UserPromptSubmit`) and `boppi hook --content tool-results` (reads `PostToolUse` responses of MCP tools). Enabling prints what will be read, where analysis runs (locally, in the hook process), what is kept (reason codes, source type, correlation ids, and nothing else unless the user approves a redacted excerpt), and how to stop and delete.
2. Analysis is local, transient, and deterministic first: a fixed indicator set (instruction-shaped text addressed to the agent, requests to ignore prior instructions, requests to read or send credentials or files, encoded or obfuscated commands, role claims), each producing a reason code, never a verdict of "attack". The record stores `{reason codes, source type, prompt_id or invocation, session, at}`; the content itself is dropped at the end of the hook process. The health counters and the `boppi events` timeline already carry the ids this joins on.
3. A benign quotation is not an observed attack: the indicator set only ever labels text "contains instruction-shaped content" and the timeline shows what the agent then did (from Phase 6 outcomes) as a separate column. "Possibly related" is the strongest causal label when only time proximity links a prompt to a call; a shared `prompt_id` or `tool_use_id` is required for "in this turn".
4. Excerpts: an analyst can ask for a redacted excerpt around an indicator; the excerpt is produced from the live source at request time only if the user approves, and is stored only then, bounded to 240 characters with credentials masked.
5. Any model-assisted analysis is a later, optional component with no tools, no credentials, no command execution, and no access to data outside the one text being classified. It is not in the first slice.
6. Metadata-only mode (today's default) states on the timeline that prompt analysis is unavailable and never produces a content verdict.

## Acceptance plan (not run)

- A frozen labeled corpus of at least 30 benign and 30 suspicious synthetic samples (quoted instructions, developer security tests, direct requests, indirect tool-result attacks, at least three languages) under `test/fixtures/prompts/`, labeled before the indicators are written, with the same adjudication rule the rubric corpus uses.
- Report precision, recall, and the count of unsupported sources per run; pilot target 90% precision and 80% recall in scope; every disagreement reviewed; no claim of universal detection.
- Ten synthetic investigations with missing ids, concurrent prompts, and out-of-order events; the renderer must never assert a causal link without a shared id.
- Canary tests that default mode leaves no prompt content on disk, in logs, or in any push payload; that disable and forget work; that excerpts are absent until approved.

## Stop conditions

Re-scope if a supported client version removes `prompt_id` or `tool_use_id`, if `tool_response` stops carrying MCP results, or if the founder does not approve a content-consent flow. Nothing in this note authorizes reading prompts.
