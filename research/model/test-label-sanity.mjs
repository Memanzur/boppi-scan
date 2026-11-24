#!/usr/bin/env node
// Unit tests for the label sanity filter. No scan, no generated data.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reviewCase, isSingleServerCatalogLaunch, isReferenceEntry, REFERENCE_IDS } from './lib/labelSanity.mjs';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catalog = require(path.join(root, 'src', 'cli', 'mcpCatalog.js'));
const secrets = require(path.join(root, 'src', 'cli', 'discovery', 'secrets.js'));

const review = (config, findings, extra = {}) => reviewCase({ config, findings, catalog, secrets, ...extra });
const ids = result => result.reasons;

const memory = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] };
const seq = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] };
const time = { command: 'uvx', args: ['mcp-server-time'] };
const thinking = { command: 'uvx', args: ['mcp-sequential-thinking==0.1.0'] };
const everything = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] };

for (const [token, needle] of [
  ['@modelcontextprotocol/server-memory', 'memory'],
  ['@modelcontextprotocol/server-sequential-thinking', 'sequential-thinking'],
  ['mcp-server-time', 'time'],
  ['mcp-sequential-thinking', 'mcp-sequential-thinking'],
  ['@modelcontextprotocol/server-everything', 'everything'],
]) {
  const hit = catalog.matchIdentity(token);
  assert.ok(hit, token);
  assert.ok(isReferenceEntry(hit.entry), `${token} -> ${hit.entry.id}`);
  assert.ok(REFERENCE_IDS.includes(needle));
}
assert.equal(isReferenceEntry(catalog.matchIdentity('mcp-server-fetch').entry), false);
assert.equal(catalog.matchIdentity('research-notes'), null);

function unknown(server) {
  return [{ rule_id: 'BOPPI-UNKNOWN-SERVER', severity: 'high', servers: [server] }];
}

for (const [name, spec] of [['mem', memory], ['seq', seq], ['clock', time], ['think', thinking], ['all', everything]]) {
  const config = { mcpServers: { [name]: spec } };
  assert.ok(ids(review(config, unknown(name))).includes('false_unknown_server'), name);
}

// A reference server with no unknown finding is not a false unknown.
// autoApprove keeps it from being a catalog-only launch, which is the shape
// left once the rules engine stops emitting the bug.
const memoryKept = { mcpServers: { mem: { ...memory, autoApprove: ['read'] } } };
assert.deepEqual(ids(review(memoryKept, [])), []);

// Unknown on a server that is not in the catalog stays. That label is not this bug.
const custom = { mcpServers: { notes: { command: 'npx', args: ['-y', 'research-notes'] } } };
assert.deepEqual(ids(review(custom, unknown('notes'))), []);

// The false unknown is dropped even when a real finding sits beside it.
const mixed = {
  mcpServers: {
    shell: { command: 'npx', args: ['-y', 'mcp-server-commands'], autoApprove: ['run_command'] },
    mem: memory,
  },
};
const mixedFindings = [
  { rule_id: 'AE-010', severity: 'high', servers: ['shell'] },
  { rule_id: 'BOPPI-UNKNOWN-SERVER', severity: 'high', servers: ['mem'] },
];
assert.ok(ids(review(mixed, mixedFindings)).includes('false_unknown_server'));
assert.equal(isSingleServerCatalogLaunch(mixed, catalog), false);

// Version pin that the secret heuristic treats as a token, and a bare package name.
const pin = { mcpServers: { skills: { command: 'uvx', args: ['broke2built-skills-mcp==0.6.6'] } } };
assert.ok(ids(review(pin, [{ rule_id: 'BOPPI-PLAINTEXT-SECRET', severity: 'critical', servers: ['skills'] }])).includes('false_plaintext_secret'));
const bare = { mcpServers: { skills: { command: 'npx', args: ['-y', 'broke2built-skills-mcp'] } } };
assert.ok(ids(review(bare, [{ rule_id: 'BOPPI-PLAINTEXT-SECRET', severity: 'medium', servers: ['skills'] }])).includes('false_plaintext_secret'));

// ${env:...} is a reference, not a stored secret. A real token is kept.
const envRef = { mcpServers: { notion: { command: 'npx', args: ['-y', 'notion-mcp'], env: { NOTION_TOKEN: '${env:NOTION_TOKEN}' } } } };
assert.ok(ids(review(envRef, [{ rule_id: 'BOPPI-PLAINTEXT-SECRET', severity: 'medium', servers: ['notion'] }])).includes('false_plaintext_secret'));
const real = { mcpServers: { notion: { command: 'npx', args: ['-y', 'notion-mcp'], env: { OPENAI_API_KEY: `sk-${'a'.repeat(24)}` } } } };
assert.equal(ids(review(real, [{ rule_id: 'BOPPI-PLAINTEXT-SECRET', severity: 'critical', servers: ['notion'] }])).includes('false_plaintext_secret'), false);
assert.equal(secrets.isInlineSecret(real.mcpServers.notion.env.OPENAI_API_KEY), true);

// A passed fix that leaves the package unpinned is not a training target.
const fetchCfg = { mcpServers: { fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch'] } } };
const unpinned = review(fetchCfg, [{ rule_id: 'AE-009', severity: 'critical', servers: ['fetch'] }], {
  fixKept: true,
  afterFindings: [{ rule_id: 'BOPPI-UNPINNED-PACKAGE', severity: 'medium', servers: ['fetch'] }],
});
assert.ok(ids(unpinned).includes('fix_passed_still_unpinned'));
const cleared = review(fetchCfg, [{ rule_id: 'AE-009', severity: 'critical', servers: ['fetch'] }], {
  fixKept: true,
  afterFindings: [],
});
assert.equal(ids(cleared).includes('fix_passed_still_unpinned'), false);
assert.equal(ids(review(fetchCfg, [{ rule_id: 'BOPPI-UNPINNED-PACKAGE', severity: 'medium', servers: ['fetch'] }], { fixKept: false, afterFindings: [{ rule_id: 'BOPPI-UNPINNED-PACKAGE', servers: ['fetch'] }] })).includes('fix_passed_still_unpinned'), false);

// Single-server catalog launches are out of both splits. Extra behavior stays.
assert.equal(isSingleServerCatalogLaunch({ mcpServers: { seq: seq } }, catalog), true);
assert.equal(isSingleServerCatalogLaunch({ mcpServers: { seq: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking@1.2.3'] } } }, catalog), true);
assert.equal(isSingleServerCatalogLaunch({ mcpServers: { gh: { url: 'https://api.githubcopilot.com/mcp' } } }, catalog), true);
assert.equal(isSingleServerCatalogLaunch({ mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/dev/projects/app'] } } }, catalog), false);
assert.equal(isSingleServerCatalogLaunch({ mcpServers: { seq: { ...seq, env: { LOG_LEVEL: 'info' } } } }, catalog), false);
assert.equal(isSingleServerCatalogLaunch({ mcpServers: { a: seq, b: memory } }, catalog), false);
assert.equal(isSingleServerCatalogLaunch(custom, catalog), false);
assert.ok(ids(review({ mcpServers: { seq: seq } }, [])).includes('single_server_catalog_launch'));

console.log('label sanity checks passed');
