/**
 * Config parsers for the MCP shapes each client actually stores.
 * JSONC covers VS Code settings and Zed settings (comments and trailing commas).
 * The YAML and TOML readers are subsets of what Continue, Goose, and Codex
 * document, not general parsers.
 */
'use strict';

function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i += 2; continue; }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') { inString = true; out += c; i += 1; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'));
}

function unquote(value) {
  const text = String(value).trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

function coerceScalar(raw) {
  const value = unquote(raw);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~' || value === '') return value === '' ? '' : null;
  if (value === '{}') return {};
  if (value === '[]') return [];
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    try { return JSON.parse(value.replace(/'/g, '"')); } catch (_) { return value; }
  }
  return value;
}

function stripYamlComment(body) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || body[i - 1] === ' ')) return body.slice(0, i).trimEnd();
  }
  return body.trimEnd();
}

/** Indentation subset: maps, lists, nested maps, scalars. Enough for Continue and Goose configs. */
function parseYamlSubset(input) {
  const lines = [];
  for (const raw of String(input).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const expanded = raw.replace(/\t/g, '  ');
    if (!expanded.trim() || /^\s*#/.test(expanded)) continue;
    const indent = expanded.match(/^ */)[0].length;
    const body = stripYamlComment(expanded.slice(indent));
    if (!body) continue;
    lines.push({ indent, body });
  }
  if (!lines.length) return {};

  function parseMap(start, indent) {
    const obj = {};
    let i = start;
    while (i < lines.length && lines[i].indent === indent && !lines[i].body.startsWith('- ')) {
      const match = lines[i].body.match(/^([^:]+):\s*(.*)$/);
      if (!match) { i += 1; continue; }
      const key = unquote(match[1].trim());
      const rest = match[2];
      if (rest === '' || rest === '|' || rest === '>') {
        if (i + 1 < lines.length && lines[i + 1].indent > indent) {
          if (lines[i + 1].body.startsWith('- ')) {
            const parsed = parseList(i + 1, lines[i + 1].indent);
            obj[key] = parsed.value;
            i = parsed.next;
          } else {
            const parsed = parseMap(i + 1, lines[i + 1].indent);
            obj[key] = parsed.value;
            i = parsed.next;
          }
        } else {
          obj[key] = null;
          i += 1;
        }
      } else {
        obj[key] = coerceScalar(rest);
        i += 1;
      }
    }
    return { value: obj, next: i };
  }

  function parseList(start, indent) {
    const list = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && lines[i].body.startsWith('- ')) {
      const rest = lines[i].body.slice(2);
      const kv = rest.match(/^([^:]+):\s*(.*)$/);
      if (kv) {
        const obj = {};
        const key = unquote(kv[1].trim());
        if (kv[2] === '' && i + 1 < lines.length && lines[i + 1].indent > indent) {
          if (lines[i + 1].body.startsWith('- ')) {
            const parsed = parseList(i + 1, lines[i + 1].indent);
            obj[key] = parsed.value;
            i = parsed.next;
          } else {
            const parsed = parseMap(i + 1, lines[i + 1].indent);
            obj[key] = parsed.value;
            i = parsed.next;
          }
        } else {
          obj[key] = kv[2] === '' ? null : coerceScalar(kv[2]);
          i += 1;
        }
        while (i < lines.length && lines[i].indent > indent && !lines[i].body.startsWith('- ')) {
          const item = lines[i].body.match(/^([^:]+):\s*(.*)$/);
          if (!item) { i += 1; continue; }
          const itemKey = unquote(item[1].trim());
          const itemRest = item[2];
          const itemIndent = lines[i].indent;
          if (itemRest === '' && i + 1 < lines.length && lines[i + 1].indent > itemIndent) {
            if (lines[i + 1].body.startsWith('- ')) {
              const parsed = parseList(i + 1, lines[i + 1].indent);
              obj[itemKey] = parsed.value;
              i = parsed.next;
            } else {
              const parsed = parseMap(i + 1, lines[i + 1].indent);
              obj[itemKey] = parsed.value;
              i = parsed.next;
            }
          } else {
            obj[itemKey] = itemRest === '' ? null : coerceScalar(itemRest);
            i += 1;
          }
        }
        list.push(obj);
      } else {
        list.push(coerceScalar(rest));
        i += 1;
      }
    }
    return { value: list, next: i };
  }

  const first = lines[0];
  const parsed = first.body.startsWith('- ') ? parseList(0, first.indent) : parseMap(0, first.indent);
  return parsed.value;
}

