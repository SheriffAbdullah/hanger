'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diagnose } = require('../lib/diagnosis/engine');
const { buildContext } = require('../lib/diagnosis/context');
const { mkReport, calm, iso } = require('./helpers/diag-report');

// probe 0 is always the (excluded) startup probe, so a scenario needs one extra leading probe
const lead = [{ t: 2, ms: 150 }];

test('hang definition is recorded with its source and a non-empty cannotSee (flag)', () => {
  const r = mkReport({ probes: [...lead, ...calm(12)], thresholds: { hang: 1200 }, settingsTh: { hang: 'flag' } });
  const d = diagnose(r);
  assert.strictEqual(d.hangDefinition.probe, 'process-start-latency');
  assert.strictEqual(d.hangDefinition.thresholdMs, 1200);
  assert.strictEqual(d.hangDefinition.source, 'flag');
  assert.ok(d.hangDefinition.cannotSee.length >= 2);
  assert.ok(d.hangDefinition.cannotSee.some((x) => /shorter than the probe interval/.test(x)));
});

test('a probe at 799 ms is not a hang; 800 ms is', () => {
  const r = mkReport({ probes: [...lead, ...calm(12), { t: 30, ms: 799, hang: undefined }, { t: 32, ms: 800, hang: undefined }] });
  const ctx = buildContext(r);
  assert.deepStrictEqual(ctx.allHangs.map((h) => h.ms), [800]);
});

test('calm mean excludes the hang neighbourhood (calm n counts only probes at least 10 s from a hang)', () => {
  const r = mkReport({ probes: [{ t: 2, ms: 150 }, { t: 10, ms: 300 }, { t: 20, ms: 1500, hang: true }, { t: 26, ms: 350 }, { t: 40, ms: 200 }] });
  const ctx = buildContext(r);
  assert.deepStrictEqual(ctx.calm.map((q) => q.p.tSec), [10, 40]);
  assert.strictEqual(ctx.calm.length, 2);
});

test('a short trace cannot be ranked: 6 usable probes and 2 hangs give insufficient-evidence with observations', () => {
  const r = mkReport({ probes: [{ t: 2, ms: 150 }, { t: 10, ms: 150 }, { t: 12, ms: 160 }, { t: 14, ms: 1400, hang: true, commit: 91 }, { t: 30, ms: 170 }, { t: 40, ms: 1100, hang: true, commit: 90 }, { t: 50, ms: 160 }] });
  const d = diagnose(r);
  assert.strictEqual(d.usable.probes, 6);
  assert.strictEqual(d.finding.class, 'insufficient-evidence');
  assert.deepStrictEqual(d.rollup, []);
  assert.ok(d.hangs.every((h) => h.ranked.length === 0 && h.rules.length === 0));
  assert.strictEqual(d.observations.filter((o) => /^hang /.test(o)).length, 2);
  assert.ok(d.observations.some((o) => /commit 91%/.test(o)));
  assert.match(d.finding.strength, /insufficient \(6 usable probes, minimum 10\)/);
});

test('one spike is not sustained: 1 of 12 probes, minimum 3', () => {
  const probes = [...lead, ...calm(12)];
  probes[5] = { ...probes[5], pages: 900 };
  const ctx = buildContext(mkReport({ probes }));
  const s = ctx.sustained(ctx.usable, (q) => ctx.sig(q, 'mem.pages_per_s') > 500);
  assert.strictEqual(s.sustained, false);
  assert.strictEqual(s.text, '1 of 12 probes, minimum 3');
  const three = ctx.sustained(ctx.usable, (q) => ctx.sig(q, 'mem.pages_per_s') > 30);
  assert.strictEqual(three.sustained, true);
});

