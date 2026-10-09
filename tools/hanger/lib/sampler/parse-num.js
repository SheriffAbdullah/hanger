'use strict';
// Locale-independent number parsing. `decimal` is the decimal separator the collector's output used
// ('.' for invariant-culture output, ',' for de-DE style). Digit-group separators (',' '.', space,
// NBSP, narrow NBSP) are stripped. Anything unparsable is null (never zero).
const GROUP_SPACES = /[\s\u00a0\u202f\u2009]/g;

function parseNum(raw, { decimal = '.' } = {}) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(GROUP_SPACES, '');
  if (!s) return null;
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const f = parseFloat(s);
  return Number.isFinite(f) ? f : null;
}

// parse with a failure record when the text is present but not a number
function parseField(raw, field, { decimal = '.' } = {}) {
  const v = parseNum(raw, { decimal });
  if (v === null) return { v: null, failure: { mode: 'parse', field, reason: `unparsable value '${String(raw).slice(0, 40)}'` } };
  return { v, failure: null };
}

module.exports = { parseNum, parseField };
