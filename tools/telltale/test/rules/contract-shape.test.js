'use strict';
// diagnosis-cause-rules 7.2 and 1.3: every new rule follows the engine rule contract; a memory-led case ranks the memory rules
// first; every evidence reference resolves; recorded parameters are overridable.
const test = require('node:test');
const assert = require('node:assert');
const S = require('./_scenarios');
const { rule, resolves, mkReport, diagnose, baseline, incident, lead } = require('./_fx');
const { validateResult, loadRules } = require('../../lib/diagnosis/engine');
const rp = require('../../lib/diagnosis/rule-params');

const NEW = ['commit-limit-pressure', 'hard-fault-thrash', 'vm-memory-dominance', 'database-memory-io', 'single-process-dominance', 'thermal-power-throttle', 'battery-power-plan', 'driver-interrupt-storm', 'gpu-contention'];
const FIELDS = ['id', 'class', 'fired', 'reason', 'at', 'inputs', 'threshold', 'n', 'calm', 'components', 'confidence', 'disprover', 'confounds'];

test('all nine rules are loaded from lib/diagnosis/rules by dropping the files in (no registration list)', () => {
  const ids = loadRules().map((r) => r.id);
  for (const id of NEW) assert.ok(ids.includes(id), id);
});

test('every new rule result in every scenario has the full engine contract shape and a valid vocabulary class', () => {
  const vocab = require('../../lib/diagnosis/vocabulary');
  const seen = new Set();
  const walk = (o) => { for (const v of Object.values(o)) { if (typeof v === 'function') { const s = v(); if (s && s.diagnosis) { for (const h of s.diagnosis.hangs) for (const r of h.rules) if (NEW.includes(r.id)) { validateResult(r); for (const f of FIELDS) assert.ok(f in r, `${r.id}.${f}`); assert.ok(vocab.isCauseClass(r.class), r.id); assert.ok(['disproved', 'not-disproved', 'not-evaluable'].includes(r.disprover.result)); assert.ok(r.threshold.value !== undefined && r.threshold.source && r.threshold.origin); if (r.fired === null) assert.ok(r.reason, `${r.id} is not evaluated and must say why`); seen.add(r.id); } } } } };
  for (const group of [S.commit, S.thrash, S.vm, S.db, S.single, S.thermal, S.battery, S.dpc, S.gpu]) walk(group);
  assert.deepStrictEqual([...seen].sort(), [...NEW].sort(), 'each rule appeared in at least one scenario');
});

test('confidence is derived: fired rules carry components C, D, O, K, P and a value that follows the published formula', () => {
  const conf = require('../../lib/diagnosis/confidence');
  for (const sc of [S.commit.fires(), S.thrash.fires(), S.dpc.fires(), S.gpu.fires(), S.thermal.fires(), S.vm.fires()]) {
    for (const h of sc.diagnosis.hangs) for (const r of h.rules) {
      if (!NEW.includes(r.id) || r.fired !== true || r.disprover.result === 'disproved') continue;
      const c = r.components;
      const want = conf.confidence({ C: c.C, D: c.D, O: c.O, K: c.K, activeConfounds: r.confounds.filter((x) => x.active).length }).value;
      assert.strictEqual(r.confidence, want, r.id);
      assert.ok(r.confidence > 0 && r.confidence <= 0.95);
    }
  }
});

test('every evidence reference of every fired new rule resolves to a stored probe with the same time and value', () => {
  let checked = 0;
  for (const group of [S.commit, S.thrash, S.vm, S.db, S.single, S.thermal, S.battery, S.dpc, S.gpu]) {
    for (const mk of Object.values(group)) {
      if (typeof mk !== 'function') continue;
      const sc = mk();
      if (!sc || !sc.diagnosis) continue;
      for (const h of sc.diagnosis.hangs) for (const r of h.rules) if (NEW.includes(r.id) && r.inputs.length) { assert.ok(resolves(sc.report, r), `${r.id} inputs resolve`); checked++; }
    }
  }
  assert.ok(checked >= 20, `checked ${checked} results`);
});

test('a memory-led case: the memory rules fire and rank, the non-firing rules do not, and the finding is memory', () => {
  const { diagnosis: d } = S.combined();
  const ranked = d.hangs[0].ranked;
  for (const id of ['commit-limit-pressure', 'vm-memory-dominance', 'single-process-dominance']) assert.ok(ranked.includes(id), id);
  for (const id of ['hard-fault-thrash', 'database-memory-io', 'thermal-power-throttle', 'battery-power-plan', 'driver-interrupt-storm', 'gpu-contention']) assert.ok(!ranked.includes(id), `${id} did not fire`);
  const classes = new Set(ranked.map((id) => rule(d, id).class));
  assert.deepStrictEqual([...classes], ['memory']);
  assert.strictEqual(d.finding.class, 'memory');
  assert.strictEqual(d.rollup[0].class, 'memory');
  // missing-signal rules are listed, with a reason, not silently absent
  for (const id of NEW.filter((x) => !ranked.includes(x))) assert.ok(rule(d, id), `${id} is listed`);
});

test('rule parameters are recorded with a provisional source, and a config override changes one value and its origin', () => {
  const rec = rp.recorded();
  assert.deepStrictEqual(Object.keys(rec).sort(), [...NEW].sort());
  assert.deepStrictEqual(rec['driver-interrupt-storm'].sumPct, { value: 10, unit: '%', source: 'provisional (diagnosis-cause-rules design)', origin: 'default' });
  const over = rp.recorded({ 'driver-interrupt-storm': { sumPct: 20 }, 'gpu-contention': { enginePct: 'high' } });
  assert.strictEqual(over['driver-interrupt-storm'].sumPct.value, 20);
  assert.strictEqual(over['driver-interrupt-storm'].sumPct.origin, 'config');
  assert.strictEqual(over['gpu-contention'].enginePct.value, 90, 'a non-numeric override is ignored');
  // a stored report carries the recorded values, so the diagnosis recomputes identically
  const mk = (rules) => {
    const r = mkReport({ probes: [...lead, ...baseline({ row: { cpu: { dpcPct: 1, interruptPct: 0.2 } } }), ...incident(() => ({ row: { cpu: { dpcPct: 9, interruptPct: 4 } } }))] });
    r.summary.thresholds.rules = rules;
    return diagnose(r);
  };
  const a = rule(mk(rp.recorded()), 'driver-interrupt-storm'), b = rule(mk(over), 'driver-interrupt-storm');
  assert.strictEqual(a.threshold.value, 10); assert.strictEqual(a.threshold.origin, 'default'); assert.strictEqual(a.fired, true);
  assert.strictEqual(b.threshold.value, 20); assert.strictEqual(b.threshold.origin, 'config'); assert.strictEqual(b.fired, false, '13% is below an overridden 20%');
  assert.match(a.threshold.source, /provisional/);
});

test('diagnosing the same stored report twice gives identical results (pure functions of the report)', () => {
  const { report } = S.combined();
  assert.deepStrictEqual(diagnose(report), diagnose(JSON.parse(JSON.stringify(report))));
});
