'use strict';
const test = require('node:test');
const assert = require('node:assert');
const conf = require('../lib/diagnosis/confidence');
const { diagnose } = require('../lib/diagnosis/engine');
const { resolveInput } = require('../lib/diagnosis/refs');
const { mkReport, calm } = require('./helpers/diag-report');
const mem = require('./fixtures/diagnosis/memory-13-08-14.json');

const lead = [{ t: 2, ms: 150 }];
// five hangs 20 s apart; `fireAt` marks which of them have commit above the threshold
const fiveHangs = (fireAt, marks = []) => {
  const probes = [...lead, ...calm(12, 10, 1, { commit: 60 })];
  [40, 60, 80, 100, 120].forEach((t, i) => probes.push({ t, ms: 1500, hang: true, commit: fireAt.includes(i) ? 91 : 60, availMB: fireAt.includes(i) ? 300 : 5000 }));
  return mkReport({ probes, marks });
};

test('confidence is derived from components and published weights, never a per-rule constant', () => {
  const d = diagnose(mem);
  assert.deepStrictEqual(d.confidenceModel.weights, { C: 0.35, D: 0.25, O: 0.25, K: 0.15 });
  assert.strictEqual(d.confidenceModel.cap, 0.95);
  const m = d.hangs[0].rules.find((r) => r.id === 'memory-pressure');
  assert.deepStrictEqual(m.components, { C: 1, D: 1, O: 1, K: 0.4, P: 0 });
});

test('worked example A: the 13-08-14 fixture gives memory-pressure confidence 0.91 at 5 of 5 hangs', () => {
  const d = diagnose(mem);
  assert.strictEqual(d.rollup[0].id, 'memory-pressure');
  assert.strictEqual(d.rollup[0].confidence, 0.91);
  assert.strictEqual(d.hangs.length, 5);
  assert.ok(d.hangs.every((h) => h.ranked[0] === 'memory-pressure'));
});

test('monotonic: the same rule co-occurring with 5 of 5 hangs scores strictly higher than 2 of 5', () => {
  const all = diagnose(fiveHangs([0, 1, 2, 3, 4]));
  const two = diagnose(fiveHangs([0, 1]));
  const a = all.rollup.find((r) => r.id === 'memory-pressure'), b = two.rollup.find((r) => r.id === 'memory-pressure');
  assert.ok(a.confidence > b.confidence, `${a.confidence} > ${b.confidence}`);
  assert.strictEqual(a.hangs, 5);
  assert.strictEqual(b.hangs, 2);
  for (const d of [all, two]) {
    const r = d.hangs[0].rules.find((x) => x.id === 'memory-pressure');
    assert.deepStrictEqual(Object.keys(r.components).sort(), ['C', 'D', 'K', 'O', 'P']);
  }
});

test('confidence never reaches certainty: every component at maximum and every hang confirmed gives exactly 0.95', () => {
  const marks = [40, 60, 80, 100, 120].map((t) => ({ t: t + 0.5, kind: 'hung' }));
  const d = diagnose(fiveHangs([0, 1, 2, 3, 4], marks));
  const m = d.rollup.find((r) => r.id === 'memory-pressure');
  assert.strictEqual(d.hangs[0].rules.find((r) => r.id === 'memory-pressure').components.K, 1);
  assert.strictEqual(m.confidence, 0.95);
  assert.ok(m.confidence < 1);
});

test('confidence() formula: weights, confound penalty cap and the 0.95 cap', () => {
  assert.strictEqual(conf.confidence({ C: 1, D: 1, O: 1, K: 1, activeConfounds: 0 }).value, 0.95);
  assert.strictEqual(conf.confidence({ C: 1, D: 0, O: 0, K: 0, activeConfounds: 0 }).value, 0.35);
  assert.strictEqual(conf.confidence({ C: 1, D: 1, O: 1, K: 0.4, activeConfounds: 0 }).value, 0.91);
  assert.strictEqual(conf.confidence({ C: 1, D: 1, O: 1, K: 0, activeConfounds: 1 }).P, 0.1);
  assert.strictEqual(conf.confidence({ C: 1, D: 1, O: 1, K: 0, activeConfounds: 9 }).P, 0.3);
});

