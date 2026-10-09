'use strict';
// False-positive guards and the calm baseline (pure).
const { weightedQuantile } = require('./lateness');

const CHRONIC_MIN_N = 20;       // evaluated measurements before a group may be called chronically slow
const CHRONIC_SHARE = 0.5;      // share over the threshold
const NOISY_P95_FRACTION = 0.5; // calm p95 at or above half the stall threshold
const NOISY_SHARE = 0.05;       // share over the threshold outside episodes

// per-group totals {group: {n, over}} summed over the windows (anonymous 'out-of-scope' and 'unknown' are kept apart)
function groupTotals(windows) {
  const t = {};
  for (const w of windows || []) {
    for (const [g, x] of Object.entries(w.groups || {})) {
      const c = t[g] || (t[g] = { n: 0, over: 0 });
      c.n += Number(x.n) || 0; c.over += Number(x.over) || 0;
    }
  }
  return t;
}

// named groups only: an anonymous out-of-scope aggregate is never flagged by name
function chronicSlowGroups(windows) {
  const t = groupTotals(windows);
  return Object.entries(t).filter(([g, x]) => g !== 'out-of-scope' && g !== 'unknown' && x.n >= CHRONIC_MIN_N && x.over / x.n >= CHRONIC_SHARE)
    .map(([g, x]) => ({ group: g, n: x.n, over: x.over })).sort((a, b) => a.group.localeCompare(b.group));
}

// calm baseline from windows that held no stall sample (latency statistics are per window; see design 4)
function calmBaseline({ windows, stallMs, blips = 0 }) {
  const all = windows || [];
  const measuredTotal = all.reduce((a, w) => a + (Number(w.measured) || 0), 0);
  const calm = all.filter((w) => !(Number(w.stalls) > 0) && Number(w.measured) > 0);
  const n = calm.reduce((a, w) => a + w.measured, 0);
  if (!n) return { n: 0, medianMs: null, p95Ms: null, maxMs: null, overThresholdPct: null, noisy: false, noisyWhy: null, reason: measuredTotal ? 'every window with a measurement held a stall sample' : 'no evaluated moment was measured' };
  const medianMs = weightedQuantile(calm.map((w) => ({ v: w.latMedianMs, w: w.measured })), 0.5);
  const p95Ms = weightedQuantile(calm.map((w) => ({ v: w.latP95Ms, w: w.measured })), 0.95);
  const maxMs = Math.max(...calm.map((w) => Number(w.latMaxMs) || 0));
  const overPct = measuredTotal ? (blips / measuredTotal) * 100 : 0;
  const whyP95 = p95Ms !== null && p95Ms >= stallMs * NOISY_P95_FRACTION;
  const whyShare = overPct / 100 > NOISY_SHARE;
  return {
    n, medianMs, p95Ms, maxMs, overThresholdPct: overPct, noisy: whyP95 || whyShare,
    noisyWhy: whyP95 ? { p95Ms, limitMs: stallMs * NOISY_P95_FRACTION } : whyShare ? { overThresholdPct: overPct, limitPct: NOISY_SHARE * 100 } : null, reason: null,
  };
}

function foregroundChangedDropped(windows) { return (windows || []).reduce((a, w) => a + (Number(w.fgChanged) || 0), 0); }

module.exports = { groupTotals, chronicSlowGroups, calmBaseline, foregroundChangedDropped, CHRONIC_MIN_N, CHRONIC_SHARE, NOISY_P95_FRACTION, NOISY_SHARE };
