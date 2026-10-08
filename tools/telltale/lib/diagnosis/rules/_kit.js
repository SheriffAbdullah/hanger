'use strict';
// Shared helpers for the cause rules of diagnosis-cause-rules. The leading underscore keeps this file out of the
// engine's rule loader (only non-underscore files in this folder are rules). Pure: no I/O.
require('../cause-signals');
const rp = require('../rule-params');
const T = require('../trend-helpers');

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const WINDOW_S = 10;

// recorded (or default) parameter of this rule: {value, unit, source, origin, key}
const th = (ctx, ruleId, key) => rp.param(ctx.report, ruleId, key);

// one value per run, computed once per diagnosis context (a stored report recomputes identically)
const cache = new WeakMap();
function runLevel(ctx, key, fn) {
  let m = cache.get(ctx);
  if (!m) { m = new Map(); cache.set(ctx, m); }
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}

// usable probes within +-10 s of the hang, with the named signals read once: [{q, <name>: value}]
function windowRows(ctx, h, names) {
  return ctx.near(h, WINDOW_S).map((q) => { const r = { q }; for (const n of names) r[n] = ctx.sig(q, n); return r; });
}

// evidence inputs for the given probes and signals; a signal with no value is not an input
function inputsOf(ctx, qs, names) {
  const out = [];
  for (const q of qs) for (const n of names) if (ctx.sig(q, n) !== null) out.push(ctx.input(q, n));
  return out;
}

const nullResult = (threshold, reason, extra = {}) => ({ fired: null, reason, inputs: [], threshold, n: 0, ...extra });

// "k of N hangs" helper for run-level disprovers: true when at least 2/3 of the evaluable items satisfy pred
const twoThirds = (items, pred) => items.length > 0 && items.filter(pred).length * 3 >= items.length * 2;

const observerRecorded = (report) => !!(report && report.observer && typeof report.observer === 'object' && Object.keys(report.observer).length);

// parse "128MB", "4GB", "4096kB", "8 GB" (database setting text) -> MB, or null
function parseMB(s) {
  const m = String(s === undefined || s === null ? '' : s).trim().match(/^([\d.]+)\s*(tb|gb|mb|kb|b)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const f = { tb: 1048576, gb: 1024, mb: 1, kb: 1 / 1024, b: 1 / 1048576 }[(m[2] || 'mb').toLowerCase()];
  return n * f;
}

const evenly = (arr, k) => {
  if (arr.length <= k) return arr.slice();
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.round(i * (arr.length - 1) / (k - 1))]);
  return [...new Set(out)];
};

module.exports = { finite, th, runLevel, windowRows, inputsOf, nullResult, twoThirds, observerRecorded, parseMB, evenly, WINDOW_S, T };
