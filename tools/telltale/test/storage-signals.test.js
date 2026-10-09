'use strict';
// storage-coverage 1.1 / 1.2: per-drive disk signals and per-volume free space from canned counter text.
const test = require('node:test');
const assert = require('node:assert');
const scope = require('../lib/scope');
const collectors = require('../lib/collectors');
const disk = require('../lib/collectors/disk');
const { isRec, plain } = require('../lib/sampler/record');
const { line, lines } = require('./rules/_storage-scenarios');

const AT = '2026-10-07T10:00:00.000Z';
const POWER = { line: 'Online', pct: '90', flag: '9', overlay: 'ded574b5-45a0-4f42-8737-46345c09c238', saver: '0' };
function build(text, { fails = [] } = {}) {
  const resolver = scope.createResolver(scope.createMatcher([{ name: 'code' }]), { open: false });
  const sig = collectors.createSignals({ resolver, logicalCpus: 12, fail: (...a) => fails.push(a), minTicksBeforeFailure: 0 });
  const r = sig.build({ lines: text, power: POWER, atIso: AT });
  return { fields: r.fields, sig };
}
const twoDrives = () => lines({ total: [4.2, 0.3], drives: [{ inst: '0 C:', lat: 4, q: 0.2, idle: 90, rd: 1000000, wr: 200000 }, { inst: '1 D:', lat: 60, q: 3, idle: 10, rd: 9000000, wr: 4000000 }], vols: [{ v: 'C:', pct: 7.5, mb: 18000 }, { v: 'D:', pct: 55, mb: 500000 }] });

test('two drives are recorded beside the machine total, each value a provenance record with unit, window and source', () => {
  const { fields } = build(twoDrives());
  const d = fields.disk;
  assert.strictEqual(d.drives.length, 2);
  assert.deepStrictEqual(d.drives.map((x) => x.label), ['Disk 0 (C:)', 'Disk 1 (D:)']);
  for (const x of d.drives) for (const k of ['latencyMs', 'queue', 'busyPct', 'readBps', 'writeBps']) {
    assert.ok(isRec(x[k]), `${x.label}.${k} is a provenance record`);
    assert.ok(x[k].unit && x[k].src && x[k].windowS !== undefined && x[k].at, `${k} has unit, source, window and time`);
  }
  assert.strictEqual(d.drives[1].latencyMs.v, 60);
  assert.strictEqual(d.drives[1].busyPct.v, 90);
  assert.strictEqual(d.drives[1].queue.v, 3);
  assert.strictEqual(d.drives[1].readBps.unit, 'bytes/s');
  // the machine total is unchanged
  assert.strictEqual(d.latencyMs.v, 4.2);
  assert.strictEqual(d.queue.v, 0.3);
  assert.strictEqual(d.busyPct.v, 12);
});

test('drive labels hold the disk number and volume letters only: no serial number is read or stored', () => {
  const { fields } = build(twoDrives());
  const text = JSON.stringify(fields.disk);
  assert.ok(!/serial/i.test(text));
  assert.deepStrictEqual(fields.disk.drives.map((x) => Object.keys(plain(x)).sort().join()), Array(2).fill('busyPct,diskNumber,drive,label,latencyMs,letters,queue,readBps,writeBps'));
  const src = require('fs').readFileSync(require.resolve('../lib/collectors/disk.js'), 'utf8');
  assert.ok(!/serial/i.test(src.replace(/\/\/.*$/gm, '')), 'the collector code never mentions a serial number outside a comment');
  assert.deepStrictEqual(disk.parseDriveInstance('2 C: E:'), { diskNumber: 2, letters: ['C:', 'E:'], label: 'Disk 2 (C:, E:)' });
  assert.deepStrictEqual(disk.parseDriveInstance('3'), { diskNumber: 3, letters: [], label: 'Disk 3' });
  assert.strictEqual(disk.parseDriveInstance('_Total'), null);
});

test('free space per volume: percent and megabytes, each with its unit', () => {
  const { fields } = build(twoDrives());
  const c = fields.disk.volumes.find((v) => v.volume === 'C:');
  assert.ok(isRec(c.freePct) && isRec(c.freeMB));
  assert.deepStrictEqual([c.freePct.v, c.freePct.unit, c.freeMB.v, c.freeMB.unit], [7.5, '%', 18000, 'MB']);
  assert.deepStrictEqual(fields.disk.volumes.map((v) => v.volume), ['C:', 'D:']);
});

test('volumes that are not drive letters (hidden volumes, the total) are not recorded', () => {
  const t = [...twoDrives(), line('LogicalDisk', 'HarddiskVolume3', '% Free Space', 12), line('LogicalDisk', '_Total', '% Free Space', 30)];
  assert.deepStrictEqual(build(t).fields.disk.volumes.map((v) => v.volume), ['C:', 'D:']);
});

