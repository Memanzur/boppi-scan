# Held-out v2 labeling rubric

This rubric is the only source of labels for `test/heldout-v2/cases.json`. It was written from `docs/EVALUATION.md` and the README on 2026-11-24, before any case in this set was scanned. Labels name the expected highest severity and the expected critical combinations. They are not taken from engine output.

A later edit to a label is allowed only when the label contradicts a clause below. That edit goes in `LABEL_CHANGELOG.md` with the case id and the clause. A disagreement between a label and a scan is a score, not a reason to edit the label.

## Why this set is sealed

The previous held-out set (105 cases on `cursor/heldout-detection-eval-5eec`) was reused to judge rule changes. Three results from the literature say a reused held-out set stops being a valid release check, and one result says how labels stay reliable:

Dwork, Cynthia; Feldman, Vitaly; Hardt, Moritz; Pitassi, Toniann; Reingold, Omer; Roth, Aaron. The reusable holdout: Preserving validity in adaptive data analysis. Science, volume 349, issue 6248, pages 636-638, 2015. DOI 10.1126/science.aaa9375. https://doi.org/10.1126/science.aaa9375
Adaptive reuse of one holdout set makes later checks look stronger than they are. A fresh set is required once the old one has guided changes.

Recht, Benjamin; Roelofs, Rebecca; Schmidt, Ludwig; Shankar, Vaishaal. Do ImageNet Classifiers Generalize to ImageNet? Proceedings of the 36th International Conference on Machine Learning, PMLR 97, 2019. https://proceedings.mlr.press/v97/recht19a.html
They built a new test set because the original had been reused for years, and they scored existing models on it once. This set is that kind of fresh draw for the detection rules.

Oren, Yonatan; Meister, Nicole; Chatterji, Niladri; Ladhak, Faisal; Hashimoto, Tatsunori. Proving Test Set Contamination in Black-Box Language Models. International Conference on Learning Representations, 2024. https://proceedings.iclr.cc/paper_files/paper/2024/hash/46e624c244cff669223d488defd4e835-Abstract-Conference.html
A benchmark that has leaked into the thing being measured no longer measures generalization. Cases here are new homes. They are not copies of `test/corpus` or of the earlier held-out set.

Artstein, Ron; Poesio, Massimo. Inter-Coder Agreement for Computational Linguistics. Computational Linguistics, volume 34, issue 4, pages 555-596, 2008. DOI 10.1162/coli.07-034-R2. https://doi.org/10.1162/coli.07-034-R2
Agreement is meaningful only against a written coding scheme. This file is that scheme. One pass applied it. No second annotator was used, so no agreement coefficient is claimed. What the paper requires, and what this set does, is to separate the scheme from the system being scored and to log any correction.

Each citation was checked against the venue page or the DOI record on 2026-11-24.

## What a case is

A case is one home directory. It may hold several client config files. The label is the highest severity that the clauses assign to any one client in that home.

Severity order, highest first: critical, high, medium, low, none.

This rubric assigns no low labels. Substring evidence is below the 0.40 bar for critical, high, and medium, and no clause promotes it to low.

Config hygiene (file mode, an unpinned `npx -y` or `uvx` flag, a plaintext env value) is not a detection severity. The harness ignores those fixer notes.

Predicted highest, used only by the harness after labeling, is the maximum severity among open rule findings and exposure paths. A finding with no status counts as open. Combo recall is the share of homes whose `expectedCriticalCombos` list is non-empty and whose predicted highest is critical. Precision and recall are computed on the single highest label. p95 is the per-home scan time.

## Evidence

A leg counts only as observed evidence or as a catalog hit. Observed means a tool name on the tool list, a capability the config already states, a directory argument that exists, or an `http` or `https` URL whose host is not loopback. A catalog hit is a package, image, command, or official host in `src/cli/mcpCatalog.json` after the normalization in `docs/EVALUATION.md` (registry prefixes, scopes, version suffixes, image tags, then the affixes `mcp-server-`, `server-`, `-mcp-server`, `-mcp`, and `-server`).

These strings are catalog hits used by the cases. The role is the one in the catalog:

