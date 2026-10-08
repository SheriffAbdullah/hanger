'use strict';
// Load outside the declared scope: machine commit at or above the threshold (or CPU above 90%) while the in-scope groups
// held less than 30% of that resource at the same hang. Not evaluable in open scope (everything is in scope there).
// Reads the per-hang aggregate recorded by the scope resolver; no out-of-scope name exists anywhere in the data.

const SHARE_MAX = 0.30, CPU_PCT = 90;
const sum = (...xs) => xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
const share = (inn, ...rest) => { const t = sum(inn, ...rest); return t > 0 && Number.isFinite(inn) ? inn / t : null; };

module.exports = {
  id: 'outside-scope',
  class: 'outside-scope',
  phrase: 'load outside the declared scope',
  valueLabel: 'commit',
  priority: 10, // when machine pressure is held outside the scope, that is the more specific explanation
  evaluate(ctx, h) {
    const th = ctx.threshold('commit', { def: 85, unit: '%', id: 'mem.commit' });
    if (ctx.openScope) return { fired: null, reason: 'open scope', inputs: [], threshold: th, n: 0 };
    const ss = h.p.scopeShare;
    if (!ss || !ss.inScope || !ss.outOfScope) return { fired: null, reason: 'no per-hang scope share was recorded for this hang', inputs: [], threshold: th, n: 0 };
    const commit = ctx.sig(h, 'mem.committed_pct'), cpu = ctx.sig(h, 'cpu.pct_total');
    const memShare = share(ss.inScope.memMB, ss.outOfScope.memMB, ss.system && ss.system.memMB);
    const cpuShare = share(ss.inScope.cpuPctOfMachine, ss.outOfScope.cpuPctOfMachine, ss.system && ss.system.cpuPctOfMachine);
    const memCross = commit !== null && commit >= th.value, cpuCross = cpu !== null && cpu > CPU_PCT;
    const inputs = [];
    if (commit !== null) inputs.push(ctx.input(h, 'mem.committed_pct'));
    if (cpu !== null) inputs.push(ctx.input(h, 'cpu.pct_total'));
    const agg = { outOfScopeMB: ss.outOfScope.memMB, outOfScopeGroups: ss.outOfScope.groups, inScopeMB: ss.inScope.memMB, inScopeMemSharePct: memShare === null ? null : Math.round(memShare * 100), inScopeCpuSharePct: cpuShare === null ? null : Math.round(cpuShare * 100) };
    const memHit = memCross && memShare !== null && memShare < SHARE_MAX, cpuHit = cpuCross && cpuShare !== null && cpuShare < SHARE_MAX;
    const base = { inputs, threshold: th, n: 1, extra: agg };
    if (!memCross && !cpuCross) return { ...base, fired: false, reason: 'machine commit and CPU did not cross their thresholds at this hang', calmSignal: 'mem.committed_pct', hangValue: commit, effThreshold: th.value, direction: 'higher' };
    if (memHit || cpuHit) {
      const axisMem = memHit;
      return { ...base, fired: true, reason: null, extra: { ...agg, axis: axisMem ? 'memory' : 'cpu' },
        calmSignal: axisMem ? 'mem.committed_pct' : 'cpu.pct_total', hangValue: axisMem ? commit : cpu, effThreshold: axisMem ? th.value : CPU_PCT, direction: 'higher' };
    }
    const unknown = (memCross && memShare === null) || (cpuCross && cpuShare === null);
    return { ...base, fired: unknown ? null : false, reason: unknown ? 'the in-scope share could not be computed (no usable memory or CPU totals)' : `in-scope groups held ${agg.inScopeMemSharePct ?? '?'}% of memory and ${agg.inScopeCpuSharePct ?? '?'}% of CPU (rule needs < ${SHARE_MAX * 100}% on the axis that crossed)`,
      calmSignal: 'mem.committed_pct', hangValue: commit, effThreshold: th.value, direction: 'higher' };
  },
  disprove(ctx, h) {
    const check = 'machine commit < 70% and CPU < 60% on every probe within +-10 s of the hang';
    if (ctx.openScope) return { check, result: 'not-evaluable', values: [] };
    const w = ctx.near(h, 10).map((q) => ({ q, c: ctx.sig(q, 'mem.committed_pct'), u: ctx.sig(q, 'cpu.pct_total') })).filter((x) => x.c !== null);
    if (!w.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: w.every((x) => x.c < 70 && (x.u === null || x.u < 60)) ? 'disproved' : 'not-disproved', values: w.map((x) => ({ ref: x.q.ref, commitPct: x.c, cpuPct: x.u })) };
  },
  // the finding sentence names the aggregate (never a process): fired = effective results for this rule
  describe(ctx, fired) {
    const f = fired[0];
    if (!f || !f.extra) return null;
    const gb = Math.round(f.extra.outOfScopeMB / 102.4) / 10;
    return `the load at the freeze was held by processes outside the declared scope (${gb} GB, ${f.extra.outOfScopeGroups} groups not monitored; in-scope groups held ${f.extra.axis === 'cpu' ? f.extra.inScopeCpuSharePct : f.extra.inScopeMemSharePct}%)`;
  },
};
