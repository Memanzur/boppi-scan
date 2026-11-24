/**
 * Local, reversible fixes for configuration risks the scanner can see.
 * Nothing here sends data. A backup set is written before the first change.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const scanner = require('../engine/localMcpScanner');
const { inferCapabilities } = require('./knownServers');
const parse = require('./discovery/parse');
const { isInlineSecret, isEnvSecret, isArgumentSecret, packageArgument, installerPackage, commandStem, unwrapLaunch, valueIsPresent, PROVIDER_KEY_NAMES } = require('./discovery/secrets');
const { createBackupSet, parseChoice, replaceRegularFile, chmodNoFollow } = require('./fix');

const PROVIDER_KEYS = new Set(PROVIDER_KEY_NAMES);
const CONFIRM_RULES = new Set(['BOPPI-UNKNOWN-SERVER', 'BOPPI-PLAINTEXT-SECRET']);

const SENSITIVE_NAME = /(token|secret|password|private[_-]?key|api[_-]?key|authorization|cookie|credential)/i;
const INSTALLERS = new Set(['npx', 'npm', 'uvx', 'uv', 'bunx', 'pnpm', 'pnpx', 'yarn']);
const NODE_PIN_COMMANDS = new Set(['npx', 'npm', 'bunx', 'pnpm', 'pnpx', 'yarn']);
const BROAD_TOOLS = new Set(['Bash', 'Bash(*)', 'PowerShell', 'PowerShell(*)', '*']);
const LOOSE_MODES = Object.freeze({
  bypassPermissions: 'default',
  dontAsk: 'default',
  acceptEdits: 'default',
});
const MODE_SEVERITY = Object.freeze({ bypassPermissions: 'high', dontAsk: 'high', acceptEdits: 'medium' });
const CONTENT_FORMATS = new Set(['json', 'jsonc', 'yaml', 'toml']);

const ENGINE_GUIDE = Object.freeze({
  'AE-001': {
    summary: 'Sensitive data can reach an external destination.',
    steps: [
      'Remove the external messaging or fetch server, or narrow the data this agent can read.',
      'Run boppi plan to compare edits, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-002': {
    summary: 'Code execution can reach credentials and the network.',
    steps: [
      'Remove shell or code execution, or remove the credential and network servers this agent does not need.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-003': {
    summary: 'An unverified MCP server sits on a path to sensitive data.',
    steps: [
      'Verify the server publisher and pin its package version, or disconnect it.',
      'Run boppi plan, then boppi fix --server <name> if you want that server removed.',
    ],
  },
  'AE-004': {
    summary: 'Source changes can reach production systems.',
    steps: [
      'Separate source modification from production credentials and deployment tools.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-005': {
    summary: 'Untrusted content can influence an agent that can send email.',
    steps: [
      'Require approval before outbound mail and remove browser or fetch access this agent does not need.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-006': {
    summary: 'Broad file access is granted to a vendor whose training posture is unknown.',
    steps: [
      'Narrow the filesystem server to one project directory, or confirm the vendor does not train on your files.',
      'The vendor policy cannot be changed from this machine.',
    ],
  },
  'AE-007': {
    summary: 'Untrusted content can reach shell and filesystem tools.',
    steps: [
      'Remove shell access or isolate the fetch and browser servers from it.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-008': {
    summary: 'One sensitive grant is present and no cross-boundary chain was evidenced.',
    steps: [
      'Keep the grant scoped to the directory or service the agent needs.',
      'Run boppi plan, then boppi fix --server <name> if you want that server removed.',
    ],
  },
  'AE-009': {
    summary: 'Command execution is combined with an outbound leg, untrusted content, or an approval bypass.',
    steps: [
      'Remove the shell or code server, turn prompting back on, or remove the outbound or untrusted server.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-010': {
    summary: 'Command execution still prompts, and no outbound or untrusted leg was evidenced.',
    steps: [
      'Remove shell or code execution the agent does not need.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-011': {
    summary: 'A database or SaaS read can reach fetch, a browser, messaging send, or a shell.',
    steps: [
      'Remove the outbound server, or remove the data server the agent does not need.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
  'AE-014': {
    summary: 'A database or SaaS read is combined with untrusted content or an approval bypass.',
    steps: [
      'Turn prompting back on, or remove the issue tracker or the data server the agent does not need.',
      'Run boppi plan, then boppi fix --server <name> for the one server you choose.',
    ],
  },
});

const PROVIDER_PAGES = Object.freeze([
  ['OPENAI_', 'https://platform.openai.com/api-keys'],
  ['ANTHROPIC_', 'https://console.anthropic.com/settings/keys'],
  ['GEMINI_', 'https://aistudio.google.com/app/apikey'],
  ['GOOGLE_', 'https://aistudio.google.com/app/apikey'],
  ['GROQ_', 'https://console.groq.com/keys'],
  ['MISTRAL_', 'https://console.mistral.ai/api-keys'],
  ['HF_', 'https://huggingface.co/settings/tokens'],
  ['HUGGING_FACE_', 'https://huggingface.co/settings/tokens'],
  ['AWS_', 'https://console.aws.amazon.com/iam/home#/security_credentials'],
]);

function displayPath(file, home) {
  const root = path.resolve(home);
  const resolved = path.resolve(file);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    return '~' + resolved.slice(root.length).split(path.sep).join('/');
  }
  return scanner.pathFingerprint(resolved);
}

function modeText(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

function providerPage(name) {
  const upper = String(name || '').toUpperCase();
  const hit = PROVIDER_PAGES.find(([prefix]) => upper.startsWith(prefix));
  return hit ? hit[1] : null;
}

function remediationForEngineFinding(finding) {
  const guide = ENGINE_GUIDE[finding.ruleId];
  const summary = guide ? guide.summary : (finding.recommendation || finding.title);
  const steps = guide ? guide.steps.slice() : [finding.recommendation || 'Review the configuration that produced this finding.'];
  return {
    summary,
    steps,
    autoFixable: false,
    fixId: `manual-${finding.ruleId}`,
  };
}

function toExportIssue(issue) {
  return {
    id: issue.fixId,
    fixId: issue.fixId,
    ruleId: issue.ruleId,
    severity: issue.severity,
    category: issue.category,
    tool: issue.tool,
    title: issue.title,
    file: issue.fileLabel || null,
    autoFixable: !!issue.autoFixable,
    remediation: {
      summary: issue.summary,
      steps: issue.steps,
      autoFixable: !!issue.autoFixable,
      fixId: issue.fixId,
    },
  };
}

function issue(fields) {
  return {
    autoFixable: false,
    steps: [],
    format: 'json',
    ...fields,
  };
}

function serverMaps(json, cwd) {
  const maps = [];
  const add = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) maps.push(value);
  };
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    add(json.mcpServers);
    add(json.servers);
    add(json.context_servers);
    if (json.mcp && typeof json.mcp === 'object') add(json.mcp.servers);
    const project = cwd && json.projects && json.projects[cwd];
    if (project && typeof project === 'object') add(project.mcpServers);
  }
  return maps;
}

function eachSpec(json, cwd, visit) {
  for (const map of serverMaps(json, cwd)) {
    for (const [name, spec] of Object.entries(map)) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
      visit(map, name, spec);
    }
  }
}

function catalogMatch(name, spec, home) {
  const normalized = parse.normalizeSpec(spec);
  const inference = inferCapabilities(name, normalized, { home });
  return inference.inferences.some(item => item.grade === 'allowlist' && item.label !== 'directory arguments' && item.label !== 'remote MCP server');
}

function commandBase(command) {
  return commandStem(command);
}

function isPinnedSpec(spec) {
  const eq = spec.lastIndexOf('==');
  if (eq > 0) return !/^(?:latest|next|\*|x)$/i.test(spec.slice(eq + 2));
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/');
    if (slash === -1) return false;
    return spec.slice(slash + 1).includes('@');
  }
  return spec.includes('@');
}

function isFloating(spec) {
  if (!isPinnedSpec(spec)) return true;
  return /@(latest|next|\*|x)$/i.test(spec);
}

function barePackageName(spec) {
  let text = String(spec).trim();
  text = text.replace(/==[^\s]+$/, '');
  if (text.startsWith('@')) {
    const slash = text.indexOf('/');
    if (slash === -1) return text;
    const at = text.indexOf('@', slash + 1);
    return at === -1 ? text : text.slice(0, at);
  }
  const at = text.lastIndexOf('@');
  return at > 0 ? text.slice(0, at) : text;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readJsonVersion(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json && typeof json.version === 'string' && EXACT_VERSION.test(json.version) ? json.version : null;
  } catch (_) {
    return null;
  }
}

/** Version already installed for this project. No registry lookup. */
function localPackageVersion(spec, cwd) {
  if (!cwd) return null;
  const name = barePackageName(spec);
  if (!name) return null;
  const installed = readJsonVersion(path.join(cwd, 'node_modules', name, 'package.json'));
  if (installed) return installed;
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));
    const entry = lock && lock.packages && lock.packages[`node_modules/${name}`];
    if (entry && typeof entry.version === 'string' && EXACT_VERSION.test(entry.version)) return entry.version;
  } catch (_) { /* no lockfile */ }
  return null;
}