| String | Catalog id | Role |
| --- | --- | --- |
| `@modelcontextprotocol/server-filesystem`, `filesystem`, `mcp/filesystem` | filesystem, or the files row that `mcp/filesystem` normalizes to | files |
| `mcp-server-fetch`, `fetch` | fetch | search (network and untrusted content) |
| `@playwright/mcp`, `playwright` | playwright | browser (browser, untrusted content, network) |
| `@brave/brave-search-mcp-server` | brave-search | search |
| `mcp-server-shell`, `shell`, `mcp-server-commands`, `@agent-infra/mcp-server-commands` | shell or commands | commands (shell) |
| `@wonderwhy-er/desktop-commander`, `mcp/desktop-commander` | desktop-commander | shell and files |
| `e2b-code-interpreter` | e2b | code execution |
| `kubernetes-mcp-server` | kubernetes | shell, network, and credential |
| `@modelcontextprotocol/server-postgres`, `postgres` | postgres | data (sensitive read) |
| `mcp-server-sqlite` | sqlite | data-local (sensitive read) |
| `@modelcontextprotocol/server-gdrive` | gdrive | saas (sensitive read) |
| host `mcp.notion.com` | notion | saas (sensitive read) |
| `@modelcontextprotocol/server-slack`, host `mcp.slack.com` | slack | saas-message (sensitive read and messaging send) |
| `@modelcontextprotocol/server-github`, `ghcr.io/github/github-mcp-server`, host `api.githubcopilot.com` | github | source (sensitive read and remote repository write) |
| host `mcp.atlassian.com` | atlassian | issues (sensitive read and untrusted content) |
| host `mcp.linear.app` | app.linear/linear | saas plus untrusted content, because the catalog name is an issue tracker |
| host `mcp.stripe.com` | stripe | payment (network and production) |
| `ghcr.io/mcparmory/google-gmail`, command `gmail` | gmail | email (sensitive read, messaging send, untrusted content) |
| `@takescake/1password-mcp` | 1password row | credential |
| `mcp-server-git` | git | source-local (not a remote destination) |
| `@modelcontextprotocol/server-memory`, `mcp-server-time`, `@modelcontextprotocol/server-sequential-thinking` | memory, time, sequential-thinking | memory (no capability) |
| `@modelcontextprotocol/server-everything` | everything | reference (no capability) |

`research-notes`, `github-stars-cache`, `price-fetch`, `sandbox-helper`, `obsidian-vault`, `filesystem-backup-helper`, and `slack-notifier-cache` are not catalog hits. A hyphenated lookalike stays at substring grade 0.35.

A loopback host (`localhost`, `127.0.0.1`, `::1`) is not network access.

Disabled entries (`disabled: true` or `enabled: false`) are not servers.

A declared tool list with no send or write name, or `read_only=true` / `--readOnly`, drops messaging send. The same read-only flag does not cancel the GitHub destination in clause C4.

Cline `autoApprove` names become the tool list and, when the list is non-empty, an approval bypass.

Goose's bundled `developer` extension states shell and file capabilities. That is observed evidence, from the Goose config guide cited below.

## Clauses

### Scope

S1. Rules apply per client. A shell on Cursor and fetch on Claude Desktop do not form a combination. The home label is the maximum across clients.

S2. User and project files for the same client merge into one client. A shell in the Cursor user file and fetch in the Cursor project file do form the combination.

S3. A bypass applies only to its own client: Claude Code `permissions.defaultMode` `bypassPermissions`, Codex `approval_policy` `never`, Cursor `approvalMode` `unrestricted`, or a non-empty Cline `autoApprove` list.

S4. A benign home is one whose highest label is none or medium. This set has at least 30 benign homes.

### Critical combinations

C1. AE-009. Shell or code execution is critical when the same client also has one of: an outbound leg (network, browser, or messaging send), untrusted content (fetch, browser, email, or an issue tracker such as Jira, Linear, or Confluence), or an approval bypass from S3.

C2. AE-011. A sensitive read (database or SaaS catalog role, including GitHub's read and Slack's read) plus a separate outbound leg is critical. The outbound leg is fetch, a browser, messaging send, or a shell, and it is not the data connection itself.

C3. AE-014. A sensitive read plus untrusted content on a different server is critical. A sensitive read plus an approval bypass is critical even when there is no shell. The read stays in the finding. Jira alone stays medium.

C4. AE-012. Local files plus a non-loopback MCP host are critical, including when that host's catalog role is a data read. Local files plus the GitHub server are critical in every command form: the npx package, the `ghcr.io/github/github-mcp-server` image, and the host `api.githubcopilot.com`. `--readOnly` does not remove that destination. A local git server is not that destination. A loopback URL is not.

C5. EP-B. Execution together with credential access and network is critical. The kubernetes catalog role grants all three, so that server is critical even alone.

C6. EP-A. Local files plus messaging send on another server are critical. Readable data has a destination off the machine. This is not AE-011 unless the file server is also a sensitive read, which the files role is not.

A home labeled critical lists every clause above that applies. A home not labeled critical has an empty combo list.

### High

H1. AE-010. Shell or code execution with prompting left on, and with no outbound leg, no untrusted ingestion, and no approval bypass, is high. A shell may also read and write files. That does not make it critical. Desktop Commander (shell and files) with no other leg is high. The Goose developer extension with no other leg is high.

H2. AE-006. A file grant whose directory argument is `/` or the home directory is high.

H3. AE-013. One SaaS server that can read and send inside the same vendor workspace is high, not critical. Default Slack, with no tool list, is this case. Default Gmail (read, send, and untrusted content on that one server) is this case. Slack plus fetch, a browser, or a shell stays critical under C1 or C2.

### Medium

M1. AE-008. A scoped file grant, a password manager, or a data store with no outbound leg and no command execution is medium. A catalog files server whose arguments are not `/` and not the home directory is medium, including when a scoped directory exists. GitHub alone is medium. Notion alone is medium. Postgres or sqlite alone is medium. Jira or Linear alone is medium. A Slack tool list that only names a read, or a Slack URL with `read_only=true`, drops the send, so the server is a sensitive read and medium.

