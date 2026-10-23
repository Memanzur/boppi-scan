'use strict';
const { serve, initializeResult, tool } = require('./_server');
serve({ handlers: {
  initialize: () => initializeResult({ name: 'oversized-fixture' }),
  'notifications/initialized': () => {},
  'tools/list': (message, { raw }) => {
    raw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'x'.repeat(600 * 1024) } }));
    return { tools: Array.from({ length: 2000 }, (_, i) => ({ name: `bulk_tool_${i}`, inputSchema: { type: 'object' } })) };
  },
} });
