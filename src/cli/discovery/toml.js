/**
 * A small TOML reader for configuration discovery. It covers what agent
 * configuration files use: tables `[a.b]` and arrays of tables `[[a.b]]`,
 * bare, quoted and dotted keys, basic and literal strings (single and
 * multi-line), integers, floats, booleans, arrays, inline tables, and
 * comments. Anything outside that subset (dates, times, special floats,
 * hex/octal/binary integers, a duplicate key, an unterminated string) throws,
 * and the caller records the file as unreadable. It never guesses at a
 * malformed line and never evaluates anything: the value grammar is parsed
 * by hand, there is no `eval`, `Function`, or `JSON.parse` on untrusted text
 * beyond the escape sequences the TOML grammar defines.
 */
'use strict';

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;
const MAX_DEPTH = 32;

class TomlError extends Error {
  constructor(message, line) { super(`${message} (line ${line})`); this.name = 'TomlError'; this.line = line; }
}

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

class Reader {
  constructor(text) { this.text = text; this.pos = 0; this.line = 1; }
  get done() { return this.pos >= this.text.length; }
  peek(offset = 0) { return this.text[this.pos + offset]; }
  next() { const ch = this.text[this.pos++]; if (ch === '\n') this.line += 1; return ch; }
  fail(message) { throw new TomlError(message, this.line); }
  startsWith(s) { return this.text.startsWith(s, this.pos); }
  /** Spaces and tabs only; newlines are significant outside arrays. */
  skipBlanks() { while (this.peek() === ' ' || this.peek() === '\t') this.pos += 1; }
  /** Blanks, comments, and newlines (inside arrays and between statements). */
  skipWhitespaceAndComments() {
    for (;;) {
      this.skipBlanks();
      if (this.peek() === '#') { while (!this.done && this.peek() !== '\n') this.pos += 1; continue; }
      if (this.peek() === '\r' && this.peek(1) === '\n') { this.next(); this.next(); continue; }
      if (this.peek() === '\n') { this.next(); continue; }
      return;
    }
  }
  /** A comment or nothing, then end of line or end of input. */
  expectLineEnd() {
    this.skipBlanks();
    if (this.peek() === '#') while (!this.done && this.peek() !== '\n') this.pos += 1;
    if (this.done) return;
    if (this.peek() === '\r' && this.peek(1) === '\n') { this.next(); this.next(); return; }
    if (this.peek() === '\n') { this.next(); return; }
    this.fail('unexpected text after a value');
  }
}

function readEscape(r) {
  const ch = r.next();
  switch (ch) {
    case 'b': return '\b';
    case 't': return '\t';
    case 'n': return '\n';
    case 'f': return '\f';
    case 'r': return '\r';
    case '"': return '"';
    case '\\': return '\\';
    case 'u': case 'U': {
      const len = ch === 'u' ? 4 : 8;
      const hex = r.text.slice(r.pos, r.pos + len);
      if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) r.fail('invalid unicode escape');
      r.pos += len;
      const code = parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) r.fail('invalid unicode escape');
      return String.fromCodePoint(code);
    }
    default: r.fail('invalid escape sequence');
  }
  return '';
}

function readBasicString(r) {
  r.next(); // opening quote
  let out = '';
  for (;;) {
    if (r.done) r.fail('unterminated string');
    const ch = r.next();
    if (ch === '"') return out;
    if (ch === '\n') r.fail('newline in a single-line string');
    if (ch === '\\') { out += readEscape(r); continue; }
    if (ch < ' ' && ch !== '\t') r.fail('control character in a string');
    out += ch;
  }
}

