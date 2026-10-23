#!/usr/bin/env node
/**
 * Large-graph traversal benchmark (Phase 8). Builds a synthetic inventory,
 * turns it into a security graph, and times exposurePathEngine.analyze over
 * repeated runs. Prints node and edge counts, p50, p95, and max in
 * milliseconds, the traversal record, and the machine. Synthetic data only;
 * nothing is read from this machine's configuration.
 *
 *   node scripts/large-graph-bench.js [--agents 25] [--servers 8] [--caps 12] [--perms 10] [--tools 0] [--runs 30] [--report file]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'engine');
const models = require(path.join(root, 'models'));
const graphlib = require(path.join(root, 'securityGraph'));
const engine = require(path.join(root, 'exposurePathEngine'));

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const AGENTS = Number(arg('agents', 22)), SERVERS = Number(arg('servers', 15)), CAPS = Number(arg('caps', 20)), PERMS = Number(arg('perms', 10)), TOOLS = Number(arg('tools', 0)), RUNS = Number(arg('runs', 30));
const REPORT = arg('report', null);
const NOW = '2026-10-23T00:00:00.000Z';
const source = { id: 'src-bench', type: 'fixture', name: 'Synthetic benchmark', observedAt: NOW };
const RAW_CAPABILITIES = ['shell_access', 'execute_code', 'network_access', 'browse_internet', 'slack_send', 'send_email_outbound', 'read_files', 'customer_records', 'finance_ledger', 'patient_charts', 'employee_directory', 'repo_write', 'repo_read', 'credential_store', 'process_env', 'production cluster deploy', 'untrusted webpage', 'playwright browser', 'delete_file', 'gmail.readonly'];
const PERMISSION_CATEGORIES = ['read_files', 'access_customer_data', 'access_financial_data', 'send_external_message', 'call_external_api', 'run_shell_commands', 'access_credentials', 'modify_source_code', 'access_production_system', 'untrusted_external_content', 'read_email', 'send_email'];

function inventory() {
  const agents = [], permissions = [], mcpServers = [];
  for (let a = 0; a < AGENTS; a++) {
    const agent = models.createAgent({ name: `Agent ${a}`, type: 'ai_application', vendor: 'Bench', owner: `user${a % 7}@example.test`, deviceId: `device-${a % 11}`, source, confidence: 0.9, createdAt: NOW });
    agents.push(agent);
    for (let p = 0; p < PERMS; p++) {
      const category = PERMISSION_CATEGORIES[(a + p) % PERMISSION_CATEGORIES.length];
      permissions.push(models.createPermission({ agentId: agent.id, normalizedCategory: category, rawPermission: `${category}:${p}`, accessLevel: category === 'access_production_system' ? 'write' : 'read', normalizationConfidence: 0.9, normalizationReason: 'bench', source, createdAt: NOW }));
    }
    for (let s = 0; s < SERVERS; s++) {
      const capabilities = Array.from({ length: CAPS }, (_, i) => RAW_CAPABILITIES[(a + s + i) % RAW_CAPABILITIES.length]);
      mcpServers.push(models.createMCPServer({ agentId: agent.id, name: `server-${a}-${s}`, trustStatus: s % 3 ? 'unverified' : 'verified', confidence: 0.8, exposedTools: capabilities.slice(0, TOOLS).map(c => `tool_${c.replace(/\W+/g, '_')}`), capabilities, credentialReferences: s % 2 ? [`TOKEN_${a}_${s}`] : [], source, createdAt: NOW }));
    }
  }
  return { agents, integrations: [], permissions, mcpServers };
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]; }

(function main() {
  const inv = inventory();
  const built = process.hrtime.bigint();
  const graph = graphlib.buildGraph(inv);
  const buildMs = Number(process.hrtime.bigint() - built) / 1e6;
  for (let i = 0; i < 2; i++) engine.analyze(graph);
  const samples = [];
  let result = null;
  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint();
    result = engine.analyze(graph);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const report = {
    at: new Date().toISOString(),
    machine: { cpu: os.cpus()[0] && os.cpus()[0].model, cores: os.cpus().length, arch: process.arch, platform: process.platform, node: process.version },
    config: { agents: AGENTS, servers: SERVERS, caps: CAPS, perms: PERMS, tools: TOOLS, runs: RUNS },
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, buildMs: Number(buildMs.toFixed(1)) },
    analyzeMs: { p50: Number(percentile(samples, 0.5).toFixed(1)), p95: Number(percentile(samples, 0.95).toFixed(1)), max: Number(samples[samples.length - 1].toFixed(1)) },
    paths: result.paths.length,
    traversal: result.traversal,
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (REPORT) fs.writeFileSync(REPORT, text + '\n');
})();
