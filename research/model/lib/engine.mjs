// Runs the Boppi rules engine (bin/boppi.js of a checkout) as a black box.
// Each call gets its own throwaway home under the OS temp dir, so nothing on
// the real machine is read or changed. No network: scan and fix are local only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { diff } from './jsonops.mjs';

const run = promisify(execFile);
export const FAKE_HOME = '/home/dev';
// sha256('boppi-own-model-synthetic-data'), not a credential.
const GEN_FINGERPRINT_KEY = createHash('sha256').update('boppi-own-model-synthetic-data').digest('hex');
export const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const CLIENT_FILES = {
  cursor: ['.cursor', 'mcp.json'],
  'claude-desktop': ['.config', 'Claude', 'claude_desktop_config.json'],
};


export function catalogFor(engineDir) {
  const require = createRequire(import.meta.url);
  return require(path.join(engineDir, 'src', 'cli', 'mcpCatalog.js'));
}

function toReal(text, home) { return text.split(FAKE_HOME).join(home); }
function toFake(text, home) { return text.split(home).join(FAKE_HOME); }

// The engine derives ids (and so which exposure path it reports as the
// representative one) from the config file's absolute path. A work dir named
// by a caller-chosen slot keeps labels identical across runs and machines.
const WORK_ROOT = path.join(os.tmpdir(), 'boppi-model-gen');
function makeWork(slot) {
  const work = path.join(WORK_ROOT, String(slot));
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(work, 'home'), { recursive: true });
  fs.mkdirSync(path.join(work, 'cwd'), { recursive: true });
  // Fixed, public, non-secret fingerprint key so exposure path ids, and so the
  // representative path the engine reports, are the same on every run.
  fs.mkdirSync(path.join(work, 'home', '.boppi'), { recursive: true });
  fs.writeFileSync(path.join(work, 'home', '.boppi', 'fingerprint-key'), `${GEN_FINGERPRINT_KEY}\n`, { mode: 0o600 });
  return work;
}

