'use strict';
// Memory pressure AT the hang: committed memory at or above the commit threshold, or available memory below the
// minimum free, judged on the probe nearest the hang (never a run-wide peak or minimum), and the value at the hang
// must exceed the calm mean.

const DISPROVE_COMMIT = 70, DISPROVE_AVAIL_MB = 2048;

module.exports = {
  id: 'memory-pressure',
  class: 'memory',
  phrase: 'memory pressure',
  valueLabel: 'commit',
  evaluate(ctx, h) {
    const thC = ctx.threshold('commit', { def: 85, unit: '%', id: 'mem.commit' });
    const thF = ctx.threshold('minFreeGB', { def: 2, unit: 'GB', id: 'mem.min_free' });
    const commit = ctx.sig(h, 'mem.committed_pct'), avail = ctx.sig(h, 'mem.avail_mb');
    if (commit === null && avail === null) return { fired: null, reason: ctx.missing('mem.committed_pct'), inputs: [], threshold: thC, n: 0 };
    const byCommit = commit !== null && commit >= thC.value;
    const byFree = avail !== null && avail < thF.value * 1024;
    const inputs = [];
    if (commit !== null) inputs.push(ctx.input(h, 'mem.committed_pct'));
    if (avail !== null) inputs.push(ctx.input(h, 'mem.avail_mb'));
    // the signal that crossed is the one compared with calm; commit is preferred when both crossed
    const useFree = !byCommit && byFree;
    const calm = ctx.calmMean(useFree ? 'mem.avail_mb' : 'mem.committed_pct');
    const hangValue = useFree ? avail : commit;
    const crossed = byCommit || byFree;
    const exceeds = calm.n >= 3 && calm.mean !== null ? (useFree ? avail < calm.mean : commit > calm.mean) : true; // no usable baseline: crossing alone decides (flagged calm-insufficient)
    const base = { inputs, threshold: useFree ? { ...thF, value: thF.value, unit: 'GB' } : thC, n: 1, calmSignal: useFree ? 'mem.avail_mb' : 'mem.committed_pct', hangValue,
      effThreshold: useFree ? thF.value * 1024 : thC.value, direction: useFree ? 'lower' : 'higher' };
    if (!crossed) return { ...base, fired: false, reason: `at the hang commit ${commit === null ? 'unknown' : `${commit}%`} (threshold ${thC.value}%) and available ${avail === null ? 'unknown' : `${avail} MB`} (minimum ${thF.value * 1024} MB)` };
    if (!exceeds) return { ...base, fired: false, reason: `value at the hang does not exceed the calm mean (${calm.mean})` };
    return { ...base, fired: true, reason: null };
  },
  disprove(ctx, h) {
    const w = ctx.near(h, 10).map((q) => ({ q, c: ctx.sig(q, 'mem.committed_pct'), a: ctx.sig(q, 'mem.avail_mb') })).filter((x) => x.c !== null && x.a !== null);
    const check = `commit < ${DISPROVE_COMMIT}% and available > ${DISPROVE_AVAIL_MB / 1024} GB on every probe within +-10 s of the hang`;
    if (!w.length) return { check, result: 'not-evaluable', values: [] };
    const values = w.map((x) => ({ ref: x.q.ref, commitPct: x.c, availMB: x.a }));
    return { check, result: w.every((x) => x.c < DISPROVE_COMMIT && x.a > DISPROVE_AVAIL_MB) ? 'disproved' : 'not-disproved', values };
  },
};
