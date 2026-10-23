/**
 * The synthetic environments behind `boppi demo`. Every value in the fixture
 * files is fake; the scanner still runs on them unchanged, so the paths and
 * fixes the page shows come from the real engine.
 */
'use strict';

const BANNER = 'Synthetic demo environment. Nothing on your computer was scanned.';
const SIMULATED = 'Simulated. No file was changed.';
const SANDBOX_SCENARIO = 'broad-filesystem';

/**
 * `client` is the agent the fixture stands for. Claude Desktop has no built-in
 * tools, so its paths come only from the servers and one removal can close
 * them all; Claude Code reads files, runs commands, and fetches web pages
 * through its own tools, so some paths stay open at a lower priority.
 */
const SCENARIOS = Object.freeze([
  {
    id: 'tidy-workstation', file: 'tidy-workstation.json', title: 'Tidy workstation', client: 'claude-desktop',
    summary: 'A memory server and a time server in Claude Desktop. This synthetic configuration has no potential exposure path supported by the scanner. A clean configuration scan does not prove runtime safety.',
    expect: [],
  },
  {
    id: 'broad-filesystem', file: 'broad-filesystem.json', title: 'Broad filesystem', client: 'claude-desktop',
    summary: 'A filesystem server pointed at the whole home directory, next to a GitHub connector with a token, in Claude Desktop. Anything the agent can read, it can also send somewhere. Removing the GitHub connector closes the path; removing the filesystem server only lowers it, because the connector can still read its own token.',
    expect: ['EP-A'],
  },
  {
    id: 'sensitive-files-network', file: 'sensitive-files-network.json', title: 'Sensitive files plus network', client: 'claude-code',
    summary: 'A filesystem server scoped to a finance folder, a web fetch server, and a Slack connector, in Claude Code. Removing the fetch server changes nothing, because Claude Code fetches web pages through its own built-in tools, and the fetched pages reach an agent whose built-in shell can run commands.',
    expect: ['EP-A', 'EP-B', 'EP-E'],
  },
  {
    id: 'untrusted-to-privileged', file: 'untrusted-to-privileged.json', title: 'Untrusted content to privileged tool', client: 'claude-code',
    summary: 'A browser automation server, a shell server, and a Postgres server whose connection string lives in an environment variable, in Claude Code. Untrusted page content could influence an agent that can run shell commands, through the shell server or through its own built-in tools. This is potential access, not observed behavior.',
    expect: ['EP-A', 'EP-B', 'EP-E'],
  },
]);

module.exports = { BANNER, SIMULATED, SANDBOX_SCENARIO, SCENARIOS };
