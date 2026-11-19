# Detection evaluation

The corpus in `test/corpus/manifest.json` is the labeled set for critical findings. `node test/eval-corpus.js` scans every case locally, with no network, and prints precision and recall per severity, recall of planted combinations, and the p95 scan time. CI runs it as part of `npm test`. The gate fails when critical precision is below 0.80, when recall of planted combinations is below 0.80, or when p95 is 5 seconds or more.

A case is one agent config. It is predicted at a severity when an open finding or an exposure path has that severity. Precision is predicted cases that carry the label, divided by predicted cases. Recall is predicted cases that carry the label, divided by labeled cases. Planted-combo recall counts only cases marked `plantedCombo`. Critical findings and critical paths are also counted separately as finding precision.

Labels were set from the rule below, not from a model judge. A case is critical when its servers are a cross-server combination, or a declared tool combination, that the product should call critical: execution with credentials and network, shell with files and untrusted content, or files with a non-loopback destination. Lookalike names are not critical. Disabled entries are configs in the count and are not servers. The critical labels were not edited after the gate was measured. High was added on two planted cases that also produce the existing privilege path (untrusted content with code execution). Medium was added on the Cursor probe because its privilege path is recorded one step lower.

## What can be critical

A critical rule still composes capabilities across servers. Each leg has to be one of:

- **observed**: a tool name on the tool list below, a capability the config already states, a directory argument that exists, or an `http` or `https` URL whose host is not loopback
- **allowlist**: the server name, the command basename, or a package argument equals one of these tokens

Filesystem: `filesystem`, `file-system`, `file-server`, `@modelcontextprotocol/server-filesystem`, `server-filesystem`, `mcp-server-filesystem`.

Shell: `shell`, `desktop-commander`, `@wonderwhy-er/desktop-commander`, `mcp-server-shell`. The command line `claude mcp serve` is also on this list and includes files and code execution.

Browser, which also counts as untrusted content and network: `puppeteer`, `playwright`, `@modelcontextprotocol/server-puppeteer`, `@playwright/mcp`, `server-puppeteer`, `mcp-server-puppeteer`.

Fetch, which also counts as untrusted content: `fetch`, `mcp-server-fetch`.

Code execution: `e2b`, `e2b-code-interpreter`, `code-interpreter`, `@e2b/code-interpreter`.

Network connectors: `slack`, `@modelcontextprotocol/server-slack`, `server-slack`, `mcp-server-slack`, `github`, `@modelcontextprotocol/server-github`, `server-github`, `mcp-server-github`.

Credential managers: `1password`, `@1password/mcp`, `bitwarden`, `keychain`.

Declared tools: `run_bash`, `bash`, `execute_command`, `run_command`, `run_shell`, `shell_exec` (shell); `read_file`, `read_text_file`, `write_file`, `list_directory`, `list_dir`, `list_files` (files); `read_aws_credentials`, `get_secret`, `read_secret`, `read_secrets` (credentials); `post_slack_message`, `send_slack_message`, `slack_post_message` (network); `browser_navigate`, `browser_click`, `playwright_navigate` (browser, untrusted content, and network).

Anything else the catalog still recognizes, including `price-fetch`, a brand inside a longer name, or the argument text `shell,read_secrets,send_slack`, is grade `substring`. It stays on the server. Its permission confidence is 0.35, under the 0.40 bar a critical rule and a critical path require. `research-notes` does not match `search`. `sandbox-helper` does not match `sandbox`. `obsidian-vault` does not match `vault`. A loopback URL does not count as network access.

## Papers

Each page below was fetched on 2026-11-19. Peer reviewed means the venue page or the DOI record names a conference.

