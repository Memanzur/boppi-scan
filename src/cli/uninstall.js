/**
 * boppi uninstall: remove everything Boppi stored on this machine.
 *
 * Everything Boppi writes lives under <home>/.boppi (history, settings,
 * fingerprint key, hook events, connector pairing and claims, stored tool
 * lists, overlay state, demo sandbox, fix exports, update notice, backups).
 * The command lists it, then deletes that one directory after confirmation.
 * A fix backup is the only way back from a fix that is still applied, so the
 * directory is kept while any is live, unless --include-backups is given.
 * Backups of fixes already rolled back do not hold it up.
 *
 * It never edits a client's settings: Boppi does not install the Claude Code
 * hook, so it does not remove it either. It reads the Claude Code settings
 * files and prints each hook entry that runs `boppi hook`, with its location,
 * because a left-over entry recreates <home>/.boppi on the next MCP call.
 * It never contacts the workspace: `boppi connect unpair` revokes a paired
 * device there. The program itself goes with `npm uninstall -g boppi`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fix = require('./fix');
const connect = require('./connect');

const BOPPI_HOOK = /(^|[\s/\\"'])boppi(\.js|\.cmd)?["']?\s+hook(\s|$)/;
const EXPLAINED = Object.freeze({
  'history.json': 'scan history',
  'settings.json': 'privacy settings',
  'fingerprint-key': 'fingerprint key',
  'connector.json': 'workspace pairing and device credential',
  'connector-claims.json': 'connector claims',
  'update-notice.json': 'update notice',
  'events.jsonl': 'hook events',
  backups: 'fix backups',
  'fix-exports': 'fix exports',
  discovery: 'stored tool lists',
  intelligence: 'overlay state',
  demo: 'demo sandbox',
  locks: 'locks',
});

function boppiDir(home) { return path.join(home, '.boppi'); }

/** Files and bytes under dir, without following links. */
function measure(dir) {
  let files = 0, bytes = 0;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else { files++; bytes += fs.lstatSync(full).size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

/** What <home>/.boppi holds, one row per top-level entry. */
function inventory(home) {
  const dir = boppiDir(home);
  let stat;
  try { stat = fs.lstatSync(dir); } catch (_) { return { dir, exists: false, rows: [] }; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return { dir, exists: true, refused: `${dir} is not a plain directory (a link or a file); remove it yourself after checking where it points` };
  const rows = fs.readdirSync(dir, { withFileTypes: true }).map(entry => {
    const full = path.join(dir, entry.name);
    const size = entry.isDirectory() ? measure(full) : { files: 1, bytes: fs.lstatSync(full).size };
    const known = Object.keys(EXPLAINED).find(name => entry.name === name || entry.name.startsWith(`${name}.`));
    return { name: entry.name, what: known ? EXPLAINED[known] : 'other Boppi file', ...size };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const backups = rows.find(row => row.name === 'backups');
  return { dir, exists: true, rows, backupFiles: backups ? backups.files : 0, liveFixes: backups ? liveFixes(home) : [] };
}

/**
 * Fixes whose backup is still the only way back: every fix entry (fix.FIX_ACTIONS) no
 * rollback entry names, plus any .bak file no manifest entry accounts for (an
 * unreadable manifest makes every backup count).
 */
function liveFixes(home) {
  const manifest = fix.readManifest(home);
  const restored = new Set(manifest.entries.filter(e => e.action === 'rollback').map(e => e.restoredFrom));
  const fixes = manifest.entries.filter(e => fix.FIX_ACTIONS.includes(e.action));
  const live = fixes.filter(e => !restored.has(e.id)).map(e => ({ id: e.id, server: e.server, original: e.original }));
  // Records may hold the resolved path (/private/tmp) while --home names a link to it (/tmp); compare real paths.
  const real = file => { try { return fs.realpathSync(file); } catch (_) { return path.resolve(file); } };
  const known = new Set(fixes.map(e => e.backup && real(e.backup)));
  let files = [];
  try { files = fs.readdirSync(path.join(boppiDir(home), 'backups')).filter(name => name.endsWith('.bak')); } catch (_) { /* no backups dir */ }
  for (const name of files) if (!known.has(real(path.join(boppiDir(home), 'backups', name)))) live.push({ id: null, server: null, original: name });
  return live;
}

/** Claude Code settings files Boppi's hook snippet may have been pasted into. */
function settingsFiles(home, cwd) {
  const candidates = [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')];
  if (path.resolve(cwd) !== path.resolve(home)) candidates.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
  return candidates;
}

/** Every hook command that runs `boppi hook`, as { file, at, command }, plus files that could not be read. */
function findHookEntries(home, cwd) {
  const found = [], unreadable = [];
  for (const file of settingsFiles(home, cwd)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    let json;
    try { json = JSON.parse(text); } catch (_) { if (/boppi/.test(text)) unreadable.push(file); continue; }
    const hooks = json && typeof json.hooks === 'object' && json.hooks ? json.hooks : {};
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      groups.forEach((group, i) => {
        (group && Array.isArray(group.hooks) ? group.hooks : []).forEach((hook, j) => {
          if (hook && typeof hook.command === 'string' && BOPPI_HOOK.test(hook.command)) found.push({ file, at: `hooks.${event}[${i}].hooks[${j}]`, command: hook.command });
        });
      });
    }
  }
  return { found, unreadable };
}

function sizeText(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }

function renderPlan(state, hooks, pairing, options) {
  const lines = ['BOPPI · UNINSTALL'];
  if (!state.exists) lines.push(`  ${state.dir} does not exist; nothing stored here to remove.`);
  else {
    lines.push(`  removes ${state.dir}:`);
    for (const row of state.rows) lines.push(`    ${row.name.padEnd(24)} ${row.what}, ${row.files} file${row.files === 1 ? '' : 's'}, ${sizeText(row.bytes)}`);
    if (!state.rows.length) lines.push('    (empty)');
  }
  const live = state.liveFixes || [];
  if (live.length && !options.includeBackups) {
    lines.push(`  stops here: ${live.length} fix${live.length === 1 ? ' is' : 'es are'} still applied, and ${live.length === 1 ? 'its backup is' : 'their backups are'} the only way back:`);
    for (const f of live) lines.push(f.id ? `    ${f.server} in ${f.original}: boppi rollback --id ${f.id}` : `    ${f.original}: a backup no fix record names; boppi rollback lists what it can restore`);
    lines.push('  Roll each back first, or pass --include-backups to keep the fixes and delete their backups.');
  } else if (live.length) {
    lines.push(`  includes the backups of ${live.length} fix${live.length === 1 ? '' : 'es'} still applied: after this, boppi rollback cannot restore ${live.length === 1 ? 'it' : 'them'}.`);
  } else if (state.backupFiles) {
    lines.push('  includes backups of fixes already rolled back; nothing is left to restore from them.');
  }
  if (pairing) lines.push(`  pairing: deletes the device credential for ${pairing.url} without contacting it. Run boppi connect unpair first to revoke "${pairing.deviceName || pairing.deviceId}" in the workspace too; otherwise it stays listed until revoked on the Collectors page.`);
  if (options.historyFile && path.resolve(options.historyFile) !== path.join(state.dir, 'history.json')) lines.push(`  not touched: --history-file ${options.historyFile} (outside ${state.dir}); delete it yourself if you want it gone.`);
  if (hooks.found.length) {
    lines.push('  Claude Code still runs `boppi hook` from these settings (Boppi does not edit them). Remove each entry, or the next MCP call recreates the events file:');
    for (const hook of hooks.found) lines.push(`    ${hook.file}  ${hook.at}  "${hook.command}"`);
  } else lines.push('  Claude Code settings: no `boppi hook` entry found in the user or project settings files.');
  for (const file of hooks.unreadable) lines.push(`  could not parse ${file}; it mentions boppi, so check its hooks by hand.`);
  lines.push('  The program itself: npm uninstall -g boppi (or delete the folder you unpacked it into).');
  return lines.join('\n');
}

/** Exit code: 0 removed or nothing to remove, 2 not removed (no confirmation, backups kept, refused). */
async function runUninstall(options, { confirm = fix.confirm } = {}) {
  const state = inventory(options.home);
  if (state.refused) { process.stderr.write(`uninstall: ${state.refused}\n`); return 2; }
  const hooks = findHookEntries(options.home, options.cwd);
  const pairing = connect.loadPairing(options.home);
  process.stdout.write(renderPlan(state, hooks, pairing, options) + '\n');
  if (!state.exists) return 0;
  if (options.dryRun) { process.stdout.write('Dry run: nothing removed.\n'); return 0; }
  if ((state.liveFixes || []).length && !options.includeBackups) { process.stderr.write('uninstall: not removed. Roll back the fixes listed above, or pass --include-backups to keep them and delete their backups.\n'); return 2; }
  if (!options.yes) {
    if (!process.stdin.isTTY) { process.stderr.write('uninstall: not removed. Pass --yes to remove without a terminal confirmation.\n'); return 2; }
    if (!(await confirm(`Delete ${state.dir}? [y/N] `))) { process.stdout.write('Not removed.\n'); return 2; }
  }
  fs.rmSync(state.dir, { recursive: true, force: true });
  if (fs.existsSync(state.dir)) { process.stderr.write(`uninstall: ${state.dir} is still there; check its permissions.\n`); return 3; }
  process.stdout.write(`Removed ${state.dir}.${hooks.found.length ? ` Remove the ${hooks.found.length} hook entr${hooks.found.length === 1 ? 'y' : 'ies'} listed above.` : ''}\n`);
  return 0;
}

module.exports = { BOPPI_HOOK, inventory, liveFixes, settingsFiles, findHookEntries, renderPlan, runUninstall };
