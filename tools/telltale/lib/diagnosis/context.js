'use strict';
// Builds the read-only context every rule works from, once per diagnosis:
// usable probes (observer-affected ones removed), hangs and their confirmations, calm set and calm means,
// marks joined within +-2 s, windowed OS events, recorded thresholds. Rules read only ctx and the hang.
const signals = require('./signals');
const inputReport = require('../input/report');
const agreement = require('../input/agreement');

const MIN_USABLE = 10;          // probes before any cause is ranked (OQ-15)
const SUSTAINED_MIN = 3;        // probes before a condition is called sustained
const STARTUP_S = 10;           // first seconds of a run: the tool's own start-up inflates probes
const OBSERVER_SLOW_MS = 2000;  // collection longer than this slowed the probe itself
const SLIP_S = 1;
const MARK_JOIN_MS = 2000;
const CALM_GAP_S = 10;
const EXPECTED_EVENT_PROVIDERS = { appHang: /^Application Hang$/i, appCrash: /^Application Error$/i, resourceExhaustion: /^Microsoft-Windows-Resource-Exhaustion-Detector$/i };

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

function buildContext(report, opts = {}) {
  const env = signals.envOf(report);
  const rows = signals.rowsOf(report);
  const summaryTh = (report.summary && report.summary.thresholds) || {};
  const settingsTh = (report.settings && report.settings.thresholds) || {};
  const TH = { hang: 800, recovery: 400, commit: 85, minFreeGB: 2, diskSec: 0.025, defender: 20, ...numericOnly(summaryTh), ...(opts.thresholds || {}) };
  const startedMs = Date.parse((report.run && report.run.startedAt) || report.startedAt);
  const endedMs = Date.parse((report.run && report.run.endedAt) || '') || null;
  const heavy = (report.sampling && Array.isArray(report.sampling.heavyRuns) ? report.sampling.heavyRuns : []).filter((h) => finite(h.elapsedMs) && h.elapsedMs > OBSERVER_SLOW_MS);

  const probes = rows.map((p, i) => {
    const atMs = Date.parse(p.at);
    const hang = typeof p.hang === 'boolean' ? p.hang : (finite(p.ms) && p.ms >= TH.hang);
    return { i, p, ref: `spawnProbes[${i}]`, atMs, tSec: finite(p.tSec) ? p.tSec : (Number.isFinite(atMs) && Number.isFinite(startedMs) ? (atMs - startedMs) / 1000 : null), ms: p.ms, hang };
  });

  // ---- observer guard: probes the tool itself slowed never feed a rule (they stay in the report) ----
  const excluded = [];
  for (const q of probes) {
    const reasons = [];
    if (q.i === 0 || (finite(q.tSec) && q.tSec < STARTUP_S)) reasons.push('startup-window');
    const collectMs = finite(q.p.collectMs) ? q.p.collectMs : q.p.bundleMs;
    const overlapsHeavy = finite(q.ms) && heavy.some((h) => { const s = Date.parse(h.at); return Number.isFinite(s) && s < q.atMs && s + h.elapsedMs > q.atMs - q.ms; });
    if ((finite(collectMs) && collectMs > OBSERVER_SLOW_MS) || overlapsHeavy) reasons.push('observer-slow');
    // slip is measured at the probe's completion, so a long probe slips by its own latency: only lateness beyond that counts
    if (finite(q.p.slipS) && q.p.slipS - (finite(q.ms) ? q.ms / 1000 : 0) > SLIP_S) reasons.push('observer-slip');
    q.excluded = reasons.length ? reasons : null;
    if (reasons.length) excluded.push({ ref: q.ref, reasons });
  }
  const usable = probes.filter((q) => !q.excluded);
  const allHangs = probes.filter((q) => q.hang);
  const hangs = allHangs.filter((q) => !q.excluded);
  const excludedHangs = allHangs.filter((q) => q.excluded);

  // ---- calm: usable, below the recovery threshold, at least 10 s away from every hang ----
  const nearAnyHang = (q) => allHangs.some((h) => finite(h.tSec) && finite(q.tSec) && Math.abs(h.tSec - q.tSec) < CALM_GAP_S);
  const calm = usable.filter((q) => !q.hang && finite(q.ms) && q.ms < TH.recovery && !nearAnyHang(q));
  const calmCache = new Map();
  const calmMean = (name) => {
    if (calmCache.has(name)) return calmCache.get(name);
    const v = calm.map((q) => signals.read(q.p, name, env)).filter(finite);
    const out = { mean: v.length ? r1x(mean(v), name) : null, n: v.length, signal: name };
    calmCache.set(name, out);
    return out;
  };
  const r1x = (x) => Math.round(x * 100) / 100;

  // ---- user marks joined to the nearest probe within +-2 s ----
  const marks = (Array.isArray(report.userMarks) ? report.userMarks : []).map((m) => {
    const ms = Date.parse(m.at);
    return { at: m.at, atMs: ms, tSec: m.tSec, kind: m.kind === 'fine' ? 'fine' : 'hung', note: m.note || null };
  }).filter((m) => Number.isFinite(m.atMs));
  const joined = [], unmatched = [];
  for (const m of marks) {
    let best = null;
    for (const q of probes) { const gap = Math.abs(q.atMs - m.atMs); if (!best || gap < best.gap) best = { q, gap }; }
    if (best && best.gap <= MARK_JOIN_MS) {
      joined.push({ at: m.at, kind: m.kind, note: m.note, ref: best.q.ref, gapMs: Math.round(best.gap), onHang: best.q.hang, role: m.kind === 'fine' ? (best.q.hang ? 'fine-on-hang' : 'calm-anchor') : (best.q.hang ? 'hang-confirmed' : 'hung-on-calm-probe') });
    } else unmatched.push({ at: m.at, kind: m.kind, note: m.note, gapMs: best ? Math.round(best.gap) : null, nearestRef: best ? best.q.ref : null });
  }
  const hungMarks = marks.filter((m) => m.kind === 'hung');
  const markNear = (q) => hungMarks.some((m) => Math.abs(q.atMs - m.atMs) <= MARK_JOIN_MS);

  // ---- confirmations: user mark, OS not-responding (in-scope, at the hang), workload probe timeout ----
  const inputSection = report.inputStall && typeof report.inputStall === 'object' ? report.inputStall : null;
  const stallEpisodes = inputSection && inputSection.status === 'running' ? inputReport.episodesForJoin(inputSection) : [];
  const stallEligible = stallEpisodes.filter(agreement.isEligible);
  const wlProbes = report.workload && report.workload.probes ? Object.values(report.workload.probes).flat() : [];
  const confirmedBy = (q) => {
    const by = [];
    if (markNear(q)) by.push('user-mark');
    const p = q.p;
    if (p.osConfirmed === true && p.osConfirmState !== 'not-evaluated' && Array.isArray(p.osHungWindows) && p.osHungWindows.length) by.push('os-not-responding');
    if (wlProbes.some((w) => w && w.status === 'timeout' && Math.abs(Date.parse(w.at) - q.atMs) <= MARK_JOIN_MS)) by.push('workload-probe');
    // input-stall: an eligible episode (in-scope or system foreground, not chronically slow) overlapping the hang interval +-2 s
    if (stallEligible.some((e) => agreement.overlaps(q.atMs - (finite(q.ms) ? q.ms : 0), q.atMs, e.startMs, e.endMs, MARK_JOIN_MS))) by.push('input-stall');
    return by.length ? by : ['probe-only'];
  };
  for (const q of allHangs) q.confirmedBy = confirmedBy(q);

  // ---- helper lateness at each hang: true | false | 'not evaluated' (with a reason); corroboration only, never a cause input ----
  const helperLateAt = (q) => {
    if (!inputSection) return { value: 'not evaluated', reason: 'report predates the input-response check' };
    if (inputSection.status !== 'running') return { value: 'not evaluated', reason: inputSection.reason || `the input-response check was ${inputSection.status}` };
    const iv = { from: q.atMs - (finite(q.ms) ? q.ms : 0) - MARK_JOIN_MS, to: q.atMs + MARK_JOIN_MS };
    const ob = inputSection.evaluable && inputSection.evaluable.observed;
    if (ob && (Date.parse(ob.to) < iv.from || Date.parse(ob.from) > iv.to)) return { value: 'not evaluated', reason: 'the helper was not observing at this hang' };
    const exited = ((inputSection.evaluable && inputSection.evaluable.notEvaluable) || []).some((x) => x.reason === 'helper-exited' && Date.parse(x.from) <= iv.to && Date.parse(x.to) >= iv.from);
    if (exited) return { value: 'not evaluated', reason: 'the helper had exited (helper-exited)' };
    const lp = (inputSection.helperLateness && inputSection.helperLateness.latePeriods) || [];
    return { value: lp.some((p) => Date.parse(p.startAt) <= iv.to && Date.parse(p.endAt) >= iv.from) };
  };
  for (const q of allHangs) { const h = helperLateAt(q); q.helperLate = h.value; if (h.reason) q.helperLateReason = h.reason; }

  // proxy validation against the hung marks (both numerators and denominators)
  const matchedMarks = hungMarks.filter((m) => allHangs.some((h) => Math.abs(h.atMs - m.atMs) <= MARK_JOIN_MS)).length;
  const matchedHangs = allHangs.filter(markNear).length;
  const proxyValidation = hungMarks.length
    ? { status: 'validated', precision: { num: matchedHangs, den: allHangs.length, value: allHangs.length ? Math.round(matchedHangs / allHangs.length * 100) / 100 : null },
        recall: { num: matchedMarks, den: hungMarks.length, value: Math.round(matchedMarks / hungMarks.length * 100) / 100 } }
    : { status: 'not validated', reason: 'no hung user marks were recorded' };

  // ---- OS events: inside the observed window and from the expected provider only ----
  const eventsUsed = [], eventsHistory = [];
  const ev = report.events || {};
  for (const [key, list] of Object.entries(ev.inWindow || {})) {
    for (const e of Array.isArray(list) ? list : []) {
      const t = Date.parse(e.at);
      const inRun = Number.isFinite(t) && Number.isFinite(startedMs) && t >= startedMs && (endedMs === null || t <= endedMs);
      const okProv = EXPECTED_EVENT_PROVIDERS[key] ? EXPECTED_EVENT_PROVIDERS[key].test(String(e.provider || '')) : true;
      (inRun && okProv ? eventsUsed : eventsHistory).push({ kind: key, id: e.id, at: e.at, provider: e.provider || null });
    }
  }
  // older records and counts that the event section already classified as history
  const eventsHistoryCounts = {};
  for (const [key, h] of Object.entries(ev.history || {})) eventsHistoryCounts[key] = h && h.count !== undefined ? h.count : null;

  // ---- helpers rules use ----
  const sig = (q, name) => signals.read(q.p, name, env);
  const input = (q, name) => {
    const value = sig(q, name);
    const raw = signals.rawOf(q.p, name, env);
    return { ref: q.ref, signal: name, at: q.p.at, value, unit: signals.unitOf(name), ...(raw !== null ? { rawValue: raw, rawNote: 'per-core-scaled value divided by logical processors' } : {}) };
  };
  // usable probes within +-s seconds of a hang (the hang probe itself included when usable)
  const near = (h, s = 10) => usable.filter((q) => finite(q.tSec) && finite(h.tSec) && Math.abs(q.tSec - h.tSec) <= s);
  // a condition is "sustained" only when it holds on at least SUSTAINED_MIN probes
  const sustained = (list, pred) => {
    const hit = list.filter(pred);
    return { sustained: hit.length >= SUSTAINED_MIN, count: hit.length, of: list.length, min: SUSTAINED_MIN, hit,
      text: `${hit.length} of ${list.length} probes, minimum ${SUSTAINED_MIN}` };
  };
  const failures = Array.isArray(report['collection.failures']) ? report['collection.failures'] : [];
  // why a signal is absent: the recorded collection failure when there is one
  const missing = (name) => {
    const keys = signals.failureKeysOf(name);
    const f = failures.find((x) => x && (keys.includes(x.inference) || keys.includes(x.collector)) && x.mode);
    return `${name} not recorded at this hang${f ? ` (${f.mode}${f.reason ? `: ${String(f.reason).slice(0, 80)}` : ''})` : ' (no value stored)'}`;
  };
  // recorded threshold: value from the run's recorded thresholds, origin from the effective settings, source from the citation table
  const threshold = (key, { def, unit, scale = 1, id = key }) => {
    const raw = finite(summaryTh[key]) ? summaryTh[key] : (finite(TH[key]) ? TH[key] : def);
    const set = settingsTh[key];
    const src = summaryTh.sources && summaryTh.sources[key];
    return { value: Math.round(raw * scale * 1000) / 1000, unit, source: src ? String(src).split('[')[0].trim().slice(0, 80) + (/\[(cited|derived|guess)\]/.exec(src) ? ` [${/\[(cited|derived|guess)\]/.exec(src)[1]}]` : '') : 'provisional', origin: set && set.source ? set.source : 'default', key: id };
  };
  const constant = (id, value, unit, source = 'provisional') => ({ value, unit, source, origin: 'default', key: id });
  const scopeObj = report.scope || null;
  const openScope = !scopeObj || scopeObj.mode === 'open';

  const ctx = {
    report, env, TH, logicalCpus: env.logicalCpus, probes, usable, hangs, allHangs, excludedHangs, excluded, calm, calmMean,
    marks: { joined, unmatched, all: marks }, proxyValidation, eventsUsed, eventsHistory, eventsHistoryCounts,
    inputSection, stallEpisodes, stallEligible, sig, input, near, sustained, missing, threshold, constant, openScope, scope: scopeObj,
    minUsable: MIN_USABLE, sustainedMin: SUSTAINED_MIN, startedMs, endedMs,
  };
  return ctx;
}

function numericOnly(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

module.exports = { buildContext, MIN_USABLE, SUSTAINED_MIN, STARTUP_S, OBSERVER_SLOW_MS, MARK_JOIN_MS, CALM_GAP_S };
