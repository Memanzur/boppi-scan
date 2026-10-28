#!/usr/bin/env node
/** boppi connect against a mock workspace that implements the six connector routes and the proposal state machine. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const connect = require('../src/cli/connect');
const models = require('../src/engine/models');
const riskRubric = require('../src/engine/riskRubric');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const PAIR_CODE = 'pair-TESTCODE0001';
const HEX64 = /^[0-9a-f]{64}$/;
const FINGERPRINT = /^[A-Za-z0-9_]{1,80}$/;
let passed = 0, failed = 0;
function ok(name, condition) { if (condition) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function section(name) { console.log(`\n── ${name} ──`); }

const PRELOAD = `
'use strict';
const fs = require('fs');
function refuse(kind) { fs.appendFileSync(process.env.BOPPI_NET_LOG, kind + '\\n'); throw new Error('network attempt (' + kind + ') blocked'); }
require('net').Socket.prototype.connect = function () { refuse('net.Socket.connect'); };
require('dns').lookup = function () { refuse('dns.lookup'); };
globalThis.fetch = async function () { refuse('fetch'); };
`;

function makeHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
  fs.mkdirSync(path.join(home, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({
    theme: 'keep-me',
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(home, 'docs')] },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      '1password': { command: 'npx', args: ['-y', '@1password/mcp'], env: { OP_TOKEN: 'SUPERSECRETVALUE' } },
    },
  }, null, 2));
  return home;
}

/** The mock workspace lives in this process, so every CLI run is asynchronous; a blocking spawn would deadlock against it. */
function runCli(args, home, env = {}, preload = null) {
  const nodeArgs = preload ? ['--require', preload] : [];
  return new Promise(resolve => {
    const child = spawn(process.execPath, [...nodeArgs, CLI, ...args, '--home', home, '--cwd', env.BOPPI_TEST_CWD || home, '--no-color', '--history-file', path.join(home, 'history.json')], { env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.end();
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const offerKey = o => [o.action || 'remove_server', o.client, o.project, o.targetFile, o.server].join('|');
const VERSIONS = { scanner: require('../package.json').version, engine: models.ENGINE_VERSION, rubric: riskRubric.RUBRIC_VERSION };
const sameVersions = v => v && v.scanner === VERSIONS.scanner && v.engine === VERSIONS.engine && v.rubric === VERSIONS.rubric;

/** The workspace side of the contract, in memory: pairing, offers, proposals, locks, nonces. */
function startWorkspace() {
  const ws = { requests: [], device: null, previews: new Map(), proposals: new Map(), locks: new Map(), issued: new Map(), consumed: new Set(), onClaim: null, replayNonce: null };
  const byRoute = route => ws.requests.filter(r => r.url === `/api/connector/${route}`);
  ws.byRoute = byRoute;
  ws.propose = (key, rollbackOf = null) => {
    const offer = ws.previews.get(key);
    if (!offer) throw new Error(`no offer ${key}`);
    const id = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');
    ws.proposals.set(id, { id, state: 'proposed', approvedAt: null, rollbackOf, binding: { organizationId: 'org-1', deviceId: ws.device.id, client: offer.client, project: offer.project, targetFile: offer.targetFile, server: offer.server, action: offer.action || 'remove_server', configHash: offer.configHash, previewHash: offer.previewHash, versions: offer.versions, expectedExposureKeys: offer.expectedExposureKeys, capabilityLoss: offer.capabilityLoss, expiresAt: new Date(Date.now() + 86400000).toISOString(), nonce, ...(rollbackOf ? { backupManifestId: offer.backupManifestId, appliedHash: offer.configHash } : {}) }, nonce });
    return id;
  };
  ws.proposeRollback = fixId => {
    const applied = ws.proposals.get(fixId);
    const offer = [...ws.previews.values()].find(o => o.action === 'rollback' && o.backupManifestId === applied.backupManifestId && o.project === applied.binding.project && o.configHash === applied.appliedHash);
    if (!offer) throw new Error('rollback_blocked');
    return ws.propose(offerKey(offer), fixId);
  };
  ws.approve = id => { const p = ws.proposals.get(id); p.state = 'approved'; p.approvedAt = new Date().toISOString(); };
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = (() => { try { return JSON.parse(raw); } catch (_) { return null; } })();
      ws.requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
      if (req.url === '/api/connector/pair') {
        if (!body || body.code !== PAIR_CODE || ws.device) return reply(res, 401, { error: 'invalid_code' });
        ws.device = { id: crypto.randomUUID(), credential: `bpd_${crypto.randomBytes(32).toString('hex')}`, device: body.device };
        return reply(res, 200, { deviceId: ws.device.id, organizationId: 'org-1', credential: ws.device.credential, credentialExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), workspaceName: 'Test Workspace' });
      }
      if (!ws.device || req.headers.authorization !== `Bearer ${ws.device.credential}`) return reply(res, 401, { error: 'invalid_credential' });
      const proposal = body && body.proposalId ? ws.proposals.get(body.proposalId) : null;
      switch (req.url) {
        case '/api/connector/poll': {
          if (!Array.isArray(body.offers) || body.offers.length > 64) return reply(res, 400, { error: 'validation' });
          ws.previews = new Map(body.offers.map(o => [offerKey(o), o]));
          return reply(res, 200, { proposals: [...ws.proposals.values()].filter(p => ['proposed', 'approved', 'applied'].includes(p.state)).map(p => ({ id: p.id, state: p.state, binding: p.binding, approvedAt: p.approvedAt })) });
        }
        case '/api/connector/preview': {
          if (!proposal || proposal.state !== 'proposed') return reply(res, 409, { error: 'wrong_state' });
          proposal.state = body.regularFile && sameVersions(body.versions) && body.configHash === proposal.binding.configHash && body.previewHash === proposal.binding.previewHash ? 'previewed' : 'conflicted';
          return reply(res, 200, { state: proposal.state });
        }
        case '/api/connector/claim': {
          if (!proposal || proposal.state !== 'approved') return reply(res, 409, { error: 'wrong_state' });
          if (!body.regularFile || body.configHash !== proposal.binding.configHash || !sameVersions(body.versions)) { proposal.state = 'conflicted'; return reply(res, 200, { state: 'conflicted' }); }
          const lockKey = `${proposal.binding.deviceId}:${proposal.binding.targetFile}`;
          if (ws.locks.has(lockKey)) return reply(res, 409, { error: 'locked' });
          ws.locks.set(lockKey, proposal.id);
          proposal.state = 'executing';
          const nonce = ws.replayNonce || proposal.nonce;
          ws.issued.set(proposal.id, nonce);
          if (ws.onClaim) ws.onClaim(proposal);
          return reply(res, 200, { nonce });
        }
        case '/api/connector/applied': {
          if (!proposal || proposal.state !== 'executing') return reply(res, 409, { error: 'wrong_state' });
          if (body.nonce !== ws.issued.get(proposal.id)) return reply(res, 409, { error: 'nonce_mismatch' });
          if (ws.consumed.has(body.nonce)) return reply(res, 409, { error: 'nonce_consumed' });
          ws.consumed.add(body.nonce);
          const lockKey = `${proposal.binding.deviceId}:${proposal.binding.targetFile}`;
          if (ws.locks.get(lockKey) === proposal.id) ws.locks.delete(lockKey);
          if (body.regularFile && body.hashAtWrite === proposal.binding.configHash && HEX64.test(body.appliedHash || '') && body.backupManifestId) { proposal.state = 'applied'; proposal.appliedHash = body.appliedHash; proposal.backupManifestId = body.backupManifestId; }
          else proposal.state = 'conflicted';
          return reply(res, 200, { state: proposal.state });
        }
        case '/api/connector/rescan': {
          if (ws.dropRescanOnce) { ws.dropRescanOnce = false; req.socket.destroy(); return; }
          if (!proposal || proposal.state !== 'applied') return reply(res, 409, { error: 'wrong_state' });
          const remainingKeys = proposal.binding.action === 'rollback' ? [] : proposal.binding.expectedExposureKeys.filter(key => (body.exposureKeys || []).includes(key));
          proposal.state = body.configHash === proposal.appliedHash && sameVersions(body.versions) && !remainingKeys.length ? 'verified' : 'verification_failed';
          if (proposal.state === 'verified' && proposal.rollbackOf) ws.proposals.get(proposal.rollbackOf).state = 'rolled_back';
          return reply(res, 200, { state: proposal.state, remainingKeys });
        }
        default: return reply(res, 404, { error: 'not_found' });
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ ...ws, server, url: `http://127.0.0.1:${server.address().port}`, ws })));
}

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-connector-'));
  const home = makeHome(root);
  const desktopConfig = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const original = fs.readFileSync(desktopConfig);
  const manifestFile = path.join(home, '.boppi', 'backups', 'index.json');
  const manifestEntries = () => (fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).entries : []);
  const workspace = await startWorkspace();
  const ws = workspace.ws;
  const preload = path.join(root, 'preload.js');
  fs.writeFileSync(preload, PRELOAD);
  const netLog = path.join(root, 'net.log');

  try {
    section('URL rules');
    ok('https origin is accepted and normalized', connect.resolveWorkspaceUrl('https://app.boppi.io/') === 'https://app.boppi.io');
    ok('http is accepted only for loopback', connect.resolveWorkspaceUrl('http://127.0.0.1:3000') === 'http://127.0.0.1:3000' && (() => { try { connect.resolveWorkspaceUrl('http://example.com'); return false; } catch (_) { return true; } })());
    ok('a path, query or credentials in the URL are refused', ['https://app.boppi.io/api', 'https://app.boppi.io/?x=1', 'https://u:p@app.boppi.io'].every(url => { try { connect.resolveWorkspaceUrl(url); return false; } catch (_) { return true; } }));

    section('status before pairing opens no socket');
    fs.writeFileSync(netLog, '');
    const unpaired = await runCli(['connect', 'status'], home, { BOPPI_NET_LOG: netLog }, preload);
    ok('status reports not paired, exits 0, and makes no network attempt', unpaired.code === 0 && unpaired.stdout.includes('Not paired') && fs.readFileSync(netLog, 'utf8') === '');
    const noPair = await runCli(['connect', 'run', '--once'], home);
    ok('run without a pairing exits 2', noPair.code === 2 && noPair.stderr.includes('not paired'));
    const badArgs = await runCli(['connect', 'pair', '--url', workspace.url], home);
    ok('pair without --code is a usage error', badArgs.code === 2 && badArgs.stderr.includes('--code'));

    section('pairing');
    const paired = await runCli(['connect', 'pair', '--url', workspace.url, '--code', PAIR_CODE, '--name', 'test-box'], home);
    const pairingFile = connect.pairingFile(home);
    const pairing = JSON.parse(fs.readFileSync(pairingFile, 'utf8'));
    ok('pair exits 0 and stores the pairing with mode 0600', paired.code === 0 && (fs.statSync(pairingFile).mode & 0o777) === 0o600);
    ok('the pairing holds url, ids, credential and expiry', pairing.url === workspace.url && pairing.deviceId === ws.device.id && pairing.organizationId === 'org-1' && pairing.credential === ws.device.credential && pairing.credential.startsWith('bpd_') && typeof pairing.credentialExpiresAt === 'string' && pairing.workspaceName === 'Test Workspace');
    const pairRequest = ws.byRoute('pair')[0];
    ok('the pair request carries name, platform and versions, and no path', pairRequest.body.device.name === 'test-box' && pairRequest.body.device.platform === 'darwin' && sameVersions(pairRequest.body.device.versions) && !pairRequest.authorization && !JSON.stringify(pairRequest.body).includes(home));
    ok('pair output never prints the credential', !paired.stdout.includes(ws.device.credential) && !paired.stderr.includes(ws.device.credential));
    fs.writeFileSync(netLog, '');
    const status = await runCli(['connect', 'status'], home, { BOPPI_NET_LOG: netLog }, preload);
    ok('status shows the pairing without the credential and opens no socket', status.code === 0 && status.stdout.includes('Test Workspace') && status.stdout.includes(ws.device.id) && !status.stdout.includes(ws.device.credential) && fs.readFileSync(netLog, 'utf8') === '');

    section('offers');
    const first = await runCli(['connect', 'run', '--once'], home);
    const poll = ws.byRoute('poll')[0];
    const offers = poll ? poll.body.offers : [];
    ok('run --once exits 0, polls once with the bearer credential, and says what it sent', first.code === 0 && ws.byRoute('poll').length === 1 && poll.authorization === `Bearer ${ws.device.credential}` && first.stdout.includes('removal offer'));
    ok('one offer per remove_server candidate that closes a path', offers.length >= 2 && offers.some(o => o.server === 'fetch') && offers.some(o => o.server === 'filesystem') && offers.every(o => o.client === 'claude-desktop'));
    ok('offers carry exactly the contract fields', offers.every(o => Object.keys(o).sort().join() === 'capabilityLoss,client,computedAt,configHash,expectedExposureKeys,previewHash,project,server,targetFile,versions'));
    ok('offer hashes are sha256 and fingerprints are opaque', offers.every(o => HEX64.test(o.configHash) && HEX64.test(o.previewHash) && FINGERPRINT.test(o.project) && FINGERPRINT.test(o.targetFile)));
    ok('the file hash in the offer is the sha256 of the config file', offers.every(o => o.configHash === crypto.createHash('sha256').update(original).digest('hex')));
    ok('offers name expected exposure keys, capability loss and versions', offers.every(o => o.expectedExposureKeys.length >= 1 && Array.isArray(o.capabilityLoss) && sameVersions(o.versions) && !Number.isNaN(Date.parse(o.computedAt))) && offers.find(o => o.server === 'fetch').capabilityLoss.includes('network_access'));
    const serializedOffers = JSON.stringify(offers);
    ok('offers carry no raw path, no secret value and no preview text', !serializedOffers.includes(home) && !serializedOffers.includes('/') && !serializedOffers.includes('SUPERSECRETVALUE') && !serializedOffers.includes('@@') && !serializedOffers.includes('mcpServers') && !serializedOffers.includes('[hidden]'));
    ok('a cycle with no proposals writes nothing', fs.readFileSync(desktopConfig).equals(original) && manifestEntries().length === 0);

    section('a proposed proposal whose target became a symlink');
    const fetchKey = offerKey(offers.find(o => o.server === 'fetch'));
    const symlinkProposal = ws.propose(fetchKey);
    const aside = path.join(root, 'moved-config.json');
    fs.renameSync(desktopConfig, aside);
    fs.symlinkSync(aside, desktopConfig);
    const viaSymlink = await runCli(['connect', 'run', '--once'], home);
    const symlinkPreview = ws.byRoute('preview').at(-1);
    ok('the preview report says the target is not a regular file and the workspace conflicts it', viaSymlink.code === 0 && symlinkPreview && symlinkPreview.body.proposalId === symlinkProposal && symlinkPreview.body.regularFile === false && ws.proposals.get(symlinkProposal).state === 'conflicted');
    ok('no offer is made for a symlinked file', ws.byRoute('poll').at(-1).body.offers.length === 0);
    fs.unlinkSync(desktopConfig);
    fs.renameSync(aside, desktopConfig);

    section('a file changed between claim and write');
    await runCli(['connect', 'run', '--once'], home);
    const changedProposal = ws.propose(fetchKey);
    const previewed = await runCli(['connect', 'run', '--once'], home);
    ok('a proposed proposal is previewed and the hashes match', previewed.code === 0 && ws.proposals.get(changedProposal).state === 'previewed' && previewed.stdout.includes('preview matches the proposal'));
    ok('the preview report carries the binding nonce the workspace delivered', ws.byRoute('preview').at(-1).body.nonce === ws.proposals.get(changedProposal).binding.nonce);
    ws.approve(changedProposal);
    ws.onClaim = () => fs.appendFileSync(desktopConfig, '\n');
    const raced = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.onClaim = null;
    const racedReport = ws.byRoute('applied').at(-1);
    ok('the applied report names hash_changed with no applied hash', racedReport && racedReport.body.proposalId === changedProposal && racedReport.body.failureCode === 'hash_changed' && !racedReport.body.appliedHash && racedReport.body.regularFile === true && HEX64.test(racedReport.body.hashAtWrite));
    ok('the file is left exactly as the other writer left it and no manifest entry exists', fs.readFileSync(desktopConfig).equals(Buffer.concat([original, Buffer.from('\n')])) && manifestEntries().length === 0 && ws.proposals.get(changedProposal).state === 'conflicted');
    ok('the output says nothing was written', raced.stdout.includes('not written (hash_changed)') && !raced.stdout.includes('applied locally'));
    fs.writeFileSync(desktopConfig, original);

    section('only removals this device offered are executed (T-4)');
    {
      const tampered = [
        ['no expected exposure paths', b => { b.expectedExposureKeys = []; }],
        ['hidden capability loss', b => { b.capabilityLoss = []; }],
        ['another project fingerprint', b => { b.project = 'p_forged0000000000'; }],
        ['an unknown action treated as a removal', b => { b.action = 'move_server'; }],
      ];
      for (const [label, mutate] of tampered) {
        await runCli(['connect', 'run', '--once'], home);
        const id = ws.propose(fetchKey);
        mutate(ws.proposals.get(id).binding);
        ws.approve(id);
        const claimsBefore = ws.byRoute('claim').length;
        const forged = await runCli(['connect', 'run', '--once', '--yes'], home);
        ok(`${label}: refused as not_offered even with --yes, never claimed, file and manifest untouched`, forged.stdout.includes(`${id}  refused (not_offered)`) && ws.byRoute('claim').length === claimsBefore && fs.readFileSync(desktopConfig).equals(original) && manifestEntries().length === 0 && !forged.stdout.includes('applied locally'));
        ws.proposals.get(id).state = 'cancelled';
      }
      const offer = ws.previews.get(fetchKey);
      const binding = { ...offer, action: 'remove_server' };
      ok('offerMatches accepts the exact offer', connect.offerMatches(offer, binding));
      ok('offerMatches refuses a server the device did not offer', !connect.offerMatches(offer, { ...binding, server: '1password' }));
      ok('offerMatches refuses an unoffered file fingerprint', !connect.offerMatches(offer, { ...binding, targetFile: 'f_other' }));
      ok('offerMatches refuses a changed config or preview hash', !connect.offerMatches(offer, { ...binding, configHash: '0'.repeat(64) }) && !connect.offerMatches(offer, { ...binding, previewHash: '0'.repeat(64) }));
      ok('offerMatches refuses a removal offer used as a rollback', !connect.offerMatches(offer, { ...binding, action: 'rollback', backupManifestId: 'remove_server-x' }));
    }

    section('an approved proposal applied, reported and rescanned');
    await runCli(['connect', 'run', '--once'], home);
    const applyProposal = ws.propose(fetchKey);
    await runCli(['connect', 'run', '--once'], home);
    ws.approve(applyProposal);
    const waiting = await runCli(['connect', 'run', '--once'], home);
    ok('without a terminal and without --yes the proposal waits and nothing is claimed', waiting.code === 0 && waiting.stdout.includes('waiting') && ws.proposals.get(applyProposal).state === 'approved' && fs.readFileSync(desktopConfig).equals(original));
    ok('the exact sanitized preview is rendered before the question', waiting.stdout.includes('key:     mcpServers."fetch"') && waiting.stdout.includes('@@') && !waiting.stdout.includes('SUPERSECRETVALUE'));
    const appliedBefore = ws.byRoute('applied').length;
    const applied = await runCli(['connect', 'run', '--once', '--yes'], home);
    const report = ws.byRoute('applied').at(-1);
    const after = JSON.parse(fs.readFileSync(desktopConfig, 'utf8'));
    const entries = manifestEntries();
    ok('--yes is printed, the claim is made, and one applied report follows', applied.code === 0 && applied.stdout.includes('local confirmation skipped (--yes)') && ws.byRoute('applied').length === appliedBefore + 1 && report.body.proposalId === applyProposal);
    ok('the applied report carries the new hash and the manifest id', HEX64.test(report.body.appliedHash) && report.body.appliedHash === crypto.createHash('sha256').update(fs.readFileSync(desktopConfig)).digest('hex') && report.body.hashAtWrite === crypto.createHash('sha256').update(original).digest('hex') && entries.length === 1 && report.body.backupManifestId === entries[0].id);
    ok('the server is gone and unrelated entries survive', !after.mcpServers.fetch && after.mcpServers.filesystem && after.mcpServers['1password'] && after.theme === 'keep-me');
    ok('the manifest entry names the proposal, the backup matches the original and is owner-only', entries[0].proposalId === applyProposal && entries[0].action === 'remove_server' && fs.readFileSync(entries[0].backup).equals(original) && (fs.statSync(entries[0].backup).mode & 0o777) === 0o600 && entries[0].backupHash === report.body.hashAtWrite);
    const rescan = ws.byRoute('rescan').at(-1);
    ok('the rescan report carries the remaining exposure keys of that agent and the file hash', rescan && rescan.body.proposalId === applyProposal && Array.isArray(rescan.body.exposureKeys) && rescan.body.exposureKeys.every(key => !ws.proposals.get(applyProposal).binding.expectedExposureKeys.includes(key)) && rescan.body.configHash === report.body.appliedHash && sameVersions(rescan.body.versions));
    ok('the workspace verifies and the output never calls the acknowledgement a fix', ws.proposals.get(applyProposal).state === 'verified' && applied.stdout.includes("reported, awaiting the workspace's rescan grade") && applied.stdout.indexOf("awaiting the workspace's rescan grade") < applied.stdout.indexOf('rescan graded verified'));
    ok('the output names the undo command and prints no secret', applied.stdout.includes(`boppi rollback --id ${entries[0].id}`) && !applied.stdout.includes('SUPERSECRETVALUE'));
    const claims = JSON.parse(fs.readFileSync(connect.claimsFile(home), 'utf8'));
    ok('no claim stays pending and the nonce is remembered as consumed', Object.keys(claims.pending).length === 0 && claims.consumed.includes(report.body.nonce));

    section('--once twice is idempotent');
    const again = await runCli(['connect', 'run', '--once', '--yes'], home);
    ok('a second run applies nothing and sends no second applied report', again.code === 0 && ws.byRoute('applied').length === appliedBefore + 1 && manifestEntries().length === 1 && JSON.parse(fs.readFileSync(desktopConfig, 'utf8')).mcpServers.filesystem);
    ws.proposals.get(applyProposal).state = 'approved';
    const replayedApproval = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.proposals.get(applyProposal).state = 'verified';
    ok('an approved proposal this machine already applied is refused locally', replayedApproval.stdout.includes('already applied on this machine') && ws.byRoute('applied').length === appliedBefore + 1 && ws.byRoute('claim').filter(r => r.body.proposalId === applyProposal).length === 1);

    section('rollback from the dashboard');
    const rollbackOffers = () => ws.byRoute('poll').at(-1).body.offers.filter(o => o.action === 'rollback');
    const rollbackOffer = rollbackOffers()[0];
    const backupFile = entries[0].backup;
    const removedBytes = fs.readFileSync(desktopConfig);
    ok('the unchanged removal offers a rollback bound to the manifest and project', rollbackOffers().length === 1 && rollbackOffer.backupManifestId === entries[0].id && rollbackOffer.project === offers[0].project && rollbackOffer.configHash === report.body.appliedHash && HEX64.test(rollbackOffer.previewHash) && rollbackOffer.expectedExposureKeys.length === 0 && rollbackOffer.capabilityLoss.length === 0);
    ok('rollback offers send no backup path, contents or env values', !JSON.stringify(rollbackOffer).includes(home) && !JSON.stringify(rollbackOffer).includes('SUPERSECRETVALUE') && !JSON.stringify(rollbackOffer).includes('/'));
    fs.writeFileSync(backupFile, 'tampered backup');
    await runCli(['connect', 'run', '--once'], home);
    ok('a tampered backup is never offered', rollbackOffers().length === 0 && fs.readFileSync(desktopConfig).equals(removedBytes));
    fs.unlinkSync(backupFile);
    await runCli(['connect', 'run', '--once'], home);
    ok('a missing backup is never offered', rollbackOffers().length === 0);
    fs.writeFileSync(aside, original);
    fs.symlinkSync(aside, backupFile);
    await runCli(['connect', 'run', '--once'], home);
    ok('a symlinked backup is never offered', rollbackOffers().length === 0);
    fs.unlinkSync(backupFile);
    fs.unlinkSync(aside);
    fs.writeFileSync(backupFile, original, { mode: 0o600 });
    fs.renameSync(desktopConfig, aside);
    fs.symlinkSync(aside, desktopConfig);
    await runCli(['connect', 'run', '--once'], home);
    ok('a symlinked config is never offered for rollback', rollbackOffers().length === 0);
    fs.unlinkSync(desktopConfig);
    fs.renameSync(aside, desktopConfig);
    fs.appendFileSync(desktopConfig, '\n');
    await runCli(['connect', 'run', '--once'], home);
    ok('a newer config is never offered for rollback', rollbackOffers().length === 0);
    fs.writeFileSync(desktopConfig, removedBytes);
    const otherProject = await runCli(['connect', 'run', '--once'], home, { BOPPI_TEST_CWD: root });
    ok('a different project cannot offer this connector removal', otherProject.code === 0 && rollbackOffers().length === 0);
    await runCli(['connect', 'run', '--once'], home);
    const corruptRollback = ws.proposeRollback(applyProposal);
    await runCli(['connect', 'run', '--once'], home);
    ws.approve(corruptRollback);
    ws.onClaim = () => fs.writeFileSync(backupFile, 'changed after claim');
    const refusedRollback = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.onClaim = null;
    ok('backup integrity is rechecked after claim and no write occurs on corruption', refusedRollback.code === 0 && refusedRollback.stdout.includes('not written (backup_failed)') && ws.proposals.get(corruptRollback).state === 'conflicted' && manifestEntries().length === 1 && fs.readFileSync(desktopConfig).equals(removedBytes));
    fs.writeFileSync(backupFile, original);
    await runCli(['connect', 'run', '--once'], home);
    const changedRollback = ws.proposeRollback(applyProposal);
    await runCli(['connect', 'run', '--once'], home);
    ws.approve(changedRollback);
    ws.onClaim = () => fs.appendFileSync(desktopConfig, '\n');
    const refusedNewer = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.onClaim = null;
    ok('the config hash is rechecked after claim and preserves a concurrent edit', refusedNewer.code === 0 && refusedNewer.stdout.includes('not written (hash_changed)') && manifestEntries().length === 1 && fs.readFileSync(desktopConfig).equals(Buffer.concat([removedBytes, Buffer.from('\n')])));
    fs.writeFileSync(desktopConfig, removedBytes);
    await runCli(['connect', 'run', '--once'], home);
    const rollbackProposal = ws.proposeRollback(applyProposal);
    const rollbackPreview = await runCli(['connect', 'run', '--once'], home);
    ok('a rollback preview matches without writing', rollbackPreview.code === 0 && ws.proposals.get(rollbackProposal).state === 'previewed' && fs.readFileSync(desktopConfig).equals(removedBytes));
    ws.approve(rollbackProposal);
    const restoreWaiting = await runCli(['connect', 'run', '--once'], home);
    ok('rollback waits for local confirmation and renders a sanitized restore diff', restoreWaiting.code === 0 && restoreWaiting.stdout.includes('restore "fetch" to claude-desktop') && restoreWaiting.stdout.includes('restore "fetch" from the verified local backup') && /\+\s+"fetch"/.test(restoreWaiting.stdout) && !restoreWaiting.stdout.includes('SUPERSECRETVALUE') && ws.proposals.get(rollbackProposal).state === 'approved' && fs.readFileSync(desktopConfig).equals(removedBytes));
    const restored = await runCli(['connect', 'run', '--once', '--yes'], home);
    const rollbackReport = ws.byRoute('applied').at(-1).body;
    const restoreEntry = manifestEntries().at(-1);
    ok('approved rollback restores the exact original bytes with file mode preserved', restored.code === 0 && fs.readFileSync(desktopConfig).equals(original) && (fs.statSync(desktopConfig).mode & 0o777) === 0o644);
    ok('rollback records its proposal and restoredFrom, hashes, backup and new manifest id', manifestEntries().length === 2 && restoreEntry.action === 'rollback' && restoreEntry.restoredFrom === entries[0].id && restoreEntry.proposalId === rollbackProposal && restoreEntry.backup === backupFile && restoreEntry.backupHash === report.body.appliedHash && restoreEntry.appliedHash === entries[0].backupHash && rollbackReport.backupManifestId === restoreEntry.id && rollbackReport.appliedHash === entries[0].backupHash);
    ok('rescan verifies restoration even when original exposure keys return', ws.proposals.get(rollbackProposal).state === 'verified' && ws.proposals.get(applyProposal).state === 'rolled_back' && ws.byRoute('rescan').at(-1).body.exposureKeys.some(key => ws.proposals.get(applyProposal).binding.expectedExposureKeys.includes(key)) && restored.stdout.includes('configuration hash matches the restored backup') && !restored.stdout.includes('server entry was observed absent') && !restored.stdout.includes('undo with boppi rollback --id rollback-'));
    const listed = await runCli(['rollback'], home);
    ok('boppi rollback lists the connector fix as rolled back', listed.code === 0 && listed.stdout.includes('(rolled back)'));
    const reportsAfterRollback = ws.byRoute('applied').length;
    await runCli(['connect', 'run', '--once', '--yes'], home);
    ok('a restored manifest entry is no longer offered', rollbackOffers().length === 0 && ws.byRoute('applied').length === reportsAfterRollback);
    ws.proposals.get(rollbackProposal).state = 'approved';
    const restoreReplay = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.proposals.get(rollbackProposal).state = 'verified';
    ok('a rollback approval already in the manifest is refused locally', restoreReplay.stdout.includes('already applied on this machine') && ws.byRoute('applied').length === reportsAfterRollback && manifestEntries().length === 2);

    section('a replayed nonce');
    fs.writeFileSync(desktopConfig, original);
    await runCli(['connect', 'run', '--once'], home);
    const replayProposal = ws.propose(fetchKey);
    await runCli(['connect', 'run', '--once'], home);
    ws.approve(replayProposal);
    ws.replayNonce = report.body.nonce;
    const replayed = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.replayNonce = null;
    ok('a nonce this device already answered is refused before anything is written', replayed.stdout.includes('already answered') && ws.byRoute('applied').length === reportsAfterRollback && fs.readFileSync(desktopConfig).equals(original) && manifestEntries().length === 2);

    section('an unanswered claim from a crashed run');
    const crashed = { id: crypto.randomUUID(), state: 'executing', approvedAt: null, binding: { ...ws.proposals.get(applyProposal).binding }, nonce: crypto.randomBytes(16).toString('hex') };
    ws.proposals.set(crashed.id, crashed);
    ws.issued.set(crashed.id, crashed.nonce);
    fs.writeFileSync(connect.claimsFile(home), JSON.stringify({ schemaVersion: 1, pending: { [crashed.id]: { nonce: crashed.nonce, targetFile: crashed.binding.targetFile, client: 'claude-desktop', server: 'fetch', claimedAt: new Date().toISOString() } }, consumed: claims.consumed }));
    const recovered = await runCli(['connect', 'run', '--once'], home);
    const crashReport = ws.byRoute('applied').find(r => r.body.proposalId === crashed.id);
    ok('the proposal is reported as other and the claim is cleared', recovered.code === 0 && crashReport && crashReport.body.failureCode === 'other' && crashReport.body.nonce === crashed.nonce && ws.proposals.get(crashed.id).state === 'conflicted' && Object.keys(JSON.parse(fs.readFileSync(connect.claimsFile(home), 'utf8')).pending).length === 0);

    section('an unanswered rollback claim with a completed manifest');
    const restoreNonce = crypto.randomBytes(16).toString('hex');
    ws.proposals.get(rollbackProposal).state = 'executing';
    ws.issued.set(rollbackProposal, restoreNonce);
    const savedClaims = JSON.parse(fs.readFileSync(connect.claimsFile(home), 'utf8'));
    fs.writeFileSync(connect.claimsFile(home), JSON.stringify({ ...savedClaims, pending: { [rollbackProposal]: { nonce: restoreNonce, targetFile: rollbackOffer.targetFile, client: rollbackOffer.client, server: rollbackOffer.server, claimedAt: new Date().toISOString() } } }));
    const recoveredRestore = await runCli(['connect', 'run', '--once'], home);
    const restoreRecovery = ws.byRoute('applied').at(-1).body;
    ok('the completed rollback is reported from its manifest without writing again', recoveredRestore.code === 0 && restoreRecovery.proposalId === rollbackProposal && restoreRecovery.backupManifestId === restoreEntry.id && restoreRecovery.hashAtWrite === restoreEntry.backupHash && restoreRecovery.appliedHash === restoreEntry.appliedHash && manifestEntries().length === 2 && fs.readFileSync(desktopConfig).equals(original));
    ok('the same cycle then grades the reported rollback from its scan', recoveredRestore.stdout.includes('applied as manifest') && recoveredRestore.stdout.includes('rescan graded verified') && ws.proposals.get(rollbackProposal).state === 'verified' && ws.byRoute('rescan').at(-1).body.proposalId === rollbackProposal);

    section('a rescan lost after the apply');
    ws.locks.clear();
    fs.writeFileSync(desktopConfig, original);
    await runCli(['connect', 'run', '--once'], home);
    const lostProposal = ws.propose(fetchKey);
    await runCli(['connect', 'run', '--once'], home);
    ws.approve(lostProposal);
    ws.dropRescanOnce = true;
    const lost = await runCli(['connect', 'run', '--once', '--yes'], home);
    ok('the edit is applied and reported, and the dropped rescan leaves the proposal applied with a problem exit', lost.code === 5 && lost.stdout.includes('applied locally') && lost.stderr.includes('could not reach the workspace for rescan') && lost.stderr.includes('sent on the next run') && !ws.dropRescanOnce && ws.proposals.get(lostProposal).state === 'applied' && manifestEntries().length === 3);
    const reportsBeforeGrade = ws.byRoute('applied').length;
    const graded = await runCli(['connect', 'run', '--once'], home);
    ok('the next run grades the applied proposal from its own scan without writing or reporting again', graded.code === 0 && graded.stdout.includes(`${lostProposal}  applied as manifest ${manifestEntries()[2].id}`) && graded.stdout.includes('rescan graded verified') && ws.proposals.get(lostProposal).state === 'verified' && ws.byRoute('applied').length === reportsBeforeGrade && ws.byRoute('rescan').filter(r => r.body.proposalId === lostProposal).length === 2 && ws.byRoute('rescan').at(-1).body.proposalId === lostProposal && manifestEntries().length === 3);
    const foreign = { id: crypto.randomUUID(), state: 'applied', approvedAt: null, binding: { ...ws.proposals.get(lostProposal).binding }, nonce: crypto.randomBytes(16).toString('hex'), appliedHash: ws.proposals.get(lostProposal).appliedHash };
    ws.proposals.set(foreign.id, foreign);
    const foreignRun = await runCli(['connect', 'run', '--once'], home);
    ok('an applied proposal this machine never wrote is named but never graded from here', foreignRun.code === 0 && foreignRun.stdout.includes(`${foreign.id}  applied, awaiting a rescan, but this machine holds no manifest entry`) && ws.proposals.get(foreign.id).state === 'applied' && !ws.byRoute('rescan').some(r => r.body.proposalId === foreign.id));
    ws.proposals.delete(foreign.id);

    section('workspace URL rule at run time');
    const requestsBefore = ws.requests.length;
    fs.writeFileSync(pairingFile, JSON.stringify({ ...pairing, url: 'http://example.com' }));
    const refused = await runCli(['connect', 'run', '--once'], home);
    ok('run refuses a stored non-loopback http workspace before any request', refused.code === 2 && refused.stderr.includes('https') && ws.requests.length === requestsBefore);
    fs.writeFileSync(pairingFile, JSON.stringify(pairing));

    section('unpair');
    const unpair = await runCli(['connect', 'unpair'], home);
    ok('unpair deletes the pairing and the claims file and says the workspace still lists the device', unpair.code === 0 && !fs.existsSync(pairingFile) && !fs.existsSync(connect.claimsFile(home)) && unpair.stdout.includes('revoked'));
  } finally {
    workspace.server.close();
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
