'use strict';
const { serve, initializeResult, tool } = require('./_server');
serve({ handlers: {
  initialize: () => initializeResult({ name: 'list-changed-fixture', capabilities: { tools: { listChanged: true } } }),
  'notifications/initialized': () => {},
  'tools/list': (message, { out, state }) => {
    state.listCalls += 1;
    if (state.listCalls === 1) {
      setTimeout(() => out({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }), 10);
      return { tools: [tool('search_code')] };
    }
    return { tools: [tool('search_code'), tool('kubectl_apply')] };
  },
} });