function normalizeSpec(spec) {
  let command = spec.command;
  let args = spec.args;
  let env = spec.env || spec.envs;
  if (command && typeof command === 'object') {
    args = command.args || args;
    env = command.env || command.envs || env;
    command = command.path || command.command;
  }
  if (typeof command !== 'string' && typeof spec.cmd === 'string') command = spec.cmd;
  const url = typeof spec.url === 'string' ? spec.url
    : typeof spec.uri === 'string' ? spec.uri
      : typeof spec.httpUrl === 'string' ? spec.httpUrl
        : typeof spec.endpoint === 'string' ? spec.endpoint
          : null;
  const out = {};
  if (typeof command === 'string' && command.trim()) out.command = command.trim();
  if (Array.isArray(args)) out.args = args.filter(value => typeof value === 'string');
  if (env && typeof env === 'object' && !Array.isArray(env)) out.env = env;
  if (url) out.url = url;
  if (spec.headers && typeof spec.headers === 'object' && !Array.isArray(spec.headers)) out.headers = spec.headers;
  if (Array.isArray(spec.autoApprove)) out.tools = spec.autoApprove.filter(value => typeof value === 'string');
  if (Array.isArray(spec.tools)) out.tools = spec.tools.filter(value => typeof value === 'string');
  if (Array.isArray(spec.capabilities)) out.capabilities = spec.capabilities.filter(value => typeof value === 'string');
  if (spec.trustStatus === 'verified' || spec.trustStatus === 'unverified') out.trustStatus = spec.trustStatus;
  return out;
}

/** Object map or Continue-style list of { name, command, ... }. Disabled entries are not grants. */
function mapServers(block) {
  if (!block) return {};
  const entries = Array.isArray(block)
    ? block.map(item => [item && (item.name || item.id), item])
    : Object.entries(block);
  const out = {};
  for (const [name, spec] of entries) {
    if (!name || !spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    if (spec.disabled === true || spec.enabled === false) continue;
    out[String(name)] = normalizeSpec(spec);
  }
  return out;
}

function vscodeServers(json) {
  if (!json || typeof json !== 'object') return {};
  if (json.servers || json.mcpServers) return mapServers(json.servers || json.mcpServers);
  const mcp = json.mcp;
  if (mcp && typeof mcp === 'object') return mapServers(mcp.servers || mcp.mcpServers);
  return {};
}

function zedServers(json) {
  if (!json || typeof json !== 'object') return {};
  return mapServers(json.context_servers);
}

function amazonQServers(json) {
  if (!json || typeof json !== 'object') return {};
  return mapServers(json.mcpServers || json.servers || (json.mcp && (json.mcp.servers || json.mcp.mcpServers)));
}

const GOOSE_BUILTIN = Object.freeze({
  // Goose's bundled developer extension exposes the shell and file tools.
  // https://block.github.io/goose/docs/guides/config-files
  developer: ['filesystem_access', 'shell_access'],
});

function gooseServers(text) {
  const parsed = parseYamlSubset(text);
  const extensions = parsed && parsed.extensions;
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return {};
  const out = {};
  for (const [key, spec] of Object.entries(extensions)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    if (spec.enabled === false) continue;
    const name = typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim() : key;
    const type = typeof spec.type === 'string' ? spec.type : '';
    if (type === 'builtin' || type === 'platform') {
      const capabilities = GOOSE_BUILTIN[name] || GOOSE_BUILTIN[key] || [];
      out[name] = { command: `goose-${name}`, args: [], ...(capabilities.length ? { capabilities } : {}) };
      continue;
    }
    if (type && type !== 'stdio' && type !== 'streamable_http' && type !== 'sse' && type !== 'http') continue;
    out[name] = normalizeSpec(spec);
  }
  return out;
}

function continueServers(text) {
  const parsed = parseYamlSubset(text);
  if (!parsed || typeof parsed !== 'object') return {};
  if (parsed.mcpServers) return mapServers(parsed.mcpServers);
  if (parsed.name && (parsed.command || parsed.url || parsed.type)) return mapServers([parsed]);
  return {};
}

function stripTomlComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i).trim();
  }
  return line.trim();
}

function parseTomlString(raw) {
  const text = raw.trim();
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1);
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return text;
}

function parseTomlArray(raw) {
  const text = raw.trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return [];
  const body = text.slice(1, -1).trim();
  if (!body) return [];
  const parts = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    if (c === ',' && !inSingle && !inDouble) {
      parts.push(parseTomlString(current));
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(parseTomlString(current));
  return parts;
}

/** Codex documents [mcp_servers.<name>] tables in config.toml, with optional .env and .headers subtables. */
function codexServers(text) {
  const servers = {};
  let current = null;
  let bucket = null;
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = stripTomlComment(raw);
    if (!line) continue;
    const header = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)(?:\.(env|headers))?\]$/i);
    if (header) {
      const name = header[1];
      if (!servers[name]) servers[name] = {};
      current = servers[name];
      bucket = header[2] || null;
      continue;
    }
    if (!current || !line.includes('=')) continue;
    if (/^\[/.test(line)) { current = null; bucket = null; continue; }
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    if (bucket === 'env' || bucket === 'headers') {
      if (!current[bucket]) current[bucket] = {};
      current[bucket][key] = parseTomlString(rawValue);
      continue;
    }
    if (key === 'args') current.args = parseTomlArray(rawValue);
    else if (key === 'enabled' || key === 'disabled') current[key] = rawValue === 'true';
    else if (key === 'command' || key === 'url' || key === 'http_url') current[key === 'http_url' ? 'httpUrl' : key] = parseTomlString(rawValue);
  }
  const out = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (spec.enabled === false || spec.disabled === true) continue;
    out[name] = normalizeSpec(spec);
  }
  return out;
}

module.exports = {
  parseJsonc, parseYamlSubset, mapServers, normalizeSpec, vscodeServers, zedServers, amazonQServers,
  gooseServers, continueServers, codexServers,
};
