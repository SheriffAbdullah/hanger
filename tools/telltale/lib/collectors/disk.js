'use strict';
// Disk transfer latency (ms), queue, busy %, and read/write throughput: the machine total, plus per physical drive
// (storage-coverage), plus free space per volume. Per-drive and per-volume instances are read as wildcard families
// reduced per instance, so a drive that appears or disappears needs no restart. A drive is labelled by its disk number
// and volume letters only ("Disk 1 (D:)"); no serial number is ever read here.
const { one, rows, unavailable } = require('./common');

const COUNTERS = ['\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer', '\\PhysicalDisk(_Total)\\Current Disk Queue Length', '\\PhysicalDisk(_Total)\\% Idle Time',
  '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec', '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec'];
const DYNAMIC = [
  { path: '\\PhysicalDisk(*)\\Avg. Disk sec/Transfer', reducer: 'raw' }, { path: '\\PhysicalDisk(*)\\Current Disk Queue Length', reducer: 'raw' },
  { path: '\\PhysicalDisk(*)\\% Idle Time', reducer: 'raw' }, { path: '\\PhysicalDisk(*)\\Disk Read Bytes/sec', reducer: 'raw' },
  { path: '\\PhysicalDisk(*)\\Disk Write Bytes/sec', reducer: 'raw' },
  { path: '\\LogicalDisk(*)\\% Free Space', reducer: 'raw' }, { path: '\\LogicalDisk(*)\\Free Megabytes', reducer: 'raw' },
];

// "0 C:" -> {diskNumber: 0, letters: ['C:'], label: 'Disk 0 (C:)'}; the total instance and anything else -> null
function parseDriveInstance(inst) {
  const m = /^(\d+)(?:\s+(.*))?$/.exec(String(inst || '').trim());
  if (!m) return null;
  const letters = (m[2] || '').split(/\s+/).filter((x) => /^[A-Za-z]:$/.test(x)).map((x) => x.toUpperCase());
  return { diskNumber: Number(m[1]), letters, label: `Disk ${m[1]}${letters.length ? ` (${letters.join(', ')})` : ''}` };
}
const get = (list, inst) => { const r = list.find((x) => x.inst === inst); return r && Number.isFinite(r.v) ? r.v : null; };

function build(idx, { mk }) {
  const sec = one(idx, 'physicaldisk', 'avg. disk sec/transfer');
  const queue = one(idx, 'physicaldisk', 'current disk queue length');
  const idle = one(idx, 'physicaldisk', '% idle time');
  const rd = one(idx, 'physicaldisk', 'disk read bytes/sec');
  const wr = one(idx, 'physicaldisk', 'disk write bytes/sec');
  const busy = (i) => (i === null ? null : Math.min(100, Math.max(0, 100 - i)));
  const src = (k) => `disk.${k}@counterSession`;
  const disk = {
    latencyMs: mk(sec === null ? null : sec * 1000, 'ms', { prec: 0.1, src: src('latencyMs') }),
    queue: mk(queue, 'count', { prec: 0.1, src: src('queue') }),
    busyPct: mk(busy(idle), '%', { prec: 1, src: src('busyPct') }),
    readBps: mk(rd, 'bytes/s', { prec: 1, src: src('readBps') }),
    writeBps: mk(wr, 'bytes/s', { prec: 1, src: src('writeBps') }),
  };
  const failures = [];
  const present = { latencyMs: sec, queue, busyPct: idle, readBps: rd, writeBps: wr };
  for (const [k, v] of Object.entries(present)) if (v === null) failures.push(unavailable('signals.disk', `disk.${k}`, 'not-exposed', `${k} counter returned no value`));

  // ---- per physical drive ----
  const lat = rows(idx, 'physicaldisk', 'avg. disk sec/transfer'), qu = rows(idx, 'physicaldisk', 'current disk queue length'), id = rows(idx, 'physicaldisk', '% idle time');
  const rr = rows(idx, 'physicaldisk', 'disk read bytes/sec'), ww = rows(idx, 'physicaldisk', 'disk write bytes/sec');
  const names = new Set();
  for (const list of [lat, qu, id, rr, ww]) for (const r of list) if (parseDriveInstance(r.inst)) names.add(r.inst);
  const drives = [...names].map((inst) => {
    const p = parseDriveInstance(inst);
    const s = get(lat, inst), i = get(id, inst);
    return { drive: inst, label: p.label, diskNumber: p.diskNumber, letters: p.letters,
      latencyMs: mk(s === null ? null : s * 1000, 'ms', { prec: 0.1, src: src('drive.latencyMs') }),
      queue: mk(get(qu, inst), 'count', { prec: 0.1, src: src('drive.queue') }),
      busyPct: mk(busy(i), '%', { prec: 1, src: src('drive.busyPct') }),
      readBps: mk(get(rr, inst), 'bytes/s', { prec: 1, src: src('drive.readBps') }),
      writeBps: mk(get(ww, inst), 'bytes/s', { prec: 1, src: src('drive.writeBps') }) };
  }).sort((a, b) => a.diskNumber - b.diskNumber);
  if (drives.length) { disk.drives = drives; } else {
    disk.drives = null; disk.drivesReason = 'not-exposed';
    failures.push(unavailable('signals.disk', 'disk.drives', 'not-exposed', 'per-drive disk counters are not exposed by this machine'));
  }

  // ---- free space per volume ----
  const fp = rows(idx, 'logicaldisk', '% free space'), fm = rows(idx, 'logicaldisk', 'free megabytes');
  const letters = new Set();
  for (const list of [fp, fm]) for (const r of list) if (/^[A-Za-z]:$/.test(r.inst)) letters.add(r.inst.toUpperCase());
  const vol = (list, v) => { const r = list.find((x) => x.inst.toUpperCase() === v); return r && Number.isFinite(r.v) ? r.v : null; };
  const volumes = [...letters].sort().map((v) => ({ volume: v,
    freePct: mk(vol(fp, v), '%', { prec: 0.1, src: src('volume.freePct') }), freeMB: mk(vol(fm, v), 'MB', { prec: 1, src: src('volume.freeMB') }) }));
  if (volumes.length) disk.volumes = volumes; else {
    disk.volumes = null; disk.volumesReason = 'not-exposed';
    failures.push(unavailable('signals.disk', 'disk.volumes', 'not-exposed', 'volume free-space counters are not exposed by this machine'));
  }
  return { disk, failures };
}

module.exports = { COUNTERS, DYNAMIC, build, parseDriveInstance, id: 'signals.disk', inference: 'disk.latency' };
