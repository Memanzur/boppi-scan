/** Self-contained HTML report. The score is the terminal score. */
'use strict';
const path = require('path');
const { rankPredictions } = require('../predict');
const { buildSecurityReport, listRisks, CLOSING_LINE } = require('../securityReport');

const SEVERITY_ORDER = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sevBadge(severity) {
  const label = severity ? `${severity.charAt(0).toUpperCase()}${severity.slice(1)}` : 'Info';
  return `<span class="sev sev-${esc(severity)}">${esc(label)}</span>`;
}

function portableDisplay(file, home) {
  if (typeof file !== 'string' || !file) return null;
  if (file === '~' || file.startsWith('~/')) return file;
  if (!home || file.startsWith('path_')) return null;
  const root = path.resolve(home);
  const abs = path.resolve(file);
  if (abs === root || abs.startsWith(root + path.sep)) return `~${abs.slice(root.length).split(path.sep).join('/')}`;
  return null;
}

function scrubHome(text, home) {
  if (!home || home.length < 2) return text;
  const root = path.resolve(home);
  return String(text).split(root).join('~').split(root.split(path.sep).join('/')).join('~');
}

function friendlyWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just now';
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} at ${hours}:${minutes} ${suffix}`;
}

function configFileFor(report, agentName, home) {
  const client = (report.discovery || []).find(item => item.label === agentName);
  if (!client) return null;
  const found = (client.files || []).filter(file => file.status === 'found' && file.serverCount > 0 && file.format !== 'text' && file.format !== 'presence');
  const chosen = found.find(file => file.scope === 'user') || found[0];
  return chosen ? portableDisplay(chosen.path, home) : null;
}

function serverNamesFor(report, agentName) {
  const agent = ((report.inventory && report.inventory.agents) || []).find(item => item.name === agentName);
  if (!agent) return [];
  return ((report.inventory && report.inventory.mcpServers) || []).filter(server => server.agentId === agent.id).map(server => server.name);
}

function plainWhy(sentence) {
  const text = sentence || '';
  if (/use the \S+ key and reach the internet/.test(text)) return 'If this tool is tricked, that key can be used from the internet.';
  if (/read the home folder and reach the internet/.test(text)) return 'Anything in your home folder, including other keys and private files, can leave this computer.';
  if (/read ~\/\.ssh and reach the internet/.test(text)) return 'Your SSH keys can be copied off this computer.';
  if (/run a shell and reach the internet/.test(text)) return 'A web page or a bad prompt can talk this tool into running commands here.';
  if (/run a shell on content/.test(text)) return 'Outside content can steer a tool that is allowed to run commands.';
  if (/run a shell/.test(text)) return 'This tool can run commands on this computer.';
  if (/reach the internet/.test(text)) return 'This tool can send what it reads to a service outside this computer.';
  if (/read the home folder/.test(text)) return 'This tool can open private files in your home folder.';
  if (/read ~\/\.ssh/.test(text)) return 'This tool can open your SSH keys.';
  if (/use the \S+ key/.test(text)) return 'That key is available to the tool, so a mistake can use it.';
  return 'This setup gives the tool more access than it needs.';
}

function plainFix(risk, report, home) {
  const sentence = risk.sentence || '';
  const key = (sentence.match(/use the (\S+) key/) || [])[1];
  if (key) {
    const file = configFileFor(report, risk.agent, home);
    if (file) return `Move ${key} out of ${file} into your OS keychain.`;
    return `Move ${key} out of ${risk.agent} config into your OS keychain.`;
  }
  if (/read the home folder/.test(sentence)) return 'Limit the filesystem server to a project folder instead of your home folder.';
  if (/read ~\/\.ssh/.test(sentence)) return 'Point the filesystem server at a project folder instead of ~/.ssh.';
  if (/read files/.test(sentence)) return 'Limit the filesystem server to the folder this tool actually needs.';
  const via = (sentence.match(/via the (.+) server/) || [])[1];
  if (/run a shell/.test(sentence)) {
    return via
      ? `Remove the ${via} server, or stop this tool from running a shell on outside content.`
      : 'Turn off shell access for this tool, or allow only commands you trust.';
  }
  if (via) return `Disconnect the ${via} server if ${risk.agent} does not need it.`;
  return 'Remove the access this tool does not need, then scan again.';
}

function hygieneWhy(sentence) {
  if (/bypass permission prompts|not to ask before tools run/.test(sentence)) return 'The tool can take actions without stopping to ask you.';
  if (/accepts edits without a prompt/.test(sentence)) return 'File changes can land before you have a chance to review them.';
  if (/Bash with no command restriction/.test(sentence)) return 'Any shell command is pre-approved, including commands that read keys or change files.';
  if (/auto-approves/.test(sentence)) return 'Those tools can run without you confirming them.';
  return 'This setting gives the tool more freedom than a careful setup would.';
}

function hygieneFix(sentence) {
  if (/bypass permission prompts|not to ask before tools run/.test(sentence)) return 'Set permissions.defaultMode to default so Claude Code asks before tools run.';
  if (/accepts edits without a prompt/.test(sentence)) return 'Set permissions.defaultMode to default so Claude Code asks before it edits files.';
  if (/Bash with no command restriction/.test(sentence)) return 'Replace the open Bash allow rule with the specific commands you want Claude Code to run.';
  if (/auto-approves/.test(sentence)) return 'Turn off auto-approve for that server so you confirm each tool first.';
  return 'Tighten this setting so the tool asks before it acts.';
}

function verdictFor(security, risks, hygiene, keyCount) {
  if (security.clean && hygiene.length === 0) {
    return keyCount
      ? 'No risky AI access found. Key names are listed below. Values were not collected.'
      : 'No risky AI access found.';
  }
  const internet = risks.some(risk => /internet/.test(risk.sentence));
  const keys = risks.some(risk => /\bkey\b/.test(risk.sentence));
  const files = risks.some(risk => /read /.test(risk.sentence));
  const shell = risks.some(risk => /shell/.test(risk.sentence));
  let lead;
  if (keys && internet) lead = 'Your AI tools can reach your keys and the internet.';
  else if (files && internet) lead = 'Your AI tools can read your files and reach the internet.';
  else if (shell && internet) lead = 'Your AI tools can run commands and reach the internet.';
  else if (risks[0]) lead = /[.!?]$/.test(risks[0].sentence) ? risks[0].sentence : `${risks[0].sentence}.`;
  else lead = 'No risky connections found.';
  const count = risks.length;
  const items = count === 1 ? '1 item' : `${count} items`;
  if (count && hygiene.length) return `${lead} Fix the ${items} below, then tighten the settings that follow.`;
  if (count) return `${lead} Fix the ${items} below.`;
  if (hygiene.length) return `${lead} Tighten the settings below.`;
  return lead;
}

function checkedLine(checked) {
  if (!checked) return null;
  const tools = Number(checked.tools) || 0;
  const places = Number(checked.configLocations) || 0;
  const present = Number(checked.present) || 0;
  const installed = present === 0 ? 'None are installed.' : present === 1 ? '1 is installed.' : `${present} are installed.`;
  return `What was checked: ${tools} AI tools across ${places} config locations. ${installed}`;
}

function plainGood(line) {
  return String(line || '')
    .replaceAll('MCP servers', 'connected tools')
    .replaceAll('MCP server', 'connected tool');
}

function toolRows(report) {
  const found = (report.firstRun && report.firstRun.found) || [];
  const rows = found.filter(item => item && item.name && item.name !== 'Provider keys').map(item => {
    const names = serverNamesFor(report, item.name);
    let detail = names.join(', ');
    if (!detail) {
      if (/no MCP servers/.test(item.detail || '')) detail = 'Config found, no connected tools';
      else detail = item.detail || 'Installed';
    }
    return { name: item.name, detail };
  });
  if (rows.length) return rows;
  return ((report.inventory && report.inventory.agents) || [])
    .filter(agent => agent.name !== 'Provider keys')
    .map(agent => {
      const names = serverNamesFor(report, agent.name);
      return { name: agent.name, detail: names.join(', ') || 'Installed' };
    });
}

function keyRows(report, home) {
  const rows = [];
  const seen = new Set();
  const add = row => {
    const id = `${row.name}|${row.where}`;
    if (!row.name || seen.has(id)) return;
    seen.add(id);
    rows.push(row);
  };
  for (const entry of report.credentialNames || []) {
    if (!entry || !entry.name) continue;
    const where = entry.where || 'this computer';
    add({ name: entry.name, where: `Found in ${where}. Value not shown.`, fix: '' });
  }
  const agents = (report.inventory && report.inventory.agents) || [];
  for (const server of (report.inventory && report.inventory.mcpServers) || []) {
    const agent = agents.find(item => item.id === server.agentId);
    if (!agent || agent.name === 'Provider keys') continue;
    const file = configFileFor(report, agent.name, home);
    for (const name of server.credentialReferences || []) {
      if (!name || name === 'inline-argument' || String(name).startsWith('header:')) continue;
      const where = file ? `Found in ${agent.name}, ${file}. Value not shown.` : `Found in ${agent.name}. Value not shown.`;
      const fix = file ? `Move ${name} out of ${file} into your OS keychain.` : `Move ${name} into your OS keychain.`;
      add({ name, where, fix });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.where.localeCompare(b.where));
  return rows;
}

/** Plain-language view. Call this while discovery still has the raw config, before paths are made portable. */
function prepareHtml(report, home) {
  const security = report.securityReport || buildSecurityReport(report, home);
  const ranked = listRisks(report, home, 5);
  const risks = ranked.map((risk, index) => ({
    n: index + 1,
    severity: risk.severity,
    agent: risk.agent || 'This tool',
    sentence: risk.sentence,
    why: plainWhy(risk.sentence),
    fix: plainFix(risk, report, home),
  }));
  const hygiene = ((report.firstRun && report.firstRun.hygiene) || []).map(item => ({
    severity: item.severity || 'medium',
    tool: item.tool || 'This tool',
    sentence: item.sentence,
    why: hygieneWhy(item.sentence),
    fix: hygieneFix(item.sentence),
  }));
  const keys = keyRows(report, home);
  const totalPaths = (report.paths || []).length;
  const extra = totalPaths - risks.length;
  return {
    when: friendlyWhen(report.startedAt),
    security,
    verdict: verdictFor(security, risks, hygiene, keys.length),
    scoreNote: security.clean && hygiene.length
      ? 'The score stays at 100 because nothing is connected in a risky way. The settings below still need a look.'
      : '',
    checked: checkedLine(report.firstRun && report.firstRun.checked),
    good: ((report.firstRun && report.firstRun.good) || []).map(plainGood),
    risks,
    more: extra > 0 ? (extra === 1 ? '1 more risk is in Technical details.' : `${extra} more risks are in Technical details.`) : '',
    hygiene,
    tools: toolRows(report),
    keys,
    incomplete: report.incomplete || [],
  };
}

function friendlyHtml(view) {
  const security = view.security;
  const grade = esc(security.grade || 'A');
  const gradeClass = `grade-${esc(String(security.grade || 'A').toLowerCase())}`;
  const risks = view.risks.length ? `
  <section class="block" aria-labelledby="risks-title">
    <h2 id="risks-title">Your biggest risks</h2>
    <ol class="risks">
      ${view.risks.map(risk => `
      <li class="card">
        <div class="risk-head">
          <span class="num" aria-hidden="true">${risk.n}</span>
          ${sevBadge(risk.severity)}
          <span class="who">${esc(risk.agent)}</span>
        </div>
        <p class="lead">${esc(risk.sentence)}</p>
        <p class="why"><span>Why it matters.</span> ${esc(risk.why)}</p>
        <p class="fix"><span>Fix.</span> ${esc(risk.fix)}</p>
      </li>`).join('')}
    </ol>
    ${view.more ? `<p class="more">${esc(view.more)}</p>` : ''}
  </section>` : '';

  const hygiene = view.hygiene.length ? `
  <section class="block" aria-labelledby="settings-title">
    <h2 id="settings-title">Settings to tighten</h2>
    <ul class="settings">
      ${view.hygiene.map(item => `
      <li class="card">
        <div class="risk-head">
          ${sevBadge(item.severity)}
          <span class="who">${esc(item.tool)}</span>
        </div>
        <p class="lead">${esc(item.sentence)}</p>
        <p class="why"><span>Why it matters.</span> ${esc(item.why)}</p>
        <p class="fix"><span>Fix.</span> ${esc(item.fix)}</p>
      </li>`).join('')}
    </ul>
  </section>` : '';

  const toolList = view.tools.length
    ? view.tools.map(tool => `<li><b>${esc(tool.name)}</b><span>${esc(tool.detail)}</span></li>`).join('')
    : '<li class="empty">No AI tools were found.</li>';
  const keyList = view.keys.length
    ? view.keys.map(key => `<li><b>${esc(key.name)}</b><span>${esc(key.where)}</span>${key.fix ? `<span class="fixline">${esc(key.fix)}</span>` : ''}</li>`).join('')
    : '<li class="empty">No key names were found.</li>';
  const good = view.good.length ? `<ul class="good">${view.good.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : '';
  const incomplete = view.incomplete.length
    ? `<p class="incomplete">This scan could not read: ${view.incomplete.map(esc).join(', ')}.</p>`
    : '';
  const checked = view.security.clean && view.checked ? `<p class="checked">${esc(view.checked)}</p>${good}` : '';
  const foundChecked = !view.security.clean && view.checked ? `<p class="checked">${esc(view.checked)}</p>` : '';

  return `
  <header>
    <h1 class="brand"><span class="mark" aria-hidden="true">B</span> <span class="logo">Boppi</span></h1>
    <p class="sub">Scan report</p>
    <p class="when">${esc(view.when)}</p>
    <p class="local">Scanned locally. Nothing left this computer.</p>
  </header>

  <section class="score-card ${gradeClass}" aria-label="Security score ${esc(security.score)}/100, grade ${grade}. Higher is safer.">
    <div class="score-row">
      <p class="score-figure"><span class="score-num">${esc(security.score)}</span><span class="score-denom">/100</span></p>
      <p class="grade" aria-label="Grade ${grade}">${grade}</p>
    </div>
    <p class="higher">Higher is safer</p>
    <p class="verdict">${esc(view.verdict)}</p>
    ${view.scoreNote ? `<p class="note">${esc(view.scoreNote)}</p>` : ''}
    ${checked}
    ${incomplete}
  </section>
  ${risks}
  ${hygiene}

  <section class="block" id="found" aria-labelledby="found-title">
    <h2 id="found-title">What we found</h2>
    <h3>AI tools</h3>
    <ul class="found-list">${toolList}</ul>
    <h3>Key names</h3>
    <p class="kicker">Values are never shown.</p>
    <ul class="found-list keys">${keyList}</ul>
    ${foundChecked}
  </section>`;
}

