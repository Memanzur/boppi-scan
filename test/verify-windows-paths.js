#!/usr/bin/env node
/**
 * Windows path rules that can be proved on any OS (D-4): program lookup with
 * PATHEXT and ';', a clear refusal for .cmd/.bat launchers, and Claude
 * Desktop's APPDATA honoring --home. Real Windows behavior still needs a
 * Windows machine; the windows-latest CI job runs this file there.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const session = require('../src/cli/discovery/session');
const claudeDesktop = require('../src/cli/discovery/claudeDesktop');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
const touch = (file, mode = 0o644) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); fs.chmodSync(file, mode); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-win-'));
const binA = path.join(root, 'a'), binB = path.join(root, 'b');
touch(path.join(binA, 'node.EXE'));          // not executable by mode: Windows has no X bit
touch(path.join(binB, 'mytool.cmd'));
touch(path.join(binB, 'python.exe'));
const winEnv = { PATH: [binA, binB].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' };

console.log('── Program lookup on win32 ──');
const node = session.resolveProgram('node', root, { platform: 'win32', env: winEnv });
ok('a bare name resolves through PATHEXT, case-insensitively, without an execute bit', node === path.join(binA, 'node.EXE'), String(node));
ok('PATH is split on ";" on win32', session.resolveProgram('python', root, { platform: 'win32', env: winEnv }) === path.join(binB, 'python.exe'));
ok('a name that already has an extension is used as is', session.resolveProgram('python.exe', root, { platform: 'win32', env: winEnv }) === path.join(binB, 'python.exe'));
ok('a missing program is still not found', session.resolveProgram('ruby', root, { platform: 'win32', env: winEnv }) === null);
ok('PATHEXT defaults to the Windows set when unset', session.resolveProgram('node', root, { platform: 'win32', env: { PATH: binA } }) === path.join(binA, 'node.EXE'));
ok('on darwin the same file without an execute bit is not a program', session.resolveProgram('node.EXE', root, { platform: 'darwin', env: { PATH: binA } }) === null);

console.log('── Launchers that need a shell are refused clearly ──');
const cmd = session.launchPlan({ command: 'mytool' }, { cwd: root, platform: 'win32', env: winEnv });
ok('a .cmd launcher is refused with what to do instead, not reported as missing', cmd.refused && /\.cmd or \.bat/.test(cmd.refused) && /needs a shell/.test(cmd.refused), cmd.refused);
const npx = session.launchPlan({ command: 'npx.cmd', args: ['-y', 'x'] }, { cwd: root, platform: 'win32', env: winEnv });
ok('npx.cmd is still refused as a package launcher first', npx.refused && /fetches a package/.test(npx.refused));
ok('npx.bat is refused as a package launcher too', /fetches a package/.test(session.launchPlan({ command: 'npx.bat' }, { cwd: root, platform: 'win32', env: winEnv }).refused || ''));
const exe = session.launchPlan({ command: 'node', args: ['server.js'] }, { cwd: root, platform: 'win32', env: winEnv });
ok('an .exe program gets a launch plan', !exe.refused && exe.program === path.join(binA, 'node.EXE'), exe.refused);

console.log('── Claude Desktop on win32 honors --home ──');
const scanned = path.join(root, 'copied-home');
const saved = process.env.APPDATA;
process.env.APPDATA = path.join(root, 'live-machine', 'AppData', 'Roaming');
try {
  const copied = claudeDesktop.locate({ home: scanned, platform: 'win32' }).files[0].path;
  ok('a scanned home other than the real one reads its own AppData, not the live APPDATA', copied === path.join(scanned, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), copied);
  const real = claudeDesktop.locate({ home: os.homedir(), platform: 'win32' }).files[0].path;
  ok('the real home still uses APPDATA', real === path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json'), real);
} finally {
  if (saved === undefined) delete process.env.APPDATA; else process.env.APPDATA = saved;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
