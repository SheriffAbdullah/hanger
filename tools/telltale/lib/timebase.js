'use strict';
// Measured-time model: every sample/probe carries its wall-clock `at`; tSec is derived
// from `at` minus run start (never index * nominal interval); rates divide by the observed window.
const { pct } = require('./numbers');

const round = (v, d) => +Number(v).toFixed(d);
const finite = (arr) => arr.filter(Number.isFinite);

// seconds from run start to the measurement time `at` (ISO string or epoch ms)
function offsetSec(at, runStartMs) {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(ms) ? round((ms - runStartMs) / 1000, 2) : null;
}

function observedWindow({ runStartMs, nominalS, samples = [], probes = [], samplesExpected = null, probesExpected = null, unobservedS = 0 }) {
  let last = null;
  for (const x of [...samples, ...probes]) {
    const ms = Date.parse(x.at);
    if (Number.isFinite(ms) && (last === null || ms > last)) last = ms;
  }
  const spanS = last === null ? null : round((last - runStartMs) / 1000, 2);
  return {
    nominalS,
    spanS,
    unobservedS: round(unobservedS, 2),
    // rates and shares divide by observed time: the span minus recorded unobserved intervals
    observedS: spanS === null ? null : round(Math.max(0, spanS - unobservedS), 2),
    probesExpected, probesObserved: probes.length,
    samplesExpected, samplesObserved: samples.length,
  };
}

// events per minute over the observed window; null when there is no window
function ratePerMin(count, observedS) {
  return Number.isFinite(observedS) && observedS > 0 ? round((count / observedS) * 60, 2) : null;
}

// seconds spent over a threshold, weighting each sample by its measured spacing
function secsOver(samples, thresholdPct) {
  let prev = 0, total = 0;
  for (const s of samples) {
    if (Number.isFinite(s.tSec)) {
      if (s.usedPct > thresholdPct) total += Math.max(0, s.tSec - prev);
      prev = s.tSec;
    }
  }
  return round(total, 1);
}

const avgOf = (arr, k) => {
  const v = finite(arr.map((p) => p[k]));
  return v.length ? round(v.reduce((a, x) => a + x, 0) / v.length, 1) : null;
};

// hang rows with +-W wall-clock context built from measured times
function buildHangEvents({ probes, samples, hangMs, recoveryMs, contextS = 10 }) {
  return probes.filter((s) => s.ms >= hangMs).map((s) => {
    const pre = samples.filter((x) => x.tSec >= s.tSec - contextS && x.tSec < s.tSec);
    const post = samples.filter((x) => x.tSec > s.tSec && x.tSec <= s.tSec + contextS);
    const preP = probes.filter((p) => p.tSec >= s.tSec - contextS && p.tSec < s.tSec);
    const postP = probes.filter((p) => p.tSec > s.tSec && p.tSec <= s.tSec + contextS);
    const idx = probes.indexOf(s);
    const nextOk = probes.slice(idx + 1).find((p) => p.ms < recoveryMs);
    return {
      ...s,
      label: `HANG ${s.ms}ms at ${String(s.at).slice(11, 19)} (t+${s.tSec}s, RAM ${s.usedPct}%)`,
      context: {
        windowS: contextS, basis: 'wall-clock offsets',
        ramPreAvg: pre.length ? avgOf(pre, 'usedPct') : null,
        ramPostAvg: post.length ? avgOf(post, 'usedPct') : null,
        commitPreAvg: avgOf(preP, 'committed'), commitPostAvg: avgOf(postP, 'committed'),
        pagesPreAvg: avgOf(preP, 'pages'), pagesPostAvg: avgOf(postP, 'pages'),
        cpuQPreAvg: avgOf(preP, 'cpuQ'), cpuQPostAvg: avgOf(postP, 'cpuQ'),
        diskQPreAvg: avgOf(preP, 'diskQ'), diskQPostAvg: avgOf(postP, 'diskQ'),
        gpuPreAvg: avgOf(preP, 'gpuTotal'), gpuPostAvg: avgOf(postP, 'gpuTotal'),
        culpritDelta: null, culpritDeltaNote: 'pre-hang culprits not sampled (snapshot is post-measure by design); see culpritsAtHang',
        recoveryMs: nextOk ? nextOk.ms : null,
        recoveryGapS: nextOk ? round(nextOk.tSec - s.tSec, 1) : null,
      },
    };
  });
}

