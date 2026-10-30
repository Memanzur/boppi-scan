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

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-platform-')));
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const server = { command: 'node', args: ['server.js'] };

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
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