function pinnedPackageSpec(spec, version) {
  return `${barePackageName(spec)}@${version}`;
}

function pinToken(chosen, version) {
  const pinned = pinnedPackageSpec(chosen.spec, version);
  if (chosen.token.startsWith('-') && chosen.token.includes('=')) {
    return `${chosen.token.slice(0, chosen.token.indexOf('='))}=${pinned}`;
  }
  return pinned;
}

function hasSecretArgument(spec) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  const skip = packageArgument(spec);
  let skipped = false;
  return args.some(arg => {
    if (!skipped && skip != null && arg === skip) {
      skipped = true;
      return false;
    }
    return isArgumentSecret(arg);
  });
}

function isBroadPath(arg, home) {
  if (typeof arg !== 'string') return false;
  const trimmed = arg.trim();
  if (trimmed === '/' || trimmed === '~' || trimmed === '~/' || trimmed === '/*') return true;
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return true;
  if (!home) return false;
  const root = path.resolve(home);
  if (trimmed === root || trimmed === `${root}/` || trimmed === `${root}\\`) return true;
  if (!/^(\/|~\/|[A-Za-z]:[\\/])/.test(trimmed)) return false;
  try {
    const expanded = trimmed.startsWith('~/') ? path.join(home, trimmed.slice(2)) : trimmed;
    const real = fs.realpathSync(expanded);
    const realHome = fs.realpathSync(home);
    if (real === realHome) return true;
    if (real === path.parse(real).root) return true;
  } catch (_) { /* a path that does not exist is not a live symlink to the disk root */ }
  return false;
}

