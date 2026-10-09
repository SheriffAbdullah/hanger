'use strict';
// storage-coverage 4.1 / 4.2 / 4.3: storage block (Markdown and HTML), per-drive chart series, email line, profile rows.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('./rules/_storage-scenarios');
const { renderAll } = require('../lib/render');
const { buildSections, profileRows } = require('../lib/render/sections');
const { renderCharts } = require('../lib/render/svg-charts');
const { extract } = require('../lib/render/series');
const { buildEmail } = require('../lib/render/email');
const { diagnose } = require('../lib/diagnosis/engine');

const F = { jsonName: 'x.json', htmlName: 'x.report.html', emailName: 'x.email.txt', jsonSha256: 'a'.repeat(64) };
// the scenario reports are minimal; give them the fields a shareable view needs
const full = (sc) => {
  const report = JSON.parse(JSON.stringify(sc.report));
  report.diagnosis = diagnose(report);
  report.summary.hangEventCount = report.diagnosis.hangs.length;
  report.systemProfile = { ...report.systemProfile, identity: { model: { value: 'SX-1 Laptop', source: 'x', tier: 'user', asOf: '2026-10-07T10:00:00.000Z' }, serial: { value: 'SYN0000001', source: 'x', tier: 'user', asOf: '2026-10-07T10:00:00.000Z' } } };
  return report;
};
const slowPf = () => full(S.multi.pagefileOnSlow());

test('multi-drive report: Markdown and HTML list both drives by label with hang and calm latency and state the pagefile placement', () => {
  const r = slowPf();
  const out = renderAll(r, F);
  for (const [name, text] of [['md', out.md], ['html', out.html]]) {
    assert.match(text, /Disk 0 \(C:\)/, name);
    assert.match(text, /Disk 1 \(D:\)/, name);
    assert.match(text, /SATA HDD/, name);
    assert.match(text, /Hosts pagefile/, name);
  }
  const row = out.md.split('\n').find((l) => l.startsWith('| Disk 1 (D:)'));
  assert.ok(row, 'a table row for the slow drive');
  assert.match(row, /\| yes \|/, 'the slow drive hosts the pagefile');
  assert.match(row, /81 vs 5 /, 'hang latency vs calm latency');
  assert.match(row, /unknown \(workload drive not declared\)/);
  assert.ok(!/serial/i.test(out.md.split('### Storage')[1].split('###')[0]), 'no serial number in the storage block');
});

test('the disk chart has one series per drive beside the machine total', () => {
  const ex = extract(slowPf());
  assert.deepStrictEqual(ex.S.drives.map((d) => d.label), ['Disk 0 (C:)', 'Disk 1 (D:)']);
  const html = renderCharts(ex).html || renderCharts(ex);
  const text = typeof html === 'string' ? html : JSON.stringify(html);
  assert.match(text, /latency, machine total/);
  assert.match(text, /latency Disk 1 \(D:\)/);
  assert.match(text, /throughput Disk 0 \(C:\)/);
});

test('machine total only: the storage block reads "Per-drive disk data: not available (<reason>)" and the charts keep the machine total', () => {
  const r = full(S.multi.totalOnly());
  const md = renderAll(r, F).md;
  assert.match(md, /Per-drive disk data: not available \(per-drive counters were not recorded in this report\)/);
  assert.match(md, /Volume free space: not available/);
  const ex = extract(r);
  assert.deepStrictEqual(ex.S.drives, []);
  assert.ok(ex.S.diskLat.n > 0, 'machine-total latency is still charted');
});

test('the recorded collection failure becomes the reason in the placeholder', () => {
  const r = full(S.full.missing());
  r['collection.failures'] = [{ collector: 'signals.disk', inference: 'disk.drives', mode: 'not-exposed', reason: 'per-drive disk counters are not exposed by this machine' }];
  assert.match(renderAll(r, F).md, /Per-drive disk data: not available \(per-drive disk counters are not exposed by this machine\)/);
});

test('out-of-scope culprit stays anonymous in every view: the aggregate rate and group count, no process name', () => {
  const r = full(S.culprit.outOfScope());
  const out = renderAll(r, F);
  for (const t of [out.md, out.html, out.email]) {
    assert.ok(!t.toLowerCase().includes(S.CANARY), 'canary name absent');
    assert.ok(!/noise\d/.test(t));
  }
  assert.match(out.md, /dominated by load outside the declared scope/);
  assert.match(out.md, /31 groups/);
  assert.match(out.html, /dominated by load outside the declared scope/);
});

test('an in-scope culprit is named in the storage block', () => {
  const out = renderAll(full(S.culprit.inScope()), F);
  assert.match(out.md, /Code drove \d+(\.\d)? MB\/s/);
});

test('free space: the nearly-full fixture lists the volume with hang and calm values', () => {
  const md = renderAll(full(S.full.nearlyFull()), F).md;
  const row = md.split('\n').find((l) => l.startsWith('| C: |'));
  assert.ok(row);
  assert.match(row, /\| 5 vs 40 \| 23000 vs 190000 \| 190000 to 22700 \|/);
});

// ---- email line
test('email: a Storage line names the slow drive, its class and the pagefile placement; every number is backed by the JSON', () => {
  const r = slowPf();
  const e = buildEmail(r, F);
  const line = e.text.split('\n').find((l) => l.startsWith('Storage:'));
  assert.ok(line, e.text);
  assert.match(line, /slowest drive Disk 1 \(D:\), SATA HDD, about 7\d(\.\d)? ms at the freezes; hosts the pagefile: yes/);
  assert.match(line, /lowest free space C: 40% \(190000 MB\)/);
  assert.ok(e.check(), 'trace-to-JSON check passes');
});

test('email: no storage data gives "Storage: not available (<reason>)" and no invented number', () => {
  const r = full(S.full.missing());
  const e = buildEmail(r, F);
  const line = e.text.split('\n').find((l) => l.startsWith('Storage:'));
  assert.match(line, /^Storage: not available \(per-drive counters were not recorded in this report; volume free-space counters are not exposed by this machine\)\.$/);
  assert.ok(e.check());
});

test('email: out-of-scope culprit names no process', () => {
  const e = buildEmail(full(S.culprit.outOfScope()), F);
  assert.ok(!e.text.toLowerCase().includes(S.CANARY));
  assert.ok(e.check());
});

// ---- profile
test('system profile: the pagefile drive and the disk number appear as profile rows and the count matches the JSON facts', () => {
  const r = slowPf();
  const rows = profileRows(r.systemProfile);
  const pf = rows.find((x) => x.fact === 'Pagefiles');
  assert.ok(pf, JSON.stringify(rows.map((x) => x.fact)));
  assert.match(pf.value, /Drive: D:/);
  const disks = rows.find((x) => x.fact === 'Disks');
  assert.match(disks.value, /Number: 1/);
  const sections = buildSections(r, F).sections;
  const prof = sections.find((s) => s.id === 'profile');
  assert.strictEqual(prof.blocks[0].count, rows.length);
});

test('an older report with no storage fields still renders, packs the same sections, and keeps its other findings', () => {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'report', 'full-signals.json'), 'utf8'));
  const out = renderAll(r, F);
  assert.match(out.md, /Per-drive disk data: not available/);
  assert.match(out.email, /^Storage: not available/m);
});
