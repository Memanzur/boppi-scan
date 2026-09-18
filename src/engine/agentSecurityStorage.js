/** Versioned, bounded local persistence for Agent Security metadata. */
(function (root, factory) {
  const models = typeof require === 'function' ? require('./models') : globalThis.BoppiAgentSecurityModels;
  const integrity = typeof require === 'function' ? require('./eventIntegrity') : globalThis.BoppiAgentSecurityEventIntegrity;
  const api = factory(models, integrity);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentSecurityStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (models, integrity) {
  'use strict';
  const SCHEMA_VERSION = 1;
  const KEYS = Object.freeze({ STATE:'boppi_agent_security_v1_state', STAGING:'boppi_agent_security_v1_staging', LAST_GOOD:'boppi_agent_security_v1_last_good' });
  const LIMITS = Object.freeze({ scans:50, events:1000, agents:5000, integrations:10000, permissions:25000, mcpServers:10000, findings:10000, identities:500, remediations:5000, comments:10000 });
  function emptyInventory() { return { agents:[], integrations:[], permissions:[], mcpServers:[], findings:[] }; }
  function emptyState() { return { schemaVersion:SCHEMA_VERSION, real:emptyInventory(), sample:emptyInventory(), identities:[], remediations:[], comments:[], scans:[], events:[], providerState:{}, eventIntegrity:{ valid:true, legacy:false, reason:null, checked:0 }, updatedAt:null }; }
  function chromeAdapter() {
    return {
      async get(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); },
      async set(value) { return new Promise((resolve, reject) => chrome.storage.local.set(value, () => chrome.runtime?.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve())); },
      async remove(keys) { return new Promise(resolve => chrome.storage.local.remove(keys, resolve)); },
    };
  }
  function memoryAdapter(initial) {
    const data = { ...(initial || {}) };
    return { async get(keys) { const out = {}; for (const k of keys) if (data[k] !== undefined) out[k] = data[k]; return out; }, async set(value) { Object.assign(data, value); }, async remove(keys) { for (const k of keys) delete data[k]; }, _data:data };
  }
  function bounded(value, key) { return Array.isArray(value) ? value.slice(-LIMITS[key]) : []; }
  function sanitizeState(state) {
    const input = state && typeof state === 'object' ? state : emptyState();
    const out = { ...emptyState(), ...input, schemaVersion:SCHEMA_VERSION };
    for (const bucket of ['real','sample']) {
      out[bucket] = { ...emptyInventory(), ...(input[bucket] || {}) };
      out[bucket].agents = bounded(out[bucket].agents, 'agents');
      out[bucket].integrations = bounded(out[bucket].integrations, 'integrations');
      out[bucket].permissions = bounded(out[bucket].permissions, 'permissions');
      out[bucket].mcpServers = bounded(out[bucket].mcpServers, 'mcpServers');
      out[bucket].findings = bounded(out[bucket].findings, 'findings');
    }
    out.identities = bounded(out.identities, 'identities');
    out.remediations = bounded(out.remediations, 'remediations');
    out.comments = bounded(out.comments, 'comments');
    out.scans = bounded(out.scans, 'scans');
    out.events = bounded(out.events, 'events');
    out.providerState = input.providerState && typeof input.providerState === 'object' ? { ...input.providerState } : {};
    out.eventIntegrity = input.eventIntegrity && typeof input.eventIntegrity === 'object' ? { ...input.eventIntegrity } : emptyState().eventIntegrity;
    return out;
  }
  function createStorage(adapter = null) {
    const io = adapter || chromeAdapter();
    async function load() {
      const result = await io.get([KEYS.STATE, KEYS.LAST_GOOD]);
      if (!result[KEYS.STATE] && result[KEYS.LAST_GOOD]) {
        const lastGood = sanitizeState(result[KEYS.LAST_GOOD]);
        lastGood.eventIntegrity = await integrity.verifyEvents(lastGood.events);
        return lastGood;
      }
      const current = sanitizeState(result[KEYS.STATE] || emptyState());
      const currentIntegrity = await integrity.verifyEvents(current.events);
      if (result[KEYS.STATE] && !currentIntegrity.valid && result[KEYS.LAST_GOOD]) {
        const lastGood = sanitizeState(result[KEYS.LAST_GOOD]);
        const lastGoodIntegrity = await integrity.verifyEvents(lastGood.events);
        if (lastGoodIntegrity.valid || lastGoodIntegrity.legacy) {
          lastGood.eventIntegrity = lastGoodIntegrity;
          lastGood.recoveredFromCorruptState = true;
          return lastGood;
        }
      }
      const state = result[KEYS.STATE] ? current : emptyState();
      state.eventIntegrity = currentIntegrity;
      return state;
    }
    async function commit(state) {
      const safe = sanitizeState(state);
      safe.events = await integrity.sealEvents(safe.events);
      safe.eventIntegrity = await integrity.verifyEvents(safe.events);
      safe.updatedAt = new Date().toISOString();
      try {
        await io.set({ [KEYS.STAGING]:safe });
        await io.set({ [KEYS.STATE]:safe, [KEYS.LAST_GOOD]:safe });
        await io.remove([KEYS.STAGING]);
        return safe;
      } catch (error) {
        try { await io.remove([KEYS.STAGING]); } catch (_) {}
        throw error;
      }
    }
    async function clearSampleData() {
      const state = await load();
      state.sample = emptyInventory();
      state.remediations = (state.remediations || []).filter(t => t.dataset !== 'sample');
      state.comments = (state.comments || []).filter(c => c.dataset !== 'sample');
      return commit(state);
    }
    async function clearAgentSecurityData() { return commit(emptyState()); }
    async function getLegacyEvidence() {
      const result = await io.get(['boppi_audit','boppi_events']);
      return { auditData:result.boppi_audit || null, events:Array.isArray(result.boppi_events) ? result.boppi_events : [] };
    }
    // Expose the adapter only for sibling Agent Security stores (such as the
    // browser-observation store) so tests and migrations can share one atomic
    // local boundary. It is not exposed to providers or page content.
    return { load, commit, clearSampleData, clearAgentSecurityData, getLegacyEvidence, KEYS, LIMITS, adapter: io };
  }
  return { SCHEMA_VERSION, KEYS, LIMITS, emptyState, memoryAdapter, createStorage, sanitizeState };
});
