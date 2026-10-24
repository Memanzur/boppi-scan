# Rubric 1.0.3: the six open questions in plain English

Written 2026-10-23 for the founder and the external security reviewer. Companion to `RISK_RUBRIC_v1.0.3.md`, which is the reviewable rule. Status of the rubric: implemented, tested, **not approved**. No agent may mark it approved; only a written answer from the founder closes a question, and only the founder's and the reviewer's sign-off closes ledger row P1-9.

Each question below says what Boppi does today, what the alternative would do, what a tester would notice under each choice, and the recommendation. The recommendation is advice, not a decision. A decision that changes grading requires rubric 1.0.4, a rerun of the 54-case corpus, and adjudication of affected labels (logged in `DECISIONS.tsv`). Accepting an existing rule does not itself change the version.

## How the grades work, in one paragraph

Every exposure path starts at its template's worst-case impact. Each access grant receives zero, one or two evidence steps. Each branch uses its strongest supporting grant; the path uses its weakest branch, and drops that many grade levels, capped at two. Boppi does not simply add every assumption on the whole path. Every path prints facts, assumptions and unknowns; the priority is not an estimate of attack likelihood. The questions below ask how particular grants should be graded.

## Question 1: a project folder plus network access

**Today.** When an MCP server can read one ordinary folder (a project directory, not the home folder, not a secrets folder) and another server can reach the internet, Boppi counts two assumptions, because it cannot tell whether that folder holds anything sensitive. The path shows as **medium**.

**Alternative.** Count one assumption and show **high**.

**What a tester would notice.** Under today's rule, "filesystem at my project folder plus fetch" is medium and reads as "worth knowing, not urgent". Under the alternative, almost every developer machine shows a high path on its first scan, which is the complaint that started Milestone 1.

**Risk of keeping today's rule.** A project folder that holds a `.env` file or a private key is under-rated until Boppi can see that such files exist.

**Recommendation.** Keep medium. Then approve the follow-up already listed as ledger row P1-11: a names-only check for secret-marker files (`.env`, `*.pem`, `id_rsa`) in the folder, which would remove one assumption when such a name is present. Labels for that rule are written before the code, as with every rubric change.

## Question 2: the built-in shell that asks before running

**Today.** Boppi models Claude Code's default Bash grant as prompted, subject to the settings it can read. It counts that modeled prompt as one assumption ("a prompt could be approved"), so a path through Bash is one level below its worst case.

**Alternative.** Count two assumptions, on the reasoning that a prompt is a real control.

**What a tester would notice.** Today, a Claude Code setup with a web-capable server shows a high path through the shell. Under the alternative it would show medium.

**Risk of keeping today's rule.** Users who really do read every prompt see a grade they consider too harsh.

**Risk of the alternative.** Users approve prompts routinely, especially in long sessions. Treating a prompt as a strong control would hide a real route.

**Recommendation.** Keep one assumption. This is the same judgement as question 6, so answer them together.

## Question 3: cluster write tools with no environment name

**Today.** When a server exposes cluster write tools (`apply`, `delete`, `scale`, and so on) and nothing in the configuration says which environment it points at, Boppi counts one assumption and labels the unknown. A cluster explicitly named "staging" also costs one assumption; the difference shows only in the printed reason.

**Alternative.** Count two assumptions for an unnamed environment.

**What a tester would notice.** Today an unnamed cluster with write tools is a high path. Under the alternative it would be medium.

**Recommendation.** Keep one assumption. The report names the unverified environment. There is no field prevalence measurement supporting a stronger claim.

## Question 4: an explicitly unverified MCP server

**Today.** Template EP-D ("this server is explicitly marked unverified") has a medium worst case regardless of what else the server can reach.

**Alternative.** Raise the worst case when the same server also reaches sensitive scope.

**What a tester would notice.** No change in most reports, because a server that reaches sensitive data and the network already appears through the EP-A template at its own grade.

**Recommendation.** Keep medium. The combination is already covered; raising EP-D would print the same risk twice at two grades.

## Question 6: Claude Code with no MCP server at all

**Today.** Since the web tools were modeled (rubric 1.0.2), a Claude Code installation with default settings and no MCP server shows an EP-A path: the built-in Read tool never prompts inside the working folder, and WebFetch (which prompts) is an exit. In the home folder or a source tree the path is **high**; in an ordinary folder it is medium. A second path, EP-E (fetched web content reaching the shell), is medium. The report's `assumes:` line says the prompt is the assumption, and the residual sentence names the settings deny rule that would remove it.

**Alternative A.** Count a prompted built-in exit as two assumptions, which makes EP-A medium everywhere.

**Alternative B.** Keep the rule and lead the report with the residual sentence, so the first thing a user reads is "this stays open through the built-in tools, and here is the deny rule".

**What a tester would notice.** This is the most visible consequence of the rubric: a default Claude Code scan in a home folder or source tree can show a high path before any server is added. The prepared 0.4.0 usability kit includes `generic-critical` as a challenge case; it does not prove every default setup has this grade.

**Risk of keeping today's rule.** Testers may dismiss the product as alarmist before they reach a server-specific finding.

**Risk of alternative A.** It is the same rule as question 2 applied to a different tool; grading the two differently would need a reason the rubric cannot give.

**Recommendation.** Keep the rule for the usability sessions and let the sessions decide the wording. If three or more of the five participants reject the bare Claude Code high as wrong rather than as surprising, revisit as alternative A together with question 2. Alternative B costs nothing and can be adopted at any time as a wording change.

## Question 7: is a web search an exit?

**Today.** `WebSearch` is modeled as a source of untrusted content only. A search query does leave the machine, but it goes to a search provider rather than to a destination the model chooses, so it does not count as a way to send data out. `WebFetch` remains the prompted exit.

**Alternative.** Count the query as a weak exit (one assumption), which would make EP-A through WebSearch the same grade as through WebFetch.

**What a tester would notice.** Today an allow rule for WebSearch alone changes EP-E (untrusted content reaches the shell) but not EP-A. Under the alternative, allowing WebSearch would create a high EP-A path on its own.

**Recommendation.** Keep today's modeling and keep saying so in the path's reasons. A query can carry data, so the alternative is defensible, but it brings back a milder form of the 1.0.2 defect where one allow rule was asserted about a different tool.

## How to answer

Reply with the question number and one of: keep, change to the named alternative, or a different rule stated in a sentence. For the sign-off itself (ledger P1-9) the two needed statements are "rubric 1.0.3 approved by the founder on <date>" and the external reviewer's equivalent, each written by that person. Until both exist the rubric document keeps its "Not founder-approved" status line.
