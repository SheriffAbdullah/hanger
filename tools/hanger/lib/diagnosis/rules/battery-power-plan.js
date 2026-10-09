'use strict';
// Battery and power plan: compares hang RATES per observed minute on battery versus AC (never states), and the share of
// hangs under an efficiency power mode or Energy Saver versus calm probes. One power source observed means the rate
// comparison is "not evaluated", and the rule can fire only through the power-mode condition.
const K = require('./_kit');

const ID = 'battery-power-plan';

// observed minutes per side: each usable probe stands for the gap to the next one, capped at 3 median gaps
function sideStats(ctx) {
  return K.runLevel(ctx, `${ID}:sides`, () => {
    const u = ctx.usable.filter((q) => Number.isFinite(q.tSec));
    const gaps = u.slice(1).map((q, i) => q.tSec - u[i].tSec).filter((g) => g > 0).sort((a, b) => a - b);
    const med = gaps.length ? gaps[gaps.length >> 1] : null;
    const side = { battery: { probes: 0, hangs: 0, observedS: 0 }, ac: { probes: 0, hangs: 0, observedS: 0 } };
    u.forEach((q, i) => {
      const b = ctx.sig(q, 'power.on_battery');
      if (b === null) return;
      const s = b === 1 ? side.battery : side.ac;
      s.probes++;
      if (q.hang) s.hangs++;
      const dt = i + 1 < u.length ? Math.min(u[i + 1].tSec - q.tSec, med === null ? 0 : 3 * med) : (med || 0);
      s.observedS += Math.max(0, dt);
    });
    for (const s of Object.values(side)) { s.observedMin = Math.round(s.observedS / 6) / 10; s.ratePerMin = s.observedS > 0 ? Math.round(s.hangs / (s.observedS / 60) * 1000) / 1000 : null; }
    return side;
  });
}

// run-level evaluation of the two conditions
function judge(ctx) {
  return K.runLevel(ctx, `${ID}:judge`, () => {
    const tR = K.th(ctx, ID, 'rateRatio'), tH = K.th(ctx, ID, 'minHangsPerSide'), tN = K.th(ctx, ID, 'minProbesPerSide');
    const tMH = K.th(ctx, ID, 'modeHangShare'), tMC = K.th(ctx, ID, 'modeCalmShare'), tD = K.th(ctx, ID, 'disproveRatio');
    const side = sideStats(ctx);
    const out = { side, rate: { evaluated: false, fired: false, ratio: null, reason: null }, mode: { evaluated: false, fired: false, hangShare: null, calmShare: null, reason: null } };
    const b = side.battery, a = side.ac;
    if (b.probes === 0 || a.probes === 0) out.rate.reason = 'single power source observed';
    else if (b.hangs < tH.value || a.hangs < tH.value || b.probes < tN.value || a.probes < tN.value) out.rate.reason = `not enough data on each side (battery ${b.hangs} hangs/${b.probes} probes, AC ${a.hangs} hangs/${a.probes} probes; needs ${tH.value} hangs and ${tN.value} probes each)`;
    else {
      out.rate.evaluated = true;
      out.rate.ratio = a.ratePerMin > 0 ? Math.round(b.ratePerMin / a.ratePerMin * 100) / 100 : null;
      out.rate.fired = out.rate.ratio !== null && out.rate.ratio >= tR.value;
      out.rate.within = out.rate.ratio !== null && out.rate.ratio <= tD.value && out.rate.ratio >= 1 / tD.value;
    }
    const hm = ctx.hangs.map((q) => ({ q, m: ctx.sig(q, 'power.efficiency_mode') })).filter((x) => x.m !== null);
    const cm = ctx.calm.map((q) => ctx.sig(q, 'power.efficiency_mode')).filter((x) => x !== null);
    if (hm.length < ctx.sustainedMin || cm.length < ctx.sustainedMin) out.mode.reason = `power mode / energy saver known at ${hm.length} hangs and ${cm.length} calm probes (needs ${ctx.sustainedMin} of each)`;
    else {
      out.mode.evaluated = true;
      out.mode.hangShare = Math.round(hm.filter((x) => x.m === 1).length / hm.length * 1000) / 1000;
      out.mode.calmShare = Math.round(cm.filter((x) => x === 1).length / cm.length * 1000) / 1000;
      out.mode.fired = out.mode.hangShare >= tMH.value && out.mode.calmShare < tMC.value;
    }
    return out;
  });
}

