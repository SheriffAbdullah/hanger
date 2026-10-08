'use strict';
// One process group dominates memory or keeps growing. Over IN-SCOPE groups and the fixed system set only (the
// anonymous out-of-scope aggregate carries no name and is never listed here; that load belongs to the outside-scope cause):
//   dominance: one group holds >= 40% of used memory on >= 3 usable probes within +-10 s of the hang
//   growth   : the group's memory grows monotonically across >= 3 usable snapshots up to the hang, by >= 10% in total
const K = require('./_kit');
const { namedGroups } = require('../cause-signals');

const ID = 'single-process-dominance';
const MAX_LISTED_SNAPSHOTS = 6;
const mem = (g) => `proc.group_mem_mb[${g}]`;
const share = (g) => `proc.group_share_pct[${g}]`;

// monotonic growth of one group over the usable probes up to and including the hang probe
function growthOf(ctx, h, g, tG, tol) {
  const snaps = ctx.usable.filter((q) => Number.isFinite(q.tSec) && Number.isFinite(h.tSec) && q.tSec <= h.tSec && ctx.sig(q, mem(g)) !== null);
  const values = snaps.map((q) => ctx.sig(q, mem(g)));
  const m = K.T.monotonic(values, { totalPct: tG.value, tolerancePct: tol.value });
  return { snaps, values, m };
}

module.exports = {
  id: ID,
  class: 'memory',
  phrase: 'one process group dominating memory',
  valueLabel: 'largest group share of used memory',
  evaluate(ctx, h) {
    const tS = K.th(ctx, ID, 'sharePct'), tG = K.th(ctx, ID, 'growthPct'), tol = K.th(ctx, ID, 'growthTolerancePct');
    if (!h.p.procs || !Array.isArray(h.p.procs.groups)) return K.nullResult(tS, ctx.missing('proc.group_mem_mb'));
    const win = ctx.near(h, K.WINDOW_S);
    const names = [...new Set(win.flatMap((q) => namedGroups(q.p)))];
    if (!names.length) return { fired: false, reason: 'no in-scope or system-set process group was recorded around this hang', inputs: [], threshold: tS, n: 0 };
    const hasUsed = !!ctx.env.totalMB;
    // dominance candidates
    let dom = null;
    if (hasUsed) {
      for (const g of names) {
        const rows = K.windowRows(ctx, h, [share(g), mem(g)]);
        const s = ctx.sustained(rows, (x) => x[share(g)] !== null && x[share(g)] >= tS.value);
        const avg = K.T.mean(s.hit.map((x) => x[share(g)]));
        if (s.sustained && (!dom || avg > dom.avg)) dom = { g, s, avg };
      }
    }
    // growth candidates (the group must be present at the hang)
    let grow = null;
    for (const g of names) {
      if (ctx.sig(h, mem(g)) === null) continue;
      const r = growthOf(ctx, h, g, tG, tol);
      if (r.m.ok && (!grow || r.m.growthPct > grow.r.m.growthPct)) grow = { g, r };
    }
    const flagged = (g) => ctx.near(h, K.WINDOW_S).some((q) => { const x = q.p.procs && Array.isArray(q.p.procs.groups) ? q.p.procs.groups.find((y) => y && y.group === g) : null; return x && x.includesObserver; });
    const confoundsFor = (g) => [{ id: 'includes-observer', text: "the group name is shared with the tool's own processes (a few MB); private bytes are preferred when recorded", active: false, group: g }]
      .filter((c) => flagged(c.group)).map(({ id, text, active }) => ({ id, text, active }));
    if (dom) {
      const m0 = K.windowRows(ctx, h, [mem(dom.g)]).map((x) => x[mem(dom.g)]).filter(K.finite);
      return { fired: true, reason: null, inputs: K.inputsOf(ctx, dom.s.hit.map((x) => x.q), [share(dom.g), mem(dom.g)]), threshold: tS, n: dom.s.count,
        calmSignal: share(dom.g), hangValue: dom.avg, effThreshold: tS.value, direction: 'higher', confounds: confoundsFor(dom.g),
        extra: { group: dom.g, kind: 'dominance', sharePct: Math.round(dom.avg * 10) / 10, groupMemoryMB: m0.length ? Math.round(Math.max(...m0)) : null } };
    }
    if (grow) {
      const listed = K.evenly(grow.r.snaps, MAX_LISTED_SNAPSHOTS);
      return { fired: true, reason: null, inputs: K.inputsOf(ctx, listed, [mem(grow.g)]), threshold: tG, n: grow.r.m.n,
        calmSignal: mem(grow.g), hangValue: ctx.sig(h, mem(grow.g)), effThreshold: grow.r.values[0] * (1 + tG.value / 100), direction: 'higher', confounds: confoundsFor(grow.g),
        extra: { group: grow.g, kind: 'growth', growthPct: grow.r.m.growthPct, snapshots: listed.map((q) => ({ ref: q.ref, at: q.p.at, tSec: q.tSec, valueMB: ctx.sig(q, mem(grow.g)) })), snapshotsTotal: grow.r.m.n } };
    }
    return { fired: false, reason: hasUsed ? `no group holds >= ${tS.value}% of used memory on >= 3 probes, and no group grows monotonically by >= ${tG.value}% across >= 3 snapshots` : `installed RAM not recorded, so shares cannot be computed; no group grows monotonically by >= ${tG.value}% across >= 3 snapshots`,
      inputs: [], threshold: tS, n: 0 };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disproveSharePct'), tG = K.th(ctx, ID, 'growthPct'), tol = K.th(ctx, ID, 'growthTolerancePct');
    const check = `no group holds >= ${tD.value}% of used memory and no group grows by >= ${tG.value}% at any hang`;
    const hs = ctx.hangs.map((q) => {
      const win = ctx.near(q, K.WINDOW_S);
      const names = [...new Set(win.flatMap((x) => namedGroups(x.p)))];
      if (!names.length || !ctx.env.totalMB) return null;
      let max = null, grew = false;
      for (const g of names) {
        for (const x of win) { const v = ctx.sig(x, share(g)); if (v !== null && (max === null || v > max)) max = v; }
        if (ctx.sig(q, mem(g)) !== null && growthOf(ctx, q, g, tG, tol).m.ok) grew = true;
      }
      return max === null ? null : { q, maxSharePct: max, grew };
    }).filter(Boolean);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: hs.every((x) => x.maxSharePct < tD.value && !x.grew) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, maxSharePct: x.maxSharePct, growth: x.grew })) };
  },
  describe(ctx, fired) {
    const f = fired[0];
    if (!f || !f.extra) return null;
    return f.extra.kind === 'growth' ? `group ${f.extra.group} grew ${f.extra.growthPct}% across ${f.extra.snapshotsTotal} snapshots` : `group ${f.extra.group} held ${f.extra.sharePct}% of used memory`;
  },
};
