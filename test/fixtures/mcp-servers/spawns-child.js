#!/usr/bin/env node
/** A server that starts a long-lived grandchild and writes its pid to $TMPDIR/boppi-grandchild.pid, to prove shutdown reaches the whole process group. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { serve, initializeResult, tool } = require('./_server');
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
fs.writeFileSync(path.join(process.env.TMPDIR || '/tmp', 'boppi-grandchild.pid'), String(child.pid));
serve({ handlers: {
  initialize: () => initializeResult({ name: 'spawner' }),
  'notifications/initialized': () => undefined,
  'tools/list': () => ({ tools: [tool('noop')] }),
}, onClose: () => { setTimeout(() => process.exit(0), 50); } });