module.exports = {
  id: ID,
  class: 'thermal-power',
  phrase: 'battery or power plan',
  valueLabel: 'hangs on battery vs AC',
  evaluate(ctx, h) {
    const tR = K.th(ctx, ID, 'rateRatio');
    const j = judge(ctx);
    if (!j.rate.evaluated && !j.mode.evaluated) return K.nullResult(tR, `rate comparison not evaluated: ${j.rate.reason}; power mode not evaluated: ${j.mode.reason}`, { extra: summaryExtra(j) });
    const onBat = ctx.sig(h, 'power.on_battery') === 1, eff = ctx.sig(h, 'power.efficiency_mode') === 1;
    const viaRate = j.rate.fired && onBat, viaMode = j.mode.fired && eff;
    const fired = viaRate || viaMode;
    const side = j.side;
    const why = [];
    if (!j.rate.evaluated) why.push(`rate comparison not evaluated (${j.rate.reason})`);
    else if (!j.rate.fired) why.push(`battery rate ${side.battery.ratePerMin}/min vs AC ${side.ac.ratePerMin}/min (ratio ${j.rate.ratio}, needs ${tR.value})`);
    else if (!onBat) why.push('this hang was on AC');
    if (!j.mode.evaluated) why.push(`power-mode condition not evaluated (${j.mode.reason})`);
    else if (!j.mode.fired) why.push(`${Math.round(j.mode.hangShare * 100)}% of hangs under an efficiency mode vs ${Math.round(j.mode.calmShare * 100)}% of calm probes`);
    const inputs = [];
    for (const n of ['power.on_battery', 'power.efficiency_mode']) if (ctx.sig(h, n) !== null) inputs.push(ctx.input(h, n));
    const rateSide = viaRate || (!viaMode && onBat) ? side.battery : side.ac;
    return { fired, reason: fired ? null : why.join('; '), inputs, threshold: tR, n: viaRate ? side.battery.hangs : (viaMode ? ctx.hangs.length : rateSide.hangs),
      calmSignal: viaMode && !viaRate ? 'power.efficiency_mode' : 'power.on_battery', hangValue: 1, effThreshold: 0.5, direction: 'higher',
      confounds: [{ id: 'workload-differs-by-source', text: 'the work done on battery may differ from the work done on AC', active: false }],
      extra: summaryExtra(j, viaRate ? 'rate' : viaMode ? 'power-mode' : null) };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disproveRatio');
    const check = `battery and AC hang rates per minute within ${tD.value}x of each other (each side with enough hangs and probes)`;
    const j = judge(ctx);
    if (!j.rate.evaluated) return { check, result: 'not-evaluable', values: [{ reason: j.rate.reason }] };
    return { check, result: j.rate.within ? 'disproved' : 'not-disproved', values: [{ batteryRatePerMin: j.side.battery.ratePerMin, acRatePerMin: j.side.ac.ratePerMin, ratio: j.rate.ratio }] };
  },
  describe(ctx, fired) {
    const f = fired[0];
    if (!f || !f.extra) return null;
    const e = f.extra;
    return e.via === 'rate' ? `${e.battery.hangs} hangs in ${e.battery.observedMin} min on battery (${e.battery.ratePerMin}/min) vs ${e.ac.hangs} in ${e.ac.observedMin} min on AC (${e.ac.ratePerMin}/min)`
      : e.via === 'power-mode' ? `${Math.round(e.mode.hangShare * 100)}% of hangs under an efficiency power mode vs ${Math.round(e.mode.calmShare * 100)}% of calm probes` : null;
  },
};

function summaryExtra(j, via = null) {
  const s = j.side;
  const pick = (x) => ({ hangs: x.hangs, probes: x.probes, observedMin: x.observedMin, ratePerMin: x.ratePerMin });
  return { via, battery: pick(s.battery), ac: pick(s.ac), ratio: j.rate.ratio, rateComparison: j.rate.evaluated ? 'evaluated' : `not evaluated: ${j.rate.reason}`,
    mode: { evaluated: j.mode.evaluated, hangShare: j.mode.hangShare, calmShare: j.mode.calmShare, ...(j.mode.reason ? { reason: j.mode.reason } : {}) } };
}
