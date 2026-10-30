#!/bin/sh
# Boppi Agent installer, version @@BOPPI_VERSION@@.
#
# What it does: downloads the boppi executable for this machine, SHA256SUMS
# and SHA256SUMS.sig into a temporary folder; checks the signature with
# ssh-keygen -Y verify against the release key written below; checks the
# executable against SHA256SUMS; then moves it to
# ${BOPPI_INSTALL_DIR:-$HOME/.boppi/bin}/boppi and writes an install receipt
# next to it listing what it created.
# What it never does: use sudo, install a service, launch agent, systemd
# unit or login item, edit your shell startup files, or keep anything when a
# check fails.
#
#   sh install.sh [--base-url <url>] [--skip-signature]
#   sh install.sh --uninstall
#
# BOPPI_RELEASE_URL (or --base-url) is the folder holding the release files.
# It must be https; plain http is accepted only for 127.0.0.1 or localhost.
set -eu

BOPPI_VERSION='@@BOPPI_VERSION@@'
BOPPI_PUBLIC_KEY='@@BOPPI_PUBLIC_KEY@@'
BOPPI_DEFAULT_BASE_URL='@@BOPPI_DEFAULT_BASE_URL@@'
NAMESPACE='boppi-release'

say() { printf '%s\n' "$*"; }
fail() { printf 'boppi installer: %s\n' "$*" >&2; exit 1; }

base_url="${BOPPI_RELEASE_URL:-$BOPPI_DEFAULT_BASE_URL}"
mode=install
skip_signature=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) [ $# -ge 2 ] || fail "--base-url needs a URL"; base_url="$2"; shift 2 ;;
    --base-url=*) base_url="${1#--base-url=}"; shift ;;
    --uninstall) mode=uninstall; shift ;;
    --skip-signature) skip_signature=1; shift ;;
    -h|--help) sed -n '2,21p' "$0" 2>/dev/null || true; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

