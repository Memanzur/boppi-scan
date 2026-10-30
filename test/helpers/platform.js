/**
 * Test helpers for behavior that differs by platform. Windows has no POSIX
 * file modes, needs Developer Mode or elevation to create symlinks, and has
 * no /bin/sh, so suites ask these helpers instead of asserting POSIX facts.
 * A skipped check prints why, so a green Windows run never hides one.
 */
'use strict';
const fs = require('fs');

const WINDOWS = process.platform === 'win32';

/** The file's permission bits equal `mode`. Always true on Windows, which has ACLs instead of modes. */
function hasMode(file, mode) {
  return WINDOWS || (fs.statSync(file).mode & 0o777) === mode;
}

/** The file is mode 0600 on POSIX. Windows ACLs are checked on a real device (icacls), not here. */
const ownerOnly = file => hasMode(file, 0o600);

/** Print why a check did not run on this platform. */
function skip(name, reason) {
  console.log(`  - skipped on ${process.platform}: ${name} (${reason})`);
}

/**
 * fs.symlinkSync, or false with a printed reason when the OS refuses to make
 * links (EPERM on Windows without Developer Mode). Any other error throws.
 */
function symlinkOrSkip(target, link, name, type) {
  try {
    // BOPPI_TEST_NO_SYMLINKS rehearses that refusal on any platform.
    if (process.env.BOPPI_TEST_NO_SYMLINKS) throw Object.assign(new Error('symlinks disabled'), { code: 'EPERM' });
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    skip(name, 'this account cannot create symbolic links; enable Developer Mode to run it');
    return false;
  }
}

module.exports = { WINDOWS, hasMode, ownerOnly, skip, symlinkOrSkip };
