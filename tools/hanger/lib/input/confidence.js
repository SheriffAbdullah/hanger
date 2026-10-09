'use strict';
// Episode confidence (design decision 5). Derived from recorded components; never constant; capped at 0.95.
//   S severity   = clamp((worst - threshold) / (3 * threshold))
//   L length     = clamp(samples / 5)
//   X corroboration = independent sources (probe hang, OS not-responding, user mark, workload probe) / 4
//   N noisy-baseline penalty (0.15 when the detector is flagged noisy)
//   G guard penalty: 0.1 per flag among helper-late, chronic-slow-app, foreground-changed-near; at most 0.3
// conf = min(0.95, (0.4 S + 0.2 L + 0.4 X) * (1 - N - G))
const MODEL = Object.freeze({ weights: Object.freeze({ S: 0.4, L: 0.2, X: 0.4 }), noisyPenalty: 0.15, guardPenalty: 0.1, guardMax: 0.3, cap: 0.95, lengthFull: 5, severityRange: 3 });
const SOURCES = ['probe-hang', 'os-not-responding', 'user-mark', 'workload-probe'];
const GUARD_FLAGS = ['helper-late', 'chronic-slow-app', 'foreground-changed-near'];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const r2 = (x) => Math.round(x * 100) / 100;

// ep: { worstLatencyMs, samples, corroboratedBy[], guards[] }
function episodeConfidence(ep, { stallMs, noisy = false }) {
  const S = clamp01((ep.worstLatencyMs - stallMs) / (MODEL.severityRange * stallMs));
  const L = clamp01(ep.samples / MODEL.lengthFull);
  const X = clamp01(SOURCES.filter((s) => (ep.corroboratedBy || []).includes(s)).length / SOURCES.length);
  const N = noisy ? MODEL.noisyPenalty : 0;
  const G = Math.min(MODEL.guardMax, MODEL.guardPenalty * GUARD_FLAGS.filter((g) => (ep.guards || []).includes(g)).length);
  const w = MODEL.weights;
  const raw = (w.S * S + w.L * L + w.X * X) * (1 - N - G);
  return { value: r2(Math.min(MODEL.cap, raw)), components: { S: r2(S), L: r2(L), X: r2(X), N, G: r2(G) }, weights: { ...w } };
}

module.exports = { MODEL, SOURCES, GUARD_FLAGS, episodeConfidence, clamp01, r2 };
