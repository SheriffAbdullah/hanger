'use strict';
// Disk stall: transfer latency above 25 ms with a queue of at least 1, sustained on at least 3 usable probes
// within +-10 s of the hang. One slow probe is never a stall.
// storage-coverage: the same test is also applied to each physical drive, so one slow drive that the machine total hides
// still fires. The result names the slowest qualifying drive by its label (disk number and volume letters, never a serial),
// says whether it hosts the pagefile and the declared workload (yes / no / unknown with the reason), and names a process
// group that drove the I/O only when it is in the declared scope or the fixed system set. An out-of-scope aggregate leading
// is reported as a rate and a group count only.
require('../cause-signals');
const storage = require('../../storage');
const rp = require('../rule-params');

const ID = 'disk-stall';
const mean = (a) => { const v = a.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const yesNo = (p, what) => (p.value === true ? `hosts the ${what}: yes` : p.value === false ? `hosts the ${what}: no` : `hosts the ${what}: unknown (${p.reason})`);

// drive instances (for example "1 D:") that have a series on any probe near the hang
function driveIds(win) {
  const ids = new Map();
  for (const q of win) for (const d of (q.p.disk && Array.isArray(q.p.disk.drives) ? q.p.disk.drives : [])) if (d && d.drive && !ids.has(d.drive)) ids.set(d.drive, { drive: d.drive, label: d.label || d.drive, diskNumber: d.diskNumber, letters: d.letters || [] });
  return [...ids.values()];
}

// the per-process I/O at the hang (or the nearest window probe that has any), reduced to a name only when in scope
function culpritAt(ctx, h, win) {
  const prm = { minBps: rp.param(ctx.report, ID, 'culpritMinBps').value, sharePct: rp.param(ctx.report, ID, 'culpritSharePct').value };
  const order = [h, ...win.filter((q) => q !== h).sort((a, b) => Math.abs(a.tSec - h.tSec) - Math.abs(b.tSec - h.tSec))];
  const q = order.find((x) => x.p.procs && Array.isArray(x.p.procs.groups)) || null;
  if (!q) return { culprit: storage.culprit(null, prm), q: null };
  return { culprit: storage.culprit(q.p, prm), q };
}

module.exports = {
  id: ID,
  class: 'disk',
  phrase: 'disk stall',
  valueLabel: 'disk latency',
  evaluate(ctx, h) {
    const th = ctx.threshold('diskSec', { def: 0.025, unit: 'ms', scale: 1000, id: 'disk.latency_ms' });
    const win = ctx.near(h, 10);
    const rows = win.map((q) => ({ q, lat: ctx.sig(q, 'disk.latency_ms'), qu: ctx.sig(q, 'disk.queue') }));
    const slow = (x) => x.lat !== null && x.lat > th.value && x.qu !== null && x.qu >= 1;
    // per drive: the same sustained test on that drive's own series
    const drives = driveIds(win).map((d) => {
      const dr = win.map((q) => ({ q, lat: ctx.sig(q, `disk.drive_latency_ms[${d.drive}]`), qu: ctx.sig(q, `disk.drive_queue[${d.drive}]`) }));
      const s = dr.some((x) => x.lat !== null) ? ctx.sustained(dr, slow) : null;
      return { ...d, rows: dr, s, meanLat: s && s.hit.length ? mean(s.hit.map((x) => x.lat)) : null };
    });
    const totalHasData = ctx.sig(h, 'disk.latency_ms') !== null && rows.some((x) => x.lat !== null);
    const driveHasData = drives.some((d) => d.s);
    // no value at the hang itself: the sustained test is not run on its neighbours alone (absence is not a negative)
    if (!totalHasData && !driveHasData) return { fired: null, reason: ctx.missing('disk.latency_ms'), inputs: [], threshold: th, n: 0, extra: { perDrive: { recorded: drives.length > 0, text: drives.length ? 'no drive had a latency reading' : 'per-drive data not recorded' } } };
    const sTotal = totalHasData ? ctx.sustained(rows, slow) : null;
    const qualifying = drives.filter((d) => d.s && d.s.sustained).sort((a, b) => b.meanLat - a.meanLat);
    const totalFires = !!(sTotal && sTotal.sustained);
    const fired = totalFires || qualifying.length > 0;
    const slowest = qualifying[0] || null;

    const inputs = [];
    if (totalFires) for (const x of sTotal.hit) inputs.push(ctx.input(x.q, 'disk.latency_ms'), ctx.input(x.q, 'disk.queue'));
    if (slowest) for (const x of slowest.s.hit) inputs.push(ctx.input(x.q, `disk.drive_latency_ms[${slowest.drive}]`), ctx.input(x.q, `disk.drive_queue[${slowest.drive}]`));

    // who drove the I/O, and the placement of the slow drive
    const cu = fired ? culpritAt(ctx, h, win) : { culprit: null, q: null };
    if (cu.culprit && cu.culprit.kind === 'named') inputs.push(ctx.input(cu.q, `proc.group_io_bps[${cu.culprit.group}]`));
    if (cu.culprit && cu.culprit.kind === 'outside-scope') inputs.push(ctx.input(cu.q, 'proc.outside_io_bps'));
    let slowDrive = null;
    if (slowest) {
      const dd = storage.describeDrive(ctx.report, { drive: slowest.drive, label: slowest.label, diskNumber: slowest.diskNumber, letters: slowest.letters });
      slowDrive = { drive: slowest.drive, label: slowest.label, class: dd.class, classReason: dd.classReason, meanLatencyMs: r1(slowest.meanLat), n: slowest.s.count,
        hostsPagefile: { ...dd.pagefile, text: yesNo(dd.pagefile, 'pagefile') }, hostsWorkload: { ...dd.workload, text: yesNo(dd.workload, 'workload') } };
    }
    const sync = fired ? storage.syncClients(h.p, { minBps: rp.param(ctx.report, ID, 'syncClientBps').value }) : [];
    const confounds = sync.length
      ? sync.map((s) => ({ id: 'sync-client-io', text: `${s.group}, a file-sync client in the declared scope, was reading or writing ${Math.round(s.bps / 1048576 * 10) / 10} MB/s near the hang`, active: true }))
      : [{ id: 'sync-client-io', text: 'a file-sync client in the declared scope was reading or writing near the hang', active: false }];

    let reason = null;
    if (!fired) {
      const parts = [];
      if (sTotal) parts.push(`machine total not sustained (${sTotal.text}; latency > ${th.value} ms with queue >= 1)`);
      const seen = drives.filter((d) => d.s);
      if (seen.length) parts.push(`no single drive sustained it either (${seen.map((d) => `${d.label} ${d.s.count} of ${d.s.of} probes`).join('; ')})`);
      reason = parts.length ? (sTotal && !seen.length ? `not sustained (${sTotal.text}; latency > ${th.value} ms with queue >= 1)` : parts.join('; ')) : 'not sustained';
    }
    const driveOnly = !totalFires && !!slowest;
    const hitRows = driveOnly ? slowest.s.hit : (sTotal ? sTotal.hit : []);
    const atHang = ctx.sig(h, 'disk.latency_ms');
    const hangValue = driveOnly ? slowest.meanLat : (atHang !== null ? atHang : (hitRows.length ? Math.max(...hitRows.map((x) => x.lat)) : null));
    return { fired, reason, inputs, threshold: th, n: totalFires ? sTotal.count : (slowest ? slowest.s.count : (sTotal ? sTotal.count : 0)),
      calmSignal: driveOnly ? `disk.drive_latency_ms[${slowest.drive}]` : 'disk.latency_ms', hangValue, effThreshold: th.value, direction: 'higher', confounds,
      extra: {
        perDrive: drives.length
          ? { recorded: true, machineTotalQualified: totalFires, drives: drives.map((d) => ({ drive: d.drive, label: d.label, qualified: !!(d.s && d.s.sustained), meanLatencyMs: r1(d.meanLat), probes: d.s ? d.s.count : null, of: d.s ? d.s.of : null })) }
          : { recorded: false, text: 'per-drive data not recorded' },
        slowDrive,
        ...(fired && !slowDrive && drives.length ? { slowDriveNote: 'the machine total qualified; no single drive met the condition on its own' } : {}),
        culprit: cu.culprit ? (cu.culprit.kind === 'named' ? { kind: 'named', group: cu.culprit.group, bps: cu.culprit.bps, sharePct: cu.culprit.sharePct, text: cu.culprit.text }
          : cu.culprit.kind === 'outside-scope' ? { kind: 'outside-scope', bps: cu.culprit.bps, groupCount: cu.culprit.groupCount, sharePct: cu.culprit.sharePct, text: cu.culprit.text }
            : { kind: cu.culprit.kind, text: cu.culprit.text }) : null,
      } };
  },
  disprove(ctx, h) {
    const win = ctx.near(h, 10);
    const check = 'latency < 10 ms and queue < 1 on every probe within +-10 s of the hang, for the machine total and for every drive with a reading';
    const w = win.map((q) => ({ q, lat: ctx.sig(q, 'disk.latency_ms'), qu: ctx.sig(q, 'disk.queue') })).filter((x) => x.lat !== null);
    const dw = [];
    for (const d of driveIds(win)) for (const q of win) {
      const lat = ctx.sig(q, `disk.drive_latency_ms[${d.drive}]`);
      if (lat !== null) dw.push({ q, lat, qu: ctx.sig(q, `disk.drive_queue[${d.drive}]`), label: d.label });
    }
    if (!w.length && !dw.length) return { check, result: 'not-evaluable', values: [] };
    const calmEnough = (x) => x.lat < 10 && (x.qu === null || x.qu < 1);
    return { check, result: w.every(calmEnough) && dw.every(calmEnough) ? 'disproved' : 'not-disproved',
      values: [...w.map((x) => ({ ref: x.q.ref, latencyMs: x.lat, queue: x.qu })), ...dw.map((x) => ({ ref: x.q.ref, drive: x.label, latencyMs: x.lat, queue: x.qu }))] };
  },
  describe(ctx, fired) {
    const f = fired[0];
    if (!f || !f.extra) return null;
    const bits = [];
    const d = f.extra.slowDrive;
    if (d) bits.push(`slowest drive ${d.label}${d.class ? ` (${d.class})` : ''}, ${d.hostsPagefile.text}, ${d.hostsWorkload.text}`);
    if (f.extra.culprit && f.extra.culprit.text && (f.extra.culprit.kind === 'named' || f.extra.culprit.kind === 'outside-scope')) bits.push(f.extra.culprit.text);
    return bits.length ? bits.join('; ') : null;
  },
};