function narrowerRoot(home, cwd) {
  if (!cwd || !home) return null;
  let root;
  let dir;
  try {
    root = fs.realpathSync(home);
    dir = fs.realpathSync(cwd);
  } catch (_) { return null; }
  // macOS prefixes /tmp and /var with /private. Compare real paths, then keep
  // the path the caller passed so a symlink to / is rejected and a normal
  // working directory is written the way the caller named it.
  if (dir === root || dir === path.parse(dir).root) return null;
  if (!dir.startsWith(root + path.sep)) return null;
  return path.resolve(cwd);
}

function readJson(file, format) {
  const text = fs.readFileSync(file, 'utf8');
  if (format === 'jsonc') return parse.parseJsonc(text);
  return JSON.parse(text);
}

function allowLists(json) {
  const lists = [];
  if (json && json.permissions && Array.isArray(json.permissions.allow)) lists.push(json.permissions.allow);
  if (json && Array.isArray(json.allowedTools)) lists.push(json.allowedTools);
  return lists;
}

function pushIssue(list, seen, item) {
  if (!item || seen.has(item.fixId)) return;
  seen.add(item.fixId);
  list.push(item);
}

function collectFromJsonServers(list, seen, { json, file, fileLabel, tool, home, cwd, editable }) {
  eachSpec(json, cwd, (map, name, spec) => {
    if (spec.disabled === true || spec.enabled === false) return;
    const where = `${fileLabel}:${name}`;
    if (Array.isArray(spec.autoApprove) && spec.autoApprove.length) {
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-AUTO-APPROVE',
        fixId: `auto-approve:${where}`,
        severity: 'medium',
        category: 'auto_approve',
        tool,
        title: `${tool} auto-approves tools on the ${name} server.`,
        summary: `Clear the autoApprove list on ${name} so each tool call asks first.`,
        steps: [
          `Open ${fileLabel} and remove the autoApprove list on the ${name} server.`,
          'The server stays configured. Only the automatic approval is removed.',
        ],
        autoFixable: editable,
        file,
        fileLabel,
        format: 'json',
        server: name,
      }));
    }
    if (spec.env && typeof spec.env === 'object' && !Array.isArray(spec.env)) {
      for (const [key, value] of Object.entries(spec.env)) {
        if (typeof value !== 'string' || !valueIsPresent(value)) continue;
        const exactKey = PROVIDER_KEYS.has(key);
        const valueSecret = isEnvSecret(value);
        if (!exactKey && !valueSecret && !SENSITIVE_NAME.test(key)) continue;
        const page = providerPage(key);
        const auto = exactKey || valueSecret;
        pushIssue(list, seen, issue({
          ruleId: 'BOPPI-PLAINTEXT-SECRET',
          fixId: `plaintext-secret:${where}:${key}`,
          severity: auto ? 'critical' : 'medium',
          category: 'plaintext_secret',
          tool,
          title: auto
            ? `An API key is stored in plaintext in the ${name} server config (${key}).`
            : `${key} in the ${name} server config looks sensitive by name. The value is not printed.`,
          summary: auto
            ? `Delete ${key} from the ${name} server env block. The value is not printed. --yes will not do this.`
            : `${key} is left in place. The name looks sensitive, but the value does not look like a token, so boppi will not delete it.`,
          steps: [
            page
              ? `Revoke this key at ${page} and create a new one if it is a real credential.`
              : `Revoke ${key} in the provider console if it is a real credential.`,
            'Store a new value in an environment variable or the OS keychain, not in the config file.',
            auto
              ? `Confirm the local fix to delete ${key} from ${fileLabel}. --yes will not delete it.`
              : `Edit ${fileLabel} yourself if this value is a password. Boppi will not delete it.`,
          ],
          autoFixable: editable && auto,
          file,
          fileLabel,
          format: 'json',
          server: name,
          detail: { kind: 'env', name: key },
        }));
      }
    }
    if (spec.headers && typeof spec.headers === 'object' && !Array.isArray(spec.headers)) {
      for (const [key, value] of Object.entries(spec.headers)) {
        if (typeof value !== 'string' || !valueIsPresent(value)) continue;
        const exactKey = PROVIDER_KEYS.has(key);
        const valueSecret = isInlineSecret(value);
        if (!exactKey && !valueSecret && !SENSITIVE_NAME.test(key)) continue;
        const auto = exactKey || valueSecret;
        pushIssue(list, seen, issue({
          ruleId: 'BOPPI-PLAINTEXT-SECRET',
          fixId: `plaintext-secret:${where}:header:${key}`,
          severity: auto ? 'critical' : 'medium',
          category: 'plaintext_secret',
          tool,
          title: auto
            ? `A secret header is stored in plaintext on the ${name} server (${key}).`
            : `The ${key} header on the ${name} server looks sensitive by name. The value is not printed.`,
          summary: auto
            ? `Delete the ${key} header from the ${name} server. The value is not printed. --yes will not do this.`
            : `The ${key} header is left in place. The name looks sensitive, but the value does not look like a token.`,
          steps: [
            `Revoke the credential in the ${key} header if it is a real credential.`,
            'Pass a new value through an environment variable the server reads, not through the config file.',
            auto
              ? `Confirm the local fix to delete the ${key} header from ${fileLabel}. --yes will not delete it.`
              : `Edit ${fileLabel} yourself if this value is a password. Boppi will not delete it.`,
          ],
          autoFixable: editable && auto,
          file,
          fileLabel,
          format: 'json',
          server: name,
          detail: { kind: 'header', name: key },
        }));
      }
    }
    if (hasSecretArgument(spec)) {
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-PLAINTEXT-SECRET',
        fixId: `plaintext-secret:${where}:argument`,
        severity: 'critical',
        category: 'plaintext_secret',
        tool,
        title: `A secret is stored in an argument of the ${name} server.`,
        summary: `Remove secret arguments from the ${name} server. The values are not printed.`,
        steps: [
          'Revoke the leaked credential at the provider and create a new one.',
          'Pass the new value through an environment variable, not as a command argument.',
          `The local fix removes the secret argument from ${fileLabel}.`,
        ],
        autoFixable: editable,
        file,
        fileLabel,
        format: 'json',
        server: name,
        detail: { kind: 'arg' },
      }));
    }
    const known = catalogMatch(name, spec, home);
    const argList = Array.isArray(spec.args) ? spec.args : [];
    const launch = unwrapLaunch(spec.command, argList);
    const base = launch.ambiguous ? '' : commandBase(launch.command);
    const chosen = INSTALLERS.has(base) ? installerPackage(launch.command, launch.args) : null;
    const floating = chosen && !chosen.ambiguous && isFloating(chosen.spec) ? chosen.spec : null;
    if (chosen && chosen.ambiguous) {
      const shown = (chosen.candidates || []).filter(Boolean).join(' or ') || 'more than one package';
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-UNPINNED-PACKAGE',
        fixId: `unpinned-package:${where}`,
        severity: 'medium',
        category: 'unpinned_package',
        tool,
        title: `The ${name} server's installer flags do not identify one package (${shown}).`,
        summary: `Boppi will not rewrite this command. The package it would pin is not the package ${base} will launch.`,
        steps: [
          `Edit ${fileLabel} so the package ${base} runs is written as one exact version.`,
          'Boppi does not guess which token is the package when a flag could take the next token as a value.',
        ],
        autoFixable: false,
        file,
        fileLabel,
        format: 'json',
        server: name,
        detail: { autoYes: false, spec: null, pinned: null, ambiguous: true },
      }));
    } else if (!known) {
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-UNKNOWN-SERVER',
        fixId: `unknown-server:${where}`,
        severity: 'high',
        category: 'unknown_server',
        tool,
        title: `The ${name} server is not a known MCP server.`,
        summary: `Remove the ${name} entry so ${tool} stops loading it. --yes will not do this. Restore a removal with boppi fix --undo.`,
        steps: [
          `Confirm you trust ${name}. If you do not, delete that entry from ${fileLabel}.`,
          'If you keep it, pin the package to a version you have reviewed and record who publishes it.',
        ],
        autoFixable: editable,
        file,
        fileLabel,
        format: 'json',
        server: name,
      }));
    } else if (floating) {
      const autoYes = argList.some(arg => arg === '-y' || arg === '--yes');
      const floatingTag = /(?:@|==)(latest|next|\*|x)$/i.test(floating);
      const version = NODE_PIN_COMMANDS.has(base) ? localPackageVersion(floating, cwd) : null;
      const pinned = version ? pinToken(chosen, version) : null;
      // Removing -y does not pin the package. Report that case only while -y
      // or a floating tag is still present, and pin when this project already
      // has an exact version on disk.
      if (pinned || autoYes || floatingTag) {
        pushIssue(list, seen, issue({
          ruleId: 'BOPPI-UNPINNED-PACKAGE',
          fixId: `unpinned-package:${where}`,
          severity: 'medium',
          category: 'unpinned_package',
          tool,
          title: pinned
            ? `The ${name} server runs an unpinned package (${floating}).`
            : autoYes
              ? `The ${name} server installs an unpinned package with ${base} -y.`
              : `The ${name} server runs an unpinned package (${floating}).`,
          summary: pinned
            ? `Pin ${floating} to ${pinned} in the ${name} server.`
            : autoYes
              ? `Remove -y from the ${name} server so ${base} does not install the latest package without a prompt.`
              : `Pin ${floating} to an exact version you have reviewed. Boppi will not guess a version.`,
          steps: pinned
            ? [
              `The local fix replaces ${floating} with ${pinned} and removes -y and --yes.`,
              'The version is the one installed in this project. Boppi does not contact a package registry.',
            ]
            : [
              `Edit ${fileLabel} and change ${floating} to ${barePackageName(floating)}@<version> after you check the release.`,
              autoYes
                ? `The local fix removes -y and --yes from the ${name} server.`
                : 'There is no local version to pin to, and Boppi does not contact a package registry.',
            ],
          autoFixable: editable && !!(pinned || autoYes),
          file,
          fileLabel,
          format: 'json',
          server: name,
          detail: { autoYes, spec: chosen.token, pinned },
        }));
      }
    }
    if (Array.isArray(spec.args) && spec.args.some(arg => isBroadPath(arg, home))) {
      const replacement = narrowerRoot(home, cwd);
      const disk = spec.args.some(arg => arg === '/' || /^[A-Za-z]:\\?$/.test(String(arg).trim()));
      const whereText = disk ? 'the whole disk' : 'the home folder';
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-BROAD-FILESYSTEM',
        fixId: `broad-filesystem:${where}`,
        severity: 'high',
        category: 'broad_permission',
        tool,
        title: `The ${name} server can read ${whereText}.`,
        summary: replacement
          ? `Point the ${name} server at the current working directory instead of ${whereText}.`
          : `Limit the ${name} server to one project directory. The current directory is the home folder, so Boppi will not guess a narrower path.`,
        steps: [
          `Edit ${fileLabel} and replace the ${name} server path with one project directory.`,
          'Do not grant / or the home folder to a filesystem server.',
        ],
        autoFixable: editable && !!replacement,
        file,
        fileLabel,
        format: 'json',
        server: name,
        detail: { replacement },
      }));
    }
  });
}