function writeConfig(work, client, config, dirs) {
  const home = path.join(work, 'home');
  const file = path.join(home, ...CLIENT_FILES[client]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const dir of dirs || []) fs.mkdirSync(toReal(dir, home), { recursive: true });
  fs.writeFileSync(file, toReal(JSON.stringify(config, null, 2), home) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { home, file };
}

async function cli(engineDir, work, args) {
  const home = path.join(work, 'home');
  try {
    const { stdout } = await run(process.execPath, [path.join(engineDir, 'bin', 'boppi.js'), ...args, '--home', home, '--no-color'], {
      cwd: path.join(work, 'cwd'), env: { PATH: process.env.PATH, NO_COLOR: '1', HOME: home }, maxBuffer: 64 * 1024 * 1024, timeout: 60000,
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

/** Reduce a full --format json export to the labels the model learns. */
export function extractLabels(scan, home) {
  const real = scan.inventory.real;
  const serverById = new Map(real.mcpServers.map(s => [s.id, s.name]));
  const permServer = new Map(real.permissions.map(p => [p.id, serverById.get(p.integrationId)]));
  const findings = [];
  for (const f of real.findings || []) {
    if (f.status && f.status !== 'open') continue;
    const servers = [...new Set((f.contributingPermissions || []).map(id => permServer.get(id)).filter(Boolean))].sort();
    findings.push({ rule_id: f.ruleId, kind: 'engine', severity: f.severity, servers, title: f.title, chain: f.attackPath || f.description, recommendation: f.recommendation || '' });
  }
  for (const p of scan.exposurePaths || []) {
    const names = new Set(real.mcpServers.map(s => s.name));
    const servers = [...new Set(p.nodes.flatMap(n => {
      if (n.entityType === 'mcp_server') return [n.label];
      const m = n.entityType === 'permission' && String(n.label).match(/^(.+) \([a-z_]+\)$/);
      return m && names.has(m[1]) ? [m[1]] : [];
    }))].sort();
    findings.push({ rule_id: p.templateId, kind: 'path', severity: p.severity, servers, title: p.label, chain: p.nodes.map(n => n.label).join(' -> '), recommendation: '' });
  }
  for (const c of scan.configFindings || []) {
    const server = c.id.includes('.json:') ? c.id.split('.json:')[1].split(':')[0] : null;
    findings.push({ rule_id: c.ruleId, kind: 'config', severity: c.severity, servers: server ? [server] : [], title: toFake(c.title, home), chain: '', recommendation: toFake((c.remediation && c.remediation.summary) || '', home), autoFixable: !!c.autoFixable });
  }
  findings.sort((a, b) => (a.rule_id + a.servers.join(',')).localeCompare(b.rule_id + b.servers.join(',')));
  const maxRank = Math.max(-1, ...findings.map(f => SEVERITY_RANK[f.severity] ?? 0));
  const maxSeverity = maxRank < 0 ? 'none' : Object.keys(SEVERITY_RANK).find(k => SEVERITY_RANK[k] === maxRank);
  const risks = ((scan.securityReport && scan.securityReport.risks) || []).map(r => ({ severity: r.severity, rule_id: r.templateId, sentence: r.sentence, fix: r.fix }));
  const predictions = (scan.predictions || []).filter(p => p.edit && p.edit.action === 'remove_server')
    .map(p => ({ server: p.edit.server, client: p.client.key, eliminated: p.predictedEliminated.length }));
  const servers = real.mcpServers.map(s => ({ name: s.name, capabilities: [...(s.capabilities || [])].sort() })).sort((a, b) => a.name.localeCompare(b.name));
  return { max_severity: maxSeverity, findings, risks, predictions, servers };
}

export const findingKey = f => `${f.rule_id}|${f.servers.join(',')}`;

export async function scanConfig({ engineDir, client, config, dirs, slot }) {
  const work = makeWork(slot);
  try {
    const { home } = writeConfig(work, client, config, dirs);
    const out = await cli(engineDir, work, ['scan', '--only', client, '--format', 'json']);
    if (!out.stdout.trim().startsWith('{')) return { error: (out.stderr || out.stdout).slice(0, 300) };
    return { labels: extractLabels(JSON.parse(out.stdout), home) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Apply boppi fix in a throwaway home: first the safe automatic fixes
 * (boppi fix --yes), then while a high or critical risk remains, the server
 * removal the engine itself recommends (boppi fix --server X --client Y --yes),
 * at most three removals. Then rescan and judge the result.
 */
export async function fixAndRescan({ engineDir, client, config, dirs, before, slot }) {
  const work = makeWork(slot);
  try {
    const { home, file } = writeConfig(work, client, config, dirs);
    const commands = [];
    const readCfg = () => JSON.parse(toFake(fs.readFileSync(file, 'utf8'), home));
    let current = readCfg();
    const auto = await cli(engineDir, work, ['fix', '--yes', '--only', client]);
    if (JSON.stringify(readCfg()) !== JSON.stringify(current)) commands.push(`boppi fix --yes --only ${client}`);
    current = readCfg();
    let labels = (await scanOnce(engineDir, work, client, home)) || before;
    for (let round = 0; round < 3 && SEVERITY_RANK[labels.max_severity] >= 3; round++) {
      let server = null;
      const risk = labels.risks.find(r => /--server /.test(r.fix || ''));
      if (risk) server = risk.fix.match(/--server (\S+)/)[1];
      if (!server && labels.predictions.length) server = [...labels.predictions].sort((a, b) => b.eliminated - a.eliminated || a.server.localeCompare(b.server))[0].server;
      if (!server) {
        const hot = labels.findings.find(f => SEVERITY_RANK[f.severity] >= 3 && f.servers.length);
        if (hot) server = hot.servers[hot.servers.length - 1];
      }
      if (!server || !(current.mcpServers && server in current.mcpServers)) break;
      const res = await cli(engineDir, work, ['fix', '--server', server, '--client', client, '--yes']);
      const next = readCfg();
      if (JSON.stringify(next) === JSON.stringify(current)) break;
      commands.push(`boppi fix --server ${server} --client ${client} --yes`);
      current = next;
      void res;
      labels = (await scanOnce(engineDir, work, client, home)) || labels;
    }
    const after = labels;
    const ops = diff(config, current);
    return { commands, ops, after, verdict: judge(before, after) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function scanOnce(engineDir, work, client, home) {
  const out = await cli(engineDir, work, ['scan', '--only', client, '--format', 'json']);
  if (!out.stdout.trim().startsWith('{')) return null;
  return extractLabels(JSON.parse(out.stdout), home);
}

/**
 * Re-scan gate for a fix. Pass when:
 *  1. the highest severity went down (or, if it was medium or lower, the
 *     finding count went down or was already zero), and
 *  2. nothing new appears at or above the old highest severity.
 * A new lower-severity finding is allowed: removing the network leg of a
 * critical shell chain correctly leaves AE-010 (high, shell still prompts).
 */
export function judge(before, after) {
  const b = SEVERITY_RANK[before.max_severity] ?? -1;
  const a = SEVERITY_RANK[after.max_severity] ?? -1;
  const beforeKeys = new Set(before.findings.map(findingKey));
  const fresh = after.findings.filter(f => !beforeKeys.has(findingKey(f)));
  const freshAtOrAbove = fresh.filter(f => (SEVERITY_RANK[f.severity] ?? 0) >= b);
  let dropped;
  if (b >= 3) dropped = a < b;
  else dropped = before.findings.length === 0 || after.findings.length < before.findings.length;
  return { pass: dropped && freshAtOrAbove.length === 0, before: before.max_severity, after: after.max_severity, new_findings: fresh.map(findingKey) };
}
