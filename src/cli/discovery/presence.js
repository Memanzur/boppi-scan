/**
 * Inventory-only detection: installed desktop apps, known AI browser
 * extensions, and provider credential names. No config parsing of app bundles
 * or extension packages. Extension ids are the Chrome Web Store ids.
 *
 * Gemini in Chrome is part of the browser, not a store extension, so it has
 * no id here. No first-party Microsoft Copilot Chrome extension id is published.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const secrets = require('./secrets');

const EXTENSIONS = Object.freeze([
  { id: 'hehggadaopoacecdllhhajmbjkdcmajg', product: 'ChatGPT', vendor: 'OpenAI', store: 'https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg' },
  { id: 'fcoeoabgfenejglbffodgkkbkcdhcgfn', product: 'Claude', vendor: 'Anthropic', store: 'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn' },
  { id: 'pninphncmkphpjgfffammoenglghcjii', product: 'Perplexity', vendor: 'Perplexity', store: 'https://chromewebstore.google.com/detail/perplexity/pninphncmkphpjgfffammoenglghcjii' },
  { id: 'bnaffjbjpgiagpondjlnneblepbdchol', product: 'Perplexity Search', vendor: 'Perplexity', store: 'https://chromewebstore.google.com/detail/perplexity-ai-search/bnaffjbjpgiagpondjlnneblepbdchol' },
  { id: 'kbfnbcaeplbcioakkpcpgfkobkghlhen', product: 'Grammarly', vendor: 'Grammarly', store: 'https://chromewebstore.google.com/detail/grammarly-ai-writing-assi/kbfnbcaeplbcioakkpcpgfkobkghlhen' },
]);

const MAC_APPS = Object.freeze([
  { source: 'chatgpt-app', label: 'ChatGPT', bundles: ['ChatGPT.app'] },
  { source: 'claude-app', label: 'Claude', bundles: ['Claude.app'] },
  { source: 'copilot-app', label: 'Microsoft Copilot', bundles: ['Microsoft Copilot.app', 'Copilot.app'] },
  { source: 'perplexity-app', label: 'Perplexity', bundles: ['Perplexity.app'] },
  { source: 'ollama-app', label: 'Ollama', bundles: ['Ollama.app'] },
]);

function isRealHome(home) {
  try { return path.resolve(home) === path.resolve(os.homedir()); } catch (_) { return false; }
}

function roaming(home, platform) {
  if (platform !== 'win32') return null;
  return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
}

function localData(home, platform) {
  if (platform !== 'win32') return null;
  return process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
}

function isDir(file) {
  try { const stat = fs.lstatSync(file); return stat.isDirectory() && !stat.isSymbolicLink(); } catch (_) { return false; }
}

function isFile(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); } catch (_) { return false; }
}

function browserRoots(home, platform) {
  if (platform === 'darwin') {
    const app = path.join(home, 'Library', 'Application Support');
    return [
      { browser: 'Chrome', root: path.join(app, 'Google', 'Chrome') },
      { browser: 'Edge', root: path.join(app, 'Microsoft Edge') },
      { browser: 'Brave', root: path.join(app, 'BraveSoftware', 'Brave-Browser') },
      { browser: 'Arc', root: path.join(app, 'Arc', 'User Data') },
    ];
  }
  if (platform === 'win32') {
    const local = localData(home, platform);
    return [
      { browser: 'Chrome', root: path.join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'Edge', root: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'Brave', root: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      // Arc's Windows build is Chromium; this is the usual user-data directory.
      // The Browser Company does not publish a separate settings path.
      { browser: 'Arc', root: path.join(local, 'Arc', 'User Data') },
    ];
  }
  // Arc has no official Linux build, so it is not scanned here.
  return [
    { browser: 'Chrome', root: path.join(home, '.config', 'google-chrome') },
    { browser: 'Edge', root: path.join(home, '.config', 'microsoft-edge') },
    { browser: 'Brave', root: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser') },
  ];
}

function extensionProfiles(root) {
  if (!isDir(root)) return [];
  const profiles = [];
  const consider = (dir, name) => {
    const extensions = path.join(dir, 'Extensions');
    if (isDir(extensions)) profiles.push({ name, extensions });
  };
  consider(root, 'root');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return profiles; }
  for (const entry of entries) {
    if (profiles.length >= 20) break;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === 'Extensions' || entry.name === 'System Profile') continue;
    consider(path.join(root, entry.name), entry.name);
  }
  return profiles;
}

function discoverExtensions(home, platform) {
  const installs = [];
  const files = [];
  for (const browser of browserRoots(home, platform)) {
    const profiles = extensionProfiles(browser.root);
    if (!profiles.length) {
      files.push({ path: browser.root, scope: 'app', status: 'not_found', serverCount: 0, format: 'presence' });
      continue;
    }
    let count = 0;
    for (const extension of EXTENSIONS) {
      const profilesHit = [];
      for (const profile of profiles) {
        if (isDir(path.join(profile.extensions, extension.id))) profilesHit.push(profile.name);
      }
      if (!profilesHit.length) continue;
      count += 1;
      const slug = extension.product.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      installs.push({
        clientKey: `ext-${browser.browser.toLowerCase()}-${slug}`,
        source: 'browser-extension',
        agentName: `${extension.product} (${browser.browser})`,
        vendor: extension.vendor,
        agentType: 'ai_assistant',
        profiles: profilesHit,
      });
    }
    files.push({
      path: browser.root, scope: 'app', status: 'found', serverCount: count, format: 'presence',
    });
  }
  return { installs, files };
}

function macAppDirs(home) {
  const dirs = [path.join(home, 'Applications')];
  if (isRealHome(home)) dirs.push('/Applications', '/System/Applications');
  return dirs;
}

function windowsCandidates(home, platform, source) {
  const local = localData(home, platform);
  // Per-user installer directories. Microsoft Copilot's MSIX package path is
  // not stable, so only the per-user Programs folder is checked for it.
  const map = {
    'chatgpt-app': [path.join(local, 'Programs', 'ChatGPT', 'ChatGPT.exe')],
    'claude-app': [path.join(local, 'AnthropicClaude', 'claude.exe'), path.join(local, 'Programs', 'Claude', 'Claude.exe')],
    'copilot-app': [path.join(local, 'Programs', 'Copilot'), path.join(local, 'Programs', 'Microsoft Copilot')],
    'perplexity-app': [path.join(local, 'Programs', 'Perplexity', 'Perplexity.exe'), path.join(local, 'Perplexity', 'Perplexity.exe')],
    'ollama-app': [path.join(local, 'Programs', 'Ollama', 'Ollama.exe'), path.join(local, 'Programs', 'Ollama')],
  };
  return map[source] || [];
}

function linuxDesktopHit(home, tokens) {
  const dirs = [path.join(home, '.local', 'share', 'applications')];
  if (isRealHome(home)) dirs.push('/usr/share/applications', '/usr/local/share/applications');
  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of entries) {
      if (!name.endsWith('.desktop')) continue;
      const lower = name.toLowerCase();
      if (tokens.some(token => lower.includes(token))) return path.join(dir, name);
    }
  }
  return null;
}

const LINUX_TOKENS = Object.freeze({
  'chatgpt-app': ['chatgpt'],
  'claude-app': ['claude'],
  'copilot-app': ['copilot'],
  'perplexity-app': ['perplexity'],
  'ollama-app': ['ollama'],
});

function discoverApps(home, platform) {
  const clients = [];
  for (const app of MAC_APPS) {
    let found = null;
    if (platform === 'darwin') {
      for (const dir of macAppDirs(home)) {
        for (const bundle of app.bundles) {
          const candidate = path.join(dir, bundle);
          if (isDir(candidate)) { found = candidate; break; }
        }
        if (found) break;
      }
    } else if (platform === 'win32') {
      for (const candidate of windowsCandidates(home, platform, app.source)) {
        if (isFile(candidate) || isDir(candidate)) { found = candidate; break; }
      }
    } else {
      found = linuxDesktopHit(home, LINUX_TOKENS[app.source]);
      if (!found && app.source === 'ollama-app' && isDir(path.join(home, '.ollama'))) {
        // Ollama's documented model directory. Presence of the directory means
        // the daemon has been used; it is not by itself the GUI bundle.
        found = path.join(home, '.ollama');
      }
    }
    const expected = platform === 'darwin'
      ? path.join(home, 'Applications', app.bundles[0])
      : platform === 'win32'
        ? windowsCandidates(home, platform, app.source)[0]
        : path.join(home, '.local', 'share', 'applications');
    clients.push({
      clientKey: app.source,
      label: app.label,
      source: app.source,
      group: 'apps',
      presenceOnly: true,
      installed: Boolean(found),
      files: [{ path: found || expected, scope: 'app', status: found ? 'found' : 'not_found', serverCount: 0, format: 'presence' }],
      mergedServers: {},
      primaryPath: null,
    });
  }
  return clients;
}

function dotfileList(home, platform) {
  const files = [
    '.zshrc', '.zprofile', '.zshenv', '.bashrc', '.bash_profile', '.profile',
    '.config/fish/config.fish', '.env', '.aws/credentials',
  ].map(rel => ({ rel, file: path.join(home, ...rel.split('/')), ini: rel === '.aws/credentials' }));
  if (platform === 'win32') {
    const roamingDir = roaming(home, platform);
    files.push({ rel: 'AppData/Roaming/Block/goose/config/secrets.yaml', file: path.join(roamingDir, 'Block', 'goose', 'config', 'secrets.yaml'), ini: false });
  } else {
    files.push({ rel: '.config/goose/secrets.yaml', file: path.join(home, '.config', 'goose', 'secrets.yaml'), ini: false });
  }
  return files;
}

function insideHome(home, file) {
  let root;
  let resolved;
  try { root = fs.realpathSync(home); } catch (_) { return false; }
  try { resolved = fs.realpathSync(file); } catch (_) { return false; }
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Read credential NAMES from the environment and a fixed dotfile list.
 * `filesRead` receives paths that were actually opened. Values are not returned.
 */
