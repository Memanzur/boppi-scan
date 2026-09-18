/** Discovery-provider registry. Providers never receive persistence access. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiAgentSecurityProviderRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createProviderRegistry(initial = []) {
    const providers = new Map();
    function register(provider) {
      if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) throw new TypeError('Provider id is required');
      if (typeof provider.version !== 'string' || typeof provider.name !== 'string') throw new TypeError(`Provider ${provider.id} needs version and name`);
      for (const method of ['isAvailable','scan','normalize']) if (typeof provider[method] !== 'function') throw new TypeError(`Provider ${provider.id} is missing ${method}()`);
      if (providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
      providers.set(provider.id, provider);
      return provider;
    }
    function get(id) { return providers.get(id) || null; }
    function list() { return [...providers.values()]; }
    for (const provider of initial) register(provider);
    return { register, get, list };
  }
  return { createProviderRegistry };
});
