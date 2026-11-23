#!/usr/bin/env node
/** Sensitive-read exfiltration and the shell trust-boundary rule. No network. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const parse = require('../src/cli/discovery/parse');
const { inferCapabilities } = require('../src/cli/knownServers');
const { clientInventory } = require('../src/cli/simulate');
const { CATALOG } = require('../src/cli/mcpCatalog');
const cli = require('../src/cli/boppi');
const risk = require('../src/engine/agentRiskEngine');
const securityGraph = require('../src/engine/securityGraph');
const exposure = require('../src/engine/exposurePathEngine');

let passed = 0;
let failed = 0;
function ok(name, condition) {
  if (condition) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-exfil-'));
fs.mkdirSync(path.join(home, 'notes'), { recursive: true });

function scan(servers) {
  const inventory = clientInventory({
    mergedServers: parse.mapServers(servers),
    clientKey: 'cursor',
    label: 'Cursor',
    source: 'cursor',
    configPath: path.join(home, 'case.json'),
    observedAt: '2026-11-19T00:00:00.000Z',
    home,
  });
  const assessed = risk.assess(inventory.agents[0], inventory.permissions, inventory.mcpServers, { now: '2026-11-19T00:00:00.000Z' });
  const paths = exposure.findPaths(securityGraph.buildGraph({
    agents: inventory.agents, integrations: [], permissions: inventory.permissions, mcpServers: inventory.mcpServers,
  }));
  const severities = new Set();
  for (const finding of assessed.findings) {
    if (!finding.status || finding.status === 'open') severities.add(finding.severity);
  }
  for (const item of paths) severities.add(item.severity);
  return { severities, servers: inventory.mcpServers, findings: assessed.findings };
}

function openFindings(findings) {
  return (findings || []).filter(finding => !finding.status || finding.status === 'open');
}

function citesData(result) {
  return openFindings(result.findings).some(finding => (finding.evidence || []).some(item => item.category === 'access_customer_data'));
}

function ruleIds(result) {
  return new Set(openFindings(result.findings).map(finding => finding.ruleId));
}

const postgres = inferCapabilities('db', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] }, { home });
ok('postgres is a sensitive read and not a network leg', postgres.capabilities.includes('sensitive_read') && !postgres.capabilities.includes('network_access') && postgres.capabilityGrades.sensitive_read === 'allowlist');
const mysql = inferCapabilities('db', { command: 'npx', args: ['-y', 'mysql'] }, { home });
ok('mysql command is a sensitive read', mysql.capabilities.includes('sensitive_read') && mysql.capabilityGrades.sensitive_read === 'allowlist');
const mongo = inferCapabilities('db', { command: 'npx', args: ['-y', '@infoinlet/mcp-mongodb'] }, { home });
ok('mongodb package is a sensitive read', mongo.capabilities.includes('sensitive_read'));
const mssql = inferCapabilities('db', { command: 'npx', args: ['-y', '@connorbritain/mssql-mcp-server'] }, { home });
ok('mssql package is a sensitive read', mssql.capabilities.includes('sensitive_read'));
const slack = inferCapabilities('chat', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] }, { home });
ok('slack can read history and send messages', slack.capabilities.includes('sensitive_read') && slack.capabilities.includes('messaging_send') && !slack.capabilities.includes('network_access'));
const gmail = inferCapabilities('mail', { command: 'uvx', args: ['mcparmory-google-gmail'] }, { home });
ok('gmail can read, send, and ingest untrusted mail', gmail.capabilities.includes('sensitive_read') && gmail.capabilities.includes('messaging_send') && gmail.capabilities.includes('untrusted_external_content'));
const wiki = inferCapabilities('wiki', { url: 'https://mcp.atlassian.com/v2/mcp' }, { home });
ok('confluence host is a sensitive read', wiki.capabilities.includes('sensitive_read') && wiki.capabilityGrades.sensitive_read === 'allowlist');
ok('a vendor that is not in the catalog is not a cited package', !CATALOG.some(entry => JSON.stringify(entry.packages || []).includes('@zereight/')));

const alone = scan({ db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] } });
ok('a database alone is not critical', !alone.severities.has('critical') && alone.severities.has('medium'));
const notion = scan({ notes: { url: 'https://mcp.notion.com/mcp' } });
ok('notion alone is not critical', !notion.severities.has('critical'));
const chained = scan({
  db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
});
ok('database plus fetch is critical exfiltration', chained.severities.has('critical'));
const browser = scan({
  drive: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'] },
  browser: { command: 'npx', args: ['-y', '@playwright/mcp'] },
});
ok('drive plus browser is critical exfiltration', browser.severities.has('critical'));
const slackShell = scan({
  db: { command: 'npx', args: ['-y', 'mcp-server-sqlite'] },
  chat: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
});
ok('database plus slack send is critical exfiltration', slackShell.severities.has('critical'));
const shellData = scan({
  db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-redis'] },
  shell: { command: 'npx', args: ['-y', 'mcp-server-commands'] },
});
ok('database plus shell is critical exfiltration', shellData.severities.has('critical'));

const everything = inferCapabilities('everything', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] }, { home });
ok('the reference everything server grants nothing', everything.capabilities.length === 0);
const readOnlySlack = inferCapabilities('chat', {
  url: 'https://mcp.slack.com/mcp',
  tools: [{ name: 'conversations_history' }, { name: 'list_channels' }],
}, { home });
ok('slack with only read tools does not send', readOnlySlack.capabilities.includes('sensitive_read') && !readOnlySlack.capabilities.includes('messaging_send'));
const replyThread = inferCapabilities('chat', {
  url: 'https://mcp.slack.com/mcp',
  tools: [{ name: 'reply_to_thread' }],
}, { home });
ok('reply_to_thread maps to messaging send', replyThread.capabilities.includes('messaging_send') && replyThread.capabilityGrades.messaging_send === 'observed');
const postMessage = inferCapabilities('bot', {
  command: 'node',
  args: ['bot.js'],
  tools: [{ name: 'post_message' }],
}, { home });
ok('post_message maps to messaging send', postMessage.capabilities.includes('messaging_send') && postMessage.capabilityGrades.messaging_send === 'observed');
const camelReply = inferCapabilities('chat', {
  url: 'https://mcp.slack.com/mcp',
  tools: [{ name: 'replyToThread' }],
}, { home });
ok('replyToThread maps to messaging send', camelReply.capabilities.includes('messaging_send'));
const replyChain = scan({
  db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
  chat: { url: 'https://mcp.slack.com/mcp', tools: [{ name: 'reply_to_thread' }] },
});
ok('database plus reply_to_thread is critical', replyChain.severities.has('critical') && citesData(replyChain));
const readOnlyDb = scan({ db: { command: 'npx', args: ['-y', 'mongodb-mcp-server', '--readOnly'] } });
ok('a read-only database is not critical', !readOnlyDb.severities.has('critical'));
const scopedNotion = scan({ notes: { url: 'https://mcp.notion.com/mcp' } });
ok('scoped notion URL is not critical', !scopedNotion.severities.has('critical'));
fs.mkdirSync(path.join(home, 'src'), { recursive: true });
const filesToGithub = scan({
  repo: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'src')] },
  github: { url: 'https://api.githubcopilot.com/mcp/' },
});
ok('local files plus a GitHub host are critical', filesToGithub.severities.has('critical'));
const filesToGithubNpx = scan({
  repo: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'src')] },
  github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
});
ok('local files plus the GitHub npx package are critical', filesToGithubNpx.severities.has('critical') && ruleIds(filesToGithubNpx).has('AE-012'));
const filesToGithubImage = scan({
  repo: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'src')] },
  github: { command: 'docker', args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'] },
});
ok('local files plus the GitHub container image are critical', filesToGithubImage.severities.has('critical') && ruleIds(filesToGithubImage).has('AE-012'));
const githubNpxAlone = scan({ github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } });
ok('the GitHub npx package alone stays medium', githubNpxAlone.severities.has('medium') && !githubNpxAlone.severities.has('critical') && citesData(githubNpxAlone));
const filesAndLocalGit = scan({
  repo: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'src')] },
  git: { command: 'uvx', args: ['mcp-server-git', '--repository', path.join(home, 'src')] },
});
ok('a local git server is not a remote file destination', !filesAndLocalGit.severities.has('critical'));
const githubAlone = scan({ github: { url: 'https://api.githubcopilot.com/mcp/' } });
ok('a GitHub host alone is not critical', !githubAlone.severities.has('critical'));
const disabled = scan({
  live: { command: 'uvx', args: ['mcp-server-time'] },
  gone: { command: 'npx', args: ['-y', 'mcp-server-commands'], disabled: true },
});
ok('a disabled shell is not a finding', !disabled.severities.has('critical') && !disabled.severities.has('high'));

const slackAlone = scan({ chat: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] } });
ok('one workspace read and send is high, not critical', slackAlone.severities.has('high') && !slackAlone.severities.has('critical'));
const gmailAlone = scan({ mail: { command: 'uvx', args: ['mcparmory-google-gmail'] } });
ok('one mailbox that can read and send is high, not critical', gmailAlone.severities.has('high') && !gmailAlone.severities.has('critical'));
const slackFetch = scan({
  chat: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
});
ok('workspace send plus a separate outbound server is critical', slackFetch.severities.has('critical'));
const shellAndSlack = scan({
  chat: { url: 'https://mcp.slack.com/mcp' },
  shell: { command: 'npx', args: ['-y', 'mcp-server-commands'] },
});
ok('shell plus workspace send is critical', shellAndSlack.severities.has('critical'));

const bare = scan({ shell: { command: 'npx', args: ['-y', 'mcp-server-commands'] } });
ok('a bare shell stays high', bare.severities.has('high') && !bare.severities.has('critical'));
const prompted = scan({
  shell: { command: 'npx', args: ['-y', 'mcp-server-shell'] },
  issues: { command: 'npx', args: ['-y', 'jira'] },
});
ok('shell plus an issue tracker is critical', prompted.severities.has('critical'));
const approved = scan({
  shell: { command: 'npx', args: ['-y', 'mcp-server-commands'], autoApprove: ['run'] },
});
ok('shell plus autoApprove is critical', approved.severities.has('critical'));
const fetchShell = scan({
  shell: { command: 'shell' },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
});
ok('shell plus fetch is still critical', fetchShell.severities.has('critical'));

const dbJira = scan({
  db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
  issues: { command: 'npx', args: ['-y', 'jira'] },
});
ok('database plus jira raises severity and still cites the database', dbJira.severities.has('critical') && citesData(dbJira) && ruleIds(dbJira).has('AE-014') && !ruleIds(dbJira).has('AE-008'));
const dbApprove = scan({
  db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], autoApprove: ['query'] },
});
ok('database plus autoApprove raises severity and still cites the database', dbApprove.severities.has('critical') && citesData(dbApprove) && ruleIds(dbApprove).has('AE-014'));
const jiraAlone = scan({ issues: { command: 'npx', args: ['-y', 'jira'] } });
ok('jira alone still emits a finding and is not critical', jiraAlone.findings.length > 0 && !jiraAlone.severities.has('critical'));

function severitiesOf(scanResult) {
  const severities = new Set();
  for (const finding of (scanResult.inventory && scanResult.inventory.findings) || []) {
    if (!finding.status || finding.status === 'open') severities.add(finding.severity);
  }
  for (const item of scanResult.paths || []) severities.add(item.severity);
  return severities;
}

(async function main() {
  const codeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-bypass-'));
  fs.mkdirSync(path.join(codeHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(codeHome, '.claude.json'), JSON.stringify({
    mcpServers: { shell: { command: 'npx', args: ['-y', 'mcp-server-commands'] } },
  }));
  fs.writeFileSync(path.join(codeHome, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions' },
  }));
  const bypassed = await cli.performScan({ home: codeHome, cwd: codeHome, platform: 'darwin', only: ['claude-code'] });
  const bypassSeverities = severitiesOf(bypassed);
  ok('Claude Code bypassPermissions makes a shell critical', !bypassed.failed && bypassSeverities.has('critical'));

  fs.writeFileSync(path.join(codeHome, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'default' },
  }));
  const promptedScan = await cli.performScan({ home: codeHome, cwd: codeHome, platform: 'darwin', only: ['claude-code'] });
  const promptedSeverities = severitiesOf(promptedScan);
  ok('Claude Code with prompting left on keeps the shell high', promptedSeverities.has('high') && !promptedSeverities.has('critical'));

  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-codex-'));
  fs.mkdirSync(path.join(codexHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, '.codex', 'config.toml'), [
    'approval_policy = "never"',
    '',
    '[mcp_servers.shell]',
    'command = "npx"',
    'args = ["-y", "mcp-server-commands"]',
    '',
  ].join('\n'));
  const codexScan = await cli.performScan({ home: codexHome, cwd: codexHome, platform: 'darwin', only: ['codex'] });
  ok('Codex approval_policy never makes a shell critical', !codexScan.failed && severitiesOf(codexScan).has('critical'));

  const cursorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-cursor-'));
  fs.mkdirSync(path.join(cursorHome, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(cursorHome, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: { shell: { command: 'npx', args: ['-y', 'mcp-server-commands'] } },
  }));
  fs.writeFileSync(path.join(cursorHome, '.cursor', 'cli-config.json'), JSON.stringify({
    version: 1, approvalMode: 'unrestricted',
  }));
  const cursorScan = await cli.performScan({ home: cursorHome, cwd: cursorHome, platform: 'darwin', only: ['cursor'] });
  ok('Cursor unrestricted approval makes a shell critical', !cursorScan.failed && severitiesOf(cursorScan).has('critical'));
  const listed = (cursorScan.discovery && cursorScan.discovery.filesRead) || [];
  ok('the cursor yolo file is listed as read', listed.some(file => file.endsWith(path.join('.cursor', 'cli-config.json'))));

  function citesScanData(scanResult) {
    const findings = ((scanResult.inventory && scanResult.inventory.findings) || []).filter(finding => !finding.status || finding.status === 'open');
    return findings.length > 0 && findings.some(finding => (finding.evidence || []).some(item => item.category === 'access_customer_data'));
  }

  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-data-bypass-'));
  fs.mkdirSync(path.join(dataHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dataHome, '.claude.json'), JSON.stringify({
    mcpServers: { db: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] } },
  }));
  fs.writeFileSync(path.join(dataHome, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions' },
  }));
  const dataBypass = await cli.performScan({ home: dataHome, cwd: dataHome, platform: 'darwin', only: ['claude-code'] });
  ok('Claude Code bypassPermissions plus a database is critical and the database is emitted', !dataBypass.failed && severitiesOf(dataBypass).has('critical') && citesScanData(dataBypass));

  const codexDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-codex-data-'));
  fs.mkdirSync(path.join(codexDataHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(codexDataHome, '.codex', 'config.toml'), [
    'approval_policy = "never"',
    '',
    '[mcp_servers.db]',
    'command = "npx"',
    'args = ["-y", "@modelcontextprotocol/server-postgres"]',
    '',
  ].join('\n'));
  const codexData = await cli.performScan({ home: codexDataHome, cwd: codexDataHome, platform: 'darwin', only: ['codex'] });
  ok('Codex approval_policy never plus a database is critical and the database is emitted', !codexData.failed && severitiesOf(codexData).has('critical') && citesScanData(codexData));

  const cursorDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-cursor-data-'));
  fs.mkdirSync(path.join(cursorDataHome, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(cursorDataHome, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: { notes: { url: 'https://mcp.notion.com/mcp' } },
  }));
  fs.writeFileSync(path.join(cursorDataHome, '.cursor', 'cli-config.json'), JSON.stringify({
    version: 1, approvalMode: 'unrestricted',
  }));
  const cursorData = await cli.performScan({ home: cursorDataHome, cwd: cursorDataHome, platform: 'darwin', only: ['cursor'] });
  ok('Cursor unrestricted plus Notion is critical and the read is emitted', !cursorData.failed && severitiesOf(cursorData).has('critical') && citesScanData(cursorData));

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(codeHome, { recursive: true, force: true });
  fs.rmSync(codexHome, { recursive: true, force: true });
  fs.rmSync(cursorHome, { recursive: true, force: true });
  fs.rmSync(dataHome, { recursive: true, force: true });
  fs.rmSync(codexDataHome, { recursive: true, force: true });
  fs.rmSync(cursorDataHome, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
