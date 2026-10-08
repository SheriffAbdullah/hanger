'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dpc } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'driver-interrupt-storm';

test('an interrupt storm fires: DPC 9% + interrupt 4% = 13% on every probe at the hang, calm 1.2% (n=14)', () => {
  const { report, diagnosis: d } = dpc.fires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'cpu');
  assert.ok(resolves(report, r));
  assert.ok(r.inputs.every((i) => i.signal === 'cpu.dpc_intr_pct' && i.value === 13));
  assert.deepStrictEqual({ mean: r.calm.mean, n: r.calm.n, signal: r.calm.signal }, { mean: 1.2, n: 14, signal: 'cpu.dpc_intr_pct' });
  assert.strictEqual(r.hangValue, 13);
  assert.ok(d.suggestedActions.some((a) => a.key === 'driver-firmware' && a.ruleIds.includes(ID)));
});

test('normal interrupt load does not fire and disproves: DPC + interrupt stays at 2%', () => {
  const { diagnosis: d } = dpc.quiet();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.deepStrictEqual(d.suggestedActions.filter((a) => a.ruleIds.includes(ID)), []);
});

test('the legacy flat dpcPct / intrPct keys are read when the nested block is absent', () => {
  const r = rule(dpc.legacyKeys().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.hangValue, 13);
});

test('no DPC or interrupt series: not evaluated', () => {
  const r = rule(dpc.noData().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /cpu\.dpc_intr_pct/);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
});
