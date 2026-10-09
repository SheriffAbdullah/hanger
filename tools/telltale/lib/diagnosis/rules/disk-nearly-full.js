'use strict';
// Disk nearly full (storage-coverage): a volume that matters (the system volume, a volume holding a pagefile, a drive the
// user declared for the workload) is low on free space AT the hang. It fires when free space is below the low limit on at
// least 3 usable probes within +-10 s of the hang, or below the higher warning limit on at least 3 probes while the same
// volume's free space is falling across the run. Limits are provisional and configurable (summary.thresholds.rules).
// No volume reading is "not evaluable", never a negative. Free space does not cause a freeze by itself in a few seconds:
// the rule says "coincides with", and the calm baseline and the disprover carry the weight.
const K = require('./_kit');
const storage = require('../../storage');

const ID = 'disk-nearly-full';
const SIG = 'disk.relevant_free_pct';
const mean = (a) => K.T.mean(a);
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

module.exports = {
  id: ID,
  class: 'disk',
  phrase: 'a nearly full disk',
  valueLabel: 'free space',
  evaluate(ctx, h) {
    const tLow = K.th(ctx, ID, 'lowFreePct'), tWarn = K.th(ctx, ID, 'warnFreePct'), tFall = K.th(ctx, ID, 'fallMB');
    if (ctx.sig(h, SIG) === null) return K.nullResult(tLow, `${ctx.missing(SIG)}; free space of the system, pagefile and workload volumes is needed`);
    const rows = K.windowRows(ctx, h, [SIG, 'disk.relevant_free_mb']);
    const relevant = ctx.env.relevantVolumes;
    const low = ctx.sustained(rows, (x) => x[SIG] !== null && x[SIG] < tLow.value);
    const warn = ctx.sustained(rows, (x) => x[SIG] !== null && x[SIG] < tWarn.value);
    // the volume that is lowest at the hang, and its free-megabyte series across the whole run (usable probes, in time order)
    const lv = storage.lowestVolume(h.p, relevant);
    const series = lv ? ctx.usable.map((q) => ctx.sig(q, `disk.volume_free_mb[${lv.volume}]`)).filter(K.finite) : [];
    const fall = lv ? K.T.rising(series.map((v) => -v), tFall.value) : null;       // free space falling = its negation rising
    const viaLow = low.sustained;
    const viaWarn = !viaLow && warn.sustained && !!fall && fall.ok;
    const fired = viaLow || viaWarn;
    let reason = null;
    const observed = rows.map((x) => x[SIG]).filter(K.finite);
    const obsTxt = observed.length ? `${r1(Math.min(...observed))}% to ${r1(Math.max(...observed))}% free` : 'no reading';
    if (!fired) {
      if (!warn.sustained) reason = `not low (${obsTxt}; needs free space below ${tLow.value}% on ${low.min} probes, or below ${tWarn.value}% while falling)`;
      else reason = `below the ${tWarn.value}% warning line (${obsTxt}) but free space is not falling by ${tFall.value} MB across the run (${fall && fall.first !== null ? `${Math.round(-fall.first)} MB to ${Math.round(-fall.last)} MB` : (fall ? fall.reason : 'no series')})`;
    }
    const hit = viaLow ? low.hit : warn.hit;
    const where = lv ? lv.volume : null;
    const sync = storage.syncClients(h.p, { minBps: K.th(ctx, 'disk-stall', 'syncClientBps').value });
    const cul = storage.culprit(h.p, { minBps: K.th(ctx, 'disk-stall', 'culpritMinBps').value, sharePct: K.th(ctx, 'disk-stall', 'culpritSharePct').value });
    const confounds = sync.length
      ? sync.map((s) => ({ id: 'sync-client-io', text: `${s.group}, a file-sync client in the declared scope, was reading or writing ${Math.round(s.bps / 1048576 * 10) / 10} MB/s near the hang`, active: true }))
      : [{ id: 'sync-client-io', text: 'a file-sync client in the declared scope was reading or writing near the hang', active: false }];
    return { fired, reason, inputs: K.inputsOf(ctx, hit.map((x) => x.q), [SIG, 'disk.relevant_free_mb']), threshold: tLow, n: (viaLow ? low : warn).count,
      calmSignal: SIG, hangValue: mean(hit.map((x) => x[SIG])), effThreshold: viaWarn ? tWarn.value : tLow.value, direction: 'lower', confounds,
      extra: {
        volume: where, freePct: lv ? lv.freePct : null, freeMB: lv ? lv.freeMB : null, lowFreePct: tLow.value, warnFreePct: tWarn.value,
        viaWarning: viaWarn, relevantVolumes: relevant || 'all volumes (none identified as system, pagefile or workload)',
        trend: fall ? { firstFreeMB: fall.first === null ? null : -fall.first, lastFreeMB: fall.last === null ? null : -fall.last, fellMB: fall.delta, fallMBNeeded: tFall.value, points: fall.n } : null,
        ioCulprit: cul.kind === 'named' ? { group: cul.group, bps: cul.bps, sharePct: cul.sharePct } : (cul.kind === 'outside-scope' ? { outsideScope: true, bps: cul.bps, groupCount: cul.groupCount } : null),
        thresholdsProvisional: true,
      } };
  },
  disprove(ctx) {
    const tD = K.th(ctx, ID, 'disproveFreePct');
    const check = `free space of the relevant volumes at or above ${tD.value}% at 2/3 or more of the hangs`;
    const hs = ctx.hangs.map((q) => ({ q, v: ctx.sig(q, SIG) })).filter((x) => x.v !== null);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: K.twoThirds(hs, (x) => x.v >= tD.value) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, freePct: x.v })) };
  },
  describe(ctx, fired) {
    const f = fired[0];
    if (!f || !f.extra || f.extra.volume === null) return null;
    const e = f.extra;
    return `the cause is a nearly full volume: ${e.volume} had ${e.freePct}% free${e.freeMB !== null ? ` (${Math.round(e.freeMB)} MB)` : ''}${e.viaWarning && e.trend ? ' and falling' : ''}`;
  },
};
