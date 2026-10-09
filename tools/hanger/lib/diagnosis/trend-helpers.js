'use strict';
// Shared "rising" / "growing" / "monotonic" checks over the values of the usable probes in a window.
// Observer-excluded probes never reach a rule (the engine's context already removed them); null values are skipped here.
// Pure functions, no I/O.

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const clean = (values) => (values || []).filter(finite);
const median = (a) => { const v = clean(a).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const mean = (a) => { const v = clean(a); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };

// least-squares slope per index step (null when fewer than 2 points)
function slope(values) {
  const v = clean(values);
  if (v.length < 2) return null;
  const n = v.length, mx = (n - 1) / 2, my = mean(v);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (v[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

// rising: at least 3 points, a positive fitted slope, and last - first >= minDelta (absolute, in the value's own unit)
function rising(values, minDelta) {
  const v = clean(values);
  if (v.length < 3) return { ok: false, reason: `fewer than 3 points (${v.length})`, n: v.length, first: v[0] ?? null, last: v[v.length - 1] ?? null, delta: null };
  const s = slope(v), delta = v[v.length - 1] - v[0];
  return { ok: s > 0 && delta >= minDelta, reason: null, n: v.length, first: v[0], last: v[v.length - 1], delta: Math.round(delta * 100) / 100, slope: Math.round(s * 1000) / 1000 };
}

// growing by a relative amount: last >= first * (1 + pct/100) and a positive slope (a modified list, a pagefile)
function growing(values, pct) {
  const v = clean(values);
  if (v.length < 3) return { ok: false, reason: `fewer than 3 points (${v.length})`, n: v.length, first: v[0] ?? null, last: v[v.length - 1] ?? null, growthPct: null };
  const first = v[0], last = v[v.length - 1], s = slope(v);
  const growthPct = first > 0 ? (last - first) / first * 100 : null;
  return { ok: first > 0 && s > 0 && growthPct >= pct, reason: null, n: v.length, first, last, growthPct: growthPct === null ? null : Math.round(growthPct * 10) / 10 };
}

// monotonic growth: at least 3 points, no step falls more than tolerancePct below its predecessor, the last is the maximum,
// and the total growth is at least totalPct. The tolerance absorbs counter noise on a series sampled every 2 s.
function monotonic(values, { totalPct, tolerancePct = 1 } = {}) {
  const v = clean(values);
  if (v.length < 3) return { ok: false, reason: `fewer than 3 snapshots (${v.length})`, n: v.length, values: v, growthPct: null };
  let steady = true, rises = 0;
  for (let i = 1; i < v.length; i++) {
    if (v[i] < v[i - 1] * (1 - tolerancePct / 100)) { steady = false; break; }
    if (v[i] > v[i - 1]) rises++;
  }
  const first = v[0], last = v[v.length - 1];
  const growthPct = first > 0 ? (last - first) / first * 100 : null;
  const ok = steady && rises >= 2 && last >= Math.max(...v) && growthPct !== null && growthPct >= totalPct;
  return { ok, reason: null, n: v.length, values: v, growthPct: growthPct === null ? null : Math.round(growthPct * 10) / 10 };
}

module.exports = { slope, rising, growing, monotonic, median, mean, clean };
