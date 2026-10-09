'use strict';
// storage-coverage 3.3 / 3.4: per-drive disk-stall test, slow-drive naming and placement, culprit naming within scope.
const test = require('node:test');
const assert = require('node:assert');
const S = require('./_storage-scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'disk-stall';

test('one slow drive hidden by the machine total: fires with n=3+, names Disk 1 (D:) and references the per-drive probe values', () => {
  const { report, diagnosis: d } = S.multi.hiddenByTotal();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.ok(r.n >= 3);
  assert.strictEqual(r.extra.perDrive.machineTotalQualified, false);
  assert.strictEqual(r.extra.slowDrive.label, 'Disk 1 (D:)');
  assert.strictEqual(r.extra.slowDrive.class, 'SATA HDD');
  assert.ok(r.inputs.every((i) => /^disk\.drive_(latency_ms|queue)\[1 D:\]$/.test(i.signal)), 'evidence is the per-drive series');
  assert.ok(resolves(report, r));
  assert.strictEqual(r.calm.signal, 'disk.drive_latency_ms[1 D:]');
  assert.ok(r.calm.mean < 10);
  assert.ok(r.confidence > 0 && r.confidence <= 0.95);
  assert.deepStrictEqual(r.extra.perDrive.drives.map((x) => [x.label, x.qualified]), [['Disk 0 (C:)', false], ['Disk 1 (D:)', true]]);
  assert.match(d.finding.sentence, /slowest drive Disk 1 \(D:\)/);
});

test('slow drive hosts the pagefile: stated as yes; workload drive not declared is stated, not guessed', () => {
  const r = rule(S.multi.pagefileOnSlow().diagnosis, ID);
  assert.strictEqual(r.extra.slowDrive.hostsPagefile.value, true);
  assert.match(r.extra.slowDrive.hostsPagefile.text, /hosts the pagefile: yes/);
  assert.strictEqual(r.extra.slowDrive.hostsWorkload.value, null);
  assert.match(r.extra.slowDrive.hostsWorkload.text, /workload drive not declared/);
});

test('slow drive hosts the declared workload and not the pagefile on C:', () => {
  const r = rule(S.multi.workloadOnSlow().diagnosis, ID);
  assert.strictEqual(r.extra.slowDrive.hostsWorkload.value, true);
  assert.strictEqual(r.extra.slowDrive.hostsPagefile.value, false);
  assert.match(r.extra.slowDrive.hostsPagefile.text, /hosts the pagefile: no/);
});

test('healthy multi-drive run: no stall; the disprover needs the total and every drive below its limits', () => {
  const r = rule(S.multi.healthy().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.match(r.reason, /not sustained/);
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.ok(r.disprover.values.some((v) => v.drive === 'Disk 1 (D:)'), 'drive readings are part of the disprover values');
});

test('the disprover is not satisfied by a fast machine total when one drive is slow', () => {
  const r = rule(S.multi.hiddenByTotal().diagnosis, ID);
  assert.strictEqual(r.disprover.result, 'not-disproved');
});

test('per-drive data absent: behaves as before (total fires) and the drive fields read "per-drive data not recorded"', () => {
  const r = rule(S.multi.totalOnly().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.n, 5);
  assert.deepStrictEqual(r.extra.perDrive, { recorded: false, text: 'per-drive data not recorded' });
  assert.strictEqual(r.extra.slowDrive, null);
  assert.strictEqual(r.calm.signal, 'disk.latency_ms');
});

test('one counter missing for one drive: that drive still has its latency and the rule uses what exists', () => {
  const r = rule(S.multi.missingQueue().diagnosis, ID);
  // queue is null, so the "queue >= 1" half is not met on that drive: absence is not a positive, and not an error
  assert.strictEqual(r.fired, false);
  assert.notStrictEqual(r.fired, null);
});

test('in-scope culprit named: the database group with its rate and share; evidence resolves', () => {
  const { report, diagnosis: d } = S.culprit.inScope();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.culprit.kind, 'named');
  assert.strictEqual(r.extra.culprit.group, 'code');
  assert.ok(r.extra.culprit.bps >= 80 * S.MB);
  assert.ok(r.extra.culprit.sharePct > 80);
  assert.ok(r.inputs.some((i) => i.signal === 'proc.group_io_bps[code]'));
  assert.ok(resolves(report, r));
  assert.match(d.finding.sentence, /code drove/);
});

test('out-of-scope culprit stays anonymous: rate and "31 groups" only, no process name anywhere, canary green', () => {
  const { report, diagnosis: d } = S.culprit.outOfScope();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.culprit.kind, 'outside-scope');
  assert.strictEqual(r.extra.culprit.groupCount, 31);
  assert.ok(r.extra.culprit.bps >= 100 * S.MB);
  assert.match(r.extra.culprit.text, /outside the declared scope/);
  assert.match(r.extra.culprit.text, /31 groups/);
  assert.ok(r.inputs.some((i) => i.signal === 'proc.outside_io_bps'));
  assert.ok(resolves(report, r));
  const all = JSON.stringify({ report, d });
  assert.ok(!all.toLowerCase().includes(S.CANARY), 'the out-of-scope process name is in no stored or derived field');
  assert.ok(!/noise\d/.test(all));
  assert.match(d.finding.sentence, /outside the declared scope/);
});

test('no per-process data: the culprit reads "per-process disk I/O not recorded"', () => {
  const r = rule(S.culprit.noProcs().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.culprit.kind, 'not-recorded');
  assert.strictEqual(r.extra.culprit.text, 'per-process disk I/O not recorded');
});

test('sync client in scope is a named, active confound; outside the scope it is not named anywhere', () => {
  const inS = rule(S.culprit.syncInScope().diagnosis, ID);
  const c = inS.confounds.find((x) => x.id === 'sync-client-io');
  assert.strictEqual(c.active, true);
  assert.match(c.text, /OneDrive/);
  const out = S.culprit.syncOutOfScope();
  const o = rule(out.diagnosis, ID);
  assert.strictEqual(o.confounds.find((x) => x.id === 'sync-client-io').active, false);
  assert.ok(!JSON.stringify({ r: out.report, d: out.diagnosis }).toLowerCase().includes('onedrive'), 'an out-of-scope sync client is in no artifact');
});
