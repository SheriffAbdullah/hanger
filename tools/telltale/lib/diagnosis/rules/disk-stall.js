'use strict';
// Disk stall: transfer latency above 25 ms with a queue of at least 1, sustained on at least 3 usable probes
// within +-10 s of the hang. One slow probe is never a stall.

module.exports = {
  id: 'disk-stall',
  class: 'disk',
  phrase: 'disk stall',
  valueLabel: 'disk latency',
  evaluate(ctx, h) {
    const th = ctx.threshold('diskSec', { def: 0.025, unit: 'ms', scale: 1000, id: 'disk.latency_ms' });
    const win = ctx.near(h, 10);
    const rows = win.map((q) => ({ q, lat: ctx.sig(q, 'disk.latency_ms'), qu: ctx.sig(q, 'disk.queue') }));
    // no value at the hang itself: the sustained test is not run on its neighbours alone (absence is not a negative)
    if (ctx.sig(h, 'disk.latency_ms') === null || !rows.some((x) => x.lat !== null)) return { fired: null, reason: ctx.missing('disk.latency_ms'), inputs: [], threshold: th, n: 0 };
    const s = ctx.sustained(rows, (x) => x.lat !== null && x.lat > th.value && x.qu !== null && x.qu >= 1);
    const inputs = s.hit.flatMap((x) => [ctx.input(x.q, 'disk.latency_ms'), ctx.input(x.q, 'disk.queue')]);
    const atHang = ctx.sig(h, 'disk.latency_ms');
    const hangValue = atHang !== null ? atHang : (s.hit.length ? Math.max(...s.hit.map((x) => x.lat)) : null);
    return { fired: s.sustained, reason: s.sustained ? null : `not sustained (${s.text}; latency > ${th.value} ms with queue >= 1)`, inputs, threshold: th, n: s.count,
      calmSignal: 'disk.latency_ms', hangValue, effThreshold: th.value, direction: 'higher' };
  },
  disprove(ctx, h) {
    const w = ctx.near(h, 10).map((q) => ({ q, lat: ctx.sig(q, 'disk.latency_ms'), qu: ctx.sig(q, 'disk.queue') })).filter((x) => x.lat !== null);
    const check = 'latency < 10 ms and queue < 1 on every probe within +-10 s of the hang';
    if (!w.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: w.every((x) => x.lat < 10 && (x.qu === null || x.qu < 1)) ? 'disproved' : 'not-disproved', values: w.map((x) => ({ ref: x.q.ref, latencyMs: x.lat, queue: x.qu })) };
  },
};
