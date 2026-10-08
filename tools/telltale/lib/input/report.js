'use strict';
// Assembles the report's `inputStall` section from the helper's own file (pure apart from reading that file).
// The same function runs at the end of a normal run, in interrupted-run summaries and in `recover`, so the three agree.
const fs = require('fs');
const path = require('path');
const { rec } = require('../sampler/record');
const { readStream } = require('../persist');
const episodesLib = require('./episodes');
const guardsLib = require('./guards');
const latenessLib = require('./lateness');
const confLib = require('./confidence');
const agreeLib = require('./agreement');

const SRC = 'input-helper';
const HELPER_QUIET_MS = 15000; // a helper that stopped writing this long before the run ended without an input-end record has exited

const CANNOT_SEE = [
  'waits inside an application whose interface keeps answering (a database call, a network wait, a long job behind a responsive window)',
  'freezes of the operating system\'s own input thread (the check relies on the system reporting when input occurred)',
  'stalls while the user provides no input (the check asks only while input is recent)',
  'moments it declined to judge (higher-privilege foreground application, locked screen, secure desktop, remote session, suspend and resume, helper starved), listed under not-evaluable time',
  'an episode lasts at least as long as it was measured: the check stops asking once input has been quiet for the recent-input window, so long freezes are lower bounds',
  'the 250 ms stall threshold and the other settings are provisional and have not been calibrated against marks',
];

const iso = (t) => new Date(t).toISOString();
const R = (v, unit, { windowS = null, n = 1, at = null, src = SRC, prec } = {}) => rec(v, { unit, windowS, n, src, at, prec });
const S = (ms2) => (ms2 === null || ms2 === undefined ? null : ms2 / 1000);

// settings in the report-section form: {v, unit, source, provisional}
function settingsBlock(effective, helperSettings) {
  const e = effective || {};
  const h = helperSettings || {};
  const pick = (k) => ({ v: Number.isFinite(h[k]) ? h[k] : (e[k] ? e[k].value : null), unit: 'ms', source: (e[k] && e[k].source) || 'default', provisional: true });
  return {
    stallMs: pick('stallMs'), recentInputMs: pick('recentInputMs'), mergeGapMs: pick('mergeGapMs'), lateMs: pick('lateMs'), tickMs: pick('tickMs'), timeoutMs: pick('timeoutMs'),
    ignoreGroups: { v: (e.ignoreGroups && e.ignoreGroups.value) || [], source: (e.ignoreGroups && e.ignoreGroups.source) || 'default' },
  };
}

function readHelperFile(file) {
  if (!file || !fs.existsSync(file)) return { missing: true, records: [], badLines: 0 };
  const { records, badLines } = readStream(file);
  return { missing: false, records, badLines };
}

const placeholder = (status, reason, extra = {}) => ({
  status, reason, determinedAt: extra.determinedAt || null, ...(extra.source ? { source: extra.source } : {}),
  helper: extra.helper || null, settings: extra.settings || null, evaluable: null, episodes: null, blips: null, calmBaseline: null, helperLateness: null,
  flags: null, outOfScope: null, unobserved: [], cannotSee: CANNOT_SEE.slice(),
});