function readMultilineBasicString(r) {
  r.pos += 3;
  if (r.peek() === '\r' && r.peek(1) === '\n') { r.next(); r.next(); } else if (r.peek() === '\n') r.next();
  let out = '';
  for (;;) {
    if (r.done) r.fail('unterminated multi-line string');
    if (r.startsWith('"""')) {
      r.pos += 3;
      // Up to two extra quotes may belong to the content.
      while (r.peek() === '"' && out.length < r.text.length) { out += '"'; r.pos += 1; }
      return out;
    }
    const ch = r.next();
    if (ch === '\\') {
      // Line-ending backslash: trim whitespace up to the next non-blank character.
      let look = r.pos;
      while (r.text[look] === ' ' || r.text[look] === '\t') look += 1;
      if (r.text[look] === '\n' || (r.text[look] === '\r' && r.text[look + 1] === '\n')) {
        while (!r.done && /[ \t\r\n]/.test(r.peek())) r.next();
        continue;
      }
      out += readEscape(r);
      continue;
    }
    if (ch < ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') r.fail('control character in a string');
    out += ch;
  }
}

function readLiteralString(r) {
  r.next(); // opening quote
  let out = '';
  for (;;) {
    if (r.done) r.fail('unterminated string');
    const ch = r.next();
    if (ch === "'") return out;
    if (ch === '\n') r.fail('newline in a single-line string');
    if (ch < ' ' && ch !== '\t') r.fail('control character in a string');
    out += ch;
  }
}

function readMultilineLiteralString(r) {
  r.pos += 3;
  if (r.peek() === '\r' && r.peek(1) === '\n') { r.next(); r.next(); } else if (r.peek() === '\n') r.next();
  let out = '';
  for (;;) {
    if (r.done) r.fail('unterminated multi-line string');
    if (r.startsWith("'''")) {
      r.pos += 3;
      while (r.peek() === "'" && out.length < r.text.length) { out += "'"; r.pos += 1; }
      return out;
    }
    const ch = r.next();
    if (ch < ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') r.fail('control character in a string');
    out += ch;
  }
}

/** A bare scalar token: integer, float, or boolean. Dates, times, inf, nan, and prefixed integers are refused. */
function readBareValue(r) {
  const start = r.pos;
  while (!r.done && /[A-Za-z0-9_+\-.:]/.test(r.peek())) r.pos += 1;
  const token = r.text.slice(start, r.pos);
  if (!token) r.fail('expected a value');
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (INTEGER.test(token)) {
    const n = Number(token.replace(/_/g, ''));
    if (!Number.isSafeInteger(n)) r.fail('integer out of range');
    return n;
  }
  if (FLOAT.test(token)) {
    const n = Number(token.replace(/_/g, ''));
    if (!Number.isFinite(n)) r.fail('invalid float');
    return n;
  }
  r.fail(`unsupported value ${JSON.stringify(token.slice(0, 40))}`);
  return null;
}

function readArray(r, depth) {
  if (depth > MAX_DEPTH) r.fail('nesting too deep');
  r.next(); // [
  const out = [];
  for (;;) {
    r.skipWhitespaceAndComments();
    if (r.peek() === ']') { r.next(); return out; }
    out.push(readValue(r, depth + 1));
    r.skipWhitespaceAndComments();
    if (r.peek() === ',') { r.next(); continue; }
    if (r.peek() === ']') { r.next(); return out; }
    r.fail('expected , or ] in an array');
  }
}

function readInlineTable(r, depth) {
  if (depth > MAX_DEPTH) r.fail('nesting too deep');
  r.next(); // {
  const out = {};
  r.skipBlanks();
  if (r.peek() === '}') { r.next(); return out; }
  for (;;) {
    r.skipBlanks();
    const keys = readKeyPath(r);
    r.skipBlanks();
    if (r.next() !== '=') r.fail('expected = in an inline table');
    r.skipBlanks();
    const value = readValue(r, depth + 1);
    assign(out, keys, value, r, { inline: true });
    r.skipBlanks();
    if (r.peek() === ',') { r.next(); continue; }
    if (r.peek() === '}') { r.next(); return out; }
    r.fail('expected , or } in an inline table');
  }
}

function readValue(r, depth = 0) {
  const ch = r.peek();
  if (ch === undefined) r.fail('expected a value');
  if (ch === '"') return r.startsWith('"""') ? readMultilineBasicString(r) : readBasicString(r);
  if (ch === "'") return r.startsWith("'''") ? readMultilineLiteralString(r) : readLiteralString(r);
  if (ch === '[') return readArray(r, depth);
  if (ch === '{') return readInlineTable(r, depth);
  return readBareValue(r);
}

/** One key segment: bare, "basic", or 'literal'. */
function readKeySegment(r) {
  const ch = r.peek();
  if (ch === '"') return readBasicString(r);
  if (ch === "'") return readLiteralString(r);
  const start = r.pos;
  while (!r.done && /[A-Za-z0-9_-]/.test(r.peek())) r.pos += 1;
  const key = r.text.slice(start, r.pos);
  if (!BARE_KEY.test(key)) r.fail('expected a key');
  return key;
}

/** `a.b."c d"` as ['a', 'b', 'c d']. */
function readKeyPath(r) {
  const keys = [readKeySegment(r)];
  for (;;) {
    r.skipBlanks();
    if (r.peek() !== '.') return keys;
    r.next();
    r.skipBlanks();
    keys.push(readKeySegment(r));
  }
}

/** Walk or create intermediate tables; a scalar or an inline table in the way is an error, never overwritten. */
function descend(root, keys, r, meta) {
  let node = root;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) node[key] = {};
    let child = node[key];
    if (Array.isArray(child)) {
      if (!meta.arrays.has(child)) r.fail(`key ${JSON.stringify(key)} is a static array, not a table`);
      child = child[child.length - 1];
    }
    if (!isObject(child)) r.fail(`key ${JSON.stringify(key)} is already a value`);
    if (meta.inline.has(child)) r.fail(`inline table ${JSON.stringify(key)} cannot be extended`);
    node = child;
  }
  return node;
}

