#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cli = require('../src/cli/boppi');
const demo = require('../src/cli/demo');
const html = require('../src/cli/render/html');

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-design-synthetic-'));
  const bundle = await demo.buildBundle({ home, cwd:home, platform:'darwin' }, { performScan:cli.performScan, version:cli.VERSION });
  const page = html.renderDemoHtml(bundle);
  const port = Number(process.env.BOPPI_DESIGN_PORT || 3187);
  const server = http.createServer((req,res) => {
    if (req.method !== 'GET' || !['/','/demo'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end(page);
  });
  server.listen(port,'127.0.0.1',() => console.log(`Synthetic design preview: http://127.0.0.1:${port}\nNo personal configuration is read; no fixes or upload endpoints exist.`));
})().catch(error => { console.error(error.message); process.exitCode=1; });
