/**
 * boppi rollback: list the backups every fix recorded, or restore one to the
 * file it came from, prove the bytes match, record the restore, and rescan.
 */
'use strict';
const fs = require('fs');
const fix = require('./fix');
const { pathFingerprint } = require('../engine/localMcpScanner');

function renderList(manifest) {
  const fixes = manifest.entries.filter(e => fix.FIX_ACTIONS.includes(e.action)).slice().reverse();
  if (!fixes.length) return 'No backups recorded. boppi fix writes one entry per applied fix.';
  const restored = new Set(manifest.entries.filter(e => e.action === 'rollback').map(e => e.restoredFrom));
  const lines = ['BOPPI · BACKUPS  newest first', ''];
  for (const entry of fixes) {
    lines.push(`  ${entry.id}  ${entry.createdAt}  ${entry.action === 'narrow_scope' ? 'narrow' : 'remove'} ${JSON.stringify(entry.server)} ${entry.action === 'narrow_scope' ? 'on' : 'from'} ${entry.clientKey}${restored.has(entry.id) ? '  (rolled back)' : ''}`);
    lines.push(`    original: ${entry.original}`);
    lines.push(`    backup:   ${entry.backup}${fs.existsSync(entry.backup) ? '' : '  (missing)'}`);
  }
  lines.push('', 'Restore one with: boppi rollback --id <id> [--yes]');
  return lines.join('\n');
}

/** Exit code. rescan(options) is performScan and recordScan(scan) writes the history entry; both injected to keep this module off the entry point. */
async function runRollback(options, { rescan, recordScan, summaryLine }) {
  const manifest = fix.readManifest(options.home);
  if (!options.id) { process.stdout.write(renderList(manifest) + '\n'); return 0; }
  const entry = manifest.entries.find(e => e.id === options.id && fix.FIX_ACTIONS.includes(e.action));
  if (!entry) { process.stderr.write(`rollback: no fix with id ${JSON.stringify(options.id)} in ${fix.manifestPath(options.home)}; boppi rollback lists them.\n`); return 2; }
  if (!fs.existsSync(entry.backup)) { process.stderr.write(`rollback: backup ${entry.backup} is missing.\n`); return 2; }
  const backupBytes = fs.readFileSync(entry.backup);
  const same = fs.existsSync(entry.original) && fix.fileHash(entry.original) === fix.sha256(backupBytes);
  if (!entry.backupHash || entry.backupHash !== fix.sha256(backupBytes)) {
    process.stderr.write('rollback: backup integrity cannot be verified. Nothing was restored.\n');
    return 2;
  }
  if (!same && (!entry.appliedHash || !fs.existsSync(entry.original) || fix.fileHash(entry.original) !== entry.appliedHash)) {
    process.stderr.write('rollback: the config changed after this fix. Nothing was restored; review the backup manually to preserve newer changes.\n');
    return 2;
  }

  process.stdout.write(`BOPPI · ROLLBACK  ${entry.id}  restore ${JSON.stringify(entry.server)} to ${entry.clientKey}\n`);
  process.stdout.write(`  from:    ${entry.backup}\n`);
  process.stdout.write(`  to:      ${entry.original}${same ? ' (already identical to the backup)' : ''}\n`);
  if (!options.yes) {
    if (!process.stdin.isTTY) { process.stderr.write('rollback: not applied. Pass --yes to restore without a terminal confirmation.\n'); return 2; }
    if (!await fix.confirm('Restore this file? [y/N] ')) { process.stdout.write('Not restored.\n'); return 2; }
  }

  // The same write discipline as fix and the connector: one lock per file, no symlinks, a hash recheck at the write boundary, an atomic rename.
  const release = fix.acquireLock(options.home, pathFingerprint(entry.original));
  if (!release) { process.stderr.write(`rollback: another boppi process is editing ${entry.original}. Nothing was restored.\n`); return 2; }
  let record;
  try {
    const opened = fix.openRegular(entry.original);
    if (!opened.regularFile && opened.failureCode !== 'file_missing') { process.stderr.write(`rollback: ${entry.original} is not a regular file (${opened.failureCode}); boppi does not write through symlinks. Nothing was restored.\n`); return 2; }
    const now = opened.regularFile ? fix.sha256(opened.bytes) : null;
    if (now !== fix.sha256(backupBytes) && now !== entry.appliedHash) { process.stderr.write('rollback: the config changed after this fix. Nothing was restored; review the backup manually to preserve newer changes.\n'); return 2; }
    fix.writeAtomic(entry.original, backupBytes, opened.regularFile ? opened.mode : 0o600);
    if (fix.fileHash(entry.original) !== fix.sha256(backupBytes)) { process.stderr.write(`rollback: ${entry.original} does not match the backup after the write.\n`); return 3; }
    record = fix.appendManifestEntry(options.home, { createdAt: new Date().toISOString(), action: 'rollback', restoredFrom: entry.id, backup: entry.backup, original: entry.original, clientKey: entry.clientKey, server: entry.server });
  } finally { release(); }
  process.stdout.write(`Restored. ${entry.original} matches the backup byte for byte; manifest ${record.id}.\n\n`);

  const scan = await rescan(options);
  if (scan.failed) { process.stderr.write(`Rescan failed: ${scan.failed}. The restore stays applied.\n`); return scan.exitCode || 3; }
  recordScan(scan);
  process.stdout.write(`Rescan: ${summaryLine({ inventory: scan.inventory, paths: scan.paths })}\n`);
  return 0;
}

module.exports = { runRollback, renderList };
