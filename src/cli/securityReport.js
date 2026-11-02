/**
 * The first-run report: a security score, three counts, and up to three
 * risks written as a sentence about a real tool and a real resource.
 */
'use strict';
const { securityScore } = require('./securityScore');

const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostnameOf(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) return null;
  try {
    const host = new URL(endpoint).hostname;
    return LOCAL_HOSTS.has(host) ? null : host;
  } catch (_) {
    return null;
  }
}

function rawServer(discovery, agentId, serverName) {
  const client = (discovery || []).find(item => item.agentId === agentId);
  const servers = client && client.mergedServers;
  if (!servers || !servers[serverName]) return null;
  return servers[serverName];
}

function looksLikeHome(arg, home) {
  if (typeof arg !== 'string') return false;
  if (arg === '~' || arg === '~/' || arg.startsWith('~/')) return true;
  if (!home) return false;
  const normalized = arg.replace(/\\/g, '/');
  const root = String(home).replace(/\\/g, '/');
  return normalized === root || normalized.startsWith(`${root}/`);
}

function fileSource(server, raw, home) {
  const args = raw && Array.isArray(raw.args) ? raw.args : [];
  if (args.some(arg => typeof arg === 'string' && /(^|[\\/])\.ssh([\\/]|$)/.test(arg))) return '~/.ssh';
  if (args.some(arg => looksLikeHome(arg, home))) return 'the home folder';
  if ((server.capabilities || []).includes('filesystem_access') || /file/i.test(server.name || '')) return 'files';
  return null;
}

function keyName(server) {
  const names = (server.credentialReferences || []).filter(name => name && name !== 'inline-argument' && !String(name).startsWith('header:'));
  return names[0] || null;
}

function egressPhrase(server) {
  if (!server) return null;
  const host = hostnameOf(server.endpoint);
  const networked = host || (server.capabilities || []).includes('network_access') || server.endpoint;
  if (!networked) return null;
  return host ? `${server.name} server (${host})` : `${server.name} server`;
}

function serverNamesOnPath(path) {
  const names = new Set();
  for (const node of path.nodes || []) {
    if (node.entityType === 'mcp_server') names.add(node.label);
    else if (node.entityType === 'permission') {
      // Derived permissions are labeled "<server> (<capability>)".
      const match = String(node.label || '').match(/^(.+) \([a-z0-9_]+\)$/);
      if (match) names.add(match[1]);
    }
  }
  return names;
}

function serversOnPath(path, inventory) {
  const names = serverNamesOnPath(path);
  return (inventory.mcpServers || []).filter(server => server.agentId === path.agentId && names.has(server.name));
}

function sentenceFor(path, inventory, discovery, home) {
  const agent = path.agentName || 'This tool';
  const servers = serversOnPath(path, inventory);
  const withRaw = servers.map(server => ({ server, raw: rawServer(discovery, path.agentId, server.name) }));
  const file = withRaw.map(item => fileSource(item.server, item.raw, home)).find(Boolean) || null;
  const key = withRaw.map(item => keyName(item.server)).find(Boolean) || null;
  const shell = servers.find(server => (server.capabilities || []).includes('shell_access') || /shell|commander/i.test(server.name));
  const egressServer = servers.find(server => egressPhrase(server));
  const egress = egressPhrase(egressServer);
  const via = egress ? `via the ${egress}` : null;

  if (path.templateId === 'EP-A' && file && via) return `${agent} can read ${file} and reach the internet ${via}`;
  if (path.templateId === 'EP-B' && via) {
    if (key) return `${agent} can use the ${key} key and reach the internet ${via}`;
    if (shell) return `${agent} can run a shell and reach the internet ${via}`;
  }
  if (path.templateId === 'EP-E' && shell) {
    const from = servers.find(server => server !== shell && ((server.capabilities || []).includes('untrusted_external_content') || /fetch|browser|search/i.test(server.name)));
    if (from) return `${agent} can run a shell on content from the ${from.name} server`;
    return `${agent} can run a shell`;
  }
  if (file && via) return `${agent} can read ${file} and reach the internet ${via}`;
  if (key && via) return `${agent} can use the ${key} key and reach the internet ${via}`;
  if (shell && via) return `${agent} can run a shell and reach the internet ${via}`;
  if (via) return `${agent} can reach the internet ${via}`;
  if (file) return `${agent} can read ${file}`;
  if (key) return `${agent} can use the ${key} key`;
  return `${agent} has a ${path.severity} configuration risk`;
}

function quoteServer(name) {
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : JSON.stringify(name);
}

function fixCommand(path, predictions, preferredServer) {
  const hits = (predictions || []).filter(prediction => prediction.edit
    && prediction.edit.action === 'remove_server'
    && prediction.agentId === path.agentId
    && (prediction.predictedEliminated || []).includes(path.exposureKey));
  if (!hits.length) return null;
  const chosen = hits.find(prediction => prediction.edit.server === preferredServer)
    || hits.slice().sort((a, b) => b.predictedEliminated.length - a.predictedEliminated.length || a.edit.server.localeCompare(b.edit.server))[0];
  const client = chosen.client && chosen.client.key;
  const server = quoteServer(chosen.edit.server);
  return client ? `boppi fix --server ${server} --client ${client}` : `boppi fix --server ${server}`;
}

function exposedKeyNames(report) {
  const names = new Set();
  for (const entry of report.credentialNames || []) if (entry && entry.name) names.add(entry.name);
  for (const entry of report.inlineCredentials || []) {
    for (const name of String(entry.names || '').split(',').map(part => part.trim()).filter(Boolean)) {
      if (name !== 'inline-argument') names.add(name);
    }
  }
  for (const server of (report.inventory && report.inventory.mcpServers) || []) {
    for (const name of server.credentialReferences || []) {
      if (name && name !== 'inline-argument') names.add(name);
    }
  }
  return [...names].sort();
}

function topRisks(report, home) {
  const ranked = (report.paths || []).slice().sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    || a.agentName.localeCompare(b.agentName)
    || a.templateId.localeCompare(b.templateId));
  return ranked.slice(0, 3).map(path => {
    const servers = serversOnPath(path, report.inventory || {});
    const egress = servers.find(server => egressPhrase(server));
    return {
      severity: path.severity,
      templateId: path.templateId,
      agent: path.agentName,
      sentence: sentenceFor(path, report.inventory || {}, report.discovery || [], home),
      fix: fixCommand(path, report.predictions, egress && egress.name),
    };
  });
}

function buildSecurityReport(report, home) {
  // Paths only. A rule finding that restates a path is not a second penalty.
  const scored = securityScore(report.paths);
  const risks = topRisks(report, home);
  const keys = exposedKeyNames(report);
  return {
    score: scored.score,
    grade: scored.grade,
    higherIsSafer: true,
    penalty: scored.penalty,
    counts: {
      aiTools: ((report.inventory && report.inventory.agents) || []).length,
      toolServers: ((report.inventory && report.inventory.mcpServers) || []).length,
      exposedKeys: keys.length,
    },
    exposedKeyNames: keys,
    risks,
    clean: scored.score === 100 && risks.length === 0,
  };
}

const CLOSING_LINE = 'See history, teams and approvals: npx boppi push';

module.exports = { buildSecurityReport, securityScore, sentenceFor, fixCommand, CLOSING_LINE };
