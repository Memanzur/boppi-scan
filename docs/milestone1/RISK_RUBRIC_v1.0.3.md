# Boppi risk rubric 1.0.3

Status: implemented in analysis engine 1.1.0 (`src/engine/riskRubric.js`), scanner 0.4.0 local candidate. Version 1.0.1 followed an independent cross-model review of 1.0.0 on 2026-10-22 (findings in `ADJUDICATION.md`, rows 12 to 19). Version 1.0.2 (2026-10-23) applies the founder's instruction on production-access classification (open question 5 of 1.0.1: a name such as `cluster.viewer` is not proof of production access) and models Claude Code's built-in web tools (rows 20 to 23). Version 1.0.3 (2026-10-23) follows an independent cross-model review of 1.0.2 (rows 24 to 41): `WebFetch` and `WebSearch` are two grants, so a settings rule written for one is never asserted about the other, and `WebSearch` is untrusted content only, not an external destination; the agent band in the AGENTS table is pinned to the worst open finding or path on that agent; the changed rules are marked below. Not founder-approved: the founder asked that the rubric never be marked approved on their behalf, and the remaining open questions are listed at the end. Awaiting review by the founder and an external security reviewer (roadmap Phase 1 dependency). This document is the reviewable statement of the rule; the code and the corpus are the proof that the rule is what runs.

## What the rubric separates

Each exposure path reports four things that earlier versions folded into one word.

| Field | Meaning | Source |
| --- | --- | --- |
| `impact` | The worst case if every grant on the path were real and used. Set per template, never per machine. | Template severity (EP-A, EP-B, EP-C critical; EP-E, EP-F high; EP-D medium). |
| `priority` | What the report shows and sorts by. Impact stepped down by the weakest evidence on the path. Never stepped up. | This rubric. |
| evidence confidence | How well the scanner trusts the records it read (observed, imported, inferred). Shown as `evidence confidence 0.7`. | Per-record provenance, unchanged from engine 1.0. |
| likelihood | Whether anyone would exploit it. Always `not assessed`. Boppi does not model attackers. | Fixed text. |

A path also lists `facts` (what the configuration states), `assumptions` (what the rubric took for granted to keep the path), and `unknowns` (what was not checked). A critical or high result always names its facts.

## The step rule

A path is a set of branches (for EP-A: reads data that may be sensitive, can reach an external destination). Each branch is satisfied by one or more grants. Every grant is graded by counting steps; the branch takes its best grant (fewest steps); the path takes its worst branch; priority = impact stepped down by that many levels (critical, high, medium, low), capped at two steps.

| Strength | Steps | Meaning |
| --- | --- | --- |
| established | 0 | The configuration states it. |
| potential | 1 | A reasonable reading of the configuration, with one named assumption. |
| assumed | 2 | The scanner cannot tell; the path is kept so nothing is hidden, but it is not a finding of sensitive access. |

Environment words (`prod`, `staging`, `dev`, and so on) are read only from the server's entry name, its non-path arguments, and a url host. A launcher's file path or package name never names an environment (1.0.1).

The route the report draws is the one through the grant the rubric graded, so `based on:` always names a node on the printed chain (1.0.1).

Steps are added per grant:

