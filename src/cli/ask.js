/**
 * boppi ask: one question, or a short chat, about a local scan.
 *
 * The wire body matches POST /api/ai/ask: question, up to 25 findings, and an
 * optional context string. Each finding is id, title, severity, category,
 * tool, remediation, and an optional fixId. fixId is sent only when this scan
 * has that automatic fix. The CLI never runs the reply.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SENSITIVE_VALUE, CREDENTIAL_URI } = require('./discovery/secrets');
const { remediationForEngineFinding } = require('./autoFix');

const DEFAULT_ORIGIN = 'https://beta.boppi.io';
const ASK_PATH = '/api/ai/ask';
const PRIVACY_NOTE = 'This sends your question and redacted findings to the Boppi API. File contents, keys, tokens, usernames, and home paths are removed first. No session cookie is sent. The anonymous limit is 20 questions per IP per UTC day.';
const OPT_IN_DECLINE = 'Nothing was sent. Pass --yes to send, or pass --no-network to answer on this machine.';
const CLOSED = new Set(['resolved', 'accepted_risk', 'false_positive']);
const TEXT_KEYS = ['answer', 'text', 'message', 'content', 'delta'];
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const GENERIC_NAMES = new Set(['home', 'user', 'users', 'root', 'tmp', 'var', 'etc', 'usr', 'bin', 'lib', 'opt', 'scan', 'node', 'test', 'boppi', 'admin']);
const WIRE_KEYS = ['id', 'title', 'severity', 'category', 'tool', 'remediation', 'fixId'];
const LOCAL_FIX_PREFIXES = ['auto-approve:', 'plaintext-secret:', 'unknown-server:', 'unpinned-package:', 'broad-filesystem:', 'perm-mode:', 'unscoped-shell:', 'yolo-mode:', 'rotate-key:', 'world-readable:'];
const LIMITS = Object.freeze({
  bodyBytes: 96 * 1024,
  question: 2000,
  context: 2000,
  findings: 25,
  id: 200,
  title: 300,
  category: 80,
  tool: 200,
  remediation: 2000,
  fixId: 80,
});
const ASK_TIMEOUT_MS = 20000;
const MAX_RESPONSE_CHARS = 16000;
const ANON_DAILY_LIMIT = 20;
const HARMFUL_REPLY = /\b(?:curl|wget|fetch|iwr|irm|invoke-webrequest)\b[\s\S]{0,240}\|\s*(?:ba)?sh\b|\|\s*iex\b|\binvoke-expression\b|\bpowershell\b[\s\S]{0,120}-e(?:nc|ncodedcommand)\b|\brm\s+-rf\s+\//i;
const APPLIED_CLAIM = /[^.!?\n]*\b(?:auto-fixed|autofixed|already applied|already fixed|i applied|i've applied|i have applied)\b[^.!?\n]*[.!?]?/gi;
const FIX_COMMAND = /[^.!?\n]*\bnpx\s+@boppi\/cli\s+fix\b[^.!?\n]*[.!?]?/gi;
const ASSIGNED_SECRET = /(?:^|[^A-Za-z0-9])(?:api[_-]?key|apikey|secret|token|password|passwd|pwd)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{8,}/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----/gi;
const EXTRA_SECRET = /\bAIza[0-9A-Za-z\-_]{20,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bhf_[A-Za-z0-9]{20,}\b|\bhooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/gi;
const MIXED_TOKEN = /\b(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}\b/g;
const BASE64_TOKEN = /(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/g;
const HOME_PATH = /(?:^|[\s"'`(])(?:\/(?:Users|home|root)\/[A-Za-z0-9._-]{1,64}(?:\/[^\s'"`]*)?|(?:\\\\[?]\\)?[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]{1,64}(?:[\\/][^\s'"`]*)?)/g;
const USER_IN_PATH = /(?:\/(?:Users|home|root)\/|Users[\\/])([A-Za-z0-9._-]{1,64})/;

function noticePath(home) {
  return path.join(home, '.boppi', 'ask-notice');
}

function noFollowFlag() {
  return fs.constants.O_NOFOLLOW || 0;
}

function consentRecorded(home) {
  try {
    const stat = fs.lstatSync(noticePath(home));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (_) {
    return false;
  }
}

/**
 * Record opt-in. A symlink at ~/.boppi or at the marker is left untouched.
 * Returns false when the marker could not be written safely.
 */
