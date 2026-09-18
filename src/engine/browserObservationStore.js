/**
 * Dedicated Agent Security browser-observation storage.
 *
 * This store records only sanitized AI-application visit metadata. It is
 * intentionally separate from Data Protection's legacy audit and event keys.
 * A one-time compatibility migration imports old site-visit metadata, after
 * which Agent Security reads this key rather than the legacy DLP stores.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentSecurityBrowserObservationStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const KEY = 'boppi_agent_security_v1_browser_observations';
  const MAX_OBSERVATIONS = 5000;
  const MAX_STRING = 120;
  const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      observations: [],
      legacyMigratedAt: null,
      updatedAt: null,
    };
  }

  function chromeAdapter() {
    return {
      async get(keys) {
        return new Promise((resolve, reject) => {
          try {
            chrome.storage.local.get(keys, (result) => {
              if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(result || {});
            });
          } catch (error) { reject(error); }
        });
      },
      async set(value) {
        return new Promise((resolve, reject) => {
          try {
            chrome.storage.local.set(value, () => {
              if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve();
            });
          } catch (error) { reject(error); }
        });
      },
    };
  }

  function memoryAdapter(initial) {
    const data = { ...(initial || {}) };
    return {
      async get(keys) {
        const result = {};
        for (const key of keys) if (data[key] !== undefined) result[key] = data[key];
        return result;
      },
      async set(value) { Object.assign(data, value); },
      async remove(keys) { for (const key of keys) delete data[key]; },
      _data: data,
    };
  }

  function safeString(value, fallback = null) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    const clean = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return clean ? clean.slice(0, MAX_STRING) : fallback;
  }

  function safeHost(value) {
    const text = safeString(value);
    if (!text) return null;
    try {
      const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      const host = new URL(candidate).hostname.toLowerCase();
      return host && host.length <= MAX_STRING ? host : null;
    } catch (_) {
      return null;
    }
  }

  function safeTimestamp(value, fallback = Date.now()) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return new Date(number).toISOString();
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    return new Date(fallback).toISOString();
  }

  function toolIdFor(value) {
    const text = safeString(value, 'unknown-ai-tool').toLowerCase();
    return text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, MAX_STRING) || 'unknown-ai-tool';
  }

  function normalizeObservation(input, fallbackNow = Date.now()) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const name = safeString(value.name || value.aiTool || value.toolName);
    const toolId = toolIdFor(value.toolId || value.id || name);
    const site = safeHost(value.site || value.host || value.url);
    if (!name && toolId === 'unknown-ai-tool') return null;
    const observedAt = safeTimestamp(value.observedAt || value.timestamp || value.lastSeenAt, fallbackNow);
    const sourceHistory = Array.isArray(value.sourceHistory)
      ? value.sourceHistory.slice(0, 5).map(item => safeString(item)).filter(Boolean)
      : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      id: `${toolId}:${site || 'unknown-site'}`,
      toolId,
      name: name || toolId,
      vendor: safeString(value.vendor, 'Unknown vendor'),
      site,
      firstSeenAt: safeTimestamp(value.firstSeenAt || observedAt, fallbackNow),
      lastSeenAt: safeTimestamp(value.lastSeenAt || observedAt, fallbackNow),
      observationCount: Math.max(1, Math.min(100000, Number(value.observationCount) || 1)),
      sourceHistory: [...new Set(['browser-observation', ...sourceHistory])].slice(0, 5),
      evidenceClass: 'observed',
    };
  }

  function mergeObservation(existing, incoming) {
    const a = normalizeObservation(existing) || incoming;
    const b = normalizeObservation(incoming) || existing;
    const first = Math.min(Date.parse(a.firstSeenAt) || Date.now(), Date.parse(b.firstSeenAt) || Date.now());
    const last = Math.max(Date.parse(a.lastSeenAt) || 0, Date.parse(b.lastSeenAt) || 0);
    return {
      ...a,
      ...b,
      firstSeenAt: new Date(first).toISOString(),
      lastSeenAt: new Date(last).toISOString(),
      observationCount: Math.min(100000, (Number(a.observationCount) || 0) + (Number(b.observationCount) || 0)),
      sourceHistory: [...new Set([...(a.sourceHistory || []), ...(b.sourceHistory || [])])].slice(0, 5),
      evidenceClass: 'observed',
    };
  }

  function sanitizeState(input) {
    const state = input && typeof input === 'object' ? input : {};
    const byId = new Map();
    for (const item of Array.isArray(state.observations) ? state.observations : []) {
      const normalized = normalizeObservation(item);
      if (!normalized) continue;
      byId.set(normalized.id, byId.has(normalized.id) ? mergeObservation(byId.get(normalized.id), normalized) : normalized);
    }
    return {
      ...emptyState(),
      schemaVersion: SCHEMA_VERSION,
      observations: [...byId.values()].slice(-MAX_OBSERVATIONS),
      legacyMigratedAt: state.legacyMigratedAt || null,
      updatedAt: state.updatedAt || null,
    };
  }

  function legacyObservations(legacy = {}) {
    const rows = [];
    const auditVisits = Array.isArray(legacy.auditData?.siteVisits) ? legacy.auditData.siteVisits : [];
    for (const visit of auditVisits) {
      rows.push({ name: visit.aiTool, site: visit.site || visit.url, timestamp: visit.timestamp, sourceHistory: ['legacy-boppi-audit'] });
    }
    const events = Array.isArray(legacy.events) ? legacy.events : [];
    for (const event of events) {
      if (!event || event.type !== 'ai_tool_visit') continue;
      rows.push({ name: event.toolName || event.tool || event.aiTool, site: event.site, timestamp: event.timestamp, sourceHistory: ['legacy-boppi-events'] });
    }
    return rows.map(row => normalizeObservation(row)).filter(Boolean);
  }

  function mergeRows(rows) {
    const byId = new Map();
    for (const row of rows) {
      const normalized = normalizeObservation(row);
      if (!normalized) continue;
      byId.set(normalized.id, byId.has(normalized.id) ? mergeObservation(byId.get(normalized.id), normalized) : normalized);
    }
    return [...byId.values()].slice(-MAX_OBSERVATIONS);
  }

  function createStore(adapter = null, clock = Date) {
    const io = adapter || chromeAdapter();
    async function readRaw() {
      const result = await io.get([KEY]);
      return sanitizeState(result[KEY]);
    }
    async function write(state) {
      const safe = sanitizeState(state);
      safe.updatedAt = new Date(clock.now()).toISOString();
      await io.set({ [KEY]: safe });
      return safe;
    }
    async function readLegacy() {
      try {
        const result = await io.get(['boppi_audit', 'boppi_events']);
        return { auditData: result.boppi_audit || null, events: Array.isArray(result.boppi_events) ? result.boppi_events : [] };
      } catch (_) {
        return { auditData: null, events: [] };
      }
    }
    async function load(legacy) {
      const current = await readRaw();
      if (current.legacyMigratedAt) return current;
      const source = legacy === undefined ? await readLegacy() : legacy;
      const migrated = {
        ...current,
        observations: mergeRows([...current.observations, ...legacyObservations(source)]),
        legacyMigratedAt: new Date(clock.now()).toISOString(),
      };
      return write(migrated);
    }
    async function recordVisit(input) {
      const current = await load();
      const next = normalizeObservation(input, clock.now());
      if (!next) return current;
      const existing = current.observations.find(item => item.id === next.id);
      const last = existing ? Date.parse(existing.lastSeenAt) : 0;
      const increment = last && (Date.parse(next.lastSeenAt) - last) < DEDUPE_WINDOW_MS ? 0 : 1;
      const merged = existing ? mergeObservation(existing, next) : next;
      if (existing && increment === 0) merged.observationCount = existing.observationCount;
      const observations = existing
        ? current.observations.map(item => item.id === next.id ? merged : item)
        : [...current.observations, next];
      return write({ ...current, observations });
    }
    async function migrateLegacy(legacy) {
      return load(legacy);
    }
    async function clear() { return write(emptyState()); }
    return { load, recordVisit, migrateLegacy, clear, KEY, SCHEMA_VERSION, MAX_OBSERVATIONS };
  }

  return {
    KEY,
    SCHEMA_VERSION,
    MAX_OBSERVATIONS,
    emptyState,
    normalizeObservation,
    sanitizeState,
    legacyObservations,
    memoryAdapter,
    createStore,
  };
});
