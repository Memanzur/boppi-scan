/**
 * Minimal stdio MCP server for the discovery fixtures. Reads newline-delimited
 * JSON-RPC from stdin, answers from the handler table a fixture passes in,
 * writes to stdout. Launched only by the discovery tests, never by a scan.
 */
'use strict';
const readline = require('readline');

function serve(spec) {
  const out = message => process.stdout.write(JSON.stringify(message) + '\n');
  const raw = line => process.stdout.write(line + '\n');
  const state = { listCalls: 0 };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object') return;
    const handler = spec.handlers[message.method];
    if (message.id === undefined) { if (handler) handler(message, { out, raw, state }); return; }
    if (!handler) { out({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
    const reply = handler(message, { out, raw, state });
    if (reply === undefined) return;
    if (reply && reply.error) out({ jsonrpc: '2.0', id: message.id, error: reply.error });
    else out({ jsonrpc: '2.0', id: message.id, result: reply });
  });
  rl.on('close', () => { if (spec.onClose) spec.onClose(); else process.exit(0); });
}

function initializeResult(extra = {}) {
  return { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false }, ...(extra.capabilities || {}) }, serverInfo: { name: extra.name || 'fixture', version: '1.0.0', ...(extra.serverInfo || {}) }, ...(extra.instructions ? { instructions: extra.instructions } : {}) };
}

function tool(name, extra = {}) {
  return { name, description: `Fixture tool ${name}`, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, ...extra };
}

module.exports = { serve, initializeResult, tool };