function discoverCredentialNames(home, platform, filesRead) {
  const byName = new Map();
  const add = (name, where) => {
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(where);
  };
  for (const name of secrets.envKeyPresence()) add(name, 'environment');
  const files = [];
  for (const entry of dotfileList(home, platform)) {
    if (!isFile(entry.file)) {
      files.push({ path: entry.file, scope: 'user', status: 'not_found', serverCount: 0, format: 'text' });
      continue;
    }
    if (!insideHome(home, entry.file)) {
      files.push({ path: entry.file, scope: 'user', status: 'skipped', serverCount: 0, reason: 'outside the scan home', format: 'text' });
      continue;
    }
    let stat;
    try { stat = fs.statSync(entry.file); } catch (error) {
      files.push({ path: entry.file, scope: 'user', status: 'unreadable', serverCount: 0, reason: error.code === 'EACCES' ? 'permission denied' : 'unreadable', format: 'text' });
      if (filesRead) filesRead.add(entry.file);
      continue;
    }
    if (stat.size > 1_000_000) {
      files.push({ path: entry.file, scope: 'user', status: 'skipped', serverCount: 0, reason: 'larger than 1MB', format: 'text' });
      continue;
    }
    let text;
    try { text = fs.readFileSync(entry.file, 'utf8'); } catch (error) {
      files.push({ path: entry.file, scope: 'user', status: 'unreadable', serverCount: 0, reason: error.code === 'EACCES' ? 'permission denied' : 'unreadable', format: 'text' });
      if (filesRead) filesRead.add(entry.file);
      continue;
    }
    if (filesRead) filesRead.add(entry.file);
    const names = secrets.namesInText(text, { ini: entry.ini });
    const portable = `~/${entry.rel.split(path.sep).join('/')}`;
    for (const name of names) add(name, portable);
    files.push({ path: entry.file, scope: 'user', status: 'found', serverCount: names.length, format: 'text' });
  }
  const names = [...byName.entries()]
    .map(([name, wheres]) => ({ name, where: [...wheres].sort().join(', ') }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { names, files };
}

function discoverPresence(options, filesRead) {
  const { home, platform } = options;
  const apps = discoverApps(home, platform);
  const extensions = discoverExtensions(home, platform);
  const credentials = discoverCredentialNames(home, platform, filesRead);
  const browsers = {
    clientKey: 'browsers',
    label: 'Browser extensions',
    source: 'browser-extension',
    group: 'browsers',
    inventoryOnly: true,
    installs: extensions.installs,
    files: extensions.files,
    mergedServers: {},
    primaryPath: null,
  };
  const keys = {
    clientKey: 'provider-keys',
    label: 'Provider keys',
    source: 'provider-keys',
    group: 'provider-keys',
    presenceOnly: true,
    installed: credentials.names.length > 0,
    credentialNames: credentials.names,
    files: credentials.files,
    mergedServers: {},
    primaryPath: null,
  };
  return { clients: [...apps, browsers, keys] };
}

module.exports = { EXTENSIONS, discoverPresence, discoverExtensions, discoverApps, discoverCredentialNames, isRealHome };