// opts:
//   settings    effective settings.inputStall from run-start ({enabled:{value,source}, stallMs:{value,source}, ...})
//   bridge      the stream's `input-helper` record ({status, reason, build, file, at}) or null
//   dir         directory that holds the stream and the helper file
//   file        override helper file path (tests)
//   hangs       [{ref, atMs, ms, osConfirmed}]   spawn-probe hangs
//   marksMs     hung user marks (epoch ms)
//   workloadTimeoutsMs
//   runEndMs    run end (epoch ms) or null
//   probeIntervalS
function buildInputStall(opts) {
  const eff = opts.settings || null;
  const now = opts.nowIso || iso(Date.now());
  if (!eff) return null; // the stream predates the detector: no section at all
  if (eff.enabled && eff.enabled.value === false) {
    return placeholder('not-requested', 'the input-response check was turned off by the user', { source: eff.enabled.source, determinedAt: now, settings: settingsBlock(eff, null) });
  }
  const bridge = opts.bridge || null;
  if (!bridge) return placeholder('unavailable', 'the run stream holds no input-helper record', { determinedAt: now, settings: settingsBlock(eff, null) });
  if (bridge.status === 'unavailable') return placeholder('unavailable', bridge.reason || 'helper unavailable', { determinedAt: bridge.at || now, settings: settingsBlock(eff, null), helper: { build: bridge.build || null, file: null, badLines: 0 } });
  const file = opts.file || (opts.dir && bridge.file ? path.join(opts.dir, bridge.file) : null);
  const hf = readHelperFile(file);
  if (hf.missing) return placeholder('unavailable', `helper file ${bridge.file || '(unnamed)'} is missing`, { determinedAt: now, settings: settingsBlock(eff, null), helper: { build: bridge.build || null, file: bridge.file || null, badLines: 0 } });
  const recs = hf.records;
  const start = recs.find((r) => r.type === 'input-helper');
  if (!start) return placeholder('unavailable', `helper file ${bridge.file} holds no start record`, { determinedAt: now, settings: settingsBlock(eff, null), helper: { build: bridge.build || null, file: bridge.file || null, badLines: hf.badLines } });

  const hs = start.settings || {};
  const set = { stallMs: hs.stallMs ?? (eff.stallMs && eff.stallMs.value), mergeGapMs: hs.mergeGapMs ?? (eff.mergeGapMs && eff.mergeGapMs.value), tickMs: hs.tickMs ?? (eff.tickMs && eff.tickMs.value), lateMs: hs.lateMs ?? (eff.lateMs && eff.lateMs.value),
    ignoreGroups: (eff.ignoreGroups && eff.ignoreGroups.value) || [] };
  const samples = recs.filter((r) => r.type === 'input-stall-sample');
  const spans = recs.filter((r) => r.type === 'input-skip');
  const windows = recs.filter((r) => r.type === 'input-window');
  const lateRecs = recs.filter((r) => r.type === 'input-late');
  const end = [...recs].reverse().find((r) => r.type === 'input-end') || null;
  const runEndMs = Number.isFinite(opts.runEndMs) ? opts.runEndMs : null;

  // when did the helper last observe? a helper that stopped early leaves an unobserved interval
  const lastObsMs = Math.max(...[...windows.map((w) => episodesLib.ms(w.to)), ...(end ? [episodesLib.ms(end.at)] : [])].filter((x) => x !== null), episodesLib.ms(start.at) || 0);
  const unobserved = [];
  let exited = null;
  if (!end && runEndMs !== null && (opts.exit || runEndMs - lastObsMs > HELPER_QUIET_MS) && runEndMs > lastObsMs) {
    exited = { from: lastObsMs, to: runEndMs };
    unobserved.push({ from: iso(lastObsMs), to: iso(runEndMs), durationS: R(S(runEndMs - lastObsMs), 's', { n: 1, at: iso(runEndMs) }), reason: 'helper-exited' });
  }

  const built = episodesLib.buildEpisodes({ samples, spans, settings: set, runEndMs });
  const ev = episodesLib.evaluable({ windows, spans });
  const baseline = guardsLib.calmBaseline({ windows, stallMs: set.stallMs, blips: built.blips });
  const chronic = guardsLib.chronicSlowGroups(windows);
  const chronicSet = new Set(chronic.map((c) => c.group));
  const lateSum = latenessLib.summarize({ windows, latePeriods: lateRecs });
  const active = episodesLib.activeIntervals(windows);

  // corroboration inputs
  const hangs = opts.hangs || [];
  const marksMs = opts.marksMs || [];
  const wlMs = opts.workloadTimeoutsMs || [];
  const fgChangedWin = windows.filter((w) => Number(w.fgChanged) > 0).map((w) => ({ a: episodesLib.ms(w.from), b: episodesLib.ms(w.to) }));
  const eps = built.episodes.map((e, i) => {
    const ref = `inputStall.episodes[${i}]`;
    const guards = new Set(e.guards);
    if (lateSum.periods.some((p) => agreeLib.overlaps(p.startMs, p.endMs, e.startMs, e.endMs))) guards.add('helper-late');
    if (e.foreground.group && chronicSet.has(e.foreground.group)) guards.add('chronic-slow-app');
    if (fgChangedWin.some((w) => w.a !== null && agreeLib.overlaps(w.a, w.b, e.startMs, e.endMs))) guards.add('foreground-changed-near');
    const x = { ...e, ref, guards: [...guards] };
    x.corroboratedBy = agreeLib.corroboratedBy(x, { hangs, marksMs, workloadTimeoutsMs: wlMs, latePeriods: lateSum.periods });
    x.confidence = confLib.episodeConfidence(x, { stallMs: set.stallMs, noisy: baseline.noisy });
    return x;
  });

  const episodes = eps.map((e) => {
    const durMs = Math.round(e.durationMs);
    const win = durMs / 1000;
    const fg = e.foreground.kind === 'out-of-scope' ? { kind: 'out-of-scope' } : { kind: e.foreground.kind, group: e.foreground.group };
    return {
      id: e.id, startAt: iso(e.startMs), endAt: iso(e.endMs),
      durationMs: R(durMs, 'ms', { windowS: win, n: e.samples, at: iso(e.startMs) }),
      worstLatencyMs: R(e.worstLatencyMs, 'ms', { windowS: win, n: e.samples, at: iso(e.startMs) }),
      samples: e.samples, sampleRefs: e.sampleRefs, foreground: fg, endReason: e.endReason, guards: e.guards, corroboratedBy: e.corroboratedBy,
      confidence: { value: e.confidence.value, components: e.confidence.components, weights: e.confidence.weights },
    };
  });

  const outEps = eps.filter((e) => e.foreground.kind === 'out-of-scope');
  const outTotalMs = outEps.reduce((a, e) => a + e.durationMs, 0);
  const wFrom = windows.map((w) => episodesLib.ms(w.from)).filter((x) => x !== null), wTo = windows.map((w) => episodesLib.ms(w.to)).filter((x) => x !== null);
  const observed = wFrom.length ? { from: iso(Math.min(...wFrom)), to: iso(Math.max(...wTo)) } : null;
  const compact = compactActive(active);
  const notEval = ev.notEvaluable.map((s) => ({ from: iso(s.fromMs), to: iso(s.toMs), durationS: R(S(s.durationMs), 's', { n: 1, at: iso(s.toMs) }), reason: s.reason }));
  if (exited) notEval.push({ from: iso(exited.from), to: iso(exited.to), durationS: R(S(exited.to - exited.from), 's', { n: 1, at: iso(exited.to) }), reason: 'helper-exited' });
  const obsS = S(ev.observedMs);
  const wS = obsS;
  const nW = ev.windows;
  const m = (ms2) => R(S(ms2), 's', { windowS: wS, n: nW, at: now });

  const baselineOut = baseline.n
    ? {
      n: R(baseline.n, 'count', { windowS: wS, n: nW, at: now }), medianMs: R(baseline.medianMs, 'ms', { windowS: wS, n: baseline.n, at: now }), p95Ms: R(baseline.p95Ms, 'ms', { windowS: wS, n: baseline.n, at: now }),
      maxMs: R(baseline.maxMs, 'ms', { windowS: wS, n: baseline.n, at: now }), overThresholdPct: R(baseline.overThresholdPct, '%', { windowS: wS, n: baseline.n, at: now }),
      noisy: baseline.noisy, noisyWhy: baseline.noisyWhy,
    }
    : { n: R(0, 'count', { windowS: wS, n: nW, at: now }), medianMs: null, p95Ms: null, maxMs: null, overThresholdPct: null, medianMsReason: baseline.reason, p95MsReason: baseline.reason, maxMsReason: baseline.reason, overThresholdPctReason: baseline.reason, noisy: false, noisyWhy: null };

  const lat = lateSum.n
    ? { tickMs: set.tickMs, n: R(lateSum.n, 'count', { windowS: wS, n: nW, at: now }), medianMs: R(lateSum.medianMs, 'ms', { windowS: wS, n: lateSum.n, at: now }), p95Ms: R(lateSum.p95Ms, 'ms', { windowS: wS, n: lateSum.n, at: now }), maxMs: R(lateSum.maxMs, 'ms', { windowS: wS, n: lateSum.n, at: now }) }
    : { tickMs: set.tickMs, n: R(0, 'count', { windowS: wS, n: nW, at: now }), medianMs: null, p95Ms: null, maxMs: null, medianMsReason: 'no wake-ups were recorded', p95MsReason: 'no wake-ups were recorded', maxMsReason: 'no wake-ups were recorded' };
  lat.latePeriods = lateSum.periods.map((p) => ({ startAt: iso(p.startMs), endAt: iso(p.endMs), maxMs: R(p.maxMs, 'ms', { windowS: S(p.endMs - p.startMs), n: p.n, at: iso(p.endMs) }) }));

  return {
    status: 'running', reason: null, determinedAt: opts.nowIso || (bridge.at || now),
    helper: { build: bridge.build || start.build || null, file: bridge.file || null, badLines: hf.badLines, orderlyEnd: !!end },
    settings: settingsBlock(eff, set),
    evaluable: { observed, activeSpans: compact.spans, activeSpansTruncated: compact.truncated, observedS: m(ev.observedMs), evaluatedS: m(ev.evaluatedMs), idleS: m(ev.idleMs), notEvaluableS: m(ev.notEvaluableMs + (exited ? exited.to - exited.from : 0)), measurements: R(ev.measured, 'count', { windowS: wS, n: nW, at: now }), notEvaluable: notEval },
    episodes,
    blips: R(built.blips, 'count', { windowS: wS, n: nW, at: now }),
    calmBaseline: baselineOut,
    helperLateness: lat,
    flags: {
      chronicSlowGroups: chronic.map((c) => ({ group: c.group, measurements: R(c.n, 'count', { n: c.n, at: now }), overThreshold: R(c.over, 'count', { n: c.n, at: now }) })),
      ignored: Object.entries(built.ignored).map(([group, n]) => ({ group, samples: n })),
      foregroundChangedDropped: R(guardsLib.foregroundChangedDropped(windows), 'count', { windowS: wS, n: nW, at: now }),
      helperLateSamples: R(built.helperLateSamples, 'count', { windowS: wS, n: nW, at: now }),
      samplesInNotEvaluable: R(built.droppedInSpan, 'count', { windowS: wS, n: nW, at: now }),
    },
    outOfScope: { episodes: R(outEps.length, 'count', { windowS: wS, n: nW, at: now }), totalMs: R(outTotalMs, 'ms', { windowS: wS, n: outEps.length, at: now }) },
    unobserved,
    cannotSee: CANNOT_SEE.slice(),
  };
}

