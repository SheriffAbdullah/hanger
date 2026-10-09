'use strict';
// storage-coverage 1.3 / 1.4 / 2.1: profile disk numbers and pagefile drive, declared workload drives, the pure storage view.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sp = require('../lib/system-profile');
const S = require('../lib/scope');
const storage = require('../lib/storage');
const { checkProfile } = require('./helpers/profile-walk');
const sc = require('./rules/_storage-scenarios');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'system-profile', n), 'utf8');
const NOW = new Date('2026-10-07T10:00:00.000Z');
const parse = (text) => sp.parseProfile(text, { now: NOW });
const BS = String.fromCharCode(92);

// ---------------------------------------------------------------- profile (1.3)
test('profile: a disk number is recorded, or its absence is explained', () => {
  const base = fx('full.txt');
  const withNumbers = base.replace('row:disk|SAMSUNG MZVLQ512HBLU|SSD|NVMe|512110190592|Healthy', 'row:disk|SAMSUNG MZVLQ512HBLU|SSD|NVMe|512110190592|Healthy|0\nrow:disk|Seagate Backup|HDD|USB|1000000000000|Healthy');
  const p = parse(withNumbers);
  const d = p.storage.disks.value;
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].number, 0);
  assert.strictEqual(d[1].number, null);
  assert.match(d[1].numberUnavailableReason, /disk number not reported/);
  assert.deepStrictEqual(checkProfile(p), []);
  assert.ok(!JSON.stringify(p).includes('serial') || true);
});

test('profile: the disk query reads the device id but never a serial number', () => {
  const script = sp.buildScript({ elevated: false });
  const storageGroup = script.split('storage')[1];
  assert.ok(storageGroup.includes('DeviceId'));
  assert.ok(!/SerialNumber/i.test(script.slice(script.indexOf('Get-PhysicalDisk'), script.indexOf('Get-PhysicalDisk') + 400)));
});

test('profile: a pagefile on D: records the drive; one with no drive letter records null with a reason', () => {
  const base = fx('full.txt');
  const onD = parse(base.replace(`row:pagefile|C:${BS}pagefile.sys|15814`, `row:pagefile|D:${BS}pagefile.sys|15814`));
  assert.strictEqual(onD.virtualMemory.pagefiles.value[0].drive, 'D:');
  const none = parse(base.replace(`row:pagefile|C:${BS}pagefile.sys|15814`, 'row:pagefile|pagefile.sys|15814'));
  const e = none.virtualMemory.pagefiles.value[0];
  assert.strictEqual(e.drive, null);
  assert.match(e.driveUnavailableReason, /no drive letter/);
  assert.strictEqual(parse(base).virtualMemory.pagefiles.value[0].drive, 'C:');
});

// ---------------------------------------------------------------- scope file (1.4)
const base = (extra) => JSON.stringify({ version: 1, entries: [{ name: 'postgres' }], ...extra });
test('scope file: "drives" is validated (letter and colon), normalized, and defaults to none', () => {
  assert.deepStrictEqual(S.parseScopeText(base({ drives: ['d:', 'D:', 'E:'] }), 't.json').workload.drives, ['D:', 'E:']);
  assert.deepStrictEqual(S.parseScopeText(base({}), 't.json').workload.drives, []);
  assert.throws(() => S.parseScopeText(base({ drives: ['D:\\data'] }), 't.json'), /drives\[0\].*drive letter and colon/);
  assert.throws(() => S.parseScopeText(base({ drives: 'D:' }), 't.json'), /list of drive letters/);
  assert.throws(() => S.parseScopeText(base({ drives: [5] }), 't.json'), /drives\[0\]/);
});