function technicalHtml(report) {
  const { inventory, paths, prioritization } = report;
  const byAgent = new Map(prioritization.perAgent.map(agent => [agent.agentId, agent]));
  const agentName = id => inventory.agents.find(agent => agent.id === id)?.name || id;
  const openFindings = inventory.findings
    .filter(finding => !['resolved', 'accepted_risk', 'false_positive'].includes(finding.status))
    .sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));
  const ranked = rankPredictions(report.predictions || [], paths);
  const plan = report.remediationPlan;
  const editSentence = step => `Remove the "${step.edit.server}" entry from ${step.client.label}'s MCP configuration.`;
  const serverRows = inventory.mcpServers.map(server => {
    const agent = inventory.agents.find(candidate => candidate.id === server.agentId);
    const capabilities = (server.capabilities || []).join(', ') || 'No supported capability identified';
    return `<tr><td><b>${esc(server.name)}</b></td><td>${esc(agent?.name || 'Unknown agent')}</td><td>${esc(capabilities)}</td></tr>`;
  }).join('');
  const coverageNote = report.incomplete?.length
    ? `Incomplete sources: ${report.incomplete.join(', ')}.`
    : 'Complete for the supported configuration sources that were found.';
  const seconds = Number.isFinite(report.durationMs) ? (report.durationMs / 1000).toFixed(2) : null;

  return `
  <p class="tech-intro">The lists above are the plain version. This section keeps the evidence: servers, capabilities, finding IDs, and the limits of the scan.</p>
  ${seconds ? `<p class="tech-meta">Finished in ${esc(seconds)} seconds. Scanner version ${esc(report.version || '')}.</p>` : ''}

  <h2>What this scan established</h2>
  <div class="card">
    <div class="kv"><b>Established:</b> ${inventory.agents.length} agent${inventory.agents.length === 1 ? '' : 's'}, ${inventory.mcpServers.length} MCP server${inventory.mcpServers.length === 1 ? '' : 's'}, and ${report.portableFilesRead.length} configuration file${report.portableFilesRead.length === 1 ? '' : 's'} examined.</div>
    <div class="kv"><b>Not established:</b> runtime behavior, activity absent from configuration, or access not evidenced by the scanned metadata.</div>
    <div class="kv muted small">${esc(coverageNote)} A clean result is not proof that the environment is safe.</div>
  </div>

  <h2>Credential names</h2>
  <div class="card">
    <div class="kv muted">Values are never collected.</div>
    ${((report.credentialNames || []).map(entry => `<div class="kv">${esc(entry.name)} <span class="muted">present in ${esc(entry.where)}</span></div>`).join(''))
      || ((report.inlineCredentials || []).length ? '' : '<div class="kv muted">No provider key names in the environment or the checked dotfiles.</div>')}
    ${(report.inlineCredentials || []).map(entry => `<div class="kv">Plaintext credential in ${esc(entry.label)} / ${esc(entry.server)} <span class="muted">${esc(entry.names)} (value redacted)</span></div>`).join('')}
  </div>

  <h2>Discovered MCP servers and capabilities</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Server</th><th>Agent</th><th>Supported capabilities</th></tr></thead>
    <tbody>${serverRows || '<tr><td colspan="3" class="muted">No supported MCP servers were found in the examined files.</td></tr>'}</tbody>
  </table></div>

  ${report.historyChanges ? `<h2>Changes since last scan</h2><div class="card"><div class="kv">${report.historyChanges.newPaths} new exposure paths · ${report.historyChanges.resolvedPaths} resolved/no longer present · ${report.historyChanges.agentDelta >= 0 ? '+' : ''}${report.historyChanges.agentDelta} agents · ${report.historyChanges.serverDelta >= 0 ? '+' : ''}${report.historyChanges.serverDelta} MCP servers.</div></div>` : '<h2>Changes since last scan</h2><div class="card muted">First local scan. Run Boppi again after changing the environment to compare results.</div>'}

  ${ranked.length ? `
  <h2>Root cause: the single config edit that breaks the most exposures</h2>
  <div class="card accent">
    <b>${esc(editSentence(ranked[0].prediction))}</b>
    <div class="kv">Breaks <b>${ranked[0].prediction.predictedEliminated.length} of ${paths.length}</b> exposures${ranked[0].eliminatedSeverity.critical ? ` (${ranked[0].eliminatedSeverity.critical} critical)` : ''}; ${paths.length - ranked[0].prediction.predictedEliminated.length} would remain. Checked by rescanning without the server.</div>
    ${ranked[0].prediction.disruption ? `<div class="kv muted small">Cost: ${ranked[0].prediction.disruption.lost.length ? `the agent loses ${esc(ranked[0].prediction.disruption.lost.join(', '))}` : 'the agent loses no capability it does not also get from another server'}.</div>` : ''}
    ${plan && plan.steps.length > 1 ? `<div class="kv muted small">Plan to break all ${plan.targetedExposures} high-or-critical exposures (${plan.steps.length} changes):</div><ol class="small muted plan">${plan.steps.map(step => `<li>${esc(editSentence(step))} <b>(breaks ${step.breaksCount})</b></li>`).join('')}</ol>` : ''}
  </div>` : ''}

  <h2>Potential exposure paths (${paths.length})</h2>
  ${paths.length ? paths.map(item => `
  <div class="card">
    ${sevBadge(item.severity)} <b>${esc(item.label)}</b> <span class="muted small">· ${esc(item.templateId)} · agent: ${esc(item.agentName)} · confidence ${esc(item.confidence)}${item.stale ? ' · stale evidence' : ''}</span>
    <div class="chain">${item.nodes.map(node => `<span class="chip">${esc(node.label)}</span>`).join('<span class="arr">→</span>')}</div>
    <div class="kv"><b>Why it matters:</b> ${esc(item.whyItMatters)}</div>
    <div class="kv"><b>Suggested fix:</b> ${esc(item.remediation)}</div>
    <div class="kv muted small">${esc(item.disclaimer)} Evidence sources: ${item.evidenceCount}.</div>
  </div>`).join('') : '<div class="card muted">No potential exposure paths from the evidenced inventory.</div>'}

  <h2>Findings (${openFindings.length})</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Severity</th><th>Rule</th><th>Agent</th><th>Finding</th><th>Suggested fix</th></tr></thead>
    <tbody>${openFindings.length ? openFindings.map(finding => `
      <tr><td>${sevBadge(finding.severity)}</td><td>${esc(finding.ruleId)}</td><td>${esc(agentName(finding.agentId))}</td>
      <td><b>${esc(finding.title)}</b><div class="muted small">${esc(finding.description)}</div></td><td class="small">${esc(finding.recommendation)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">No rule-engine findings from the evidenced inventory.</td></tr>'}</tbody>
  </table></div>

  <h2>Agents (${inventory.agents.length})</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Agent</th><th>Risk</th><th>MCP servers</th><th>Worst exposure path</th></tr></thead>
    <tbody>${inventory.agents.map(agent => {
      const servers = inventory.mcpServers.filter(server => server.agentId === agent.id);
      const top = byAgent.get(agent.id);
      return `<tr><td><b>${esc(agent.name)}</b><div class="muted small">${esc(agent.vendor || '')} · ${esc(agent.type || '')}</div></td>
      <td>${agent.riskScore ?? 0}/100 ${sevBadge(agent.riskLevel || 'low')}</td>
      <td class="small">${servers.length ? servers.map(server => `${esc(server.name)} <span class="muted">(trust: ${esc(server.trustStatus)}${(server.capabilities || []).length ? ', ' + server.capabilities.map(esc).join(', ') : ''})</span>`).join('<br>') : '<span class="muted">none</span>'}</td>
      <td class="small">${top ? `${sevBadge(top.highestPath.severity)} ${esc(top.highestPath.label)}` : '<span class="muted">none</span>'}</td></tr>`;
    }).join('')}</tbody>
  </table></div>

  <div class="privacy">
    <b>Privacy.</b> This report was generated entirely on this machine. Files read (metadata only, sanitized in memory):
    ${report.portableFilesRead.length ? `<br>${report.portableFilesRead.map(file => `<code>${esc(file)}</code>`).join('<br>')}` : ' none.'}
    <br>Secret values, file contents, and raw path names are never collected; paths become fingerprints. Capabilities marked as inferred come from the server's evidenced identity (package names, directory arguments, environment variable names).
  </div>`;
}

function renderHtml(report) {
  const view = report.htmlView || prepareHtml(report, report.home);
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Boppi scan report</title>
<style>
  :root { --bg:#f4f1ea; --surface:#fffdf9; --ink:#1c1917; --muted:#44403c; --line:#e7e0d6; --accent:#1e3a5f;
    --crit:#991b1b; --crit-bg:#fee2e2; --high:#9a3412; --high-bg:#ffedd5; --med:#854d0e; --med-bg:#fef9c3; --low:#1e3a5f; --low-bg:#e8eef6;
    --a:#166534; --a-bg:#f0fdf4; --b:#1e40af; --b-bg:#eff6ff; --c:#854d0e; --c-bg:#fefce8; --d:#9a3412; --d-bg:#fff7ed; --f:#991b1b; --f-bg:#fef2f2; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.5; }
  .wrap { max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  header { margin-bottom:22px; }
  h1.brand { display:flex; align-items:center; gap:8px; font-weight:800; font-size:22px; letter-spacing:-0.02em; }
  .mark { display:inline-grid; place-items:center; width:28px; height:28px; border-radius:8px; background:var(--accent); color:#fff; font-size:16px; font-weight:800; }
  .sub { font-size:15px; font-weight:650; color:var(--muted); margin-top:8px; }
  h2 { font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0 0 12px; }
  h3 { font-size:15px; font-weight:800; margin:16px 0 8px; }
  .when, .local { color:var(--muted); font-size:15px; }
  .local { color:#166534; font-weight:650; margin-top:2px; }
  .score-card { border-radius:20px; padding:22px 22px 20px; margin:8px 0 28px; border:1px solid var(--line); }
  .grade-a { background:var(--a-bg); } .grade-b { background:var(--b-bg); } .grade-c { background:var(--c-bg); } .grade-d { background:var(--d-bg); } .grade-f { background:var(--f-bg); }
  .score-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .score-figure { font-weight:800; letter-spacing:-0.04em; line-height:0.9; }
  .score-num { font-size:84px; }
  .grade-a .score-num { color:var(--a); } .grade-b .score-num { color:var(--b); } .grade-c .score-num { color:var(--c); } .grade-d .score-num { color:var(--d); } .grade-f .score-num { color:var(--f); }
  .score-denom { font-size:28px; color:var(--muted); font-weight:700; letter-spacing:-0.03em; }
  .grade { width:72px; height:72px; border-radius:18px; display:grid; place-items:center; color:#fff; font-size:40px; font-weight:800; flex:0 0 auto; }
  .grade-a .grade { background:var(--a); } .grade-b .grade { background:var(--b); } .grade-c .grade { background:var(--c); } .grade-d .grade { background:var(--d); } .grade-f .grade { background:var(--f); }
  .higher { margin-top:8px; font-size:14px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .verdict { margin-top:10px; font-size:20px; font-weight:700; letter-spacing:-0.02em; line-height:1.35; }
  .note, .checked, .incomplete, .more, .kicker { margin-top:10px; color:var(--muted); font-size:15px; }
  .good { margin:8px 0 0 18px; color:var(--ink); }
  .good li { margin:4px 0; }
  .block { margin:0 0 28px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:16px 16px 14px; }
  .risks, .settings { list-style:none; display:flex; flex-direction:column; gap:12px; }
  .risk-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .num { width:28px; height:28px; border-radius:999px; background:var(--ink); color:#fff; display:inline-grid; place-items:center; font-size:14px; font-weight:800; }
  .who { font-weight:800; }
  .lead { margin-top:10px; font-size:17px; font-weight:650; }
  .why, .fix { margin-top:8px; }
  .why span, .fix span { font-weight:800; }
  .sev { display:inline-block; font-size:12px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; padding:3px 8px; border-radius:999px; }
  .sev-critical { background:var(--crit-bg); color:var(--crit); } .sev-high { background:var(--high-bg); color:var(--high); }
  .sev-medium { background:var(--med-bg); color:var(--med); } .sev-low { background:var(--low-bg); color:var(--low); }
  .found-list { list-style:none; display:flex; flex-direction:column; gap:10px; }
  .found-list li { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:2px; }
  .found-list li span, .fixline { color:var(--muted); overflow-wrap:anywhere; }
  .fixline { color:var(--ink); font-weight:650; }
  .empty { color:var(--muted); }
  details.tech { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:12px 16px 16px; }
  details.tech summary { cursor:pointer; font-weight:800; font-size:18px; }
  details.tech summary:focus-visible, a:focus-visible { outline:3px solid var(--b); outline-offset:3px; }
  .sum-hint { display:block; font-weight:500; color:var(--muted); font-size:14px; }
  .tech-body { margin-top:8px; }
  .tech-intro, .tech-meta { color:var(--muted); font-size:14px; margin:8px 0; }
  .tech-body h2 { font-size:16px; margin:22px 0 10px; }
  .kv { font-size:14px; margin-top:6px; } .kv b { font-weight:700; }
  .muted { color:var(--muted); } .small { font-size:13px; }
  .chain { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:10px 0; }
  .chip { background:#f4f1ea; border:1px solid var(--line); border-radius:7px; padding:3px 8px; font-size:13px; font-weight:650; }
  .arr { color:#9aa3b5; font-size:12px; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th { text-align:left; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); padding:8px 12px; background:#faf7f2; border-bottom:1px solid var(--line); }
  td { padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; font-size:14px; }
  tr:last-child td { border-bottom:none; }
  .accent { border-left:4px solid var(--accent); }
  .plan { margin:6px 0 0 18px; }
  .privacy { border-left:4px solid var(--accent); background:var(--surface); border-radius:0 12px 12px 0; padding:14px 16px; margin-top:22px; font-size:14px; color:var(--muted); }
  .privacy code, footer code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; overflow-wrap:anywhere; }
  .table-scroll { overflow-x:auto; }
  .lead, .fix, .why, .verdict { overflow-wrap:anywhere; }
  footer { margin-top:28px; padding-top:18px; border-top:1px solid var(--line); }
  footer p { margin-top:6px; }
  footer a { color:var(--b); font-weight:700; }
  .cta { font-weight:700; }
  @media (max-width: 480px) {
    .wrap { padding:20px 14px 48px; }
    .score-num { font-size:64px; }
    .score-denom { font-size:22px; }
    .grade { width:60px; height:60px; font-size:32px; }
    .verdict { font-size:18px; }
    h2 { font-size:20px; }
  }
  @media print {
    body { background:#fff; }
    .wrap { max-width:none; padding:0; }
    .score-card, .card, .found-list li, footer { break-inside:avoid; }
    details.tech, details.tech::details-content { content-visibility:visible !important; display:block !important; height:auto !important; }
    a[href]::after { content:" (" attr(href) ")"; font-weight:500; font-size:12px; }
    .score-card, .grade, .sev, .num, .mark { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head>
<body><div class="wrap">
  ${friendlyHtml(view)}
  <details class="tech" id="technical">
    <summary>Technical details<span class="sum-hint">Servers, finding IDs, and coverage</span></summary>
    <div class="tech-body">
      ${technicalHtml(report)}
    </div>
  </details>
  <footer>
    <p class="cta">${esc(CLOSING_LINE)}</p>
    <p><a href="https://boppi.io">boppi.io</a></p>
  </footer>
</div></body></html>`;
  return scrubHome(page, report.home);
}

module.exports = { renderHtml, prepareHtml };
