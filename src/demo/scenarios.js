/**
 * The synthetic environments behind `boppi demo`. Every value in the fixture
 * files is fake; the scanner still runs on them unchanged, so the paths and
 * fixes the page shows come from the real engine.
 */
'use strict';

const BANNER = 'Synthetic demo environment. Nothing on your computer was scanned.';
const SIMULATED = 'Simulated. No file was changed.';
const SANDBOX_SCENARIO = 'broad-filesystem';

const SCENARIOS = Object.freeze([
  {
    id: 'tidy-workstation', file: 'tidy-workstation.json', title: 'Tidy workstation',
    summary: 'A memory server and a time server. This synthetic configuration has no potential exposure path supported by the scanner. A clean configuration scan does not prove runtime safety.',
    expect: [],
  },
  {
    id: 'broad-filesystem', file: 'broad-filesystem.json', title: 'Broad filesystem',
    summary: 'A filesystem server pointed at the whole home directory, next to a GitHub connector with a token. Anything the agent can read, it can also send somewhere, and because Claude Code reads files and runs commands through its own built-in tools, removing the filesystem server alone does not close the path.',
    expect: ['EP-A', 'EP-B'],
  },
  {
    id: 'sensitive-files-network', file: 'sensitive-files-network.json', title: 'Sensitive files plus network',
    summary: 'A filesystem server scoped to a finance folder, a web fetch server, and a Slack connector. Two separate servers each give the agent a way out, so removing one is not enough, and the fetched pages reach an agent whose built-in shell can run commands.',
    expect: ['EP-A', 'EP-B', 'EP-E'],
  },
  {
    id: 'untrusted-to-privileged', file: 'untrusted-to-privileged.json', title: 'Untrusted content to privileged tool',
    summary: 'A browser automation server, a shell server, and a Postgres server whose connection string lives in an environment variable. Untrusted page content could influence an agent that can run shell commands, through the shell server or through its own built-in tools. This is potential access, not observed behavior.',
    expect: ['EP-A', 'EP-B', 'EP-E'],
  },
]);

module.exports = { BANNER, SIMULATED, SANDBOX_SCENARIO, SCENARIOS };
