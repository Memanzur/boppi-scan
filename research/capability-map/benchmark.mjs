#!/usr/bin/env node
// Scores the catalog and the inspector against labels.json. Writes benchmark.json and benchmark.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogCategories } from './catalog-baseline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAXONOMY = ['read_files','write_files','delete_files','read_email','send_email','read_calendar','modify_calendar','read_source_code','modify_source_code','access_customer_data','access_financial_data','access_health_data','access_hr_data','execute_code','run_shell_commands','browse_internet','call_external_api','send_external_message','create_or_modify_records','make_purchase','access_credentials','access_environment_variables','browser_automation','access_production_system','untrusted_external_content'];

const RULE = { recallGainPoints: 15, maxInspectorErrorsOf50: 5 };

function counts() { return { tp: 0, fp: 0, fn: 0, tn: 0 }; }
function rate(n, d) { return d ? Math.round((n / d) * 1000) / 10 : null; }
function metrics(c) {
  return {
    ...c,
    precision: rate(c.tp, c.tp + c.fp), recall: rate(c.tp, c.tp + c.fn),
    fpRate: rate(c.fp, c.fp + c.tn), fnRate: rate(c.fn, c.fn + c.tp),
  };
}

function score(labels, predict, categories) {
  const perCategory = Object.fromEntries(categories.map(c => [c, counts()]));
  const micro = counts();
  let covered = 0;
  const errors = [];
  for (const pkg of labels) {
    const truth = new Set(pkg.categories.map(c => c.category));
    const predicted = new Set(predict(pkg));
    if (predicted.size) covered++;
    for (const cat of categories) {
      const t = truth.has(cat), p = predicted.has(cat);
      const key = t && p ? 'tp' : !t && p ? 'fp' : t && !p ? 'fn' : 'tn';
      perCategory[cat][key]++; micro[key]++;
      if (key === 'fp' || key === 'fn') errors.push({ package: pkg.name, category: cat, kind: key === 'fp' ? 'false positive' : 'false negative' });
    }
  }
  const per = Object.fromEntries(Object.entries(perCategory).map(([k, v]) => [k, metrics(v)]));
  const withSupport = Object.values(per).filter(m => m.tp + m.fn > 0);
  const mean = key => withSupport.length ? Math.round(withSupport.reduce((s, m) => s + (m[key] ?? 0), 0) / withSupport.length * 10) / 10 : null;
  const macro = { precision: mean('precision'), recall: mean('recall') };
  return { perCategory: per, micro: metrics(micro), macro, coverage: { packages: covered, of: labels.length, pct: rate(covered, labels.length) }, errors, packagesWithFalsePositive: new Set(errors.filter(e => e.kind === 'false positive').map(e => e.package)).size };
}