| Condition | Steps | Reason recorded as |
| --- | --- | --- |
| Capability inferred from the server name only (no tool list, no catalog entry) | +1 | assumption |
| Capability from a tool name the running server advertised in a consented `boppi discover` tool list (`basis: advertised`, P3-4, additive in 1.0.3: no existing grade changes and it applies only after a discovery) | +0 | fact that the server lists the tool; the reason says what it does was not verified. An advertised name with no reach-table mapping creates no capability and is listed as "advertised, reach unknown"; a stored list is used only while the entry hash matches and it is younger than seven days, otherwise the report says it is stale |
| The client asks before each use of the tool (`prompted`) | +1 | assumption: a prompt could be approved |
| Prompting could not be checked (`unknown`, including unreadable settings and clients whose prompt setting is not read) | +1 | unknown |
| Tool denied in settings | no grant | the capability is removed from the graph |
| File access, scope is the home directory, a system directory, or a dotfile/secrets folder | +0 | fact |
| File access, scope is a source tree, or the category is read source code | +1 | assumption: treated as potentially sensitive |
| File access, scope is one ordinary folder, or scope unknown | +2 | unknown: sensitivity not established |
| Email, customer, financial, health, HR data categories | +0 | the category itself is sensitive |
| Production system, demonstrated: a tool list shows write verbs (`apply`, `delete`, `scale`, `exec`, `rollout`, and so on) and the configuration names a production environment | +0 | fact |
| Production system, inferred: write tools shown, nothing names the environment (`unknown`) | +1 | unknown: treated as production-capable |
| Production system, inferred: write tools shown, configuration names a non-production environment (1.0.1: was +2 fact) | +1 | assumption: which system it really points at was not checked |
| Production system, inferred: no tool list, but the permission's access level is write-shaped (`admin`, `write`, `broad`; the allowlist is `WRITE_SHAPED_LEVELS` in `securityGraph.js`) or it carries a `writeAccess` attribute (1.0.2) | +1 | unknown: the name and access level suggest production access; no tool list showed what it can change; the reason text also says whether the configuration names a production or non-production environment (1.0.3: the environment word was dropped from the text before; the step count is unchanged) |
| Production system, unknown: a name-only permission with read, unknown, or any other non-write-shaped access (`cluster.viewer`, `prod-readonly`, a `scoped` level) (1.0.2: was a production node graded high) | no production node | the record is kept in the inventory and listed in COVERAGE as "named like production access with no tool list behind it: treated as unknown, not as a production path" (`securityGraph.productionHints`, which discloses every flagged node whatever its type, 1.0.3). Reach: this tier applies to imported permissions (the control plane) and hand-built records. A local `boppi scan` never creates a name-only production permission, because the scanner only derives production reach from write-verb tool names (`toolCategories.toolReach`), so the COVERAGE sentence does not appear in a local scan today |
| Read-only cluster or infrastructure tools (`get`, `describe`, `logs`, `output`) (1.0.1: were dropped) | credential reach, +1 | unknown: they can read secrets, state, and logs; the role was not checked; a non-production name adds +1 |
| Credential known only by an environment variable name | +1 | assumption: value not read, may not be reachable |
| Credential by file scope (home, system, secrets folder) | +0 | fact: where credentials usually live |
| File tools denied in settings while the shell is allowed (1.0.1: the deny used to remove file reach) | shell keeps file reach at its own gate, home scope | fact: a shell reads any file the user can |
| Claude Code built-in `WebFetch`, prompted by default (1.0.2: was not modeled; 1.0.3: its own grant) | +1 | assumption: a prompt could be approved; the grant is both an external destination and untrusted content, so Claude Code with no MCP server at all carries EP-A (working-folder reads to the web) and EP-E (fetched content to the built-in shell) at one step down |
| Claude Code built-in `WebSearch`, prompted by default (1.0.3: was folded into one web grant with `WebFetch`, so an allow rule for `WebSearch` graded `WebFetch` as never prompting) | +1 | assumption: a prompt could be approved; the grant is untrusted content only. A search query is not treated as a destination the model can deliver data to (open question 7) |
| No grant traceable for a branch | 2 | the path is reported at assumed strength |

Two standing unknowns are attached to every path: no tool call, data transfer, or attack was observed; and whether the client asks before each MCP tool call was not checked. Built-in grants add: managed (machine-wide) permission settings were not read.

## Worked examples (from the frozen corpus)

| Case | Setup | Result | Why |
| --- | --- | --- | --- |
| L01 | filesystem server at `~/Documents/notes`, fetch | EP-A medium | one ordinary folder: sensitivity assumed (+2) |
| L04 | GitHub connector only | EP-A high | source reading is potential (+1); GitHub is the network exit |
| L09 | GitHub + cluster tools named staging | EP-C high | non-production named: a one-step assumption (1.0.1) |
| L17 | Claude Code, Read/Edit/Write denied, Bash allowed, fetch | EP-A critical | the shell still reads any file; Bash is allowed without a prompt (1.0.1) |
| H19 | cluster named prod with `kubectl_get`/`logs`, shell, fetch | EP-B high | read-only cluster tools are a credential reach whose role was not checked (+1) (1.0.1) |
| L10 | GitHub + cluster write tools, nothing named | EP-C high | environment unknown (+1) |
| N10 | Claude Code, no MCP server, default settings | EP-A high, EP-E medium | built-in Read never prompts in the working folder; WebFetch asks (+1) and is both the exit and the untrusted content (WebSearch is untrusted content only); Bash asks (+1) (1.0.2) |
| (unit test) | permission named `cluster.viewer`, read access, no tool list | no EP-C; listed as a production hint | a name is not proof of production access (1.0.2); the same record with `admin` access grades high |
| H01 | filesystem server at `~`, fetch | EP-A critical | home scope is established (+0) |
| H03 | GitHub + cluster tools named prod | EP-C critical | production named (+0) |
| H08 | 1Password-named server, shell, fetch | EP-B high | credential manager is name-inferred (+1) |
| N09 | Claude Code with Read, Edit, Write, Bash denied | no path | deny removes the grants |

## What this rubric does not claim

