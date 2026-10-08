'use strict';
// CPU saturation at the hang: total CPU above 90% and the processor queue per logical processor above 2.
// Names the in-scope process groups with the highest CPU share at that hang.

const CPU_PCT = 90, QUEUE_PER_LP = 2;

module.exports = {
  id: 'cpu-saturation',
  class: 'cpu',
  phrase: 'CPU saturation',
  valueLabel: 'CPU',
  evaluate(ctx, h) {
    const thCpu = ctx.constant('cpu.pct_total', CPU_PCT, '%');
    const thQ = ctx.constant('cpu.queue_per_lp', QUEUE_PER_LP, 'per logical processor');
    const cpu = ctx.sig(h, 'cpu.pct_total');
    if (ctx.logicalCpus === null || ctx.logicalCpus === undefined) return { fired: null, reason: 'logical processor count not recorded; queue cannot be normalized', inputs: [], threshold: thCpu, n: 0 };
    const q = ctx.sig(h, 'cpu.queue_per_lp');
    if (cpu === null || q === null) return { fired: null, reason: ctx.missing(cpu === null ? 'cpu.pct_total' : 'cpu.queue_per_lp'), inputs: [], threshold: thCpu, n: 0 };
    const inputs = [ctx.input(h, 'cpu.pct_total'), ctx.input(h, 'cpu.queue_per_lp')];
    const groups = h.p.procs && Array.isArray(h.p.procs.groups) ? h.p.procs.groups.filter((g) => g && Number.isFinite(g.cpuPctMachine)).sort((a, b) => b.cpuPctMachine - a.cpuPctMachine).slice(0, 3).map((g) => ({ group: g.group, cpuPctMachine: g.cpuPctMachine })) : [];
    const fired = cpu > CPU_PCT && q > QUEUE_PER_LP;
    return { fired, reason: fired ? null : `CPU ${cpu}% (needs > ${CPU_PCT}%) with queue ${q} per logical processor (needs > ${QUEUE_PER_LP})`, inputs, threshold: thCpu, n: 1,
      calmSignal: 'cpu.pct_total', hangValue: cpu, effThreshold: CPU_PCT, direction: 'higher', extra: { queuePerLogicalProcessor: q, queueThreshold: thQ, topInScopeGroups: groups } };
  },
  disprove(ctx, h) {
    const w = ctx.near(h, 10).map((q) => ({ q, c: ctx.sig(q, 'cpu.pct_total'), n: ctx.sig(q, 'cpu.queue_per_lp') })).filter((x) => x.c !== null && x.n !== null);
    const check = 'CPU < 60% and queue < 1 per logical processor on every probe within +-10 s of the hang';
    if (!w.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: w.every((x) => x.c < 60 && x.n < 1) ? 'disproved' : 'not-disproved', values: w.map((x) => ({ ref: x.q.ref, cpuPct: x.c, queuePerLp: x.n })) };
  },
  describe(ctx, fired) {
    const names = new Set();
    for (const r of fired) for (const g of (r.extra && r.extra.topInScopeGroups) || []) names.add(g.group);
    return names.size ? `top in-scope CPU groups at those hangs: ${[...names].slice(0, 3).join(', ')}` : null;
  },
};
