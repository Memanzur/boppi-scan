#!/usr/bin/env node
/** Verify suite for built-in agent tools: the coding agent's own shell and file access in the graph, graded from Claude Code permission settings. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const builtinTools = require('../src/cli/builtinTools');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

function runCli(args, home, cwd = home) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--home', home, '--cwd', cwd, '--no-color', '--history-file', path.join(home, 'history.json')], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function exportOf(args, home, cwd = home) {
  const file = path.join(home, `export-${Math.random().toString(16).slice(2)}.json`);
  const run = runCli([...args, '--json', file, '--quiet'], home, cwd);
  return { run, exported: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
const FETCH = { command: 'uvx', args: ['mcp-server-fetch'] };
const COMMANDER = { command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'] };
const pathsOf = exported => exported.exposurePaths.map(p => `${p.templateId}:${p.agentName}`).sort();
const builtinOf = (exported, capability) => exported.inventory.real.permissions.find(p => p.source.type === 'builtin-tool' && p.source.id.split(':')[2] === capability);

(function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-builtin-'));

  section('Rule parsing');
  ok('a bare tool name covers the whole tool', builtinTools.coversWholeTool('Bash', 'Bash') && builtinTools.coversWholeTool('Bash(*)', 'Bash') && builtinTools.coversWholeTool('Bash(*:*)', 'Bash'));
  ok('a scoped rule does not cover the whole tool', !builtinTools.coversWholeTool('Bash(npm run *)', 'Bash') && !builtinTools.coversWholeTool('Bash(git commit:*)', 'Bash'));
  ok('a rule for another tool never matches', !builtinTools.coversWholeTool('Edit', 'Bash') && builtinTools.parseRule('not a rule!') === null);
  const graded = builtinTools.builtinGrants('claude-code', { allow: ['Bash(npm run *)', 'Bash(git status)'], deny: [], ask: [], mode: null, modeScope: null });
  const shell = graded.grants.find(g => g.capability === 'shell_access');
  ok('scoped allow rules keep the shell prompted and are counted, never quoted', shell.gate === 'prompted' && shell.summary === 'asks before each use except 2 allowed patterns');
  ok('a client without readable settings grades every tool unknown', builtinTools.builtinGrants('cursor', null).grants.every(g => g.gate === 'unknown'));
  const readSpec = builtinTools.BUILTIN_TOOLS['claude-code'].find(t => t.tool === 'Read');
  ok('Read never prompts inside the working folder by default', builtinTools.gradeTool(readSpec, null).gate === 'unprompted' && builtinTools.gradeTool(readSpec, null).reason === 'never prompts inside the working folder (asks elsewhere)');
  ok('an explicit Read deny wins over the never-prompts default', builtinTools.gradeTool(readSpec, { allow: [], deny: ['Read'], ask: [], mode: 'bypassPermissions', modeScope: 'user' }).gate === 'denied');
  const scopedDeny = builtinTools.gradeTool(readSpec, { allow: [], deny: ['Read(./secrets/**)', 'Read(~/.ssh/**)'], ask: [], mode: null, modeScope: null });
  ok('path-scoped Read deny rules are counted, never quoted, and leave the grade unprompted', scopedDeny.gate === 'unprompted' && scopedDeny.reason === 'never prompts inside the working folder (asks elsewhere) except 2 denied patterns');
  const bashSpec = builtinTools.BUILTIN_TOOLS['claude-code'].find(t => t.tool === 'Bash');
  ok('an unreadable settings file makes a tool unknown, unless a readable file denies it', builtinTools.gradeTool(bashSpec, { allow: ['Bash'], deny: [], ask: [], mode: null, modeScope: null, unreadable: 1 }).gate === 'unknown' && builtinTools.gradeTool(bashSpec, { allow: [], deny: ['Bash'], ask: [], mode: null, modeScope: null, unreadable: 1 }).gate === 'denied');

  section('The gap: Claude Code plus one fetch server');
  const codeHome = path.join(root, 'code-home');
  writeJson(path.join(codeHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  const code = exportOf(['scan', '--only', 'claude-code'], codeHome);
  ok('scan succeeds', code.run.code === 0);
  ok('Claude Code with only a fetch server has a privilege path (EP-E) through its built-in shell', pathsOf(code.exported).includes('EP-E:Claude Code'));
  const epE = code.exported.exposurePaths.find(p => p.templateId === 'EP-E');
  ok('the path chain names the built-in shell, not an MCP server', epE.nodes.some(n => n.label === 'Claude Code built-in shell access (Bash)') && epE.nodes.filter(n => n.entityType === 'mcp_server').every(n => n.label === 'fetch'));
  ok('the path cites the built-in tool table as evidence', epE.evidence.some(e => e.type === 'builtin-tool' && e.name === 'Claude Code built-in tools'));
  const fetchPrediction = code.exported.predictions.find(p => p.edit.action === 'remove_server' && p.edit.server === 'fetch');
  ok('removing fetch closes nothing, because the built-in WebFetch keeps the same reach; it only lowers the exfiltration path from the catalog-backed server to the prompted built-in', fetchPrediction && fetchPrediction.predictedEliminated.length === 0 && fetchPrediction.predictedSurviving.some(k => k.startsWith('EP-E:')) && fetchPrediction.predictedLowered.length === 1 && fetchPrediction.predictedLowered[0].exposureKey.startsWith('EP-A:') && fetchPrediction.predictedLowered[0].from === 'critical' && fetchPrediction.predictedLowered[0].to === 'high');
  const bareHome = path.join(root, 'bare-home');
  writeJson(path.join(bareHome, '.claude.json'), { mcpServers: {}, projects: {} });
  const bare = exportOf(['scan', '--only', 'claude-code'], bareHome);
  const bareE = bare.exported.exposurePaths.find(p => p.templateId === 'EP-E');
  ok('with no MCP server at all, the privilege path survives on the built-in web tools alone, at the same priority', bareE && bareE.severity === epE.severity && bareE.nodes.some(n => n.label === 'Claude Code built-in web fetch (WebFetch)'));
  const bareTerminal = runCli(['scan', '--only', 'claude-code'], bareHome);
  ok('with no closing edit, the root cause names the built-in tools and the settings deny location', bareTerminal.stdout.includes('ROOT CAUSE  no MCP config edit closes or lowers a path on this scan') && bareTerminal.stdout.includes('2 paths would stay open on Claude Code with every MCP server removed, through its built-in tools (Bash, Read, WebFetch): EP-A at high, EP-E at medium.') && bareTerminal.stdout.includes('permissions.deny in ~/.claude/settings.json') && bareTerminal.stdout.includes('Boppi never edits permission settings'));
  ok('the export carries the built-in residual with its priorities', bare.exported.builtinResidual.length === 1 && bare.exported.builtinResidual[0].client === 'Claude Code' && bare.exported.builtinResidual[0].exposureKeys.length === 2 && Object.values(bare.exported.builtinResidual[0].priorities).sort().join() === 'high,medium');
  const desktopHome = path.join(root, 'desktop-home');
  writeJson(path.join(desktopHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), { mcpServers: { fetch: FETCH } });
  const desktop = exportOf(['scan', '--only', 'claude-desktop'], desktopHome);
  ok('the same fetch server in Claude Desktop, which has no built-in shell, yields no path', desktop.run.code === 0 && desktop.exported.exposurePaths.length === 0 && desktop.exported.inventory.real.permissions.every(p => p.source.type !== 'builtin-tool'));
  const terminal = runCli(['scan', '--only', 'claude-code'], codeHome);
  ok('the terminal separates built-in tools from MCP servers', terminal.stdout.includes('BUILT-IN TOOLS (4)') && terminal.stdout.indexOf('MCP SERVERS (1)') < terminal.stdout.indexOf('BUILT-IN TOOLS (4)'));
  ok('the root cause says the fetch removal lowers a path rather than closing one', /Lower: Remove the "fetch" entry/.test(terminal.stdout) && terminal.stdout.includes('lowers the most exposures; none closes one') && terminal.stdout.includes('breaks 0 of 2 exposures · lowers 1 (critical to high)'));
  ok('the plan says what remains and which built-in tools hold it', terminal.stdout.includes('2 paths would stay open on Claude Code with every MCP server removed, through its built-in tools (Bash, Read, WebFetch): EP-A at high, EP-E at medium.') && terminal.stdout.includes('permissions.deny in ~/.claude/settings.json'));
  ok('the cost line does not claim a loss the built-in web tools cover', fetchPrediction.disruption.lost.length === 0 && fetchPrediction.disruption.builtin.sort().join() === 'network_access,untrusted_external_content');
  ok('without a settings file the shell is reported as prompted by client default', terminal.stdout.includes('Claude Code · shell access (Bash) · prompts · asks before each use (no permission settings file; client default)'));
  ok('coverage counts the built-in grants', terminal.stdout.includes('4 built-in tool grants'));
  ok('the settings locations are listed as not found, not as errors', terminal.stdout.includes('.claude/settings.json') && terminal.stdout.includes('settings.local.json') && !terminal.stdout.includes('could not be scanned'));
  const html = path.join(root, 'report.html');
  runCli(['scan', '--only', 'claude-code', '--html', html], codeHome);
  const page = fs.readFileSync(html, 'utf8');
  ok('the HTML report has a built-in tools table', page.includes('<h2 id="builtin">Built-in tools</h2>') && page.includes('shell access') && page.includes('Prompts'));

  section('Predictions and costs respect built-in capabilities');
  const bothHome = path.join(root, 'both-home');
  writeJson(path.join(bothHome, '.claude.json'), { mcpServers: { fetch: FETCH, commander: COMMANDER }, projects: {} });
  const both = exportOf(['scan', '--only', 'claude-code'], bothHome);
  const commander = both.exported.predictions.find(p => p.edit.action === 'remove_server' && p.edit.server === 'commander');
  ok('removing the MCP shell server does not break the privilege path, because the built-in shell remains', commander && commander.predictedSurviving.some(k => k.startsWith('EP-E:')) && !commander.predictedEliminated.some(k => k.startsWith('EP-E:')));
  ok('the cost of removing the shell server names the built-in shell that stays', commander.disruption.lost.length === 0 && commander.disruption.builtin.includes('shell_access'));
  const fetchBoth = both.exported.predictions.find(p => p.edit.action === 'remove_server' && p.edit.server === 'fetch');
  ok('removing fetch closes nothing here either; it lowers the exfiltration path and the built-in web tools keep the privilege path', fetchBoth && fetchBoth.predictedEliminated.length === 0 && fetchBoth.predictedLowered.some(l => l.exposureKey.startsWith('EP-A:')) && fetchBoth.predictedSurviving.some(k => k.startsWith('EP-E:')));
  const bothTerminal = runCli(['scan', '--only', 'claude-code'], bothHome);
  ok('the recommended edit is the fetch removal, presented as lowering, with the built-in shell in the cost line', /Lower: Remove the "fetch" entry/.test(bothTerminal.stdout) && bothTerminal.stdout.includes('breaks 0 of 2 exposures · lowers 2 (critical to high, high to medium)') && bothTerminal.stdout.includes('it keeps network_access, untrusted_external_content through its own built-in tools'));

  section('Claude Code permission settings grade each built-in tool');
  const allowHome = path.join(root, 'allow-home');
  writeJson(path.join(allowHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  writeJson(path.join(allowHome, '.claude', 'settings.json'), { permissions: { allow: ['Bash', 'Bash(cat /Users/secretperson/notes/*)'], deny: ['WebFetch(domain:secretdomain.example)'], defaultMode: 'default' } });
  const allow = exportOf(['scan', '--only', 'claude-code'], allowHome);
  ok('a whole-tool allow rule makes the shell unprompted', builtinOf(allow.exported, 'shell_access').accessLevel === 'unprompted');
  const allowTerminal = runCli(['scan', '--only', 'claude-code'], allowHome);
  ok('the settings file is listed with rule counts and mode', allowTerminal.stdout.includes('permission settings (mode default · 2 allow · 1 deny)'));
  ok('the settings file is in the privacy footer', allowTerminal.stdout.split('PRIVACY')[1].includes(path.join(allowHome, '.claude', 'settings.json')));
  ok('the terminal shows no prompt for the shell', allowTerminal.stdout.includes('Claude Code · shell access (Bash) · no prompt · never prompts (a settings allow rule covers the whole tool)'));
  const serialized = JSON.stringify(allow.exported) + allowTerminal.stdout;
  ok('allow and deny rule text never appears in the export or the terminal', !serialized.includes('secretperson') && !serialized.includes('secretdomain'));
  ok('the export carries only counts for the settings file', allow.exported.discovery.clients.some(c => c.files.some(f => f.kind === 'settings' && f.status === 'found' && f.rules.allow === 2 && f.rules.deny === 1 && f.rules.mode === 'default')));

  const denyHome = path.join(root, 'deny-home');
  writeJson(path.join(denyHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  writeJson(path.join(denyHome, '.claude', 'settings.json'), { permissions: { deny: ['Bash'] } });
  const deny = exportOf(['scan', '--only', 'claude-code'], denyHome);
  ok('a whole-tool deny rule removes the shell grant and with it the privilege path', !builtinOf(deny.exported, 'shell_access') && !pathsOf(deny.exported).includes('EP-E:Claude Code') && builtinOf(deny.exported, 'filesystem_access'));
  const denyTerminal = runCli(['scan', '--only', 'claude-code'], denyHome);
  ok('the denied tool is still reported, marked denied and out of the graph', denyTerminal.stdout.includes('Claude Code · shell access (Bash) · denied · denied by a settings deny rule; not in the graph') && denyTerminal.stdout.includes('3 built-in tool grants,'));

  const denyAllHome = path.join(root, 'deny-all-home');
  writeJson(path.join(denyAllHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  writeJson(path.join(denyAllHome, '.claude', 'settings.json'), { permissions: { deny: ['Read', 'Edit', 'Write', 'Bash'] } });
  const denyAll = exportOf(['scan', '--only', 'claude-code'], denyAllHome);
  ok('denying Read, Edit, Write, and Bash removes every built-in grant and every path that needed one', !builtinOf(denyAll.exported, 'filesystem_access') && !builtinOf(denyAll.exported, 'shell_access') && denyAll.exported.exposurePaths.length === 0);
  const denyAllTerminal = runCli(['scan', '--only', 'claude-code'], denyAllHome);
  ok('the terminal lists both denied grants and counts only the web grant', denyAllTerminal.stdout.includes('file access (Read, Edit, Write) · denied') && denyAllTerminal.stdout.includes('web fetch (WebFetch) · prompts') && denyAllTerminal.stdout.includes('web search (WebSearch) · prompts') && denyAllTerminal.stdout.includes('2 built-in tool grants,'));
  const scopedDenyHome = path.join(root, 'scoped-deny-home');
  writeJson(path.join(scopedDenyHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  writeJson(path.join(scopedDenyHome, '.claude', 'settings.json'), { permissions: { deny: ['Read(/Users/secretperson/.ssh/**)'] } });
  const scopedDenyRun = exportOf(['scan', '--only', 'claude-code'], scopedDenyHome);
  const scopedFiles = builtinOf(scopedDenyRun.exported, 'filesystem_access');
  ok('a path-scoped Read deny keeps the grant, counts the pattern, and never leaks it', scopedFiles && scopedFiles.normalizationReason.includes('except 1 denied pattern') && !JSON.stringify(scopedDenyRun.exported).includes('secretperson'));
  ok('built-in permissions carry rubric attributes: basis, gate, and the working-folder scope', scopedFiles.attributes.basis === 'builtin' && scopedFiles.attributes.gate === 'unprompted' && scopedFiles.attributes.scope === 'home' && scopedFiles.attributes.settingsRead === true && scopedFiles.attributes.managedSettingsRead === false);
  const projectDir = path.join(scopedDenyHome, 'work', 'app');
  fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
  const fromProject = exportOf(['scan', '--only', 'claude-code'], scopedDenyHome, projectDir);
  ok('scanning from a source tree grades the file tools scope as source', builtinOf(fromProject.exported, 'filesystem_access').attributes.scope === 'source' && builtinOf(fromProject.exported, 'filesystem_access').attributes.scopeLabel === 'the working folder is a source tree');
  ok('the export never contains the working folder path', !JSON.stringify(fromProject.exported).includes(projectDir));

  const bypassHome = path.join(root, 'bypass-home');
  const project = path.join(bypassHome, 'work', 'app');
  writeJson(path.join(bypassHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  writeJson(path.join(bypassHome, '.claude', 'settings.json'), { permissions: { defaultMode: 'default' } });
  writeJson(path.join(project, '.claude', 'settings.local.json'), { permissions: { defaultMode: 'bypassPermissions' } });
  const bypass = exportOf(['scan', '--only', 'claude-code'], bypassHome, project);
  const bypassShell = builtinOf(bypass.exported, 'shell_access');
  ok('a project-local bypassPermissions mode overrides the user settings and makes every tool unprompted', bypassShell.accessLevel === 'unprompted' && bypassShell.normalizationReason.includes('defaultMode bypassPermissions in local settings'));
  ok('user, project, and local settings files are all listed under the client', bypass.exported.discovery.clients.find(c => c.clientKey === 'claude-code').files.filter(f => f.kind === 'settings').map(f => f.scope).sort().join() === 'local,project,user');

  const editsHome = path.join(root, 'edits-home');
  writeJson(path.join(editsHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  writeJson(path.join(editsHome, '.claude', 'settings.json'), { permissions: { defaultMode: 'acceptEdits' } });
  const edits = exportOf(['scan', '--only', 'claude-code'], editsHome);
  ok('acceptEdits makes file edits unprompted but leaves the shell prompted', builtinOf(edits.exported, 'shell_access').accessLevel === 'prompted' && builtinOf(edits.exported, 'filesystem_access').normalizationReason.includes('Edit and Write never prompt (defaultMode acceptEdits in user settings)'));

  const brokenHome = path.join(root, 'broken-home');
  writeJson(path.join(brokenHome, '.claude.json'), { mcpServers: { fetch: FETCH }, projects: {} });
  fs.mkdirSync(path.join(brokenHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(brokenHome, '.claude', 'settings.json'), '{ not json');
  const broken = runCli(['scan', '--only', 'claude-code'], brokenHome);
  ok('an unreadable settings file is reported and the scan is marked incomplete', broken.code === 4 && broken.stdout.includes('settings.json') && broken.stdout.includes('could not be scanned (invalid JSON)'));
  ok('with an unreadable settings file every built-in tool is graded unknown, not as the client default', broken.stdout.includes('shell access (Bash) · not checked · prompting not checked (a permission settings file could not be read)') && broken.stdout.includes('file access (Read, Edit, Write) · not checked'));

  section('Explicit --config mode and Cursor');
  const explicitFile = path.join(root, 'explicit.json');
  writeJson(explicitFile, { mcpServers: { fetch: FETCH } });
  const explicit = exportOf(['scan', '--config', explicitFile, '--source', 'claude-code'], allowHome);
  const explicitShell = builtinOf(explicit.exported, 'shell_access');
  ok('an explicit config scan still models the built-in shell and reports the path', explicitShell && pathsOf(explicit.exported).includes('EP-E:Claude Code'));
  ok('an explicit config scan does not read permission settings', explicitShell.accessLevel === 'unknown' && !explicit.exported.discovery.filesRead.some(f => f.includes('settings.json')));
  const cursorHome = path.join(root, 'cursor-home');
  writeJson(path.join(cursorHome, '.cursor', 'mcp.json'), { mcpServers: { fetch: FETCH } });
  const cursor = exportOf(['scan', '--only', 'cursor'], cursorHome);
  ok('Cursor gets built-in shell and file grants with an unknown prompting state', ['shell_access', 'filesystem_access'].every(c => builtinOf(cursor.exported, c) && builtinOf(cursor.exported, c).accessLevel === 'unknown') && pathsOf(cursor.exported).includes('EP-E:Cursor'));

  section('Stable identity');
  const again = exportOf(['scan', '--only', 'claude-code'], allowHome);
  ok('built-in permission ids and path ids are stable across runs', JSON.stringify(allow.exported.inventory.real.permissions.map(p => p.id).sort()) === JSON.stringify(again.exported.inventory.real.permissions.map(p => p.id).sort()) && JSON.stringify(allow.exported.exposurePaths.map(p => p.id)) === JSON.stringify(again.exported.exposurePaths.map(p => p.id)));
  ok('the export never contains the scanned home directory', !JSON.stringify(allow.exported).includes(allowHome));

  section('a deny on the file tools does not remove shell reads');
  {
    const shellRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-shell-read-'));
    const settingsFile = path.join(shellRoot, 'settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ permissions: { deny: ['Read', 'Edit', 'Write'], allow: ['Bash'] } }));
    const described = builtinTools.describeBuiltin('claude-code', [{ path: settingsFile, scope: 'user' }], { home: shellRoot, cwd: shellRoot });
    const viaShell = described.grants.find(g => g.viaShell);
    ok('a file grant through the shell is kept at the shell gate', !!viaShell && viaShell.capability === 'filesystem_access' && viaShell.gate === 'unprompted' && viaShell.tools.map(t => t.tool).join() === 'Bash');
    ok('the denied entry says the shell can still read those files', described.denied.some(g => g.capability === 'filesystem_access' && /Bash\) can still read and write any file the user can/.test(g.summary)));
    const perms = builtinTools.builtinPermissions({ id: 'a', name: 'Claude Code', source: { id: 's', type: 'config', name: 'n', evidenceClass: 'observed', evidenceRef: 'r' } }, described, new Date().toISOString());
    const shellRead = perms.find(p => p.normalizedCategory === 'read_files');
    ok('the shell file grant is a home-scope read with no path in its label', !!shellRead && shellRead.attributes.scope === 'home' && shellRead.attributes.gate === 'unprompted' && !shellRead.attributes.scopeLabel.includes('/'));
    const allDenied = builtinTools.describeBuiltin('claude-code', [{ path: (() => { const f = path.join(shellRoot, 'all.json'); fs.writeFileSync(f, JSON.stringify({ permissions: { deny: ['Read', 'Edit', 'Write', 'Bash'] } })); return f; })(), scope: 'user' }], { home: shellRoot, cwd: shellRoot });
    ok('denying the shell too leaves only the two web grants', allDenied.grants.map(g => g.capability).sort().join() === 'web_fetch,web_search');
  }

  section('built-in web tools');
  {
    const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-web-'));
    const none = builtinTools.describeBuiltin('claude-code', [{ path: path.join(webRoot, 'settings.json'), scope: 'user' }], { home: webRoot, cwd: webRoot });
    const webFetch = none.grants.find(g => g.capability === 'web_fetch');
    const webSearch = none.grants.find(g => g.capability === 'web_search');
    ok('Claude Code carries WebFetch and WebSearch as two prompted grants', !!webFetch && webFetch.gate === 'prompted' && webFetch.tools.map(t => t.tool).join() === 'WebFetch' && !!webSearch && webSearch.gate === 'prompted' && webSearch.tools.map(t => t.tool).join() === 'WebSearch');
    const perms = builtinTools.builtinPermissions({ id: 'a', name: 'Claude Code', source: { id: 's', type: 'config', name: 'n', evidenceClass: 'observed', evidenceRef: 'r' } }, none, new Date().toISOString());
    ok('the web grant is both an external destination and untrusted content', ['call_external_api', 'untrusted_external_content'].every(c => perms.some(p => p.normalizedCategory === c && p.attributes.basis === 'builtin' && p.attributes.gate === 'prompted')));
    ok('built-in capability ids read back from the inventory include web access once', JSON.stringify(builtinTools.builtinCapabilities({ permissions: perms.map(p => ({ ...p, agentId: 'a' })) }, 'a')) === JSON.stringify(['filesystem_access', 'shell_access', 'web_fetch', 'web_search']));
    const deniedFile = path.join(webRoot, 'deny-web.json');
    fs.writeFileSync(deniedFile, JSON.stringify({ permissions: { deny: ['WebFetch', 'WebSearch'] } }));
    const denied = builtinTools.describeBuiltin('claude-code', [{ path: deniedFile, scope: 'user' }], { home: webRoot, cwd: webRoot });
    ok('denying both web tools removes both web grants', !denied.grants.some(g => g.capability.startsWith('web_')) && denied.denied.filter(g => g.capability.startsWith('web_')).length === 2);
  }

  section('Cross-model review of rubric 1.0.2 (ADJUDICATION rows 24 to 40)');
  {
    ok('finding 1: the AGENTS row band is the worst path on a bare Claude Code, never critical with no critical path', /Claude Code\s+\d+\/100 high /.test(bareTerminal.stdout) && !/Claude Code\s+\d+\/100 critical/.test(bareTerminal.stdout));
    ok('finding 1: with a critical path the AGENTS row is critical too', /Claude Code\s+\d+\/100 critical/.test(terminal.stdout));
    const searchHome = path.join(root, 'search-home');
    writeJson(path.join(searchHome, '.claude.json'), { mcpServers: {}, projects: {} });
    writeJson(path.join(searchHome, '.claude', 'settings.json'), { permissions: { allow: ['WebSearch'] } });
    const search = exportOf(['scan', '--only', 'claude-code'], searchHome);
    const searchTerminal = runCli(['scan', '--only', 'claude-code'], searchHome);
    ok('finding 2: allowing WebSearch never grades WebFetch as unprompted', searchTerminal.stdout.includes('web search (WebSearch) · no prompt') && searchTerminal.stdout.includes('web fetch (WebFetch) · prompts'));
    ok('finding 2: the exfiltration path stays high through the prompted WebFetch, not critical', search.exported.exposurePaths.find(p => p.templateId === 'EP-A').severity === 'high');
    ok('finding 2: WebSearch is untrusted content only, never an external destination', !search.exported.inventory.real.permissions.some(p => p.source.id === 'builtin:claude-code:web_search:call_external_api') && search.exported.inventory.real.permissions.some(p => p.source.id === 'builtin:claude-code:web_search:untrusted_external_content'));
    const denyFetchHome = path.join(root, 'deny-fetch-home');
    writeJson(path.join(denyFetchHome, '.claude.json'), { mcpServers: {}, projects: {} });
    writeJson(path.join(denyFetchHome, '.claude', 'settings.json'), { permissions: { deny: ['WebFetch'] } });
    const denyFetch = exportOf(['scan', '--only', 'claude-code'], denyFetchHome);
    ok('finding 5: a denied tool never appears in the residual tool list or a permission label', denyFetch.exported.builtinResidual.every(r => !r.tools.includes('WebFetch')) && !denyFetch.exported.inventory.real.permissions.some(p => p.source.type === 'builtin-tool' && /WebFetch/.test(p.rawPermission)));
    const explicitHome = path.join(root, 'explicit-home');
    writeJson(path.join(explicitHome, 'cfg.json'), { mcpServers: { fetch: FETCH } });
    writeJson(path.join(explicitHome, '.claude', 'settings.json'), { permissions: { deny: ['WebFetch', 'WebSearch', 'Bash'] } });
    const explicitTerminal = runCli(['scan', '--config', path.join(explicitHome, 'cfg.json'), '--source', 'claude-code'], explicitHome);
    ok('finding 8: in explicit --config mode the residual sentence says settings were not read instead of promising a rescan shows a deny', explicitTerminal.stdout.includes('did not read') && explicitTerminal.stdout.includes('explicit --config mode') && !explicitTerminal.stdout.includes('the next scan shows the effect'));
    const githubHome = path.join(root, 'github-home');
    writeJson(path.join(githubHome, '.claude.json'), { mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test_value' } }, filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', githubHome] } }, projects: {} });
    const github = exportOf(['scan', '--only', 'claude-code'], githubHome);
    const githubRemoval = github.exported.predictions.find(p => p.edit.action === 'remove_server' && p.edit.server === 'github');
    ok('finding 7 side find: a filesystem server pointed at a folder named like a connector is not that connector', github.exported.inventory.real.mcpServers.find(s => s.name === 'filesystem').capabilities.join() === 'filesystem_access');
    ok('finding 7: a connector with a credential is not covered by the built-in web tools, a plain fetch server is', githubRemoval && githubRemoval.disruption.lost.includes('network_access') && !githubRemoval.disruption.builtin.length && fetchPrediction && !fetchPrediction.disruption.lost.includes('network_access') && fetchPrediction.disruption.builtin.includes('network_access'));
    const planOut = runCli(['plan', '--only', 'claude-code'], codeHome);
    const residualLine = out => (out.split('\n').find(l => l.includes('would stay open')) || '').trim();
    ok('finding 4: scan and plan state the same residual count', residualLine(terminal.stdout).startsWith('2 paths would stay open') && residualLine(planOut.stdout).startsWith('2 paths would stay open'));
    const noEdit = require('../src/cli/render/terminal').noSingleEditSentence([{ nodes: [{ entityType: 'mcp_server', label: 'alpha' }, { entityType: 'capability', label: 'x' }, { entityType: 'mcp_server', label: 'beta' }] }]);
    ok('finding 15: with no closing edit and no built-in residual, the root cause names the servers that complete the paths', noEdit.includes('alpha, beta') && noEdit.includes('boppi plan'));
    ok('finding 14: a lowering-only root cause is labelled Lower, not Fix', terminal.stdout.includes('▸ Lower:') && !terminal.stdout.includes('▸ Fix:'));
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
