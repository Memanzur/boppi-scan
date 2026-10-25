#!/usr/bin/env node
'use strict';
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  process.stderr.write(`boppi needs Node 18 or newer; this is Node ${process.versions.node}. Install a current Node from https://nodejs.org and run boppi again.\n`);
  process.exit(3);
}
const cli = require('../src/cli/boppi');
cli.run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`boppi: unexpected error: ${error && error.message ? error.message : error}\n`);
  process.exitCode = 3;
});
