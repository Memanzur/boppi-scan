/**
 * boppi ask: one question, or a short chat, answered by the Boppi API.
 * The request is the question plus redacted findings from the local scan.
 * File contents, keys, and tokens are removed before anything is sent.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SENSITIVE_VALUE, CREDENTIAL_URI } = require('./discovery/secrets');
const { remediationForEngineFinding } = require('./autoFix');

const DEFAULT_ORIGIN = 'https://beta.boppi.io';
const ASK_PATH = '/api/ai/ask';
const PRIVACY_NOTE = 'This sends your question and redacted findings to the Boppi API. File contents, keys, and tokens are not sent.';
const CLOSED = new Set(['resolved', 'accepted_risk', 'false_positive']);
const TEXT_KEYS = ['answer', 'text', 'message', 'content', 'delta'];

function noticePath(home) {
  return path.join(home, '.boppi', 'ask-notice');
}

/** The one-line note, written once per scan home. Returns '' after the first time. */
function privacyNote(home) {
  const file = noticePath(home);
  if (fs.existsSync(file)) return '';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, new Date().toISOString() + '\n', { mode: 0o600 });
  } catch (_) { /* still show the note; the next run may show it again */ }
  return PRIVACY_NOTE;
}

function redactText(value) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const secret = new RegExp(SENSITIVE_VALUE.source, 'gi');
  const uri = new RegExp(CREDENTIAL_URI.source, 'gi');
  return text.replace(secret, '[redacted]').replace(uri, '[redacted]').slice(0, 2000);
}

function remediationOf(remediation, fallbackId) {
  const source = remediation && typeof remediation === 'object' ? remediation : {};
  const steps = Array.isArray(source.steps) ? source.steps.map(step => redactText(step)).slice(0, 8) : [];
  return {
    summary: redactText(source.summary || ''),
    steps,
    autoFixable: source.autoFixable === true,
    fixId: redactText(source.fixId || fallbackId || ''),
  };
}

function shapeFinding(input) {
  return {
    id: redactText(input.id),
    title: redactText(input.title),
    severity: redactText(input.severity || 'low'),
    category: redactText(input.category || ''),
    tool: redactText(input.tool || ''),
    remediation: remediationOf(input.remediation, input.id),
  };
}

function findingsFromScan(scan) {
  const inventory = scan && scan.inventory ? scan.inventory : {};
  const names = new Map((inventory.agents || []).map(agent => [agent.id, agent.name]));
  const findings = [];
  for (const finding of inventory.findings || []) {
    if (CLOSED.has(finding.status)) continue;
    findings.push(shapeFinding({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      tool: names.get(finding.agentId) || '',
      remediation: finding.remediation || remediationForEngineFinding(finding),
    }));
  }
  for (const finding of (scan && scan.configFindings) || []) {
    findings.push(shapeFinding({
      id: finding.fixId || finding.id,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      tool: finding.tool,
      remediation: finding.remediation || {
        summary: finding.summary,
        steps: finding.steps,
        autoFixable: finding.autoFixable,
        fixId: finding.fixId,
      },
    }));
  }
  return findings;
}

function contextTurns(context) {
  if (!Array.isArray(context)) return [];
  return context.slice(-8).map(turn => ({
    question: redactText(turn && turn.question),
    answer: redactText(turn && turn.answer),
  })).filter(turn => turn.question || turn.answer);
}

function buildPayload({ question, findings, context }) {
  const body = {
    question: redactText(question),
    findings: (findings || []).map(shapeFinding),
  };
  const turns = contextTurns(context);
  if (turns.length) body.context = turns;
  return body;
}

function resolveAskUrl(input) {
  const raw = (input || DEFAULT_ORIGIN).trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error(`BOPPI_API_URL is not a valid URL: ${input}`); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('BOPPI_API_URL must use https (http is allowed only for localhost)');
  const pathName = url.pathname.replace(/\/+$/, '');
  if (pathName === ASK_PATH) return url.toString();
  if (pathName && pathName !== '') throw new Error('BOPPI_API_URL must be the API origin or end in /api/ai/ask');
  url.pathname = ASK_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function originOf(askUrl) {
  const url = new URL(askUrl);
  return `${url.protocol}//${url.host}`;
}

function textFromJson(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  for (const key of TEXT_KEYS) if (typeof value[key] === 'string') return value[key];
  return '';
}

function ssePiece(line) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed.startsWith('data:')) return '';
  const data = trimmed.slice(5).replace(/^ /, '');
  if (!data || data === '[DONE]') return '';
  if (data.startsWith('{') || data.startsWith('"')) {
    try { return textFromJson(JSON.parse(data)); } catch (_) { return data; }
  }
  return data;
}

async function readBody(response) {
  if (!response.body || typeof response.body.getReader !== 'function') return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    text += decoder.decode(step.value, { stream: true });
  }
  return text + decoder.decode();
}

/** Print a streamed answer. SSE data lines and plain text are written as they arrive. */
async function writeAnswer(response, write) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) {
    const text = textFromJson(JSON.parse(await readBody(response)));
    if (text) write(text);
    return text;
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (text) write(text);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = type.includes('text/event-stream');
  let pending = '';
  let all = '';
  const emit = (piece) => {
    if (!piece) return;
    all += piece;
    write(piece);
  };
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    const chunk = decoder.decode(step.value, { stream: true });
    if (!sse) {
      emit(chunk);
      continue;
    }
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) emit(ssePiece(line));
  }
  const tail = decoder.decode();
  if (sse) {
    if (tail) pending += tail;
    if (pending) emit(ssePiece(pending));
  } else if (tail) emit(tail);
  return all;
}

async function askOnce({ question, findings, context, apiUrl, fetchImpl, write }) {
  const payload = buildPayload({ question, findings, context });
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream, text/plain, application/json', 'user-agent': 'boppi-cli' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    return { ok: false, message: `Could not reach the Boppi API at ${originOf(apiUrl)}. Check your connection and try again.` };
  }
  if (!response.ok) {
    try { await readBody(response); } catch (_) { /* ignore a failed error body */ }
    return { ok: false, message: `The Boppi API returned ${response.status}. Nothing else was sent.` };
  }
  try {
    const text = await writeAnswer(response, write || (() => {}));
    return { ok: true, text };
  } catch (_) {
    return { ok: false, message: 'The Boppi API response could not be read. Nothing else was sent.' };
  }
}

async function chat({ findings, apiUrl, fetchImpl, readLine, write, writeErr }) {
  const out = write || (chunk => process.stdout.write(chunk));
  const err = writeErr || (line => process.stderr.write(line));
  const context = [];
  while (true) {
    const line = String(await readLine()).trim();
    if (!line || line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit') return 0;
    const result = await askOnce({ question: line, findings, context, apiUrl, fetchImpl, write: out });
    if (!result.ok) {
      err(result.message + '\n');
      return 1;
    }
    if (result.text && !result.text.endsWith('\n')) out('\n');
    context.push({ question: line, answer: result.text || '' });
  }
}

module.exports = {
  DEFAULT_ORIGIN,
  ASK_PATH,
  PRIVACY_NOTE,
  privacyNote,
  redactText,
  findingsFromScan,
  buildPayload,
  resolveAskUrl,
  askOnce,
  chat,
  ssePiece,
};
