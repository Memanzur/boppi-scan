/**
 * boppi demo. Two modes, both confined to <home>/.boppi/demo/.
 *
 * `boppi demo --html <file>` scans each synthetic scenario with the normal
 * pipeline, rescans it once per candidate fix with that server removed, and
 * embeds every resulting view in one page. The page simulates a fix by
 * swapping to the precomputed after-state; nothing runs in the browser.
 *
 * `boppi demo` copies one risky scenario into the sandbox and runs the
 * ordinary scan on it, then prints the follow-up commands with --config
 * prefilled so plan, fix, and verify can be tried on a file nobody uses.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const scenarios = require('../demo/scenarios');
const { buildGraphView } = require('./render/graphData');
const html = require('./render/html');
const { shellPath } = require('./shell');

const FIXTURE_DIR = path.join(__dirname, '..', 'demo');

function sandboxDir(home) { return path.join(home, '.boppi', 'demo'); }
function fixtureText(scenario) { return fs.readFileSync(path.join(FIXTURE_DIR, scenario.file), 'utf8'); }

function reportFrom(scan, version) {
  return {
    version, startedAt: scan.startedAt, durationMs: scan.durationMs,
    discovery: scan.portableDiscovery.clients, filesRead: scan.discovery.filesRead, portableFilesRead: scan.portableDiscovery.filesRead,
    inventory: scan.inventory, graph: scan.graph, paths: scan.paths, prioritization: scan.prioritization, rootCauses: scan.rootCauses,
    predictions: scan.predictions, remediationPlan: scan.remediationPlan, inferenceByClient: scan.inferenceByClient, incomplete: scan.incomplete, scanArgs: scan.scanArgs,
  };
}

async function viewOf(file, options, deps) {
  const scan = await deps.performScan({ ...options, config: file, source: 'claude-code', only: null, overlay: null });
  if (scan.failed) throw new Error(`demo: scan of ${file} failed: ${scan.failed}`);
  if (scan.incomplete.length) throw new Error(`demo: scan of ${file} was incomplete`);
  return buildGraphView(reportFrom(scan, deps.version));
}

/** The after-state is a plain view: its own fixes are not precomputed, so the page offers undo instead. */
function afterOnly(view) {
  return { ...view, remediations: [], plan: { steps: [], targetedExposures: 0, breaksAll: true, residual: [] }, paths: view.paths.map(p => ({ ...p, remediationIds: [] })) };
}

/**
 * Rescans happen on the same file path, so agent, node, and path ids stay
 * comparable between the before and after views (ids derive from the config
 * path). The original content is restored even when a scan throws.
 */
async function buildScenario(scenario, options, deps) {
  const dir = path.join(sandboxDir(options.home), 'scenarios', scenario.id);
  const file = path.join(dir, 'mcp.json');
  const original = fixtureText(scenario);
  const config = JSON.parse(original);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, original);
  const view = await viewOf(file, options, deps);
  const remediations = [];
  try {
    for (const r of view.remediations) {
      if (r.action !== 'remove_server') continue;
      const { [r.server]: removed, ...rest } = config.mcpServers;
      fs.writeFileSync(file, JSON.stringify({ ...config, mcpServers: rest }, null, 2) + '\n');
      const after = await viewOf(file, options, deps);
      const afterKeys = new Set(after.paths.map(p => p.exposureKey));
      remediations.push({
        id: r.id, server: r.server, after: afterOnly(after),
        eliminated: view.paths.filter(p => !afterKeys.has(p.exposureKey)).map(p => p.id),
        remaining: view.paths.filter(p => afterKeys.has(p.exposureKey)).map(p => p.id),
        loses: r.loses,
      });
    }
  } finally {
    fs.writeFileSync(file, original);
  }
  return { id: scenario.id, title: scenario.title, summary: scenario.summary, view, remediations };
}

async function buildBundle(options, deps) {
  const built = [];
  for (const scenario of scenarios.SCENARIOS) built.push(await buildScenario(scenario, options, deps));
  return { schemaVersion: 1, version: deps.version, generatedAt: new Date().toISOString(), banner: scenarios.BANNER, simulatedLabel: scenarios.SIMULATED, scenarios: built };
}

function homeFlag(options) { return path.resolve(options.home) === path.resolve(os.homedir()) ? '' : ` --home ${shellPath(options.home)}`; }

async function runDemo(options, deps) {
  const out = text => process.stdout.write(text + '\n');
  if (options.html) {
    const bundle = await buildBundle(options, deps);
    fs.writeFileSync(options.html, html.renderDemoHtml(bundle));
    for (const s of bundle.scenarios) out(`${s.title}: ${s.view.paths.map(p => `${p.templateId} ${p.severity}`).join(', ') || 'no exposure paths'}; ${s.remediations.length} simulated fix${s.remediations.length === 1 ? '' : 'es'}`);
    out(`\nDemo page written to ${options.html}`);
    out(bundle.banner);
    return 0;
  }

  const dir = sandboxDir(options.home);
  const file = path.join(dir, 'mcp.json');
  const scenario = scenarios.SCENARIOS.find(s => s.id === scenarios.SANDBOX_SCENARIO);
  if (options.reset || !fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, fixtureText(scenario));
    out(`${options.reset ? 'Sandbox reset' : 'Sandbox created'}: ${file} ("${scenario.title}")`);
  } else {
    out(`Sandbox config already present: ${file} (boppi demo --reset restores it)`);
  }
  out(`${scenarios.BANNER} The sandbox is the only file these commands read or edit.\n`);
  const exportFile = path.join(dir, 'scan.json');
  const code = await deps.run([
    'scan', '--config', file, '--source', 'claude-code', '--home', options.home, '--cwd', options.cwd, '--platform', options.platform,
    '--html', path.join(dir, 'report.html'), '--json', exportFile, '--history-file', path.join(dir, 'history.json'),
    ...(options.color ? [] : ['--no-color']), ...(options.quiet ? ['--quiet'] : []), ...(options.verbose ? ['--verbose'] : []),
  ]);
  const target = `--config ${shellPath(file)} --source claude-code${homeFlag(options)}`;
  out([
    '',
    'Next, on the sandbox only:',
    `  boppi plan ${target}`,
    `  boppi fix --server "github" --client claude-code ${target}`,
    `  boppi verify ${exportFile} ${target}`,
    `  boppi demo --reset${homeFlag(options)}`,
  ].join('\n'));
  return code;
}

module.exports = { runDemo, buildBundle, sandboxDir };
