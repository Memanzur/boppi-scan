/** Entirely synthetic local demonstration; all signing keys are ephemeral. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { observe, propose, evaluate, review, publish, receive, rollbackReceipt, rollback } from './pipeline.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../bin/boppi.js');
export function demonstrate(output) {
  const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures.json'), 'utf8'));
  const observations = observe(fixtures.development);
  const candidate = propose(observations);
  const evaluation = evaluate(candidate, fixtures);
  const reviewer = crypto.generateKeyPairSync('ed25519');
  const publisher = crypto.generateKeyPairSync('ed25519');
  const trust = { reviewer: reviewer.publicKey, publisher: publisher.publicKey };
  const receipt = review(evaluation, 'approve-shadow-experiment', reviewer.privateKey);
  const first = publish(candidate, fixtures, receipt, '0.0.1', reviewer.publicKey, publisher.privateKey);
  const second = publish(candidate, fixtures, receipt, '0.0.2', reviewer.publicKey, publisher.privateKey);
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  write('observations.json', observations); write('candidate.json', candidate); write('evaluation.json', evaluation);
  write('synthetic-review.json', receipt); write('bundle-0.0.1.json', first); write('bundle-0.0.2.json', second);
  write('fixture-trust-public-keys.json', { reviewer: reviewer.publicKey.export({ type: 'spki', format: 'pem' }), publisher: publisher.publicKey.export({ type: 'spki', format: 'pem' }) });
  // Distribution crosses a serialized-file boundary; keys are supplied separately.
  const receivedFirst = JSON.parse(fs.readFileSync(path.join(output, 'bundle-0.0.1.json'), 'utf8'));
  const receivedSecond = JSON.parse(fs.readFileSync(path.join(output, 'bundle-0.0.2.json'), 'utf8'));
  const v1 = receive(receivedFirst, fixtures, trust);
  const v2 = receive(receivedSecond, fixtures, trust, v1);
  const rollbackReview = rollbackReceipt(v2, receivedFirst, reviewer.privateKey);
  const rolledBack = rollback(v2, receivedFirst, fixtures, trust, rollbackReview);
  write('shadow-overlay.json', v2.overlay); write('rollback-receipt.json', rollbackReview); write('receiver-state.json', rolledBack);

  const home = path.join(output, 'synthetic-home'); fs.mkdirSync(home, { mode: 0o700 });
  const config = path.join(output, 'synthetic-config.json');
  write('synthetic-config.json', { mcpServers: {
    reader: { command: 'npx', args: ['@boppi-fixtures/reader@1.0.0'] },
    relay: { command: 'npx', args: ['@boppi-fixtures/relay@1.0.0'] },
  } });
  const scan = (name, overlay) => {
    const destination = path.join(output, name);
    const result = spawnSync(process.execPath, [CLI, 'scan', '--config', config, '--source', 'claude-desktop', '--home', home, '--cwd', home, '--platform', 'darwin', '--json', destination, '--no-color', ...(overlay ? ['--overlay', path.join(output, 'shadow-overlay.json')] : [])], { encoding: 'utf8' });
    if (result.status) throw new Error('Synthetic scanner proof failed');
    return JSON.parse(fs.readFileSync(destination, 'utf8'));
  };
  const baseline = scan('baseline-export.json', false);
  const shadow = scan('shadow-export.json', true);
  const permissionKeys = data => data.inventory.real.permissions.map(p => [p.agentId, p.integrationId, p.normalizedCategory]);
  const pathKeys = data => data.exposurePaths.map(p => [p.exposureKey, p.severity]);
  if (JSON.stringify(permissionKeys(baseline)) !== JSON.stringify(permissionKeys(shadow)) || JSON.stringify(pathKeys(baseline)) !== JSON.stringify(pathKeys(shadow))) throw new Error('Inactive claims affected scanner output');
  if (shadow.diagnostics.shadow.length !== candidate.rules.length) throw new Error('Shadow claims were not recorded');
  const result = { scope: 'synthetic mechanism demonstration only', productionApproved: false, activeRules: 0,
    stages: ['observe', 'propose', 'evaluate', 'synthetic review', 'version', 'local file distribution', 'verify', 'shadow scan', 'approved synthetic rollback'],
    evaluation, shadowClaims: shadow.diagnostics.shadow.length, permissionsUnchanged: true, exposurePathsUnchanged: true,
    selectedVersionAfterRollback: rolledBack.selectedVersion, highestVersionAfterRollback: rolledBack.highestVersion,
    limits: ['Synthetic reviewer is not a human or founder approval.', 'Fixture labels test the mechanism, not real-world generalization.', 'No production trust registry, network updater, durable receiver state or automatic activation exists.', 'Existing failed inspector experiment and rubric/human gates remain unchanged.'] };
  write('RESULT.json', result);
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let output;
  if (process.argv.length === 4 && process.argv[2] === '--out') { output = path.resolve(process.argv[3]); fs.mkdirSync(output, { mode: 0o700 }); }
  else if (process.argv.length === 2) output = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-intelligence-'));
  else throw new Error('Usage: node research/intelligence/demo.mjs [--out <new-directory>]');
  console.log(JSON.stringify(demonstrate(output), null, 2));
  console.log(`Synthetic artifacts: ${output}`);
}