test('per-drive counters not exposed: the set is null with a reason, the total is recorded, and the failure is recorded once', () => {
  const fails = [];
  const text = lines({ total: [4.2, 0.3] });
  const { fields, sig } = build(text, { fails });
  build(text, { fails });
  const again = sig.build({ lines: text, power: POWER, atIso: AT });
  assert.strictEqual(fields.disk.drives, null);
  assert.strictEqual(fields.disk.drivesReason, 'not-exposed');
  assert.strictEqual(fields.disk.volumes, null);
  assert.strictEqual(fields.disk.volumesReason, 'not-exposed');
  assert.strictEqual(fields.disk.latencyMs.v, 4.2);
  assert.strictEqual(again.fields.disk.drives, null);
  const own = [];
  const s2 = collectors.createSignals({ resolver: scope.createResolver(scope.createMatcher([]), { open: false }), logicalCpus: 4, fail: (...a) => own.push(a), minTicksBeforeFailure: 0 });
  for (let i = 0; i < 3; i++) s2.build({ lines: text, power: POWER, atIso: AT });
  assert.strictEqual(own.filter((a) => a[0] === 'disk.drives').length, 1, 'one failure for per-drive data across three ticks');
  assert.strictEqual(own.filter((a) => a[0] === 'disk.volumes').length, 1, 'one failure for volume data across three ticks');
});

test('one counter missing for one drive: that drive queue is null and its other values are present', () => {
  const { fields } = build(lines({ drives: [{ inst: '0 C:', lat: 4, q: 0.2 }, { inst: '1 D:', lat: 60, q: null }] }));
  const d = plain(fields.disk).drives;
  assert.strictEqual(d[1].queue, null);
  assert.strictEqual(d[1].latencyMs, 60);
  assert.strictEqual(d[0].queue, 0.2);
});

test('the dynamic counter families are wildcard raw families on the shared session (no new process)', () => {
  assert.ok(disk.DYNAMIC.every((x) => x.reducer === 'raw' && x.path.includes('(*)')));
  assert.strictEqual(disk.DYNAMIC.length, 7);
  assert.ok(disk.DYNAMIC.some((x) => x.path.startsWith(String.fromCharCode(92) + 'LogicalDisk')));
  assert.ok(disk.COUNTERS.every((p) => p.startsWith(String.fromCharCode(92) + 'PhysicalDisk(_Total)')), 'counter paths keep their backslashes');
});

// ---- storage-coverage 2.2: the drive and volume signal ids read what the real collector stores
const signals = require('../lib/diagnosis/signals');
require('../lib/diagnosis/cause-signals');
const { validateResult } = require('../lib/diagnosis/engine');
const SC = require('./rules/_storage-scenarios');

test('2.2 signal ids address a drive or a volume and read the stored value with its unit', () => {
  const row = plain(build(twoDrives()).fields);
  const env = { logicalCpus: 12, totalMB: 16384, relevantVolumes: ['C:'] };
  assert.strictEqual(signals.read(row, 'disk.drive_latency_ms[1 D:]', env), 60);
  assert.strictEqual(signals.read(row, 'disk.drive_queue[1 D:]', env), 3);
  assert.strictEqual(signals.read(row, 'disk.drive_busy_pct[0 C:]', env), 10);
  assert.strictEqual(signals.read(row, 'disk.drive_io_bps[1 D:]', env), 13000000);
  assert.strictEqual(signals.read(row, 'disk.volume_free_pct[C:]', env), 7.5);
  assert.strictEqual(signals.read(row, 'disk.volume_free_mb[d:]', env), 500000, 'a volume letter matches case-insensitively');
  assert.strictEqual(signals.read(row, 'disk.relevant_free_pct', env), 7.5, 'only the relevant volume counts');
  assert.strictEqual(signals.read(row, 'disk.relevant_free_pct', { ...env, relevantVolumes: null }), 7.5, 'every volume when none is identified: the lowest');
  assert.strictEqual(signals.read(row, 'disk.drive_latency_ms[9 Z:]', env), null, 'an unknown drive is null, not zero');
  assert.strictEqual(signals.read({ disk: { drives: null, volumes: null } }, 'disk.relevant_free_pct', env), null);
  assert.strictEqual(signals.unitOf('disk.drive_latency_ms[1 D:]'), 'ms');
  assert.strictEqual(signals.unitOf('disk.volume_free_mb[C:]'), 'MB');
  assert.deepStrictEqual(signals.failureKeysOf('disk.volume_free_pct[C:]'), ['disk.volumes', 'signals.disk']);
});

test('every storage scenario result has the full engine rule contract shape', () => {
  const seen = new Set();
  for (const group of [SC.full, SC.multi, SC.culprit]) for (const fn of Object.values(group)) {
    const s = fn();
    for (const h of s.diagnosis.hangs) for (const r of h.rules) if (r.id === 'disk-nearly-full' || r.id === 'disk-stall') {
      validateResult(r);
      if (r.fired === null) assert.ok(r.reason, `${r.id} not evaluated must say why`);
      seen.add(r.id);
    }
  }
  assert.deepStrictEqual([...seen].sort(), ['disk-nearly-full', 'disk-stall']);
});
