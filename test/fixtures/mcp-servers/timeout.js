'use strict';
const { serve, initializeResult } = require('./_server');
serve({ handlers: {
  initialize: () => initializeResult({ name: 'timeout-fixture' }),
  'notifications/initialized': () => {},
  'tools/list': () => undefined,
  'notifications/cancelled': (message, { state }) => { state.cancelled = (state.cancelled || 0) + 1; process.stderr.write('cancelled\n'); },
} });