function assign(table, keys, value, r, { inline = false } = {}) {
  const meta = r.meta;
  const parent = keys.length > 1 ? descend(table, keys.slice(0, -1), r, meta) : table;
  const last = keys[keys.length - 1];
  if (Object.prototype.hasOwnProperty.call(parent, last)) r.fail(`duplicate key ${JSON.stringify(last)}`);
  parent[last] = value;
  if (isObject(value)) { meta.inline.add(value); if (!inline) meta.defined.add(value); }
  if (Array.isArray(value)) meta.staticArrays.add(value);
}

/**
 * Parse TOML text into plain objects. Throws TomlError on anything outside the
 * supported subset so a caller can mark the file unreadable.
 */
function parse(text) {
  if (typeof text !== 'string') throw new TomlError('input must be a string', 0);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const r = new Reader(text);
  // Bookkeeping so a table is never defined twice and an inline table is never reopened.
  r.meta = { defined: new Set(), inline: new Set(), arrays: new Set(), staticArrays: new Set() };
  const root = {};
  let current = root;
  for (;;) {
    r.skipWhitespaceAndComments();
    if (r.done) return root;
    if (r.peek() === '[') {
      const isArray = r.peek(1) === '[';
      r.pos += isArray ? 2 : 1;
      r.skipBlanks();
      const keys = readKeyPath(r);
      r.skipBlanks();
      if (isArray) { if (!r.startsWith(']]')) r.fail('expected ]]'); r.pos += 2; } else { if (r.next() !== ']') r.fail('expected ]'); }
      r.expectLineEnd();
      const parent = keys.length > 1 ? descend(root, keys.slice(0, -1), r, r.meta) : root;
      const last = keys[keys.length - 1];
      if (isArray) {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) { parent[last] = []; r.meta.arrays.add(parent[last]); }
        const list = parent[last];
        if (!Array.isArray(list) || !r.meta.arrays.has(list)) r.fail(`key ${JSON.stringify(last)} is not an array of tables`);
        current = {};
        list.push(current);
        r.meta.defined.add(current);
      } else {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) parent[last] = {};
        current = parent[last];
        if (Array.isArray(current)) r.fail(`table ${JSON.stringify(last)} is already an array`);
        if (!isObject(current)) r.fail(`key ${JSON.stringify(last)} is already a value`);
        if (r.meta.defined.has(current) || r.meta.inline.has(current)) r.fail(`table ${JSON.stringify(last)} is defined twice`);
        r.meta.defined.add(current);
      }
      continue;
    }
    const keys = readKeyPath(r);
    r.skipBlanks();
    if (r.next() !== '=') r.fail('expected =');
    r.skipBlanks();
    const value = readValue(r);
    assign(current, keys, value, r);
    r.expectLineEnd();
  }
}

module.exports = { parse, TomlError };