function table(rows, header) {
  const line = r => `| ${r.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

function main() {
  const labels = JSON.parse(fs.readFileSync(path.join(HERE, 'labels.json'), 'utf8'));
  const inspector = JSON.parse(fs.readFileSync(path.join(HERE, 'inspector-output.json'), 'utf8'));
  const inspectorByName = new Map(inspector.packages.map(p => [p.name, p]));
  const labeled = labels.packages.filter(p => !p.unknown);
  const unknown = labels.packages.filter(p => p.unknown);
  const labelCategories = new Set(labeled.flatMap(p => p.categories.map(c => c.category)));
  const inspectorCategories = new Set(inspector.packages.flatMap(p => Object.keys(p.categories)));
  const catalogCategoriesSeen = new Set(labeled.flatMap(p => Object.keys(catalogCategories(p.name))));
  const categories = TAXONOMY.filter(c => labelCategories.has(c) || inspectorCategories.has(c) || catalogCategoriesSeen.has(c));

  const inspectorCats = p => Object.keys((inspectorByName.get(p.name) || { categories: {} }).categories);
  const catalog = score(labeled, p => Object.keys(catalogCategories(p.name)), categories);
  const insp = score(labeled, inspectorCats, categories);
  // Secondary breakdowns, decided after the primary numbers were seen. They inform the next
  // iteration and do not feed the decision rule.
  const servers = labeled.filter(p => p.serverShape === 'server');
  const secondary = {
    serversOnly: { n: servers.length, catalog: score(servers, p => Object.keys(catalogCategories(p.name)), categories), inspector: score(servers, inspectorCats, categories) },
    callStrengthOnly: { n: labeled.length, inspector: score(labeled, p => Object.entries((inspectorByName.get(p.name) || { categories: {} }).categories).filter(([, v]) => v.strength === 'call').map(([k]) => k), categories) },
  };
  const inspectorWrongPackages = new Set(insp.errors.filter(e => e.kind === 'false positive').map(e => e.package));

  const recallGain = (insp.micro.recall ?? 0) - (catalog.micro.recall ?? 0);
  const precisionHeld = (insp.micro.precision ?? 0) >= (catalog.micro.precision ?? 0);
  const errorsOk = inspectorWrongPackages.size <= RULE.maxInspectorErrorsOf50;
  const verdict = recallGain >= RULE.recallGainPoints && precisionHeld && errorsOk ? 'inspector wins' : 'inspector does not win; the capability map stays a hand-curated catalog';

  const result = { generatedAt: new Date().toISOString(), labels: { total: labels.packages.length, scored: labeled.length, unknown: unknown.length, reviewer: labels.reviewer, humanReviewed: labels.humanReviewed, seed: labels.seed }, categories, catalog, inspector: insp, rule: RULE, secondary: { serversOnly: { n: secondary.serversOnly.n, catalog: { micro: secondary.serversOnly.catalog.micro, coverage: secondary.serversOnly.catalog.coverage }, inspector: { micro: secondary.serversOnly.inspector.micro, coverage: secondary.serversOnly.inspector.coverage, packagesWithFalsePositive: secondary.serversOnly.inspector.packagesWithFalsePositive } }, callStrengthOnly: { micro: secondary.callStrengthOnly.inspector.micro, coverage: secondary.callStrengthOnly.inspector.coverage, packagesWithFalsePositive: secondary.callStrengthOnly.inspector.packagesWithFalsePositive } }, decision: { recallGain: Math.round(recallGain * 10) / 10, precisionHeld, inspectorWrongPackages: [...inspectorWrongPackages].sort(), errorsOk, verdict } };
  fs.writeFileSync(path.join(HERE, 'benchmark.json'), JSON.stringify(result, null, 2));

  const fmt = v => v == null ? 'n/a' : `${v}`;
  const overall = table([
    ['catalog', fmt(catalog.micro.precision), fmt(catalog.micro.recall), fmt(catalog.micro.fpRate), fmt(catalog.micro.fnRate), fmt(catalog.macro.precision), fmt(catalog.macro.recall), `${catalog.coverage.packages} of ${catalog.coverage.of} (${catalog.coverage.pct}%)`],
    ['inspector', fmt(insp.micro.precision), fmt(insp.micro.recall), fmt(insp.micro.fpRate), fmt(insp.micro.fnRate), fmt(insp.macro.precision), fmt(insp.macro.recall), `${insp.coverage.packages} of ${insp.coverage.of} (${insp.coverage.pct}%)`],
  ], ['tool', 'micro precision', 'micro recall', 'FP rate', 'FN rate', 'macro precision', 'macro recall', 'coverage']);
  const perCat = table(categories.map(c => {
    const a = catalog.perCategory[c], b = insp.perCategory[c];
    return [c, a.tp + a.fn, fmt(a.precision), fmt(a.recall), a.fp, fmt(b.precision), fmt(b.recall), b.fp];
  }), ['category', 'labeled', 'catalog P', 'catalog R', 'catalog FP', 'inspector P', 'inspector R', 'inspector FP']);
  const md = [
    '# Benchmark: catalog vs inspector',
    '',
    `Generated ${result.generatedAt} from labels.json (seed ${labels.seed}, reviewer ${labels.reviewer}, humanReviewed ${labels.humanReviewed}). ${labeled.length} of ${labels.packages.length} sampled packages have labels; ${unknown.length} are marked unknown and excluded from scoring.`,
    '',
    'Rates are percentages. Micro averages pool every (package, category) decision. Macro averages the per-category rates over categories with at least one positive label. Coverage counts packages where the tool emits at least one category, right or wrong.',
    '',
    '## Overall',
    '',
    overall,
    '',
    '## Per category',
    '',
    perCat,
    '',
    '## Decision rule',
    '',
    `The inspector wins only if micro recall improves by at least ${RULE.recallGainPoints} points at equal or better micro precision, and the hand review finds it wrong on at most ${RULE.maxInspectorErrorsOf50} of 50 packages.`,
    '',
    `- Recall gain: ${result.decision.recallGain} points`,
    `- Precision held: ${precisionHeld}`,
    `- Packages where the inspector emitted a false positive: ${inspectorWrongPackages.size} (${[...inspectorWrongPackages].sort().join(', ') || 'none'})`,
    `- Verdict: **${verdict}**`,
    '',
    '## Secondary breakdowns (post hoc, not part of the decision)',
    '',
    `Servers only: the ${secondary.serversOnly.n} labeled packages whose serverShape is server. Libraries, CLIs, and content packages are excluded because the inspector cannot tell from signals alone that nothing is exposed to an agent.`,
    '',
    table([
      ['catalog', fmt(secondary.serversOnly.catalog.micro.precision), fmt(secondary.serversOnly.catalog.micro.recall), `${secondary.serversOnly.catalog.coverage.packages} of ${secondary.serversOnly.catalog.coverage.of}`, '-'],
      ['inspector', fmt(secondary.serversOnly.inspector.micro.precision), fmt(secondary.serversOnly.inspector.micro.recall), `${secondary.serversOnly.inspector.coverage.packages} of ${secondary.serversOnly.inspector.coverage.of}`, `${secondary.serversOnly.inspector.packagesWithFalsePositive}`],
    ], ['tool', 'micro precision', 'micro recall', 'coverage', 'packages with a false positive']),
    '',
    'Call strength only: inspector predictions restricted to categories backed by a call site, dropping import-only claims. Same 47 packages as the primary table.',
    '',
    table([
      ['inspector (call only)', fmt(secondary.callStrengthOnly.inspector.micro.precision), fmt(secondary.callStrengthOnly.inspector.micro.recall), `${secondary.callStrengthOnly.inspector.coverage.packages} of ${secondary.callStrengthOnly.inspector.coverage.of}`, `${secondary.callStrengthOnly.inspector.packagesWithFalsePositive}`],
    ], ['tool', 'micro precision', 'micro recall', 'coverage', 'packages with a false positive']),
    '',
    '## Inspector errors',
    '',
    table(insp.errors.map(e => [e.package, e.category, e.kind]), ['package', 'category', 'kind']),
    '',
    '## Catalog errors',
    '',
    table(catalog.errors.map(e => [e.package, e.category, e.kind]), ['package', 'category', 'kind']),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(HERE, 'benchmark.md'), md);
  process.stderr.write(`catalog P/R ${catalog.micro.precision}/${catalog.micro.recall} coverage ${catalog.coverage.pct}%; inspector P/R ${insp.micro.precision}/${insp.micro.recall} coverage ${insp.coverage.pct}%; ${verdict}\n`);
}

main();
