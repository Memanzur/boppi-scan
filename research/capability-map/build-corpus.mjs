#!/usr/bin/env node
// Builds the MCP package corpus from the public npm registry.
// Research tooling only. Uses network and child processes; node built-ins only.
//
//   node build-corpus.mjs                 search npm, rank, pack top N, extract, hash
//   node build-corpus.mjs --from-index    re-pack the exact versions in corpus/index.json and verify hashes
//   node build-corpus.mjs --limit 50      smaller corpus
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, 'corpus');
const TARBALLS = path.join(CORPUS, 'tarballs');
const PACKAGES = path.join(CORPUS, 'packages');
const INDEX = path.join(CORPUS, 'index.json');

const QUERIES = ['mcp server', 'model context protocol', 'keywords:mcp', 'mcp-server', 'modelcontextprotocol server'];
const PAGES_PER_QUERY = 4;
const PAGE_SIZE = 250;
const SHORTLIST = 400;
const MCP_SDKS = ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server', '@modelcontextprotocol/core', '@modelcontextprotocol/node', 'fastmcp', 'mcp-framework', '@mcp-sdk/server', 'litemcp', 'easy-mcp', '@anthropic-ai/mcp'];
// Packages that are tooling around MCP rather than servers. Name patterns only; every exclusion is recorded.
const NOT_A_SERVER = /^@modelcontextprotocol\/(?!server-)|(^|[\/-])(sdk|inspector|registry|framework|create-[a-z]|template|boilerplate|starter|proxy-cli|types)($|[\/-])/i;
const DENYLIST = new Set(['@modelcontextprotocol/sdk', '@modelcontextprotocol/inspector', '@modelcontextprotocol/inspector-cli', '@modelcontextprotocol/inspector-client', '@modelcontextprotocol/inspector-server', 'fastmcp', 'mcp-framework', 'mcp-remote', 'mcp-proxy', 'supergateway', 'mcporter', 'mcp-use']);

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const LIMIT = Number(flag('--limit', 200));
const FROM_INDEX = args.includes('--from-index');
const CONCURRENCY = Number(flag('--concurrency', 8));
const DEADLINE_MS = Number(flag('--deadline-minutes', 20)) * 60 * 1000;
const startedAt = Date.now();

const log = (...m) => process.stderr.write(m.join(' ') + '\n');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 429 && attempt < 5) { await sleep(2000 * 2 ** attempt); return getJson(url, attempt + 1); }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 120000, ...opts }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function search() {
  const seen = new Map();
  for (const query of QUERIES) {
    for (let page = 0; page < PAGES_PER_QUERY; page++) {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${PAGE_SIZE}&from=${page * PAGE_SIZE}`;
      let body;
      try { body = await getJson(url); } catch (error) { log(`search failed: ${error.message}`); break; }
      for (const object of body.objects || []) {
        const pkg = object.package;
        if (!seen.has(pkg.name)) {
          seen.set(pkg.name, {
            name: pkg.name, version: pkg.version, description: pkg.description || '', keywords: pkg.keywords || [],
            searchMonthly: object.downloads?.monthly ?? null, queries: [],
          });
        }
        seen.get(pkg.name).queries.push(query);
      }
      log(`search "${query}" page ${page + 1}: ${body.objects?.length || 0} results, ${seen.size} unique so far`);
      if (!body.objects || body.objects.length < PAGE_SIZE) break;
      await sleep(400);
    }
  }
  return [...seen.values()];
}

function looksLikeMcp(pkg) {
  const text = `${pkg.name} ${pkg.description}`.toLowerCase();
  const keywords = pkg.keywords.map(k => String(k).toLowerCase());
  return /\bmcp\b|mcp[-_]|[-_]mcp|model[- ]context[- ]protocol|modelcontextprotocol/.test(text)
    || keywords.some(k => /^mcp$|^mcp-|-mcp$|model-context-protocol|modelcontextprotocol/.test(k));
}

function excludeReason(pkg, meta) {
  if (DENYLIST.has(pkg.name)) return 'denylist: tooling, not a server';
  if (NOT_A_SERVER.test(pkg.name)) return 'name pattern: tooling, not a server';
  if (!meta) return 'registry metadata unavailable';
  const deps = Object.keys({ ...(meta.dependencies || {}), ...(meta.peerDependencies || {}) });
  const hasSdk = deps.some(d => MCP_SDKS.includes(d));
  const hasBin = meta.bin && Object.keys(meta.bin).length > 0;
  if (!hasSdk && !hasBin) return 'no bin and no MCP SDK dependency';
  return null;
}

async function fetchMeta(name, version) {
  try { return await getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`); }
  catch (error) { log(`metadata failed for ${name}@${version}: ${error.message}`); return null; }
}

