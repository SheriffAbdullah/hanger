'use strict';
// Commit-limit pressure AT the hang: committed memory at or above 90% of the commit limit, paging-file usage rising, and
// available memory below 5% of installed RAM, together on at least 3 usable probes within +-10 s of the hang.
// High commit alone never fires it (commit can be high with plenty of free RAM and a flat page file).
const K = require('./_kit');

const ID = 'commit-limit-pressure';
const mean = (a) => K.T.mean(a);

module.exports = {
  id: ID,
  class: 'memory',
  phrase: 'commit limit pressure',
  valueLabel: 'commit of limit',
  evaluate(ctx, h) {
    const tC = K.th(ctx, ID, 'commitPct'), tA = K.th(ctx, ID, 'availPctRam'), tR = K.th(ctx, ID, 'pagefileRisePp');
    const ram = ctx.env.totalMB;
    if (!ram) return K.nullResult(tC, 'installed RAM not recorded (machine.totalGB); available memory cannot be compared with 5% of RAM');
    if (ctx.sig(h, 'mem.commit_of_limit_pct') === null) return K.nullResult(tC, ctx.missing('mem.commit_of_limit_pct'));
    if (ctx.sig(h, 'mem.avail_mb') === null) return K.nullResult(tC, ctx.missing('mem.avail_mb'));
    const rows = K.windowRows(ctx, h, ['mem.commit_of_limit_pct', 'mem.avail_mb', 'mem.pagefile_pct']);
    if (rows.filter((x) => x['mem.pagefile_pct'] !== null).length < 3) return K.nullResult(tC, ctx.missing('mem.pagefile_pct') + '; a rising page file needs at least 3 readings');
    const availMax = tA.value / 100 * ram;
    const s = ctx.sustained(rows, (x) => x['mem.commit_of_limit_pct'] !== null && x['mem.commit_of_limit_pct'] >= tC.value && x['mem.avail_mb'] !== null && x['mem.avail_mb'] < availMax);
    const pf = s.hit.map((x) => x['mem.pagefile_pct']).filter(K.finite);
    const rise = s.sustained ? K.T.rising(pf, tR.value) : null;
    const fired = s.sustained && !!rise && rise.ok;
    let reason = null;
    if (!s.sustained) reason = `not sustained (${s.text}; commit >= ${tC.value}% of the limit and available < ${Math.round(availMax)} MB, ${tA.value}% of RAM)`;
    else if (!rise.ok) reason = `page file usage not rising (${rise.first === null ? '?' : rise.first}% to ${rise.last === null ? '?' : rise.last}%; needs +${tR.value} percentage points)`;
    const limB = ctx.sig(h, 'mem.commit_of_limit_pct') !== null && h.p.mem ? h.p.mem.commitLimitBytes : null;
    const capped = K.finite(limB) && limB <= ram * 1048576 * 1.1;
    const confounds = [
      { id: 'pagefile-capped-by-policy', text: 'the commit limit is close to installed RAM, so the page file is capped or absent by policy', active: !!capped },
      ...(K.observerRecorded(ctx.report) ? [{ id: 'observer-commit', text: "the observer's own processes add to commit charge", active: false }] : []),
    ];
    return { fired, reason, inputs: K.inputsOf(ctx, s.hit.map((x) => x.q), ['mem.commit_of_limit_pct', 'mem.pagefile_pct', 'mem.avail_mb']), threshold: tC, n: s.count,
      calmSignal: 'mem.commit_of_limit_pct', hangValue: mean(s.hit.map((x) => x['mem.commit_of_limit_pct'])), effThreshold: tC.value, direction: 'higher', confounds,
      extra: { pagefile: rise ? { firstPct: rise.first, lastPct: rise.last, deltaPp: rise.delta, risePpNeeded: tR.value } : null, availableLimitMB: Math.round(availMax), installedRamMB: Math.round(ram) } };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disproveCommitPct');
    const check = `commit < ${tD.value}% of the limit at 2/3 or more of the hangs`;
    const hs = ctx.hangs.map((q) => ({ q, c: ctx.sig(q, 'mem.commit_of_limit_pct') })).filter((x) => x.c !== null);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: K.twoThirds(hs, (x) => x.c < tD.value) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, commitPct: x.c })) };
  },
  describe(ctx, fired) {
    const f = fired[0];
    return f && f.extra && f.extra.pagefile ? `page file usage rose ${f.extra.pagefile.firstPct}% to ${f.extra.pagefile.lastPct}% while available memory was under ${f.extra.availableLimitMB} MB` : null;
  },
};