Felt, Chin, Hanna, Song, and Wagner, Android permissions demystified, ACM CCS 2011. DOI [10.1145/2046707.2046779](https://doi.org/10.1145/2046707.2046779). Stowaway maps API calls to permissions instead of trusting a loose name. The allowlist and the tool list are that kind of map: a package or a declared tool name, not a letter sequence inside another word. Their finding that about one third of apps were overprivileged is about Android in 2011, not about this corpus.

Ou, Govindavajhala, and Appel, MulVAL: A Logic-based Network Security Analyzer, USENIX Security 2005. [USENIX page](https://www.usenix.org/conference/14th-usenix-security-symposium/mulval-logic-based-network-security-analyzer). The system keeps bug and configuration facts separate from the rules derived from them. Observed tools, packages, directories, and URLs are the facts. Substring hits are derived and do not enter a critical rule. Their 84 percent OVAL coverage figure is theirs, measured on Red Hat bugs, not on MCP configs.

Ammann, Wijesekera, and Kaushik, Scalable, graph-based network vulnerability analysis, ACM CCS 2002. DOI [10.1145/586110.586140](https://doi.org/10.1145/586110.586140). Monotonic composition is why a critical finding can still be the combination of shell on one server and credentials on another. The change is which facts are allowed to be preconditions, not a same-server restriction.

Debenedetti, Zhang, Balunovic, Beurer-Kellner, Fischer, and Tramer, AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents, NeurIPS 2024 Datasets and Benchmarks. DOI [10.52202/079017-2636](https://doi.org/10.52202/079017-2636). [Proceedings abstract](https://proceedings.neurips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html). They score tasks against a fixed environment, not with a second model as the judge. This corpus copies that discipline: the manifest is the expected outcome. Their 97 tasks and 629 security cases are their benchmark, not this one.

Liu, Jia, Geng, Jia, and Gong, Formalizing and Benchmarking Prompt Injection Attacks and Defenses, USENIX Security 2024. [USENIX page](https://www.usenix.org/conference/usenixsecurity24/presentation/liu-yupei). They publish a fixed task set and the miss rate of each defense. The table this script prints is the same shape for config findings. The USENIX page does not list a DOI. Their attack and defense counts are about prompts, not about Boppi.

Meli, McNiece, and Reaves, How Bad Can It Git? Characterizing Secret Leakage in Public GitHub Repositories, NDSS 2019. DOI [10.14722/ndss.2019.23418](https://doi.org/10.14722/ndss.2019.23418). They kept only patterns distinctive enough to validate, and they say generic patterns flood the result with false positives. That is why a substring match cannot be critical on its own. Their leakage counts are about public git, not about this scanner.

## Result on this corpus

Measured on the same manifest before the grade change, then after. n is 98 cases and 173 server entries. p95 is the scan of one case on this machine, not a laptop in the field.

| | Critical precision | Critical recall | Planted combo recall | Critical finding precision | High precision | High recall | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before | 0.552 (16/29) | 0.640 (16/25) | 0.640 (16/25) | 0.449 (31/69) | 0.938 (30/32) | 0.882 (30/34) | 1.21 ms |
| After | 1.000 (25/25) | 1.000 (25/25) | 1.000 (25/25) | 1.000 (47/47) | 1.000 (36/36) | 1.000 (36/36) | 1.19 ms |

Medium and low had no labeled cases before the grade change, so those ratios were vacuous. After the change the Cursor probe is the one medium case (a privilege path whose evidence is below 0.40), and medium precision and recall are 1.000 (1/1). Low stays empty. The after p95 on the measurement machine was 1.19 ms on the first after run and 1.24 ms on the rerun. Both are far under 5 seconds.

Before, the Cursor half of the 2026-11-19 probe was critical. After, it is not. The Claude Desktop files, shell, browser, and slack case stays critical. Nine planted cases that exist only as tool objects or tool names were missed before and are caught after.

## Severity a user can see

These are the changes in what a scan calls critical:

- A critical finding or a critical path no longer stands on substring evidence alone. The combination rules are unchanged.
- `research-notes` is not a network server. `sandbox-helper` is not a code execution server. A directory named `obsidian-vault` is file access when the directory exists, and it is not credential access.
- Cursor and Claude Desktop skip `disabled: true` and `enabled: false`, as the other clients already did.
- A `tools` array of objects is read. A name on the tool list above is an observed capability and can complete a critical combination. Other tool names are listed and add no capability.
- A loopback MCP URL is not treated as network access.
- A connector whose name only contains a brand, such as `github-stars-cache`, stays a low confidence network guess. The exact name `github`, or the package `@modelcontextprotocol/server-github`, still counts.
