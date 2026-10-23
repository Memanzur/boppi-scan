#!/usr/bin/env node
/**
 * Bounded synthetic soak for `boppi watch` (ledger P4-3). Starts the watcher
 * on a throwaway home, samples its RSS and CPU time every second through an
 * idle phase, a burst phase, and a settle phase, and prints a Markdown report
 * against the roadmap budget (median idle CPU under 1%, memory under 100 MiB).
 * It is not the 24-hour soak; that is a founder-scheduled run of this script
 * with --idle 86400.
 *
 *   node scripts/watch-soak.js [--idle <s>] [--burst <writes>] [--settle <s>] [--interval <s>] [--report <file>]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'boppi.js');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const IDLE_S = Number(opt('--idle', 120));
const BURST = Number(opt('--burst', 200));
const SETTLE_S = Number(opt('--settle', 30));
const INTERVAL_S = Number(opt('--interval', 60));
const REPORT = opt('--report', null);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = name => ({ [name]: { command: 'node', args: [`${name}.js`] } });
function sample(pid) {
  const out = execFileSync('ps', ['-p', String(pid), '-o', 'rss=,time='], { encoding: 'utf8' }).trim();
  const [rssKb, time] = out.split(/\s+/);
  const parts = time.split(':').map(Number);
  const cpuSeconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  return { rssMiB: Number(rssKb) / 1024, cpuSeconds };
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const max = xs => xs.reduce((a, b) => Math.max(a, b), 0);

async function phase(name, pid, seconds, during) {
  const samples = [];
  let last = sample(pid), lastAt = Date.now();
  const task = during ? during() : Promise.resolve();
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await sleep(1000);
    const now = sample(pid), at = Date.now();
    samples.push({ rssMiB: now.rssMiB, cpuPct: 100 * (now.cpuSeconds - last.cpuSeconds) / ((at - lastAt) / 1000) });
    last = now; lastAt = at;
  }
  await task;
  return { name, seconds, samples, medianCpu: median(samples.map(s => s.cpuPct)), maxCpu: max(samples.map(s => s.cpuPct)), medianRss: median(samples.map(s => s.rssMiB)), maxRss: max(samples.map(s => s.rssMiB)) };
}

(async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boppi-soak-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const claudeJson = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { ...server('notes'), ...server('fetch') } }));
  const logFile = path.join(root, 'watch.log');
  const total = IDLE_S + Math.ceil(BURST / 20) + 2 + SETTLE_S + 5;
  const child = spawn(process.execPath, [CLI, 'watch', '--only', 'claude-code', '--interval', String(INTERVAL_S), '--duration', String(total), '--log', logFile, '--home', home, '--cwd', home, '--no-color', '--history-file', path.join(home, 'history.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  child.stdout.on('data', () => {});
  await sleep(1500);
  const idle = await phase('idle', child.pid, IDLE_S);
  const burstStart = Date.now();
  const burst = await phase('burst', child.pid, Math.ceil(BURST / 20) + 2, async () => {
    for (let i = 0; i < BURST; i++) { fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { ...server('notes'), ...server('fetch'), [`b${i}`]: { command: 'node', args: ['b.js'] } } })); await sleep(50); }
  });
  const settle = await phase('settle', child.pid, SETTLE_S);
  const exit = await new Promise(resolve => child.on('exit', resolve));
  const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const changes = entries.filter(e => e.kind === 'change');
  const finalSeen = changes.some(c => c.serversAdded.includes(`b${BURST - 1}`));
  const lastChangeMs = changes.length ? Date.parse(changes[changes.length - 1].at) - burstStart : null;
  const machine = `${os.platform()} ${os.release()}, ${os.cpus()[0] ? os.cpus()[0].model : 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM, node ${process.version}`;
  const pass = idle.medianCpu < 1 && max([idle.maxRss, burst.maxRss, settle.maxRss]) < 100 && finalSeen && exit === 0 && stderr.trim() === '';
  const row = p => `| ${p.name} | ${p.seconds} s | ${p.medianCpu.toFixed(2)}% | ${p.maxCpu.toFixed(1)}% | ${p.medianRss.toFixed(1)} MiB | ${p.maxRss.toFixed(1)} MiB |`;
  const report = [
    `# boppi watch soak (bounded synthetic run, ${new Date().toISOString()})`,
    '',
    `Machine: ${machine}. Interval ${INTERVAL_S} s, one watched client (Claude Code) with one config file. Idle ${IDLE_S} s, then ${BURST} writes 50 ms apart, then ${SETTLE_S} s settle. Budget from the roadmap: median idle CPU under 1%, memory under 100 MiB; a 24-hour soak is a founder-scheduled run (\`node scripts/watch-soak.js --idle 86400\`).`,
    '',
    '| Phase | Length | Median CPU | Max CPU | Median RSS | Max RSS |',
    '| --- | --- | --- | --- | --- | --- |',
    row(idle), row(burst), row(settle),
    '',
    `Burst: ${changes.length} change summaries for ${BURST} writes; final state (server b${BURST - 1}) ${finalSeen ? 'reported' : 'NOT reported'}; last summary ${lastChangeMs === null ? 'none' : `${(lastChangeMs / 1000).toFixed(1)} s after the burst started`}. Exit code ${exit}; stderr ${stderr.trim() ? 'non-empty' : 'empty'}.`,
    '',
    `Result: ${pass ? 'within budget on this run' : 'OUT OF BUDGET or failed on this run'}. This is a ${IDLE_S + SETTLE_S + Math.ceil(BURST / 20)}-second run, not a 24-hour soak.`,
    '',
  ].join('\n');
  process.stdout.write(report);
  if (REPORT) fs.writeFileSync(REPORT, report);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(pass ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
