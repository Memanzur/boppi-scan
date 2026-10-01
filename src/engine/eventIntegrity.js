/** Hash-linked integrity for sanitized Agent Security events. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentSecurityEventIntegrity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const ALGORITHM = 'SHA-256';
  const GENESIS = 'GENESIS';

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => k !== 'integrity').sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value ?? null);
  }
  async function digest(value) {
    const input = canonical(value);
    const cryptoApi = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
    if (cryptoApi?.subtle && typeof TextEncoder !== 'undefined') {
      const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    // Keep the Node 18 path cryptographic too. A short non-cryptographic hash
    // would make local storage integrity forgeable by an attacker who can edit
    // the extension's persisted state.
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        return require('crypto').createHash('sha256').update(input, 'utf8').digest('hex');
      } catch (_) {}
    }
    throw new Error('SHA-256 is unavailable; refusing to create an unauthenticated integrity record');
  }
  async function sealEvents(events = []) {
    let previousHash = GENESIS;
    const sealed = [];
    for (let index = 0; index < (Array.isArray(events) ? events : []).length; index++) {
      const event = events[index] && typeof events[index] === 'object' ? { ...events[index] } : { type:'unknown' };
      delete event.integrity;
      const body = { ...event, integrityVersion:VERSION, sequence:index, previousHash };
      const hash = await digest(body);
      const next = { ...body, integrity:{ version:VERSION, algorithm:ALGORITHM, hash } };
      sealed.push(next);
      previousHash = hash;
    }
    return sealed;
  }
  async function verifyEvents(events = []) {
    if (!Array.isArray(events)) return { valid:false, legacy:false, reason:'events_not_array', checked:0 };
    let previousHash = GENESIS;
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (!event?.integrity?.hash) return { valid:false, legacy:true, reason:'legacy_unsealed_event', index, checked:index };
      if (event.integrity.version !== VERSION || event.integrity.algorithm !== ALGORITHM) return { valid:false, legacy:false, reason:'unsupported_integrity_version', index, checked:index };
      if (event.sequence !== index || event.previousHash !== previousHash) return { valid:false, legacy:false, reason:'chain_link_mismatch', index, checked:index };
      const body = { ...event };
      delete body.integrity;
      const expected = await digest(body);
      if (expected !== event.integrity.hash) return { valid:false, legacy:false, reason:'event_hash_mismatch', index, checked:index };
      previousHash = event.integrity.hash;
    }
    return { valid:true, legacy:false, reason:null, checked:events.length, headHash:previousHash };
  }
  return { VERSION, ALGORITHM, GENESIS, canonical, digest, sealEvents, verifyEvents };
});