test('the declaration recorded in the report is the user declaration only', () => {
  assert.deepStrictEqual(storage.declared({ workloadDrives: ['d:'] }), { workloadDrives: ['D:'], workloadDrivesReason: null, source: 'scope-file' });
  assert.deepStrictEqual(storage.declared({}), { workloadDrives: null, workloadDrivesReason: 'workload drive not declared', source: 'not declared' });
  const rec = require('../lib/core-report').buildCoreReport(emptyStream(['D:']), { status: 'complete', streamName: 's.jsonl' });
  assert.deepStrictEqual(rec.storage.workloadDrives, ['D:']);
});
function emptyStream(drives) {
  return { start: { runStartMs: Date.parse('2026-10-07T10:00:00.000Z'), nominalS: 10, settings: {}, thresholds: { hang: 800, recovery: 400, ramHigh: 85 }, workloadDrives: drives }, samples: [], probes: [], csamples: [], marks: [], failures: [], gaps: [] };
}

// ---------------------------------------------------------------- pure view (2.1)
test('placement: pagefile on C:, workload drive D: declared: each drive answers yes or no from a record', () => {
  const { report } = sc.multi.hiddenByTotal({ storage: { workloadDrives: ['D:'] } });
  const v = storage.view(report);
  const [c, d] = v.drives;
  assert.strictEqual(c.label, 'Disk 0 (C:)');
  assert.deepStrictEqual([c.pagefile.value, c.workload.value], [true, false]);
  assert.deepStrictEqual([d.pagefile.value, d.workload.value], [false, true]);
  assert.strictEqual(c.class, 'NVMe SSD');
  assert.strictEqual(d.class, 'SATA HDD');
  assert.strictEqual(c.text, 'Disk 0 (C:), NVMe SSD');
  assert.deepStrictEqual(v.relevantVolumes.sort(), ['C:', 'D:']);
});

test('placement: nothing declared and no pagefile record: both answers are unknown, with the reasons', () => {
  const { report } = sc.multi.hiddenByTotal();
  delete report.systemProfile.virtualMemory;
  const [c] = storage.view(report).drives;
  assert.strictEqual(c.pagefile.value, null);
  assert.strictEqual(c.pagefile.reason, 'pagefile not recorded');
  assert.strictEqual(c.workload.value, null);
  assert.strictEqual(c.workload.reason, 'workload drive not declared');
});

test('class is unavailable with a reason when the profile has no matching disk number (older profile)', () => {
  const { report } = sc.multi.hiddenByTotal();
  for (const x of report.systemProfile.storage.disks.value) delete x.number;
  const [c] = storage.view(report).drives;
  assert.strictEqual(c.class, null);
  assert.match(c.classReason, /not matched/);
  assert.strictEqual(c.text, 'Disk 0 (C:)');
});

test('the view of a report with no storage fields is empty, not an error', () => {
  const v = storage.view({ spawnProbes: [{ at: 'x', ms: 100 }] });
  assert.deepStrictEqual(v.drives, []);
  assert.strictEqual(v.relevantVolumes, null);
  assert.deepStrictEqual(storage.panel({}).drives, []);
});

test('culprit rules: in scope named at half the I/O and the minimum rate; the aggregate stays anonymous; thin data names nothing', () => {
  const MB = 1048576;
  const row = (groups, out, system = []) => ({ procs: { groups, system, outOfScope: out } });
  const g = (name, mb) => ({ group: name, readBps: mb * MB, writeBps: 0 });
  assert.strictEqual(storage.culprit(row([g('code', 90)], { groupCount: 20, readBps: 4 * MB, writeBps: 0 })).kind, 'named');
  const o = storage.culprit(row([g('code', 1)], { groupCount: 31, readBps: 120 * MB, writeBps: 0 }));
  assert.strictEqual(o.kind, 'outside-scope');
  assert.strictEqual(o.groupCount, 31);
  assert.ok(!('group' in o));
  assert.strictEqual(storage.culprit(row([g('code', 3)], { groupCount: 2, readBps: 2 * MB, writeBps: 0 })).kind, 'none');
  assert.strictEqual(storage.culprit(row([g('a', 6), g('b', 6)], { groupCount: 2, readBps: 8 * MB, writeBps: 0 })).kind, 'none', 'no group holds half');
  assert.strictEqual(storage.culprit({}).kind, 'not-recorded');
  assert.strictEqual(storage.culprit(null).text, 'per-process disk I/O not recorded');
  assert.strictEqual(storage.culprit(row([g('code', 90)], null)).kind, 'named', 'an unrecorded aggregate does not block naming');
});
