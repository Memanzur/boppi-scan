/**
 * Inspect-only facts about a server entry that change no grade (D-3).
 * Header names are read like env names; header values are never read, kept
 * or compared. Whether a credential header adds credential reach is a rubric
 * decision, so these facts are reported and not fed to the graph.
 */
'use strict';

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,120}$/;
const CREDENTIAL_HEADER = /(authorization|token|api[-_]?key|secret|cookie|credential|password|session)/i;

/** { headerNames, credentialHeaderNames, headersHelper } for one server, or null when there is nothing to report. */
function configFacts(server) {
  if (!server || typeof server !== 'object') return null;
  const headers = server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers) ? server.headers : {};
  const headerNames = Object.keys(headers).filter(name => HEADER_NAME.test(name)).sort();
  const headersHelper = typeof server.headersHelper === 'string' && server.headersHelper.trim() !== '';
  if (!headerNames.length && !headersHelper) return null;
  return { inspectOnly: true, headerNames, credentialHeaderNames: headerNames.filter(name => CREDENTIAL_HEADER.test(name)), headersHelper };
}

/** Attach facts to each inventory server record by its scan label. Returns how many records gained facts. */
function attach(clients, mcpServers) {
  let count = 0;
  for (const client of clients) {
    if (!client.agentId) continue;
    for (const record of mcpServers) {
      if (record.agentId !== client.agentId) continue;
      const facts = configFacts(client.mergedServers[record.name]);
      if (facts) { record.configFacts = facts; count++; }
    }
  }
  return count;
}

/** One COVERAGE sentence, or '' when no server sends credential headers. */
function coverageSentence(mcpServers) {
  const holders = (mcpServers || []).filter(s => s.configFacts && (s.configFacts.credentialHeaderNames.length || s.configFacts.headersHelper));
  if (!holders.length) return '';
  const names = holders.map(s => `${s.name} (${[...s.configFacts.credentialHeaderNames, ...(s.configFacts.headersHelper ? ['headersHelper'] : [])].join(', ')})`);
  return `${holders.length} server${holders.length === 1 ? ' sends' : 's send'} credential headers: ${names.join('; ')}. Header values are never read. Whether this counts as credential reach is an open rubric question, so no grade changed.`;
}

module.exports = { configFacts, attach, coverageSentence };
