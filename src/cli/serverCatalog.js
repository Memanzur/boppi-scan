/**
 * Known MCP server catalog, matched by exact package identity rather than by
 * name patterns. Tool names are as documented by the vendor at authoring time
 * (2026-10); version-agnostic; the catalog may lag the vendor. The docs URL is
 * a reference for the reader and is never fetched.
 */
'use strict';

const MCP_SERVERS_DOCS = 'https://github.com/modelcontextprotocol/servers';

const CATALOG = Object.freeze([
  {
    id: 'mcp-filesystem', label: 'Filesystem (official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-filesystem'], docker: ['mcp/filesystem'] },
    capabilities: ['filesystem_access'],
    tools: ['read_file', 'read_text_file', 'read_media_file', 'read_multiple_files', 'write_file', 'edit_file', 'create_directory', 'list_directory', 'list_directory_with_sizes', 'directory_tree', 'move_file', 'search_files', 'get_file_info', 'list_allowed_directories'],
    dataAccess: 'Reads, writes, moves, and searches files under the directories passed as arguments.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/filesystem`,
  },
  {
    id: 'mcp-github', label: 'GitHub (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-github'], docker: ['mcp/github'] },
    capabilities: ['network_access'],
    tools: ['create_or_update_file', 'search_repositories', 'create_repository', 'get_file_contents', 'push_files', 'create_issue', 'create_pull_request', 'fork_repository', 'create_branch', 'list_commits', 'list_issues', 'update_issue', 'add_issue_comment', 'search_code', 'search_issues', 'search_users', 'get_issue', 'get_pull_request', 'list_pull_requests', 'create_pull_request_review', 'merge_pull_request', 'get_pull_request_files', 'get_pull_request_status', 'update_pull_request_branch', 'get_pull_request_comments', 'get_pull_request_reviews'],
    dataAccess: 'Reads and writes repositories, issues, and pull requests the token can reach on GitHub.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/github',
  },
  {
    id: 'github-mcp-server', label: 'GitHub MCP Server (GitHub official)',
    match: { docker: ['ghcr.io/github/github-mcp-server'], urlHosts: ['api.githubcopilot.com'] },
    capabilities: ['network_access'],
    tools: ['get_me', 'search_repositories', 'get_file_contents', 'create_or_update_file', 'push_files', 'create_branch', 'list_commits', 'list_issues', 'get_issue', 'create_issue', 'update_issue', 'add_issue_comment', 'search_issues', 'list_pull_requests', 'get_pull_request', 'create_pull_request', 'merge_pull_request', 'create_pull_request_review', 'search_code', 'search_users', 'list_notifications', 'list_code_scanning_alerts', 'list_secret_scanning_alerts'],
    dataAccess: 'Reads and writes repositories, issues, pull requests, and security alerts the token can reach on GitHub.',
    docs: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'mcp-gitlab', label: 'GitLab (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-gitlab'], docker: ['mcp/gitlab'] },
    capabilities: ['network_access'],
    tools: ['create_or_update_file', 'push_files', 'search_repositories', 'create_repository', 'get_file_contents', 'create_issue', 'create_merge_request', 'fork_repository', 'create_branch'],
    dataAccess: 'Reads and writes projects, issues, and merge requests the token can reach on GitLab.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gitlab',
  },
  {
    id: 'mcp-slack', label: 'Slack (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-slack'], docker: ['mcp/slack'] },
    capabilities: ['network_access'],
    tools: ['slack_list_channels', 'slack_post_message', 'slack_reply_to_thread', 'slack_add_reaction', 'slack_get_channel_history', 'slack_get_thread_replies', 'slack_get_users', 'slack_get_user_profile'],
    dataAccess: 'Reads channel history and posts messages in the Slack workspace the bot token belongs to.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack',
  },
  {
    id: 'mcp-puppeteer', label: 'Puppeteer (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-puppeteer'], docker: ['mcp/puppeteer'] },
    capabilities: ['browser_automation', 'untrusted_external_content', 'network_access'],
    tools: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_click', 'puppeteer_fill', 'puppeteer_select', 'puppeteer_hover', 'puppeteer_evaluate'],
    dataAccess: 'Drives a headless Chrome: visits any URL, reads page content, and runs JavaScript in the page.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer',
  },
  {
    id: 'mcp-postgres', label: 'PostgreSQL (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-postgres'], docker: ['mcp/postgres'] },
    capabilities: ['network_access'],
    tools: ['query'],
    dataAccess: 'Runs read-only SQL against the database named in the connection string and lists its schema.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
  },
  {
    id: 'mcp-sqlite', label: 'SQLite (archived official MCP reference server)',
    match: { pypi: ['mcp-server-sqlite'], docker: ['mcp/sqlite'] },
    capabilities: ['filesystem_access'],
    tools: ['read_query', 'write_query', 'create_table', 'list_tables', 'describe_table', 'append_insight'],
    dataAccess: 'Reads and writes the one SQLite database file passed as an argument.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite',
  },
  {
    id: 'mcp-memory', label: 'Memory (official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-memory'], docker: ['mcp/memory'] },
    capabilities: [],
    tools: ['create_entities', 'create_relations', 'add_observations', 'delete_entities', 'delete_observations', 'delete_relations', 'read_graph', 'search_nodes', 'open_nodes'],
    dataAccess: 'Stores a knowledge graph in one local JSON file; no network access.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/memory`,
  },
  {
    id: 'mcp-sequential-thinking', label: 'Sequential Thinking (official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-sequential-thinking'], docker: ['mcp/sequentialthinking'] },
    capabilities: [],
    tools: ['sequentialthinking'],
    dataAccess: 'Keeps reasoning steps in process memory; touches no files and no network.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/sequentialthinking`,
  },
  {
    id: 'mcp-brave-search', label: 'Brave Search (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-brave-search'], docker: ['mcp/brave-search'] },
    capabilities: ['network_access', 'untrusted_external_content'],
    tools: ['brave_web_search', 'brave_local_search'],
    dataAccess: 'Sends search queries to the Brave Search API and returns web results.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/brave-search',
  },
  {
    id: 'mcp-google-maps', label: 'Google Maps (archived official MCP reference server)',
    match: { npm: ['@modelcontextprotocol/server-google-maps'], docker: ['mcp/google-maps'] },
    capabilities: ['network_access'],
    tools: ['maps_geocode', 'maps_reverse_geocode', 'maps_search_places', 'maps_place_details', 'maps_distance_matrix', 'maps_elevation', 'maps_directions'],
    dataAccess: 'Sends place, route, and geocoding queries to the Google Maps API.',
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/google-maps',
  },
  {
    id: 'mcp-everything', label: 'Everything (official MCP test server)',
    match: { npm: ['@modelcontextprotocol/server-everything'], docker: ['mcp/everything'] },
    capabilities: ['environment_access'],
    tools: ['echo', 'add', 'longRunningOperation', 'printEnv', 'sampleLLM', 'getTinyImage', 'annotatedMessage', 'getResourceReference'],
    dataAccess: 'Demo server for client testing; printEnv returns the server process environment variables.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/everything`,
  },
  {
    id: 'mcp-fetch', label: 'Fetch (official MCP reference server)',
    match: { pypi: ['mcp-server-fetch'], docker: ['mcp/fetch'] },
    capabilities: ['network_access', 'untrusted_external_content'],
    tools: ['fetch'],
    dataAccess: 'Downloads any URL the agent asks for and returns the page content as text.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/fetch`,
  },
  {
    id: 'mcp-git', label: 'Git (official MCP reference server)',
    match: { pypi: ['mcp-server-git'], docker: ['mcp/git'] },
    capabilities: ['filesystem_access'],
    tools: ['git_status', 'git_diff_unstaged', 'git_diff_staged', 'git_diff', 'git_commit', 'git_add', 'git_reset', 'git_log', 'git_create_branch', 'git_checkout', 'git_show', 'git_init', 'git_branch'],
    dataAccess: 'Reads and changes local git repositories: working tree, index, branches, and history.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/git`,
  },
  {
    id: 'mcp-time', label: 'Time (official MCP reference server)',
    match: { pypi: ['mcp-server-time'], docker: ['mcp/time'] },
    capabilities: [],
    tools: ['get_current_time', 'convert_time'],
    dataAccess: 'Reads the system clock and converts between time zones; no files, no network.',
    docs: `${MCP_SERVERS_DOCS}/tree/main/src/time`,
  },
  {
    id: 'playwright-mcp', label: 'Playwright MCP (Microsoft)',
    match: { npm: ['@playwright/mcp'], docker: ['mcr.microsoft.com/playwright/mcp'] },
    capabilities: ['browser_automation', 'untrusted_external_content', 'network_access'],
    tools: ['browser_navigate', 'browser_navigate_back', 'browser_click', 'browser_type', 'browser_hover', 'browser_drag', 'browser_select_option', 'browser_press_key', 'browser_snapshot', 'browser_take_screenshot', 'browser_evaluate', 'browser_fill_form', 'browser_file_upload', 'browser_handle_dialog', 'browser_tabs', 'browser_wait_for', 'browser_console_messages', 'browser_network_requests', 'browser_close', 'browser_resize', 'browser_install'],
    dataAccess: 'Drives a real browser: visits any URL, reads page content, fills forms, uploads files, and runs JavaScript in the page.',
    docs: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'context7', label: 'Context7 (Upstash)',
    match: { npm: ['@upstash/context7-mcp'], urlHosts: ['mcp.context7.com'] },
    capabilities: ['network_access', 'untrusted_external_content'],
    tools: ['resolve-library-id', 'get-library-docs'],
    dataAccess: 'Fetches third-party library documentation from the Context7 service and returns it to the agent.',
    docs: 'https://github.com/upstash/context7',
  },
  {
    id: 'notion-mcp-server', label: 'Notion MCP Server (Notion official)',
    match: { npm: ['@notionhq/notion-mcp-server'], urlHosts: ['mcp.notion.com'] },
    capabilities: ['network_access'],
    tools: ['API-post-search', 'API-get-users', 'API-get-user', 'API-get-self', 'API-retrieve-a-page', 'API-patch-page', 'API-post-page', 'API-get-block-children', 'API-patch-block-children', 'API-retrieve-a-block', 'API-update-a-block', 'API-delete-a-block', 'API-retrieve-a-database', 'API-post-database-query', 'API-create-a-database', 'API-update-a-database', 'API-retrieve-a-comment', 'API-create-a-comment', 'API-retrieve-a-page-property'],
    dataAccess: 'Reads and writes the Notion pages, databases, and comments the integration token can reach.',
    docs: 'https://github.com/makenotion/notion-mcp-server',
  },
  {
    id: 'supabase-mcp', label: 'Supabase MCP Server (Supabase official)',
    match: { npm: ['@supabase/mcp-server-supabase'], urlHosts: ['mcp.supabase.com'] },
    capabilities: ['network_access'],
    tools: ['list_projects', 'get_project', 'create_project', 'pause_project', 'restore_project', 'list_organizations', 'get_organization', 'get_cost', 'confirm_cost', 'list_tables', 'list_extensions', 'list_migrations', 'apply_migration', 'execute_sql', 'get_logs', 'get_advisors', 'get_project_url', 'get_anon_key', 'generate_typescript_types', 'search_docs', 'list_edge_functions', 'deploy_edge_function', 'create_branch', 'list_branches', 'delete_branch', 'merge_branch', 'reset_branch', 'rebase_branch'],
    dataAccess: 'Reads and changes the Supabase projects the access token can reach, including running SQL and deploying functions.',
    docs: 'https://github.com/supabase-community/supabase-mcp',
  },
  {
    id: 'firecrawl-mcp', label: 'Firecrawl MCP',
    match: { npm: ['firecrawl-mcp'] },
    capabilities: ['network_access', 'untrusted_external_content'],
    tools: ['firecrawl_scrape', 'firecrawl_map', 'firecrawl_crawl', 'firecrawl_check_crawl_status', 'firecrawl_search', 'firecrawl_extract', 'firecrawl_deep_research', 'firecrawl_generate_llmstxt'],
    dataAccess: 'Scrapes, crawls, and searches public web pages through the Firecrawl API and returns their content.',
    docs: 'https://github.com/mendableai/firecrawl-mcp-server',
  },
  {
    id: 'exa-mcp-server', label: 'Exa MCP Server',
    match: { npm: ['exa-mcp-server'], urlHosts: ['mcp.exa.ai'] },
    capabilities: ['network_access', 'untrusted_external_content'],
    tools: ['web_search_exa', 'research_paper_search', 'company_research', 'crawling', 'competitor_finder', 'linkedin_search', 'wikipedia_search_exa', 'github_search'],
    dataAccess: 'Sends search queries to the Exa API and returns web results and page content.',
    docs: 'https://github.com/exa-labs/exa-mcp-server',
  },
  {
    id: 'tavily-mcp', label: 'Tavily MCP',
    match: { npm: ['tavily-mcp'] },
    capabilities: ['network_access', 'untrusted_external_content'],
    tools: ['tavily-search', 'tavily-extract', 'tavily-crawl', 'tavily-map'],
    dataAccess: 'Sends search queries to the Tavily API and extracts content from the pages it returns.',
    docs: 'https://github.com/tavily-ai/tavily-mcp',
  },
  {
    id: 'desktop-commander', label: 'Desktop Commander',
    match: { npm: ['@wonderwhy-er/desktop-commander'] },
    capabilities: ['shell_access'],
    tools: ['start_process', 'read_process_output', 'interact_with_process', 'force_terminate', 'list_sessions', 'list_processes', 'kill_process', 'read_file', 'read_multiple_files', 'write_file', 'create_directory', 'list_directory', 'move_file', 'search_files', 'search_code', 'get_file_info', 'edit_block', 'get_config', 'set_config_value'],
    dataAccess: 'Runs arbitrary shell commands on this machine and reads, writes, and searches files anywhere the user can.',
    docs: 'https://github.com/wonderwhy-er/DesktopCommanderMCP',
  },
  {
    id: 'sentry-mcp', label: 'Sentry MCP Server (Sentry official)',
    match: { npm: ['@sentry/mcp-server'], urlHosts: ['mcp.sentry.dev'] },
    capabilities: ['network_access'],
    tools: ['whoami', 'find_organizations', 'find_teams', 'find_projects', 'find_releases', 'get_issue_details', 'get_issue_summary', 'search_errors', 'search_transactions', 'create_team', 'create_project', 'create_dsn', 'find_dsns', 'find_errors_in_file', 'begin_seer_issue_fix', 'get_seer_issue_fix_status', 'update_issue'],
    dataAccess: 'Reads error and performance data, and creates projects and DSNs, in the Sentry organizations the token can reach.',
    docs: 'https://github.com/getsentry/sentry-mcp',
  },
  {
    id: 'stripe-mcp', label: 'Stripe MCP (Stripe official)',
    match: { npm: ['@stripe/mcp'], urlHosts: ['mcp.stripe.com'] },
    capabilities: ['network_access'],
    tools: ['create_customer', 'list_customers', 'create_product', 'list_products', 'create_price', 'list_prices', 'create_payment_link', 'create_invoice', 'create_invoice_item', 'finalize_invoice', 'retrieve_balance', 'create_refund', 'list_payment_intents', 'list_subscriptions', 'cancel_subscription', 'update_subscription', 'list_coupons', 'create_coupon', 'list_disputes', 'update_dispute', 'search_documentation'],
    dataAccess: 'Reads and changes customers, products, invoices, refunds, and subscriptions in the Stripe account the key belongs to.',
    docs: 'https://github.com/stripe/agent-toolkit',
  },
  {
    id: 'cloudflare-mcp', label: 'Cloudflare MCP Server (Cloudflare official)',
    match: { npm: ['@cloudflare/mcp-server-cloudflare'], urlHosts: ['bindings.mcp.cloudflare.com', 'observability.mcp.cloudflare.com', 'docs.mcp.cloudflare.com', 'builds.mcp.cloudflare.com', 'radar.mcp.cloudflare.com', 'browser.mcp.cloudflare.com'] },
    capabilities: ['network_access'],
    tools: ['accounts_list', 'set_active_account', 'workers_list', 'workers_get_worker', 'workers_get_worker_code', 'kv_namespaces_list', 'kv_namespace_get', 'r2_buckets_list', 'r2_bucket_get', 'd1_databases_list', 'd1_database_query', 'hyperdrive_configs_list', 'workers_observability_query', 'search_cloudflare_documentation'],
    dataAccess: 'Reads and changes Workers, KV, R2, D1, and observability data in the Cloudflare accounts the token can reach.',
    docs: 'https://github.com/cloudflare/mcp-server-cloudflare',
  },
  {
    id: 'mcp-server-kubernetes', label: 'Kubernetes MCP Server (Flux159)',
    match: { npm: ['mcp-server-kubernetes'] },
    capabilities: ['network_access'],
    tools: ['kubectl_get', 'kubectl_describe', 'kubectl_list', 'kubectl_apply', 'kubectl_delete', 'kubectl_create', 'kubectl_logs', 'kubectl_scale', 'kubectl_patch', 'kubectl_rollout', 'kubectl_context', 'kubectl_generic', 'exec_in_pod', 'port_forward', 'stop_port_forward', 'install_helm_chart', 'upgrade_helm_chart', 'uninstall_helm_chart', 'explain_resource', 'list_api_resources', 'ping', 'cleanup'],
    dataAccess: 'Runs kubectl and helm against every cluster in the local kubeconfig, including exec into pods and destructive changes unless started read-only.',
    docs: 'https://github.com/Flux159/mcp-server-kubernetes',
  },
]);

