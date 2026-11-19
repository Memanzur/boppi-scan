#!/usr/bin/env node
/** boppi ask sends redacted findings only, streams the reply, and fails softly when the API is down. */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ask = require('../src/cli/ask');
const { ASK_LINE, CLOSING_LINE } = require('../src/cli/render/terminal');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

const SECRET = 'sk-thisisafakesecretvalue123456';
const TOKEN = 'bpc_live_token_value_123456';
const URI = 'postgres://admin:pw_secret_test@db.example.test/app';
const FILE_BODY = 'FULL FILE BODY do not send';

function runCli(args, home, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], {
      env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', BOPPI_TOKEN: TOKEN, ...env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: { fetch: { command: 'npx', args: ['-y', 'mcp-server-fetch@1.2.3'], env: { OPENAI_API_KEY: SECRET } } },
  }, null, 2) + '\n');
  return home;
}

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function fakeResponse(chunks, contentType) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: name => (name.toLowerCase() === 'content-type' ? contentType : '') },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: new TextEncoder().encode(chunks[index++]) };
          },
        };
      },
    },
  };
}

(async function main() {
  section('redaction');
  const shaped = ask.findingsFromScan({
    inventory: {
      agents: [{ id: 'agent-1', name: 'Cursor' }],
      findings: [
        { id: 'finding-1', title: `leaked ${SECRET}`, severity: 'critical', category: 'credential_exposure', agentId: 'agent-1', status: 'open', ruleId: 'AE-002', recommendation: 'Remove it', description: FILE_BODY, contents: FILE_BODY },
        { id: 'finding-2', title: 'already handled', severity: 'low', category: 'other', agentId: 'agent-1', status: 'resolved', ruleId: 'AE-006', recommendation: 'Done' },
      ],
    },
    configFindings: [{
      fixId: 'plaintext-secret:demo',
      title: `header ${TOKEN}`,
      severity: 'high',
      category: 'plaintext_secret',
      tool: 'Cursor',
      summary: `see ${URI}`,
      steps: ['rotate'],
      autoFixable: true,
      file: FILE_BODY,
    }],
  });
  const payload = ask.buildPayload({ question: `keep ${SECRET} and ${URI}?`, findings: shaped, context: [{ question: `token ${TOKEN}`, answer: 'no' }] });
  const packed = JSON.stringify(payload);
  ok('secrets and credential URLs are stripped from the question, findings, and context', !packed.includes(SECRET) && !packed.includes(TOKEN) && !packed.includes('pw_secret_test') && packed.includes('[redacted]'));
  ok('file contents and extra finding fields are not in the payload', !packed.includes(FILE_BODY) && payload.findings.length === 2 && payload.findings.every(finding => Object.keys(finding).sort().join() === 'category,id,remediation,severity,title,tool') && payload.findings.every(finding => Object.keys(finding.remediation).sort().join() === 'autoFixable,fixId,steps,summary'));
  ok('the API URL is the origin plus /api/ai/ask, and a full path is not doubled', ask.resolveAskUrl('https://beta.boppi.io') === 'https://beta.boppi.io/api/ai/ask' && ask.resolveAskUrl('http://127.0.0.1:9/api/ai/ask') === 'http://127.0.0.1:9/api/ai/ask');

  section('stream');
  const pieces = [];
  const streamed = await ask.askOnce({
    question: 'what first',
    findings: shaped,
    apiUrl: 'http://127.0.0.1:9/api/ai/ask',
    fetchImpl: async () => fakeResponse(['data: Check\n', 'data: the filesystem.\n\n'], 'text/event-stream'),
    write: chunk => pieces.push(chunk),
  });
  ok('SSE chunks are printed in order as they arrive', streamed.ok && pieces.join('') === 'Checkthe filesystem.' && streamed.text === 'Checkthe filesystem.');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-ask-'));
  const home = makeHome(root);
  const bodies = [];
  const server = await listen((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(raw || '{}');
      bodies.push({ url: req.url, method: req.method, body: parsed, raw });
      if (String(parsed.question || '').includes('fail')) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`boom ${SECRET}`);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: Check\n');
      res.write('data: the filesystem.\n\n');
      res.end();
    });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  section('one question');
  const first = await runCli(['ask', `should I keep ${SECRET} in ${URI}?`], home, { BOPPI_API_URL: base });
  ok('ask prints the streamed answer and the privacy note once', first.code === 0 && first.stdout.includes('Checkthe filesystem.') && first.stderr.includes(ask.PRIVACY_NOTE));
  ok('the request is POST /api/ai/ask and the body has no secret, token, or file body', bodies.length === 1 && bodies[0].method === 'POST' && bodies[0].url === '/api/ai/ask' && !bodies[0].raw.includes(SECRET) && !bodies[0].raw.includes(TOKEN) && !bodies[0].raw.includes('pw_secret_test') && !bodies[0].raw.includes(FILE_BODY));
  ok('stdout and stderr do not echo the secret', !first.stdout.includes(SECRET) && !first.stderr.includes(SECRET) && !first.stdout.includes(TOKEN));
  const second = await runCli(['ask', 'what next'], home, { BOPPI_API_URL: base });
  ok('the privacy note is not repeated', second.code === 0 && !second.stderr.includes(ask.PRIVACY_NOTE) && fs.existsSync(path.join(home, '.boppi', 'ask-notice')));

  section('errors');
  const failedCall = await runCli(['ask', 'please fail this'], home, { BOPPI_API_URL: base });
  ok('an API error is one line and does not include the response body', failedCall.code === 1 && failedCall.stderr.includes('returned 500') && !failedCall.stderr.includes(SECRET) && !failedCall.stdout.includes(SECRET));
  await new Promise(resolve => server.close(resolve));
  const offline = await runCli(['ask', 'hello'], home, { BOPPI_API_URL: base });
  ok('an unreachable API is reported without a stack trace', offline.code === 1 && offline.stderr.includes('Could not reach the Boppi API') && !offline.stderr.includes('Error:') && !offline.stdout.includes(SECRET));
  const missing = await runCli(['ask'], home, { BOPPI_API_URL: base });
  ok('ask with no question and no terminal exits 2', missing.code === 2 && missing.stderr.includes('ask needs a question'));
  const badUrl = await runCli(['ask', 'hello'], home, { BOPPI_API_URL: 'not a url' });
  ok('a bad BOPPI_API_URL exits 2', badUrl.code === 2 && badUrl.stderr.includes('BOPPI_API_URL'));

  section('chat');
  const chatBodies = [];
  const chatServer = await listen((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      chatBodies.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ answer: `reply ${chatBodies.length}` }));
    });
  });
  const chatUrl = ask.resolveAskUrl(`http://127.0.0.1:${chatServer.address().port}`);
  const lines = [`where is ${SECRET}?`, 'what next', 'exit'];
  const written = [];
  const chatCode = await ask.chat({
    findings: shaped,
    apiUrl: chatUrl,
    fetchImpl: globalThis.fetch,
    readLine: async () => lines.shift(),
    write: chunk => written.push(chunk),
    writeErr: () => {},
  });
  await new Promise(resolve => chatServer.close(resolve));
  ok('chat asks until exit and sends prior turns as context', chatCode === 0 && written.join('') === 'reply 1\nreply 2\n' && chatBodies.length === 2 && chatBodies[1].context && chatBodies[1].context[0].question.includes('[redacted]') && !JSON.stringify(chatBodies).includes(SECRET));

  section('scan offer');
  const scan = await runCli(['scan'], home);
  const last = scan.stdout.trimEnd().split('\n').pop();
  ok('a plain scan offers ask and still ends with the team line', scan.code === 0 && scan.stdout.includes(ASK_LINE) && last.startsWith(CLOSING_LINE));
  const quiet = await runCli(['scan', '--quiet'], home);
  ok('quiet output does not add the ask line', !quiet.stdout.includes(ASK_LINE) && quiet.stdout.trim().split('\n').length <= 2);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
