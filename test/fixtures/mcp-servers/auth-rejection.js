'use strict';
const { serve, initializeResult, tool } = require('./_server');
const mode = process.argv[2] || 'version';
serve({ handlers: {
  initialize: () => (mode === 'version'
    ? { error: { code: -32602, message: 'Unsupported protocol version', data: { supported: ['2024-11-05'], requested: '2025-11-25' } } }
    : initializeResult({ name: 'auth-rejection-fixture' })),
  'notifications/initialized': () => {},
  'tools/list': () => ({ error: { code: -32001, message: 'Unauthorized: token expired' } }),
} });
