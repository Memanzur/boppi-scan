'use strict';
/**
 * Fixture for the consented live hook check (docs/phase6/LIVE_VALIDATION_PLAN.md).
 * Three tools whose outcomes the collector must tell apart: ok_tool returns a
 * result, error_tool returns isError: true, slow_tool answers after a delay so a
 * call can be interrupted. Started by synthetic tests or by a consenting person
 * in a test project; a scan never starts it.
 */
const { serve, initializeResult, tool } = require('./_server');
const DELAY_MS = Number(process.env.LIVE_CHECK_DELAY_MS) > 0 ? Number(process.env.LIVE_CHECK_DELAY_MS) : 8000;
const TOOLS = ['ok_tool', 'error_tool', 'slow_tool'];
const text = value => ({ content: [{ type: 'text', text: value }] });
serve({ handlers: {
  initialize: () => initializeResult({ name: 'live-check' }),
  'notifications/initialized': () => {},
  ping: () => ({}),
  'tools/list': () => ({ tools: TOOLS.map(n => tool(n, { description: `Live check: ${n}. Takes no arguments and touches nothing.` })) }),
  'tools/call': (message, { out }) => {
    const name = message.params && message.params.name;
    if (name === 'ok_tool') return text('ok_tool ran. Nothing was read or written.');
    if (name === 'error_tool') return { ...text('error_tool failed on purpose.'), isError: true };
    if (name === 'slow_tool') {
      setTimeout(() => out({ jsonrpc: '2.0', id: message.id, result: text(`slow_tool ran after ${DELAY_MS} ms.`) }), DELAY_MS);
      return undefined;
    }
    return { error: { code: -32602, message: `Unknown tool ${String(name).slice(0, 80)}` } };
  },
} });
