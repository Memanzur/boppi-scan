/** Boppi Agent Security permission normalization. Pure, deterministic logic. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BoppiPermissionNormalizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CATEGORIES = Object.freeze(['read_files','write_files','delete_files','read_email','send_email','read_calendar','modify_calendar','read_source_code','modify_source_code','access_customer_data','access_financial_data','access_health_data','access_hr_data','execute_code','run_shell_commands','browse_internet','call_external_api','send_external_message','create_or_modify_records','make_purchase','access_credentials','access_environment_variables','browser_automation','access_production_system','untrusted_external_content','unknown']);
  const RULES = [
    ['write_files', /drive\.file|file.*write|write.*file|filesystem.*write/i, 'The permission indicates file creation or modification.'],
    ['delete_files', /delete.*file|file.*delete|drive.*delete/i, 'The permission indicates file deletion.'],
    ['read_files', /drive|file|document|onedrive|sharepoint|filesystem|downloads|documents/i, 'The permission names a file or document store.'],
    ['read_email', /gmail.*(readonly|read)|mail\.(read|readwrite)|mail\.google\.com/i, 'The permission grants email reading.'],
    ['send_email', /gmail\.(modify|full)|mail\.(send|readwrite)|mail\.google\.com/i, 'The permission can send or modify email.'],
    ['read_calendar', /calendar.*read|calendars\.(read|readwrite)/i, 'The permission grants calendar reading.'],
    ['modify_calendar', /calendar.*write|calendars\.readwrite/i, 'The permission can modify calendar entries.'],
    ['modify_source_code', /repo|source.*write|code.*write|repository.*write|pull_request.*write/i, 'The permission may modify source code.'],
    ['read_source_code', /(^|\s|:)repo($|\s|:)|source.*read|code.*read|repository.*read/i, 'The permission grants source-code reading.'],
    ['access_customer_data', /customer|crm|salesforce|support|client/i, 'The permission names customer or CRM data.'],
    ['access_financial_data', /finance|financial|payment|payroll|accounting|stripe/i, 'The permission names financial data.'],
    ['access_health_data', /health|medical|patient|hipaa/i, 'The permission names health data.'],
    ['access_hr_data', /human.?resources|(^|:)hr($|:)|employee|personnel/i, 'The permission names HR data.'],
    ['execute_code', /execute|code.?execution|run.?code|function/i, 'The capability can execute code.'],
    ['run_shell_commands', /shell|terminal|command|subprocess|exec/i, 'The capability can run shell commands.'],
    ['browse_internet', /internet|browser|web|http|search|navigation/i, 'The capability can access external web content.'],
    ['call_external_api', /api|network|http|webhook|external/i, 'The permission can call an external service.'],
    ['send_external_message', /slack.*send|message.*send|send.*external|email.*send|outbound/i, 'The capability can send an external message.'],
    ['create_or_modify_records', /write|modify|create|update|admin/i, 'The permission can create or modify records.'],
    ['make_purchase', /purchase|checkout|payment|transaction|buy/i, 'The capability can initiate a purchase or payment.'],
    ['access_credentials', /credential|secret|keychain|token|oauth/i, 'The permission references credentials; values are never accepted.'],
    ['access_environment_variables', /environment|env|process\.env/i, 'The capability can access environment variables; values are never accepted.'],
    ['browser_automation', /browser.*automation|playwright|selenium|puppeteer|browser/i, 'The capability can automate a browser.'],
    ['access_production_system', /production|prod|live system|deployment|cluster/i, 'The permission names a production system.'],
    ['untrusted_external_content', /untrusted|external content|webpage|document|email|search result/i, 'The source may contain externally controlled instructions.'],
  ];
  function normalize(raw, context = {}) {
    if (typeof raw !== 'string' || !raw.trim()) return result(raw || 'unknown', 'unknown', 0, 'Empty or non-string permission cannot be mapped.');
    const value = raw.trim();
    const explicit = context.category || context.normalizedCategory;
    if (explicit && CATEGORIES.includes(explicit)) return result(value, explicit, 1, 'Explicit category supplied by a trusted provider contract.');
    const matches = RULES.filter(([, re]) => re.test(value));
    if (!matches.length) return result(value, 'unknown', 0.35, 'No deterministic category rule matched; retained as unknown.');
    const [category, , reason] = matches[0];
    return result(value, category, matches.length > 1 ? 0.7 : 0.9, reason);
  }
  function result(rawPermission, normalizedCategory, normalizationConfidence, normalizationReason) {
    return { rawPermission, normalizedCategory, normalizationConfidence, normalizationReason, sourceProvider: null };
  }
  function normalizeMany(values, context = {}) { return (Array.isArray(values) ? values : [values]).map(v => normalize(v, context)); }
  return { CATEGORIES, normalize, normalizeMany };
});
