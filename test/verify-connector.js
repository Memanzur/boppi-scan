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
    const child = spawn(process.execPath, [...nodeArgs, CLI, ...args, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { env: { ...process.env, BOPPI_SCAN_PLATFORM: 'darwin', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.end();
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const offerKey = o => [o.client, o.project, o.targetFile, o.server].join('|');
const VERSIONS = { scanner: require('../package.json').version, engine: models.ENGINE_VERSION, rubric: riskRubric.RUBRIC_VERSION };
const sameVersions = v => v && v.scanner === VERSIONS.scanner && v.engine === VERSIONS.engine && v.rubric === VERSIONS.rubric;

/** The workspace side of the contract, in memory: pairing, offers, proposals, locks, nonces. */
function startWorkspace() {
  const ws = { requests: [], device: null, previews: new Map(), proposals: new Map(), locks: new Map(), issued: new Map(), consumed: new Set(), onClaim: null, replayNonce: null };
  const byRoute = route => ws.requests.filter(r => r.url === `/api/connector/${route}`);
  ws.byRoute = byRoute;
  ws.propose = key => {
    const offer = ws.previews.get(key);
    if (!offer) throw new Error(`no offer ${key}`);
    const id = crypto.randomUUID();
    ws.proposals.set(id, { id, state: 'proposed', approvedAt: null, binding: { organizationId: 'org-1', deviceId: ws.device.id, client: offer.client, project: offer.project, targetFile: offer.targetFile, server: offer.server, action: 'remove_server', configHash: offer.configHash, previewHash: offer.previewHash, versions: offer.versions, expectedExposureKeys: offer.expectedExposureKeys, capabilityLoss: offer.capabilityLoss, expiresAt: new Date(Date.now() + 86400000).toISOString() }, nonce: crypto.randomBytes(16).toString('hex') });
    return id;
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
          return reply(res, 200, { proposals: [...ws.proposals.values()].filter(p => ['proposed', 'approved'].includes(p.state)).map(p => ({ id: p.id, state: p.state, binding: p.binding, approvedAt: p.approvedAt })) });
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
          if (!proposal || proposal.state !== 'applied') return reply(res, 409, { error: 'wrong_state' });
          const remainingKeys = proposal.binding.expectedExposureKeys.filter(key => (body.exposureKeys || []).includes(key));
          proposal.state = body.configHash === proposal.appliedHash && sameVersions(body.versions) && !remainingKeys.length ? 'verified' : 'verification_failed';
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

    section('a replayed nonce');
    fs.writeFileSync(desktopConfig, original);
    await runCli(['connect', 'run', '--once'], home);
    const replayProposal = ws.propose(fetchKey);
    await runCli(['connect', 'run', '--once'], home);
    ws.approve(replayProposal);
    ws.replayNonce = report.body.nonce;
    const replayed = await runCli(['connect', 'run', '--once', '--yes'], home);
    ws.replayNonce = null;
    ok('a nonce this device already answered is refused before anything is written', replayed.stdout.includes('already answered') && ws.byRoute('applied').length === appliedBefore + 1 && fs.readFileSync(desktopConfig).equals(original) && manifestEntries().length === 1);

    section('an unanswered claim from a crashed run');
    const crashed = { id: crypto.randomUUID(), state: 'executing', approvedAt: null, binding: { ...ws.proposals.get(applyProposal).binding }, nonce: crypto.randomBytes(16).toString('hex') };
    ws.proposals.set(crashed.id, crashed);
    ws.issued.set(crashed.id, crashed.nonce);
    fs.writeFileSync(connect.claimsFile(home), JSON.stringify({ schemaVersion: 1, pending: { [crashed.id]: { nonce: crashed.nonce, targetFile: crashed.binding.targetFile, client: 'claude-desktop', server: 'fetch', claimedAt: new Date().toISOString() } }, consumed: claims.consumed }));
    const recovered = await runCli(['connect', 'run', '--once'], home);
    const crashReport = ws.byRoute('applied').find(r => r.body.proposalId === crashed.id);
    ok('the proposal is reported as other and the claim is cleared', recovered.code === 0 && crashReport && crashReport.body.failureCode === 'other' && crashReport.body.nonce === crashed.nonce && ws.proposals.get(crashed.id).state === 'conflicted' && Object.keys(JSON.parse(fs.readFileSync(connect.claimsFile(home), 'utf8')).pending).length === 0);

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