test('the delta component is zero and flagged when there is no usable calm baseline', () => {
  assert.deepStrictEqual(conf.deltaComponent({ v: 90, calmMean: 62, calmN: 18, threshold: 85 }), { D: 1, flag: null });
  assert.deepStrictEqual(conf.deltaComponent({ v: 90, calmMean: null, calmN: 0, threshold: 85 }), { D: 0, flag: 'calm-insufficient' });
  assert.deepStrictEqual(conf.deltaComponent({ v: 90, calmMean: 62, calmN: 2, threshold: 85 }), { D: 0, flag: 'calm-insufficient' });
  assert.strictEqual(conf.deltaComponent({ v: 70, calmMean: 60, calmN: 5, threshold: 80 }).D, 0.5);
  assert.strictEqual(conf.deltaComponent({ v: 500, calmMean: 5000, calmN: 5, threshold: 2048, direction: 'lower' }).D, 1);
});

test('a hang whose calm baseline is already above the threshold still fires but records calm-insufficient with D=0', () => {
  const probes = [...lead, ...calm(8, 10, 1, { commit: 88 }), { t: 40, ms: 1500, hang: true, commit: 92, availMB: 300 }, { t: 41, ms: 1200, hang: true, commit: 93, availMB: 250 }, { t: 42, ms: 1300, hang: true, commit: 91, availMB: 280 }];
  const d = diagnose(mkReport({ probes }));
  const m = d.hangs[0].rules.find((r) => r.id === 'memory-pressure');
  assert.strictEqual(m.fired, true);
  assert.strictEqual(m.components.D, 0);
  assert.deepStrictEqual(m.components.flags, ['calm-insufficient']);
});

// ---- disprovers ----
test('memory rule disproved by calm values: commit 62% and 4.1 GB available at the hang and in the +-10 s around it', () => {
  const probes = [...lead, ...calm(14, 10, 1, { commit: 62, availMB: 4100 }), { t: 40, ms: 1500, hang: true, commit: 62, availMB: 4100 }];
  const d = diagnose(mkReport({ probes }));
  const m = d.hangs[0].rules.find((r) => r.id === 'memory-pressure');
  assert.strictEqual(m.disprover.result, 'disproved');
  assert.ok(m.disprover.values.length >= 1 && m.disprover.values.every((v) => v.commitPct === 62 && v.availMB === 4100));
  assert.ok(!d.hangs[0].ranked.includes('memory-pressure'));
});

test('a fired rule that is disproved leaves the ranking and the roll-up but stays listed with its values', () => {
  const stub = {
    id: 'stub-fired', class: 'thermal-power', phrase: 'stub', valueLabel: 'stub',
    evaluate: (ctx, h) => ({ fired: true, reason: null, inputs: [ctx.input(h, 'mem.committed_pct')], threshold: { value: 1, unit: '%', source: 'provisional', origin: 'default' }, n: 1 }),
    disprove: (ctx, h) => ({ check: 'stub disproves itself', result: 'disproved', values: [{ ref: h.ref }] }),
  };
  const probes = [...lead, ...calm(14, 10, 1), { t: 40, ms: 1500, hang: true, commit: 70 }];
  const d = diagnose(mkReport({ probes }), { rules: [stub] });
  assert.deepStrictEqual(d.hangs[0].ranked, []);
  assert.deepStrictEqual(d.rollup, []);
  assert.strictEqual(d.hangs[0].rules[0].fired, true);
  assert.strictEqual(d.hangs[0].rules[0].disprover.values.length, 1);
  assert.strictEqual(d.finding.class, 'undetermined');
});