const DOCKER_VALUE_FLAGS = new Set(['-e', '--env', '-v', '--volume', '-p', '--publish', '--name', '--network', '-w', '--workdir', '--mount', '--env-file', '-u', '--user', '--entrypoint', '--platform', '-l', '--label', '--add-host', '--cpus', '--memory', '-m', '--pull', '--log-driver', '--restart', '--hostname', '-h']);

function basename(command) {
  return typeof command === 'string' ? command.trim().split(/[\\/]/).pop() : '';
}

function stringArgs(server) {
  return Array.isArray(server.args) ? server.args.filter(v => typeof v === 'string') : [];
}

/** `@scope/name@1.2.3` and `name@latest` split into name and version; a leading `@` is the scope, not a version. */
function splitNpmVersion(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) || null } : { name: spec, version: null };
}
function stripNpmVersion(spec) { return splitNpmVersion(spec).name; }

/** `pkg==1.2.3`, `pkg@1.2.3`, and ranges such as `pkg>=1.0` split into name and the version text as written. */
function splitPypiVersion(spec) {
  const match = /^([^=@<>~\[]+)(?:\[[^\]]*\])?(.*)$/.exec(spec);
  if (!match) return { name: spec, version: null };
  const version = match[2].replace(/^@/, '').trim();
  return { name: match[1], version: version || null };
}
function stripPypiVersion(spec) { return splitPypiVersion(spec).name; }

