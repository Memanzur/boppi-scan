# Detection evaluation

The corpus in `test/corpus/manifest.json` is the labeled set for critical findings. `node test/eval-corpus.js` scans every case locally, with no network, and prints precision and recall per severity, recall of planted combinations, and the p95 scan time. CI runs it as part of `npm test`. The gate fails when critical precision is below 0.80, when recall of planted combinations is below 0.80, or when p95 is 5 seconds or more.

A case is one agent config. It is predicted at a severity when an open finding or an exposure path has that severity. Precision is predicted cases that carry the label, divided by predicted cases. Recall is predicted cases that carry the label, divided by labeled cases. Planted-combo recall counts only cases marked `plantedCombo`. Critical findings and critical paths are also counted separately as finding precision.

Labels were set from the rule below, not from a model judge. A case is critical when its servers are a cross-server combination, or a declared tool combination, that the product should call critical: execution with credentials and network, shell with files and untrusted content, or files with a non-loopback destination. Lookalike names are not critical. Disabled entries are configs in the count and are not servers. The critical labels were not edited after the gate was measured. High was added on two planted cases that also produce the existing privilege path (untrusted content with code execution). Medium was added on the Cursor probe because its privilege path is recorded one step lower.

## What can be critical

A critical rule still composes capabilities across servers. Each leg has to be observed or a catalog hit. Observed means a tool name on the tool list, a capability the config already states, a directory argument that exists, or an `http` or `https` URL whose host is not loopback. A catalog hit is a package, image, command, or official host in `src/cli/mcpCatalog.json` after identity normalization.

Normalization strips registry prefixes (`ghcr.io/`, `docker.io/`), npm scopes, and version suffixes (`@latest`, `@1.2.3`, `==1.2.3`, image tags). It then removes the affixes `mcp-server-`, `server-`, `-mcp-server`, `-mcp`, and `-server`. `brave-search`, `@brave/brave-search-mcp-server@latest`, and `1password-mcp@1.2.3` resolve. `research-notes` does not, because `search` is not its own hyphen token. `github-stars-cache` does not, because `stars` and `cache` are not affixes.

The catalog has one row per public server, with a citation to the official servers repo, the archived servers repo, a vendor README, or the MCP registry record that was fetched on 2026-11-19. Roles cover command servers (`mcp-server-commands`), Kubernetes (`kubernetes-mcp-server`, pod exec and kubeconfig), databases (sqlite, postgres, redis, mongodb, mysql, mssql), SaaS data (Notion, Slack, Drive, GitHub repos, Linear, Jira, Confluence), Stripe as payments and production, password managers, browser automation, and Desktop Commander as shell plus filesystem. Official hosts include `mcp.notion.com`, `mcp.slack.com`, `mcp.stripe.com`, `mcp.atlassian.com`, and `api.githubcopilot.com`.

Anything the catalog does not claim, including `price-fetch` and the argument text `shell,read_secrets,send_slack`, stays grade `substring` at confidence 0.35. That is under the 0.40 bar for critical, high, and medium rules. A loopback URL is not network access.

## Severity

Shell or code execution with prompting left on, and with no outbound leg and no untrusted ingestion, is high (AE-010). A shell can read files, write files, and start processes, so it is more than a scoped directory, but that config does not show a path off the machine.

R&D decided that the same shell or command execution is critical when it is combined with any one of these (AE-009):

