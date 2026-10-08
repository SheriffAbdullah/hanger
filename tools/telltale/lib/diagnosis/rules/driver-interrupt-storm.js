'use strict';
// Driver interrupt storm: deferred-procedure-call time plus interrupt time at least 10% of CPU on at least 3 usable
// probes within +-10 s of the hang. Both series were already collected and were never read by inference (R02-P2-9).
const K = require('./_kit');

const ID = 'driver-interrupt-storm';
const SIG = 'cpu.dpc_intr_pct';

module.exports = {
  id: ID,
  class: 'cpu',
  phrase: 'a driver interrupt storm',
  valueLabel: 'DPC + interrupt time',
  evaluate(ctx, h) {
    const tS = K.th(ctx, ID, 'sumPct');
    if (ctx.sig(h, SIG) === null) return K.nullResult(tS, ctx.missing(SIG));
    const rows = K.windowRows(ctx, h, [SIG]);
    const s = ctx.sustained(rows, (x) => x[SIG] !== null && x[SIG] >= tS.value);
    return { fired: s.sustained, reason: s.sustained ? null : `not sustained (${s.text}; DPC + interrupt >= ${tS.value}% of CPU)`,
      inputs: K.inputsOf(ctx, s.hit.map((x) => x.q), [SIG]), threshold: tS, n: s.count,
      calmSignal: SIG, hangValue: K.T.mean(s.hit.map((x) => x[SIG])), effThreshold: tS.value, direction: 'higher',
      confounds: [{ id: 'legitimate-io-load', text: 'very high network or disk throughput legitimately raises interrupt time', active: false }] };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disproveSumPct');
    const check = `DPC + interrupt time < ${tD.value}% on every probe within +-10 s of every hang`;
    const hs = ctx.hangs.map((q) => {
      const v = K.windowRows(ctx, q, [SIG]).map((x) => x[SIG]).filter(K.finite);
      return v.length ? { q, max: Math.max(...v) } : null;
    }).filter(Boolean);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: hs.every((x) => x.max < tD.value) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, maxDpcPlusInterruptPct: x.max })) };
  },
};
