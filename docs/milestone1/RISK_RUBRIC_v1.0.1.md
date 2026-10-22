# Boppi risk rubric 1.0.1

Status: implemented in analysis engine 1.1.0 (`src/engine/riskRubric.js`), scanner 0.4.0 local candidate. Version 1.0.1 follows an independent cross-model review of 1.0.0 on 2026-10-22 (findings in `ADJUDICATION.md`, rows 12 to 19); the changed rules are marked below. Awaiting review by the founder and an external security reviewer (roadmap Phase 1 dependency). This document is the reviewable statement of the rule; the code and the corpus are the proof that the rule is what runs.

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
| The client asks before each use of the tool (`prompted`) | +1 | assumption: a prompt could be approved |
| Prompting could not be checked (`unknown`, including unreadable settings and clients whose prompt setting is not read) | +1 | unknown |
| Tool denied in settings | no grant | the capability is removed from the graph |
| File access, scope is the home directory, a system directory, or a dotfile/secrets folder | +0 | fact |
| File access, scope is a source tree, or the category is read source code | +1 | assumption: treated as potentially sensitive |
| File access, scope is one ordinary folder, or scope unknown | +2 | unknown: sensitivity not established |
| Email, customer, financial, health, HR data categories | +0 | the category itself is sensitive |
| Production system, a tool list showed write tools and the configuration names a production environment | +0 | fact |
| Production system, nothing names the environment (`unknown`) | +1 | unknown: treated as production-capable |
| Production system, configuration names a non-production environment (1.0.1: was +2 fact) | +1 | assumption: which system it really points at was not checked |
| Production system named by a permission with no tool list behind it (1.0.1: was +0) | +1 | unknown: what it can change was not shown |
| Read-only cluster or infrastructure tools (`get`, `describe`, `logs`, `output`) (1.0.1: were dropped) | credential reach, +1 | unknown: they can read secrets, state, and logs; the role was not checked; a non-production name adds +1 |
| Credential known only by an environment variable name | +1 | assumption: value not read, may not be reachable |
| Credential by file scope (home, system, secrets folder) | +0 | fact: where credentials usually live |
| File tools denied in settings while the shell is allowed (1.0.1: the deny used to remove file reach) | shell keeps file reach at its own gate, home scope | fact: a shell reads any file the user can |
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
| H01 | filesystem server at `~`, fetch | EP-A critical | home scope is established (+0) |
| H03 | GitHub + cluster tools named prod | EP-C critical | production named (+0) |
| H08 | 1Password-named server, shell, fetch | EP-B high | credential manager is name-inferred (+1) |
| N09 | Claude Code with Read, Edit, Write, Bash denied | no path | deny removes the grants |

## What this rubric does not claim

- It does not estimate likelihood. A critical priority means the configuration establishes every link of a high-impact chain, not that an attack is probable.
- It does not emulate the client's exact permission engine. Built-in grades read the settings files Boppi can see; managed settings, sandboxes, and unsupported modes are reported as unknowns.
- It does not lower a path because an alternative route exists. Every route is its own path; the fix text names what remains.
- A downgrade never hides a path. Assumed-strength paths stay in the report with their unknowns.

## Corpus gate (regression, not a market accuracy claim)

`test/verify-rubric-corpus.js` runs 54 synthetic setups (16 negative, 19 limited, 19 high-impact; 17 held out). Labels are written before the rule they test is implemented. Four labels were corrected during the work (H15, L02, H08 under 1.0.0; L17 under 1.0.1), each logged in `DECISIONS.tsv` with its reason; a corrected case leaves the held-out split (L02 and L17 are now training cases), and L09 was re-adjudicated when the non-production rule changed. The suite fails on any mismatch (so it is a frozen-output regression test, not an accuracy measurement), on any critical on a negative control, and on held-out critical precision, critical recall, or high-or-critical recall below 90%. Result at 1.0.1: 54 of 54 match; held-out critical precision 5/5 and recall 5/5, high-or-critical recall 20/20; 0 unjustified criticals. Five held-out critical predictions is a small denominator and is reported as such.

## Open review questions for the founder and security reviewer

1. Is +2 (two levels) the right penalty for an ordinary folder with network access? It makes "filesystem at a project folder plus fetch" medium. The alternative is +1 (high), which brings back the complaint that every developer machine is high.
2. Should a prompted built-in shell (Bash with the default ask) be potential (+1, current) or assumed (+2)? Current reasoning: users approve prompts routinely.
3. Should an unknown production environment (+1, current) be assumed (+2)? Current reasoning: cluster write tools with no environment name are more often production than not. Under 1.0.1 a staging name and no name both cost one step; the difference shows only in the reasons.
5. `cluster.viewer` style permission names still normalize to a production system (now graded high with an unknown, not critical). Should name-only production permissions normalize at all without a tool list?
4. Should EP-D (explicitly unverified MCP server) stay medium impact, or rise when the server also reaches sensitive scope? Currently the combination surfaces through EP-A.

Changing any answer bumps the rubric version and reruns the corpus; labels that depend on the changed rule are re-adjudicated and logged.
