'use strict';
// Security-software contention: CPU of security products, normalized to a share of the whole machine, at least 2.5x its
// calm mean and at least 8% of machine capacity at the hang, while the memory-pressure rule did not fire.
// A raw per-core-scaled value is never compared with a threshold: the signal registry divides it by logical processors.

const RATIO = 2.5, FLOOR_PCT = 8;

module.exports = {
  id: 'security-contention',
  class: 'security-software',
  phrase: 'security-software contention',
  valueLabel: 'security-software CPU',
  after: ['memory-pressure'],
  evaluate(ctx, h, prior) {
    const set = ctx.report && ctx.report.settings && ctx.report.settings.thresholds && ctx.report.settings.thresholds.defender;
    // an explicit --defender / config value (now a share of the whole machine) replaces the default floor
    const floor = set && set.source && set.source !== 'default' && Number.isFinite(ctx.TH.defender) ? ctx.TH.defender : FLOOR_PCT;
    const th = { ...ctx.constant('security.cpu_pct_machine', floor, '% of machine'), origin: floor === FLOOR_PCT ? 'default' : set.source };
    const confounds = [{ id: 'probe-start-scanning', text: 'probe process starts may trigger scanning', active: true }];
    const v = ctx.sig(h, 'security.cpu_pct_machine');
    if (v === null) return { fired: null, reason: ctx.missing('security.cpu_pct_machine'), inputs: [], threshold: th, n: 0, confounds };
    const inputs = [ctx.input(h, 'security.cpu_pct_machine')];
    const calm = ctx.calmMean('security.cpu_pct_machine');
    const base = { inputs, threshold: th, n: 1, calmSignal: 'security.cpu_pct_machine', hangValue: v, direction: 'higher', confounds, extra: { ratio: RATIO } };
    if (prior && prior['memory-pressure'] && prior['memory-pressure'].fired === true) return { ...base, effThreshold: floor, fired: false, reason: 'memory-pressure rule fired at this hang; not attributed to security software' };
    if (calm.n < 3 || calm.mean === null) return { ...base, effThreshold: floor, fired: null, reason: `no calm baseline for security-software CPU (calm n=${calm.n}; need 3)` };
    const eff = Math.max(floor, RATIO * calm.mean);
    const fired = v >= RATIO * calm.mean && v >= floor;
    return { ...base, effThreshold: eff, fired, reason: fired ? null : `${v}% of machine at the hang vs ${calm.mean}% calm (needs >= ${RATIO}x calm and >= ${floor}%)` };
  },
  disprove(ctx, h) {
    const w = ctx.near(h, 10).map((q) => ({ q, v: ctx.sig(q, 'security.cpu_pct_machine') })).filter((x) => x.v !== null);
    const check = 'security-software CPU < 3% of machine on every probe within +-10 s of the hang';
    if (!w.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: w.every((x) => x.v < 3) ? 'disproved' : 'not-disproved', values: w.map((x) => ({ ref: x.q.ref, cpuPctMachine: x.v })) };
  },
};
