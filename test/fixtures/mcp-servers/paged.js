'use strict';
const { serve, initializeResult, tool } = require('./_server');
const names = ['get_file_contents', 'push_files', ...Array.from({ length: 38 }, (_, i) => `fixture_tool_${String(i + 1).padStart(2, '0')}`)];
const pages = [names.slice(0, 15), names.slice(15, 30), names.slice(30)];
serve({ handlers: {
  initialize: () => initializeResult({ name: 'paged-fixture' }),
  'notifications/initialized': () => {},
  'tools/list': message => {
    const cursor = message.params && message.params.cursor;
    const index = cursor ? Number(cursor.replace('page-', '')) : 0;
    const page = pages[index] || [];
    return { tools: page.map(n => tool(n, { inputSchema: { type: 'object', properties: { path: { type: 'string' }, ref: { type: 'string', default: 'main' } }, required: ['path'] } })), ...(index + 1 < pages.length ? { nextCursor: `page-${index + 1}` } : {}) };
  },
} });