test('user marks: a hung mark joins the hang within 2 s with its note; a fine mark anchors a calm probe; a far mark is unmatched with its gap', () => {
  const r = mkReport({
    probes: [...lead, ...calm(12), { t: 30, ms: 1500, hang: true, commit: 91 }],
    marks: [{ t: 31.5, kind: 'hung', note: 'terminal froze' }, { t: 12.4, kind: 'fine' }, { t: 26.0, kind: 'hung', note: 'felt stuck' }],
  });
  const d = diagnose(r);
  const hungJoin = d.marks.joined.find((m) => m.kind === 'hung');
  assert.strictEqual(hungJoin.onHang, true);
  assert.strictEqual(hungJoin.note, 'terminal froze');
  assert.strictEqual(hungJoin.role, 'hang-confirmed');
  const fine = d.marks.joined.find((m) => m.kind === 'fine');
  assert.strictEqual(fine.role, 'calm-anchor');
  assert.strictEqual(d.marks.unmatched.length, 1);
  assert.strictEqual(d.marks.unmatched[0].note, 'felt stuck');
  assert.ok(d.marks.unmatched[0].gapMs > 2000);
});

test('a user mark within 2 s confirms the hang; an unconfirmed hang is labelled probe-only and counted', () => {
  const r = mkReport({
    probes: [...lead, ...calm(13), { t: 30, ms: 1500, hang: true, commit: 91 }, { t: 45, ms: 1300, hang: true, commit: 90 }],
    marks: [{ t: 31.5, kind: 'hung' }],
  });
  const d = diagnose(r);
  assert.deepStrictEqual(d.hangs[0].confirmedBy, ['user-mark']);
  assert.deepStrictEqual(d.hangs[1].confirmedBy, ['probe-only']);
  assert.strictEqual(d.finding.confirmations['probe-only'], 1);
  assert.strictEqual(d.finding.confirmations['user-mark'], 1);
  assert.match(d.finding.sentence, /1 probe-only/);
});

test('OS not-responding (in-scope, evaluated at the hang) and a workload probe timeout also confirm', () => {
  const r = mkReport({
    probes: [...lead, ...calm(13), { t: 30, ms: 1500, hang: true, commit: 91, osConfirmed: true, osConfirmState: 'confirmed', osHungWindows: ['postgres'] }, { t: 45, ms: 1300, hang: true, commit: 90 }, { t: 55, ms: 1300, hang: true, commit: 90, osConfirmed: null, osConfirmState: 'not-evaluated' }],
    workload: { probes: { ping: [{ at: iso(45.5), ms: 5000, status: 'timeout' }] } },
  });
  const d = diagnose(r);
  assert.deepStrictEqual(d.hangs[0].confirmedBy, ['os-not-responding']);
  assert.deepStrictEqual(d.hangs[1].confirmedBy, ['workload-probe']);
  assert.deepStrictEqual(d.hangs[2].confirmedBy, ['probe-only'], 'a not-evaluated poll never confirms');
});

test('proxy validation: 4 hangs and 3 hung marks with 2 matched give precision 2/4 and recall 2/3', () => {
  const r = mkReport({
    probes: [...lead, ...calm(13), { t: 30, ms: 1500, hang: true }, { t: 45, ms: 1500, hang: true }, { t: 60, ms: 1500, hang: true }, { t: 75, ms: 1500, hang: true }],
    marks: [{ t: 30.5, kind: 'hung' }, { t: 45.8, kind: 'hung' }, { t: 100, kind: 'hung' }],
  });
  const pv = diagnose(r).proxyValidation;
  assert.strictEqual(pv.status, 'validated');
  assert.deepStrictEqual([pv.precision.num, pv.precision.den, pv.precision.value], [2, 4, 0.5]);
  assert.deepStrictEqual([pv.recall.num, pv.recall.den, pv.recall.value], [2, 3, 0.67]);
});

test('proxy validation: no hung marks means not validated and no precision or recall number', () => {
  const r = mkReport({ probes: [...lead, ...calm(13), { t: 30, ms: 1500, hang: true }] });
  const pv = diagnose(r).proxyValidation;
  assert.strictEqual(pv.status, 'not validated');
  assert.ok(!('precision' in pv) && !('recall' in pv));
});
