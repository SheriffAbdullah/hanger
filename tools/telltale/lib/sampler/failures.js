'use strict';
// ONE failure shape on every code path: {inference, collector, mode, reason, at}.
// Parse failures repeat on every tick; each (collector, mode, field) is recorded once per run.
function createFailureLog({ now = () => new Date(), onRecord = null, cap = 1000 } = {}) {
  const list = [];
  let truncated = false;
  const seen = new Set();
  function fail(inference, collector, mode, reason, extra = {}) {
    const key = mode === 'parse' ? `${collector}|${mode}|${extra.field || reason}` : null;
    if (key) { if (seen.has(key)) return null; seen.add(key); }
    if (list.length >= cap) {
      if (!truncated) { truncated = true; const t = { inference: 'run.failures', collector: 'failureLog', mode: 'truncated', reason: `more than ${cap} failures; later ones are not recorded`, at: new Date().toISOString() }; list.push(t); if (onRecord) onRecord(t); }
      return null;
    }
    const atVal = extra.at !== undefined ? extra.at : now();
    const rec = { inference, collector, mode, reason: String(reason || mode).slice(0, 300), at: atVal instanceof Date ? atVal.toISOString() : atVal };
    if (extra.field) rec.field = extra.field;
    list.push(rec);
    if (onRecord) onRecord(rec);
    return rec;
  }
  return { list, fail };
}
module.exports = { createFailureLog };