async function fetchDownloads(name) {
  try { return (await getJson(`https://api.npmjs.org/downloads/point/last-month/${name}`)).downloads ?? 0; }
  catch (_) { return 0; }
}

function listFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

function contentHash(root, files) {
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(rel); h.update('\0');
    h.update(sha256(fs.readFileSync(path.join(root, rel)))); h.update('\n');
  }
  return 'sha256-' + h.digest('hex');
}

const PY_WRAPPER = /\b(uvx|uv run|python3?|pip install|pipx)\b/;
function pythonMarkers(root, files) {
  const markers = [];
  if (files.some(f => /(^|\/)(pyproject\.toml|requirements\.txt|setup\.py)$/.test(f) || f.endsWith('.py'))) markers.push('python files in tarball');
  for (const rel of files) {
    if (!/\.(c|m)?js$/.test(rel) || rel.includes('node_modules/')) continue;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (text.length < 20000 && PY_WRAPPER.test(text)) { markers.push(`spawns a Python tool in ${rel}`); break; }
  }
  return markers;
}

async function packOne(entry) {
  const spec = `${entry.name}@${entry.version}`;
  const result = await run('npm', ['pack', spec, '--pack-destination', TARBALLS, '--json', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 90000 });
  if (result.error) return { ...entry, packError: (result.stderr || result.error.message).trim().split('\n').pop().slice(0, 300) };
  let info;
  try { info = JSON.parse(result.stdout)[0]; } catch (_) { return { ...entry, packError: 'npm pack produced no JSON' }; }
  const tarball = path.join(TARBALLS, info.filename);
  const dest = path.join(PACKAGES, entry.name, entry.version);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const extracted = await run('tar', ['-xzf', tarball, '-C', dest, '--strip-components=1']);
  if (extracted.error) return { ...entry, packError: `tar: ${extracted.stderr.trim().slice(0, 300)}` };
  const files = listFiles(dest);
  const now = new Date().toISOString();
  return {
    name: entry.name, version: entry.version, downloadsLastMonth: entry.downloadsLastMonth,
    registryIntegrity: entry.registryIntegrity, packIntegrity: info.integrity, tarball: path.relative(CORPUS, tarball),
    tarballSha256: 'sha256-' + sha256(fs.readFileSync(tarball)),
    contentHash: contentHash(dest, files), filesHash: 'sha256-' + sha256(files.join('\n')), packedAt: now, inspectedAt: now,
    fileCount: files.length, files, pythonMarkers: pythonMarkers(dest, files),
  };
}