// Everything computable from samples + probes + loop lag. Absent data is null with a reason in `nulls`.
function buildCore({ runStartMs, nominalS, intervalMs, samples, probes, lagProbes = [], th, unobservedS = 0 }) {
  const nulls = {};
  const nul = (key, value, reason) => {
    if (value === null || value === undefined) { nulls[key] = reason; return null; }
    return value;
  };
  const probeEvery = Math.max(1, Math.round(2000 / intervalMs));
  const steps = Math.round((nominalS * 1000) / intervalMs);
  const window = observedWindow({ runStartMs, nominalS, samples, probes, samplesExpected: steps, probesExpected: Math.floor(steps / probeEvery), unobservedS });
  const obs = window.observedS;
  const hangEvents = buildHangEvents({ probes, samples, hangMs: th.hang, recoveryMs: th.recovery });

  const used = samples.map((s) => s.usedPct), free = samples.map((s) => s.freeGB);
  const commits = finite(probes.map((s) => s.committed));
  const pages = finite(probes.map((s) => s.pages));
  const diskSec = finite(probes.map((s) => s.diskSec)), diskQ = finite(probes.map((s) => s.diskQ));
  const freq = finite(probes.map((s) => s.maxFreq));
  const spawnMs = probes.map((s) => s.ms);

  const frozenFullMs = hangEvents.reduce((a, h) => a + h.ms, 0);
  const frozenExcessMs = hangEvents.reduce((a, h) => a + Math.max(0, h.ms - th.hang), 0);
  const windowMs = Number.isFinite(obs) && obs > 0 ? obs * 1000 : null;
  const meanFreezeS = hangEvents.length ? round(frozenFullMs / hangEvents.length / 1000, 2) : null;

  const summary = {
    windowBasis: 'observed',
    avgUsedPct: nul('avgUsedPct', used.length ? round(used.reduce((a, v) => a + v, 0) / used.length, 1) : null, 'no RAM samples recorded'),
    minFreeGB: nul('minFreeGB', free.length ? round(Math.min(...free), 2) : null, 'no RAM samples recorded'),
    committedPeak: nul('committedPeak', commits.length ? round(Math.max(...commits), 1) : null, 'no probe returned a committed-bytes value'),
    pagesPeak: nul('pagesPeak', pages.length ? round(Math.max(...pages), 0) : null, 'no probe returned a pages/sec value'),
    pagesAvg: nul('pagesAvg', pages.length ? round(pages.reduce((a, v) => a + v, 0) / pages.length, 0) : null, 'no probe returned a pages/sec value'),
    diskSecPeak: nul('diskSecPeak', diskSec.length ? Math.max(...diskSec) : null, 'no probe returned disk latency'),
    diskQPeak: nul('diskQPeak', diskQ.length ? Math.max(...diskQ) : null, 'no probe returned disk queue length'),
    maxFreqMin: nul('maxFreqMin', freq.length ? round(Math.min(...freq), 0) : null, 'no probe returned %maxFreq'),
    loopP50ms: nul('loopP50ms', lagProbes.length ? round(pct(lagProbes, 50), 2) : null, 'no loop-lag samples'),
    loopP95ms: nul('loopP95ms', lagProbes.length ? round(pct(lagProbes, 95), 2) : null, 'no loop-lag samples'),
    loopMaxMs: nul('loopMaxMs', lagProbes.length ? round(Math.max(...lagProbes), 2) : null, 'no loop-lag samples'),
    spawnP50ms: nul('spawnP50ms', spawnMs.length ? round(pct(spawnMs, 50), 0) : null, 'no spawn probes recorded'),
    spawnP95ms: nul('spawnP95ms', spawnMs.length ? round(pct(spawnMs, 95), 0) : null, 'no spawn probes recorded'),
    spawnMaxMs: nul('spawnMaxMs', spawnMs.length ? round(Math.max(...spawnMs), 0) : null, 'no spawn probes recorded'),
    hangThresholdMs: th.hang,
    hangEventCount: hangEvents.length,
    hangRatePerMin: nul('hangRatePerMin', ratePerMin(hangEvents.length, obs), 'no observed window (no samples or probes)'),
    pctFrozenFull: nul('pctFrozenFull', windowMs ? round((frozenFullMs / windowMs) * 100, 2) : null, 'no observed window'),
    pctFrozenExcess: nul('pctFrozenExcess', windowMs ? round((frozenExcessMs / windowMs) * 100, 2) : null, 'no observed window'),
    mttrMs: nul('mttrMs', hangEvents.length ? round(pct(hangEvents.map((h) => h.context.recoveryMs ?? h.ms), 50), 0) : null, 'no hangs observed'),
    mttrN: hangEvents.length,
    meanFreezeS: nul('meanFreezeS', meanFreezeS, 'no hangs observed'),
    secsOverRamHigh: nul('secsOverRamHigh', samples.length ? secsOver(samples, th.ramHigh) : null, 'no RAM samples recorded'),
    secsOverRamHighBasis: `time above ${th.ramHigh}% RAM, each sample weighted by its measured spacing`,
    calmSharePct: nul('calmSharePct', probes.length ? round((probes.filter((s) => s.ms < th.recovery).length / probes.length) * 100, 1) : null, 'no spawn probes recorded'),
    recoveryThresholdMs: th.recovery,
    granularityMs: intervalMs, totalSamples: samples.length, totalSpawnProbes: probes.length,
  };
  return { window, hangEvents, summary, nulls };
}

module.exports = { offsetSec, observedWindow, ratePerMin, secsOver, buildHangEvents, buildCore };
