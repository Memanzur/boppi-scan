#!/usr/bin/env node
/**
 * Build the signed Agent release for the current commit.
 *
 *   node scripts/release/build.mjs --key <private key> [--out <dir>] [--base-url https://...]
 *                                  [--replace] [--check-reproducible] [--allow-dirty]
 *
 * Output: <out>/<version>/ (default dist/release/<version>/, gitignored) with
 * the npm tarball, standalone executables for darwin-arm64, darwin-x64,
 * linux-x64 and win-x64 (Node single executable applications on the pinned
 * official Node runtime), install.sh with the release key stamped in,
 * boppi-release.pub, SHA256SUMS, SHA256SUMS.sig and release.json (sign.mjs).
 *
 * Inputs are pinned: the source is `git archive` of HEAD (a dirty tree is
 * refused; --allow-dirty copies the working tree, is recorded as
 * "dirty": true in release.json and is for development only), Node runtime
 * archives must match scripts/release/node-runtimes.json byte for byte
 * (downloaded into the cache only when missing), SOURCE_DATE_EPOCH is the
 * commit time. --check-reproducible builds a second time into a temporary
 * folder and compares every file. Publishes nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as layout from './layout.mjs';
import * as sshsig from './sshsig.mjs';
import { signRelease } from './sign.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RUNTIMES = JSON.parse(fs.readFileSync(path.join(HERE, 'node-runtimes.json'), 'utf8'));
const DEFAULT_CACHE = path.join(os.homedir(), '.cache', 'boppi-release', 'node-runtimes');

function log(line) { process.stderr.write(`${line}\n`); }

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status}): ${(result.stderr || result.error || '').toString().trim().split('\n').slice(-3).join(' | ')}`);
  return result.stdout;
}

function gitState() {
  const commit = run('git', ['-C', ROOT, 'rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=all']).trim() !== '';
  const epoch = Number(run('git', ['-C', ROOT, 'log', '-1', '--format=%ct', 'HEAD']).trim());
  return { commit, dirty, epoch };
}

/** The pinned runtime archive in the cache, downloaded when missing; refuses any byte difference from node-runtimes.json. */
async function runtimeArchive(target, cache) {
  const pin = RUNTIMES.targets[target];
  const file = path.join(cache, pin.archive);
  if (!fs.existsSync(file)) {
    const url = new URL(pin.archive, RUNTIMES.baseUrl).toString();
    log(`  downloading ${url}`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`download of ${url} failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (layout.sha256(bytes) !== pin.sha256) throw new Error(`refusing ${url}: sha256 ${layout.sha256(bytes)} is not the pinned ${pin.sha256}`);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(`${file}.${process.pid}.tmp`, bytes);
    fs.renameSync(`${file}.${process.pid}.tmp`, file);
  }
  const actual = layout.sha256File(file);
  if (actual !== pin.sha256) throw new Error(`refusing ${file}: sha256 ${actual} is not the pinned ${pin.sha256} (delete it to download again)`);
  return file;
}

/** Extract only the node binary from a verified archive into dir; returns its path. */
function extractRuntime(target, archive, dir) {
  const pin = RUNTIMES.targets[target];
  fs.mkdirSync(dir, { recursive: true });
  if (archive.endsWith('.zip') && process.platform === 'linux') run('unzip', ['-q', archive, pin.binary, '-d', dir]);
  else run('tar', ['-xf', archive, '-C', dir, pin.binary]);
  const binary = path.join(dir, ...pin.binary.split('/'));
  if (!fs.existsSync(binary)) throw new Error(`${pin.binary} not found in ${archive}`);
  return binary;
}

function hostTarget() {
  const key = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-x64'].includes(key)) throw new Error(`building the executables needs a darwin-arm64, darwin-x64 or linux-x64 host, not ${key}`);
  return key;
}

/** Source for the build: the committed tree, or (allowDirty) the working tree's package files and release scripts. */
function stageSource(work, { dirty, allowDirty }) {
  const stage = path.join(work, 'source');
  fs.mkdirSync(stage, { recursive: true });
  if (!dirty) {
    const tar = path.join(work, 'source.tar');
    run('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, 'HEAD']);
    run('tar', ['-xf', tar, '-C', stage]);
    return stage;
  }
  if (!allowDirty) throw new Error('the working tree has uncommitted changes; commit them (a release names one commit) or pass --allow-dirty for a development build');
  for (const entry of ['bin', 'src', 'package.json', 'README.md', 'LICENSE', 'scripts/release']) fs.cpSync(path.join(ROOT, entry), path.join(stage, entry), { recursive: true });
  return stage;
}

function npmPack(stage, packDir, epoch) {
  fs.mkdirSync(packDir, { recursive: true });
  const out = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], { cwd: stage, env: { ...process.env, SOURCE_DATE_EPOCH: String(epoch) }, shell: process.platform === 'win32' });
  const [packed] = JSON.parse(out);
  const files = packed.files.map(f => f.path).sort();
  const bad = layout.disallowedPackFiles(files);
  if (bad.length) throw new Error(`npm pack would ship files outside bin/, src/, README.md, LICENSE, package.json: ${bad.join(', ')}`);
  return { tarball: path.join(packDir, packed.filename), files };
}

function buildExecutable({ builder, runtime, stage, assets, output, work, target }) {
  const assetMap = {};
  for (const name of assets) assetMap[name] = path.join(stage, ...name.split('/'));
  const listFile = path.join(work, `assets-${target}.json`);
  fs.writeFileSync(listFile, JSON.stringify(assets));
  assetMap['boppi-assets.json'] = listFile;
  const config = {
    // Relative to the build folder (the cwd below): Node embeds the main script's path as given, and a temp path would make every build differ.
    main: path.relative(work, path.join(stage, 'scripts', 'release', 'sea-main.js')).split(path.sep).join('/'),
    executable: runtime,
    output,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: Object.fromEntries(Object.keys(assetMap).sort().map(k => [k, assetMap[k]])),
  };
  const configFile = path.join(work, `sea-${target}.json`);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  run(builder, ['--build-sea', configFile], { cwd: work });
  if (RUNTIMES.targets[target].os === 'darwin') {
    if (process.platform !== 'darwin') throw new Error(`ad-hoc signing ${target} needs macOS codesign`);
    run('codesign', ['--sign', '-', '--force', output]);
  }
  fs.chmodSync(output, 0o755);
}

/** One full build into <outRoot>/<version>. Returns the release directory. */
export async function build({ keyFile, outRoot, baseUrl = '', allowDirty = false, replace = false, cache = DEFAULT_CACHE }) {
  const git = gitState();
  const keyText = fs.readFileSync(keyFile, 'utf8');
  const publicLine = sshsig.parsePrivateKey(keyText).publicKey.line;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-release-'));
  try {
    const stage = stageSource(work, { dirty: git.dirty, allowDirty });
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    const version = pkg.version;
    const dir = path.join(outRoot, version);
    if (fs.existsSync(dir)) {
      if (!replace) throw new Error(`${dir} exists; pass --replace to rebuild it`);
      const allowed = new Set([...layout.expectedFiles(version).keys(), layout.SUMS, layout.SIG, layout.MANIFEST]);
      const foreign = layout.listDir(dir).filter(name => !allowed.has(name));
      if (foreign.length) throw new Error(`${dir} holds files a release never has (${foreign.join(', ')}); not deleting it`);
      fs.rmSync(dir, { recursive: true });
    }
    log(`Building boppi ${version} from ${git.commit}${git.dirty ? ' (DIRTY working tree)' : ''}, SOURCE_DATE_EPOCH=${git.epoch}`);

    const packed = npmPack(stage, path.join(work, 'pack'), git.epoch);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(packed.tarball, path.join(dir, layout.tarballName(version)));
    const assets = packed.files.filter(f => /^(bin|src)\//.test(f) || f === 'package.json');
    log(`  npm pack: ${packed.files.length} files; ${assets.length} embedded in each executable`);

    const runtimes = {};
    const binaries = {};
    for (const target of Object.keys(layout.TARGETS)) {
      const archive = await runtimeArchive(target, cache);
      binaries[target] = extractRuntime(target, archive, path.join(work, 'runtimes', target));
      runtimes[target] = layout.sha256File(binaries[target]);
    }
    const builder = binaries[hostTarget()];
    for (const target of Object.keys(layout.TARGETS)) {
      const output = path.join(dir, layout.executableName(version, target));
      log(`  ${target}: building ${path.basename(output)}`);
      buildExecutable({ builder, runtime: binaries[target], stage, assets, output, work, target });
    }

    const template = fs.readFileSync(path.join(stage, 'scripts', 'release', 'install.sh'), 'utf8');
    fs.writeFileSync(path.join(dir, layout.INSTALLER), layout.stampInstaller(template, { version, publicLine, baseUrl }), { mode: 0o755 });
    layout.writeJson(path.join(dir, layout.MANIFEST), {
      schema: layout.SCHEMA, version, commit: git.commit, sourceDateEpoch: git.epoch, ...(git.dirty ? { dirty: true } : {}),
      node: { version: RUNTIMES.version, runtimes },
    });
    const signed = signRelease({ keyFile, dir });
    const stamp = new Date(git.epoch * 1000);
    for (const name of layout.listDir(dir)) fs.utimesSync(path.join(dir, name), stamp, stamp);
    log(`  signed with ${signed.fingerprint}`);
    return dir;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Every file in a and b, byte for byte. Returns a list of differences. */
export function compareDirs(a, b) {
  const names = [...new Set([...layout.listDir(a), ...layout.listDir(b)])].sort();
  const diffs = [];
  for (const name of names) {
    const fa = path.join(a, name), fb = path.join(b, name);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) diffs.push(`${name}: only in ${fs.existsSync(fa) ? 'first' : 'second'}`);
    else if (layout.sha256File(fa) !== layout.sha256File(fb)) diffs.push(`${name}: ${layout.sha256File(fa)} vs ${layout.sha256File(fb)}`);
  }
  return diffs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  try {
    const keyFile = value('--key') || process.env.BOPPI_RELEASE_KEY;
    if (!keyFile) throw new Error('usage: build.mjs --key <private key> [--out <dir>] [--base-url https://...] [--replace] [--check-reproducible] [--allow-dirty]');
    const options = { keyFile, outRoot: path.resolve(value('--out') || path.join(ROOT, 'dist', 'release')), baseUrl: value('--base-url') || '', allowDirty: args.includes('--allow-dirty'), replace: args.includes('--replace'), cache: value('--cache') || DEFAULT_CACHE };
    const dir = await build(options);
    process.stdout.write(`Release directory: ${dir}\n`);
    if (args.includes('--check-reproducible')) {
      const second = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-release-repro-'));
      try {
        const again = await build({ ...options, outRoot: second, replace: false });
        const diffs = compareDirs(dir, again);
        if (diffs.length) { process.stderr.write(`NOT reproducible:\n  ${diffs.join('\n  ')}\n`); process.exit(1); }
        process.stdout.write(`Reproducible: a second build of the same commit is byte-identical (${layout.listDir(dir).length} files; SHA256SUMS sha256 ${layout.sha256File(path.join(dir, layout.SUMS))}).\n`);
      } finally { fs.rmSync(second, { recursive: true, force: true }); }
    }
  } catch (error) {
    process.stderr.write(`build: ${error.message}\n`);
    process.exit(1);
  }
}
