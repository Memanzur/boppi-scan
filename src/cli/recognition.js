/**
 * Recognition: what the scan could and could not establish about each
 * server's identity. A server matched nothing (no catalog entry, no name
 * rule, no url, no directory argument, no declared capabilities) earns no
 * capability, no graph reach, and no exposure path, so until now it left
 * the report looking the same as an empty machine. This module names those
 * servers and, from the launch command, says whether the package is pinned
 * to a version or runs whatever is published at its next launch.
 */
'use strict';
const { identityOf } = require('./serverCatalog');

const LOCAL_RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno', 'python', 'python3', 'python2', 'ruby', 'php', 'java', 'go', 'dotnet', 'sh', 'bash', 'zsh']);
const LAUNCHER_LABEL = Object.freeze({ npm: 'npm package', pypi: 'PyPI package', docker: 'Docker image', url: 'remote server', local: 'local program', unknown: 'unknown launcher' });

function basename(command) {
  return typeof command === 'string' ? command.trim().split(/[\\/]/).pop() : '';
}

/** How the server starts, from the raw entry: a package launcher, a remote url, or a program on this machine. */
function launcherOf(server, identity) {
  if (identity) return identity.kind;
  const command = basename(server.command);
  if (!command) return 'unknown';
  if (LOCAL_RUNTIMES.has(command.toLowerCase())) return 'local';
  return /^(npx|uvx|docker)$/.test(command) ? command === 'npx' ? 'npm' : command === 'uvx' ? 'pypi' : 'docker' : 'local';
}

/**
 * pinned: an exact version is named. unpinned: no version, `latest`, or a
 * range, so the launcher fetches the newest published release each time.
 * tagged: a Docker tag, which the registry can move to new bytes at any
 * time; only a digest (@sha256:...) pins an image. not_applicable: a remote
 * url or a local program has no publish step.
 */
function pinOf(launcher, identity) {
  if (!['npm', 'pypi', 'docker'].includes(launcher)) return 'not_applicable';
  const version = identity && identity.version;
  if (!version) return 'unpinned';
  if (/^(latest|next|\*)$/i.test(version)) return 'unpinned';
  if (launcher === 'docker') return /^sha256:[0-9a-f]{64}$/i.test(version) ? 'pinned' : 'tagged';
  if (launcher === 'pypi' && !/^==/.test(version) && !/^[0-9]/.test(version)) return 'unpinned';
  if (/^[\^~><]/.test(version)) return 'unpinned';
  return 'pinned';
}

function reasonsFor(server, inference) {
  const reasons = [];
  if (!inference.catalog) reasons.push('not in the catalog');
  if (!inference.inferences.some(i => i.basis === 'inferred')) reasons.push('no name rule matched');
  if (!(server.url || server.endpoint)) reasons.push('no url');
  if (!inference.filesystemPaths.length) reasons.push('no directory argument');
  if (!(Array.isArray(server.capabilities) && server.capabilities.length)) reasons.push('no declared capabilities');
  return reasons;
}

/**
 * One record per server of one scanned client. `records` are the sanitized
 * scanner records (for ids); `mergedServers` the raw entries; `inferenceByServer`
 * the inference each produced.
 */
function describeClient({ clientKey, label, mergedServers, inferenceByServer, records }) {
  const out = [];
  for (const [name, server] of Object.entries(mergedServers || {})) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const inference = inferenceByServer[name];
    if (!inference) continue;
    const identity = identityOf(server);
    const launcher = launcherOf(server, identity);
    const record = (records || []).find(r => r.name === name) || null;
    const recognized = !!inference.catalog || inference.inferences.length > 0 || (Array.isArray(server.capabilities) && server.capabilities.length > 0);
    out.push({
      client: clientKey,
      clientLabel: label,
      server: name,
      serverId: record ? record.id : null,
      agentId: record ? record.agentId : null,
      recognized,
      reasons: recognized ? [] : reasonsFor(server, inference),
      launcher,
      launcherLabel: LAUNCHER_LABEL[launcher],
      identity: identity ? { kind: identity.kind, name: identity.name, version: identity.version || null } : null,
      pin: pinOf(launcher, identity),
      capabilityCount: inference.capabilities.length,
    });
  }
  return out;
}

function unrecognized(recognition) { return (recognition || []).filter(r => !r.recognized); }
function unpinned(recognition) { return (recognition || []).filter(r => r.pin === 'unpinned'); }
function tagged(recognition) { return (recognition || []).filter(r => r.pin === 'tagged'); }
function packageLaunched(recognition) { return (recognition || []).filter(r => r.pin !== 'not_applicable'); }

/** Sentence for the COVERAGE "not established" line, or '' when every server was recognized. */
function coverageSentence(recognition) {
  const list = unrecognized(recognition);
  if (!list.length) return '';
  const names = list.map(r => r.server).join(', ');
  return `What ${list.length} unrecognized server${list.length === 1 ? '' : 's'} (${names}) can do.`;
}

/** The launch line for one record, from already-sanitized evidence only. */
function launchSummary(record, server) {
  const pin = record.pin === 'unpinned' ? ', unpinned' : record.pin === 'pinned' ? `, pinned ${record.identity.version}` : record.pin === 'tagged' ? `, tag ${record.identity.version} (a tag can move; a digest pins)` : '';
  const what = record.identity ? record.identity.name : (server && server.command) || record.launcherLabel;
  return `${what} (${record.launcherLabel}${pin})`;
}

const ADVICE = 'Treat each as unknown reach, not as safe. Pin the version, declare a "capabilities" array in the entry, or set "requireKnownCapabilities": true in boppi.policy.json to fail scans on them.';
const UNPINNED_ADVICE = 'Each runs whatever version is published at its next launch; pin with name@1.2.3, name==1.2.3, or image@sha256:<digest>.';
const TAGGED_ADVICE = 'A Docker tag is a moving label, not a fixed release; pin with image@sha256:<digest> to run the same bytes every time.';

module.exports = { describeClient, unrecognized, unpinned, tagged, packageLaunched, coverageSentence, launchSummary, launcherOf, pinOf, ADVICE, UNPINNED_ADVICE, TAGGED_ADVICE };
