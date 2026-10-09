'use strict';
// storage-coverage fixtures: nearly full disk, healthy disk, multi-drive, missing counters, out-of-scope culprit.
// Every probe row is produced by the REAL collectors (createSignals().build) from canned counter text, so the stored shape
// is the shape a run writes, and the privacy tests exercise the real scope resolver with a canary process name.
const scope = require('../../lib/scope');
const collectors = require('../../lib/collectors');
const { plain } = require('../../lib/sampler/record');
const { incident, baseline, scenario } = require('./_fx');

const B = String.fromCharCode(92);
const line = (cat, inst, counter, v) => `${B}${B}TESTHOST${B}${cat}(${inst})${B}${counter}=${v}`;
const POWER = { line: 'Online', pct: '90', flag: '9', overlay: 'ded574b5-45a0-4f42-8737-46345c09c238', saver: '0' };
const AT = '2026-10-07T10:00:00.000Z';

// counters: { total: [latMs, queue], drives: [{inst, lat, q, idle, rd, wr}], vols: [{v, pct, mb}], procs: [{name, rd, wr}] }
function lines(c) {
  const out = [];
  const t = c.total || [4, 0.2];
  out.push(line('PhysicalDisk', '_Total', 'Avg. Disk sec/Transfer', t[0] / 1000), line('PhysicalDisk', '_Total', 'Current Disk Queue Length', t[1]),
    line('PhysicalDisk', '_Total', '% Idle Time', 88), line('PhysicalDisk', '_Total', 'Disk Read Bytes/sec', 1200000), line('PhysicalDisk', '_Total', 'Disk Write Bytes/sec', 340000));
  for (const d of c.drives || []) {
    out.push(line('PhysicalDisk', d.inst, 'Avg. Disk sec/Transfer', d.lat / 1000));
    if (d.q !== null && d.q !== undefined) out.push(line('PhysicalDisk', d.inst, 'Current Disk Queue Length', d.q));
    out.push(line('PhysicalDisk', d.inst, '% Idle Time', d.idle ?? 80), line('PhysicalDisk', d.inst, 'Disk Read Bytes/sec', d.rd ?? 500000), line('PhysicalDisk', d.inst, 'Disk Write Bytes/sec', d.wr ?? 100000));
  }
  for (const v of c.vols || []) out.push(line('LogicalDisk', v.v, '% Free Space', v.pct), line('LogicalDisk', v.v, 'Free Megabytes', v.mb));
  for (const p of c.procs || []) out.push(line('process', p.name, 'IO Read Bytes/sec', p.rd || 0), line('process', p.name, 'IO Write Bytes/sec', p.wr || 0), line('process', p.name, 'Working Set', 100000000), line('process', p.name, 'Private Bytes', 90000000));
  return out;
}

// one probe row's `disk` and `procs` fields from counter text; `names` is the declared scope
function fields(c, names = ['code']) {
  const resolver = scope.createResolver(scope.createMatcher(names.map((n) => ({ name: n }))), { open: false });
  const sig = collectors.createSignals({ resolver, logicalCpus: 12, fail: () => {} });
  const f = plain(sig.build({ lines: lines(c), power: POWER, atIso: AT }).fields);
  return { disk: f.disk, procs: f.procs };
}

const D0 = { inst: '0 C:', lat: 4, q: 0.2 };
const D1 = { inst: '1 D:', lat: 5, q: 0.2 };
const profile = ({ pagefile = 'C:', disks = true } = {}) => ({
  systemProfile: {
    storage: {
      disks: disks ? { value: [{ number: 0, model: 'Synthetic NVMe 512', mediaType: 'SSD', bus: 'NVMe' }, { number: 1, model: 'Synthetic HDD 1TB', mediaType: 'HDD', bus: 'SATA' }], source: 'physical-disk-info', tier: 'user', asOf: AT } : { value: null, unavailableReason: 'not readable', source: 'physical-disk-info', tier: 'user', asOf: AT },
      systemVolume: { value: { volume: 'C:', freeGB: 60, totalGB: 460 }, unit: 'GB', source: 'logical-disk-info', tier: 'user', asOf: AT },
    },
    virtualMemory: { pagefiles: pagefile ? { value: [{ location: `${pagefile}${B}pagefile.sys`, drive: pagefile, currentMB: 2048 }], source: 'pagefile-info', tier: 'user', asOf: AT } : { value: null, unavailableReason: 'pagefile not recorded', source: 'pagefile-info', tier: 'user', asOf: AT } },
  },
});

const row = (c, names) => ({ row: fields(c, names) });