test('a disprover with nothing to check is not-evaluable, never silently passed', () => {
  const probes = [...lead, ...calm(14, 10, 1, { no_committed: true, no_availMB: true }), { t: 40, ms: 1500, hang: true, no_committed: true, no_availMB: true }];
  const d = diagnose(mkReport({ probes }));
  const m = d.hangs[0].rules.find((r) => r.id === 'memory-pressure');
  assert.strictEqual(m.disprover.result, 'not-evaluable');
  assert.strictEqual(m.fired, null);
});

// ---- evidence references ----
test('every input of every rule at every hang resolves to the same stored probe, time and value', () => {
  for (const report of [mem, diagnose(mem) && mem]) {
    const d = report.diagnosis;
    let n = 0;
    for (const h of d.hangs) for (const r of h.rules) for (const i of r.inputs) { const x = resolveInput(report, i); assert.ok(x.ok, `${r.id} ${i.ref}: ${x.reason}`); n++; }
    assert.ok(n >= 5, 'the fixture has resolvable inputs');
  }
});

test('references across all five rules resolve, and a tampered value or time does not', () => {
  const sec = (v) => ({ system: [{ member: 'Security software', cpuPctMachine: v }] });
  const probes = [...lead, ...calm(15, 10, 1, { commit: 55, cpuPct: 25, cpuQ: 2, diskLat: 4, procs: sec(1.5) }),
    { t: 36, ms: 200, diskLat: 38, diskQ: 1 }, { t: 40, ms: 1500, hang: true, commit: 60, cpuPct: 96, cpuQ: 30, diskLat: 41, diskQ: 2, procs: sec(12) }, { t: 44, ms: 220, diskLat: 55, diskQ: 3 }];
  const report = mkReport({ probes, logicalCpus: 12 });
  const d = diagnose(report);
  let n = 0;
  for (const h of d.hangs) for (const r of h.rules) for (const i of r.inputs) { assert.ok(resolveInput(report, i).ok, `${r.id}/${i.signal}`); n++; }
  assert.ok(n >= 8);
  const any = d.hangs[0].rules.find((r) => r.inputs.length).inputs[0];
  assert.strictEqual(resolveInput(report, { ...any, value: any.value + 1 }).ok, false);
  assert.strictEqual(resolveInput(report, { ...any, at: '2000-01-01T00:00:00.000Z' }).ok, false);
  assert.strictEqual(resolveInput(report, { ...any, ref: 'spawnProbes[9999]' }).ok, false);
});

// ---- thresholds ----
test('every rule threshold records value, unit, source and origin; the disk rule records 25 ms', () => {
  const probes = [...lead, ...calm(12, 10, 1, { diskLat: 4 }), { t: 40, ms: 1500, hang: true, diskLat: 41, diskQ: 2 }];
  const d = diagnose(mkReport({ probes, settingsTh: { diskSec: 'flag' } }));
  for (const r of d.hangs[0].rules) assert.ok(r.threshold.source && String(r.threshold.source).length > 0 && r.threshold.origin, r.id);
  const k = d.hangs[0].rules.find((r) => r.id === 'disk-stall');
  assert.strictEqual(k.threshold.value, 25);
  assert.strictEqual(k.threshold.unit, 'ms');
  assert.strictEqual(k.threshold.origin, 'flag');
  assert.match(k.threshold.source, /cited/);
  const m = d.hangs[0].rules.find((r) => r.id === 'memory-pressure');
  assert.strictEqual(m.threshold.source, 'provisional');
  assert.strictEqual(m.threshold.origin, 'default');
  assert.deepStrictEqual(Object.keys(d.thresholds).sort(), ['battery-power-plan', 'commit-limit-pressure', 'cpu-saturation', 'database-memory-io', 'disk-stall', 'driver-interrupt-storm', 'gpu-contention', 'hard-fault-thrash', 'memory-pressure', 'outside-scope', 'security-contention', 'single-process-dominance', 'thermal-power-throttle', 'vm-memory-dominance']);
});
