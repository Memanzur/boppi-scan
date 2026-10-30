# Boppi Agent distribution

How the Agent is packaged outside npm: standalone executables, a signed
checksum list, and an installer that checks the signature before it installs
anything. Nothing here publishes, pushes or creates a release. Hosting the
files is a founder decision (see Blocked steps).

## What a release is

`node scripts/release/build.mjs` writes one directory per version,
`dist/release/<version>/` (gitignored):

| File | What it is |
| --- | --- |
| `boppi-<v>.tgz` | `npm pack` output, the same package npm would publish |
| `boppi-<v>-darwin-arm64` | standalone executable, ad-hoc codesigned |
| `boppi-<v>-darwin-x64` | standalone executable, ad-hoc codesigned (see Known problems) |
| `boppi-<v>-linux-x64` | standalone executable |
| `boppi-<v>-win-x64.exe` | standalone executable (built here, not run here) |
| `install.sh` | POSIX installer with the version and the release public key stamped in |
| `boppi-release.pub` | release public key, `ssh-ed25519 AAAA... boppi-release` |
| `SHA256SUMS` | `<sha256>  <name>` for every file above, sorted by name |
| `SHA256SUMS.sig` | OpenSSH SSHSIG signature of `SHA256SUMS`, namespace `boppi-release` |
| `release.json` | manifest, schema `boppi-agent-release-v1` (not in `SHA256SUMS`; it records `SHA256SUMS`' own hash) |

The executables are Node single executable applications on the official
Node 25.8.0 runtime. Every file the npm package ships under `bin/` and `src/`,
plus `package.json`, is embedded as an asset; `scripts/release/sea-main.js`
loads those CommonJS files from the assets and runs `bin/boppi.js`, the same
entry as `npx boppi`. Report scripts, styles, the logo and demo fixtures are
read through `src/cli/resources.js`, which reads assets inside the executable
and the package on disk otherwise.

## Build

```sh
# Development: a throwaway key outside the repository
node scripts/release/sign.mjs --generate-test-key /path/outside/the/repo
# Build from a clean commit, then prove it is reproducible
node scripts/release/build.mjs --key /path/outside/the/repo/boppi-release-test --check-reproducible
# Optional: --base-url https://<host>/<path> stamps the default download folder into install.sh
```

- The source is `git archive HEAD`. A dirty tree is refused. `--allow-dirty`
  copies the working tree, writes `"dirty": true` into `release.json`, and
  `verify-release.mjs` warns that such a build must never be hosted.
- `SOURCE_DATE_EPOCH` is the commit time. The npm tarball is packed with
  `--ignore-scripts` and must list only `bin/`, `src/`, `README.md`,
  `LICENSE` and `package.json` (also `npm run release:check-pack`).
- Node runtimes are pinned in `scripts/release/node-runtimes.json` by archive
  sha256, taken from nodejs.org's `SHASUMS256.txt` for v25.8.0. An archive is
  downloaded into `~/.cache/boppi-release/node-runtimes/` only when missing, and
  any archive whose sha256 differs is refused. Only the `node` binary is
  extracted, into a temporary folder, for every build. `release.json` records
  the sha256 of each extracted binary.
- The host's own official runtime (darwin-arm64, darwin-x64 or linux-x64)
  runs `--build-sea` for every target; Homebrew's Node cannot (it is a shared
  libnode build without the SEA fuse). darwin outputs need macOS `codesign`.
- `--replace` rebuilds an existing version folder, and only deletes it when it
  holds nothing but release files.

## Sign

`node scripts/release/sign.mjs --key <private key> --dir <release dir>` writes
`boppi-release.pub`, `SHA256SUMS`, `SHA256SUMS.sig` and the `files`,
`checksums` and `signature` blocks of `release.json`. `build.mjs` calls it.

- Keys are OpenSSH Ed25519 files. A key made by `ssh-keygen -t ed25519` works;
  a passphrase-protected one is handed to `ssh-keygen -Y sign`, which asks for
  the passphrase.
- It refuses a directory with unknown files, and an `install.sh` that embeds a
  different key than the signing key.
