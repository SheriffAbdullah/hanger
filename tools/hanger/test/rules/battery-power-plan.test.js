'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { battery } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'battery-power-plan';

test('battery doubles the hang rate: 6 hangs in 12 min on battery (24 probes) vs 3 in 15 min on AC (30 probes)', () => {
  const { report, diagnosis: d } = battery.doubles();
  assert.strictEqual(d.hangs.length, 9);
  const fired = d.hangs.filter((h) => h.rules.find((r) => r.id === ID).fired === true);
  assert.strictEqual(fired.length, 6, 'only the hangs on the battery side carry the cause');
  const r = fired[0].rules.find((x) => x.id === ID);
  assert.strictEqual(r.class, 'thermal-power');
  assert.deepStrictEqual(r.extra.battery, { hangs: 6, probes: 24, observedMin: 12, ratePerMin: 0.5 });
  assert.deepStrictEqual(r.extra.ac, { hangs: 3, probes: 30, observedMin: 15, ratePerMin: 0.2 });
  assert.strictEqual(r.extra.ratio, 2.5);
  assert.strictEqual(r.extra.via, 'rate');
  assert.ok(resolves(report, r));
  assert.strictEqual(r.disprover.result, 'not-disproved');
  assert.ok(d.suggestedActions.some((a) => a.key === 'power-plan' && a.hangs.k === 6 && a.hangs.of === 9));
  const acHang = d.hangs.find((h) => h.rules.find((x) => x.id === ID).fired === false);
  assert.match(acHang.rules.find((x) => x.id === ID).reason, /this hang was on AC/);
});

test('one power source only: the rate comparison is recorded as not evaluated, and nothing fires without the power-mode condition', () => {
  const r = rule(battery.acOnly().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /single power source observed/);
  assert.match(r.extra.rateComparison, /not evaluated: single power source observed/);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
});

test('one power source, but 3 of 3 hangs under an efficiency power mode vs 0% of calm probes: fires through the power-mode condition', () => {
  const d = battery.acOnlyEfficiencyHangs().diagnosis;
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.via, 'power-mode');
  assert.match(r.extra.rateComparison, /single power source observed/);
  assert.deepStrictEqual({ h: r.extra.mode.hangShare, c: r.extra.mode.calmShare }, { h: 1, c: 0 });
});

test('equal rates disprove: battery 0.40/min and AC 0.36/min, each side with 4 hangs and 20+ probes', () => {
  const r = rule(battery.equalRates().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.strictEqual(r.disprover.values[0].batteryRatePerMin, 0.4);
  assert.ok(r.disprover.values[0].acRatePerMin > 0.35 && r.disprover.values[0].acRatePerMin < 0.37);
});

test('no power data at all: not evaluated with both reasons named', () => {
  const r = rule(battery.noPowerData().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /single power source observed/);
  assert.match(r.reason, /power mode not evaluated/);
});
