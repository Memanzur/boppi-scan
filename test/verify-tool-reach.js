#!/usr/bin/env node
/** Verify suite for per-tool reach and filesystem scope: tool names and directory arguments map to the engine's finer categories, labels never carry a path, and the resulting paths are the ones a human would expect. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const toolCategories = require('../src/cli/toolCategories');
const { inferCapabilities } = require('../src/cli/knownServers');
const graphData = require('../src/cli/render/graphData');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8', env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin' } });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
function writeDesktop(home, servers) {
  const file = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }));
}
function categories(reach) { return reach.map(r => r.category).sort(); }

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-tool-reach-'));
  const home = path.join(root, 'home');
  const repo = path.join(home, 'work', 'app');
  const notes = path.join(home, 'Documents', 'notes');
  const ssh = path.join(home, '.ssh');
  for (const dir of [repo, notes, ssh, path.join(home, 'Desktop', 'photos')]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'));

  section('Tool categories');
  const github = toolCategories.toolReach([{ tool: 'push_files', basis: 'catalog' }, { tool: 'get_file_contents', basis: 'catalog' }, { tool: 'create_issue', basis: 'catalog' }, { tool: 'list_issues', basis: 'catalog' }], 'github npx @modelcontextprotocol/server-github');
  ok('GitHub push, read, and comment tools map to modify, read, and message categories', JSON.stringify(categories(github)) === JSON.stringify(['modify_source_code', 'read_source_code', 'send_external_message']));
  ok('each reach entry keeps the tool names behind it', github.find(r => r.category === 'modify_source_code').tools.join() === 'push_files' && github.every(r => r.basis === 'catalog'));
  ok('a tool the table does not list falls through name rules', toolCategories.toolReach([{ tool: 'kubectl_apply_manifest', basis: 'configured' }], '').map(r => `${r.category}:${r.basis}`).join() === 'access_production_system:configured');
  ok('read-only cluster tools reach no production system', toolCategories.toolReach([{ tool: 'kubectl_get', basis: 'configured' }, { tool: 'kubectl_describe', basis: 'configured' }, { tool: 'kubectl_logs', basis: 'configured' }, { tool: 'helm_list', basis: 'configured' }, { tool: 'terraform_plan', basis: 'configured' }], 'dev-reader node ./reader.js').length === 0);
  const applyReach = toolCategories.toolReach([{ tool: 'kubectl_apply', basis: 'configured' }], 'k8s-tool');
  ok('a cluster-changing tool reaches a production system with write access and an unknown environment', applyReach.length === 1 && applyReach[0].writeAccess === true && applyReach[0].environment === 'unknown');
  ok('the environment is graded only from an explicit word in the config', toolCategories.environmentOf('prod-cluster npx mcp-server-kubernetes') === 'production' && toolCategories.environmentOf('staging-k8s npx mcp-server-kubernetes') === 'non_production' && toolCategories.environmentOf('kubernetes npx mcp-server-kubernetes') === 'unknown' && toolCategories.environmentOf('productivity-tool') === 'unknown');
  ok('a configured tool outranks catalog basis for the same category', toolCategories.toolReach([{ tool: 'push_files', basis: 'catalog' }, { tool: 'commit_changes', basis: 'configured' }], '').find(r => r.category === 'modify_source_code').basis === 'configured');
  ok('email tool names map to read and send email', JSON.stringify(categories(toolCategories.toolReach([{ tool: 'send_email', basis: 'configured' }, { tool: 'list_messages', basis: 'configured' }], ''))) === JSON.stringify(['read_email', 'send_email']));
  ok('a gmail identity grants read and send email with no tool list', JSON.stringify(categories(toolCategories.toolReach([], 'gmail npx @gongrzhe/server-gmail-autoauth-mcp'))) === JSON.stringify(['read_email', 'send_email']));
  ok('an smtp identity grants send email only', JSON.stringify(categories(toolCategories.toolReach([], 'mailer uvx smtp-mcp-server'))) === JSON.stringify(['send_email']));
  ok('unrelated tools and names reach nothing', toolCategories.toolReach([{ tool: 'get_current_time', basis: 'catalog' }], 'time uvx mcp-server-time').length === 0);

  section('Filesystem scope');
  ok('the home directory itself grades home', toolCategories.scopeOf(home, home) === 'home');
  ok('a parent of home and well-known roots grade system', toolCategories.scopeOf(root, home) === 'system' && toolCategories.scopeOf('/', home) === 'system' && toolCategories.scopeOf('/etc', home) === 'system');
  ok('dotfile and secret folders grade secrets', toolCategories.scopeOf(ssh, home) === 'secrets' && toolCategories.scopeOf(path.join(home, 'projects', 'credentials'), home) === 'secrets');
  ok('a folder with a .git marker grades source', toolCategories.scopeOf(repo, home) === 'source');
  ok('an ordinary folder grades other', toolCategories.scopeOf(notes, home) === 'other');
  const mixed = toolCategories.filesystemScope([notes, ssh, repo], home);
  ok('a mixed list is ordered worst first with a joined label', mixed.worst === 'secrets' && mixed.grades.join() === 'secrets,source,other' && mixed.label === 'a dotfile or secrets folder and a source tree and a folder elsewhere');
  ok('no directories means no scope', toolCategories.filesystemScope([], home) === null);
  ok('labels never contain a path', Object.values(toolCategories.SCOPE_LABEL).every(label => !label.includes('/') && !label.includes(home)));
  const writeTools = [{ tool: 'read_file', basis: 'catalog' }, { tool: 'write_file', basis: 'catalog' }];
  ok('home scope with write tools reaches credentials, read source, and modify source', JSON.stringify(categories(toolCategories.scopeReach(toolCategories.filesystemScope([home], home), writeTools))) === JSON.stringify(['access_credentials', 'modify_source_code', 'read_source_code']));
  ok('a source tree with read-only tools reaches read source only', JSON.stringify(categories(toolCategories.scopeReach(toolCategories.filesystemScope([repo], home), [{ tool: 'read_file', basis: 'catalog' }]))) === JSON.stringify(['read_source_code']));
  ok('a secrets folder reaches credentials only', JSON.stringify(categories(toolCategories.scopeReach(toolCategories.filesystemScope([ssh], home), writeTools))) === JSON.stringify(['access_credentials']));
  ok('a folder elsewhere reaches nothing extra', toolCategories.scopeReach(toolCategories.filesystemScope([notes], home), writeTools).length === 0);

  section('Inference');
  const inferred = inferCapabilities('home-files', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] }, { home });
  ok('inferCapabilities returns the scope and the reach', inferred.filesystemScope && inferred.filesystemScope.worst === 'home' && categories(inferred.reach).join() === 'access_credentials,modify_source_code,read_source_code');
  ok('the inference output carries no raw path outside filesystemPaths', !JSON.stringify({ ...inferred, filesystemPaths: [] }).includes(home));
  const plain = inferCapabilities('time', { command: 'uvx', args: ['mcp-server-time'] }, { home });
  ok('a server with no directory and no categorized tool has null scope and empty reach', plain.filesystemScope === null && plain.reach.length === 0);

  section('Scan report');
  writeDesktop(home, {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' } },
    kubernetes: { command: 'npx', args: ['-y', 'mcp-server-kubernetes'] },
    gmail: { command: 'npx', args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'] },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
    'home-files': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home] },
    'repo-files': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', repo] },
    'notes-files': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', notes] },
    'key-files': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', ssh] },
  });
  const jsonPath = path.join(root, 'export.json');
  const htmlPath = path.join(root, 'report.html');
  const scan = runCli(['scan', '--only', 'claude-desktop', '--verbose', '--json', jsonPath, '--html', htmlPath], home);
  ok('scan exits 0', scan.code === 0);
  ok('GitHub shows reach through its tools', scan.stdout.includes('github · Claude Desktop · capabilities: network_access, environment_access, credential_access · unpinned\n      reach through tools: modify source code, read source code, send external message'));
  ok('Kubernetes shows production reach', /kubernetes · Claude Desktop[^\n]*\n      reach through tools: access production system/.test(scan.stdout));
  ok('a gmail-named server shows email reach', /gmail · Claude Desktop[^\n]*\n      reach through tools: read email, send email/.test(scan.stdout));
  ok('a filesystem server at home shows its scope and reach', scan.stdout.includes('file scope: the whole home directory\n      reach through tools: access credentials, read source code, modify source code'));
  ok('a filesystem server at a repo shows a source tree', scan.stdout.includes('file scope: a source tree\n      reach through tools: read source code, modify source code'));
  ok('a filesystem server at a secrets folder shows that', scan.stdout.includes('file scope: a dotfile or secrets folder\n      reach through tools: access credentials'));
  ok('a filesystem server at an ordinary folder has scope and no extra reach', /file scope: a folder elsewhere\n(?!      reach through tools)/.test(scan.stdout));
  ok('the fetch server has no reach line', /fetch · Claude Desktop[^\n]*\n(?!      (file scope|reach through tools))/.test(scan.stdout));
  ok('EP-C fires from a real config: modify source reaches production', /\[EP-C/.test(scan.stdout) && /\(modify_source_code: [^)]*\) -> modify source code -> kubernetes \(access_production_system/.test(scan.stdout));
  ok('EP-F fires from a gmail server plus fetch', /\[EP-F/.test(scan.stdout) && scan.stdout.includes('gmail (read_email: email connector (gmail)) -> read email'));
  ok('the terminal report never prints a directory argument', [repo, notes, ssh].every(dir => !scan.stdout.includes(dir)) && !scan.stdout.includes(`${home}\n`) && !scan.stdout.includes(`${home} `));

  const exported = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const permissions = exported.inventory.real.permissions;
  const reach = permissions.filter(p => p.source && typeof p.source.id === 'string' && p.source.id.startsWith('tool-reach:'));
  ok('tool-reach permissions carry a stable source id per server and category', reach.length >= 10 && reach.every(p => p.source.id === `tool-reach:${p.rawPermission.split(' (')[0]}:${p.normalizedCategory}`));
  ok('reach permissions attach to their server', reach.every(p => p.integrationId && exported.inventory.real.mcpServers.some(s => s.id === p.integrationId)));
  ok('catalog-derived reach is inferred and scope-derived reach is observed', reach.find(p => p.rawPermission.startsWith('github (modify')).source.evidenceClass === 'inferred' && reach.find(p => p.rawPermission === 'home-files (access_credentials)').source.evidenceClass === 'observed');
  ok('reach permissions carry rubric attributes: basis, tool count, scope, and production write access with its environment', reach.find(p => p.rawPermission.startsWith('github (modify')).attributes.basis === 'catalog' && reach.find(p => p.rawPermission.startsWith('github (modify')).attributes.toolCount === 3 && reach.find(p => p.rawPermission === 'home-files (access_credentials)').attributes.scope === 'home' && reach.find(p => p.rawPermission.startsWith('kubernetes (access_production')).attributes.writeAccess === true && reach.find(p => p.rawPermission.startsWith('kubernetes (access_production')).attributes.environment === 'unknown' && reach.find(p => p.rawPermission.startsWith('gmail (read_email')).attributes.basis === 'inferred');
  ok('capability permissions carry basis, scope, and the credential kind', permissions.find(p => p.rawPermission === 'home-files (filesystem_access: the whole home directory)').attributes.scope === 'home' && permissions.find(p => p.rawPermission === 'github (credential_access)').attributes.credentialKind === 'environment_name' && permissions.find(p => p.rawPermission === 'fetch (network_access)').attributes.basis === 'catalog');
  const fsPerm = permissions.find(p => p.rawPermission.startsWith('home-files (filesystem_access'));
  ok('the filesystem permission is labeled with its scope and graded broad', fsPerm && fsPerm.rawPermission === 'home-files (filesystem_access: the whole home directory)' && fsPerm.accessLevel === 'broad');
  ok('a scoped folder grades scoped', permissions.find(p => p.rawPermission.startsWith('notes-files (filesystem_access')).accessLevel === 'scoped');
  ok('the JSON export never contains a scanned path', !JSON.stringify(exported).includes(home));

  const view = graphData.viewFromExport(exported);
  const homeNode = view.nodes.find(n => n.label === 'home-files' && n.kind === 'server');
  ok('the graph view carries file scope and reach evidence on the server node', homeNode && homeNode.evidence.some(e => e.title === 'File scope' && e.detail === 'the whole home directory') && homeNode.evidence.some(e => e.title === 'Reach: access credentials'));
  const permissionNodes = view.nodes.filter(n => n.entityType === 'permission');
  ok('graph permission boxes carry plain-word labels', permissionNodes.length >= 10 && permissionNodes.every(n => !/[a-z]_[a-z]/.test(n.label)) && permissionNodes.some(n => n.label === 'file access (the whole home directory)') && permissionNodes.some(n => n.label === 'modify source code') && permissionNodes.some(n => n.label === 'production system access'));
  ok('the raw permission text stays in the node evidence', permissionNodes.every(n => n.evidence.some(e => e.title === 'Permission' && /\(/.test(e.detail))) && permissionNodes.some(n => n.evidence.some(e => e.detail === 'home-files (filesystem_access: the whole home directory)')));
  const html = fs.readFileSync(htmlPath, 'utf8');
  ok('the HTML report shows scope and reach under capabilities', html.includes('file scope: the whole home directory<br>reach through tools: access credentials, read source code, modify source code') && html.includes('reach through tools: access production system'));
  ok('the HTML report never contains a scanned path', !html.includes(home));

  section('A clean fixture is unaffected');
  const cleanHome = path.join(root, 'clean');
  fs.mkdirSync(path.join(cleanHome, 'Desktop', 'photos'), { recursive: true });
  writeDesktop(cleanHome, { time: { command: 'uvx', args: ['mcp-server-time==0.6.2'] }, photos: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2025.8.21', path.join(cleanHome, 'Desktop', 'photos')] } });
  const clean = runCli(['scan', '--only', 'claude-desktop'], cleanHome);
  ok('clean scan exits 0 with no exposure paths', clean.code === 0 && clean.stdout.includes('0 exposure paths'));
  ok('the photos folder is a folder elsewhere with no reach', clean.stdout.includes('file scope: a folder elsewhere') && !clean.stdout.includes('reach through tools'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