// merge input-recent intervals closer than gapMs and cap the list (stored so agreement recomputes from the report alone)
function compactActive(active, gapMs = 1000, cap = 5000) {
  const out = [];
  for (const a of active) {
    const last = out[out.length - 1];
    if (last && a.fromMs - last.toMs <= gapMs) last.toMs = Math.max(last.toMs, a.toMs); else out.push({ fromMs: a.fromMs, toMs: a.toMs });
  }
  return { spans: out.slice(0, cap).map((x) => ({ from: iso(x.fromMs), to: iso(x.toMs) })), truncated: out.length > cap };
}

// the first-order intervals the agreement join needs, read back from the stored section
function evaluatedFromSection(section) {
  const ev = section.evaluable || {};
  const ms2 = (x) => Date.parse(x);
  return {
    active: (ev.activeSpans || []).map((a) => ({ fromMs: ms2(a.from), toMs: ms2(a.to) })),
    notEvaluable: (ev.notEvaluable || []).map((a) => ({ fromMs: ms2(a.from), toMs: ms2(a.to) })),
    observed: ev.observed ? [{ fromMs: ms2(ev.observed.from), toMs: ms2(ev.observed.to) }] : null,
  };
}

// the first-order data a recomputation needs, derived from the stored section only (no helper file needed)
function episodesForJoin(section) {
  if (!section || section.status !== 'running' || !Array.isArray(section.episodes)) return [];
  return section.episodes.map((e, i) => ({
    ref: `inputStall.episodes[${i}]`, id: e.id, startMs: Date.parse(e.startAt), endMs: Date.parse(e.endAt),
    durationMs: e.durationMs && e.durationMs.v !== undefined ? e.durationMs.v : e.durationMs, foreground: e.foreground, guards: e.guards || [], corroboratedBy: e.corroboratedBy || [],
  }));
}

module.exports = { buildInputStall, evaluatedFromSection, compactActive, episodesForJoin, readHelperFile, settingsBlock, CANNOT_SEE, HELPER_QUIET_MS };