function collectClaudeSettings(list, seen, settings, home) {
  for (const item of settings || []) {
    if (!item || !item.file || item.unreadable) continue;
    let json;
    try { json = JSON.parse(fs.readFileSync(item.file, 'utf8')); } catch (_) { continue; }
    const fileLabel = displayPath(item.file, home);
    const mode = item.mode && LOOSE_MODES[item.mode];
    if (mode) {
      const loose = item.mode === 'bypassPermissions'
        ? 'bypass permission prompts'
        : item.mode === 'dontAsk'
          ? 'not ask before tools run'
          : 'accept edits without a prompt';
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-PERM-MODE',
        fixId: `perm-mode:${fileLabel}`,
        severity: MODE_SEVERITY[item.mode] || 'high',
        category: 'yolo_mode',
        tool: 'Claude Code',
        title: `Claude Code is set to ${loose}.`,
        summary: `Set permissions.defaultMode from ${item.mode} to default in ${fileLabel}.`,
        steps: [
          `Open ${fileLabel} and set permissions.defaultMode to "default".`,
          'Claude Code will ask before tools run.',
        ],
        autoFixable: true,
        file: item.file,
        fileLabel,
        format: 'json',
        detail: { from: item.mode, to: 'default' },
      }));
    }
    const broad = allowLists(json).some(list => list.some(rule => typeof rule === 'string' && BROAD_TOOLS.has(rule.trim())));
    if (broad || item.unscopedShell) {
      pushIssue(list, seen, issue({
        ruleId: 'BOPPI-UNSCOPED-SHELL',
        fixId: `unscoped-shell:${fileLabel}`,
        severity: 'medium',
        category: 'broad_permission',
        tool: 'Claude Code',
        title: 'Claude Code allows a shell with no command restriction.',
        summary: `Remove unrestricted Bash, PowerShell, and * entries from the allow list in ${fileLabel}.`,
        steps: [
          `Open ${fileLabel} and delete allow rules that are exactly Bash, PowerShell, or *.`,
          'Keep rules that name a specific command if you still want those.',
        ],
        autoFixable: true,
        file: item.file,
        fileLabel,
        format: 'json',
      }));
    }
  }
}

