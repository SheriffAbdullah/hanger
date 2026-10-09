'use strict';
// Per-value provenance records: {v, unit, windowS, n, src, at, prec}.
// rec() rounds at store time to the unit's declared precision; val()/plain() are the one accessor
// readers use, so legacy bare numbers and records both read correctly.

// default precision per unit (design D6); a collector may override per field
const PRECISION = { '%': 0.1, MB: 1, GB: 0.01, ms: 1, s: 0.001, count: 1, '/s': 1, C: 0.1 };

const decimalsOf = (p) => {
  const s = String(p);
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

function roundTo(v, prec) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (!(prec > 0)) return v;
  return +(Math.round(v / prec) * prec).toFixed(decimalsOf(prec));
}

function rec(value, { unit, windowS = null, n = 1, src, at = null, prec } = {}) {
  const p = prec !== undefined ? prec : PRECISION[unit];
  return { v: roundTo(value, p), unit: unit || null, windowS, n, src: src || null, at, prec: p === undefined ? null : p };
}

// a provenance record has exactly the shape rec() builds
const isRec = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'unit' in x && 'src' in x && 'prec' in x;

// value of a record, or the legacy bare value
const val = (x) => (isRec(x) ? x.v : x);

// deep copy with every record replaced by its value (readers use this on the file they just parsed)
function plain(x) {
  if (isRec(x)) return x.v;
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = plain(v);
    return o;
  }
  return x;
}

module.exports = { PRECISION, rec, val, isRec, plain, roundTo, decimalsOf };