function recordConsent(home) {
  const dir = path.join(home, '.boppi');
  const file = noticePath(home);
  try {
    let dirStat;
    try { dirStat = fs.lstatSync(dir); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = fs.lstatSync(home);
      if (parent.isSymbolicLink() || !parent.isDirectory()) return false;
      fs.mkdirSync(dir, { mode: 0o700 });
      dirStat = fs.lstatSync(dir);
    }
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false;
    try { fs.chmodSync(dir, 0o700); } catch (_) { /* the directory may already be private */ }
    let fileStat = null;
    try { fileStat = fs.lstatSync(file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (fileStat) return fileStat.isFile() && !fileStat.isSymbolicLink();
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag(), 0o600);
    try {
      fs.writeFileSync(fd, new Date().toISOString() + '\n');
      fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function privacyNote(home) {
  return consentRecorded(home) ? '' : PRIVACY_NOTE;
}

function acceptedAnswer(line) {
  const value = String(line || '').trim().toLowerCase();
  return value === 'y' || value === 'yes';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identityFor(home) {
  const usernames = [];
  const add = (name) => {
    if (typeof name !== 'string') return;
    const trimmed = name.trim();
    if (trimmed.length < 3 || GENERIC_NAMES.has(trimmed.toLowerCase())) return;
    if (!usernames.includes(trimmed)) usernames.push(trimmed);
  };
  try { add(os.userInfo().username); } catch (_) { /* no account name on this host */ }
  add(process.env.USER);
  add(process.env.USERNAME);
  add(process.env.LOGNAME);
  let root = '';
  if (home) {
    try { root = path.resolve(String(home)); } catch (_) { root = String(home); }
  }
  return { home: root, usernames };
}

function unfold(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r?\n|\t/g, '');
}

function replaceHomePaths(text, users) {
  return text.replace(HOME_PATH, (match) => {
    const found = match.match(USER_IN_PATH);
    if (found && found[1] && found[1].length >= 3 && !GENERIC_NAMES.has(found[1].toLowerCase()) && !users.includes(found[1])) users.push(found[1]);
    const lead = /^[\s"'`(]/.test(match) ? match[0] : '';
    return `${lead}~`;
  });
}

function replaceUsernames(text, users) {
  let next = text;
  for (const name of users) {
    if (!name || name.length < 3 || GENERIC_NAMES.has(name.toLowerCase())) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9._-])${escapeRegExp(name)}(?=$|[^A-Za-z0-9._-])`, 'gi');
    next = next.replace(pattern, '$1[redacted]');
  }
  return next;
}

function literalsFromScan(scan) {
  const blocked = [];
  const add = (item) => {
    if (typeof item === 'string' && item.length >= 8 && item.length <= 4000 && !blocked.includes(item)) blocked.push(item);
  };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.env && typeof value.env === 'object' && !Array.isArray(value.env)) {
      for (const item of Object.values(value.env)) add(item);
    }
    if (value.headers && typeof value.headers === 'object' && !Array.isArray(value.headers)) {
      for (const item of Object.values(value.headers)) add(item);
    }
    if (Array.isArray(value.args)) value.args.forEach(add);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  for (const client of (scan && scan.discovery && scan.discovery.clients) || []) {
    for (const file of client.files || []) {
      if (!file || file.status !== 'found' || !file.path) continue;
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(file.path, 'utf8')); } catch (_) { continue; }
      visit(parsed);
    }
  }
  return blocked.sort((a, b) => b.length - a.length);
}

function applyBlocked(text, blocked) {
  let next = text;
  for (const item of blocked || []) {
    if (item && next.includes(item)) next = next.split(item).join('[redacted]');
  }
  return next;
}

function redactText(value, identity, max) {
  const who = identity || identityFor();
  let text = unfold(value);
  if (!text.trim()) return '';
  text = applyBlocked(text, who.blocked);
  text = text.replace(PRIVATE_KEY, '[redacted]');
  text = text.replace(new RegExp(SENSITIVE_VALUE.source, 'gi'), '[redacted]');
  text = text.replace(new RegExp(CREDENTIAL_URI.source, 'gi'), '[redacted]');
  text = text.replace(ASSIGNED_SECRET, '[redacted]');
  text = text.replace(EXTRA_SECRET, '[redacted]');
  text = text.replace(MIXED_TOKEN, '[redacted]');
  text = text.replace(BASE64_TOKEN, '[redacted]');
  const users = who.usernames.slice();
  if (who.home && who.home.length >= 3) {
    const variants = [...new Set([who.home, who.home.split('\\').join('/'), who.home.split('/').join('\\')])];
    for (const variant of variants) {
      if (variant.length >= 3) text = text.split(variant).join('~');
    }
  }
  text = replaceHomePaths(text, users);
  text = replaceUsernames(text, users);
  text = text.replace(/ {2,}/g, ' ').trim();
  if (max && text.length > max) text = text.slice(0, max).trim();
  return text;
}

function clip(value, max, identity) {
  return redactText(value, identity, max);
}

function remediationString(remediation, identity) {
  const source = remediation && typeof remediation === 'object' ? remediation : { summary: remediation };
  const parts = [];
  if (source.summary) parts.push(source.summary);
  if (Array.isArray(source.steps)) parts.push(...source.steps.filter(step => typeof step === 'string' && step.trim()));
  return clip(parts.join(' '), LIMITS.remediation, identity);
}

function catalogFrom(findings) {
  const ids = new Set();
  for (const finding of findings || []) {
    if (!finding || finding.autoFixable !== true || typeof finding.fixId !== 'string') continue;
    if (finding.fixId.length < 1 || finding.fixId.length > LIMITS.fixId) continue;
    ids.add(finding.fixId);
  }
  return ids;
}

function shapeFinding(input, identity, catalog) {
  if (!input || typeof input !== 'object') return null;
  const id = clip(input.id, LIMITS.id, identity);
  const title = clip(input.title, LIMITS.title, identity);
  let category = clip(input.category || 'exposure', LIMITS.category, identity);
  let tool = clip(input.tool || 'scan', LIMITS.tool, identity);
  if (!category) category = 'exposure';
  if (!tool) tool = 'scan';
  const severityName = String(input.severity || '').toLowerCase();
  const severity = SEVERITIES.has(severityName) ? severityName : 'low';
  const remediation = remediationString(input.remediation, identity);
  const rawFix = typeof input.fixId === 'string' ? input.fixId : '';
  const localFix = LOCAL_FIX_PREFIXES.some(prefix => rawFix.startsWith(prefix));
  const fixClean = rawFix && localFix && redactText(rawFix, identity) === rawFix;
  const fixId = fixClean && catalog && catalog.has(rawFix) ? rawFix : '';
  if (!id || !title || !remediation) return null;
  return {
    id,
    title,
    severity,
    category,
    tool,
    remediation,
    fixId,
    autoFixable: input.autoFixable === true && !!fixId,
  };
}

function toWire(finding) {
  const wire = {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    tool: finding.tool,
    remediation: finding.remediation,
  };
  if (finding.fixId) wire.fixId = finding.fixId;
  return wire;
}

function findingsFromScan(scan, home) {
  const identity = identityFor(home || (scan && scan.home));
  identity.blocked = literalsFromScan(scan);
  const raw = [];
  const inventory = scan && scan.inventory ? scan.inventory : {};
  const names = new Map((inventory.agents || []).map(agent => [agent.id, agent.name]));
  for (const finding of inventory.findings || []) {
    if (CLOSED.has(finding.status)) continue;
    const remediation = finding.remediation || remediationForEngineFinding(finding);
    raw.push({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      tool: names.get(finding.agentId) || '',
      remediation,
      autoFixable: false,
      fixId: '',
    });
  }
  for (const finding of (scan && scan.configFindings) || []) {
    raw.push({
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
      autoFixable: finding.autoFixable === true,
      fixId: typeof finding.fixId === 'string' ? finding.fixId : '',
    });
  }
  const catalog = catalogFrom(raw);
  return raw.map(item => shapeFinding(item, identity, catalog)).filter(Boolean)
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || a.id.localeCompare(b.id));
}

function contextString(context, identity) {
  if (typeof context === 'string') return clip(context, LIMITS.context, identity);
  if (!Array.isArray(context)) return '';
  const turns = context.slice(-8).map(turn => ({
    question: redactText(turn && turn.question, identity),
    answer: redactText(turn && turn.answer, identity),
  })).filter(turn => turn.question || turn.answer);
  if (!turns.length) return '';
  return clip(turns.map(turn => `Question: ${turn.question} Answer: ${turn.answer}`).join(' '), LIMITS.context, identity);
}

function buildPayload({ question, findings, context, home, blocked }) {
  const identity = identityFor(home);
  if (blocked) identity.blocked = blocked;
  const catalog = catalogFrom(findings);
  const shaped = (findings || []).map(item => shapeFinding(item, identity, catalog)).filter(Boolean)
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || a.id.localeCompare(b.id))
    .slice(0, LIMITS.findings);
  const asked = clip(question, LIMITS.question, identity);
  const note = contextString(context, identity);
  const pack = (items) => {
    const body = { question: asked, findings: items.map(toWire) };
    if (note) body.context = note;
    return body;
  };
  let items = shaped.slice();
  while (items.length && Buffer.byteLength(JSON.stringify(pack(items)), 'utf8') > LIMITS.bodyBytes) items.pop();
  const body = pack(items);
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > LIMITS.bodyBytes) body.findings = [];
  return body;
}

function resolveAskUrl(input) {
  const raw = (input || DEFAULT_ORIGIN).trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error(`BOPPI_API_URL is not a valid URL: ${input}`); }
  if (url.username || url.password) throw new Error('BOPPI_API_URL must not include a username or password');
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('BOPPI_API_URL must use https (http is allowed only for localhost)');
  const pathName = url.pathname.replace(/\/+$/, '');
  if (pathName === ASK_PATH) {
    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    return url.toString();
  }
  if (pathName && pathName !== '') throw new Error('BOPPI_API_URL must be the API origin or end in /api/ai/ask');
  url.pathname = ASK_PATH;
  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
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

function decodeStream(buffer) {
  const type = String(buffer.contentType || '').toLowerCase();
  const text = buffer.text || '';
  if (type.includes('application/json')) {
    try { return textFromJson(JSON.parse(text)); } catch (_) { return null; }
  }
  if (!type.includes('text/event-stream')) return text;
  return text.split('\n').map(ssePiece).join('');
}

async function readLimited(response, maxChars) {
  const contentType = String(response.headers && response.headers.get ? response.headers.get('content-type') || '' : '');
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = typeof response.text === 'function' ? await response.text() : '';
    return { text: String(text), contentType, overflow: String(text).length > maxChars };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let steps = 0;
  while (steps < 10000) {
    steps += 1;
    const step = await reader.read();
    if (step.done) break;
    text += decoder.decode(step.value, { stream: true });
    if (text.length > maxChars) {
      try { await reader.cancel(); } catch (_) { /* the extra bytes are discarded */ }
      return { text, contentType, overflow: true };
    }
  }
  text += decoder.decode();
  return { text, contentType, overflow: text.length > maxChars };
}

function realFixIds(findings) {
  return new Set((findings || []).filter(finding => finding && finding.autoFixable && finding.fixId).map(finding => finding.fixId));
}

/** The reply is data. Harmful commands are dropped. A fix command stays only when this scan has that fix. */
function presentAnswer(text, findings) {
  const original = String(text || '');
  if (HARMFUL_REPLY.test(original)) return 'Boppi will not show that reply. It told you to run a command, and nothing was run.';
  const real = realFixIds(findings);
  let next = original.replace(APPLIED_CLAIM, '');
  next = next.replace(/\bfixId\s*[:=]\s*([^\s,;]+)/gi, (match, id) => (real.has(id) ? match : ''));
  if (!real.size) next = next.replace(FIX_COMMAND, '');
  next = next.replace(/[ \t]{2,}/g, ' ').replace(/ \n/g, '\n').trim();
  if (!next && original.trim()) return 'No fix was applied. Nothing was changed.';
  return next;
}

function localFixFooter(findings, home) {
  const identity = identityFor(home);
  const ids = [...realFixIds(findings)];
  if (!ids.length) return '';
  const shown = ids.map(id => redactText(id, identity)).filter(id => id && id !== '[redacted]');
  if (!shown.length) return 'A local catalog fix is available. Run npx @boppi/cli fix. Nothing was changed.\n';
  return `Local catalog fixes: ${shown.join(', ')}. Run npx @boppi/cli fix. Nothing was changed.\n`;
}

function offlineAnswer(findings, question, home, blocked) {
  const identity = identityFor(home);
  identity.blocked = blocked;
  const lines = ['Offline. Nothing was sent to the Boppi API.'];
  const asked = redactText(question || '', identity);
  if (asked) lines.push(`Question: ${asked}`);
  const list = findings || [];
  if (!list.length) lines.push('This scan has no open findings.');
  else list.slice(0, LIMITS.findings).forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding.title}`);
    lines.push(finding.remediation);
    if (finding.autoFixable && finding.fixId) lines.push(`Local catalog fix: ${redactText(finding.fixId, identity)}`);
  });
  const footer = localFixFooter(list, home).trim();
  if (footer) lines.push(footer);
  else lines.push('Nothing was changed.');
  return `${lines.join('\n')}\n`;
}

function statusMessage(response) {
  const status = response && response.status;
  const retry = response && response.headers && response.headers.get ? response.headers.get('retry-after') : '';
  if (status === 400) return 'The Boppi API returned 400 because the question looked like it included a secret. Nothing else was sent.';
  if (status === 401) return 'The Boppi API returned 401. This command sends no session cookie. Nothing else was sent.';
  if (status === 413) return 'The Boppi API returned 413 because the question was larger than 96 KB. Nothing else was sent.';
  if (status === 415) return 'The Boppi API returned 415. Nothing else was sent.';
  if (status === 422) return 'The Boppi API returned 422 because the question did not match the expected shape. Nothing else was sent.';
  if (status === 429) {
    const wait = retry && /^\d+$/.test(String(retry).trim()) ? ` Try again in ${String(retry).trim()} seconds.` : ' Try again after the next UTC day.';
    return `The Boppi API returned 429. The question limit for this UTC day is exhausted.${wait} Nothing else was sent.`;
  }
  if (status === 502) return 'The Boppi API returned 502 because the model call failed. Nothing else was sent.';
  if (status === 503) return 'The Boppi API returned 503 because Boppi AI is unavailable. Nothing else was sent.';
  return `The Boppi API returned ${status}. Nothing else was sent.`;
}

function isRedirect(error) {
  return !!(error && /redirect/i.test(String(error.message || '')));
}

async function askOnce({ question, findings, context, apiUrl, fetchImpl, write, home, timeoutMs, blocked }) {
  const payload = buildPayload({ question, findings, context, home, blocked });
  if (!payload.question) return { ok: false, message: 'The question was empty after removing secrets. Nothing was sent.' };
  const controller = new AbortController();
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : ASK_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/plain, application/json',
        'user-agent': 'boppi-cli',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await readLimited(response, 4096);
      return { ok: false, message: statusMessage(response) };
    }
    const buffered = await readLimited(response, MAX_RESPONSE_CHARS);
    if (buffered.overflow) return { ok: false, message: 'The Boppi API response was too large. Nothing else was shown.' };
    const decoded = decodeStream(buffered);
    if (decoded == null) return { ok: false, message: 'The Boppi API response could not be read. Nothing else was sent.' };
    const safe = presentAnswer(redactText(decoded, Object.assign(identityFor(home), { blocked })), findings);
    const shown = safe ? (safe.endsWith('\n') ? safe : `${safe}\n`) : '';
    if (shown && write) write(shown);
    return { ok: true, text: shown, payload };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, message: 'The Boppi API did not respond in time. Nothing else was sent.' };
    if (isRedirect(error)) return { ok: false, message: 'The Boppi API redirected the request. Nothing else was sent.' };
    return { ok: false, message: `Could not reach the Boppi API at ${originOf(apiUrl)}. Check your connection and try again.` };
  } finally {
    clearTimeout(timer);
  }
}

