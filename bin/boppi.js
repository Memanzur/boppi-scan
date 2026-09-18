#!/usr/bin/env node
'use strict';
const cli = require('../src/cli/boppi');
cli.run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`boppi: unexpected error: ${error && error.message ? error.message : error}\n`);
  process.exitCode = 3;
});