function collectYoloToml(list, seen, { file, fileLabel, tool, text }) {
  const keys = [
    ['approval_policy', 'never', 'on-request', 'Codex CLI is set to approve every command without asking.', 'Set approval_policy from never to on-request.'],
    ['sandbox_mode', 'danger-full-access', 'workspace-write', 'Codex CLI sandbox is set to full access.', 'Set sandbox_mode from danger-full-access to workspace-write.'],
  ];
  for (const [key, from, to, title, summary] of keys) {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*["']?${from}["']?\\s*$`, 'm');
    if (!re.test(text)) continue;
    pushIssue(list, seen, issue({
      ruleId: 'BOPPI-YOLO-MODE',
      fixId: `yolo-mode:${fileLabel}:${key}`,
      severity: 'high',
      category: 'yolo_mode',
      tool,
      title,
      summary,
      steps: [
        `Open ${fileLabel} and set ${key} to "${to}".`,
        'The previous value lets the agent act without a prompt.',
      ],
      autoFixable: true,
      file,
      fileLabel,
      format: 'toml',
      detail: { key, from, to },
    }));
  }
}

function collectCredentialNames(list, seen, credentialNames) {
  for (const entry of credentialNames || []) {
    if (!entry || !entry.name) continue;
    const page = providerPage(entry.name);
    const where = entry.where || 'the environment';
    pushIssue(list, seen, issue({
      ruleId: 'BOPPI-ROTATE-KEY',
      fixId: `rotate-key:${entry.name}:${where}`,
      severity: 'high',
      category: 'leaked_key',
      tool: 'Provider keys',
      title: `${entry.name} is present in ${where}.`,
      summary: `${entry.name} was found by name only. Rotating it has to be done at the provider.`,
      steps: [
        page
          ? `Open ${page}, revoke the current ${entry.name}, and create a replacement.`
          : `Open the provider that issued ${entry.name}, revoke the current key, and create a replacement.`,
        'Store the new value in the OS keychain or a secret manager.',
        `Remove the old assignment from ${where}. Boppi does not edit shell profiles.`,
      ],
      autoFixable: false,
      file: null,
      fileLabel: null,
      format: null,
    }));
  }
}

function collectIssues({ home, cwd, discovery, claudeSettings, credentialNames }) {
  const list = [];
  const seen = new Set();
  for (const client of (discovery && discovery.clients) || []) {
    for (const file of client.files || []) {
      if (file.status !== 'found' || !file.path) continue;
      if (file.format === 'text' || file.format === 'presence') continue;
      let stat;
      try { stat = fs.lstatSync(file.path); } catch (_) { continue; }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const fileLabel = displayPath(file.path, home);
      const mode = stat.mode & 0o777;
      if ((mode & 0o007) !== 0 && CONTENT_FORMATS.has(file.format || 'json')) {
        pushIssue(list, seen, issue({
          ruleId: 'BOPPI-WORLD-READABLE',
          fixId: `world-readable:${fileLabel}`,
          severity: 'high',
          category: 'file_mode',
          tool: client.label,
          title: `The ${client.label} config file is readable by every user on this machine.`,
          summary: `Set ${fileLabel} to mode 600 so only the owner can read it.`,
          steps: [
            `The file mode is ${modeText(mode)}. Other accounts on this machine can read it.`,
            `The local fix runs chmod 600 on ${fileLabel}.`,
          ],
          autoFixable: true,
          file: file.path,
          fileLabel,
          format: file.format || 'json',
          detail: { from: mode, to: 0o600 },
        }));
      }
      if ((file.format || 'json') === 'json' || file.format === 'jsonc') {
        let json;
        try { json = readJson(file.path, file.format || 'json'); } catch (_) { continue; }
        collectFromJsonServers(list, seen, {
          json,
          file: file.path,
          fileLabel,
          tool: client.label,
          home,
          cwd,
          editable: (file.format || 'json') === 'json',
        });
      } else if (file.format === 'toml' && client.clientKey === 'codex') {
        let text = '';
        try { text = fs.readFileSync(file.path, 'utf8'); } catch (_) { continue; }
        collectYoloToml(list, seen, { file: file.path, fileLabel, tool: client.label, text });
      }
    }
  }
  collectClaudeSettings(list, seen, claudeSettings, home);
  for (const item of claudeSettings || []) {
    if (!item || !item.file || item.unreadable) continue;
    let stat;
    try { stat = fs.lstatSync(item.file); } catch (_) { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const mode = stat.mode & 0o777;
    if ((mode & 0o007) === 0) continue;
    const fileLabel = displayPath(item.file, home);
    pushIssue(list, seen, issue({
      ruleId: 'BOPPI-WORLD-READABLE',
      fixId: `world-readable:${fileLabel}`,
      severity: 'high',
      category: 'file_mode',
      tool: 'Claude Code',
      title: 'The Claude Code settings file is readable by every user on this machine.',
      summary: `Set ${fileLabel} to mode 600 so only the owner can read it.`,
      steps: [
        `The file mode is ${modeText(mode)}. Other accounts on this machine can read it.`,
        `The local fix runs chmod 600 on ${fileLabel}.`,
      ],
      autoFixable: true,
      file: item.file,
      fileLabel,
      format: 'json',
      detail: { from: mode, to: 0o600 },
    }));
  }
  collectCredentialNames(list, seen, credentialNames);
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  list.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0) || a.fixId.localeCompare(b.fixId));
  return list;
}

