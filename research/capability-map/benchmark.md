# Benchmark: catalog vs inspector

Generated 2026-10-01T20:51:06.005Z from labels.json (seed 20261001, reviewer claude, humanReviewed false). 47 of 50 sampled packages have labels; 3 are marked unknown and excluded from scoring.

Rates are percentages. Micro averages pool every (package, category) decision. Macro averages the per-category rates over categories with at least one positive label. Coverage counts packages where the tool emits at least one category, right or wrong.

## Overall

| tool | micro precision | micro recall | FP rate | FN rate | macro precision | macro recall | coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| catalog | 87.5 | 5.1 | 0.1 | 94.9 | 17 | 4 | 5 of 47 (10.6%) |
| inspector | 47.6 | 64.7 | 10.8 | 35.3 | 18.8 | 31.8 | 38 of 47 (80.9%) |

## Per category

| category | labeled | catalog P | catalog R | catalog FP | inspector P | inspector R | inspector FP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read_files | 15 | n/a | 0 | 0 | 45.5 | 100 | 18 |
| write_files | 11 | n/a | 0 | 0 | 37.9 | 100 | 18 |
| delete_files | 3 | n/a | 0 | 0 | 12 | 100 | 22 |
| read_email | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| send_email | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| read_calendar | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| modify_calendar | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| read_source_code | 2 | n/a | 0 | 0 | n/a | 0 | 0 |
| modify_source_code | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| access_customer_data | 3 | n/a | 0 | 0 | n/a | 0 | 0 |
| access_financial_data | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| execute_code | 2 | n/a | 0 | 0 | 12.5 | 100 | 14 |
| run_shell_commands | 14 | 100 | 7.1 | 0 | 66.7 | 100 | 7 |
| call_external_api | 29 | 75 | 10.3 | 1 | 71.4 | 86.2 | 10 |
| send_external_message | 3 | n/a | 0 | 0 | n/a | 0 | 0 |
| create_or_modify_records | 10 | n/a | 0 | 0 | n/a | 0 | 0 |
| make_purchase | 2 | n/a | 0 | 0 | n/a | 0 | 0 |
| access_credentials | 5 | n/a | 0 | 0 | 100 | 20 | 0 |
| access_environment_variables | 18 | n/a | 0 | 0 | 68 | 94.4 | 8 |
| browser_automation | 2 | 100 | 50 | 0 | n/a | 0 | 0 |
| access_production_system | 1 | n/a | 0 | 0 | n/a | 0 | 0 |
| untrusted_external_content | 10 | 100 | 20 | 0 | n/a | 0 | 0 |

## Decision rule

The inspector wins only if micro recall improves by at least 15 points at equal or better micro precision, and the hand review finds it wrong on at most 5 of 50 packages.

- Recall gain: 59.6 points
- Precision held: false
- Packages where the inspector emitted a false positive: 36 (@azure-devops/mcp, @blaxel/core, @bytebase/dbhub, @clerk/mcp-tools, @cloudbase/cloudbase-mcp, @copilotkit/aimock, @drawio/mcp, @foldkit/devtools-mcp, @hasna/conversations, @hasna/files, @hasna/mementos, @letoribo/mcp-graphql-enhanced, @mcp-ui/client, @n8n/mcp-apps, @nitrostack/core, @productbrain/mcp, @raishin/vanguard-frontier-agentic, @shopify/ucp-cli, @softeria/ms-365-mcp-server, @tanstack/ai-mcp, @testsprite/testsprite-mcp, @upstash/context7-mcp, @wonderwhy-er/desktop-commander, @z_ai/mcp-server, agent-install, chrome-devtools-mcp, claude-flow, context-mode, easy-skills, eve, gitnexus, hevy-mcp, hostinger-api-mcp, instar, mcp-auth, xcodebuildmcp)
- Verdict: **inspector does not win; the capability map stays a hand-curated catalog**

## Secondary breakdowns (post hoc, not part of the decision)

Servers only: the 30 labeled packages whose serverShape is server. Libraries, CLIs, and content packages are excluded because the inspector cannot tell from signals alone that nothing is exposed to an agent.

