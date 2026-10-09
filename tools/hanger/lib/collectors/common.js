'use strict';
// Shared pieces for the signal collectors (data-signals-completeness). Everything here is pure: counter text in,
// plain values out. No process launches, no I/O. Locale independence comes from parseNum (the session writes
// invariant-culture numbers; a canned de-DE file can still be parsed with decimal ',').
const { parseNum } = require('../sampler/parse-num');

// "\\HOST\category(instance)\counter=value" -> {cat, inst, instL, counter, v}. The host part may repeat
// (wildcard expansion returns full paths); instances may hold backslashes (thermal zones) but never a counter name.
function parseLine(raw, { decimal = '.' } = {}) {
  const eq = raw.lastIndexOf('=');
  if (eq < 0) return null;
  let path = raw.slice(0, eq);
  while (path.startsWith('\\\\')) { const i = path.indexOf('\\', 2); if (i < 0) return null; path = path.slice(i); }
  const last = path.lastIndexOf('\\');
  if (last <= 0) return null;
  const counter = path.slice(last + 1);
  const head = path.slice(1, last);
  const open = head.indexOf('(');
  let cat = head, inst = '';
  if (open >= 0 && head.endsWith(')')) { cat = head.slice(0, open); inst = head.slice(open + 1, -1); }
  const text = raw.slice(eq + 1);
  return { cat: cat.toLowerCase(), inst, instL: inst.toLowerCase(), counter: counter.toLowerCase(), v: parseNum(text, { decimal }), text };
}

// index: Map "cat|counter" -> [{inst, instL, v}], built once per tick and shared by every collector parser
function indexLines(lines, opts) {
  const idx = new Map();
  for (const l of lines) {
    const p = parseLine(l, opts);
    if (!p) continue;
    const k = `${p.cat}|${p.counter}`;
    let a = idx.get(k);
    if (!a) { a = []; idx.set(k, a); }
    a.push(p);
  }
  return idx;
}

const rows = (idx, cat, counter) => idx.get(`${cat}|${counter}`) || [];
// the single-instance value of a counter ('_total' by default), or null when absent or unparsable
function one(idx, cat, counter, inst = '_total') {
  const r = rows(idx, cat, counter).find((x) => x.instL === inst) || (inst === '' ? rows(idx, cat, counter)[0] : null);
  return r && Number.isFinite(r.v) ? r.v : null;
}
const sumOf = (list) => list.reduce((a, x) => a + (Number.isFinite(x.v) ? x.v : 0), 0);

// failure descriptor kept by collectors; the builder reports each (collector, reason) once per run
const unavailable = (collector, inference, mode, reason) => ({ collector, inference, mode, reason });

module.exports = { parseLine, indexLines, rows, one, sumOf, unavailable };