/** `image:tag` and `image@sha256:digest` split into name and tag or digest. */
function splitDockerTag(image) {
  const digest = image.indexOf('@');
  if (digest > 0) return { name: image.slice(0, digest), version: image.slice(digest + 1) || null };
  const lastSlash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  return colon > lastSlash ? { name: image.slice(0, colon), version: image.slice(colon + 1) || null } : { name: image, version: null };
}
function stripDockerTag(image) { return splitDockerTag(image).name; }

function dockerImage(args) {
  const start = args.indexOf('run');
  if (start < 0) return null;
  for (let i = start + 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (DOCKER_VALUE_FLAGS.has(arg) && !arg.includes('=')) i++;
      continue;
    }
    return splitDockerTag(arg);
  }
  return null;
}

function urlHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return new URL(value.trim()).hostname.toLowerCase() || null; } catch (_) { return null; }
}

/**
 * The exact identity a config entry evidences: { kind, name, version } for
 * `npx [-y] <pkg>[@version]`, `uvx <pkg>[==version]`, `docker run ... <image>[:tag]`,
 * or a url host (version null); null when the entry names nothing the
 * catalog could match exactly. The catalog matches on name; version is kept
 * so a report can say whether the launch is pinned.
 */
function identityOf(server) {
  if (!server || typeof server !== 'object') return null;
  const host = urlHost(server.url || server.endpoint);
  if (host) return { kind: 'url', name: host, version: null };
  const command = basename(server.command);
  const args = stringArgs(server);
  const positional = args.filter(a => !a.startsWith('-'));
  if (command === 'npx') {
    const spec = positional[0];
    return spec ? { kind: 'npm', ...splitNpmVersion(spec) } : null;
  }
  if (command === 'uvx') {
    const from = args.indexOf('--from');
    const spec = from >= 0 ? args[from + 1] : positional[0];
    return spec ? { kind: 'pypi', ...splitPypiVersion(spec) } : null;
  }
  if (command === 'docker') {
    const image = dockerImage(args);
    return image ? { kind: 'docker', ...image } : null;
  }
  return null;
}

const MATCH_LIST = Object.freeze({ npm: 'npm', pypi: 'pypi', docker: 'docker', url: 'urlHosts' });

/** The catalog entry whose identity list contains exactly this server's identity, with the identity that matched. */
function matchCatalog(server) {
  const identity = identityOf(server);
  if (!identity) return null;
  const list = MATCH_LIST[identity.kind];
  const entry = CATALOG.find(candidate => (candidate.match[list] || []).includes(identity.name));
  return entry ? { entry, identity } : null;
}

module.exports = { CATALOG, identityOf, matchCatalog };
