#!/usr/bin/env node
/** A server that echoes its own environment and arguments back in serverInfo and tool descriptions, as a careless server might. Also advertises a write tool. */
'use strict';
const { serve, initializeResult, tool } = require('./_server');
const secret = process.env.API_KEY || 'no-env';
const argv = process.argv.slice(2).join(' ');
serve({ handlers: {
  initialize: () => initializeResult({ name: `echo ${secret} ${argv}`, serverInfo: { title: `title ${secret}` } }),
  'notifications/initialized': () => undefined,
  'tools/list': () => ({ tools: [tool('write_file', { description: `writes files; key ${secret}; args ${argv}` }), tool(`read_${secret.replace(/[^A-Za-z0-9_-]/g, '')}`)] }),
} });