### None

N1. Memory, time, sequential thinking, and the reference `everything` server grant nothing.

N2. Fetch, Brave Search, or Playwright alone is network and untrusted content. No clause assigns a severity to that by itself.

N3. Local git alone grants source write on this machine. It is not a remote destination.

N4. An approval bypass with no shell and no sensitive read is hygiene. It is not a detection severity.

N5. A disabled critical server does not count. The label follows the servers that remain.

N6. A substring lookalike, including `price-fetch` next to a real shell, does not complete a critical or high leg. The shell stays high under H1. The lookalike alone is none.

## Case families and sources

Each case cites one source URL for the config shape it copies. Pages were fetched on 2026-11-24 and returned a successful response.

| Family | Source |
| --- | --- |
| Filesystem npx and docker | https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/README.md |
| Fetch uvx | https://github.com/modelcontextprotocol/servers/blob/main/src/fetch/README.md |
| Memory, everything, shell, Brave Search | https://github.com/modelcontextprotocol/servers/blob/main/README.md |
| Git uvx | https://github.com/modelcontextprotocol/servers/blob/main/src/git/README.md |
| Time uvx | https://github.com/modelcontextprotocol/servers/blob/main/src/time/README.md |
| Sequential thinking | https://github.com/modelcontextprotocol/servers/blob/main/src/sequentialthinking/README.md |
| GitHub package, image, and host | https://github.com/github/github-mcp-server/blob/main/README.md |
| Playwright npx | https://github.com/microsoft/playwright-mcp/blob/main/README.md |
| Desktop Commander npx and docker | https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/README.md |
| Kubernetes | https://github.com/containers/kubernetes-mcp-server/blob/main/README.md |
| Slack package | https://github.com/modelcontextprotocol/servers-archived/blob/main/src/slack/README.md |
| Postgres npx | https://github.com/modelcontextprotocol/servers-archived/blob/main/src/postgres/README.md |
| Sqlite uvx | https://github.com/modelcontextprotocol/servers-archived/blob/main/src/sqlite/README.md |
| Google Drive npx | https://github.com/modelcontextprotocol/servers-archived/blob/main/src/gdrive/README.md |
| Notion remote URL | https://developers.notion.com/docs/get-started-with-mcp |
| Linear remote URL | https://linear.app/docs/mcp |
| Stripe remote URL | https://docs.stripe.com/mcp |
| Atlassian remote URL | https://github.com/atlassian/atlassian-mcp-server |
| Gmail image | https://registry.modelcontextprotocol.io/v0/servers?search=com.mcparmory/google-gmail |
| 1Password package | https://registry.modelcontextprotocol.io/v0/servers?search=io.github.CakeRepository/1password |
| Command server package | https://registry.modelcontextprotocol.io/v0/servers?search=mcp-server-commands |
| E2B code interpreter | https://github.com/e2b-dev/mcp-server/blob/main/package.json |
| Cursor `mcp.json` | https://cursor.com/docs/context/mcp |
| Cursor CLI `approvalMode` | https://cursor.com/docs/cli/reference/configuration |
| Claude Desktop and Claude Code MCP | https://code.claude.com/docs/en/mcp |
| Claude Code `bypassPermissions` | https://code.claude.com/docs/en/settings |
| VS Code `mcp.json` and settings | https://code.visualstudio.com/docs/copilot/customization/mcp-servers |
| Copilot `mcp-config.json` | https://code.visualstudio.com/docs/copilot/reference/mcp-configuration |
| Cline `autoApprove` | https://docs.cline.bot/mcp/configuring-mcp-servers |
| Windsurf `mcp_config.json` | https://docs.windsurf.com/windsurf/cascade/mcp |
| Codex `config.toml` | https://developers.openai.com/codex/mcp |
| Goose `config.yaml` | https://github.com/block/goose/blob/main/documentation/docs/guides/config-files.md |
| Gemini CLI settings | https://geminicli.com/docs/tools/mcp-server/ |
| Zed `context_servers` | https://zed.dev/docs/ai/mcp |
| Continue `config.yaml` | https://docs.continue.dev/customize/deep-dives/mcp |
| LM Studio `mcp.json` | https://lmstudio.ai/docs/app/mcp |
| Amazon Q `mcp.json` | https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html |
| Junie `mcp.json` | https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html |

Client paths are the Linux paths the scanner reads: Claude Desktop `~/.config/Claude/claude_desktop_config.json`, Claude Code `~/.claude.json` and `<cwd>/.mcp.json`, Claude settings `~/.claude/settings.json`, Cursor `~/.cursor/mcp.json`, `<cwd>/.cursor/mcp.json`, and `~/.cursor/cli-config.json`, VS Code `~/.config/Code/User/mcp.json` and `settings.json`, Cline under VS Code `globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`, Windsurf `~/.codeium/windsurf/mcp_config.json`, Codex `~/.codex/config.toml`.

No env block in this set carries a credential. Tool names such as `read_secrets` are capability names from the documented tool list, not stored secrets.
