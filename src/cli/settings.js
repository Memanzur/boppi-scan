/**
 * Local scanner settings: <home>/.boppi/settings.json.
 *
 * Every default is the privacy-preserving one. A missing or unreadable file
 * means defaults; an invalid value in the file is replaced by its default.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

const SPECS = Object.freeze({
  telemetry: { default: false, parse: parseBoolean, describe: 'boolean' },
  cloudSync: { default: false, parse: parseBoolean, describe: 'boolean' },
  retentionDays: { default: 30, parse: value => parseInteger(value, 1, 3650), describe: 'integer 1..3650' },
});

function parseBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function parseInteger(value, min, max) {
  const number = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

function settingsFile(home) { return path.join(home, '.boppi', 'settings.json'); }

function defaults() {
  return { schemaVersion: SCHEMA_VERSION, ...Object.fromEntries(Object.entries(SPECS).map(([key, spec]) => [key, spec.default])) };
}

function load(home) {
  const settings = defaults();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(settingsFile(home), 'utf8')); } catch (_) { return settings; }
  if (!raw || typeof raw !== 'object') return settings;
  for (const [key, spec] of Object.entries(SPECS)) {
    const parsed = spec.parse(raw[key]);
    if (parsed !== undefined) settings[key] = parsed;
  }
  return settings;
}

function save(home, settings) {
  const file = settingsFile(home);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Apply `key=value` assignments to the stored settings. Throws on an unknown key or an invalid value. */
function assign(home, assignments) {
  const settings = load(home);
  for (const assignment of assignments) {
    const index = assignment.indexOf('=');
    const key = index === -1 ? assignment : assignment.slice(0, index);
    const spec = SPECS[key];
    if (!spec) throw new Error(`unknown setting "${key}"; settings are ${Object.keys(SPECS).join(', ')}`);
    const parsed = index === -1 ? undefined : spec.parse(assignment.slice(index + 1));
    if (parsed === undefined) throw new Error(`${key} must be ${spec.describe}`);
    settings[key] = parsed;
  }
  save(home, settings);
  return settings;
}

function render(home, settings) {
  const lines = [`BOPPI · SETTINGS  ${settingsFile(home)}`];
  for (const [key, spec] of Object.entries(SPECS)) lines.push(`  ${key.padEnd(14)} ${String(settings[key]).padEnd(6)} (default ${spec.default}, ${spec.describe})`);
  lines.push('', 'Change one with: boppi settings --set key=value');
  return lines.join('\n');
}

module.exports = { SPECS, load, save, assign, render, settingsFile, defaults };
