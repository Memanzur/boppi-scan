/** Local evidence identities. Only domain-separated HMACs leave memory; never raw configuration or paths. */
'use strict';
const crypto = require('crypto');
let key = null;
function setKey(value) { key = value || null; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function digest(domain, value) {
  return key && value != null ? `evidence-v1:${crypto.createHmac('sha256', key).update(domain + '\0' + JSON.stringify(canonical(value))).digest('hex')}` : null;
}
module.exports = { setKey, digest };