async function chat({ findings, apiUrl, fetchImpl, readLine, write, writeErr, home, timeoutMs, blocked }) {
  const out = write || (chunk => process.stdout.write(chunk));
  const err = writeErr || (line => process.stderr.write(line));
  const context = [];
  while (true) {
    const line = String(await readLine()).trim();
    if (!line || line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit') return 0;
    const result = await askOnce({ question: line, findings, context, apiUrl, fetchImpl, write: out, home, timeoutMs, blocked });
    if (!result.ok) {
      err(`${result.message}\n`);
      if (result.message.includes('empty after removing secrets')) continue;
      return 1;
    }
    context.push({ question: line, answer: result.text || '' });
  }
}

module.exports = {
  DEFAULT_ORIGIN,
  ASK_PATH,
  PRIVACY_NOTE,
  OPT_IN_DECLINE,
  LIMITS,
  ASK_TIMEOUT_MS,
  MAX_RESPONSE_CHARS,
  ANON_DAILY_LIMIT,
  WIRE_KEYS,
  privacyNote,
  consentRecorded,
  recordConsent,
  acceptedAnswer,
  redactText,
  literalsFromScan,
  identityFor,
  findingsFromScan,
  buildPayload,
  resolveAskUrl,
  originOf,
  presentAnswer,
  localFixFooter,
  offlineAnswer,
  askOnce,
  chat,
  ssePiece,
};