- An outbound leg: network, browser, or messaging send (Slack send, email send).
- Untrusted content ingestion: fetch, browser, email, or an issue tracker (Jira, Linear, Confluence).
- An approval bypass that turns prompting off: a Cline `autoApprove` list, Claude Code `permissions.defaultMode` `bypassPermissions`, Codex `approval_policy` `never`, or Cursor CLI `approvalMode` `unrestricted` (the persisted yolo / run-everything mode, documented at https://cursor.com/docs/cli/reference/configuration).

A database or SaaS catalog role is a sensitive read, not a network leg. The connection to Postgres, Notion, Drive, GitHub, or Confluence is how the agent reads that service. It is not, by itself, a way to send that service's data somewhere else. Sensitive read plus an outbound leg is critical exfiltration (AE-011). The outbound leg is fetch, a browser, messaging send, or a shell, and it has to be a separate capability from the data connection. A single SaaS server that can read and send inside the same vendor workspace is high (AE-013), not critical. Default hosted Slack, with no tool list, is that case. Critical requires a cross-boundary chain: the read leaving to a different destination, or a shell or code interpreter plus network, untrusted content, or an approval bypass. Slack plus fetch, a browser, or a shell stays critical. A declared tool list with no send or write name, or `read_only=true` / `--readOnly`, drops the send. A database alone, or Notion alone, stays medium (AE-008).

A sensitive read plus untrusted content on a different server, such as Jira, or plus an approval bypass with no shell, is critical (AE-014). That covers Claude Code `bypassPermissions`, Codex `approval_policy` `never`, and Cursor `approvalMode` `unrestricted`. The database or SaaS permission stays in the finding. Adding the issue tracker or turning prompting off raises that finding. Jira alone stays a medium sensitive read.

Local files plus a non-loopback MCP host are still critical (AE-012), including when that host's catalog role is a data read. The host is a destination for the files. The same rule covers local files plus a remote repository write. The GitHub server is that destination in every command form: the npx package `@modelcontextprotocol/server-github`, the image `ghcr.io/github/github-mcp-server`, and the host `api.githubcopilot.com`. The GitHub server alone stays medium. A local git server (`mcp-server-git`, role `source-local`) is not that destination. A loopback URL is not. The reference `everything` server is a protocol fixture, role `reference`, and grants nothing.

A file grant rooted at `/` or the home directory is high (AE-006) because the blast radius is the whole user environment. A single scoped directory, a password manager, or a data store with no outbound leg and no command execution is medium (AE-008). AE-006 no longer fires because the capability string contains the word filesystem.

Declared tools: `run_bash`, `bash`, `execute_command`, `run_command`, `run_shell`, `shell_exec` (shell); `read_file`, `read_text_file`, `write_file`, `list_directory`, `list_dir`, `list_files` (files); `read_aws_credentials`, `get_secret`, `read_secret`, `read_secrets` (credentials); `post_slack_message`, `send_slack_message`, `slack_post_message`, `reply_to_thread`, `replyToThread`, and `post_message` (messaging send); `browser_navigate`, `browser_click`, `playwright_navigate` (browser, untrusted content, and network). A reply or post word in the tool name, including `reply_to_thread`, is messaging send. A Slack tool list that only names a read, such as `conversations_history`, still drops the send.

## Papers

Each page below was fetched on 2026-11-19. Peer reviewed means the venue page or the DOI record names a conference.

Felt, Chin, Hanna, Song, and Wagner, Android permissions demystified, ACM CCS 2011. DOI [10.1145/2046707.2046779](https://doi.org/10.1145/2046707.2046779). Stowaway maps API calls to permissions instead of trusting a loose name. The allowlist and the tool list are that kind of map: a package or a declared tool name, not a letter sequence inside another word. Their finding that about one third of apps were overprivileged is about Android in 2011, not about this corpus.

Ou, Govindavajhala, and Appel, MulVAL: A Logic-based Network Security Analyzer, USENIX Security 2005. [USENIX page](https://www.usenix.org/conference/14th-usenix-security-symposium/mulval-logic-based-network-security-analyzer). The system keeps bug and configuration facts separate from the rules derived from them. Observed tools, packages, directories, and URLs are the facts. Substring hits are derived and do not enter a critical rule. Their 84 percent OVAL coverage figure is theirs, measured on Red Hat bugs, not on MCP configs.

Ammann, Wijesekera, and Kaushik, Scalable, graph-based network vulnerability analysis, ACM CCS 2002. DOI [10.1145/586110.586140](https://doi.org/10.1145/586110.586140). Monotonic composition is why a critical finding can still be the combination of shell on one server and credentials on another. The change is which facts are allowed to be preconditions, not a same-server restriction.

Debenedetti, Zhang, Balunovic, Beurer-Kellner, Fischer, and Tramer, AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents, NeurIPS 2024 Datasets and Benchmarks. DOI [10.52202/079017-2636](https://doi.org/10.52202/079017-2636). [Proceedings abstract](https://proceedings.neurips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html). They score tasks against a fixed environment, not with a second model as the judge. This corpus copies that discipline: the manifest is the expected outcome. Their 97 tasks and 629 security cases are their benchmark, not this one.

Liu, Jia, Geng, Jia, and Gong, Formalizing and Benchmarking Prompt Injection Attacks and Defenses, USENIX Security 2024. [USENIX page](https://www.usenix.org/conference/usenixsecurity24/presentation/liu-yupei). They publish a fixed task set and the miss rate of each defense. The table this script prints is the same shape for config findings. The USENIX page does not list a DOI. Their attack and defense counts are about prompts, not about Boppi.

Meli, McNiece, and Reaves, How Bad Can It Git? Characterizing Secret Leakage in Public GitHub Repositories, NDSS 2019. DOI [10.14722/ndss.2019.23418](https://doi.org/10.14722/ndss.2019.23418). They kept only patterns distinctive enough to validate, and they say generic patterns flood the result with false positives. That is why a substring match cannot be critical on its own. Their leakage counts are about public git, not about this scanner.

## Result on this corpus

The first three rows are the same 98 cases and 173 server entries. The last row adds the database, Notion, and auto-approve cases (102 cases, 179 servers). p95 is the scan of one case on this machine, not a laptop in the field.

| | Critical precision | Critical recall | Planted combo recall | Critical finding precision | High precision | High recall | Medium precision | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before the grade change | 0.552 (16/29) | 0.640 (16/25) | 0.640 (16/25) | 0.449 (31/69) | 0.938 (30/32) | 0.882 (30/34) | vacuous | 1.21 ms |
| Short allowlist | 1.000 (25/25) | 1.000 (25/25) | 1.000 (25/25) | 1.000 (47/47) | 1.000 (36/36) | 1.000 (36/36) | 1.000 (1/1) | 1.19 ms |
| Public catalog | 1.000 (25/25) | 1.000 (25/25) | 1.000 (25/25) | 1.000 (64/64) | 1.000 (19/19) | 1.000 (19/19) | 1.000 (19/19) | 1.32 ms |
| Sensitive read and shell boundary | 1.000 (28/28) | 0.966 (28/29) | 0.966 (28/29) | 1.000 (73/73) | 0.950 (19/20) | 1.000 (19/19) | 1.000 (21/21) | 1.12 ms |

The last row is this branch after the silent-drop, GitHub command form, and reply-tool fixes: 102 cases and 179 server entries. Medium recall is 0.955 (21/22). A database or SaaS read plus fetch, a browser, messaging send, or a shell is critical. The same read plus Jira, or plus an approval bypass, is critical and the read stays in the finding. Local files plus the GitHub package, image, or host are critical. A bare shell stays high. p95 stayed near 1 ms.

Two labels still disagree with the rules, and the rules were not edited to chase them. `single-slack-name-only` is labeled critical and scores high (AE-013): one Slack server that can read and send inside its own workspace. `single-everything-demo` is labeled medium and the reference server grants nothing, so there is no finding.

Before, the Cursor half of the 2026-11-19 probe was critical. After, it is not. The Claude Desktop files, shell, browser, and slack case stays critical. Nine planted cases that exist only as tool objects or tool names were missed before and are caught after.

## Severity a user can see

These are the changes in what a scan calls critical:

- A critical finding or a critical path no longer stands on substring evidence alone. The combination rules are unchanged.
- `research-notes` is not a network server. `sandbox-helper` is not a code execution server. A directory named `obsidian-vault` is file access when the directory exists, and it is not credential access.
- Cursor and Claude Desktop skip `disabled: true` and `enabled: false`, as the other clients already did.
- A `tools` array of objects is read. A name on the tool list above is an observed capability and can complete a critical combination. A reply or post word in a tool name is messaging send. Other tool names are listed and add no capability.
- A loopback MCP URL is not treated as network access.
- A connector whose name only contains a brand, such as `github-stars-cache`, stays a low confidence network guess. The exact name `github`, or the package `@modelcontextprotocol/server-github`, is a sensitive repo read. Local files plus that package, the GitHub container image, or `api.githubcopilot.com` are critical.
- A database or SaaS server is a sensitive read. Postgres plus fetch, Drive plus a browser, or a database plus Slack send is critical. Postgres alone is medium. Postgres plus Jira, or a database or Notion server plus an approval bypass, is critical, and the read is still emitted.
- Slack history plus Slack send on that one server is high (AE-013). Email send is a messaging leg. A tool named `reply_to_thread` or `post_message` keeps messaging send.
- A bare shell stays high. Shell plus fetch, an issue tracker, or an approval bypass (`autoApprove`, Claude Code `bypassPermissions`, Codex `approval_policy` `never`, Cursor `approvalMode` `unrestricted`) is critical.

## Sealed held-out v2

The corpus above is the development set. It runs in `npm test`. The 105 case held-out set on `cursor/heldout-detection-eval-5eec` was then used to judge rule changes, so it is no longer a clean release check. `test/heldout-v2/` is a new sealed set. It is not part of `npm test`.

`node test/heldout-v2/harness.js` scans each home locally and prints only aggregate precision and recall by severity, critical combo recall, and p95. It does not print case ids or per-case diffs. A case's predicted severity is the highest open finding or exposure path. Precision and recall use that single label. Combo recall is the share of homes with a non-empty critical combo list whose predicted highest is critical. Fixer hygiene notes are not scored.

Labels were written from `test/heldout-v2/RUBRIC.md` on 2026-11-24, before the harness ran. The rubric restates the clauses in this file and in the README: catalog identity, disabled entries, approval bypass, and the critical combinations AE-009, AE-011, AE-012, AE-014, EP-A, and EP-B. Cases are new homes modeled on public MCP server READMEs and the client config formats cited in the rubric. They are not copies of `test/corpus` or of the earlier held-out set. `LABEL_CHANGELOG.md` records any later label correction. No label was changed after this run.

The set has 128 homes: 48 critical, 24 high, 20 medium, and 36 none. 56 are benign, meaning the expected highest is none or medium. The homes cover several clients at once, disabled servers, approval bypass settings, remote URLs, `npx`, `uvx`, and `docker` forms, and adversarial names.

### Papers

Each page below was fetched on 2026-11-24. Peer reviewed means the venue page or the DOI record names a journal or conference.

Dwork, Feldman, Hardt, Pitassi, Reingold, and Roth, The reusable holdout: Preserving validity in adaptive data analysis, Science 2015, volume 349, issue 6248, pages 636-638. DOI [10.1126/science.aaa9375](https://doi.org/10.1126/science.aaa9375). Adaptive reuse of one holdout set makes later checks look stronger than they are. The earlier held-out set had already guided rule changes, so release decisions need a new set.

Recht, Roelofs, Schmidt, and Shankar, Do ImageNet Classifiers Generalize to ImageNet?, ICML 2019, PMLR 97. [Proceedings](https://proceedings.mlr.press/v97/recht19a.html). They built a fresh test set because the original had been reused, and they scored existing models on it. This directory is that kind of fresh draw for the detection rules.

Oren, Meister, Chatterji, Ladhak, and Hashimoto, Proving Test Set Contamination in Black-Box Language Models, ICLR 2024. [Proceedings](https://proceedings.iclr.cc/paper_files/paper/2024/hash/46e624c244cff669223d488defd4e835-Abstract-Conference.html). A benchmark that has leaked into the thing being measured no longer measures generalization. These homes were written for this set and were not used to edit rules.

Artstein and Poesio, Inter-Coder Agreement for Computational Linguistics, Computational Linguistics 2008, volume 34, issue 4, pages 555-596. DOI [10.1162/coli.07-034-R2](https://doi.org/10.1162/coli.07-034-R2). Labels are reliable only against a written scheme. The rubric is that scheme. One pass applied it, so no agreement coefficient is claimed. Corrections, if any, go in the changelog instead of being edited to match the scanner.

### First result on beta

Scored once on 2026-11-24 against the beta detection engine. No rule was edited from this set. Low has no labeled homes and no predictions, so both rates are not applicable. p95 is the scan of one home on this machine.

| Critical precision | Critical recall | Combo recall | High precision | High recall | Medium precision | Medium recall | None precision | None recall | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.000 (47/47) | 0.979 (47/48) | 0.979 (47/48) | 0.923 (24/26) | 1.000 (24/24) | 0.947 (18/19) | 0.900 (18/20) | 1.000 (36/36) | 1.000 (36/36) | 6.06 ms |

Critical recall is above the 0.80 release bar. One critical home was not predicted critical. That label was left as written.
