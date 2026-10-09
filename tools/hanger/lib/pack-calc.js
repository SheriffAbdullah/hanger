'use strict';
// Second-order pack derivations. Thresholds come from the recorded trace, never from the
// current command line ("first-order data is never overwritten by second-order computation").
// The finding, the hardware-versus-configuration signal and the time-lost context are READ from the stored
// `diagnosis` of the trace: the pack never recomputes an inference (and never invents a label of its own).
const { num } = require('./numbers');

// Choose the thresholds a pack must use: the trace's recorded ones win over current flags.
function thresholdsUsed(trace, current) {
  const rec = (trace && trace.summary && trace.summary.thresholds) || null;
  if (!rec) return { used: { ...current }, source: 'current-flags (trace recorded none)', ignoredCurrent: {} };
  const used = { ...current }, ignored = {};
  for (const k of Object.keys(current)) {
    if (rec[k] !== undefined && typeof rec[k] === 'number') {
      if (rec[k] !== current[k]) ignored[k] = { current: current[k], used: rec[k] };
      used[k] = rec[k];
    }
  }
  return { used, source: 'trace', ignoredCurrent: ignored };
}

// latest: a v2 trace report. -> {thresholds, windowS, n, finding, rollup, hwConfigSignal, timeLost, note}
function packDerived(latest, currentTH) {
  const t = thresholdsUsed(latest, currentTH);
  const d = latest && latest.diagnosis ? latest.diagnosis : null;
  // the window is the observed window (never sample interval x probe count)
  const obs = latest && latest.window ? latest.window.observedS : null;
  const windowS = Number.isFinite(obs) ? Math.round(obs) : null;
  const n = latest && latest.summary && Number.isFinite(latest.summary.totalSpawnProbes) ? latest.summary.totalSpawnProbes : 0;
  if (!d) {
    return { thresholds: t, windowS, n, finding: null, rollup: [], hwConfigSignal: null, timeLost: null,
      note: 'this trace carries no diagnosis (recorded before the diagnosis engine); re-capture with this version' };
  }
  return { thresholds: t, windowS, n, finding: d.finding, rollup: (d.rollup || []).slice(0, 3), hwConfigSignal: d.hwConfigSignal || null, timeLost: d.timeLost || null, note: null };
}

// input-response check in a pack: copied from the trace as recorded (never recomputed); the stall threshold used is the
// recorded one, so a later `pack --stall-ms 500` over a report recorded at 250 still uses 250.
// Returns the keys to spread into the pack object: { inputStall, probeAgreement, inputStallThreshold }.
function packInputBlock(latest, currentStallMs = null) {
  const sec = latest && latest.inputStall ? latest.inputStall : null;
  const recorded = sec && sec.settings && sec.settings.stallMs && Number.isFinite(sec.settings.stallMs.v) ? sec.settings.stallMs.v : null;
  const used = recorded !== null ? recorded : (Number.isFinite(currentStallMs) ? currentStallMs : null);
  const ignored = recorded !== null && Number.isFinite(currentStallMs) && currentStallMs !== recorded ? { current: currentStallMs, used: recorded } : null;
  return {
    inputStall: sec || { status: 'not evaluated', reason: 'report predates the input-response check' },
    probeAgreement: latest && latest.diagnosis && latest.diagnosis.probeAgreement ? latest.diagnosis.probeAgreement : { status: 'not evaluated', reason: 'report predates the input-response check' },
    inputStallThreshold: { stallMs: used, source: recorded !== null ? 'trace' : (used !== null ? 'current-flags (trace recorded none)' : 'not recorded'), ignoredCurrent: ignored },
  };
}

module.exports = { thresholdsUsed, packDerived, packInputBlock, num };
