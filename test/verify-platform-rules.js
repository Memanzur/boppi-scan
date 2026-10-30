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
    write(settings, '﻿' + JSON.stringify({ permissions: { allow: ['Bash'] } }));
    const perms = builtinTools.readPermissionSettings([{ path: settings, scope: 'user' }]);
    ok('Claude Code settings saved with a BOM are read', perms.entries[0].status === 'found' && perms.merged.allow.includes('Bash'), JSON.stringify(perms.entries[0]));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
