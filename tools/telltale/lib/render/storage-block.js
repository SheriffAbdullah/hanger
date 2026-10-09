'use strict';
// Storage panel and email line (storage-coverage). Built ONLY from the report JSON through lib/storage.js, so a stored
// report renders identically. Every value that is not recorded reads "not available (<reason>)", never blank. A process
// is named only when the stored diagnosis named it (in scope or the fixed system set); the out-of-scope aggregate is a
// rate and a group count.
const storage = require('../storage');
const { plain } = require('../sampler/record');
const { na, n2 } = require('./format');

const MB = 1048576;
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const val = (x, unit, reason) => (x === null || x === undefined ? na(reason) : `${n2(x)}${unit}`);
const mbps = (rd, wr) => (num(rd) === null && num(wr) === null ? null : Math.round(((rd || 0) + (wr || 0)) / 1e5) / 10);
const NOF = 'no freeze observed';
let noFreezes = false; // set per render: with no freeze probe the freeze side reads "no freeze observed", not a missing value
const pairText = (a, b, unit, reason) => `${a === null && noFreezes ? NOF : val(a, unit, reason)} vs ${val(b, unit, reason)}`;
const placeText = (p) => (p.value === true ? 'yes' : p.value === false ? 'no' : `unknown (${p.reason})`);

// disk-stall results that fired and were not disproved, from the stored diagnosis
function stallResults(r) {
  const out = [];
  for (const h of (r.diagnosis && Array.isArray(r.diagnosis.hangs)) ? r.diagnosis.hangs : []) {
    for (const x of h.rules || []) if (x.id === 'disk-stall' && x.fired === true && !(x.disprover && x.disprover.result === 'disproved')) out.push({ ref: h.ref, res: x });
  }
  return out;
}
function culpritLines(r) {
  const lines = [];
  const seen = new Set();
  const all = stallResults(r);
  for (const { res } of all) {
    const c = res.extra && res.extra.culprit;
    if (!c || !c.text || seen.has(c.text)) continue;
    seen.add(c.text);
    if (c.kind === 'named' || c.kind === 'outside-scope') lines.push(c.text.charAt(0).toUpperCase() + c.text.slice(1) + '.');
  }
  if (all.length && !lines.length) {
    const kinds = new Set(all.map((x) => (x.res.extra && x.res.extra.culprit ? x.res.extra.culprit.kind : null)));
    if (kinds.has('not-recorded') || kinds.has(null)) lines.push(`Which process drove the disk I/O: ${na('per-process disk I/O not recorded')}.`);
    else lines.push('No single process group held at least half of the observed disk I/O.');
  }
  return lines;
}

function storageBlocks(raw) {
  const r = plain(raw);
  const p = storage.panel(r);
  noFreezes = p.hangProbes === 0;
  const blocks = [{ t: 'sub', text: 'Storage' }];
  if (!p.drives.length) {
    blocks.push({ t: 'p', text: `Per-drive disk data: ${na(p.drivesReason)}. The machine-total disk charts are unchanged.` });
  } else {
    blocks.push({ t: 'table', cls: 'storage', head: ['Drive', 'Class', 'Latency, ms (freezes vs calm)', 'Queue (freezes vs calm)', 'Busy, % (freezes vs calm)', 'Throughput, MB/s (freezes vs calm)', 'Hosts pagefile', 'Hosts workload'],
      rows: p.drives.map((d) => [
        d.label, d.class || na(d.classReason),
        pairText(d.atHang.latencyMs, d.calm.latencyMs, '', 'no reading'),
        pairText(d.atHang.queue, d.calm.queue, '', 'no reading'),
        pairText(d.atHang.busyPct, d.calm.busyPct, '', 'no reading'),
        pairText(mbps(d.atHang.readBps, d.atHang.writeBps), mbps(d.calm.readBps, d.calm.writeBps), '', 'no reading'),
        placeText(d.pagefile), placeText(d.workload),
      ]) });
    blocks.push({ t: 'p', cls: 'note', text: `Freeze values are means over the ${p.hangProbes} freeze probe${p.hangProbes === 1 ? '' : 's'}; calm values over the ${p.calmProbes} calm probe${p.calmProbes === 1 ? '' : 's'}. Drives are labelled by disk number and volume letters only.${p.workloadDrives.length ? '' : ' The workload drive is not declared (add "drives" to the scope file), so workload placement is unknown.'}` });
  }
  if (!p.volumes.length) blocks.push({ t: 'p', text: `Volume free space: ${na(p.volumesReason)}.` });
  else {
    blocks.push({ t: 'table', cls: 'storage-volumes', head: ['Volume', 'Considered', 'Free % (freezes vs calm)', 'Free MB (freezes vs calm)', 'Free MB first to last'],
      rows: p.volumes.map((v) => [v.volume, v.relevant === null ? 'yes (none identified, all judged)' : v.relevant ? 'yes (system, pagefile or workload)' : 'no',
        pairText(v.atHang.freePct, v.calm.freePct, '', 'no reading'), pairText(v.atHang.freeMB, v.calm.freeMB, '', 'no reading'),
        v.firstFreeMB === null ? na('no reading') : `${n2(v.firstFreeMB)} to ${n2(v.lastFreeMB)}`]) });
  }
  const lines = culpritLines(r);
  for (const l of lines) blocks.push({ t: 'p', text: l });
  return blocks;
}

// one line for the email; numbers are stored JSON values only (the disk-stall result, or the stored volume readings)
function emailStorageLine(raw) {
  const r = plain(raw);
  const p = storage.panel(r);
  if (!p.drives.length && !p.volumes.length) return `Storage: not available (${p.drivesReason}; ${p.volumesReason}).`;
  const bits = [];
  const stalls = stallResults(r).filter((x) => x.res.extra && x.res.extra.slowDrive).sort((a, b) => b.res.extra.slowDrive.meanLatencyMs - a.res.extra.slowDrive.meanLatencyMs);
  if (stalls.length) {
    const d = stalls[0].res.extra.slowDrive;
    bits.push(`slowest drive ${d.label}${d.class ? `, ${d.class}` : ''}, about ${n2(d.meanLatencyMs)} ms at the freezes; hosts the pagefile: ${placeText(d.hostsPagefile)}`);
  } else if (p.slowest) {
    const d = p.slowest;
    bits.push(`slowest drive at the freezes ${d.label}${d.class ? `, ${d.class}` : ''}; hosts the pagefile: ${placeText(d.pagefile)}`);
  } else if (p.drives.length && p.hangProbes === 0) bits.push('no freeze observed, so no drive is singled out');
  else bits.push(`per-drive data not available (${p.drivesReason || 'no drive reading at the freezes'})`);
  const lf = p.lowestFree;
  bits.push(lf ? `lowest free space ${lf.volume} ${n2(lf.freePct)}%${lf.freeMB !== null ? ` (${n2(lf.freeMB)} MB)` : ''}` : `free space not available (${p.volumesReason || 'no volume reading'})`);
  return `Storage: ${bits.join('; ')}.`;
}

module.exports = { storageBlocks, emailStorageLine, culpritLines, stallResults, MB };
