#!/usr/bin/env node
/**
 * AG-19: rules that differ on Windows and Linux, checked on any host. Each
 * function under test takes the platform as an argument, so the Windows
 * rules run here; a real device still has to confirm the client behavior.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('../src/cli/platform');
const fix = require('../src/cli/fix');
const cursor = require('../src/cli/discovery/cursor');
const builtinTools = require('../src/cli/builtinTools');
const claudeCode = require('../src/cli/discovery/claudeCode');
const remediate = require('../src/cli/remediate');
const { scopeOf } = require('../src/cli/toolCategories');
const narrowScope = require('../src/cli/narrowScope');
const { WINDOWS, skip, symlinkOrSkip } = require('./helpers/platform');
const connect = require('../src/cli/connect');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const session = require('../src/cli/discovery/session');
const discover = require('../src/cli/discovery/discover');
const claudeDesktop = require('../src/cli/discovery/claudeDesktop');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-platform-')));
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const server = { command: 'node', args: ['server.js'] };

(async () => {
try {
  section('Config text: a UTF-8 byte order mark is read, UTF-16 is named');
  {
    const home = path.join(root, 'bom-home');
    const text = JSON.stringify({ mcpServers: { bom: server } });
    write(path.join(home, '.cursor', 'mcp.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]));
    const read = fix.readClient(cursor.locate({ home, cwd: home }), home);
    const user = read.files.find(f => f.scope === 'user');
    ok('a Cursor config saved with a UTF-8 BOM is found with its server', user.status === 'found' && read.servers.some(s => s.name === 'bom'), JSON.stringify(user));
    write(path.join(home, '.cursor', 'mcp.json'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    const wide = fix.readClient(cursor.locate({ home, cwd: home }), home).files.find(f => f.scope === 'user');
    ok('a UTF-16 config is unreadable with a reason that names the encoding', wide.status === 'unreadable' && /UTF-16/.test(wide.reason), JSON.stringify(wide));
    write(path.join(home, '.cursor', 'mcp.json'), '{ not json');
    ok('invalid JSON is still reported as invalid JSON', fix.readClient(cursor.locate({ home, cwd: home }), home).files.find(f => f.scope === 'user').reason === 'invalid JSON');
    const settings = path.join(home, '.claude', 'settings.json');
    write(settings, '\ufeff' + JSON.stringify({ permissions: { allow: ['Bash'] } }));
    const perms = builtinTools.readPermissionSettings([{ path: settings, scope: 'user' }]);
    ok('Claude Code settings saved with a BOM are read', perms.entries[0].status === 'found' && perms.merged.allow.includes('Bash'), JSON.stringify(perms.entries[0]));
  }

  section('Claude Code local scope: the projects key is matched like Windows matches paths');
  {
    const home = path.join(root, 'cc-home');
    const cwd = 'C:\\Users\\me\\proj';
    const local = (projects, at = cwd) => {
      write(path.join(home, '.claude.json'), JSON.stringify({ projects }));
      return fix.readClient(claudeCode.locate({ home, cwd: at }), at);
    };
    const slash = local({ 'C:/Users/me/proj': { mcpServers: { slashkey: server } } });
    ok('a key written with forward slashes is read for a backslash cwd', slash.servers.some(s => s.name === 'slashkey'), JSON.stringify(slash.servers));
    ok('the server keeps the key the file uses, so a fix edits that entry', JSON.stringify((slash.servers.find(s => s.name === 'slashkey') || {}).keyPath) === JSON.stringify(['projects', 'C:/Users/me/proj', 'mcpServers', 'slashkey']));
    ok('a lower-case drive letter matches', local({ 'c:\\Users\\me\\proj': { mcpServers: { lower: server } } }).servers.some(s => s.name === 'lower'));
    const both = local({ 'C:/Users/me/proj': { mcpServers: { other: server } }, [cwd]: { mcpServers: { exact: server } } });
    ok('an exact key wins over another spelling', both.servers.map(s => s.name).join() === 'exact', both.servers.map(s => s.name).join());
    ok('the folder name itself still matches case-sensitively', !local({ 'C:/users/ME/proj': { mcpServers: { cased: server } } }).servers.length);
    ok('a POSIX cwd is never matched loosely', !local({ '/Users/Me/proj': { mcpServers: { posix: server } } }, '/Users/me/proj').servers.length);
    const malformed = local({ 'C:/Users/me/proj': { mcpServers: { bad: { command: 42 } } } });
    ok('the matched block is shape-checked like an exact one', malformed.files[0].status === 'unreadable', JSON.stringify(malformed.files[0]));
    write(path.join(home, '.claude.json'), JSON.stringify({ projects: { 'C:/Users/me/proj': { mcpServers: { slashkey: server } } } }));
    const located = fix.locateServer(claudeCode.locate({ home, cwd }), 'slashkey', cwd);
    const preview = remediate.previewEdit({ located, serverName: 'slashkey', cwd, recordsByName: new Map() });
    ok('the fix preview shows the matched project block instead of hiding it', preview.diff.some(line => line.includes('"slashkey"')), JSON.stringify(preview.diff));
  }

  section('Path comparison: case-insensitive on win32, exact on POSIX');
  {
    ok('C:\\Users\\Me and c:/users/me are the same path on win32', platform.samePath('C:\\Users\\Me', 'c:/users/me', 'win32'));
    ok('/Users/Me and /Users/me differ on POSIX', !platform.samePath('/Users/Me', '/Users/me', 'linux'));
    ok('isInside ignores case on win32', platform.isInside('c:\\users\\ME\\code', 'C:\\Users\\me', 'win32'));
    ok('isInside needs a separator, not a prefix', !platform.isInside('/home/u2', '/home/u', 'linux') && !platform.isInside('C:\\Users\\me2', 'C:\\Users\\me', 'win32'));
    ok('a root contains every other path and not itself', platform.isInside('C:\\x', 'C:\\', 'win32') && platform.isInside('/x', '/', 'linux') && !platform.isInside('/', '/', 'linux'));
  }

  section('Scope grades on Windows and Linux');
  {
    const winHome = 'C:\\Users\\Me';
    const grades = [
      ['the home folder in another case is the home folder', scopeOf('c:\\users\\me', winHome, 'win32'), 'home'],
      ['a dotfolder under the home folder in another case is a secrets folder', scopeOf('C:\\USERS\\ME\\.SSH', winHome, 'win32'), 'secrets'],
      ['C:\\Users, above the home folder, is system-wide', scopeOf('C:\\Users', winHome, 'win32'), 'system'],
      ['C:\\Windows is system-wide', scopeOf('C:\\Windows', winHome, 'win32'), 'system'],
      ['D:\\Program Files (x86) is system-wide', scopeOf('d:\\Program Files (x86)', winHome, 'win32'), 'system'],
      ['C:\\ProgramData is system-wide', scopeOf('C:\\ProgramData', winHome, 'win32'), 'system'],
      ['a bare drive C: is the whole drive', scopeOf('C:', winHome, 'win32'), 'system'],
      ['a folder elsewhere on the drive is not', scopeOf('C:\\data\\reports', winHome, 'win32'), 'other'],
      ['/srv on Linux is system-wide', scopeOf('/srv', '/home/u', 'linux'), 'system'],
      ['/mnt/c (a Windows drive under WSL) is system-wide', scopeOf('/mnt/c', '/home/u', 'linux'), 'system'],
      ['/root is system-wide for another user', scopeOf('/root', '/home/u', 'linux'), 'system'],
      ['/root is the home folder for root', scopeOf('/root', '/root', 'linux'), 'home'],
      ['a USB stick under /media is a folder elsewhere', scopeOf('/media/u/stick', '/home/u', 'linux'), 'other'],
      ['POSIX case still matters: /Home/U is not the home folder', scopeOf('/Home/U', '/home/u', 'linux'), 'other'],
    ];
    for (const [name, got, want] of grades) ok(name, got === want, `${got}, expected ${want}`);
  }

  section('Directory arguments written the Windows way');
  {
    const home = path.join(root, 'args-home');
    for (const dir of ['.ssh', 'notes']) fs.mkdirSync(path.join(home, dir), { recursive: true });
    const broad = args => narrowScope.broadDirectories({ command: 'node', args }, home).map(d => `${d.arg}=${d.grade}`).join(',');
    ok('a bare ~ is the whole home folder', broad(['~']) === '~=home');
    ok('~\\.ssh is a secrets folder', broad(['~\\.ssh']) === '~\\.ssh=secrets');
    ok('%USERPROFILE% and %USERPROFILE%\\.ssh are read as the home folder', broad(['%USERPROFILE%', '%USERPROFILE%\\.ssh']) === '%USERPROFILE%=home,%USERPROFILE%\\.ssh=secrets');
    ok('~\\notes is not broad', broad(['~\\notes']) === '');
    ok('~other/x is someone else\'s home and is not expanded', platform.expandHomeArg('~other/x', home) === '~other/x');
    ok('a bare drive C: expands to its root', platform.expandHomeArg('C:', home) === 'C:\\');
    fs.mkdirSync(path.join(home, 'notes-old'));
    fs.mkdirSync(path.join(home, 'notes', 'inbox'));
    ok('narrowing to a sibling that only shares a name prefix is refused', /not inside/.test(narrowScope.targetProblem({ from: '~/notes', to: path.join(home, 'notes-old'), home }) || ''));
    ok('narrowing to a folder inside is accepted', narrowScope.targetProblem({ from: '~\\notes', to: path.join(home, 'notes', 'inbox'), home }) === null);
  }

  section('Replace by rename survives a briefly locked file on Windows');
  {
    const flaky = (failures, code = 'EPERM') => {
      let calls = 0;
      return { rename: () => { calls++; if (calls <= failures) throw Object.assign(new Error(code), { code }); }, calls: () => calls };
    };
    const throws = fn => { try { fn(); return null; } catch (error) { return error; } };
    const twice = flaky(2);
    ok('win32 retries EPERM until the rename goes through', !throws(() => platform.renameRetry('a', 'b', { platform: 'win32', rename: twice.rename })) && twice.calls() === 3);
    for (const code of ['EACCES', 'EBUSY']) {
      const once = flaky(1, code);
      ok(`win32 retries ${code}`, !throws(() => platform.renameRetry('a', 'b', { platform: 'win32', rename: once.rename })) && once.calls() === 2);
    }
    const posix = flaky(1);
    ok('POSIX does not retry', throws(() => platform.renameRetry('a', 'b', { platform: 'linux', rename: posix.rename })) && posix.calls() === 1);
    const missing = flaky(1, 'ENOENT');
    ok('win32 does not retry an error a wait cannot fix', throws(() => platform.renameRetry('a', 'b', { platform: 'win32', rename: missing.rename })) && missing.calls() === 1);
    const stuck = flaky(Infinity);
    const started = Date.now();
    const gaveUp = throws(() => platform.renameRetry('a', 'b', { platform: 'win32', rename: stuck.rename }));
    ok(`win32 gives up after ${platform.RENAME_RETRY.attempts} attempts and rethrows`, gaveUp && gaveUp.code === 'EPERM' && stuck.calls() === platform.RENAME_RETRY.attempts, `${stuck.calls()} calls, ${Date.now() - started} ms`);
  }

  section('User-named output files never write through a link, even without O_NOFOLLOW');
  {
    const dir = path.join(root, 'nofollow');
    fs.mkdirSync(dir);
    const victim = path.join(dir, 'victim.txt');
    fs.writeFileSync(victim, 'keep');
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT;
    const attempt = (file, options) => { try { fs.closeSync(platform.openNoFollow(file, flags, 0o600, options)); return 'opened'; } catch (error) { return error.code; } };
    for (const [label, options] of [['with O_NOFOLLOW', {}], ['without O_NOFOLLOW, as on Windows', { nofollow: 0 }]]) {
      const link = path.join(dir, `link-${label.length}.txt`);
      if (symlinkOrSkip(victim, link, `a link is refused ${label}`)) ok(`a link is refused ${label}`, attempt(link, options) === 'ELOOP' && fs.readFileSync(victim, 'utf8') === 'keep');
    }
    ok('a directory is refused', attempt(dir, { nofollow: 0 }) === 'ENOTREG');
    ok('a new file is created', attempt(path.join(dir, 'new.txt'), { nofollow: 0 }) === 'opened' && fs.existsSync(path.join(dir, 'new.txt')));
    ok('an existing regular file is opened', attempt(victim, { nofollow: 0 }) === 'opened');
  }

  section('The connector credential: owner-only where that holds, said plainly where it does not');
  {
    ok('Windows wording never claims owner-only', !/owner-only/.test(platform.ownerOnlyNote('win32')) && /Windows/.test(platform.ownerOnlyNote('win32')));
    ok('POSIX wording says owner-only', platform.ownerOnlyNote('linux') === 'owner-only');
    const home = path.join(root, 'pair-home');
    const file = connect.pairingFile(home);
    write(file, JSON.stringify({ url: 'https://w.example', deviceId: 'dev-1', credential: 'bpd_secret_value_never_printed' }));
    fs.chmodSync(file, 0o600);
    ok('a 0600 pairing loads', connect.loadPairing(home, { platform: 'linux' }).deviceId === 'dev-1');
    if (WINDOWS) skip('a group- or world-readable pairing is refused on POSIX', 'Windows has no file modes');
    else {
      fs.chmodSync(file, 0o644);
      let refusal = null;
      try { connect.loadPairing(home, { platform: 'linux' }); } catch (error) { refusal = error.message; }
      ok('a world-readable pairing is refused with the fix to run', refusal && refusal.includes('mode 644') && refusal.includes('chmod 600') && !refusal.includes('bpd_secret'), refusal);
      ok('uninstall can still read it to delete it', connect.loadPairing(home, { platform: 'linux', allowExposed: true }).deviceId === 'dev-1');
      ok('the Windows rules do not read POSIX modes', connect.loadPairing(home, { platform: 'win32' }).deviceId === 'dev-1');
      const status = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'boppi.js'), 'connect', 'status', '--home', home], { encoding: 'utf8' });
      ok('boppi connect stops with exit 2 and says why', status.status === 2 && /other accounts on this machine can read it/.test(status.stderr), status.stderr);
    }
  }

  section('Config locations moved by XDG_CONFIG_HOME and CLAUDE_CONFIG_DIR');
  {
    const live = os.homedir(), other = path.join(root, 'other-home');
    const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    const xdg = path.join(root, 'xdg'), ccd = path.join(root, 'claude-dir');
    Object.assign(process.env, { XDG_CONFIG_HOME: xdg, CLAUDE_CONFIG_DIR: ccd });
    try {
      const desktop = home => claudeDesktop.locate({ home, platform: 'linux' }).files[0].path;
      ok('Claude Desktop on Linux reads $XDG_CONFIG_HOME/Claude for the live user', desktop(live) === path.join(xdg, 'Claude', 'claude_desktop_config.json'), desktop(live));
      ok('--home of another folder reads that folder\'s ~/.config', desktop(other) === path.join(other, '.config', 'Claude', 'claude_desktop_config.json'));
      const code = home => claudeCode.locate({ home, cwd: other });
      ok('Claude Code reads $CLAUDE_CONFIG_DIR/.claude.json for the live user', code(live).files[0].path === path.join(ccd, '.claude.json'));
      ok('and its user settings from $CLAUDE_CONFIG_DIR/settings.json', code(live).settingsFiles[0].path === path.join(ccd, 'settings.json'));
      ok('--home of another folder reads <home>/.claude.json and <home>/.claude', code(other).files[0].path === path.join(other, '.claude.json') && code(other).settingsFiles[0].path === path.join(other, '.claude', 'settings.json'));
      ok('a relative value is ignored', platform.liveEnv('X', live, { X: 'relative/dir' }) === null);
      ok('the macOS location ignores XDG', claudeDesktop.locate({ home: live, platform: 'darwin' }).files[0].path.includes(path.join('Library', 'Application Support')));
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  }

  section('Discovery: the environment a server inherits, by platform');
  {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tool.exe'), '');
    const saved = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, BOPPI_TOKEN: process.env.BOPPI_TOKEN };
    Object.assign(process.env, { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', XDG_CONFIG_HOME: '/home/u/.config', BOPPI_TOKEN: 'never' });
    try {
      const win = session.launchPlan({ command: path.join(bin, 'tool.exe') }, { cwd: root, platform: 'win32', env: { PATH: bin } });
      const linux = session.launchPlan({ command: process.execPath }, { cwd: root, platform: 'linux' });
      const mac = session.launchPlan({ command: process.execPath }, { cwd: root, platform: 'darwin' });
      ok('a Windows server keeps APPDATA', win.env && win.env.APPDATA === process.env.APPDATA, JSON.stringify(win.refused || win.inherited));
      ok('a Linux server keeps XDG_CONFIG_HOME and not APPDATA', linux.env.XDG_CONFIG_HOME === '/home/u/.config' && !('APPDATA' in linux.env));
      ok('macOS keeps the short list', !('APPDATA' in mac.env) && !('XDG_CONFIG_HOME' in mac.env) && 'PATH' in mac.env);
      ok('BOPPI_TOKEN is never inherited', [win, linux, mac].every(plan => !plan.env || !('BOPPI_TOKEN' in plan.env)));
      ok('the plan names what it inherited, for the consent text', mac.inherited.includes('PATH') && !mac.inherited.includes('BOPPI_TOKEN'));
      ok('the Windows list carries PATHEXT, COMSPEC and the system folders', ['PATHEXT', 'COMSPEC', 'SystemRoot', 'windir', 'LOCALAPPDATA', 'ProgramData'].every(name => session.INHERITED_ENV.win32.includes(name)));
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  }

  section('Discovery: a zombie has exited (Linux)');
  {
    const proc = path.join(root, 'proc');
    const stat = (pid, comm, state, pgrp) => write(path.join(proc, String(pid), 'stat'), `${pid} (${comm}) ${state} 1 ${pgrp} ${pgrp} 0 -1 4194560`);
    stat(100, 'node', 'S', 100);
    stat(101, 'odd) name (Z', 'Z', 100);
    stat(200, 'server', 'Z', 200);
    stat(201, 'child', 'Z', 200);
    ok('a group with one running member is running', session.linuxGroupRunning(100, proc));
    ok('a group whose members are all zombies has ended', !session.linuxGroupRunning(200, proc));
    ok('an unreadable /proc counts as running', session.linuxGroupRunning(200, path.join(root, 'no-proc')));
    stat(process.pid, 'self', 'Z', process.pid);
    ok('processRunning: a zombie on Linux is gone', !session.processRunning(process.pid, { platform: 'linux', procRoot: proc }));
    ok('processRunning: other platforms trust kill(pid, 0)', session.processRunning(process.pid, { platform: 'darwin', procRoot: proc }));
    stat(process.pid, 'self', 'R', process.pid);
    ok('processRunning: a running process is running', session.processRunning(process.pid, { platform: 'linux', procRoot: proc }));
  }

  section('Discovery: ending a server on Windows ends what it started, or says it may not have');
  {
    const fakeChild = ({ exitsOnStdinEnd }) => {
      const child = new EventEmitter();
      Object.assign(child, { pid: 4242, exitCode: null, signalCode: null });
      child.exit = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit('exit'); } };
      child.stdin = { end: () => { if (exitsOnStdinEnd) setImmediate(child.exit); } };
      child.kill = () => { setImmediate(child.exit); return true; };
      return child;
    };
    const timeouts = { closeMs: 20, termMs: 20, killMs: 20 };
    const host = treeResult => {
      const killed = [];
      return { killed, platform: 'win32', groupRunning: () => true, killTree: pid => { killed.push(pid); return treeResult; } };
    };
    {
      const child = fakeChild({ exitsOnStdinEnd: false }), windows = host(true);
      const pending = session.shutdown(child, timeouts, windows);
      setTimeout(() => { if (windows.killed.length) child.exit(); }, 40);
      const result = await pending;
      ok('a server that ignores stdin is ended with taskkill /T on its pid', windows.killed.join() === '4242' && result.forced === 'SIGTERM' && !result.childrenUnchecked, JSON.stringify(result));
    }
    {
      const child = fakeChild({ exitsOnStdinEnd: true }), windows = host(true);
      const result = await session.shutdown(child, timeouts, windows);
      ok('a server that exits on its own leaves its children unchecked, and the result says so', !windows.killed.length && result.forced === null && result.childrenUnchecked === true, JSON.stringify(result));
    }
    {
      const child = fakeChild({ exitsOnStdinEnd: false }), windows = host(false);
      const result = await session.shutdown(child, timeouts, windows);
      ok('when taskkill fails the server alone is killed and its children are unchecked', windows.killed.length >= 1 && result.childrenUnchecked === true, JSON.stringify(result));
    }
    const render = discover.consentText({ client: { label: 'Cursor' }, serverName: 'x', launch: { command: 'node', args: [], cwd: root, envNames: [] }, inherited: ['PATH', 'APPDATA'] });
    ok('the consent text lists the variables the process inherits', render.includes('inherits only PATH, APPDATA from your environment'));
  }

  section('Discovery lock: taken by exactly one process');
  {
    const home = path.join(root, 'lock-home');
    const release = discover.acquireLock(home, 'srv');
    const file = path.join(discover.discoveryDir(home), '.lock-srv');
    ok('the first caller takes the lock', typeof release === 'function' && fs.existsSync(file));
    release();
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: sleeper.pid }));
      ok('a lock held by another running process is respected', discover.acquireLock(home, 'srv') === null);
    } finally { sleeper.kill('SIGKILL'); }
    await new Promise(resolve => sleeper.once('exit', resolve));
    const stale = discover.acquireLock(home, 'srv');
    ok('a lock whose holder exited is taken over', typeof stale === 'function');
    stale();
    fs.writeFileSync(file, '');
    ok('an empty lock that is still being written is respected', discover.acquireLock(home, 'srv') === null);
    fs.utimesSync(file, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
    const old = discover.acquireLock(home, 'srv');
    ok('an empty lock left by a crash is taken over', typeof old === 'function');
    old();
    const startAt = Date.now() + 1500;
    const racer = `const d = require(${JSON.stringify(require.resolve('../src/cli/discovery/discover'))}); while (Date.now() < ${startAt}); const r = d.acquireLock(${JSON.stringify(home)}, 'race'); console.log(r ? 'took' : 'held'); setTimeout(() => {}, 1500);`;
    const outputs = await Promise.all(Array.from({ length: 8 }, () => new Promise(resolve => {
      const child = spawn(process.execPath, ['-e', racer], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('exit', () => resolve(out.trim()));
    })));
    ok('eight processes racing for one lock: exactly one takes it', outputs.filter(o => o === 'took').length === 1, outputs.join(','));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
