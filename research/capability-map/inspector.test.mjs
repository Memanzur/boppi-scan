#!/usr/bin/env node
// Hand-written fixture per signal. Each case is a small package tree; the inspector must claim
// exactly the listed categories at the listed strength.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPackage, SIGNALS, CATEGORIES } from './inspector.mjs';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } };

const CASES = [
  { name: 'child_process call', files: { 'index.js': "const { execSync } = require('child_process');\nexecSync('ls');" }, expect: { run_shell_commands: 'call' } },
  { name: 'child_process bare import claims nothing', files: { 'index.js': "const cp = require('node:child_process');\nmodule.exports = cp;" }, expect: {} },
  { name: 'ts-compiled child_process call form', files: { 'dist/index.js': "const child_process_1 = require(\"child_process\");\n(0, child_process_1.spawn)('ls', []);" }, expect: { run_shell_commands: 'call' } },
  { name: 'execa import suffices', files: { 'index.mjs': "import { execa } from 'execa';" }, expect: { run_shell_commands: 'import' } },
  { name: 'fs read call', files: { 'index.js': "import fs from 'node:fs/promises';\nawait fs.readFile(p);" }, expect: { read_files: 'call' } },
  { name: 'fs existsSync only claims nothing', files: { 'index.js': "const fs = require('fs');\nif (fs.existsSync(p)) {}" }, expect: {} },
  { name: 'fs write and delete', files: { 'index.js': "const fs = require('fs');\nfs.writeFileSync(p, d);\nfs.rmSync(p);" }, expect: { write_files: 'call', delete_files: 'call' } },
  { name: 'fs-extra outputFile', files: { 'index.js': "import fse from 'fs-extra';\nawait fse.outputFile(p, d);" }, expect: { write_files: 'call' } },
  { name: 'glob import', files: { 'index.js': "import fg from 'fast-glob';" }, expect: { read_files: 'import' } },
  { name: 'rimraf import', files: { 'index.js': "import { rimraf } from 'rimraf';" }, expect: { delete_files: 'import' } },
  { name: 'https request call', files: { 'index.js': "const https = require('https');\nhttps.request(url, cb);" }, expect: { call_external_api: 'call' } },
  { name: 'http createServer only claims nothing', files: { 'index.js': "const http = require('http');\nhttp.createServer(h).listen(3000);" }, expect: {} },
  { name: 'axios import', files: { 'index.ts': "import axios from 'axios';" }, expect: { call_external_api: 'import' } },
  { name: 'global fetch', files: { 'index.ts': "const r = await fetch('https://x');" }, expect: { call_external_api: 'call' } },
  { name: 'method named fetch is not global fetch', files: { 'index.ts': "const r = await client.fetch(q);\nthis.fetch(q);" }, expect: {} },
  { name: 'puppeteer import', files: { 'index.js': "import puppeteer from 'puppeteer';" }, expect: { browser_automation: 'import' } },
  { name: 'vm runInNewContext', files: { 'index.js': "const vm = require('vm');\nvm.runInNewContext(code, {});" }, expect: { execute_code: 'call' } },
  { name: 'vm bare import claims nothing', files: { 'index.js': "const vm = require('vm');" }, expect: {} },
  { name: 'eval global', files: { 'index.js': "const v = eval(input);" }, expect: { execute_code: 'call' } },
  { name: 'new Function', files: { 'index.js': "const f = new Function('a', body);" }, expect: { execute_code: 'call' } },
  { name: 'worker_threads with eval true', files: { 'index.js': "const { Worker } = require('worker_threads');\nnew Worker(code, { eval: true });" }, expect: { execute_code: 'call' } },
  { name: 'worker_threads file worker claims nothing', files: { 'index.js': "const { Worker } = require('worker_threads');\nnew Worker('./w.js');" }, expect: {} },
  { name: 'keytar import', files: { 'index.js': "const keytar = require('keytar');" }, expect: { access_credentials: 'import' } },
  { name: 'secrets manager import', files: { 'index.js': "import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';" }, expect: { access_credentials: 'import' } },
  { name: 'nodemailer import', files: { 'index.js': "import nodemailer from 'nodemailer';" }, expect: { send_email: 'import' } },
  { name: 'octokit import', files: { 'index.js': "import { Octokit } from '@octokit/rest';" }, expect: { call_external_api: 'import' } },
  { name: 'slack sdk is api and message', files: { 'index.js': "import { WebClient } from '@slack/web-api';" }, expect: { call_external_api: 'import', send_external_message: 'import' } },
  { name: 'process.env secret name', files: { 'index.js': "const key = process.env.GITHUB_TOKEN;" }, expect: { access_environment_variables: 'call' } },
  { name: 'process.env bracket secret name', files: { 'index.js': "const key = process.env['API_KEY'];" }, expect: { access_environment_variables: 'call' } },
  { name: 'process.env PORT claims nothing', files: { 'index.js': "const port = process.env.PORT;" }, expect: {} },
  { name: 'node_modules and d.ts and tests are skipped', files: {
      'node_modules/x/index.js': "require('child_process').execSync('x');",
      'types.d.ts': "import 'puppeteer';",
      'test/a.test.js': "eval('1');",
      '__tests__/b.js': "require('keytar');",
      'src/index.js': "export const a = 1;",
    }, expect: {}, skipped: 4 },
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-inspector-'));
for (const c of CASES) {
  const dir = path.join(root, c.name.replace(/[^a-z0-9]+/gi, '-'));
  for (const [rel, text] of Object.entries(c.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const result = inspectPackage(dir);
  const got = Object.fromEntries(Object.entries(result.categories).map(([k, v]) => [k, v.strength]));
  const same = JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(c.expect).sort());
  ok(c.name, same && (c.skipped === undefined || result.skipped.length === c.skipped));
  if (!same) console.log('    expected', c.expect, 'got', got);
  for (const cat of Object.values(result.categories)) {
    for (const e of cat.evidence) ok(`${c.name}: evidence has file, line, text`, typeof e.file === 'string' && Number.isInteger(e.line) && e.line > 0 && typeof e.text === 'string' && e.text.length > 0);
  }
}

const TAXONOMY = ['read_files','write_files','delete_files','read_email','send_email','read_calendar','modify_calendar','read_source_code','modify_source_code','access_customer_data','access_financial_data','access_health_data','access_hr_data','execute_code','run_shell_commands','browse_internet','call_external_api','send_external_message','create_or_modify_records','make_purchase','access_credentials','access_environment_variables','browser_automation','access_production_system','untrusted_external_content','unknown'];
ok('every signal maps to one of the 26 categories', SIGNALS.every(s => TAXONOMY.includes(s.category)) && CATEGORIES.every(c => TAXONOMY.includes(c)));
ok('deterministic: inspecting the same tree twice gives identical output', (() => {
  const dir = path.join(root, 'child-process-call');
  return JSON.stringify(inspectPackage(dir)) === JSON.stringify(inspectPackage(dir));
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
