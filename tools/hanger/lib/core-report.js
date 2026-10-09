'use strict';
// Builds the v2 summary report from run state (live memory or a recovered stream).
// Used for normal completion, interrupted runs, and `recover`.
const { buildCore } = require('./timebase');
const { plain } = require('./sampler/record');
const { mergeProbes } = require('./sampler/records');
const { createContinuous } = require('./sampler/scheduler');
const { summarizeProcs } = require('./collectors/summary');
const { NOT_COLLECTED } = require('./collectors');
const { buildWorkloadReport } = require('./workload/report');
const { buildInputStall } = require('./input/report');

const SCHEMA = 'hanger-json/2';

// state: { start (run-start record), samples, probes, marks, failures, lagProbes?, observer? }
// meta: { status: complete|interrupted|unfinished, endReason?, endedAt?, streamName? }
function buildCoreReport(state, meta) {
  const s = state.start || {};
  const th = s.thresholds || { hang: 800, recovery: 400, ramHigh: 85 };
  const runStartMs = Number.isFinite(s.runStartMs) ? s.runStartMs : (state.samples[0] ? Date.parse(state.samples[0].at) : Date.now());
  // stored form: provenance records; calculation form: plain numbers (the one accessor is plain()/val())
  const csamples = state.csamples || [];
  const probesRec = csamples.length || (state.probes || []).some((p) => 'bundleAt' in p) ? mergeProbes(state.probes, csamples) : state.probes;
  const samplesRec = state.samples;
  const probes = plain(probesRec), samples = plain(samplesRec);
  // continuous-tier cadence and gaps: derived from the persisted stream when no live scheduler summary was handed in
  const nominalCont = s.continuousNominalS || 2;
  const sampling = state.samplingSummary || deriveSampling(csamples, state.gaps || [], nominalCont, state.heavyRuns || [], state.samplingObserver || null, state.duration || null, runStartMs);
  const core = buildCore({
    runStartMs, nominalS: s.nominalS ?? null, intervalMs: s.intervalMs || 1000,
    samples, probes, lagProbes: state.lagProbes || [], th, unobservedS: sampling.unobservedS || 0,
  });
  // hang rows keep their provenance records; label/context are the derived part
  const recByAt = new Map(probesRec.map((p) => [p.at, p]));
  const hangEvents = core.hangEvents.map((h) => ({ ...(recByAt.get(h.at) || h), label: h.label, context: h.context }));
  const lastAt = [...state.samples, ...state.probes].map((x) => x.at).sort().pop() || null;
  // workload session (phases, markers, containers, VM, probes) + opt-in configuration facts; absent for streams from before it existed
  const wl = s.workloadDecl ? buildWorkloadReport(state, { declared: s.workloadDecl, runEndMs: meta.endedAt ? Date.parse(meta.endedAt) : null, scoped: s.workloadScoped !== false }) : null;
  // input-response stall detector: assembled from the helper's own file; absent for runs that predate it
  const inputStall = s.settings && s.settings.inputStall ? buildInputStall({
    settings: s.settings.inputStall, bridge: state.inputHelper || null, exit: state.inputHelperExit || null, dir: state.streamDir || null,
    hangs: probes.map((p, i) => ({ ref: `spawnProbes[${i}]`, atMs: Date.parse(p.at), ms: p.ms, hang: !!p.hang, osConfirmed: p.osConfirmed === true && p.osConfirmState !== 'not-evaluated' && Array.isArray(p.osHungWindows) && p.osHungWindows.length > 0 }))
      .filter((h) => h.hang && Number.isFinite(h.atMs)),
    marksMs: (state.marks || []).filter((m) => m.kind !== 'fine').map((m) => Date.parse(m.at)).filter(Number.isFinite),
    workloadTimeoutsMs: wl && wl.workload && wl.workload.probes ? Object.values(wl.workload.probes).flat().filter((x) => x && x.status === 'timeout').map((x) => Date.parse(x.at)).filter(Number.isFinite) : [],
    runEndMs: Date.parse(meta.endedAt || lastAt || '') || null,
  }) : null;
  return {
    tool: s.tool || 'hanger v0.6',
    schema: SCHEMA, schemaStatus: 'frozen',
    run: {
      status: meta.status, endReason: meta.endReason || null,
      startedAt: new Date(runStartMs).toISOString(), endedAt: meta.endedAt || lastAt,
      utcOffsetMin: Number.isFinite(s.utcOffsetMin) ? s.utcOffsetMin : -new Date(runStartMs).getTimezoneOffset(),
      stream: meta.streamName || null,
    },
    startedAt: new Date(runStartMs).toISOString(),
    window: core.window,
    settings: s.settings || {},
    observer: state.observer || { pids: null, wsMB: null, cpuPctAvg: null, note: 'observer cost not recovered from stream' },
    summary: { ...core.summary, thresholds: { ...th }, nulls: core.nulls },
    hangEvents,
    sampling: { provenance: isProvenance(probesRec, samplesRec), ...(sampling.report || sampling) },
    userMarks: state.marks,
    'collection.failures': state.failures,
    spawnProbes: probesRec,
    samples: samplesRec,
    // data-signals-completeness: run-level facts for the per-sample series carried on spawnProbes[]
    machine: { logicalCpus: s.logicalCpus || null },
    // storage-coverage: the user-declared workload drives (placement is never inferred)
    storage: require('./storage').declared({ workloadDrives: s.workloadDrives || [] }),
    power: { transitions: state.powerTransitions || [] },
    signals: state.signals && Object.keys(state.signals).length ? state.signals : null,
    'collection.notCollected': (state.signals && state.signals.notCollected) || NOT_COLLECTED,
    procsSummary: summarizeProcs(csamples),
    ...(wl ? { workload: wl.workload, workloadConfig: wl.workloadConfig } : {}),
    ...(inputStall ? { inputStall } : {}),
  };
}

const { isRec } = require('./sampler/record');
// true when the stored rows carry provenance records (a stream recovered from an older plain-number run does not)
const isProvenance = (probes, samples) => [...probes, ...samples].some((row) => row && Object.values(row).some(isRec));

// cadence + unobserved intervals from persisted continuous samples (the recover path and the end of every run)
function deriveSampling(csamples, gaps, nominalS, heavyRuns, observer, duration, runStartMs) {
  const c = createContinuous({ nominalS, gapFactor: 2 });
  for (const x of csamples) { const ms = Date.parse(x.at); if (Number.isFinite(ms)) c.onSample(ms); }
  // reasons live in the persisted gap records; the recomputed intervals only fill in what the stream lacks
  const unobserved = gaps.length ? gaps : c.unobserved;
  const unobservedS = +unobserved.reduce((a, g) => a + (g.durationS || 0), 0).toFixed(3);
  void runStartMs;
  return { unobservedS, report: {
    cadence: c.cadence(), unobserved, heavyRuns: heavyRuns || [],
    observer: observer || null, duration: duration || null,
  } };
}

module.exports = { buildCoreReport, deriveSampling, SCHEMA };
