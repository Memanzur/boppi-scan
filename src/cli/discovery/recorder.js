/**
 * Records every JSON-RPC message Boppi sends to a server, before it is
 * written, so a test can prove the method set. The dump never carries params
 * beyond the method name and id; a cursor is the only parameter discovery
 * ever sends and it comes from the server.
 */
'use strict';

const ALLOWED_METHODS = Object.freeze(['initialize', 'notifications/initialized', 'tools/list', 'notifications/cancelled']);

function createRecorder() {
  const sent = [];
  const received = { lines: 0, parsed: 0, ignored: 0, bytes: 0, notifications: [] };
  return {
    sent(message) {
      sent.push({ method: message.method, id: message.id === undefined ? null : message.id, at: new Date().toISOString() });
      return message;
    },
    receivedLine(line, parsed) {
      received.lines += 1;
      received.bytes += Buffer.byteLength(line);
      if (parsed && typeof parsed === 'object') { received.parsed += 1; if (parsed.method && parsed.id === undefined) received.notifications.push(parsed.method); } else received.ignored += 1;
    },
    methods() { return [...new Set(sent.map(entry => entry.method))].sort(); },
    violations() { return sent.filter(entry => !ALLOWED_METHODS.includes(entry.method)).map(entry => entry.method); },
    dump() { return { sent: sent.slice(), received: { ...received, notifications: received.notifications.slice() } }; },
  };
}

module.exports = { ALLOWED_METHODS, createRecorder };
