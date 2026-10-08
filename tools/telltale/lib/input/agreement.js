'use strict';
// Agreement between the spawn probe's hangs and felt input-response stalls, and episode corroboration counts (pure).
// Join: a probe hang's measured interval [at - ms, at], widened by the tolerance on each side, overlaps an episode interval.
const TOLERANCE_MS = 2000;
const ratio = (num, den) => ({ num, den, value: den ? Math.round((num / den) * 100) / 100 : null });
const NOT_EVAL = (reason) => ({ status: 'not evaluated', reason });

const hangInterval = (h) => ({ from: h.atMs - (Number(h.ms) || 0), to: h.atMs });
const overlaps = (aFrom, aTo, bFrom, bTo, tol = 0) => aFrom - tol <= bTo && bFrom <= aTo + tol;

// an episode counts as a confirmation / agreement source only when its foreground is in scope or system and it is not chronically slow
const isEligible = (ep) => (ep.foreground.kind === 'in-scope' || ep.foreground.kind === 'system') && !(ep.guards || []).includes('chronic-slow-app');

// episodes: [{ref, startMs, endMs, durationMs, foreground:{kind}, guards[]}]; hangs: [{ref, atMs, ms}]
// evaluated: { active:[{fromMs,toMs}], notEvaluable:[{fromMs,toMs}], observed:[{fromMs,toMs}]|null }
function probeAgreement({ status = 'running', reason = null, hangs, episodes, evaluated, probeIntervalS, toleranceMs = TOLERANCE_MS, stallMs = null }) {
  const base = { toleranceMs, stallMs, probeIntervalS: probeIntervalS === undefined ? null : probeIntervalS };
  if (status !== 'running') return { status: 'not evaluated', reason: reason || 'the input-response check was not running', ...base };
  const ev = evaluated || { active: [], notEvaluable: [], observed: null };
  const eligible = episodes.filter(isEligible);
  const outOfScope = episodes.filter((e) => e.foreground.kind === 'out-of-scope');
  const excluded = { idle: 0, notEvaluable: 0, unobserved: 0 };
  const duringEval = [];
  for (const h of hangs) {
    const iv = hangInterval(h);
    if (ev.observed && !ev.observed.some((o) => overlaps(iv.from, iv.to, o.fromMs, o.toMs))) { excluded.unobserved++; continue; }
    if (ev.notEvaluable.some((s) => overlaps(iv.from, iv.to, s.fromMs, s.toMs))) { excluded.notEvaluable++; continue; }
    // input-recent time overlapped by the hang or by the tolerance window before it
    if (!ev.active.some((a) => overlaps(iv.from, iv.to, a.fromMs, a.toMs, toleranceMs)) && !eligible.some((e) => overlaps(iv.from, iv.to, e.startMs, e.endMs, toleranceMs))) { excluded.idle++; continue; }
    duringEval.push(h);
  }
  const hitsEligible = (h) => { const iv = hangInterval(h); return eligible.some((e) => overlaps(iv.from, iv.to, e.startMs, e.endMs, toleranceMs)); };
  const hitsOut = (h) => { const iv = hangInterval(h); return outOfScope.some((e) => overlaps(iv.from, iv.to, e.startMs, e.endMs, toleranceMs)); };
  const matchedHangs = duringEval.filter(hitsEligible);
  const probeHangsWithoutStall = duringEval.filter((h) => !hitsEligible(h)).map((h) => ({ ref: h.ref, at: new Date(h.atMs).toISOString(), reason: hitsOut(h) ? 'overlaps an out-of-scope foreground episode' : null }));
  const hitByHang = (e) => hangs.some((h) => { const iv = hangInterval(h); return overlaps(iv.from, iv.to, e.startMs, e.endMs, toleranceMs); });
  const matchedEps = eligible.filter(hitByHang);
  const stallsWithoutProbeHang = eligible.filter((e) => !hitByHang(e)).map((e) => ({ ref: e.ref, at: new Date(e.startMs).toISOString(), durationMs: e.durationMs }));
  const probeMs = Number.isFinite(probeIntervalS) ? probeIntervalS * 1000 : null;
  const longEps = probeMs === null ? [] : eligible.filter((e) => e.durationMs >= probeMs);
  const out = { status: 'evaluated', ...base, excluded, outOfScopeEpisodes: outOfScope.length, probeHangsEvaluated: duringEval.length };
  out.precision = ratio(matchedHangs.length, duringEval.length);
  if (!eligible.length) {
    out.recall = NOT_EVAL('the detector observed no stall in evaluated time');
    out.recallAtProbeResolution = NOT_EVAL('the detector observed no stall in evaluated time');
    out.note = duringEval.length ? 'the detector observed no stall in evaluated time, so every probe hang counts against precision' : 'the detector observed no stall in evaluated time';
  } else {
    out.recall = ratio(matchedEps.length, eligible.length);
    out.recallAtProbeResolution = probeMs === null ? NOT_EVAL('the probe interval is not known') : ratio(longEps.filter(hitByHang).length, longEps.length);
  }
  out.probeHangsWithoutStall = probeHangsWithoutStall;
  out.stallsWithoutProbeHang = stallsWithoutProbeHang;
  return out;
}

// per-episode corroboration; sources: probe-hang, os-not-responding, user-mark, workload-probe; helper-late is corroboration only
function corroboratedBy(ep, { hangs, marksMs, workloadTimeoutsMs, latePeriods, toleranceMs = TOLERANCE_MS }) {
  const by = [];
  const hit = (h) => { const iv = hangInterval(h); return overlaps(iv.from, iv.to, ep.startMs, ep.endMs, toleranceMs); };
  const hh = (hangs || []).filter(hit);
  if (hh.length) by.push('probe-hang');
  if (hh.some((h) => h.osConfirmed)) by.push('os-not-responding');
  if ((marksMs || []).some((m) => m >= ep.startMs - toleranceMs && m <= ep.endMs + toleranceMs)) by.push('user-mark');
  if ((workloadTimeoutsMs || []).some((m) => m >= ep.startMs - toleranceMs && m <= ep.endMs + toleranceMs)) by.push('workload-probe');
  if ((latePeriods || []).some((p) => overlaps(p.startMs, p.endMs, ep.startMs, ep.endMs))) by.push('helper-late');
  return by;
}

// counts over the eligible episodes, each with its denominator
function corroboration({ status = 'running', reason = null, episodes }) {
  if (status !== 'running') return { status: 'not evaluated', reason: reason || 'the input-response check was not running' };
  const eligible = episodes.filter(isEligible);
  const den = eligible.length;
  const c = (key) => ({ num: eligible.filter((e) => (e.corroboratedBy || []).includes(key)).length, den });
  const real = ['probe-hang', 'os-not-responding', 'user-mark', 'workload-probe', 'helper-late'];
  const out = {
    status: 'evaluated', episodes: den, probeHang: c('probe-hang'), osNotResponding: c('os-not-responding'), userMark: c('user-mark'),
    workloadProbe: c('workload-probe'), helperLate: c('helper-late'),
    none: { num: eligible.filter((e) => !real.some((k) => (e.corroboratedBy || []).includes(k))).length, den },
  };
  if (!den) out.note = 'no input-response stall was observed in the evaluated time (this does not show that the machine did not freeze)';
  return out;
}

module.exports = { probeAgreement, corroboratedBy, corroboration, isEligible, hangInterval, overlaps, ratio, TOLERANCE_MS };