install_dir="${BOPPI_INSTALL_DIR:-${HOME:?HOME is not set}/.boppi/bin}"
case "$install_dir" in /*) ;; *) fail "BOPPI_INSTALL_DIR must be an absolute path: $install_dir" ;; esac
target="$install_dir/boppi"
receipt="$install_dir/boppi.install-receipt"

if [ "$mode" = uninstall ]; then
  [ -f "$receipt" ] || fail "no install receipt at $receipt; nothing was removed (this installer only removes what it recorded)."
  removed=0
  while IFS= read -r line; do
    case "$line" in
      file=*)
        f="${line#file=}"
        case "$f" in "$target"|"$receipt") ;; *) fail "the receipt names a file this installer never creates: $f; nothing more was removed." ;; esac
        if [ -e "$f" ] && [ "$f" != "$receipt" ]; then rm -f "$f"; removed=$((removed + 1)); say "removed $f"; fi ;;
    esac
  done < "$receipt"
  dirs=$(sed -n 's/^dir=//p' "$receipt")
  rm -f "$receipt"
  say "removed $receipt"
  # Directories the installer created, deepest first; only empty ones go.
  printf '%s\n' "$dirs" | while IFS= read -r d; do
    [ -n "$d" ] || continue
    if rmdir "$d" 2>/dev/null; then say "removed empty folder $d"; fi
  done
  say "The Boppi program is uninstalled. Agent data under ~/.boppi (history, workspace pairing, fix backups) was not touched: 'boppi uninstall' removes it, so run that before this command, or reinstall, run it, and uninstall again."
  exit 0
fi

# --- platform ---------------------------------------------------------------
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) os=unsupported ;;
esac
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) arch=unsupported ;;
esac
case "$os-$arch" in
  darwin-arm64|darwin-x64|linux-x64) ;;
  *) fail "no standalone Boppi Agent for $(uname -s) $(uname -m) yet. With Node 18 or newer, run: npx boppi@$BOPPI_VERSION" ;;
esac
asset="boppi-$BOPPI_VERSION-$os-$arch"

# --- release URL ------------------------------------------------------------
[ -n "$base_url" ] || fail "no release URL. Set BOPPI_RELEASE_URL or pass --base-url <url> (the folder that holds $asset)."
base_url="${base_url%/}"
case "$base_url" in
  *@*|*'?'*|*'#'*|*' '*) fail "the release URL must not contain credentials, a query, a fragment or spaces: $base_url" ;;
esac
case "$base_url" in
  https://?*) ;;
  http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*|http://localhost|http://localhost:*|http://localhost/*) ;;
  *) fail "refusing $base_url: the release URL must use https (plain http only for 127.0.0.1 or localhost)." ;;
esac

if command -v curl >/dev/null 2>&1; then
  case "$base_url" in
    https://*) fetch() { curl --proto '=https' --tlsv1.2 -fsSL -o "$2" "$1"; } ;;
    *) fetch() { curl -fsSL -o "$2" "$1"; } ;;
  esac
elif command -v wget >/dev/null 2>&1; then
  case "$base_url" in
    https://*) fetch() { wget -q --https-only -O "$2" "$1"; } ;;
    *) fetch() { wget -q -O "$2" "$1"; } ;;
  esac
else
  fail "neither curl nor wget is installed."
fi

if command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
elif command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | cut -d ' ' -f 1; }
else
  fail "neither shasum nor sha256sum is installed, so the download cannot be checked."
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/boppi-install.XXXXXX") || fail "cannot create a temporary folder."
trap 'rm -rf "$tmp"' EXIT
trap 'rm -rf "$tmp"; exit 1' HUP INT TERM

say "Downloading Boppi $BOPPI_VERSION for $os-$arch from $base_url"
fetch "$base_url/SHA256SUMS" "$tmp/SHA256SUMS" || fail "could not download $base_url/SHA256SUMS; nothing was installed."
fetch "$base_url/SHA256SUMS.sig" "$tmp/SHA256SUMS.sig" || fail "could not download $base_url/SHA256SUMS.sig; nothing was installed."
fetch "$base_url/$asset" "$tmp/$asset" || fail "could not download $base_url/$asset; nothing was installed."

# --- 1. signature over SHA256SUMS ---------------------------------------------
if command -v ssh-keygen >/dev/null 2>&1; then
  [ "$skip_signature" = 1 ] && say "--skip-signature ignored: ssh-keygen is available, so the signature is checked."
  printf '%s %s\n' "$NAMESPACE" "$BOPPI_PUBLIC_KEY" > "$tmp/allowed_signers"
  if ! ssh-keygen -Y verify -f "$tmp/allowed_signers" -I "$NAMESPACE" -n "$NAMESPACE" -s "$tmp/SHA256SUMS.sig" < "$tmp/SHA256SUMS" >"$tmp/verify.log" 2>&1; then
    cat "$tmp/verify.log" >&2
    fail "the signature on SHA256SUMS does not match the Boppi release key in this installer; nothing was installed. (ssh-keygen -Y needs OpenSSH 8.1 or newer.)"
  fi
  say "Signature OK (Boppi release key)."
elif [ "$skip_signature" = 1 ]; then
  say "!!! WARNING: ssh-keygen is not installed and --skip-signature was given."
  say "!!! The release signature is NOT checked. Only the sha256 checksum below is,"
  say "!!! and it came from the same server. Install OpenSSH to check the signature."
else
  fail "ssh-keygen (OpenSSH) is needed to check the release signature and is not installed; nothing was installed. Install OpenSSH, or pass --skip-signature to rely on the checksum alone."
fi

# --- 2. executable against SHA256SUMS -----------------------------------------
expected=$(awk -v f="$asset" '$2 == f { print $1; n++ } END { if (n != 1) exit 1 }' "$tmp/SHA256SUMS") || fail "SHA256SUMS does not list $asset exactly once; nothing was installed."
case "$expected" in
  *[!0-9a-f]*|'') fail "SHA256SUMS has a malformed entry for $asset; nothing was installed." ;;
esac
[ ${#expected} -eq 64 ] || fail "SHA256SUMS has a malformed entry for $asset; nothing was installed."
actual=$(sha256_of "$tmp/$asset")
[ "$actual" = "$expected" ] || fail "$asset does not match SHA256SUMS (got $actual, expected $expected); nothing was installed."
say "Checksum OK ($actual)."

# --- 3. install ------------------------------------------------------------
created=''
d="$install_dir"
while [ ! -d "$d" ]; do
  created="$created$d
"
  d=$(dirname "$d")
done
previous_dirs=''
[ -f "$receipt" ] && previous_dirs=$(sed -n 's/^dir=//p' "$receipt")
mkdir -p "$install_dir"
staged="$install_dir/.boppi.$$.tmp"
cp "$tmp/$asset" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$target"
{
  printf '# Boppi install receipt: what install.sh created. sh install.sh --uninstall removes exactly these.\n'
  printf 'version=%s\n' "$BOPPI_VERSION"
  printf 'file=%s\n' "$target"
  printf 'file=%s\n' "$receipt"
  printf '%s\n%s\n' "$created" "$previous_dirs" | while IFS= read -r c; do if [ -n "$c" ]; then printf 'dir=%s\n' "$c"; fi; done
} > "$receipt.$$.tmp"
mv -f "$receipt.$$.tmp" "$receipt"

if ! got=$("$target" --version 2>&1) || [ "$got" != "$BOPPI_VERSION" ]; then
  rm -f "$target" "$receipt"
  printf '%s' "$created" | while IFS= read -r c; do if [ -n "$c" ]; then rmdir "$c" 2>/dev/null || true; fi; done
  case $got in
    *libatomic*) fail "the installed program needs the libatomic1 system library, which this machine lacks; it was removed again. Install libatomic1 with your package manager and run install.sh again, or run: npx boppi@$BOPPI_VERSION" ;;
  esac
  fail "the installed program did not report version $BOPPI_VERSION (got: $got); it was removed again."
fi

say "Installed Boppi $got at $target"
say "Receipt: $receipt (sh install.sh --uninstall removes what it lists)."
case ":${PATH:-}:" in
  *":$install_dir:"*) say "Run: boppi scan" ;;
  *)
    say "$install_dir is not on your PATH. To use 'boppi' by name, add this line to your shell startup file (this installer does not edit it):"
    say "  export PATH=\"$install_dir:\$PATH\""
    say "Or run it directly: $target scan" ;;
esac
