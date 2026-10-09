'use strict';
// Minimal stored `inputStall` sections for diagnosis / validator / reader tests (inline, deterministic).
const { iso } = require('./diag-report');

const R = (v, unit) => ({ v, unit, windowS: null, n: 1, src: 'input-helper', at: iso(0), prec: unit === 's' ? 0.001 : 1 });

// ep: { t0, t1 (seconds from run start), kind, group, guards, worst, samples, by }
function episode(ep, i) {
  return {
    id: `ep${i + 1}`, startAt: iso(ep.t0), endAt: iso(ep.t1),
    durationMs: R(Math.round((ep.t1 - ep.t0) * 1000), 'ms'), worstLatencyMs: R(ep.worst || 900, 'ms'),
    samples: ep.samples || 3, sampleRefs: [0, 1, 2], foreground: ep.kind === 'out-of-scope' ? { kind: 'out-of-scope' } : { kind: ep.kind || 'in-scope', group: ep.group || 'code' },
    endReason: 'answered', guards: ep.guards || [], corroboratedBy: ep.by || [],
    confidence: { value: 0.4, components: { S: 0.2, L: 0.6, X: 0, N: 0, G: 0 }, weights: { S: 0.4, L: 0.2, X: 0.4 } },
  };
}

function section({ episodes = [], status = 'running', reason = null, latePeriods = [], observed = [0, 200], active = [[0, 200]], notEvaluable = [] } = {}) {
  if (status !== 'running') return { status, reason, determinedAt: iso(0), episodes: null, cannotSee: ['x'] };
  return {
    status: 'running', reason: null, determinedAt: iso(0),
    helper: { build: 'cached', file: 'hanger-x.input.jsonl', badLines: 0, orderlyEnd: true },
    settings: { stallMs: { v: 250, unit: 'ms', source: 'default', provisional: true }, ignoreGroups: { v: [], source: 'default' } },
    evaluable: {
      observed: { from: iso(observed[0]), to: iso(observed[1]) }, activeSpans: active.map(([a, b]) => ({ from: iso(a), to: iso(b) })), activeSpansTruncated: false,
      observedS: R(observed[1] - observed[0], 's'), evaluatedS: R(100, 's'), idleS: R(50, 's'), notEvaluableS: R(0, 's'), measurements: R(400, 'count'),
      notEvaluable: notEvaluable.map(([a, b, reason2]) => ({ from: iso(a), to: iso(b), durationS: R(b - a, 's'), reason: reason2 })),
    },
    episodes: episodes.map(episode),
    blips: R(0, 'count'),
    calmBaseline: { n: R(300, 'count'), medianMs: R(5, 'ms'), p95Ms: R(12, 'ms'), maxMs: R(40, 'ms'), overThresholdPct: R(0, '%'), noisy: false, noisyWhy: null },
    helperLateness: { tickMs: 250, n: R(800, 'count'), medianMs: R(1, 'ms'), p95Ms: R(3, 'ms'), maxMs: R(9, 'ms'), latePeriods: latePeriods.map(([a, b]) => ({ startAt: iso(a), endAt: iso(b), maxMs: R(500, 'ms') })) },
    flags: { chronicSlowGroups: [], ignored: [], foregroundChangedDropped: R(0, 'count'), helperLateSamples: R(0, 'count'), samplesInNotEvaluable: R(0, 'count') },
    outOfScope: { episodes: R(0, 'count'), totalMs: R(0, 'ms') },
    unobserved: [], cannotSee: ['waits inside an application whose interface keeps answering'],
  };
}

module.exports = { section, episode, R };
