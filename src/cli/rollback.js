/**
 * boppi rollback: list the backups every fix recorded, or restore one to the
 * file it came from, prove the bytes match, record the restore, and rescan.
 */
'use strict';
const fs = require('fs');
const fix = require('./fix');

function renderList(manifest) {
  const fixes = manifest.entries.filter(e => e.action === 'remove_server').slice().reverse();
  if (!fixes.length) return 'No backups recorded. boppi fix writes one entry per applied removal.';
  const restored = new Set(manifest.entries.filter(e => e.action === 'rollback').map(e => e.restoredFrom));
  const lines = ['BOPPI · BACKUPS  newest first', ''];
  for (const entry of fixes) {
    lines.push(`  ${entry.id}  ${entry.createdAt}  remove ${JSON.stringify(entry.server)} from ${entry.clientKey}${restored.has(entry.id) ? '  (rolled back)' : ''}`);
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
  const entry = manifest.entries.find(e => e.id === options.id && e.action === 'remove_server');
  if (!entry) { process.stderr.write(`rollback: no fix with id ${JSON.stringify(options.id)} in ${fix.manifestPath(options.home)}; boppi rollback lists them.\n`); return 2; }
  if (!fs.existsSync(entry.backup)) { process.stderr.write(`rollback: backup ${entry.backup} is missing.\n`); return 2; }
  const backupBytes = fs.readFileSync(entry.backup);
  const same = fs.existsSync(entry.original) && fix.fileHash(entry.original) === fix.sha256(backupBytes);

  process.stdout.write(`BOPPI · ROLLBACK  ${entry.id}  restore ${JSON.stringify(entry.server)} to ${entry.clientKey}\n`);
  process.stdout.write(`  from:    ${entry.backup}\n`);
  process.stdout.write(`  to:      ${entry.original}${same ? ' (already identical to the backup)' : ''}\n`);
  if (!options.yes) {
    if (!process.stdin.isTTY) { process.stderr.write('rollback: not applied. Pass --yes to restore without a terminal confirmation.\n'); return 2; }
    if (!await fix.confirm('Restore this file? [y/N] ')) { process.stdout.write('Not restored.\n'); return 2; }
  }

  fs.copyFileSync(entry.backup, entry.original);
  if (fix.fileHash(entry.original) !== fix.sha256(backupBytes)) { process.stderr.write(`rollback: ${entry.original} does not match the backup after the copy.\n`); return 3; }
  const record = fix.appendManifestEntry(options.home, { createdAt: new Date().toISOString(), action: 'rollback', restoredFrom: entry.id, backup: entry.backup, original: entry.original, clientKey: entry.clientKey, server: entry.server });
  process.stdout.write(`Restored. ${entry.original} matches the backup byte for byte; manifest ${record.id}.\n\n`);

  const scan = await rescan(options);
  if (scan.failed) { process.stderr.write(`Rescan failed: ${scan.failed}. The restore stays applied.\n`); return scan.exitCode || 3; }
  recordScan(scan);
  process.stdout.write(`Rescan: ${summaryLine({ inventory: scan.inventory, paths: scan.paths })}\n`);
  return 0;
}

module.exports = { runRollback, renderList };