function replaceAssignment(text, key, from, to) {
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)(["']?)${from}\\2\\s*$`);
  return text.split('\n').map(line => {
    const cr = line.endsWith('\r');
    const bare = cr ? line.slice(0, -1) : line;
    const next = bare.replace(re, `$1$2${to}$2`);
    return cr ? `${next}\r` : next;
  }).join('\n');
}

function mutate(issueItem, state, cwd) {
  if (issueItem.ruleId === 'BOPPI-WORLD-READABLE') {
    state.mode = 0o600;
    return;
  }
  if (issueItem.ruleId === 'BOPPI-YOLO-MODE') {
    const { key, from, to } = issueItem.detail;
    state.text = replaceAssignment(state.text, key, from, to);
    return;
  }
  if (!state.json) return;
  state.jsonDirty = true;
  if (issueItem.ruleId === 'BOPPI-PERM-MODE') {
    if (!state.json.permissions || typeof state.json.permissions !== 'object') state.json.permissions = {};
    state.json.permissions.defaultMode = 'default';
    return;
  }
  if (issueItem.ruleId === 'BOPPI-UNSCOPED-SHELL') {
    for (const list of allowLists(state.json)) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (typeof list[i] === 'string' && BROAD_TOOLS.has(list[i].trim())) list.splice(i, 1);
      }
    }
    return;
  }
  eachSpec(state.json, cwd, (map, name, spec) => {
    if (name !== issueItem.server) return;
    if (issueItem.ruleId === 'BOPPI-AUTO-APPROVE') spec.autoApprove = [];
    else if (issueItem.ruleId === 'BOPPI-PLAINTEXT-SECRET' && issueItem.detail.kind === 'env' && spec.env) delete spec.env[issueItem.detail.name];
    else if (issueItem.ruleId === 'BOPPI-PLAINTEXT-SECRET' && issueItem.detail.kind === 'header' && spec.headers) delete spec.headers[issueItem.detail.name];
    else if (issueItem.ruleId === 'BOPPI-PLAINTEXT-SECRET' && issueItem.detail.kind === 'arg' && Array.isArray(spec.args)) {
      const skip = packageArgument(spec);
      let skipped = false;
      spec.args = spec.args.filter(arg => {
        if (!skipped && skip != null && arg === skip) {
          skipped = true;
          return true;
        }
        return !isArgumentSecret(arg);
      });
    } else if (issueItem.ruleId === 'BOPPI-UNKNOWN-SERVER') delete map[name];
    else if (issueItem.ruleId === 'BOPPI-UNPINNED-PACKAGE' && Array.isArray(spec.args)) {
      const from = issueItem.detail && issueItem.detail.spec;
      const pinned = issueItem.detail && issueItem.detail.pinned;
      spec.args = spec.args
        .filter(arg => arg !== '-y' && arg !== '--yes')
        .map(arg => (pinned && from && arg === from ? pinned : arg));
    } else if (issueItem.ruleId === 'BOPPI-BROAD-FILESYSTEM' && issueItem.detail.replacement && Array.isArray(spec.args)) {
      spec.args = spec.args.map(arg => (isBroadPath(arg, state.home) ? issueItem.detail.replacement : arg));
    }
  });
}

