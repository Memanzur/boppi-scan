#!/usr/bin/env node
/**
 * The GitHub Action runs the package version it was released with (D-5):
 * its default `version` equals package.json, a range or tag is refused, and
 * inputs reach the shell only as environment variables. The step's real
 * `run:` script is executed under bash with a stand-in `npx` that records
 * its arguments, so nothing is fetched.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`); } }

const repo = path.join(__dirname, '..');
const action = fs.readFileSync(path.join(repo, 'action.yml'), 'utf8').split('\n');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));

/** The indented block under the line matching `header`, dedented. */
function block(header) {
  const start = action.findIndex(line => header.test(line));
  if (start < 0) return null;
  const indent = action[start].match(/^ */)[0].length;
  const lines = [];
  for (const line of action.slice(start + 1)) {
    if (line.trim() && line.match(/^ */)[0].length <= indent) break;
    lines.push(line);
  }
  const inner = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return lines.map(l => l.slice(inner)).join('\n').replace(/\s+$/, '') + '\n';
}

console.log('── The default version is the package version ──');
const versionInput = block(/^  version:$/) || '';
const defaultVersion = (versionInput.match(/^default:\s*(\S+)\s*$/m) || [])[1];
ok('action.yml default version equals package.json version', defaultVersion === pkg.version, `${defaultVersion} vs ${pkg.version}`);

console.log('── Inputs never appear as expressions inside the script ──');
const script = block(/^      run: \|$/);
const envBlock = block(/^      env:$/) || '';
ok('the run step was found', !!script);
ok('the script holds no ${{ }} expression', script && !script.includes('${{'));
const env = {};
for (const line of envBlock.split('\n')) {
  const m = line.match(/^(BOPPI_[A-Z_]+): \$\{\{ inputs(?:\.([a-z-]+)|\['([a-z-]+)'\]) \}\}$/);
  if (m) env[m[1]] = m[2] || m[3];
}
ok('every input is passed through env', ['config', 'source', 'fail-on', 'policy', 'sarif', 'version'].every(i => Object.values(env).includes(i)), JSON.stringify(env));

const defaults = {};
let current = null;
for (const line of action) {
  const name = line.match(/^  ([a-z-]+):$/);
  if (name) current = name[1];
  const value = line.match(/^    default: ?(.*)$/);
  if (current && value) defaults[current] = value[1] === "''" ? '' : value[1];
  if (/^outputs:/.test(line)) break;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-action-'));
const bin = path.join(root, 'bin');
fs.mkdirSync(bin);
const record = path.join(root, 'npx-args');
fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/bash\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`, { mode: 0o755 });
fs.writeFileSync(path.join(root, 'step.sh'), script || 'exit 99\n');

function runStep(inputs) {
  try { fs.unlinkSync(record); } catch { /* none yet */ }
  const values = { ...defaults, ...inputs };
  const stepEnv = { PATH: `${bin}:/usr/bin:/bin` };
  for (const [variable, input] of Object.entries(env)) stepEnv[variable] = values[input];
  const result = spawnSync('bash', [path.join(root, 'step.sh')], { cwd: root, env: stepEnv, encoding: 'utf8' });
  const args = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').slice(0, -1) : null;
  return { status: result.status, stderr: result.stderr, args };
}

console.log('── The step runs exactly the pinned version ──');
const plain = runStep({});
ok('with defaults, npx runs boppi@<package version>', plain.status === 0 && plain.args && plain.args[1] === `boppi@${pkg.version}`, JSON.stringify(plain));
ok('the default arguments are passed as separate words', plain.args && plain.args.slice(2).join(' ') === 'scan --no-color --sarif boppi.sarif --json boppi-scan.json --config .mcp.json --source claude-code --fail-on high');
ok('an explicit exact version is used as given', runStep({ version: '0.3.1' }).args?.[1] === 'boppi@0.3.1');
ok('a prerelease version is accepted', runStep({ version: '0.5.0-rc.1' }).args?.[1] === 'boppi@0.5.0-rc.1');
for (const bad of ['latest', '^0.4.0', '0.4', '0.4.x', '', '0.4.0; touch pwned']) {
  const result = runStep({ version: bad });
  ok(`version ${JSON.stringify(bad)} is refused before npx runs`, result.status === 2 && result.args === null && /exact version/.test(result.stderr), JSON.stringify(result));
}

console.log('── An input value stays a value ──');
const marker = path.join(root, 'injected');
const hostile = runStep({ config: `$(touch ${marker})`, policy: `"; touch ${marker}; "` });
ok('a command substitution in an input is passed literally', hostile.args && hostile.args.includes(`$(touch ${marker})`));
ok('no input value ran as a command', !fs.existsSync(marker));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
