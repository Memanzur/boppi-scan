#!/usr/bin/env node
/** Verify suite for boppi push: record mapping, URL rules, the HTTP request it sends, and how failures read. */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const push = require('../src/cli/push');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function makeFixtureHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
      fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch', 'sb_secret_positional_test_value_123456', '--api-key', 'flagvalue_apikey_test_77', '--key=inline_key_value_test_88'] },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'SUPERSECRETVALUE' } },
    },
  }));
  return home;
}

function runCli(args, home, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { encoding: 'utf8', env: { ...process.env, BOPPI_TOKEN: '', ...env } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runCliAsync(args, home, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color'], { env: { ...process.env, BOPPI_TOKEN: '', ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

/** A stand-in workspace that records every request and answers per token. */
function startWorkspace() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = (() => { try { return JSON.parse(body); } catch (_) { return null; } })();
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, contentType: req.headers['content-type'], body: parsed });
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      res.setHeader('content-type', 'application/json');
      if (token === 'bpc_good') { res.writeHead(200); res.end(JSON.stringify({ ingested: parsed.records.length, requestId: 'req-1' })); }
      else if (token === 'bpc_down') { res.writeHead(503); res.end(JSON.stringify({ error: 'Ingest is temporarily unavailable. Retry in a minute.', requestId: 'req-2' })); }
      else { res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid or revoked collector token.', requestId: 'req-3' })); }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-push-verify-'));
  const home = makeFixtureHome(root);

  section('Record mapping follows the ingest contract');
  const exportPath = path.join(root, 'export.json');
  runCli(['scan', '--json', exportPath, '--quiet'], home);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const records = push.toRecords(exported.inventory.real);
  const kinds = new Set(records.map(r => r.kind));
  ok('one record per agent, permission, and MCP server', records.length === exported.inventory.real.agents.length + exported.inventory.real.permissions.length + exported.inventory.real.mcpServers.length);
  ok('record kinds are the contract enum values', [...kinds].every(k => ['agent', 'integration', 'permission', 'mcp_server'].includes(k)) && kinds.has('agent') && kinds.has('mcp_server') && kinds.has('permission'));
  ok('every record has the required fields', records.every(r => typeof r.external_id === 'string' && r.external_id.length && typeof r.name === 'string' && r.name.length && ['observed', 'imported', 'inferred'].includes(r.evidence_class) && typeof r.stale === 'boolean' && r.metadata && typeof r.metadata === 'object'));
  ok('confidence stays inside [0, 1] when present', records.every(r => r.confidence === undefined || (r.confidence >= 0 && r.confidence <= 1)));
  ok('permissions carry their normalization confidence, not the 0.5 default', records.filter(r => r.kind === 'permission').every(r => Number.isFinite(r.confidence)));
  ok('child records point at their agent by external id', records.filter(r => r.kind !== 'agent').every(r => records.some(a => a.kind === 'agent' && a.external_id === r.metadata.agent_external_id)));
  ok('mcp_server metadata carries capabilities and trust status', records.filter(r => r.kind === 'mcp_server').every(r => Array.isArray(r.metadata.capabilities) && typeof r.metadata.trust_status === 'string'));
  ok('no field exceeds the 512-character contract cap', records.every(r => r.external_id.length <= 512 && r.name.length <= 512 && JSON.stringify(r.metadata).length <= 65536));
  const serialized = JSON.stringify(records);
  ok('records never contain secret values or the raw home path', !serialized.includes('SUPERSECRETVALUE') && !serialized.includes('sb_secret_positional_test_value_123456') && !serialized.includes('flagvalue_apikey_test_77') && !serialized.includes('inline_key_value_test_88') && !serialized.includes(home));

  section('URL rules');
  ok('origin resolves to the ingest endpoint', push.resolveIngestUrl('https://app.boppi.io').toString() === 'https://app.boppi.io/api/ingest');
  ok('trailing slash and full ingest URL both resolve', push.resolveIngestUrl('https://app.boppi.io/').pathname === '/api/ingest' && push.resolveIngestUrl('https://app.boppi.io/api/ingest/').pathname === '/api/ingest');
  ok('default is the hosted workspace', push.resolveIngestUrl(null).toString() === 'https://app.boppi.io/api/ingest');
  ok('http is allowed for localhost only', push.resolveIngestUrl('http://localhost:3000').port === '3000' && (() => { try { push.resolveIngestUrl('http://example.com'); return false; } catch (_) { return true; } })());
  ok('an unrelated path is rejected', (() => { try { push.resolveIngestUrl('https://app.boppi.io/dashboard'); return false; } catch (_) { return true; } })());

  section('Argument handling');
  const noToken = runCli(['push', '--url', 'http://localhost:1'], home);
  ok('push without a token and without a terminal exits 2 and names every way to supply one', noToken.code === 2 && noToken.stderr.includes('--token') && noToken.stderr.includes('BOPPI_TOKEN') && noToken.stderr.includes('prompted'));
  const badUrl = runCli(['push', '--token', 'bpc_x', '--url', 'http://example.com'], home);
  ok('plain http to a remote host exits 2', badUrl.code === 2 && badUrl.stderr.includes('https'));
  const dry = runCli(['push', '--dry-run', '--url', 'http://localhost:1'], home);
  ok('--dry-run needs no token, prints the records, and sends nothing', dry.code === 0 && dry.stdout.includes('"records"') && dry.stdout.includes('Nothing was sent'));
  const dryFile = runCli(['push', '--dry-run', '--file', exportPath], home);
  ok('--file pushes an earlier export without rescanning', dryFile.code === 0 && JSON.parse(dryFile.stdout.slice(0, dryFile.stdout.lastIndexOf('}') + 1)).records.length === records.length);
  const badFile = runCli(['push', '--dry-run', '--file', path.join(root, 'missing.json')], home);
  ok('a missing --file exits 2 with the reason', badFile.code === 2 && badFile.stderr.includes('cannot read'));

  section('The request a workspace receives');
  const workspace = await startWorkspace();
  try {
    const good = await runCliAsync(['push', '--url', workspace.url], home, { BOPPI_TOKEN: 'bpc_good' });
    ok('a successful push exits 0 and reports the ingested count', good.code === 0 && good.stdout.includes('records ingested') && good.stdout.includes('/dashboard'));
    const request = workspace.requests[0];
    ok('exactly one POST to /api/ingest', workspace.requests.length === 1 && request.method === 'POST' && request.url === '/api/ingest');
    ok('token travels as a bearer header, never in the body', request.authorization === 'Bearer bpc_good' && !JSON.stringify(request.body).includes('bpc_good'));
    ok('body is a snapshot of the mapped records', request.contentType === 'application/json' && request.body.snapshot === true && request.body.records.length === records.length);
    ok('output tells the user what is and is not sent', good.stdout.includes('Only sanitized inventory metadata is sent'));

    const merged = await runCliAsync(['push', '--url', workspace.url, '--merge', '--token', 'bpc_good'], home);
    ok('--merge sends without the snapshot flag', merged.code === 0 && workspace.requests[1].body.snapshot === undefined);
    const bigInventory = { agents: [{ id: 'agent_big', name: 'Big', source: { evidenceClass: 'observed' } }], permissions: Array.from({ length: 2500 }, (_, i) => ({ id: `perm_${i}`, agentId: 'agent_big', rawPermission: `grant ${i}`, normalizedCategory: 'read_files', accessLevel: 'broad', normalizationConfidence: 0.7, source: { evidenceClass: 'inferred' } })) };
    const before = workspace.requests.length;
    const big = await push.pushRecords({ ingestUrl: push.resolveIngestUrl(workspace.url), token: 'bpc_good', records: push.toRecords(bigInventory), snapshot: false, fetchImpl: fetch });
    const bigBatches = workspace.requests.slice(before);
    ok('a merge of 2501 records goes in 1000-record batches and reports the total', big.ok && big.ingested === 2501 && bigBatches.length === 3 && bigBatches.every(r => r.body.records.length <= push.MERGE_BATCH && r.body.snapshot === undefined));

    const rejected = await runCliAsync(['push', '--url', workspace.url, '--token', 'bpc_bad'], home);
    ok('a rejected token exits 5 with the server message and a hint', rejected.code === 5 && rejected.stderr.includes('HTTP 401') && rejected.stderr.includes('Invalid or revoked') && rejected.stderr.includes('Collectors page'));
    const down = await runCliAsync(['push', '--url', workspace.url, '--token', 'bpc_down'], home);
    ok('a 503 exits 5 and suggests retrying', down.code === 5 && down.stderr.includes('HTTP 503') && down.stderr.includes('Retry'));
  } finally {
    workspace.server.close();
  }
  const unreachable = await runCliAsync(['push', '--url', 'http://127.0.0.1:9', '--token', 'bpc_good'], home);
  ok('an unreachable workspace exits 5 and says so', unreachable.code === 5 && unreachable.stderr.includes('Could not reach'));

  section('Nothing to push');
  const emptyHome = path.join(root, 'empty-home');
  fs.mkdirSync(emptyHome, { recursive: true });
  const empty = runCli(['push', '--url', 'http://127.0.0.1:9', '--token', 'bpc_good'], emptyHome);
  ok('a machine with no agent configs exits 0 without contacting the workspace', empty.code === 0 && empty.stdout.includes('Nothing to push'));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