function loadState(file, home) {
  const text = fs.readFileSync(file, 'utf8');
  const mode = fs.statSync(file).mode & 0o777;
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return { file, text, originalText: text, json, mode, originalMode: mode, home };
}

function materialize(state) {
  if (state.jsonDirty) state.text = JSON.stringify(state.json, null, 2) + '\n';
  return state;
}

function diffLines(issueItem) {
  if (issueItem.ruleId === 'BOPPI-WORLD-READABLE') {
    return [`- mode ${modeText(issueItem.detail.from)}`, `+ mode ${modeText(issueItem.detail.to)}`];
  }
  if (issueItem.ruleId === 'BOPPI-PERM-MODE') {
    return [`- "defaultMode": "${issueItem.detail.from}"`, `+ "defaultMode": "${issueItem.detail.to}"`];
  }
  if (issueItem.ruleId === 'BOPPI-UNSCOPED-SHELL') {
    return ['- "Bash" / "PowerShell" / "*"', '+ removed from the allow list'];
  }
  if (issueItem.ruleId === 'BOPPI-AUTO-APPROVE') {
    return [`- "autoApprove": [ ... ] on ${issueItem.server}`, '+ "autoApprove": []'];
  }
  if (issueItem.ruleId === 'BOPPI-PLAINTEXT-SECRET') {
    const label = issueItem.detail && issueItem.detail.name ? issueItem.detail.name : 'argument';
    return [`- "${label}": "[redacted]"`, '+ removed'];
  }
  if (issueItem.ruleId === 'BOPPI-UNKNOWN-SERVER') {
    return [`- "${issueItem.server}": { ... }`, '+ removed'];
  }
  if (issueItem.ruleId === 'BOPPI-UNPINNED-PACKAGE') {
    const detail = issueItem.detail || {};
    if (detail.pinned) {
      const lines = [`- "${detail.spec}"`, `+ "${detail.pinned}"`];
      if (detail.autoYes) lines.push('- "-y"', '+ removed');
      return lines;
    }
    return ['- "-y"', '+ removed'];
  }
  if (issueItem.ruleId === 'BOPPI-BROAD-FILESYSTEM') {
    return ['- path: home folder or /', '+ path: current working directory'];
  }
  if (issueItem.ruleId === 'BOPPI-YOLO-MODE') {
    return [`- ${issueItem.detail.key} = "${issueItem.detail.from}"`, `+ ${issueItem.detail.key} = "${issueItem.detail.to}"`];
  }
  return [];
}

