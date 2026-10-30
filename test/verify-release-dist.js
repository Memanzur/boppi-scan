#!/usr/bin/env node
/**
 * The Agent's public distribution, without building the 130 MB executables:
 * what npm pack ships, the embedded-module loader of the standalone build,
 * SSHSIG signing and verification (including interop with ssh-keygen), and
 * install.sh end to end against a local HTTP server serving a small fake
 * release signed with a throwaway key, into a temporary HOME.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const REL = path.join(ROOT, 'scripts', 'release');
const VERSION = require('../package.json').version;
let passed = 0, failed = 0, skipped = 0;
function ok(name, condition, detail) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `  (${String(detail).slice(0, 600)})` : ''}`); } }
function skip(name, why) { skipped++; console.log(`  - ${name} (skipped: ${why})`); }
function section(name) { console.log(`\n── ${name} ──`); }
const has = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0;
const node = (script, args, options = {}) => spawnSync(process.execPath, [path.join(REL, script), ...args], { encoding: 'utf8', ...options });

function runAsync(cmd, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr, all: stdout + stderr }));
  });
}

function listTree(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = d => { for (const name of fs.readdirSync(d).sort()) { const f = path.join(d, name); out.push(path.relative(dir, f)); if (fs.statSync(f).isDirectory()) walk(f); } };
  walk(dir);
  return out;
}

(async () => {
  const layout = await import(pathToFileURL(path.join(REL, 'layout.mjs')).href);
  const sshsig = await import(pathToFileURL(path.join(REL, 'sshsig.mjs')).href);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-dist-'));
  try {
    section('What the npm package ships');
    const pack = node('check-pack.mjs', [], { cwd: ROOT });
    ok('npm pack --dry-run lists only bin/, src/, README.md, LICENSE, package.json', pack.status === 0, pack.stderr || pack.stdout);
    const bad = layout.disallowedPackFiles(['bin/boppi.js', 'src/a.js', 'test/x.js', 'src/fixtures/a.json', 'src/.env', 'src/a.js.map', 'docs/x.md', 'scripts/release/build.mjs', 'package.json']);
    ok('the pack rule rejects tests, fixtures, dotfiles, source maps, docs and scripts', JSON.stringify(bad) === JSON.stringify(['test/x.js', 'src/fixtures/a.json', 'src/.env', 'src/a.js.map', 'docs/x.md', 'scripts/release/build.mjs']), JSON.stringify(bad));
    const pkg = require('../package.json');
    ok('package.json files stays pinned to bin, src, README.md, LICENSE', JSON.stringify(pkg.files) === JSON.stringify(['bin', 'src', 'README.md', 'LICENSE']));

    section('Shipped non-module files go through one reader');
    const offenders = [];
    const scan = dir => { for (const name of fs.readdirSync(dir)) { const f = path.join(dir, name); if (fs.statSync(f).isDirectory()) scan(f); else if (f.endsWith('.js') && f !== path.join(ROOT, 'src', 'cli', 'resources.js') && /__dirname|__filename/.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(ROOT, f)); } };
    scan(path.join(ROOT, 'src'));
    ok('no file under src/ except resources.js reads next to __dirname (it would break inside the executable)', offenders.length === 0, offenders.join(', '));
    const resources = require('../src/cli/resources');
    ok('resources.read returns the packaged bytes', resources.read('src/design/tokens.css', 'utf8') === fs.readFileSync(path.join(ROOT, 'src/design/tokens.css'), 'utf8'));
    let refused = false;
    try { resources.read('../package.json'); } catch (_) { refused = true; }
    ok('resources.read refuses a name that climbs out of the package', refused);

    section('The executable\'s embedded-module loader, run from disk');
    const { createLoader } = require(path.join(REL, 'sea-main.js'));
    const names = JSON.parse(spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' }).stdout)[0].files.map(f => f.path).filter(f => /^(bin|src)\//.test(f) || f === 'package.json');
    const loader = createLoader({ names, readText: name => fs.readFileSync(path.join(ROOT, ...name.split('/')), 'utf8'), builtin: spec => require(spec), virtualRoot: ROOT });
    const cli = loader.load('src/cli/boppi.js');
    ok('src/cli/boppi.js loads through the loader with every relative require resolved', cli && typeof cli.main === 'function' && cli.VERSION === VERSION);
    ok('a module loaded twice is the same object (CommonJS cache semantics)', loader.load('src/cli/push.js') === loader.load('src/cli/push.js'));
    ok('package.json resolves as JSON', loader.load('package.json').version === VERSION);
    let missing = null;
    try { loader.resolve('./nope', 'src/cli'); } catch (error) { missing = error.code; }
    ok('an unknown relative module fails with MODULE_NOT_FOUND', missing === 'MODULE_NOT_FOUND');
    ok('the npm package embeds bin/boppi.js, the entry the executable runs', names.includes('bin/boppi.js'));

    if (process.platform === 'win32' || !has('ssh-keygen')) {
      skip('signing, verification and install.sh', 'needs a POSIX shell and ssh-keygen');
      return;
    }

    section('Keys and SSHSIG, both directions with ssh-keygen');
    const keyDir = path.join(work, 'keys');
    const made = node('sign.mjs', ['--generate-test-key', keyDir]);
    const key = path.join(keyDir, 'boppi-release-test');
    ok('--generate-test-key writes an Ed25519 key outside the repo', made.status === 0 && fs.existsSync(key), made.stderr);
    ok('the private key file is 0600', (fs.statSync(key).mode & 0o777) === 0o600, (fs.statSync(key).mode & 0o777).toString(8));
    const inside = node('sign.mjs', ['--generate-test-key', path.join(ROOT, 'tmp-key-should-not-exist')]);
    ok('--generate-test-key refuses a directory inside the git worktree', inside.status !== 0 && /outside the git worktree/.test(inside.stderr) && !fs.existsSync(path.join(ROOT, 'tmp-key-should-not-exist')));
    const fp = spawnSync('ssh-keygen', ['-lf', `${key}.pub`], { encoding: 'utf8' }).stdout.split(' ')[1];
    ok('ssh-keygen reads the public key and prints the same fingerprint', fp === sshsig.parsePublicLine(fs.readFileSync(`${key}.pub`, 'utf8')).fingerprint, fp);
    ok('ssh-keygen reads the private key', spawnSync('ssh-keygen', ['-y', '-f', key], { encoding: 'utf8' }).stdout.trim() === fs.readFileSync(`${key}.pub`, 'utf8').trim());
    const otherKey = path.join(work, 'other', 'id_ed25519');
    fs.mkdirSync(path.dirname(otherKey));
    spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'other', '-f', otherKey]);

    function fakeRelease(dir, keyFile) {
      fs.mkdirSync(dir, { recursive: true });
      for (const target of Object.keys(layout.TARGETS)) {
        const name = layout.executableName(VERSION, target);
        fs.writeFileSync(path.join(dir, name), target === 'win-x64' ? Buffer.from('MZ fake') : `#!/bin/sh\n# fake ${target}\necho ${VERSION}\n`, { mode: 0o755 });
      }
      fs.writeFileSync(path.join(dir, layout.tarballName(VERSION)), Buffer.from('fake tarball'));
      const publicLine = sshsig.parsePrivateKey(fs.readFileSync(keyFile, 'utf8')).publicKey.line;
      fs.writeFileSync(path.join(dir, layout.INSTALLER), layout.stampInstaller(fs.readFileSync(path.join(REL, 'install.sh'), 'utf8'), { version: VERSION, publicLine }), { mode: 0o755 });
      layout.writeJson(path.join(dir, layout.MANIFEST), { schema: layout.SCHEMA, version: VERSION, commit: 'a'.repeat(40), sourceDateEpoch: 1700000000, node: { version: '25.8.0', runtimes: {} } });
      return node('sign.mjs', ['--key', keyFile, '--dir', dir]);
    }
    const rel = path.join(work, 'release');
    const signed = fakeRelease(rel, key);
    ok('sign.mjs signs a release directory', signed.status === 0, signed.stderr);
    const sums = fs.readFileSync(path.join(rel, 'SHA256SUMS'), 'utf8');
    ok('SHA256SUMS lists the 7 release files, sorted, "<hex>  <name>"', sums.split('\n').filter(Boolean).length === 7 && /^[0-9a-f]{64} {2}\S+$/m.test(sums) && JSON.stringify([...layout.parseSums(sums).keys()]) === JSON.stringify([...layout.parseSums(sums).keys()].sort()));
    fs.writeFileSync(path.join(work, 'allowed'), `boppi-release ${fs.readFileSync(`${key}.pub`, 'utf8')}`);
    const sshVerify = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', path.join(work, 'allowed'), '-I', 'boppi-release', '-n', 'boppi-release', '-s', path.join(rel, 'SHA256SUMS.sig')], { input: sums, encoding: 'utf8' });
    ok('ssh-keygen -Y verify accepts the signature sign.mjs made', sshVerify.status === 0 && /Good "boppi-release" signature/.test(sshVerify.stdout), sshVerify.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(rel, 'release.json'), 'utf8'));
    ok('release.json carries files, checksums and the signature block', manifest.files.length === 7 && manifest.checksums.sha256 === layout.sha256File(path.join(rel, 'SHA256SUMS')) && manifest.signature.fingerprint === fp && manifest.signature.namespace === 'boppi-release');
    ok('release.json files carry kind, os and arch per the contract', manifest.files.find(f => f.name === `boppi-${VERSION}-darwin-arm64`).kind === 'executable' && manifest.files.find(f => f.name === `boppi-${VERSION}-win-x64.exe`).os === 'win32' && manifest.files.find(f => f.name === 'install.sh').kind === 'installer');
    const resign = fs.readFileSync(path.join(rel, 'SHA256SUMS.sig'), 'utf8');
    node('sign.mjs', ['--key', key, '--dir', rel]);
    ok('signing again gives byte-identical output (Ed25519 is deterministic)', fs.readFileSync(path.join(rel, 'SHA256SUMS.sig'), 'utf8') === resign);
    const wrongInstaller = fakeRelease(path.join(work, 'mismatch'), key);
    ok('control: a matching key signs', wrongInstaller.status === 0);
    const mismatch = node('sign.mjs', ['--key', otherKey, '--dir', path.join(work, 'mismatch')]);
    ok('sign.mjs refuses a key different from the one install.sh embeds', mismatch.status !== 0 && /install.sh embeds/.test(mismatch.stderr), mismatch.stderr);

    const verify = (dir, args) => node('verify-release.mjs', ['--dir', dir, ...args]);
    ok('verify-release accepts the release with --pub', verify(rel, ['--pub', `${key}.pub`]).status === 0);
    ok('verify-release accepts the release with --fingerprint', verify(rel, ['--fingerprint', fp]).status === 0);
    const noKey = verify(rel, []);
    ok('verify-release refuses to trust the key shipped in the directory by default', noKey.status !== 0 && /not trusted on its own/.test(noKey.stderr));
    const wrongPub = verify(rel, ['--pub', `${otherKey}.pub`]);
    ok('verify-release rejects the right signature against a different expected key', wrongPub.status !== 0 && /expected SHA256:/.test(wrongPub.stderr), wrongPub.stderr);
    const wrongFp = verify(rel, ['--fingerprint', 'SHA256:' + 'A'.repeat(43)]);
    ok('verify-release rejects a fingerprint that is not the shipped key', wrongFp.status !== 0);

    const tamper = (name, mutate, label, pattern) => {
      const file = path.join(rel, name);
      const original = fs.readFileSync(file);
      mutate(file);
      const result = verify(rel, ['--pub', `${key}.pub`]);
      fs.writeFileSync(file, original);
      ok(`verify-release rejects ${label}`, result.status !== 0 && pattern.test(result.stderr), result.stderr);
    };
    tamper(`boppi-${VERSION}-linux-x64`, f => fs.appendFileSync(f, '# evil\n'), 'a changed executable', /does not match SHA256SUMS/);
    tamper('SHA256SUMS', f => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^[0-9a-f]/, c => (c === '0' ? '1' : '0'))), 'a changed SHA256SUMS', /does not verify/);
    tamper('SHA256SUMS.sig', f => { const t = fs.readFileSync(f, 'utf8').split('\n'); t[2] = t[2].replace(/[A-Za-z]/, c => (c === 'A' ? 'B' : 'A')); fs.writeFileSync(f, t.join('\n')); }, 'a changed signature', /signature/);
    tamper('release.json', f => { const m = JSON.parse(fs.readFileSync(f, 'utf8')); m.files[0].size += 1; layout.writeJson(f, m); }, 'a release.json that disagrees with the files', /size differs/);
    fs.writeFileSync(path.join(rel, 'extra.sh'), 'echo hi\n');
    const extra = verify(rel, ['--pub', `${key}.pub`]);
    fs.rmSync(path.join(rel, 'extra.sh'));
    ok('verify-release rejects a file the signature does not cover', extra.status !== 0 && /not covered by the signature: extra.sh/.test(extra.stderr));
    const sigCopy = fs.readFileSync(path.join(rel, 'SHA256SUMS.sig'));
    fs.rmSync(path.join(rel, 'SHA256SUMS.sig'));
    spawnSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', 'not-boppi', path.join(rel, 'SHA256SUMS')], { stdio: 'ignore' });
    const wrongNs = verify(rel, ['--pub', `${key}.pub`]);
    ok('verify-release rejects a signature made for another namespace', wrongNs.status !== 0 && /namespace "not-boppi"/.test(wrongNs.stderr), wrongNs.stderr);
    fs.rmSync(path.join(rel, 'SHA256SUMS.sig'));
    spawnSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', 'boppi-release', path.join(rel, 'SHA256SUMS')], { stdio: 'ignore' });
    ok('verify-release accepts a signature made by ssh-keygen -Y sign', verify(rel, ['--pub', `${key}.pub`]).status === 0);
    fs.writeFileSync(path.join(rel, 'SHA256SUMS.sig'), sigCopy);

    const sshRel = path.join(work, 'ssh-keygen-release');
    const sshSigned = fakeRelease(sshRel, otherKey);
    fs.rmSync(path.join(sshRel, 'SHA256SUMS.sig'));
    spawnSync('ssh-keygen', ['-Y', 'sign', '-f', otherKey, '-n', 'boppi-release', path.join(sshRel, 'SHA256SUMS')], { stdio: 'ignore' });
    ok('a key made by ssh-keygen -t ed25519 signs with sign.mjs, and an ssh-keygen signature with it verifies', sshSigned.status === 0 && verify(sshRel, ['--pub', `${otherKey}.pub`]).status === 0, sshSigned.stderr);

    section('install.sh against a local server');
    let served = new Map(layout.listDir(rel).map(name => [`/${name}`, fs.readFileSync(path.join(rel, name))]));
    const server = http.createServer((req, res) => {
      const body = served.get(req.url);
      if (!body) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const installer = path.join(rel, 'install.sh');
    const arch = { arm64: 'arm64', x64: 'x64' }[process.arch];
    const asset = `/boppi-${VERSION}-${process.platform}-${arch}`;
    const shells = ['sh', ...(has('dash') ? ['dash'] : [])];
    let homeCount = 0;
    const freshHome = () => { const h = path.join(work, `home-${++homeCount}`); fs.mkdirSync(h); return h; };
    const shellPath = name => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
    const install = (home, args = [], env = {}, shell = 'sh') => runAsync(shellPath(shell), [installer, ...args], { env: { PATH: process.env.PATH, HOME: home, TMPDIR: work, ...env } });
    const original = new Map(served);
    try {
      for (const shell of shells) {
        const home = freshHome();
        const result = await install(home, ['--base-url', base], {}, shell);
        const target = path.join(home, '.boppi', 'bin', 'boppi');
        ok(`[${shell}] installs after the signature and checksum pass`, result.code === 0 && /Signature OK/.test(result.stdout) && /Checksum OK/.test(result.stdout) && fs.existsSync(target), result.all);
        ok(`[${shell}] the program is mode 755 and reports ${VERSION}`, fs.existsSync(target) && (fs.statSync(target).mode & 0o777) === 0o755 && spawnSync(target, ['--version'], { encoding: 'utf8' }).stdout.trim() === VERSION);
        const receipt = fs.existsSync(`${target}.install-receipt`) ? fs.readFileSync(`${target}.install-receipt`, 'utf8') : '';
        ok(`[${shell}] the receipt lists the program, itself and the two folders it created`, receipt.includes(`file=${target}\n`) && receipt.includes(`file=${target}.install-receipt\n`) && receipt.includes(`dir=${path.join(home, '.boppi', 'bin')}\n`) && receipt.includes(`dir=${path.join(home, '.boppi')}\n`), receipt);
        ok(`[${shell}] it prints the PATH line and touches no shell startup file`, result.stdout.includes(`export PATH="${path.join(home, '.boppi', 'bin')}:$PATH"`) && JSON.stringify(listTree(home)) === JSON.stringify(['.boppi', '.boppi/bin', '.boppi/bin/boppi', '.boppi/bin/boppi.install-receipt']), listTree(home).join(','));
        const removed = await install(home, ['--uninstall'], {}, shell);
        ok(`[${shell}] --uninstall removes exactly what it created and names boppi uninstall for Agent data`, removed.code === 0 && listTree(home).length === 0 && /boppi uninstall/.test(removed.stdout), `${removed.all} left: ${listTree(home)}`);
      }
      ok('no temporary download folder is left behind', !fs.readdirSync(work).some(n => n.startsWith('boppi-install.')));

      const kept = freshHome();
      fs.mkdirSync(path.join(kept, '.boppi'));
      fs.writeFileSync(path.join(kept, '.boppi', 'history.json'), '[]');
      await install(kept, ['--base-url', base]);
      await install(kept, ['--uninstall']);
      ok('--uninstall keeps a folder it did not create and Agent data in it', JSON.stringify(listTree(kept)) === JSON.stringify(['.boppi', '.boppi/history.json']), listTree(kept).join(','));
      const custom = freshHome();
      const customDir = path.join(custom, 'tools', 'bin');
      const viaEnv = await install(custom, [], { BOPPI_INSTALL_DIR: customDir, BOPPI_RELEASE_URL: base });
      ok('BOPPI_INSTALL_DIR and BOPPI_RELEASE_URL are honored', viaEnv.code === 0 && fs.existsSync(path.join(customDir, 'boppi')), viaEnv.all);
      await install(custom, ['--uninstall'], { BOPPI_INSTALL_DIR: customDir });
      ok('uninstall from BOPPI_INSTALL_DIR removes the folders it created', listTree(custom).length === 0, listTree(custom).join(','));

      const refuses = async (label, setup, pattern) => {
        served = new Map(original);
        setup();
        const home = freshHome();
        const result = await install(home, ['--base-url', base]);
        served = new Map(original);
        ok(`refuses ${label} and installs nothing`, result.code !== 0 && pattern.test(result.stderr) && listTree(home).length === 0, `${result.code}: ${result.all} left: ${listTree(home)}`);
      };
      const evil = Buffer.from(`#!/bin/sh\necho ${VERSION}\n# evil\n`);
      await refuses('a tampered binary (checksum)', () => served.set(asset, evil), /does not match SHA256SUMS/);
      // A tampered binary with SHA256SUMS rewritten to match: only the signature catches it.
      const evilSums = sums.replace(new RegExp(`^[0-9a-f]{64}(?=  ${asset.slice(1)}$)`, 'm'), layout.sha256(evil));
      await refuses('a tampered binary with a matching tampered SHA256SUMS (signature)', () => { served.set(asset, evil); served.set('/SHA256SUMS', Buffer.from(evilSums)); }, /signature on SHA256SUMS does not match/);
      const attackerDir = path.join(work, 'attacker');
      fs.mkdirSync(attackerDir);
      fs.writeFileSync(path.join(attackerDir, 'SHA256SUMS'), evilSums);
      spawnSync('ssh-keygen', ['-Y', 'sign', '-f', otherKey, '-n', 'boppi-release', path.join(attackerDir, 'SHA256SUMS')], { stdio: 'ignore' });
      await refuses('a release signed by a different key', () => { served.set(asset, evil); served.set('/SHA256SUMS', Buffer.from(evilSums)); served.set('/SHA256SUMS.sig', fs.readFileSync(path.join(attackerDir, 'SHA256SUMS.sig'))); }, /signature on SHA256SUMS does not match/);
      await refuses('a missing signature', () => served.delete('/SHA256SUMS.sig'), /could not download .*SHA256SUMS.sig/);
      await refuses('a missing binary', () => served.delete(asset), /could not download/);
      for (const url of ['http://example.com/boppi', 'http://127.0.0.1.evil.example/x', 'http://localhost@evil.example/x', 'ftp://127.0.0.1/x']) {
        const home = freshHome();
        const result = await install(home, ['--base-url', url]);
        ok(`refuses ${url} before any download`, result.code !== 0 && /must (use https|not contain)/.test(result.stderr) && listTree(home).length === 0, result.all);
      }
      const none = await install(freshHome(), []);
      ok('with no release URL it says how to give one', none.code !== 0 && /BOPPI_RELEASE_URL/.test(none.stderr));
      const uninstallNothing = await install(freshHome(), ['--uninstall']);
      ok('--uninstall without a receipt removes nothing and says so', uninstallNothing.code !== 0 && /no install receipt/.test(uninstallNothing.stderr));

      // A PATH with every tool the installer uses except ssh-keygen.
      const bin = path.join(work, 'no-ssh-bin');
      fs.mkdirSync(bin);
      for (const tool of ['uname', 'mktemp', 'curl', 'shasum', 'sha256sum', 'awk', 'cut', 'cp', 'chmod', 'mv', 'mkdir', 'rm', 'rmdir', 'dirname', 'sed', 'cat', 'perl']) {
        const where = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
        if (where && where.startsWith('/')) fs.symlinkSync(where, path.join(bin, tool));
      }
      const noSsh = await install(freshHome(), ['--base-url', base], { PATH: bin });
      ok('without ssh-keygen it refuses unless --skip-signature is given', noSsh.code !== 0 && /ssh-keygen \(OpenSSH\) is needed/.test(noSsh.stderr), noSsh.all);
      const skipHome = freshHome();
      const skipped2 = await install(skipHome, ['--base-url', base, '--skip-signature'], { PATH: bin });
      ok('--skip-signature without ssh-keygen warns loudly and still checks the checksum', skipped2.code === 0 && /WARNING: ssh-keygen is not installed/.test(skipped2.stdout) && /Checksum OK/.test(skipped2.stdout), skipped2.all);
      served.set(asset, evil);
      const skipEvil = await install(freshHome(), ['--base-url', base, '--skip-signature'], { PATH: bin });
      served = new Map(original);
      ok('--skip-signature never skips the checksum', skipEvil.code !== 0 && /does not match SHA256SUMS/.test(skipEvil.stderr));
      const skipWithSsh = await install(freshHome(), ['--base-url', base, '--skip-signature']);
      ok('--skip-signature is ignored when ssh-keygen is present', skipWithSsh.code === 0 && /ignored/.test(skipWithSsh.stdout) && /Signature OK/.test(skipWithSsh.stdout));

      const template = fs.readFileSync(path.join(REL, 'install.sh'), 'utf8');
      ok('the installer never uses sudo, launchctl, systemctl, crontab or a shell rc file', !/\bsudo\b|launchctl|systemctl|crontab|\.bashrc|\.zshrc|\.profile|LaunchAgents/.test(template.replace(/^#.*$/gm, '')));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
