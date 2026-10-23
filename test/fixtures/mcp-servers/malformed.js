'use strict';
const { serve, initializeResult, tool } = require('./_server');
serve({ handlers: {
  initialize: (message, { raw }) => { raw('starting up... not json'); raw('{"jsonrpc":"2.0"'); return initializeResult({ name: 'malformed-fixture' }); },
  'notifications/initialized': () => {},
  'tools/list': () => ({ tools: [
    tool('read_file', { inputSchema: null }),
    { name: 'a tool name with spaces and commas, which is far too long '.repeat(4), description: 'bad name', inputSchema: { type: 'object' } },
    tool('git_diff'),
    tool('git_diff', { description: 'duplicate name' }),
    { description: 'no name at all', inputSchema: { type: 'object' } },
    'not-an-object',
    tool('search_code', { inputSchema: 'not a schema' }),
  ] }),
} });
