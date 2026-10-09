'use strict';
// Helper wake-lateness self-signal (pure). lateness = actual wake minus scheduled wake on the helper's monotonic clock.
// A late period is a run of consecutive wakes each late by at least the late threshold.
const ms = (iso) => { const t = typeof iso === 'number' ? iso : Date.parse(iso); return Number.isFinite(t) ? t : null; };

// weighted quantile of [{v, w}] (w = count); null when nothing
function weightedQuantile(items, q) {
  const a = items.filter((x) => Number.isFinite(x.v) && x.w > 0).sort((x, y) => x.v - y.v);
  const total = a.reduce((s, x) => s + x.w, 0);
  if (!total) return null;
  let acc = 0;
  for (const x of a) { acc += x.w; if (acc >= q * total) return x.v; }
  return a[a.length - 1].v;
}

// group raw wakes [{atMs, latenessMs}] into late periods (used by fixtures and tests; the helper applies the same rule)
function groupLate(wakes, lateMs) {
  const periods = [];
  let cur = null;
  for (const w of [...wakes].sort((a, b) => a.atMs - b.atMs)) {
    if (w.latenessMs >= lateMs) {
      if (!cur) { cur = { startMs: w.atMs - w.latenessMs, endMs: w.atMs, maxMs: w.latenessMs, n: 1 }; periods.push(cur); }
      else { cur.endMs = w.atMs; cur.maxMs = Math.max(cur.maxMs, w.latenessMs); cur.n++; }
    } else cur = null;
  }
  return periods;
}

// summary from window records + late-period records. Medians and p95 are estimates from the 10 s window statistics.
function summarize({ windows, latePeriods }) {
  const w = (windows || []).filter((x) => Number(x.lateN) > 0);
  const n = w.reduce((a, x) => a + x.lateN, 0);
  const periods = (latePeriods || []).map((p) => ({ startMs: ms(p.startAt), endMs: ms(p.endAt), maxMs: Number(p.maxMs), n: Number(p.n) || 1 })).filter((p) => p.startMs !== null && p.endMs !== null);
  return {
    n,
    medianMs: weightedQuantile(w.map((x) => ({ v: x.lateMedianMs, w: x.lateN })), 0.5),
    p95Ms: weightedQuantile(w.map((x) => ({ v: x.lateP95Ms, w: x.lateN })), 0.95),
    maxMs: w.length ? Math.max(...w.map((x) => Number(x.lateMaxMs) || 0)) : null,
    periods,
  };
}

module.exports = { weightedQuantile, groupLate, summarize };
