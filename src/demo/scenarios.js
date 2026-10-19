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
    summary: 'A memory server and a time server. Neither reads files, runs commands, or talks to the network, so there is nothing for an attacker to chain together.',
    expect: [],
  },
  {
    id: 'broad-filesystem', file: 'broad-filesystem.json', title: 'Broad filesystem',
    summary: 'A filesystem server pointed at the whole home directory, next to a GitHub connector. Anything the agent can read, it can also send somewhere.',
    expect: ['EP-A'],
  },
  {
    id: 'sensitive-files-network', file: 'sensitive-files-network.json', title: 'Sensitive files plus network',
    summary: 'A filesystem server scoped to a finance folder, a web fetch server, and a Slack connector. Two separate servers each give the agent a way out, so removing one is not enough.',
    expect: ['EP-A'],
  },
  {
    id: 'untrusted-to-privileged', file: 'untrusted-to-privileged.json', title: 'Untrusted content to privileged tool',
    summary: 'A browser automation server, a shell server, and a Postgres server whose connection string lives in an environment variable. Web pages the browser visits can carry instructions, and the shell will follow them.',
    expect: ['EP-B', 'EP-E'],
  },
]);

module.exports = { BANNER, SIMULATED, SANDBOX_SCENARIO, SCENARIOS };