async function main() {
  fs.mkdirSync(TARBALLS, { recursive: true });
  fs.mkdirSync(PACKAGES, { recursive: true });
  let candidates;
  const excluded = [];
  if (FROM_INDEX) {
    const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    candidates = index.packages.map(p => ({ name: p.name, version: p.version, downloadsLastMonth: p.downloadsLastMonth, registryIntegrity: p.registryIntegrity }));
    log(`re-packing ${candidates.length} packages from index.json`);
  } else {
    const found = await search();
    const mcpLike = found.filter(looksLikeMcp);
    log(`${found.length} search results, ${mcpLike.length} look like MCP packages`);
    for (const pkg of found) if (!looksLikeMcp(pkg)) excluded.push({ name: pkg.name, reason: 'search noise: no MCP marker in name, description, or keywords' });
    mcpLike.sort((a, b) => (b.searchMonthly || 0) - (a.searchMonthly || 0));
    const shortlist = mcpLike.slice(0, SHORTLIST);
    const enriched = await mapLimit(shortlist, CONCURRENCY, async pkg => {
      const [meta, downloadsLastMonth] = await Promise.all([fetchMeta(pkg.name, pkg.version), fetchDownloads(pkg.name)]);
      return { ...pkg, meta, downloadsLastMonth, registryIntegrity: meta?.dist?.integrity || null };
    });
    candidates = [];
    for (const pkg of enriched) {
      const reason = excludeReason(pkg, pkg.meta);
      if (reason) excluded.push({ name: pkg.name, version: pkg.version, reason });
      else candidates.push(pkg);
    }
    candidates.sort((a, b) => b.downloadsLastMonth - a.downloadsLastMonth || a.name.localeCompare(b.name));
    candidates = candidates.slice(0, LIMIT);
    log(`${candidates.length} candidates after filtering, packing`);
  }

  const packed = [];
  const failed = [];
  let done = 0;
  await mapLimit(candidates, CONCURRENCY, async entry => {
    if (Date.now() - startedAt > DEADLINE_MS) { failed.push({ name: entry.name, version: entry.version, packError: 'deadline reached before pack' }); return; }
    const result = await packOne(entry);
    done++;
    if (result.packError) { failed.push(result); log(`[${done}/${candidates.length}] FAILED ${entry.name}: ${result.packError}`); }
    else { packed.push(result); log(`[${done}/${candidates.length}] ${entry.name}@${entry.version} ${result.fileCount} files`); }
  });
  packed.sort((a, b) => b.downloadsLastMonth - a.downloadsLastMonth || a.name.localeCompare(b.name));

  if (FROM_INDEX) {
    const previous = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    const byName = new Map(previous.packages.map(p => [p.name, p]));
    let mismatches = 0;
    for (const p of packed) {
      const old = byName.get(p.name);
      if (old && old.contentHash !== p.contentHash) { mismatches++; log(`content hash changed: ${p.name}@${p.version}`); }
    }
    log(`${packed.length} re-packed, ${mismatches} content hash mismatches`);
    process.exitCode = mismatches ? 1 : 0;
    return;
  }

  const index = {
    builtAt: new Date(startedAt).toISOString(), queries: QUERIES, pagesPerQuery: PAGES_PER_QUERY, shortlist: SHORTLIST, limit: LIMIT,
    node: process.version, durationMs: Date.now() - startedAt,
    packageCount: packed.length, packages: packed.map(({ pythonMarkers: _p, files: _f, ...rest }) => rest),
    packFailures: failed.map(f => ({ name: f.name, version: f.version, error: f.packError })),
  };
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));
  // File lists are large and derivable from the tarballs, so they live beside the index and stay out of git.
  fs.writeFileSync(path.join(CORPUS, 'files.json'), JSON.stringify(Object.fromEntries(packed.map(p => [`${p.name}@${p.version}`, p.files]))));
  fs.writeFileSync(path.join(CORPUS, 'excluded.json'), JSON.stringify(excluded.sort((a, b) => a.name.localeCompare(b.name)), null, 2));
  fs.writeFileSync(path.join(CORPUS, 'out-of-scope-python.json'), JSON.stringify(packed.filter(p => p.pythonMarkers.length).map(p => ({ name: p.name, version: p.version, markers: p.pythonMarkers })), null, 2));
  log(`wrote ${INDEX}: ${packed.length} packages, ${failed.length} pack failures, ${excluded.length} excluded`);
}

main().catch(error => { log(error.stack || error.message); process.exitCode = 1; });