| tool | micro precision | micro recall | coverage | packages with a false positive |
| --- | --- | --- | --- | --- |
| catalog | 87.5 | 5.1 | 5 of 30 | - |
| inspector | 63.8 | 64.7 | 26 of 30 | 24 |

Call strength only: inspector predictions restricted to categories backed by a call site, dropping import-only claims. Same 47 packages as the primary table.

| tool | micro precision | micro recall | coverage | packages with a false positive |
| --- | --- | --- | --- | --- |
| inspector (call only) | 47.5 | 64 | 38 of 47 | 36 |

## Inspector errors

| package | category | kind |
| --- | --- | --- |
| @azure-devops/mcp | read_files | false positive |
| @azure-devops/mcp | delete_files | false positive |
| @azure-devops/mcp | read_source_code | false negative |
| @azure-devops/mcp | create_or_modify_records | false negative |
| @azure-devops/mcp | access_credentials | false negative |
| @azure-devops/mcp | untrusted_external_content | false negative |
| @blaxel/core | execute_code | false positive |
| @blaxel/core | call_external_api | false positive |
| @blaxel/core | access_environment_variables | false positive |
| @bytebase/dbhub | read_files | false positive |
| @clerk/mcp-tools | read_files | false positive |
| @clerk/mcp-tools | write_files | false positive |
| @clerk/mcp-tools | call_external_api | false positive |
| @clerk/mcp-tools | access_environment_variables | false positive |
| @cloudbase/cloudbase-mcp | delete_files | false positive |
| @cloudbase/cloudbase-mcp | execute_code | false positive |
| @cloudbase/cloudbase-mcp | create_or_modify_records | false negative |
| @copilotkit/aimock | read_files | false positive |
| @copilotkit/aimock | write_files | false positive |
| @copilotkit/aimock | delete_files | false positive |
| @copilotkit/aimock | call_external_api | false positive |
| @copilotkit/aimock | access_environment_variables | false positive |
| @drawio/mcp | delete_files | false positive |
| @drawio/mcp | execute_code | false positive |
| @ericthered926/duckduckgo-mcp-server | call_external_api | false negative |
| @ericthered926/duckduckgo-mcp-server | untrusted_external_content | false negative |
| @foldkit/devtools-mcp | read_files | false positive |
| @foldkit/devtools-mcp | write_files | false positive |
| @foldkit/devtools-mcp | delete_files | false positive |
| @foldkit/devtools-mcp | execute_code | false positive |
| @hasna/conversations | read_files | false positive |
| @hasna/conversations | write_files | false positive |
| @hasna/conversations | delete_files | false positive |
| @hasna/conversations | execute_code | false positive |
| @hasna/conversations | send_external_message | false negative |
| @hasna/conversations | access_credentials | false negative |
| @hasna/files | run_shell_commands | false positive |
| @hasna/files | access_credentials | false negative |
| @hasna/mementos | write_files | false positive |
| @hasna/mementos | delete_files | false positive |
| @hasna/mementos | access_credentials | false negative |
| @hubspot/mcp-server | access_customer_data | false negative |
| @hubspot/mcp-server | create_or_modify_records | false negative |
| @letoribo/mcp-graphql-enhanced | read_files | false positive |
| @letoribo/mcp-graphql-enhanced | untrusted_external_content | false negative |
| @mcp-ui/client | execute_code | false positive |
| @n8n/mcp-apps | read_files | false positive |
| @nitrostack/core | read_files | false positive |
| @nitrostack/core | write_files | false positive |
| @nitrostack/core | delete_files | false positive |
| @nitrostack/core | run_shell_commands | false positive |
| @nitrostack/core | call_external_api | false positive |
| @nitrostack/core | access_environment_variables | false positive |
| @paperclipai/mcp-server | create_or_modify_records | false negative |
| @productbrain/mcp | write_files | false positive |
| @productbrain/mcp | create_or_modify_records | false negative |
| @raishin/vanguard-frontier-agentic | read_files | false positive |
| @raishin/vanguard-frontier-agentic | write_files | false positive |
| @raishin/vanguard-frontier-agentic | run_shell_commands | false positive |
| @shopify/ucp-cli | write_files | false positive |
| @shopify/ucp-cli | delete_files | false positive |
| @shopify/ucp-cli | execute_code | false positive |
| @shopify/ucp-cli | run_shell_commands | false positive |
| @shopify/ucp-cli | make_purchase | false negative |
| @softeria/ms-365-mcp-server | read_files | false positive |
| @softeria/ms-365-mcp-server | delete_files | false positive |
| @softeria/ms-365-mcp-server | read_email | false negative |
| @softeria/ms-365-mcp-server | send_email | false negative |
| @softeria/ms-365-mcp-server | read_calendar | false negative |
| @softeria/ms-365-mcp-server | modify_calendar | false negative |
| @softeria/ms-365-mcp-server | send_external_message | false negative |
| @softeria/ms-365-mcp-server | create_or_modify_records | false negative |
| @softeria/ms-365-mcp-server | untrusted_external_content | false negative |
| @tanstack/ai-mcp | read_files | false positive |
| @tanstack/ai-mcp | write_files | false positive |
| @tanstack/ai-mcp | delete_files | false positive |
| @tanstack/ai-mcp | execute_code | false positive |
| @tanstack/ai-mcp | call_external_api | false positive |
| @tanstack/ai-mcp | access_environment_variables | false positive |
| @testsprite/testsprite-mcp | execute_code | false positive |
| @transcend-io/mcp | call_external_api | false negative |
| @transcend-io/mcp-server-assessment | call_external_api | false negative |
| @transcend-io/mcp-server-assessment | create_or_modify_records | false negative |
| @transcend-io/mcp-server-consent | access_customer_data | false negative |
| @transcend-io/mcp-server-consent | call_external_api | false negative |
| @transcend-io/mcp-server-consent | create_or_modify_records | false negative |
| @upstash/context7-mcp | read_files | false positive |
| @upstash/context7-mcp | untrusted_external_content | false negative |
| @wonderwhy-er/desktop-commander | delete_files | false positive |
| @wonderwhy-er/desktop-commander | execute_code | false positive |
| @wonderwhy-er/desktop-commander | untrusted_external_content | false negative |
| @z_ai/mcp-server | write_files | false positive |
| @z_ai/mcp-server | access_environment_variables | false negative |
| agent-install | read_files | false positive |
| agent-install | write_files | false positive |
| agent-install | delete_files | false positive |
| agent-install | run_shell_commands | false positive |
| agent-install | call_external_api | false positive |
| chrome-devtools-mcp | delete_files | false positive |
| chrome-devtools-mcp | call_external_api | false positive |
| chrome-devtools-mcp | browser_automation | false negative |
| chrome-devtools-mcp | untrusted_external_content | false negative |
| claude-flow | delete_files | false positive |
| claude-flow | execute_code | false positive |
| claude-flow | browser_automation | false negative |
| claude-flow | untrusted_external_content | false negative |
| context-mode | write_files | false positive |
| context-mode | delete_files | false positive |
| context-mode | access_environment_variables | false positive |
| context-mode | untrusted_external_content | false negative |
| easy-skills | read_files | false positive |
| easy-skills | write_files | false positive |
| easy-skills | delete_files | false positive |
| easy-skills | call_external_api | false positive |
| easy-skills | access_environment_variables | false positive |
| eve | read_files | false positive |
| eve | write_files | false positive |
| eve | delete_files | false positive |
| eve | execute_code | false positive |
| eve | run_shell_commands | false positive |
| eve | call_external_api | false positive |
| eve | access_environment_variables | false positive |
| gitnexus | delete_files | false positive |
| gitnexus | read_source_code | false negative |
| gitnexus | modify_source_code | false negative |
| gitnexus | execute_code | false positive |
| hevy-mcp | read_files | false positive |
| hevy-mcp | write_files | false positive |
| hevy-mcp | delete_files | false positive |
| hevy-mcp | create_or_modify_records | false negative |
| hostinger-api-mcp | write_files | false positive |
| hostinger-api-mcp | access_customer_data | false negative |
| hostinger-api-mcp | access_financial_data | false negative |
| hostinger-api-mcp | create_or_modify_records | false negative |
| hostinger-api-mcp | make_purchase | false negative |
| hostinger-api-mcp | access_production_system | false negative |
| instar | read_files | false positive |
| instar | write_files | false positive |
| instar | delete_files | false positive |
| instar | execute_code | false positive |
| instar | run_shell_commands | false positive |
| instar | send_external_message | false negative |
| instar | untrusted_external_content | false negative |
| mcp-auth | call_external_api | false positive |
| xcodebuildmcp | delete_files | false positive |

