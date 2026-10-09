'use strict';
// Display formatting for every shareable view (report-views "Display precision and units").
// One place owns rounding, units, ASCII-safety and the "not available (reason)" wording.
// Pure functions: no I/O at require time.
const { isRec } = require('../sampler/record');

const MAP = {
  '≥': '>=', '≤': '<=', '×': 'x', '↔': '<->', '⇒': '=>', '→': '->', '–': '-', '—': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', ' ': ' ', 'μ': 'u', '·': '-', '°': ' deg',
};
function ascii(s) {
  if (s === null || s === undefined) return 'n/a';
  return String(s).replace(/[^\x00-\x7F]/g, (ch) => (MAP[ch] !== undefined ? MAP[ch] : '?'));
}
const esc = (s) => ascii(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// display decimals by unit when the value carries no recorded precision
const DEFAULT_DECIMALS = { '%': 1, '% of base': 0, '% of machine': 1, MB: 0, GB: 1, ms: 0, s: 1, min: 1, C: 0, MHz: 0, '/s': 0, count: 0, 'bytes/s': 0, 'MB/s': 1, W: 1, Wh: 1, '': 1 };
const UNIT_TEXT = { '%': '%', '% of base': '% of base', '% of machine': '% of machine', MB: ' MB', GB: ' GB', ms: ' ms', s: ' s', min: ' min', C: ' C', MHz: ' MHz', '/s': '/s', count: '', 'bytes/s': ' B/s', 'MB/s': ' MB/s', W: ' W', Wh: ' Wh', cores: ' cores', threads: ' threads', MTs: ' MT/s' };

// decimals recorded precision allows (prec 0.1 -> 1, 1 -> 0, 0.001 -> 3), clamped to 2 for display
function decimalsFromPrec(prec) {
  if (!(prec > 0)) return null;
  const s = String(prec);
  const i = s.indexOf('.');
  return Math.min(2, i < 0 ? 0 : s.length - i - 1);
}

// number rounded for display; never more than 2 decimals; trailing zeros kept only when the precision implies them
function roundDisplay(v, unit, prec) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let d = decimalsFromPrec(prec);
  if (d === null) d = Object.prototype.hasOwnProperty.call(DEFAULT_DECIMALS, unit) ? DEFAULT_DECIMALS[unit] : (Number.isInteger(n) ? 0 : 1);
  // an integer-valued number never grows decimals it did not have
  if (Number.isInteger(n) && d > 0 && (prec === undefined || prec === null)) d = 0;
  return n.toFixed(d);
}

const unitText = (unit) => (unit === undefined || unit === null || unit === '' ? '' : (Object.prototype.hasOwnProperty.call(UNIT_TEXT, unit) ? UNIT_TEXT[unit] : ` ${unit}`));
const na = (reason) => `not available (${reason && String(reason).trim() ? String(reason).trim() : 'no reason recorded'})`;

// fmt(value, spec, reason): spec is a unit string or a provenance record / {unit, prec}
function fmt(value, spec, reason) {
  let v = value, unit, prec;
  if (isRec(value)) { v = value.v; unit = value.unit; prec = value.prec; }
  if (spec && typeof spec === 'object') { if (unit === undefined) unit = spec.unit; if (prec === undefined) prec = spec.prec; if (!reason && spec.reason) reason = spec.reason; } else if (typeof spec === 'string') unit = spec;
  const r = roundDisplay(v, unit, prec);
  if (r === null) return na(reason);
  return `${r}${unitText(unit)}`;
}

// plain number text with no unit, same precision rules (for table cells that carry the unit in the header)
function fmtBare(value, spec) {
  let v = value, unit, prec;
  if (isRec(value)) { v = value.v; unit = value.unit; prec = value.prec; }
  if (spec && typeof spec === 'object') { if (unit === undefined) unit = spec.unit; if (prec === undefined) prec = spec.prec; } else if (typeof spec === 'string') unit = spec;
  const r = roundDisplay(v, unit, prec);
  return r === null ? null : r;
}

// round any number to at most 2 decimals (no unit) for free text built from raw numbers
const n2 = (v) => { const n = Number(v); return Number.isFinite(n) ? String(+n.toFixed(2)) : 'n/a'; };

module.exports = { ascii, esc, fmt, fmtBare, na, roundDisplay, unitText, n2, decimalsFromPrec, DEFAULT_DECIMALS };
