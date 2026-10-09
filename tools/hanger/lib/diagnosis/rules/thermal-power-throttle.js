'use strict';
// Thermal or power throttling AT the hang, turbo-aware, on AC and on battery. Fires when total CPU is at least 50% and
// either delivered performance (% of base clock, can exceed 100) is below 60% of the run's own CALM-window median, or the
// platform reports an active performance limit, on at least 3 usable probes within +-10 s of the hang.
// The CPU-busy gate excludes idle down-clocking. No trace-wide minimum is ever an input. Temperature and the power source
// are supporting evidence only. Missing performance data is "not evaluated", never "no throttling".
const K = require('./_kit');

const ID = 'thermal-power-throttle';
const NAMES = ['cpu.pct_total', 'cpu.perf_pct', 'cpu.perf_limit_pct', 'cpu.throttle_flag', 'power.on_ac', 'power.efficiency_mode', 'thermal.cpu_c'];

function calmMedian(ctx) {
  return K.runLevel(ctx, `${ID}:calm`, () => {
    const v = ctx.calm.map((q) => ctx.sig(q, 'cpu.perf_pct')).filter(K.finite);
    return { median: v.length >= ctx.sustainedMin ? K.T.median(v) : null, n: v.length };
  });
}
const reasonsOf = (q) => (q.p.cpu && Array.isArray(q.p.cpu.throttleReasons) ? q.p.cpu.throttleReasons : []);

module.exports = {
  id: ID,
  class: 'thermal-power',
  phrase: 'thermal or power limiting',
  valueLabel: 'delivered CPU performance (% of base)',
  evaluate(ctx, h) {
    const tCpu = K.th(ctx, ID, 'cpuPct'), tP = K.th(ctx, ID, 'perfPctOfCalm'), tL = K.th(ctx, ID, 'limitPct'), tT = K.th(ctx, ID, 'thermalC');
    const rows = K.windowRows(ctx, h, NAMES);
    const anyPerf = rows.some((x) => x['cpu.perf_pct'] !== null), anyLim = rows.some((x) => x['cpu.perf_limit_pct'] !== null || x['cpu.throttle_flag'] !== null);
    if (!anyPerf && !anyLim) return K.nullResult(tP, `${ctx.missing('cpu.perf_pct')}; no performance-limit signal either, so throttling is neither shown nor ruled out`);
    if (!rows.some((x) => x['cpu.pct_total'] !== null)) return K.nullResult(tP, ctx.missing('cpu.pct_total'));
    const cm = calmMedian(ctx);
    const perfLow = (x) => x['cpu.perf_pct'] !== null && cm.median !== null && x['cpu.perf_pct'] < tP.value / 100 * cm.median;
    const limited = (x) => (x['cpu.perf_limit_pct'] !== null && x['cpu.perf_limit_pct'] >= tL.value) || x['cpu.throttle_flag'] === 1;
    if (!anyLim && cm.median === null) return K.nullResult(tP, `no calm baseline for processor performance (calm n=${cm.n}, minimum ${ctx.sustainedMin}) and no performance-limit signal`);
    const s = ctx.sustained(rows, (x) => x['cpu.pct_total'] !== null && x['cpu.pct_total'] >= tCpu.value && (perfLow(x) || limited(x)));
    const hitQ = s.hit.map((x) => x.q);
    const reasons = [...new Set(hitQ.flatMap(reasonsOf))];
    const temps = s.hit.map((x) => x['thermal.cpu_c']).filter(K.finite);
    const battery = s.hit.filter((x) => x['power.on_ac'] === 0).length, ac = s.hit.filter((x) => x['power.on_ac'] === 1).length;
    const powerSource = battery + ac === 0 ? 'unknown' : battery >= ac ? 'battery' : 'ac';
    const eff = s.hit.some((x) => x['power.efficiency_mode'] === 1);
    const thermal = reasons.some((r) => /thermal/i.test(r)) || (temps.length && Math.max(...temps) >= tT.value);
    const limitKind = thermal ? 'thermal' : (powerSource === 'battery' || eff) ? 'power' : 'unknown';
    const perfVals = s.hit.map((x) => x['cpu.perf_pct']).filter(K.finite);
    const fired = s.sustained;
    return { fired, reason: fired ? null : `not sustained (${s.text}; CPU >= ${tCpu.value}% with performance < ${tP.value}% of the calm median${cm.median === null ? ' (no calm baseline)' : ` ${cm.median}%`} or an active limit)`,
      inputs: K.inputsOf(ctx, hitQ, ['cpu.pct_total', 'cpu.perf_pct', 'cpu.perf_limit_pct', 'cpu.throttle_flag', 'power.on_ac', 'thermal.cpu_c']), threshold: tP, n: s.count,
      calmSignal: 'cpu.perf_pct', hangValue: perfVals.length ? K.T.mean(perfVals) : null, effThreshold: cm.median === null ? undefined : tP.value / 100 * cm.median, direction: 'lower',
      confounds: [{ id: 'power-mode-overlay', text: 'an efficiency power mode lowers delivered performance by design', active: eff }],
      extra: { calmMedianPerfPct: cm.median, calmN: cm.n, powerSource, limitKind, limitReasons: reasons, cpuTempC: temps.length ? Math.max(...temps) : null, efficiencyMode: eff } };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disprovePerfPctOfCalm');
    const check = `delivered performance >= ${tD.value}% of the calm median at 2/3 or more of the hangs`;
    const cm = calmMedian(ctx);
    if (cm.median === null) return { check, result: 'not-evaluable', values: [] };
    const hs = ctx.hangs.map((q) => {
      const v = K.windowRows(ctx, q, ['cpu.perf_pct']).map((x) => x['cpu.perf_pct']).filter(K.finite);
      return v.length ? { q, perf: Math.round(K.T.mean(v) * 10) / 10 } : null;
    }).filter(Boolean);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: K.twoThirds(hs, (x) => x.perf >= tD.value / 100 * cm.median) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, meanPerfPct: x.perf, calmMedianPerfPct: cm.median })) };
  },
  describe(ctx, fired) {
    const f = fired[0];
    if (!f || !f.extra) return null;
    const e = f.extra;
    return `${e.limitKind === 'unknown' ? 'limit cause not identified' : `${e.limitKind} limit`}, on ${e.powerSource === 'unknown' ? 'unknown power source' : e.powerSource}${e.calmMedianPerfPct !== null ? `, calm median performance ${e.calmMedianPerfPct}% of base` : ''}`;
  },
};