// ----------------------------------------------------------- nearly full / healthy disk (volume series)
const vols = (cpct, cmb, dpct = 55, dmb = 500000) => [{ v: 'C:', pct: cpct, mb: cmb }, { v: 'D:', pct: dpct, mb: dmb }];
const full = {
  // C: at 6, 6, 5, 5, 5 percent free at the hang; 40 percent in calm
  nearlyFull: (extra = {}) => scenario([
    ...baseline(row({ vols: vols(40, 190000) })),
    ...incident((i) => row({ vols: vols([6, 6, 5, 5, 5][i], [27600, 27500, 23000, 22800, 22700][i]) })),
  ], { extra: { ...profile(), ...extra } }),
  healthy: () => scenario([
    ...baseline(row({ vols: vols(48, 220000) })),
    ...incident(() => row({ vols: vols(48, 220000) })),
  ], { extra: profile() }),
  // 13 percent free: falling from 31000 MB to 29500 MB across the run, or flat
  falling: (flat = false) => scenario([
    ...baseline(row({ vols: vols(13, 31000) })),
    ...incident((i) => row({ vols: vols(13, flat ? 31000 : [30800, 30400, 30000, 29700, 29500][i]) })),
  ], { extra: profile() }),
  // three hangs; free space is 40 percent at two of them
  disproved: () => scenario([
    ...baseline(row({ vols: vols(40, 190000) })),
    ...incident(() => row({ vols: vols(6, 27000) }), { at: 40 }),
    ...incident(() => row({ vols: vols(40, 190000) }), { at: 80 }),
    ...incident(() => row({ vols: vols(40, 190000) }), { at: 120 }),
  ], { extra: profile() }),
  // the series are null with a reason (counter missing)
  missing: () => scenario([
    ...baseline(row({})),
    ...incident(() => row({})),
  ], { extra: profile(), failures: [{ collector: 'signals.disk', inference: 'disk.volumes', mode: 'not-exposed', reason: 'volume free-space counters are not exposed by this machine' }] }),
  // the only low volume is a data drive nobody declared, the system volume is fine: not relevant, does not fire
  irrelevantLow: () => scenario([
    ...baseline(row({ vols: vols(40, 190000, 40, 400000) })),
    ...incident(() => row({ vols: vols(40, 190000, 4, 40000) })),
  ], { extra: profile() }),
  declaredLow: () => scenario([
    ...baseline(row({ vols: vols(40, 190000, 40, 400000) })),
    ...incident(() => row({ vols: vols(40, 190000, 4, 40000) })),
  ], { extra: { ...profile(), storage: { workloadDrives: ['D:'] } } }),
};

// ----------------------------------------------------------- multi-drive stall
const slowD1 = { inst: '1 D:' };
const multi = {
  // machine total stays under 25 ms; drive 1 (D:) shows 70, 64, 81, 75, 70 ms with queue 3, 2, 4, 3, 3
  hiddenByTotal: (extra = {}, names) => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0, D1], vols: vols(40, 190000) }, names)),
    ...incident((i) => row({ total: [12, 0.4], drives: [D0, { ...slowD1, lat: [70, 64, 81, 75, 70][i], q: [3, 2, 4, 3, 3][i] }], vols: vols(40, 190000) }, names)),
  ], { extra: { ...profile(), ...extra } }),
  pagefileOnSlow: (workload) => multi.hiddenByTotal({ ...profile({ pagefile: 'D:' }), ...(workload ? { storage: { workloadDrives: workload } } : {}) }),
  workloadOnSlow: () => multi.hiddenByTotal({ storage: { workloadDrives: ['D:'] } }),
  healthy: () => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0, D1] })),
    ...incident(() => row({ total: [5, 0.2], drives: [D0, { ...D1, lat: 6 }] })),
  ], { extra: profile() }),
  // only the machine total is stored (the old shape): behaves as before
  totalOnly: () => scenario([
    ...baseline(row({ total: [4, 0.2] })),
    ...incident((i) => row({ total: [[41, 38, 55, 48, 40][i], [2, 1, 3, 2, 2][i]] })),
  ], { extra: profile() }),
  // one drive has no queue reading
  missingQueue: () => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0, { ...D1, q: null }] })),
    ...incident(() => row({ total: [5, 0.2], drives: [D0, { ...D1, lat: 90, q: null }] })),
  ], { extra: profile() }),
};

// ----------------------------------------------------------- culprit naming
const MB = 1048576;
const CANARY = 'zzcanary';
const culprit = {
  // an in-scope database group reads and writes 90 MB/s; the out-of-scope aggregate 4 MB/s
  inScope: () => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0], procs: [{ name: 'code', rd: 1 * MB, wr: 1 * MB }, { name: CANARY, rd: 1 * MB, wr: 0 }] })),
    ...incident((i) => row({ total: [[41, 38, 55, 48, 40][i], [2, 1, 3, 2, 2][i]], drives: [{ ...D0, lat: 50, q: 2 }], procs: [{ name: 'code', rd: 60 * MB, wr: 30 * MB }, { name: CANARY, rd: 3 * MB, wr: 1 * MB }] })),
  ], { extra: profile() }),
  // 120 MB/s from out-of-scope processes across 31 groups; every in-scope group under 2 MB/s
  outOfScope: (names) => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0], procs: [{ name: 'code', rd: 0.5 * MB, wr: 0.5 * MB }] })),
    ...incident((i) => row({ total: [[41, 38, 55, 48, 40][i], [2, 1, 3, 2, 2][i]], drives: [{ ...D0, lat: 50, q: 2 }],
      procs: [{ name: 'code', rd: 1 * MB, wr: 0.5 * MB }, { name: CANARY, rd: 40 * MB, wr: 20 * MB }, ...Array.from({ length: 30 }, (_, k) => ({ name: `noise${k}`, rd: 1.9 * MB, wr: 0 }))] }, names)),
  ], { extra: profile() }),
  noProcs: () => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0] })),
    ...incident((i) => row({ total: [[41, 38, 55, 48, 40][i], [2, 1, 3, 2, 2][i]], drives: [{ ...D0, lat: 50, q: 2 }] })),
  ], { extra: profile() }),
  // OneDrive is in the declared scope and busy near the hang
  syncInScope: (names = ['code', 'OneDrive']) => scenario([
    ...baseline(row({ total: [4, 0.2], drives: [D0] }, names)),
    ...incident((i) => row({ total: [[41, 38, 55, 48, 40][i], [2, 1, 3, 2, 2][i]], drives: [{ ...D0, lat: 50, q: 2 }], procs: [{ name: 'OneDrive', rd: 8 * MB, wr: 4 * MB }, { name: 'code', rd: 1 * MB, wr: 0 }] }, names)),
  ], { extra: profile() }),
  syncOutOfScope: () => culprit.syncInScope(['code']),
};

module.exports = { lines, fields, row, profile, full, multi, culprit, vols, D0, D1, CANARY, MB, line, B };