- Signatures use the SSHSIG format because `install.sh` verifies with
  `ssh-keygen -Y verify` (macOS's LibreSSL cannot verify Ed25519). They are
  made with `node:crypto`, no dependencies. Ed25519 is deterministic, so
  re-signing the same `SHA256SUMS` gives the same signature.
- `--generate-test-key <dir>` refuses any folder inside the git worktree and
  writes the private key with mode 0600. Test keys never sign a hosted release.

## Verify

```sh
node scripts/release/verify-release.mjs --dir dist/release/<v> --pub <trusted boppi-release.pub>
node scripts/release/verify-release.mjs --dir dist/release/<v> --fingerprint SHA256:...
```

It checks the signature against the key you name (the key inside the folder
is never trusted on its own; `--trust-shipped-key` does that explicitly and
warns), every file against `SHA256SUMS`, that nothing unlisted is present and
nothing listed is missing, and that `release.json`, `boppi-release.pub` and the
key stamped in `install.sh` agree. Any mismatch exits 1 with the reason.

Independent check with OpenSSH only:

```sh
printf 'boppi-release %s\n' "$(cat boppi-release.pub)" > allowed_signers
ssh-keygen -Y verify -f allowed_signers -I boppi-release -n boppi-release -s SHA256SUMS.sig < SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

## What install.sh does and does not do

```sh
curl -fsSL https://<host>/<path>/install.sh | sh -s -- --base-url https://<host>/<path>
sh install.sh --uninstall
```

It does:

1. Pick the executable for this machine: macOS arm64 or x64, Linux x64.
   Anything else stops with `npx boppi@<version>` as the alternative.
2. Accept the release folder from `--base-url` or `BOPPI_RELEASE_URL` only over
   https; plain http only for `127.0.0.1` or `localhost`. URLs with
   credentials, a query or a fragment are refused. Uses curl (https only, TLS
   1.2 or newer) or wget.
3. Download the executable, `SHA256SUMS` and `SHA256SUMS.sig` into a `mktemp`
   folder that is removed on exit.
4. Verify the signature first, with `ssh-keygen -Y verify` against the key
   stamped into the installer. Without ssh-keygen it refuses, unless
   `--skip-signature` is given, which prints a loud warning; `--skip-signature`
   is ignored when ssh-keygen exists.
5. Check the executable's sha256 against `SHA256SUMS` (shasum or sha256sum).
   This check is never skipped.
6. Install to `${BOPPI_INSTALL_DIR:-$HOME/.boppi/bin}/boppi`: copy to a
   temporary name in that folder, chmod 755, rename over the target.
7. Write `boppi.install-receipt` next to it listing the program, the receipt
   and every folder it created.
8. Run `boppi --version`; if that fails or prints another version, remove
   what it installed and stop.
9. Print the `export PATH=...` line if the folder is not on PATH.

It never: uses sudo; installs a service, launch agent, systemd unit, cron job
or login item; edits a shell startup file; leaves anything installed when a
check fails. `--uninstall` removes only what the receipt lists (folders only
when empty) and says that `boppi uninstall` removes Agent data under
`~/.boppi` (history, pairing, fix backups). `boppi uninstall` itself removes
`~/.boppi`, which includes a default standalone install in `~/.boppi/bin`.

## Version handshake (Agent side)

Every request to a workspace (push, events push, every `/api/connector/*`
route) sends `Boppi-Agent-Version: <version>` and
`user-agent: boppi-cli/<version>`, built in one place,
`src/cli/agentRequest.js`. The connector poll body carries
`versions: { scanner, engine, rubric }`. On HTTP 426 `agent_outdated`, push,
events push and connect print the workspace's sentence and one upgrade line,
then exit 5; a looping `connect run` stops. Inside the standalone executable
the upgrade line says to rerun the installer from
`<workspace>/dashboard/get-agent`; under npm it says `npx boppi@<minimum>`.
Neither says `npm install -g` or `@latest`. The version is a compatibility
signal, not a security control.

## Evidence (2026-10-29, test key)

- Release built from commit `a122d8d360a4ebd73b1fec8dad7c22ef7d3b7fa7`, signed
  with the throwaway test key `SHA256:sl2kUTCJZq2xe3ffGIRI4prK5XzStWX7DZgJmDkdId0`.
- Reproducibility: `build.mjs --check-reproducible` built the commit twice in
  different temporary folders; all 10 files were byte-identical, `SHA256SUMS`
  sha256 `1ce7c7790f39f9c5e6213ad587fe794815e19fdb6fb7f6da311036eb4f6a5291`.
  The first attempt was not identical because Node embeds the SEA main
  script's path; the build now passes it relative to the build folder.
- `verify-release.mjs` (with `--pub` and with `--fingerprint`) and
  `ssh-keygen -Y verify` both accept the release.
- Real install: `install.sh` from a local 127.0.0.1 server into a temporary
  HOME installed the darwin-arm64 executable (signature and checksum OK);
  the installed executable ran `--version`, `scan --html`, `connect pair`,
  `connect run --once` and `push` against a local stand-in workspace, which
  saw `Boppi-Agent-Version: 0.4.0` and `boppi-cli/0.4.0` on every request and
  `versions` in the poll; a 426 answer printed the installer upgrade line and
  exited 5; `--uninstall` removed the program, receipt and `bin` folder.
- `test/verify-release-dist.js` (in `npm test`) runs a small fake release
  through signing, verification and `install.sh` (sh and dash) in seconds.

Executed vs built:

| Target | Status |
| --- | --- |
| darwin-arm64 | executed: install, version, scan, connect, push |
| linux-x64 | executed in Docker (`--platform linux/amd64`, emulated): `--version` and `scan` work once `libatomic1` is installed; without it the loader stops (`libatomic.so.1` missing). The official Node 25 Linux build needs that library. |
| darwin-x64 | built, crashes under Rosetta 2 (SIGSEGV in a dyld initializer). See Known problems. |
| win-x64 | built only; cannot run on this Mac |

## Known problems

- **darwin-x64 does not start under Rosetta 2.** A one-line program built
  with `--build-sea` on the official darwin-x64 Node 25.8.0 crashes the same
  way, whether the arm64 or the x64 Node builds it and with or without a
  signature; the unmodified x64 `node` runs fine. So the cause is Node's
  Mach-O injection for x86_64 (or Rosetta's handling of it), not Boppi's code.
  Not yet tried on a real Intel Mac. Do not host this file until it runs on
  Intel hardware. If it is hosted and crashes, `install.sh` notices at the
  `--version` step and removes it again.
- **Linux needs libatomic1.** Minimal images (Debian slim, some containers)
  lack it. Install it with the system package manager, or use `npx boppi`.
  Alpine (musl) is not supported by the official Node build.
- **Node 25 is an odd-numbered Current line, not LTS, and by Node's published
  schedule its support ended around June 2026 (odd lines get about eight
  months).** That means no further security fixes for the runtime inside these
  executables. It was chosen because it was the runtime already verified here
  and its `--build-sea` builds every target from one Mac. Before hosting
  anything, re-pin to a supported LTS line (Node 24, or 26 once it enters LTS)
  and re-run `--check-reproducible`; if that line's `--build-sea` cannot build
  other platforms, build each target on its own OS. Every Node security
  release needs a new Agent build either way, because the runtime is inside
  the executable. Check the current schedule at
  https://github.com/nodejs/release#release-schedule before deciding.

## Blocked steps (need the founder)

**(a) The real release key.** The founder generates it on a machine they
control, keeps the private key offline, and publishes only the public key and
its fingerprint:

```sh
ssh-keygen -t ed25519 -C boppi-release -f boppi-release
# Choose a passphrase. sign.mjs hands a protected key to ssh-keygen, which asks for it.
ssh-keygen -lf boppi-release.pub       # the fingerprint to publish and to configure in the Cloud
```

Keep `boppi-release` (the private key) offline, for example on an encrypted
USB drive plus a paper or password-manager backup, never in a repository,
CI secret store or cloud drive. The public key line must end in
` boppi-release` (the comment above sets it). Until this exists the Cloud says
"checksums only", never "signed".

**(b) macOS signing and notarization.** Needs an Apple Developer ID
Application certificate. After the build, for each darwin executable:

```sh
codesign --remove-signature boppi-<v>-darwin-arm64
codesign --sign "Developer ID Application: <Name> (<TEAMID>)" --options runtime --timestamp \
  --entitlements entitlements.plist --force boppi-<v>-darwin-arm64
```

with an `entitlements.plist` granting what the V8 JIT needs under the hardened
runtime: `com.apple.security.cs.allow-jit` and
`com.apple.security.cs.allow-unsigned-executable-memory`. Node's own macOS
build also sets `com.apple.security.cs.disable-library-validation` (needed only
for native addons, which Boppi does not load); start without it and add it
only if the signed executable fails. Then notarize:

```sh
ditto -c -k --keepParent boppi-<v>-darwin-arm64 boppi-<v>-darwin-arm64.zip
xcrun notarytool submit boppi-<v>-darwin-arm64.zip --keychain-profile <profile> --wait
```

A bare executable cannot be stapled (`xcrun stapler` works on .app, .pkg and
.dmg only), so Gatekeeper checks the notarization ticket online the first
time. That is fine for `install.sh`, because curl does not set the quarantine
flag; a browser download of the bare file would still be checked. Shipping a
.pkg or .dmg would allow stapling, at the cost of a second installer format.
Re-signing changes the bytes, so sign and notarize before `sign.mjs` writes
`SHA256SUMS`.

**(c) Windows signing.** Needs an OV or EV Authenticode code-signing
certificate (EV builds SmartScreen reputation faster). The executable still
carries Node's original signature, which the injection invalidated; remove it
(`signtool remove /s boppi-<v>-win-x64.exe`), then:

```sh
signtool sign /fd SHA256 /tr <RFC 3161 timestamp URL from the CA> /td SHA256 /f <cert> boppi-<v>-win-x64.exe
signtool verify /pa boppi-<v>-win-x64.exe
```

There is no Windows installer yet; Windows users run `npx boppi`.

**(d) Hosting.** Where the release folder is served (GitHub Releases on the
scanner repository, or another https host) and who can upload to it is a
founder approval. The base URL is then stamped with `build.mjs --base-url`, and
the Cloud's Get the Agent page points at that folder. No upload has been made.
