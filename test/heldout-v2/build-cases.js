#!/usr/bin/env node
/**
 * Authoring record for the sealed set. Writes cases.json from the labels in
 * this file. Does not scan. Labels were assigned from RUBRIC.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const parse = require('../../src/cli/discovery/parse');
const { matchIdentity } = require('../../src/cli/mcpCatalog');

const SRC = {
  filesystem: 'https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/README.md',
  memory: 'https://github.com/modelcontextprotocol/servers/blob/main/src/memory/README.md',
  fetch: 'https://github.com/modelcontextprotocol/servers/blob/main/src/fetch/README.md',
  servers: 'https://github.com/modelcontextprotocol/servers/blob/main/README.md',
  git: 'https://github.com/modelcontextprotocol/servers/blob/main/src/git/README.md',
  time: 'https://github.com/modelcontextprotocol/servers/blob/main/src/time/README.md',
  sequential: 'https://github.com/modelcontextprotocol/servers/blob/main/src/sequentialthinking/README.md',
  github: 'https://github.com/github/github-mcp-server/blob/main/README.md',
  playwright: 'https://github.com/microsoft/playwright-mcp/blob/main/README.md',
  commander: 'https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/README.md',
  kubernetes: 'https://github.com/containers/kubernetes-mcp-server/blob/main/README.md',
  slack: 'https://github.com/modelcontextprotocol/servers-archived/blob/main/src/slack/README.md',
  postgres: 'https://github.com/modelcontextprotocol/servers-archived/blob/main/src/postgres/README.md',
  sqlite: 'https://github.com/modelcontextprotocol/servers-archived/blob/main/src/sqlite/README.md',
  gdrive: 'https://github.com/modelcontextprotocol/servers-archived/blob/main/src/gdrive/README.md',
  notion: 'https://developers.notion.com/docs/get-started-with-mcp',
  linear: 'https://linear.app/docs/mcp',
  stripe: 'https://docs.stripe.com/mcp',
  atlassian: 'https://github.com/atlassian/atlassian-mcp-server',
  gmail: 'https://registry.modelcontextprotocol.io/v0/servers?search=com.mcparmory/google-gmail',
  onepassword: 'https://registry.modelcontextprotocol.io/v0/servers?search=io.github.CakeRepository/1password',
  commands: 'https://registry.modelcontextprotocol.io/v0/servers?search=mcp-server-commands',
  e2b: 'https://github.com/e2b-dev/mcp-server/blob/main/package.json',
  cursor: 'https://cursor.com/docs/context/mcp',
  cursorCli: 'https://cursor.com/docs/cli/reference/configuration',
  claudeMcp: 'https://code.claude.com/docs/en/mcp',
  claudeSettings: 'https://code.claude.com/docs/en/settings',
  vscode: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
  copilot: 'https://code.visualstudio.com/docs/copilot/reference/mcp-configuration',
  cline: 'https://docs.cline.bot/mcp/configuring-mcp-servers',
  windsurf: 'https://docs.windsurf.com/windsurf/cascade/mcp',
  codex: 'https://developers.openai.com/codex/mcp',
  goose: 'https://github.com/block/goose/blob/main/documentation/docs/guides/config-files.md',
  gemini: 'https://geminicli.com/docs/tools/mcp-server/',
  zed: 'https://zed.dev/docs/ai/mcp',
  continue: 'https://docs.continue.dev/customize/deep-dives/mcp',
  lmstudio: 'https://lmstudio.ai/docs/app/mcp',
  amazonq: 'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html',
  junie: 'https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html',
};

const COMBOS = new Set(['AE-009', 'AE-011', 'AE-012', 'AE-014', 'EP-A', 'EP-B']);
const DOCS = '{{HOME}}/docs';
const HOME = '{{HOME}}';
const PROJECT = '{{CWD}}/src';

function npx(pkg, ...args) { return { command: 'npx', args: ['-y', pkg, ...args] }; }
function uvx(pkg, ...args) { return { command: 'uvx', args: [pkg, ...args] }; }
function docker(image) { return { command: 'docker', args: ['run', '-i', '--rm', image] }; }
function dockerFiles() {
  return {
    command: 'docker',
    args: ['run', '-i', '--rm', '--mount', 'type=bind,src={{HOME}}/docs,dst=/projects/docs', 'mcp/filesystem', '/projects'],
  };
}
function remote(url) { return { url }; }
function off(spec) { return { ...spec, disabled: true }; }
function tools(spec, names) { return { ...spec, tools: names }; }
function approve(spec, names) { return { ...spec, autoApprove: names }; }
function nodeCmd(script) { return { command: 'node', args: [script] }; }

function mcp(file, servers) { return { kind: 'mcp', file, servers }; }
function cursor(servers) { return mcp('.cursor/mcp.json', servers); }
function desktop(servers) { return mcp('.config/Claude/claude_desktop_config.json', servers); }
function claudeUser(servers) { return mcp('.claude.json', servers); }
function projectMcp(servers) { return mcp('work/repo/.mcp.json', servers); }
function projectCursor(servers) { return mcp('work/repo/.cursor/mcp.json', servers); }
function vscode(servers) { return { kind: 'vscode', file: '.config/Code/User/mcp.json', servers }; }
function vscodeSettings(servers) { return { kind: 'vscode-settings', file: '.config/Code/User/settings.json', servers }; }
function cline(servers) { return mcp('.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json', servers); }
function windsurf(servers) { return mcp('.codeium/windsurf/mcp_config.json', servers); }
function gemini(servers) { return mcp('.gemini/settings.json', servers); }
function lmstudio(servers) { return mcp('.lmstudio/mcp.json', servers); }
function amazonq(servers) { return mcp('.aws/amazonq/mcp.json', servers); }
function junie(servers) { return mcp('.junie/mcp/mcp.json', servers); }
function copilot(servers) { return mcp('.copilot/mcp-config.json', servers); }
function zed(servers) { return { kind: 'zed', file: '.config/zed/settings.json', servers }; }
function cont(servers) { return { kind: 'continue', file: '.continue/config.yaml', servers }; }
function goose(extensions) { return { kind: 'goose', file: '.config/goose/config.yaml', extensions }; }
function codex(spec) { return { kind: 'codex', file: '.codex/config.toml', approval: spec.approval || null, servers: spec.servers }; }
function claudeBypass() { return { kind: 'json', file: '.claude/settings.json', body: { permissions: { defaultMode: 'bypassPermissions' } } }; }
function cursorYolo() { return { kind: 'json', file: '.cursor/cli-config.json', body: { approvalMode: 'unrestricted' } }; }

const cases = [];
function add(id, expected, combos, source, family, rationale, traits, parts) {
  cases.push({
    id, expectedHighest: expected, expectedCriticalCombos: combos, source, family, rationale, traits, parts,
  });
}

const memory = () => npx('@modelcontextprotocol/server-memory');
const time = () => uvx('mcp-server-time');
const thinking = () => npx('@modelcontextprotocol/server-sequential-thinking');
const everything = () => npx('@modelcontextprotocol/server-everything');
const git = () => uvx('mcp-server-git');
const fetch = () => uvx('mcp-server-fetch');
const shell = () => uvx('mcp-server-shell');
const commander = () => npx('@wonderwhy-er/desktop-commander');
const playwright = () => npx('@playwright/mcp@latest');
const files = (...args) => npx('@modelcontextprotocol/server-filesystem', ...args);
const postgres = () => npx('@modelcontextprotocol/server-postgres');
const sqlite = () => uvx('mcp-server-sqlite');
const gdrive = () => npx('@modelcontextprotocol/server-gdrive');
const slackPkg = () => npx('@modelcontextprotocol/server-slack');
const githubPkg = () => npx('@modelcontextprotocol/server-github');
const commands = () => npx('@agent-infra/mcp-server-commands');
const e2b = () => npx('e2b-code-interpreter');
const kube = () => npx('kubernetes-mcp-server@latest');
const brave = () => npx('@brave/brave-search-mcp-server@latest');
const onepass = () => npx('@takescake/1password-mcp');
const gmailPkg = () => npx('mcparmory-google-gmail');

add('h2-001-empty', 'none', [], SRC.cursor, 'empty-home',
  'No config files. Clause N1: nothing to grade.',
  ['benign'], []);

add('h2-002-cursor-memory', 'none', [], SRC.memory, 'memory-npx',
  'Cursor memory package only. Memory grants nothing (N1).',
  ['benign', 'npx'], [cursor({ recall: npx('@modelcontextprotocol/server-memory@latest') })]);

add('h2-003-desktop-time', 'none', [], SRC.time, 'time-uvx',
  'Claude Desktop time server via uvx. Time grants nothing (N1).',
  ['benign', 'uvx'], [desktop({ clock: uvx('mcp-server-time') })]);

add('h2-004-cursor-thinking-memory', 'none', [], SRC.sequential, 'sequential-thinking',
  'Sequential thinking plus memory. Both are memory-role servers (N1).',
  ['benign', 'npx'], [cursor({ thinking: thinking(), memory: memory() })]);

add('h2-005-desktop-everything', 'none', [], SRC.servers, 'everything-reference',
  'The reference everything server grants nothing (N1).',
  ['benign', 'npx'], [desktop({ 'protocol-demo': npx('@modelcontextprotocol/server-everything@latest') })]);

add('h2-006-cursor-git', 'none', [], SRC.git, 'git-uvx',
  'Local git server only. It is not a remote destination (N3).',
  ['benign', 'uvx'], [cursor({ git: git() })]);

add('h2-007-vscode-brave', 'none', [], SRC.servers, 'brave-search',
  'Brave Search alone is network and untrusted content. No severity clause applies (N2).',
  ['benign', 'npx'], [vscode({ brave: brave() })]);

add('h2-008-windsurf-fetch', 'none', [], SRC.fetch, 'fetch-uvx',
  'Fetch alone is network and untrusted content (N2).',
  ['benign', 'uvx'], [windsurf({ pages: uvx('mcp-server-fetch==0.6.2') })]);

add('h2-009-cursor-loopback', 'none', [], SRC.cursor, 'loopback-url',
  'A loopback MCP URL is not network access, and the server is not a catalog hit (N2).',
  ['benign', 'remote-url'], [cursor({ local: remote('http://127.0.0.1:3333/mcp') })]);

add('h2-010-desktop-disabled-pair', 'none', [], SRC.claudeMcp, 'disabled-servers',
  'Shell and fetch are both disabled, so neither server exists (N5).',
  ['benign', 'disabled', 'npx', 'uvx'], [desktop({
    shell: off(npx('mcp-server-shell')),
    fetch: off(fetch()),
  })]);

add('h2-011-cursor-lookalikes', 'none', [], SRC.servers, 'adversarial-names',
  'research-notes and sandbox-helper are documented lookalikes, not catalog hits (N6).',
  ['benign', 'adversarial'], [cursor({
    'research-notes': nodeCmd('notes.js'),
    'sandbox-helper': nodeCmd('helper.js'),
  })]);

add('h2-012-cursor-price-fetch', 'none', [], SRC.fetch, 'adversarial-names',
  'price-fetch is the documented substring example. It stays under the 0.40 bar (N6).',
  ['benign', 'adversarial', 'npx'], [cursor({ prices: npx('price-fetch') })]);

add('h2-013-cursor-stars-cache', 'none', [], SRC.github, 'adversarial-names',
  'github-stars-cache is a brand lookalike, not the GitHub server (N6).',
  ['benign', 'adversarial', 'npx'], [cursor({ stars: npx('github-stars-cache') })]);

add('h2-014-cursor-vault-name', 'none', [], SRC.filesystem, 'adversarial-names',
  'The server is named obsidian-vault and does not point at a directory. The name is not credential access (N6).',
  ['benign', 'adversarial'], [cursor({ 'obsidian-vault': nodeCmd('vault.js') })]);

add('h2-015-claude-bypass-memory', 'none', [], SRC.claudeSettings, 'approval-bypass',
  'bypassPermissions with only a memory server. The bypass is hygiene when there is no shell and no sensitive read (N4).',
  ['benign', 'approval-bypass', 'npx'], [claudeBypass(), claudeUser({ recall: npx('@modelcontextprotocol/server-memory@latest') })]);

add('h2-016-codex-never-time', 'none', [], SRC.codex, 'approval-bypass',
  'Codex approval_policy never with only the time server (N4, N1).',
  ['benign', 'approval-bypass', 'uvx'], [codex({ approval: 'never', servers: { clock: uvx('mcp-server-time') } })]);

add('h2-017-cursor-yolo-everything', 'none', [], SRC.cursorCli, 'approval-bypass',
  'Cursor approvalMode unrestricted with only the reference everything server (N4, N1).',
  ['benign', 'approval-bypass', 'npx'], [cursorYolo(), cursor({ 'sample-server': npx('@modelcontextprotocol/server-everything@latest') })]);

add('h2-018-cline-approve-memory', 'none', [], SRC.cline, 'approval-bypass',
  'Cline autoApprove lists a name that is not a shell, file, credential, browser, or send tool, on a memory server (N4).',
  ['benign', 'approval-bypass', 'npx'], [cline({ memory: approve(memory(), ['list_memories']) })]);

add('h2-019-continue-time', 'none', [], SRC.continue, 'continue-yaml',
  'Continue config.yaml time server. Time grants nothing (N1).',
  ['benign', 'uvx'], [cont({ clock: uvx('mcp-server-time') })]);

add('h2-020-gemini-thinking', 'none', [], SRC.gemini, 'gemini-settings',
  'Gemini CLI sequential thinking only (N1).',
  ['benign', 'npx'], [gemini({ thinking: thinking() })]);

add('h2-021-lmstudio-memory', 'none', [], SRC.lmstudio, 'lmstudio-mcp',
  'LM Studio memory server only (N1).',
  ['benign', 'npx'], [lmstudio({ recall: npx('@modelcontextprotocol/server-memory@latest') })]);

add('h2-022-amazonq-time', 'none', [], SRC.amazonq, 'amazonq-mcp',
  'Amazon Q time server only (N1).',
  ['benign', 'uvx'], [amazonq({ clock: uvx('mcp-server-time') })]);

add('h2-023-zed-memory', 'none', [], SRC.zed, 'zed-context-servers',
  'Zed context_servers memory entry only (N1).',
  ['benign', 'npx'], [zed({ recall: npx('@modelcontextprotocol/server-memory@latest') })]);

add('h2-024-windsurf-everything', 'none', [], SRC.windsurf, 'windsurf-mcp',
  'Windsurf everything server only (N1).',
  ['benign', 'npx'], [windsurf({ 'demo-server': everything() })]);

add('h2-025-vscode-disabled-postgres', 'none', [], SRC.vscode, 'disabled-servers',
  'The only VS Code server is disabled postgres (N5).',
  ['benign', 'disabled', 'npx'], [vscode({ postgres: off(postgres()) })]);

add('h2-026-copilot-everything', 'none', [], SRC.copilot, 'copilot-mcp',
  'Copilot mcp-config.json holds the reference everything server (N1).',
  ['benign', 'npx'], [copilot({ 'sample-server': everything() })]);

add('h2-027-junie-time', 'none', [], SRC.junie, 'junie-mcp',
  'Junie time server only (N1).',
  ['benign', 'uvx'], [junie({ clock: uvx('mcp-server-time') })]);

add('h2-028-goose-time-only', 'none', [], SRC.goose, 'goose-yaml',
  'Goose developer extension is disabled. The enabled time server grants nothing (N5, N1).',
  ['benign', 'disabled', 'uvx'], [goose({
    developer: { enabled: false, type: 'builtin', name: 'developer' },
    clock: { enabled: true, type: 'stdio', name: 'clock', cmd: 'uvx', args: ['mcp-server-time'] },
  })]);

add('h2-029-split-memory-time', 'none', [], SRC.cursor, 'multi-client',
  'Cursor has memory and Claude Desktop has time. Neither client has a graded server (N1, S1).',
  ['benign', 'multi-client', 'npx', 'uvx'], [
    cursor({ memory: memory() }),
    desktop({ time: time() }),
  ]);

add('h2-030-slack-disabled', 'none', [], SRC.slack, 'disabled-servers',
  'Slack is disabled. The enabled server is memory (N5, N1).',
  ['benign', 'disabled', 'npx'], [desktop({
    slack: off(slackPkg()),
    recall: npx('@modelcontextprotocol/server-memory@latest'),
  })]);

add('h2-031-loopback-and-notes', 'none', [], SRC.cursor, 'adversarial-names',
  'Loopback URL plus research-notes. Neither is a catalog network or file grant (N6).',
  ['benign', 'adversarial', 'remote-url'], [cursor({
    local: remote('http://localhost:4000/mcp'),
    'research-notes': nodeCmd('notes.js'),
  })]);

add('h2-032-empty-maps', 'none', [], SRC.claudeMcp, 'multi-client',
  'Cursor and Claude Code files exist and declare no servers.',
  ['benign', 'multi-client'], [
    cursor({}),
    claudeUser({}),
  ]);

add('h2-033-filesystem-lookalike', 'none', [], SRC.filesystem, 'adversarial-names',
  'filesystem-backup-helper does not normalize to the filesystem server (N6).',
  ['benign', 'adversarial'], [cursor({ 'filesystem-backup-helper': nodeCmd('index.js') })]);

add('h2-034-slack-lookalike', 'none', [], SRC.slack, 'adversarial-names',
  'slack-notifier-cache does not normalize to Slack (N6).',
  ['benign', 'adversarial'], [windsurf({ 'slack-notifier-cache': nodeCmd('index.js') })]);

add('h2-035-notes-server', 'none', [], SRC.cursor, 'adversarial-names',
  'A private node script named notes-server matches no catalog row (N6).',
  ['benign', 'adversarial'], [gemini({ 'notes-server': nodeCmd('index.js') })]);

add('h2-036-codex-time', 'none', [], SRC.codex, 'codex-toml',
  'Codex time server with approval left on. Time grants nothing (N1).',
  ['benign', 'uvx'], [codex({ servers: { clock: uvx('mcp-server-time') } })]);

add('h2-037-files-docs', 'medium', [], SRC.filesystem, 'filesystem-npx',
  'Filesystem package rooted at a scoped docs directory (M1).',
  ['benign', 'npx'], [cursor({ filesystem: files(DOCS) })]);

add('h2-038-project-files', 'medium', [], SRC.claudeMcp, 'filesystem-npx',
  'Project .mcp.json grants the filesystem server a scoped project directory. Copilot reads that same file, still medium (M1, S1).',
  ['benign', 'npx'], [projectMcp({ filesystem: files(PROJECT) })]);

add('h2-039-vscode-postgres', 'medium', [], SRC.postgres, 'postgres-npx',
  'Postgres alone in VS Code settings is a sensitive read (M1).',
  ['benign', 'npx'], [vscodeSettings({ postgres: postgres() })]);

add('h2-040-desktop-sqlite', 'medium', [], SRC.sqlite, 'sqlite-uvx',
  'Sqlite alone is a local data store (M1).',
  ['benign', 'uvx'], [desktop({ sqlite: sqlite() })]);

add('h2-041-cursor-notion', 'medium', [], SRC.notion, 'notion-url',
  'Notion remote host is a SaaS read. The time server grants nothing (M1, N1).',
  ['benign', 'remote-url', 'uvx'], [cursor({ notion: remote('https://mcp.notion.com/mcp'), clock: uvx('mcp-server-time') })]);

add('h2-042-windsurf-gdrive', 'medium', [], SRC.gdrive, 'gdrive-npx',
  'Google Drive package alone is a SaaS read (M1).',
  ['benign', 'npx'], [windsurf({ drive: npx('@modelcontextprotocol/server-gdrive@latest') })]);

add('h2-043-gemini-github', 'medium', [], SRC.github, 'github-npx',
  'GitHub package alone stays medium (M1).',
  ['benign', 'npx'], [gemini({ repos: npx('@modelcontextprotocol/server-github@latest') })]);

add('h2-044-copilot-github-image', 'medium', [], SRC.github, 'github-docker',
  'GitHub container image alone stays medium (M1).',
  ['benign', 'docker'], [copilot({ github: docker('ghcr.io/github/github-mcp-server') })]);

add('h2-045-desktop-github-host', 'medium', [], SRC.github, 'github-host',
  'api.githubcopilot.com alone stays medium (M1).',
  ['benign', 'remote-url'], [desktop({ github: remote('https://api.githubcopilot.com/mcp') })]);

add('h2-046-cursor-1password', 'medium', [], SRC.onepassword, 'password-manager',
  'Password manager package with no outbound leg and no shell (M1).',
  ['benign', 'npx'], [cursor({ onepassword: onepass() })]);

add('h2-047-slack-read-tools', 'medium', [], SRC.slack, 'slack-read-only',
  'Slack tool list names only conversations_history, so the send is dropped and the server is a sensitive read (M1).',
  ['benign', 'npx'], [cursor({ slack: tools(slackPkg(), ['conversations_history']) })]);

add('h2-048-slack-readonly-url', 'medium', [], SRC.slack, 'slack-read-only',
  'Slack host with read_only=true drops the send (M1).',
  ['benign', 'remote-url'], [vscode({ slack: remote('https://mcp.slack.com/mcp?read_only=true') })]);

add('h2-049-atlassian-host', 'medium', [], SRC.atlassian, 'atlassian-url',
  'Jira and Confluence host alone stays a medium sensitive read (M1, C3).',
  ['benign', 'remote-url'], [windsurf({ atlassian: remote('https://mcp.atlassian.com/v1/mcp') })]);

add('h2-050-linear-host', 'medium', [], SRC.linear, 'linear-url',
  'Linear host stays medium. The time server grants nothing (M1, N1).',
  ['benign', 'remote-url', 'uvx'], [cline({ linear: remote('https://mcp.linear.app/mcp'), clock: uvx('mcp-server-time') })]);

add('h2-051-files-and-git', 'medium', [], SRC.git, 'git-uvx',
  'Scoped files plus local git. Local git is not a remote destination (M1, C4).',
  ['benign', 'npx', 'uvx'], [cursor({ filesystem: files(DOCS), git: git() })]);

add('h2-052-files-loopback', 'medium', [], SRC.filesystem, 'loopback-url',
  'Scoped files plus a loopback URL. Loopback is not a destination (M1, C4).',
  ['benign', 'npx', 'remote-url'], [desktop({
    filesystem: files(DOCS),
    local: remote('http://127.0.0.1:8080/mcp'),
  })]);

add('h2-053-files-stars-cache', 'medium', [], SRC.github, 'adversarial-names',
  'Scoped files plus github-stars-cache. The lookalike is not the GitHub destination (M1, N6, C4).',
  ['benign', 'adversarial', 'npx'], [cursor({
    filesystem: files(DOCS),
    stars: npx('github-stars-cache'),
  })]);

add('h2-054-postgres-shell-off', 'medium', [], SRC.postgres, 'disabled-servers',
  'Shell is disabled. Postgres remains a data store with no outbound leg (N5, M1).',
  ['benign', 'disabled', 'npx', 'uvx'], [vscode({
    postgres: postgres(),
    shell: off(shell()),
  })]);

add('h2-055-notion-and-sqlite', 'medium', [], SRC.notion, 'multi-client',
  'Claude Desktop has Notion and Cursor has sqlite. Each client is a sensitive read alone (M1, S1).',
  ['benign', 'multi-client', 'remote-url', 'uvx'], [
    desktop({ notion: remote('https://mcp.notion.com/mcp') }),
    cursor({ sqlite: sqlite() }),
  ]);

add('h2-056-files-price-fetch', 'medium', [], SRC.fetch, 'adversarial-names',
  'Scoped files plus price-fetch. The substring fetch is not an outbound leg (M1, N6).',
  ['benign', 'adversarial', 'npx'], [gemini({
    filesystem: files(DOCS),
    prices: npx('price-fetch'),
  })]);

add('h2-057-commander', 'high', [], SRC.commander, 'desktop-commander',
  'Desktop Commander is shell and files with prompting left on (H1).',
  ['npx'], [cursor({ commander: commander() })]);

add('h2-058-shell-uvx', 'high', [], SRC.servers, 'shell-uvx',
  'uvx mcp-server-shell with no outbound leg and no bypass (H1).',
  ['uvx'], [desktop({ shell: shell() })]);

add('h2-059-commands', 'high', [], SRC.commands, 'commands-npx',
  'Command server package is shell with prompting left on (H1).',
  ['npx'], [vscode({ commands: commands() })]);

add('h2-060-e2b', 'high', [], SRC.e2b, 'e2b-npx',
  'Code interpreter alone, prompting left on, no outbound leg (H1).',
  ['npx'], [windsurf({ e2b: e2b() })]);

add('h2-061-files-home', 'high', [], SRC.filesystem, 'filesystem-broad',
  'Filesystem server rooted at the home directory (H2).',
  ['npx'], [cursor({ filesystem: files(HOME) })]);

add('h2-062-files-root', 'high', [], SRC.filesystem, 'filesystem-broad',
  'Filesystem server rooted at / (H2).',
  ['npx'], [claudeUser({ filesystem: files('/') })]);

add('h2-063-slack-default', 'high', [], SRC.slack, 'slack-package',
  'Default Slack package can read and send inside Slack (H3).',
  ['npx'], [cursor({ slack: slackPkg() })]);

add('h2-064-slack-host', 'high', [], SRC.slack, 'slack-host',
  'Hosted Slack with no tool list is the same vendor read and send. Memory grants nothing (H3, N1).',
  ['remote-url', 'npx'], [desktop({ slack: remote('https://mcp.slack.com/mcp'), recall: npx('@modelcontextprotocol/server-memory@latest') })]);

add('h2-065-gmail-image', 'high', [], SRC.gmail, 'gmail-docker',
  'Gmail image reads and sends inside Gmail (H3).',
  ['docker'], [copilot({ gmail: docker('ghcr.io/mcparmory/google-gmail') })]);

add('h2-066-goose-developer', 'high', [], SRC.goose, 'goose-yaml',
  'Goose developer extension states shell and file tools, with no outbound leg (H1).',
  [], [goose({
    developer: { enabled: true, type: 'builtin', name: 'developer' },
  })]);

add('h2-067-shell-and-files', 'high', [], SRC.filesystem, 'shell-uvx',
  'Shell plus a scoped directory. The shell can already touch files, and nothing leaves the machine (H1).',
  ['npx', 'uvx'], [cursor({ shell: shell(), filesystem: files(DOCS) })]);

add('h2-068-shell-and-memory', 'high', [], SRC.servers, 'shell-uvx',
  'Shell plus memory. Memory adds no outbound leg (H1).',
  ['npx', 'uvx'], [desktop({ shell: shell(), memory: memory() })]);

add('h2-069-shell-and-git', 'high', [], SRC.git, 'git-uvx',
  'Shell plus local git. Local git is not a remote destination (H1, C4).',
  ['uvx'], [windsurf({ shell: shell(), git: git() })]);

add('h2-070-shell-loopback', 'high', [], SRC.servers, 'loopback-url',
  'Shell plus a loopback URL. Loopback is not an outbound leg (H1).',
  ['uvx', 'remote-url'], [vscode({
    shell: shell(),
    local: remote('http://127.0.0.1:9090/mcp'),
  })]);

add('h2-071-shell-price-fetch', 'high', [], SRC.fetch, 'adversarial-names',
  'Shell plus price-fetch. The lookalike does not supply network, so the shell stays high (H1, N6).',
  ['adversarial', 'uvx', 'npx'], [cursor({ shell: shell(), prices: npx('price-fetch') })]);

add('h2-072-shell-stars-cache', 'high', [], SRC.github, 'adversarial-names',
  'Shell plus github-stars-cache. The lookalike is not GitHub and not network at catalog grade (H1, N6).',
  ['adversarial', 'uvx', 'npx'], [gemini({ shell: shell(), stars: npx('github-stars-cache') })]);

add('h2-073-split-shell-fetch', 'high', [], SRC.cursor, 'multi-client',
  'Cursor has a shell and Claude Desktop has fetch. The legs are on different clients, so this is not AE-009 (S1, H1).',
  ['multi-client', 'uvx'], [
    cursor({ shell: shell() }),
    desktop({ fetch: fetch() }),
  ]);

add('h2-074-split-shell-browser', 'high', [], SRC.vscode, 'multi-client',
  'VS Code has a shell and Windsurf has Playwright. Split across clients (S1, H1).',
  ['multi-client', 'npx', 'uvx'], [
    vscode({ shell: shell() }),
    windsurf({ playwright: playwright() }),
  ]);

add('h2-075-split-e2b-slack', 'high', [], SRC.cline, 'multi-client',
  'Cline has the code interpreter and Cursor has default Slack. Each is high alone, and they do not combine (S1, H1, H3).',
  ['multi-client', 'npx'], [
    cline({ e2b: e2b() }),
    cursor({ slack: slackPkg() }),
  ]);

add('h2-076-home-files-postgres', 'high', [], SRC.filesystem, 'filesystem-broad',
  'Home-rooted files are high. Postgres on the same client is a read, not an outbound leg (H2, M1).',
  ['npx'], [cursor({ filesystem: files(HOME), postgres: postgres() })]);

add('h2-077-yolo-files-shell-off', 'high', [], SRC.cursorCli, 'approval-bypass',
  'approvalMode is unrestricted, the shell entry is disabled, and files are rooted at home. A bypass does not raise a file grant (N5, H2, N4).',
  ['approval-bypass', 'disabled', 'npx'], [
    cursorYolo(),
    cursor({ filesystem: files(HOME), shell: off(shell()) }),
  ]);

add('h2-078-declared-bash', 'high', [], SRC.cursor, 'declared-tools',
  'Declared run_bash on a private node server is observed shell, with prompting left on (H1).',
  ['adversarial'], [cursor({ helper: tools(nodeCmd('helper.js'), ['run_bash']) })]);

add('h2-079-slack-and-memory', 'high', [], SRC.slack, 'slack-package',
  'Default Slack is high. Memory adds nothing (H3).',
  ['npx'], [desktop({ slack: slackPkg(), memory: memory() })]);

add('h2-080-gmail-and-time', 'high', [], SRC.gmail, 'gmail-docker',
  'Gmail package reads and sends inside Gmail. Time adds nothing (H3).',
  ['npx', 'uvx'], [lmstudio({ gmail: gmailPkg(), time: time() })]);

add('h2-081-shell-fetch', 'critical', ['AE-009'], SRC.fetch, 'fetch-uvx',
  'Shell plus fetch on Cursor. Fetch is network and untrusted content (C1).',
  ['npx', 'uvx'], [cursor({ shell: npx('mcp-server-shell'), fetch: fetch() })]);

add('h2-082-commander-playwright', 'critical', ['AE-009'], SRC.playwright, 'playwright-npx',
  'Desktop Commander plus Playwright. Browser is outbound and untrusted (C1).',
  ['npx'], [desktop({ commander: commander(), playwright: playwright() })]);

add('h2-083-shell-slack', 'critical', ['AE-009'], SRC.slack, 'slack-package',
  'Shell plus default Slack. Messaging send is an outbound leg (C1).',
  ['npx', 'uvx'], [vscode({ shell: shell(), slack: slackPkg() })]);

add('h2-084-commands-jira', 'critical', ['AE-009'], SRC.atlassian, 'atlassian-url',
  'Command server plus the Atlassian host. Jira is untrusted content (C1).',
  ['npx', 'remote-url'], [windsurf({
    commands: commands(),
    atlassian: remote('https://mcp.atlassian.com/v1/mcp'),
  })]);

add('h2-085-shell-linear', 'critical', ['AE-009'], SRC.linear, 'linear-url',
  'Shell plus the Linear host. Linear is an issue tracker (C1).',
  ['uvx', 'remote-url'], [cline({
    shell: shell(),
    linear: remote('https://mcp.linear.app/mcp'),
  })]);

add('h2-086-e2b-fetch', 'critical', ['AE-009'], SRC.e2b, 'e2b-npx',
  'Codex code interpreter plus fetch. Code execution meets untrusted network content (C1).',
  ['npx', 'uvx'], [codex({ servers: { e2b: e2b(), fetch: fetch() } })]);

add('h2-087-shell-brave', 'critical', ['AE-009'], SRC.servers, 'brave-search',
  'Shell plus Brave Search. Search is network and untrusted content (C1).',
  ['uvx', 'npx'], [gemini({ shell: shell(), brave: brave() })]);

add('h2-088-cline-approve-shell', 'critical', ['AE-009'], SRC.cline, 'approval-bypass',
  'Cline autoApprove lists execute_command on the shell package, so prompting is off (C1, S3).',
  ['approval-bypass', 'npx'], [cline({ shell: approve(npx('mcp-server-shell'), ['execute_command']) })]);

add('h2-089-claude-bypass-shell', 'critical', ['AE-009'], SRC.claudeSettings, 'approval-bypass',
  'Claude Code bypassPermissions on the same client as a shell (C1, S3).',
  ['approval-bypass', 'uvx'], [claudeBypass(), claudeUser({ shell: shell() })]);

add('h2-090-codex-never-shell', 'critical', ['AE-009'], SRC.codex, 'approval-bypass',
  'Codex approval_policy never with a shell (C1, S3).',
  ['approval-bypass', 'uvx'], [codex({ approval: 'never', servers: { shell: shell() } })]);

add('h2-091-cursor-yolo-commander', 'critical', ['AE-009'], SRC.cursorCli, 'approval-bypass',
  'Cursor approvalMode unrestricted with Desktop Commander (C1, S3).',
  ['approval-bypass', 'npx'], [cursorYolo(), cursor({ commander: commander() })]);

add('h2-092-files-github-npx', 'critical', ['AE-012'], SRC.github, 'github-npx',
  'Scoped files plus the GitHub npm package (C4).',
  ['npx'], [cursor({ filesystem: files(DOCS), github: githubPkg() })]);

add('h2-093-files-github-image', 'critical', ['AE-012'], SRC.github, 'github-docker',
  'Scoped files plus the GitHub container image (C4).',
  ['npx', 'docker'], [desktop({
    filesystem: files(DOCS),
    github: docker('ghcr.io/github/github-mcp-server'),
  })]);

add('h2-094-files-github-host', 'critical', ['AE-012'], SRC.github, 'github-host',
  'Scoped files plus api.githubcopilot.com (C4).',
  ['npx', 'remote-url'], [vscode({
    filesystem: files(DOCS),
    github: remote('https://api.githubcopilot.com/mcp'),
  })]);

add('h2-095-files-example-host', 'critical', ['AE-012'], SRC.filesystem, 'remote-url',
  'Scoped files plus a non-loopback MCP host that is not in the catalog (C4).',
  ['npx', 'remote-url'], [windsurf({
    filesystem: files(DOCS),
    remote: remote('https://mcp.example.com/mcp'),
  })]);

add('h2-096-files-stripe', 'critical', ['AE-012'], SRC.stripe, 'stripe-url',
  'Scoped files plus the Stripe host. The host is a non-loopback destination (C4).',
  ['npx', 'remote-url'], [cursor({
    filesystem: files(DOCS),
    stripe: remote('https://mcp.stripe.com/mcp'),
  })]);

add('h2-097-postgres-fetch', 'critical', ['AE-011'], SRC.postgres, 'postgres-npx',
  'Postgres read plus fetch. Fetch is a separate outbound leg (C2).',
  ['npx', 'uvx'], [desktop({ postgres: postgres(), fetch: fetch() })]);

add('h2-098-sqlite-playwright', 'critical', ['AE-011'], SRC.playwright, 'sqlite-uvx',
  'Sqlite read plus Playwright. The browser is a separate outbound leg (C2).',
  ['uvx', 'npx'], [cline({ sqlite: sqlite(), playwright: playwright() })]);

add('h2-099-gdrive-shell', 'critical', ['AE-011'], SRC.gdrive, 'gdrive-npx',
  'Drive read plus a shell. The shell is a separate outbound leg (C2).',
  ['npx', 'uvx'], [gemini({ gdrive: gdrive(), shell: shell() })]);

add('h2-100-notion-slack', 'critical', ['AE-011'], SRC.notion, 'notion-url',
  'Notion read plus Slack send on another server (C2).',
  ['remote-url', 'npx'], [cursor({
    notion: remote('https://mcp.notion.com/mcp'),
    slack: slackPkg(),
  })]);

add('h2-101-postgres-slack', 'critical', ['AE-011'], SRC.slack, 'slack-package',
  'Postgres read plus Slack send (C2).',
  ['npx'], [vscode({ postgres: postgres(), slack: slackPkg() })]);

add('h2-102-github-shell', 'critical', ['AE-011'], SRC.github, 'github-npx',
  'GitHub read plus a shell. The shell is separate from the GitHub connection (C2).',
  ['npx', 'uvx'], [windsurf({ github: githubPkg(), shell: shell() })]);

add('h2-103-postgres-jira', 'critical', ['AE-014'], SRC.atlassian, 'atlassian-url',
  'Postgres plus the Atlassian host on another server (C3).',
  ['npx', 'remote-url'], [desktop({
    postgres: postgres(),
    atlassian: remote('https://mcp.atlassian.com/v1/mcp'),
  })]);

add('h2-104-notion-linear', 'critical', ['AE-014'], SRC.linear, 'linear-url',
  'Notion read plus Linear untrusted content on another server (C3).',
  ['remote-url'], [cursor({
    notion: remote('https://mcp.notion.com/mcp'),
    linear: remote('https://mcp.linear.app/mcp'),
  })]);

add('h2-105-sqlite-bypass', 'critical', ['AE-014'], SRC.claudeSettings, 'approval-bypass',
  'Sqlite plus Claude Code bypassPermissions, with no shell (C3, S3).',
  ['approval-bypass', 'uvx'], [claudeBypass(), claudeUser({ sqlite: sqlite() })]);

add('h2-106-gdrive-never', 'critical', ['AE-014'], SRC.codex, 'approval-bypass',
  'Drive plus Codex approval_policy never, with no shell. Time grants nothing (C3, S3, N1).',
  ['approval-bypass', 'npx', 'uvx'], [codex({ approval: 'never', servers: { drive: gdrive(), clock: uvx('mcp-server-time') } })]);

add('h2-107-notion-yolo', 'critical', ['AE-014'], SRC.cursorCli, 'approval-bypass',
  'Notion plus Cursor approvalMode unrestricted, with no shell. Memory grants nothing (C3, S3, N1).',
  ['approval-bypass', 'remote-url'], [
    cursorYolo(),
    cursor({ notion: remote('https://mcp.notion.com/mcp'), recall: npx('@modelcontextprotocol/server-memory@latest') }),
  ]);

add('h2-108-slack-approve-read', 'critical', ['AE-014'], SRC.cline, 'approval-bypass',
  'Cline autoApprove names list_channels on Slack, which drops the send and still turns prompting off on a sensitive read (C3, M1, S3).',
  ['approval-bypass', 'npx'], [cline({ slack: approve(slackPkg(), ['list_channels']) })]);

add('h2-109-tools-bash-browser', 'critical', ['AE-009'], SRC.playwright, 'declared-tools',
  'Declared run_bash and browser_navigate on one private server. Shell meets browser network (C1).',
  ['adversarial'], [cursor({
    helper: tools(nodeCmd('helper.js'), ['run_bash', 'browser_navigate']),
  })]);

add('h2-110-read-file-remote', 'critical', ['AE-012'], SRC.cursor, 'remote-url',
  'Declared read_file plus a non-loopback URL on that server (C4).',
  ['remote-url', 'adversarial'], [desktop({
    files: tools(remote('https://files.example.com/mcp'), ['read_file']),
  })]);

add('h2-111-creds-shell-fetch', 'critical', ['EP-B', 'AE-009'], SRC.fetch, 'declared-tools',
  'Declared read_secrets and execute_command, plus fetch. Credential, execution, and network (C5, C1).',
  ['uvx', 'adversarial'], [vscode({
    helper: tools(nodeCmd('helper.js'), ['read_secrets', 'execute_command']),
    fetch: fetch(),
  })]);

add('h2-112-kubernetes', 'critical', ['EP-B'], SRC.kubernetes, 'kubernetes-npx',
  'kubernetes-mcp-server grants shell, network, and credential together (C5).',
  ['npx'], [cursor({ cluster: kube() })]);

add('h2-113-kubernetes-memory', 'critical', ['EP-B'], SRC.kubernetes, 'kubernetes-npx',
  'Kubernetes catalog role still holds execution, credential, and network when memory is also configured (C5).',
  ['npx'], [desktop({ kubernetes: kube(), memory: memory() })]);

add('h2-114-cursor-user-and-project', 'critical', ['AE-009'], SRC.cursor, 'cursor-mcp',
  'Shell is in the Cursor user file and fetch is in the Cursor project file. Same client (C1, S2).',
  ['uvx'], [
    cursor({ shell: shell() }),
    projectCursor({ fetch: fetch() }),
  ]);

add('h2-115-cursor-chain-claude-memory', 'critical', ['AE-009'], SRC.claudeMcp, 'multi-client',
  'Cursor holds shell and fetch. Claude Desktop holds only memory (C1, N1).',
  ['multi-client', 'npx', 'uvx'], [
    cursor({ shell: npx('mcp-server-shell'), fetch: fetch() }),
    desktop({ memory: memory() }),
  ]);

add('h2-116-docker-commander-fetch', 'critical', ['AE-009'], SRC.commander, 'desktop-commander',
  'Desktop Commander image plus uvx fetch (C1).',
  ['docker', 'uvx'], [copilot({
    commander: docker('mcp/desktop-commander'),
    fetch: fetch(),
  })]);

add('h2-117-postgres-version-fetch', 'critical', ['AE-011'], SRC.postgres, 'postgres-npx',
  'Postgres package with an @latest suffix, plus pinned uvx fetch. Normalization keeps both catalog hits (C2).',
  ['npx', 'uvx'], [junie({
    postgres: npx('@modelcontextprotocol/server-postgres@latest'),
    fetch: uvx('mcp-server-fetch==0.6.2'),
  })]);

add('h2-118-docker-files-github-host', 'critical', ['AE-012'], SRC.filesystem, 'filesystem-docker',
  'Docker filesystem image with a scoped mount, plus the GitHub host (C4).',
  ['docker', 'remote-url'], [amazonq({
    filesystem: dockerFiles(),
    github: remote('https://api.githubcopilot.com/mcp'),
  })]);

add('h2-119-shell-gmail', 'critical', ['AE-009'], SRC.gmail, 'gmail-docker',
  'Shell plus the Gmail package. Email is untrusted content and a send leg (C1).',
  ['uvx', 'npx'], [zed({ shell: shell(), gmail: gmailPkg() })]);

add('h2-120-e2b-jira', 'critical', ['AE-009'], SRC.atlassian, 'atlassian-url',
  'Code interpreter plus the Atlassian host (C1).',
  ['npx', 'remote-url'], [cline({
    e2b: e2b(),
    atlassian: remote('https://mcp.atlassian.com/v1/mcp'),
  })]);

add('h2-121-postgres-playwright', 'critical', ['AE-011'], SRC.playwright, 'playwright-npx',
  'Postgres plus Playwright (C2).',
  ['npx'], [windsurf({ postgres: postgres(), playwright: playwright() })]);

add('h2-122-fetch-disabled-shell-slack', 'critical', ['AE-009'], SRC.slack, 'disabled-servers',
  'Fetch is disabled. Shell and Slack remain, so messaging send still meets the shell (N5, C1).',
  ['disabled', 'npx', 'uvx'], [cursor({
    fetch: off(fetch()),
    shell: shell(),
    slack: slackPkg(),
  })]);

add('h2-123-slack-read-and-shell', 'critical', ['AE-011'], SRC.slack, 'slack-read-only',
  'Slack lists only conversations_history, so the send is dropped, and a shell is the separate outbound leg (M1, C2).',
  ['npx', 'uvx'], [desktop({
    slack: tools(slackPkg(), ['conversations_history']),
    shell: shell(),
  })]);

add('h2-124-files-github-readonly', 'critical', ['AE-012'], SRC.github, 'github-npx',
  'Scoped files plus the GitHub package started with --readOnly. The flag drops a send, not the GitHub destination (C4).',
  ['npx'], [cursor({
    filesystem: files(DOCS),
    github: npx('@modelcontextprotocol/server-github', '--readOnly'),
  })]);

add('h2-125-claude-jira-cursor-files', 'critical', ['AE-014'], SRC.postgres, 'multi-client',
  'Claude Code has postgres and Jira. Cursor has only scoped files. The critical chain is on Claude Code (C3, S1).',
  ['multi-client', 'npx', 'remote-url'], [
    claudeUser({
      postgres: postgres(),
      atlassian: remote('https://mcp.atlassian.com/v1/mcp'),
    }),
    cursor({ filesystem: files(DOCS) }),
  ]);

add('h2-126-files-notion-host', 'critical', ['AE-012'], SRC.notion, 'notion-url',
  'Scoped files plus the Notion host. A data-read host is still a destination for local files (C4).',
  ['npx', 'remote-url'], [gemini({
    filesystem: files(DOCS),
    notion: remote('https://mcp.notion.com/mcp'),
  })]);

add('h2-127-password-shell-fetch', 'critical', ['EP-B', 'AE-009'], SRC.onepassword, 'password-manager',
  '1Password package, shell, and fetch. Credential access meets execution and network (C5, C1).',
  ['npx', 'uvx'], [vscode({
    onepassword: onepass(),
    shell: shell(),
    fetch: fetch(),
  })]);

add('h2-128-files-slack-send', 'critical', ['EP-A'], SRC.slack, 'slack-package',
  'Scoped files plus default Slack send. Readable files have a messaging destination (C6).',
  ['npx'], [copilot({ filesystem: files(DOCS), slack: slackPkg() })]);

function liveNames(servers) {
  return Object.entries(servers || {})
    .filter(([, spec]) => spec && spec.disabled !== true && spec.enabled !== false)
    .map(([name]) => name)
    .sort();
}

function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderContinue(servers) {
  const lines = ['mcpServers:'];
  for (const [name, spec] of Object.entries(servers)) {
    lines.push(`  - name: ${quote(name)}`);
    if (spec.command) lines.push(`    command: ${quote(spec.command)}`);
    if (spec.url) lines.push(`    url: ${quote(spec.url)}`);
    if (Array.isArray(spec.args)) {
      lines.push('    args:');
      for (const arg of spec.args) lines.push(`      - ${quote(arg)}`);
    }
    if (spec.disabled === true) lines.push('    disabled: true');
    if (spec.enabled === false) lines.push('    enabled: false');
  }
  return `${lines.join('\n')}\n`;
}

function renderGoose(extensions) {
  const lines = ['extensions:'];
  for (const [key, spec] of Object.entries(extensions)) {
    lines.push(`  ${key}:`);
    lines.push(`    enabled: ${spec.enabled === false ? 'false' : 'true'}`);
    lines.push(`    type: ${spec.type}`);
    lines.push(`    name: ${quote(spec.name || key)}`);
    if (spec.cmd) lines.push(`    cmd: ${quote(spec.cmd)}`);
    if (Array.isArray(spec.args)) {
      lines.push('    args:');
      for (const arg of spec.args) lines.push(`      - ${quote(arg)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderCodex(part) {
  const lines = [];
  if (part.approval) lines.push(`approval_policy = ${quote(part.approval)}`);
  for (const [name, spec] of Object.entries(part.servers)) {
    lines.push('');
    lines.push(`[mcp_servers.${name}]`);
    if (spec.command) lines.push(`command = ${quote(spec.command)}`);
    if (Array.isArray(spec.args)) lines.push(`args = [${spec.args.map(quote).join(', ')}]`);
    if (spec.url) lines.push(`url = ${quote(spec.url)}`);
    if (spec.disabled === true) lines.push('disabled = true');
    if (spec.enabled === false) lines.push('enabled = false');
  }
  return `${lines.join('\n')}\n`;
}

function renderPart(part) {
  if (part.kind === 'mcp') return JSON.stringify({ mcpServers: part.servers }, null, 2);
  if (part.kind === 'vscode') return JSON.stringify({ servers: part.servers }, null, 2);
  if (part.kind === 'vscode-settings') return JSON.stringify({ mcp: { servers: part.servers } }, null, 2);
  if (part.kind === 'zed') return JSON.stringify({ context_servers: part.servers }, null, 2);
  if (part.kind === 'continue') return renderContinue(part.servers);
  if (part.kind === 'goose') return renderGoose(part.extensions);
  if (part.kind === 'codex') return renderCodex(part);
  if (part.kind === 'json') return JSON.stringify(part.body, null, 2);
  throw new Error(`unknown part kind ${part.kind}`);
}

function parseServers(part, text) {
  const fake = text.split('{{HOME}}').join('/tmp/boppi-h2-home').split('{{CWD}}').join('/tmp/boppi-h2-home/work/repo');
  if (part.kind === 'mcp') return parse.mapServers(JSON.parse(fake).mcpServers);
  if (part.kind === 'vscode' || part.kind === 'vscode-settings') return parse.vscodeServers(JSON.parse(fake));
  if (part.kind === 'zed') return parse.zedServers(JSON.parse(fake));
  if (part.kind === 'continue') return parse.continueServers(fake);
  if (part.kind === 'goose') return parse.gooseServers(fake);
  if (part.kind === 'codex') return parse.codexServers(fake);
  if (part.kind === 'json') {
    JSON.parse(fake);
    return {};
  }
  throw new Error(`unknown part kind ${part.kind}`);
}

function expectedFrom(part) {
  if (part.kind === 'goose') {
    return Object.entries(part.extensions)
      .filter(([, spec]) => spec.enabled !== false)
      .map(([key, spec]) => spec.name || key)
      .sort();
  }
  if (part.kind === 'json') return [];
  return liveNames(part.servers);
}

function walkKeys(value, found) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, found);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|password|private[_-]?key/i.test(key)) found.push(key);
    walkKeys(child, found);
  }
}

function corpusSignatures() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'corpus', 'manifest.json'), 'utf8'));
  const signatures = new Set();
  for (const entry of manifest.cases || []) {
    const servers = entry.servers || {};
    const rows = Object.entries(servers).map(([name, spec]) => `${name}|${spec.command || ''}|${JSON.stringify(spec.args || [])}|${spec.url || ''}|${JSON.stringify(spec.tools || [])}`).sort();
    signatures.add(rows.join('\n'));
  }
  return signatures;
}

function assertCatalog() {
  const hits = [
    '@modelcontextprotocol/server-filesystem', 'mcp/filesystem', 'mcp-server-fetch', '@playwright/mcp@latest',
    '@brave/brave-search-mcp-server@latest', 'mcp-server-shell', '@agent-infra/mcp-server-commands',
    '@wonderwhy-er/desktop-commander', 'mcp/desktop-commander', 'e2b-code-interpreter', 'kubernetes-mcp-server@latest',
    '@modelcontextprotocol/server-postgres@latest', 'mcp-server-sqlite', '@modelcontextprotocol/server-gdrive',
    '@modelcontextprotocol/server-slack', '@modelcontextprotocol/server-github', 'ghcr.io/github/github-mcp-server',
    'ghcr.io/mcparmory/google-gmail', 'mcparmory-google-gmail', '@takescake/1password-mcp', 'mcp-server-git',
    '@modelcontextprotocol/server-memory', '@modelcontextprotocol/server-memory@latest',
    '@modelcontextprotocol/server-everything@latest', '@modelcontextprotocol/server-gdrive@latest',
    '@modelcontextprotocol/server-github@latest', 'mcp-server-time', '@modelcontextprotocol/server-sequential-thinking',
    '@modelcontextprotocol/server-everything', 'mcp-server-fetch==0.6.2',
  ];
  const misses = ['research-notes', 'github-stars-cache', 'price-fetch', 'sandbox-helper', 'obsidian-vault', 'filesystem-backup-helper', 'slack-notifier-cache'];
  for (const token of hits) {
    if (!matchIdentity(token)) throw new Error(`catalog miss for intended hit ${token}`);
  }
  for (const token of misses) {
    if (matchIdentity(token)) throw new Error(`catalog hit for intended lookalike ${token}`);
  }
}

function build() {
  assertCatalog();
  const errors = [];
  const ids = new Set();
  const signatures = corpusSignatures();
  const traitCounts = {};
  const severityCounts = {};
  const renderedCases = [];

  if (cases.length < 120) errors.push(`only ${cases.length} cases`);
  for (const entry of cases) {
    if (ids.has(entry.id)) errors.push(`duplicate id ${entry.id}`);
    ids.add(entry.id);
    if (!/^h2-\d{3}-[a-z0-9-]+$/.test(entry.id)) errors.push(`bad id ${entry.id}`);
    if (!entry.source || !/^https:\/\//.test(entry.source)) errors.push(`missing source ${entry.id}`);
    if (!Array.isArray(entry.expectedCriticalCombos)) errors.push(`combos ${entry.id}`);
    for (const combo of entry.expectedCriticalCombos) {
      if (!COMBOS.has(combo)) errors.push(`bad combo ${combo} on ${entry.id}`);
    }
    const critical = entry.expectedHighest === 'critical';
    if (critical !== entry.expectedCriticalCombos.length > 0) errors.push(`combo mismatch ${entry.id}`);
    if (!['none', 'medium', 'high', 'critical'].includes(entry.expectedHighest)) errors.push(`severity ${entry.id}`);
    severityCounts[entry.expectedHighest] = (severityCounts[entry.expectedHighest] || 0) + 1;
    for (const trait of entry.traits) traitCounts[trait] = (traitCounts[trait] || 0) + 1;

    const files = {};
    const seen = new Set();
    const signatureRows = [];
    for (const part of entry.parts) {
      if (seen.has(part.file)) errors.push(`duplicate file ${part.file} on ${entry.id}`);
      seen.add(part.file);
      const text = renderPart(part);
      if (text.includes('\u2013') || text.includes('\u2014') || entry.rationale.includes('\u2013') || entry.rationale.includes('\u2014')) {
        errors.push(`dash in ${entry.id}`);
      }
      files[part.file] = text;
      let parsed;
      try { parsed = parseServers(part, text); } catch (error) {
        errors.push(`parse ${entry.id} ${part.file}: ${error.message}`);
        continue;
      }
      const got = Object.keys(parsed).sort();
      const want = expectedFrom(part);
      if (got.join(',') !== want.join(',')) errors.push(`servers ${entry.id} ${part.file}: got ${got.join(',') || '(none)'} want ${want.join(',') || '(none)'}`);
      for (const [name, spec] of Object.entries(parsed)) {
        signatureRows.push(`${name}|${spec.command || ''}|${JSON.stringify(spec.args || [])}|${spec.url || ''}|${JSON.stringify(spec.tools || [])}`);
        const forbidden = [];
        walkKeys(spec, forbidden);
        if (forbidden.length) errors.push(`forbidden key ${forbidden.join(',')} on ${entry.id}`);
      }
    }
    const signature = signatureRows.sort().join('\n');
    if (signature && signatures.has(signature)) errors.push(`corpus overlap ${entry.id}`);
    renderedCases.push({
      id: entry.id,
      family: entry.family,
      source: entry.source,
      expectedHighest: entry.expectedHighest,
      expectedCriticalCombos: entry.expectedCriticalCombos,
      rationale: entry.rationale,
      traits: entry.traits,
      files,
    });
  }

  const benign = (severityCounts.none || 0) + (severityCounts.medium || 0);
  const minimums = {
    benign, 'multi-client': traitCounts['multi-client'] || 0, disabled: traitCounts.disabled || 0,
    'approval-bypass': traitCounts['approval-bypass'] || 0, 'remote-url': traitCounts['remote-url'] || 0,
    npx: traitCounts.npx || 0, uvx: traitCounts.uvx || 0, docker: traitCounts.docker || 0,
    adversarial: traitCounts.adversarial || 0,
  };
  const floors = {
    benign: 30, 'multi-client': 6, disabled: 5, 'approval-bypass': 8, 'remote-url': 8,
    npx: 10, uvx: 8, docker: 4, adversarial: 6,
  };
  for (const [key, floor] of Object.entries(floors)) {
    if (minimums[key] < floor) errors.push(`${key} ${minimums[key]} is below ${floor}`);
  }

  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const document = {
    version: 2,
    sealed: true,
    labeledOn: '2026-11-24',
    rubric: 'test/heldout-v2/RUBRIC.md',
    description: 'Fresh sealed homes for the detection engine. Labels come from RUBRIC.md. The harness prints aggregates only.',
    cases: renderedCases,
  };
  const out = path.join(__dirname, 'cases.json');
  fs.writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${renderedCases.length} cases`);
  console.log(`severity ${JSON.stringify(severityCounts)}`);
  console.log(`traits ${JSON.stringify(minimums)}`);
}

build();
