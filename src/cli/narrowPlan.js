/**
 * Narrow edits as plans: one server's single broad directory argument
 * pointed at a folder inside it, with the prediction from a rescan of the
 * edited entry. boppi fix --narrow plans toward the folder it is given;
 * boppi plan, the scan's next steps and the connector plan toward the project
 * folder Boppi runs from, so all three offer the same edit. Candidates are
 * never added to scan.predictions, so exports and pushes do not change.
 */
'use strict';
const fs = require('fs');
const fix = require('./fix');
const predict = require('./predict');
const narrowScope = require('./narrowScope');

/**
 * The narrow edit of one client's server toward `to`: { index, from, to,
 * label, edit, prediction }, or { error } when the server has no single broad
 * directory or `to` is not narrower. prediction is null when the scan has no
 * record of the server.
 */
function planFor(scan, options, client, serverName, to) {
  const entry = client.mergedServers[serverName];
  const broad = narrowScope.broadDirectories(entry, options.home);
  if (!broad.length) return { error: `"${serverName}" has no directory argument covering the home directory, a system root or a secrets folder, so there is nothing to narrow` };
  if (broad.length > 1) return { error: `"${serverName}" has ${broad.length} broad directory arguments; --narrow edits one, so narrow this entry by hand or remove it` };
  const [{ index, arg, label }] = broad;
  const problem = narrowScope.targetProblem({ from: arg, to, home: options.home });
  if (problem) return { error: `${problem}. --narrow needs an existing folder inside the one "${serverName}" has now` };
  const server = scan.inventory.mcpServers.find(s => s.agentId === client.agentId && s.name === serverName);
  const edit = narrowScope.describeEdit({ server: serverName, entry, index, to });
  const prediction = server ? predict.predictNarrow({ client, inventory: scan.inventory, observedAt: scan.startedAt, home: options.home, overlay: scan.overlayModel, scannerVersion: scan.scannerVersion, server, edit, entry: narrowScope.narrowedEntry(entry, index, to) }) : null;
  if (prediction) prediction.evidenceComplete = prediction.evidenceComplete && scan.traversal.complete === true;
  return { index, from: arg, to, label, edit, prediction };
}

/** The project folder narrowing targets: the real path of cwd, or null when it does not resolve. */
function projectFolder(options) { try { return fs.realpathSync(options.cwd); } catch (_) { return null; } }

/**
 * The narrow plan toward the project folder for one client's server, located
 * in a file Boppi edits, or null: it must have one broad directory argument
 * the project folder lies strictly inside, an evidence identity, and a
 * prediction that closes or lowers at least one path.
 */
function candidateFor(scan, options, client, serverName, descriptors = fix.descriptorsFor(options)) {
  const to = projectFolder(options);
  const descriptor = descriptors.find(d => d.clientKey === client.clientKey);
  if (!to || !descriptor || !client.mergedServers[serverName]) return null;
  const plan = planFor(scan, options, client, serverName, to);
  if (plan.error || !plan.prediction || !plan.edit.expectedIdentity) return null;
  if (!plan.prediction.predictedEliminated.length && !predict.loweredOf(plan.prediction).length) return null;
  const located = fix.locateServer(descriptor, serverName, options.cwd);
  return located ? { client, server: serverName, located, ...plan } : null;
}

/** Every narrow candidate toward the project folder, per scanned client and server. */
function candidates(scan, options) {
  const descriptors = fix.descriptorsFor(options);
  return scan.discovery.clients
    .filter(client => client.agentId && !client.scanError && client.primaryPath)
    .flatMap(client => Object.keys(client.mergedServers || {}).map(name => candidateFor(scan, options, client, name, descriptors)).filter(Boolean));
}

module.exports = { planFor, projectFolder, candidateFor, candidates };
