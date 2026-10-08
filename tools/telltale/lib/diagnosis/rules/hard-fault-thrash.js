'use strict';
// Hard-fault thrash (real swap): pages WRITTEN out per second elevated, paging-file usage rising and the modified page list
// growing, together on at least 3 usable probes within +-10 s of the hang. Pages INPUT alone (image loads, mapped-file reads,
// the observer's own process starts) never fires it.
const K = require('./_kit');

const ID = 'hard-fault-thrash';

module.exports = {
  id: ID,
  class: 'memory',
  phrase: 'hard-fault thrash (swap)',
  valueLabel: 'pages written out',
  evaluate(ctx, h) {
    const tP = K.th(ctx, ID, 'pagesOutPerS'), tR = K.th(ctx, ID, 'pagefileRisePp'), tM = K.th(ctx, ID, 'modifiedGrowthPct');
    if (ctx.sig(h, 'mem.pages_out_per_s') === null) return K.nullResult(tP, ctx.missing('mem.pages_out_per_s'));
    const rows = K.windowRows(ctx, h, ['mem.pages_out_per_s', 'mem.pages_in_per_s', 'mem.pagefile_pct', 'mem.modified_mb']);
    const s = ctx.sustained(rows, (x) => x['mem.pages_out_per_s'] !== null && x['mem.pages_out_per_s'] >= tP.value);
    const inHigh = rows.some((x) => x['mem.pages_in_per_s'] !== null && x['mem.pages_in_per_s'] >= tP.value);
    const confounds = [];
    if (inHigh) confounds.push({ id: 'image-or-mapped-file-reads', text: 'pages read in per second are dominated by image loads and mapped-file reads, which are not swap', active: false });
    if (K.observerRecorded(ctx.report)) confounds.push({ id: 'observer-process-launches', text: "the observer's own process launches generate page-ins and page-outs", active: true });
    const base = { threshold: tP, calmSignal: 'mem.pages_out_per_s', effThreshold: tP.value, direction: 'higher', confounds };
    if (!s.sustained) {
      return { ...base, fired: false, reason: `not sustained (${s.text}; pages written out >= ${tP.value}/s)${inHigh ? '; pages read in are high but reads alone are never swap' : ''}`, inputs: K.inputsOf(ctx, s.hit.map((x) => x.q), ['mem.pages_out_per_s']), n: s.count };
    }
    const pf = s.hit.map((x) => x['mem.pagefile_pct']).filter(K.finite), md = s.hit.map((x) => x['mem.modified_mb']).filter(K.finite);
    if (pf.length < 3) return { ...base, fired: null, reason: ctx.missing('mem.pagefile_pct') + '; page file growth cannot be judged', inputs: [], n: 0 };
    if (md.length < 3) return { ...base, fired: null, reason: ctx.missing('mem.modified_mb') + '; modified list growth cannot be judged', inputs: [], n: 0 };
    const rise = K.T.rising(pf, tR.value), grow = K.T.growing(md, tM.value);
    const fired = rise.ok && grow.ok;
    const why = [];
    if (!rise.ok) why.push(`page file usage not rising (${rise.first}% to ${rise.last}%, needs +${tR.value} percentage points)`);
    if (!grow.ok) why.push(`modified list not growing (${grow.first} to ${grow.last} MB, needs +${tM.value}%)`);
    return { ...base, fired, reason: fired ? null : why.join('; '), inputs: K.inputsOf(ctx, s.hit.map((x) => x.q), ['mem.pages_out_per_s', 'mem.pagefile_pct', 'mem.modified_mb']), n: s.count,
      hangValue: K.T.mean(s.hit.map((x) => x['mem.pages_out_per_s'])),
      extra: { pagefile: { firstPct: rise.first, lastPct: rise.last }, modified: { firstMB: grow.first, lastMB: grow.last, growthPct: grow.growthPct } } };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disprovePagesOutPerS');
    const check = `pages written out < ${tD.value}/s on every probe within +-10 s of every hang`;
    const hs = ctx.hangs.map((q) => {
      const v = K.windowRows(ctx, q, ['mem.pages_out_per_s']).map((x) => x['mem.pages_out_per_s']).filter(K.finite);
      return { q, max: v.length ? Math.max(...v) : null };
    }).filter((x) => x.max !== null);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: hs.every((x) => x.max < tD.value) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, maxPagesOutPerS: x.max })) };
  },
};
