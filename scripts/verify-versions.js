#!/usr/bin/env node
/** Phase 2 acceptance: package, engine, rubric, changelog, candidate document, and the built candidate manifest must name the same versions. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const ENGINE_VERSION = require(path.join(ROOT, 'src/engine/models.js')).ENGINE_VERSION;
const RUBRIC_VERSION = require(path.join(ROOT, 'src/engine/riskRubric.js')).RUBRIC_VERSION;
const problems = [];
const check = (condition, text) => { if (!condition) problems.push(text); };

const changelogTop = (fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## (\S+)/m) || [])[1];
check(changelogTop === pkg.version, `CHANGELOG.md top entry is ${changelogTop}, package.json is ${pkg.version}`);
check(fs.existsSync(path.join(ROOT, 'docs/release', `CANDIDATE-${pkg.version}.md`)), `docs/release/CANDIDATE-${pkg.version}.md is missing`);
check(fs.existsSync(path.join(ROOT, 'docs/milestone1', `RISK_RUBRIC_v${RUBRIC_VERSION}.md`)), `docs/milestone1/RISK_RUBRIC_v${RUBRIC_VERSION}.md is missing`);
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
check(readme.includes(`RISK_RUBRIC_v${RUBRIC_VERSION}.md`), `README.md does not point at RISK_RUBRIC_v${RUBRIC_VERSION}.md`);
const candidateArg = process.argv.indexOf('--candidate');
const candidateDir = candidateArg > -1 ? path.resolve(process.argv[candidateArg + 1]) : path.join(os.homedir(), 'Desktop', `Boppi-candidate-${pkg.version}`);
const manifestPath = path.join(candidateDir, 'CANDIDATE.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(manifest.package_version === pkg.version, `candidate package_version ${manifest.package_version} differs from ${pkg.version}`);
  check(manifest.engine_version === ENGINE_VERSION, `candidate engine_version ${manifest.engine_version} differs from ${ENGINE_VERSION}`);
  check(manifest.rubric_version === RUBRIC_VERSION, `candidate rubric_version ${manifest.rubric_version} differs from ${RUBRIC_VERSION}`);
  check(manifest.published === false, 'candidate manifest claims it was published');
  const tarball = path.join(candidateDir, manifest.artifact || '');
  check(fs.existsSync(tarball), `candidate tarball ${manifest.artifact} is missing`);
  if (fs.existsSync(tarball)) {
    const digest = require('crypto').createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
    check(digest === manifest.sha256, 'candidate tarball sha256 differs from CANDIDATE.json');
  }
  console.log(`candidate ${candidateDir}: package ${manifest.package_version}, engine ${manifest.engine_version}, rubric ${manifest.rubric_version}, scanner ${String(manifest.scanner_commit).slice(0, 7)}`);
} else {
  console.log(`no candidate manifest at ${manifestPath}; source versions checked only`);
}
for (const p of problems) console.error(`✗ ${p}`);
if (!problems.length) console.log(`versions agree: package ${pkg.version}, engine ${ENGINE_VERSION}, rubric ${RUBRIC_VERSION}, changelog ${changelogTop}`);
process.exit(problems.length ? 1 : 0);
