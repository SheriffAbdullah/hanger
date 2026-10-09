'use strict';
// Derived confidence (design D3). Five recorded components, published weights, cap 0.95.
//   C  at-hang crossing (1 | 0)
//   D  hang-vs-calm delta, normalized to the threshold distance (0 when no usable calm baseline)
//   O  co-occurrence share: usable hangs where the rule fired / usable hangs
//   K  confirmation share: fired hangs with any confirmation / fired hangs
//   P  confound penalty: 0.1 per active confound, at most 0.3
// conf = min(cap, (0.35 C + 0.25 D + 0.25 O + 0.15 K) * (1 - P)). The weights belong to the formula, not to a rule.

const MODEL = Object.freeze({
  weights: Object.freeze({ C: 0.35, D: 0.25, O: 0.25, K: 0.15 }),
  penaltyPerConfound: 0.1, penaltyMax: 0.3, cap: 0.95, calmMinN: 3,
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const r2 = (x) => Math.round(x * 100) / 100;

// v: value at the hang; calmMean/calmN: baseline; threshold: effective threshold; direction: 'higher' (default) | 'lower' (lower is worse)
function deltaComponent({ v, calmMean, calmN, threshold, direction = 'higher' }) {
  if (![v, calmMean, threshold].every(Number.isFinite) || !(calmN >= MODEL.calmMinN)) return { D: 0, flag: 'calm-insufficient' };
  if (direction === 'lower') {
    if (calmMean <= threshold) return { D: 0, flag: 'calm-insufficient' };
    return { D: clamp01((calmMean - v) / (calmMean - threshold)), flag: null };
  }
  if (calmMean >= threshold) return { D: 0, flag: 'calm-insufficient' };
  return { D: clamp01((v - calmMean) / (threshold - calmMean)), flag: null };
}

// c: {C, D, O, K, activeConfounds}
function confidence(c) {
  const P = Math.min(MODEL.penaltyMax, MODEL.penaltyPerConfound * (c.activeConfounds || 0));
  const w = MODEL.weights;
  const raw = (w.C * c.C + w.D * c.D + w.O * c.O + w.K * c.K) * (1 - P);
  return { P, value: r2(Math.min(MODEL.cap, raw)) };
}

module.exports = { MODEL, clamp01, deltaComponent, confidence, r2 };