## Catalog errors

| package | category | kind |
| --- | --- | --- |
| @azure-devops/mcp | write_files | false negative |
| @azure-devops/mcp | read_source_code | false negative |
| @azure-devops/mcp | create_or_modify_records | false negative |
| @azure-devops/mcp | access_credentials | false negative |
| @azure-devops/mcp | access_environment_variables | false negative |
| @azure-devops/mcp | untrusted_external_content | false negative |
| @bytebase/dbhub | call_external_api | false negative |
| @bytebase/dbhub | access_environment_variables | false negative |
| @cloudbase/cloudbase-mcp | read_files | false negative |
| @cloudbase/cloudbase-mcp | write_files | false negative |
| @cloudbase/cloudbase-mcp | run_shell_commands | false negative |
| @cloudbase/cloudbase-mcp | call_external_api | false negative |
| @cloudbase/cloudbase-mcp | create_or_modify_records | false negative |
| @cloudbase/cloudbase-mcp | access_environment_variables | false negative |
| @drawio/mcp | read_files | false negative |
| @drawio/mcp | write_files | false negative |
| @drawio/mcp | run_shell_commands | false negative |
| @drawio/mcp | call_external_api | false negative |
| @foldkit/devtools-mcp | call_external_api | false negative |
| @hasna/conversations | run_shell_commands | false negative |
| @hasna/conversations | call_external_api | false negative |
| @hasna/conversations | send_external_message | false negative |
| @hasna/conversations | access_credentials | false negative |
| @hasna/conversations | access_environment_variables | false negative |
| @hasna/files | read_files | false negative |
| @hasna/files | write_files | false negative |
| @hasna/files | delete_files | false negative |
| @hasna/files | call_external_api | false negative |
| @hasna/files | access_credentials | false negative |
| @hasna/files | access_environment_variables | false negative |
| @hasna/mementos | read_files | false negative |
| @hasna/mementos | run_shell_commands | false negative |
| @hasna/mementos | call_external_api | false negative |
| @hasna/mementos | access_credentials | false negative |
| @hasna/mementos | access_environment_variables | false negative |
| @hubspot/mcp-server | access_customer_data | false negative |
| @hubspot/mcp-server | create_or_modify_records | false negative |
| @hubspot/mcp-server | access_environment_variables | false negative |
| @letoribo/mcp-graphql-enhanced | call_external_api | false negative |
| @letoribo/mcp-graphql-enhanced | untrusted_external_content | false negative |
| @paperclipai/mcp-server | call_external_api | false negative |
| @paperclipai/mcp-server | create_or_modify_records | false negative |
| @paperclipai/mcp-server | access_environment_variables | false negative |
| @productbrain/mcp | read_files | false negative |
| @productbrain/mcp | run_shell_commands | false negative |
| @productbrain/mcp | call_external_api | false negative |
| @productbrain/mcp | create_or_modify_records | false negative |
| @productbrain/mcp | access_environment_variables | false negative |
| @shopify/ucp-cli | read_files | false negative |
| @shopify/ucp-cli | call_external_api | false negative |
| @shopify/ucp-cli | make_purchase | false negative |
| @softeria/ms-365-mcp-server | write_files | false negative |
| @softeria/ms-365-mcp-server | read_email | false negative |
| @softeria/ms-365-mcp-server | send_email | false negative |
| @softeria/ms-365-mcp-server | read_calendar | false negative |
| @softeria/ms-365-mcp-server | modify_calendar | false negative |
| @softeria/ms-365-mcp-server | run_shell_commands | false negative |
| @softeria/ms-365-mcp-server | call_external_api | false negative |
| @softeria/ms-365-mcp-server | send_external_message | false negative |
| @softeria/ms-365-mcp-server | create_or_modify_records | false negative |
| @softeria/ms-365-mcp-server | access_credentials | false negative |
| @softeria/ms-365-mcp-server | access_environment_variables | false negative |
| @softeria/ms-365-mcp-server | untrusted_external_content | false negative |
| @testsprite/testsprite-mcp | read_files | false negative |
| @testsprite/testsprite-mcp | write_files | false negative |
| @testsprite/testsprite-mcp | delete_files | false negative |
| @testsprite/testsprite-mcp | run_shell_commands | false negative |
| @testsprite/testsprite-mcp | call_external_api | false negative |
| @testsprite/testsprite-mcp | access_environment_variables | false negative |
| @transcend-io/mcp | call_external_api | false negative |
| @transcend-io/mcp-server-assessment | call_external_api | false negative |
| @transcend-io/mcp-server-assessment | create_or_modify_records | false negative |
| @transcend-io/mcp-server-consent | access_customer_data | false negative |
| @transcend-io/mcp-server-consent | call_external_api | false negative |
| @transcend-io/mcp-server-consent | create_or_modify_records | false negative |
| @upstash/context7-mcp | call_external_api | false negative |
| @upstash/context7-mcp | access_environment_variables | false negative |
| @upstash/context7-mcp | untrusted_external_content | false negative |
| @wonderwhy-er/desktop-commander | read_files | false negative |
| @wonderwhy-er/desktop-commander | write_files | false negative |
| @wonderwhy-er/desktop-commander | call_external_api | false negative |
| @wonderwhy-er/desktop-commander | untrusted_external_content | false negative |
| @z_ai/mcp-server | read_files | false negative |
| @z_ai/mcp-server | call_external_api | false negative |
| @z_ai/mcp-server | access_environment_variables | false negative |
| chrome-devtools-mcp | read_files | false negative |
| chrome-devtools-mcp | write_files | false negative |
| chrome-devtools-mcp | execute_code | false negative |
| chrome-devtools-mcp | run_shell_commands | false negative |
| chrome-devtools-mcp | call_external_api | false positive |
| claude-flow | read_files | false negative |
| claude-flow | write_files | false negative |
| claude-flow | run_shell_commands | false negative |
| claude-flow | call_external_api | false negative |
| claude-flow | access_environment_variables | false negative |
| claude-flow | browser_automation | false negative |
| claude-flow | untrusted_external_content | false negative |
| context-mode | read_files | false negative |
| context-mode | execute_code | false negative |
| context-mode | run_shell_commands | false negative |
| context-mode | call_external_api | false negative |
| context-mode | untrusted_external_content | false negative |
| gitnexus | read_files | false negative |
| gitnexus | write_files | false negative |
| gitnexus | read_source_code | false negative |
| gitnexus | modify_source_code | false negative |
| gitnexus | run_shell_commands | false negative |
| gitnexus | call_external_api | false negative |
| gitnexus | access_environment_variables | false negative |
| hevy-mcp | call_external_api | false negative |
| hevy-mcp | create_or_modify_records | false negative |
| hevy-mcp | access_environment_variables | false negative |
| hostinger-api-mcp | read_files | false negative |
| hostinger-api-mcp | delete_files | false negative |
| hostinger-api-mcp | access_customer_data | false negative |
| hostinger-api-mcp | access_financial_data | false negative |
| hostinger-api-mcp | run_shell_commands | false negative |
| hostinger-api-mcp | call_external_api | false negative |
| hostinger-api-mcp | create_or_modify_records | false negative |
| hostinger-api-mcp | make_purchase | false negative |
| hostinger-api-mcp | access_environment_variables | false negative |
| hostinger-api-mcp | access_production_system | false negative |
| instar | call_external_api | false negative |
| instar | send_external_message | false negative |
| instar | access_environment_variables | false negative |
| instar | untrusted_external_content | false negative |
| xcodebuildmcp | read_files | false negative |
| xcodebuildmcp | write_files | false negative |
| xcodebuildmcp | run_shell_commands | false negative |
| xcodebuildmcp | call_external_api | false negative |