function renderIssue(issueItem, index) {
  const lines = [];
  lines.push(`${index}. ${issueItem.title}`);
  lines.push(`   ${issueItem.severity.toUpperCase()}  ${issueItem.ruleId}  ${issueItem.tool}`);
  if (issueItem.file) lines.push(`   file: ${issueItem.file}`);
  lines.push(`   ${issueItem.summary}`);
  if (issueItem.autoFixable) {
    for (const line of diffLines(issueItem)) lines.push(`   ${line}`);
  } else {
    lines.push('   manual steps:');
    issueItem.steps.forEach((step, stepIndex) => lines.push(`   ${stepIndex + 1}. ${step}`));
  }
  return lines.join('\n');
}

async function chooseFixes(fixes, ask) {
  const chosen = [];
  let all = false;
  for (const fix of fixes) {
    if (all) {
      chosen.push(fix);
      continue;
    }
    const choice = parseChoice(await ask(fix));
    if (choice === 'all') {
      all = true;
      chosen.push(fix);
    } else if (choice === 'yes') chosen.push(fix);
  }
  return chosen;
}

function applyIssues(issues, { home, cwd, now }) {
  const states = new Map();
  const stateFor = (file) => {
    if (!states.has(file)) states.set(file, loadState(file, home));
    return states.get(file);
  };
  for (const item of issues) {
    if (!item.file) continue;
    mutate(item, stateFor(item.file), cwd);
  }
  const pending = [];
  for (const state of states.values()) {
    materialize(state);
    const contentChanged = state.text !== state.originalText;
    const modeChanged = state.mode !== state.originalMode;
    if (!contentChanged && !modeChanged) continue;
    pending.push({ state, contentChanged, modeChanged });
  }
  const set = createBackupSet(home, now);
  for (const item of pending) set.capture(item.state.file);
  const manifest = pending.length ? set.commit() : null;
  const written = [];
  try {
    for (const item of pending) {
      if (item.contentChanged) {
        replaceRegularFile(item.state.file, item.state.text, item.modeChanged ? item.state.mode : item.state.originalMode);
      } else if (item.modeChanged) chmodNoFollow(item.state.file, item.state.mode);
      written.push(item.state.file);
    }
  } catch (error) {
    if (written.length) error.message = `${error.message}. ${written.length} file(s) were already changed. Restore them with boppi fix --undo.`;
    throw error;
  }
  return { written, manifest };
}

function needsConfirmation(item) {
  return !!(item && CONFIRM_RULES.has(item.ruleId));
}

function autoFixCount(issues) {
  return (issues || []).filter(item => item.autoFixable).length;
}

module.exports = {
  collectIssues,
  remediationForEngineFinding,
  toExportIssue,
  chooseFixes,
  applyIssues,
  renderIssue,
  diffLines,
  autoFixCount,
  parseChoice,
  needsConfirmation,
};
