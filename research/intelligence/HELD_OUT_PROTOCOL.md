# Held-out labeling protocol (C-2)

Written 2026-10-27, before any held-out label exists. It fixes the gap the 2026-10-27 audit found: every current "held-out" set reuses development identities, so a rule that fits development passes by construction. The synthetic fixture's `held-*` rows are the development subjects and versions. The dashboard's held-out cases repeat development tool names. Both stay as mechanism tests and are not evidence of accuracy.

This file covers tooling and process only. Producing real labels needs human labelers, and using their numbers needs founder sign-off on the rubric. Both are founder gates, and nothing here clears them.

## 1. Split by server identity

`heldout.mjs` splits the 200-package corpus in `../capability-map/corpus/index.json`. The frozen result is `heldout-split-v1.json`.

- Identity. Two packages share an identity when they share an npm scope (same publisher) or a name stem. A stem is the name with MCP role words (`mcp`, `server`, `modelcontextprotocol`) and separators removed. The scope also counts as a stem, so `clerk` and `@clerk/mcp-tools` stay together. Under a scope, a name that is only a role word (`@azure/mcp`, `@x/cli`) adds no stem of its own. Packages connected through any shared key form one identity group, and a group always lands on one side.
- Contamination. The 50 packages labeled in V1 were read while rules were being built. Their groups are pinned to development.
- Draw. A group goes to held-out when `sha256("<seed>:<first member name>")`, read as a fraction, is below 30%. The draw ignores input order and does not depend on what any rule predicts. Seed `20261028`.
- Freeze. `node research/intelligence/heldout.mjs --check` recomputes the split and compares it with the frozen file. `--write` refuses to overwrite it. Changing the corpus, the seed or the identity rule needs a new `heldout-split-v2.json`, and v1 results stay reported.
- Result. 35 held-out identities (38 packages) and 125 development identities (162 packages). No held-out package shares a scope or stem with development.
- Known over-grouping. Shared generic stems can join unrelated publishers. For example, `docs` joins `@mastra/mcp-docs-server` with the `@transcend-io` family. Over-grouping only moves packages to one side together, so it can shrink held-out but never leak across the split.

The inspector V2 split in `../capability-map/v2/split.json` stays frozen for V2. 11 of the 38 packages are in both held-out sets. This split is for capability rules and overlay claims, not for re-scoring V2.

## 2. Who labels

- At least two humans label each held-out package independently, and each produces their own file. A Claude, Codex or other agent label cannot count as held-out, and `validateHeldOutLabels` refuses agent names. A machine check cannot prove the work was done by a human, so the founder confirms each labeler's identity when the files come in.
- Labelers must not have written or tuned the rules under test.
- Each labeler works from the extracted package source only and follows `../capability-map/LABELING.md`: one exact evidence line (file, line, verbatim text) per positive category, plus `serverShape`, and `unknown` when the code can't be read.

## 3. Blinding

Before labeling, each labeler attests in their file that they:

- did not see inspector or overlay output for these packages (`sawInspectorOutput: false`)
- did not see the development rules or candidate claims (`sawDevelopmentRules: false`)
- did not run any script under `research/` (`ranResearchScripts: false`)
- did not see the other labeler's file (`sawOtherLabelersFile: false`)

The file also names the split digest it was labeled against. A file for a different split, a package outside held-out, or a version or content hash that differs from the frozen corpus is refused.

## 4. Disagreement

`compareLabelers` lists every package where the two files differ in categories, `serverShape` or `unknown`. A third person settles each disagreement by reading the cited lines, and records the decision with a reason. Disagreements are never averaged or majority-voted away. The raw agreement count goes in the report next to the final numbers.

## 5. Evaluation

- A rule or claim set is frozen (by a commit) before held-out labels are opened for scoring. The held-out evaluation runs once against that commit. Any later change is a new version that needs a new held-out draw.
- Scoring follows `../capability-map/v2/PROTOCOL.md`. CONFIRMED against a positive label is a true positive. CONFIRMED against a negative is a false positive. NOT_OBSERVED against a positive is a false negative. UNKNOWN is excluded from precision and also reported as a miss.
- Exact-version package claims (the overlay format) cannot predict an identity they never saw, so on an identity-disjoint held-out set they score zero recall by design. This protocol measures whether a rule generalizes to new servers. Checking a per-package claim means a human labels that same package version blind, and the claim's own evidence can't count as that label.

## 6. Founder gates this does not clear

- Recruiting and naming the human labelers.
- Rubric sign-off for what each category means (rubric 1.0.3 is not approved).
- Deciding that any held-out number is good enough to move a claim past `experimental`.
- Any use of customer or tester data. This corpus is public npm packages only.