- It does not estimate likelihood. A critical priority means the configuration establishes every link of a high-impact chain, not that an attack is probable.
- It does not emulate the client's exact permission engine. Built-in grades read the settings files Boppi can see; managed settings, sandboxes, and unsupported modes are reported as unknowns.
- It does not lower a path because an alternative route exists. Every route is its own path; the fix text names what remains.
- A downgrade never hides a path. Assumed-strength paths stay in the report with their unknowns.
- The AGENTS table band is not a second scale (1.0.3). An agent's band is the worst open finding or exposure path on that agent (low when there is none), and the score is the engine's points within that band; a rule finding that an exposure path also covers is restated at the path's priority first. A machine whose every path is medium is a medium agent, and an agent with a critical path is a critical agent.
- A fix is described by what a rescan shows. Removing a server can close a path, lower it (the path stays open at a lower priority through what remains, typically a built-in tool), or change nothing; `boppi plan`, ROOT CAUSE, `boppi fix`, and `boppi verify` report all three, and every scan states what would stay open with every MCP server removed and which built-in tools hold it (1.0.2). Boppi never edits permission settings; it names where a deny rule would go.

## Corpus gate (regression, not a market accuracy claim)

`test/verify-rubric-corpus.js` runs 54 synthetic setups (15 negative, 20 limited, 19 high-impact; 17 held out; N10 moved from negative to limited when the web tools were modeled, so no Claude Code configuration at its defaults is a negative control any more). Labels are written before the rule they test is implemented. Four labels were corrected during the work (H15, L02, H08 under 1.0.0; L17 under 1.0.1), each logged in `DECISIONS.tsv` with its reason; a corrected case leaves the held-out split (L02 and L17 are now training cases), and L09 was re-adjudicated when the non-production rule changed. The suite fails on any mismatch (so it is a frozen-output regression test, not an accuracy measurement), on any critical on a negative control, and on held-out critical precision, critical recall, or high-or-critical recall below 90%. Result at 1.0.3 (unchanged from 1.0.2; the 1.0.3 rule changes alter no corpus label): 54 of 54 match; held out (17 cases): critical precision 5/5, critical recall 5/5, high-or-critical precision 21/21, high-or-critical recall 21/21; train (37 cases): 14/14, 14/14, 41/41, 41/41; 0 unjustified criticals. N10 (held out) was relabeled from no path to EP-A high, EP-E medium when the web tools were modeled, because its own text describes Claude Code's prompted WebFetch and WebSearch; the relabel is logged in `DECISIONS.tsv`. Five held-out critical predictions is a small denominator and is reported as such.

## Open review questions for the founder and security reviewer

Resolved in 1.0.2 on the founder's instruction: question 5 of 1.0.1 (a name such as `cluster.viewer` is not proof of production access; the three tiers above distinguish demonstrated permissions, inferred environments, and unknowns).

Still open; the current rule is the recommendation given in the 2026-10-22 review and stays until the founder decides otherwise:

1. Is +2 (two levels) the right penalty for an ordinary folder with network access? It makes "filesystem at a project folder plus fetch" medium. The alternative is +1 (high), which brings back the complaint that every developer machine is high. Recommended: keep +2, and add a names-only check for secret-marker files (`.env`, `*.pem`, `id_rsa`) in the folder as a later rubric version, with labels written first.
2. Should a prompted built-in shell (Bash with the default ask) be potential (+1, current) or assumed (+2)? Recommended: keep +1; users approve prompts routinely.
3. Should an unknown production environment (+1, current) be assumed (+2)? Recommended: keep +1; cluster write tools with no environment name are more often production than not. A staging name and no name both cost one step; the difference shows only in the reasons.
4. Should EP-D (explicitly unverified MCP server) stay medium impact, or rise when the server also reaches sensitive scope? Recommended: keep medium; the combination surfaces through EP-A.
6. (new in 1.0.2) With the web tools modeled, Claude Code at its default settings and no MCP server grades EP-A high when the working folder is the home directory or a source tree (medium for an ordinary folder) and EP-E medium. This follows the step rule (an unprompted read plus a prompted exit), and the report's `assumes:` line says the prompt is the assumption. The usability cost is that every Claude Code user sees a high path before adding any server. The alternatives are to grade a prompted built-in exit as assumed (+2, EP-A medium) or to keep the rule and lead the report with the built-in residual sentence, which already names the deny rule that removes it. Recommended: keep the rule (it is the same rule as question 2) and let the five-user comprehension sessions decide whether the wording carries it.

7. (new in 1.0.3) `WebSearch` is modeled as untrusted content only. A search query does leave the machine, but it reaches a search provider rather than a destination the model chooses, so it is not an exfiltration exit in this rubric; an allow rule for `WebSearch` therefore makes EP-E's untrusted-content step a fact but leaves EP-A at the prompted `WebFetch` tier. The alternative is to count the query as a weak exit (+1 on its own, which would put EP-A at the same tier as `WebFetch` and bring back the 1.0.2 defect in a milder form). Recommended: keep the current modeling and say so in the path's reasons.

Changing any answer bumps the rubric version and reruns the corpus; labels that depend on the changed rule are re-adjudicated and logged.
