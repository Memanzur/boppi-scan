#!/usr/bin/env node
/** Verify suite for the known-server catalog: exact identity matching and the evidence basis on every capability. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CATALOG, identityOf, matchCatalog } = require('../src/cli/serverCatalog');
const { inferCapabilities } = require('../src/cli/knownServers');

let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const ALLOWED = new Set(['filesystem_access', 'shell_access', 'code_execution', 'browser_automation', 'untrusted_external_content', 'network_access', 'credential_access', 'environment_access']);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-catalog-verify-'));
const docs = path.join(home, 'docs');
fs.mkdirSync(docs);
const idOf = server => matchCatalog(server)?.entry.id || null;

section('Catalog shape');
ok('about 25 entries', CATALOG.length >= 25);
ok('entry ids are unique', new Set(CATALOG.map(e => e.id)).size === CATALOG.length);
ok('every entry has label, match, capabilities, tools, dataAccess, docs', CATALOG.every(e => e.label && e.match && Array.isArray(e.capabilities) && Array.isArray(e.tools) && e.tools.length && typeof e.dataAccess === 'string' && e.dataAccess.length && /^https:\/\//.test(e.docs)));
ok('capabilities use only the existing capability strings', CATALOG.every(e => e.capabilities.every(c => ALLOWED.has(c))));
ok('no identity is claimed by two entries', (() => { const seen = new Set(); for (const e of CATALOG) for (const [kind, names] of Object.entries(e.match)) for (const n of names) { const k = `${kind}:${n}`; if (seen.has(k)) return false; seen.add(k); } return true; })());
ok('the catalog is frozen', Object.isFrozen(CATALOG));

section('Exact identity matching');
ok('npx <pkg>', idOf({ command: 'npx', args: ['@modelcontextprotocol/server-filesystem', docs] }) === 'mcp-filesystem');
ok('npx -y <pkg>', idOf({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', docs] }) === 'mcp-filesystem');
ok('npx -y <pkg>@version', idOf({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2025.8.21', docs] }) === 'mcp-filesystem');
ok('an absolute path to npx still matches', idOf({ command: '/usr/local/bin/npx', args: ['-y', 'firecrawl-mcp'] }) === 'firecrawl-mcp');
ok('uvx <pkg>', idOf({ command: 'uvx', args: ['mcp-server-fetch'] }) === 'mcp-fetch');
ok('uvx <pkg>@version', idOf({ command: 'uvx', args: ['mcp-server-git@0.6.2', '--repository', docs] }) === 'mcp-git');
ok('uvx --from <pkg> <bin>', idOf({ command: 'uvx', args: ['--from', 'mcp-server-time', 'mcp-server-time'] }) === 'mcp-time');
ok('docker run ... <image>', idOf({ command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'] }) === 'github-mcp-server');
ok('docker image tag is ignored', idOf({ command: 'docker', args: ['run', '-i', '--rm', 'mcp/fetch:latest'] }) === 'mcp-fetch');
ok('url host', idOf({ url: 'https://mcp.context7.com/mcp' }) === 'context7');
ok('url host with a port and a path', idOf({ url: 'https://mcp.sentry.dev:443/mcp?x=1' }) === 'sentry-mcp');
ok('identityOf reports the kind and name', JSON.stringify(identityOf({ command: 'uvx', args: ['mcp-server-fetch'] })) === JSON.stringify({ kind: 'pypi', name: 'mcp-server-fetch' }));

section('Near misses never match');
ok('a package that merely contains a catalog name', idOf({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem-extra'] }) === null);
ok('a scoped look-alike', idOf({ command: 'npx', args: ['-y', '@someone/server-filesystem'] }) === null);
ok('a pypi name run through npx is not an npm match', idOf({ command: 'npx', args: ['-y', 'mcp-server-fetch'] }) === null);
ok('a docker image on another registry', idOf({ command: 'docker', args: ['run', '-i', 'example.com/mcp/fetch'] }) === null);
ok('a subdomain of a catalog host', idOf({ url: 'https://evil.mcp.context7.com/mcp' }) === null);
ok('a bare command with no package argument', idOf({ command: 'node', args: ['server.js'] }) === null);
ok('npx with only flags', idOf({ command: 'npx', args: ['-y'] }) === null);

section('Inference: catalog first, name rules add what the catalog lacks, every capability has a basis');
const fsInference = inferCapabilities('filesystem', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', docs] }, { home });
ok('filesystem capability comes from the catalog', fsInference.capabilityEvidence.some(e => e.capability === 'filesystem_access' && e.basis === 'catalog' && e.matched === '@modelcontextprotocol/server-filesystem'));
ok('catalog tools populate tools', fsInference.tools.includes('read_file') && fsInference.tools.includes('write_file'));
ok('the catalog entry is returned', fsInference.catalog && fsInference.catalog.id === 'mcp-filesystem');
ok('the name rule is not credited for a capability the catalog already named', !fsInference.inferences.some(i => i.label === 'file access server'));
ok('directory arguments are still recorded', fsInference.filesystemPaths.length === 1);

const commander = inferCapabilities('commander', { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] }, { home });
ok('a catalog server gets exactly the catalog capabilities when the name rules agree', commander.capabilities.join() === 'shell_access' && commander.capabilityEvidence.every(e => e.basis === 'catalog'));

const browserish = inferCapabilities('puppeteer-commander', { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] }, { home });
ok('a server name matching a name rule adds capabilities the catalog lacks, labeled inferred', browserish.capabilities.includes('browser_automation') && browserish.capabilityEvidence.find(e => e.capability === 'browser_automation').basis === 'inferred' && browserish.capabilityEvidence.find(e => e.capability === 'shell_access').basis === 'catalog');

const configured = inferCapabilities('custom', { command: 'node', args: ['s.js', docs], capabilities: ['code_execution'] }, { home });
ok('a capabilities array in the config is configured evidence', configured.capabilityEvidence.find(e => e.capability === 'code_execution').basis === 'configured');
ok('an existing directory argument is configured evidence', configured.capabilityEvidence.find(e => e.capability === 'filesystem_access').basis === 'configured');

const remote = inferCapabilities('remote', { url: 'https://example.test/mcp' }, { home });
ok('a url is configured evidence for network access', remote.capabilityEvidence.length === 1 && remote.capabilityEvidence[0].capability === 'network_access' && remote.capabilityEvidence[0].basis === 'configured');

const unknown = inferCapabilities('my-weird-thing', { command: 'node', args: ['thing.js'] }, { home });
ok('an unknown server has no capabilities, no catalog, no tools', unknown.capabilities.length === 0 && unknown.catalog === null && unknown.tools.length === 0 && unknown.capabilityEvidence.length === 0);

const regexOnly = inferCapabilities('fetch', { command: 'npx', args: ['-y', 'some-fetch-thing'] }, { home });
ok('a server only the name rules know is labeled inferred', regexOnly.capabilities.length > 0 && regexOnly.capabilityEvidence.every(e => e.basis === 'inferred'));

const all = [fsInference, commander, browserish, configured, remote, unknown, regexOnly];
ok('capabilityEvidence covers every capability exactly once', all.every(r => r.capabilities.length === r.capabilityEvidence.length && r.capabilities.every(c => r.capabilityEvidence.filter(e => e.capability === c).length === 1)));
ok('every inference carries a basis', all.every(r => r.inferences.every(i => ['configured', 'catalog', 'inferred'].includes(i.basis))));

section('The scanner keeps evidence and tools on the normalized record');
const scanner = require('../src/engine/localMcpScanner');
const { enrich } = require('../src/cli/simulate');
const { config } = enrich({ filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', docs], env: { GITHUB_TOKEN: 'x' } } }, home);
const result = scanner.scanConfig({ source: 'claude-desktop', consent: true, dryRun: true, config, configPath: path.join(home, 'c.json') });
const record = result.records[0];
ok('exposedTools carries the catalog tools', record.exposedTools.includes('read_file'));
ok('every capability on the record has evidence', record.capabilities.every(c => record.capabilityEvidence.some(e => e.capability === c)));
ok('env-derived capabilities are configured evidence', ['environment_access', 'credential_access'].every(c => record.capabilityEvidence.find(e => e.capability === c)?.basis === 'configured'));
ok('catalog evidence survives normalization', record.capabilityEvidence.find(e => e.capability === 'filesystem_access').basis === 'catalog');
const graph = require('../src/engine/securityGraph').buildGraph({ agents: [result.agent], integrations: [], permissions: [], mcpServers: result.records });
ok('catalog tool reach is inferred in the graph', graph.edges.filter(edge => edge.relationshipType === 'mcp_exposes_tool').every(edge => edge.evidenceClass === 'inferred' && edge.confidence <= 0.7));
ok('catalog filesystem reach is inferred in the graph', graph.edges.filter(edge => edge.relationshipType === 'permission_grants_data_access').every(edge => edge.evidenceClass === 'inferred'));

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
