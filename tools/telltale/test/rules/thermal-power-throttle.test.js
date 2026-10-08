'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { thermal } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'thermal-power-throttle';

test('a turbo laptop clamped at the hang fires: calm median 148%, 71-80% at the hang with CPU 85%, a thermal limit reason, on battery', () => {
  const { report, diagnosis: d } = thermal.fires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'thermal-power');
  assert.ok(resolves(report, r));
  assert.strictEqual(r.extra.calmMedianPerfPct, 148);
  assert.strictEqual(r.extra.powerSource, 'battery');
  assert.strictEqual(r.extra.limitKind, 'thermal');
  assert.deepStrictEqual(r.extra.limitReasons, ['thermal-zone-reasons:0x1']);
  const sig = new Set(r.inputs.map((i) => i.signal));
  for (const s of ['cpu.pct_total', 'cpu.perf_pct', 'cpu.perf_limit_pct', 'cpu.throttle_flag', 'power.on_ac']) assert.ok(sig.has(s), s);
  assert.strictEqual(r.disprover.result, 'not-disproved');
  assert.ok(d.suggestedActions.some((a) => a.key === 'driver-firmware' && a.ruleIds.includes(ID)), 'a thermal limit maps to driver and firmware');
});

test('a power-limited run on battery under an efficiency mode maps to the power-plan action', () => {
  const { diagnosis: d } = thermal.powerLimited();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.limitKind, 'power');
  assert.ok(r.confounds.some((c) => c.id === 'power-mode-overlay' && c.active));
  assert.ok(d.suggestedActions.some((a) => a.key === 'power-plan' && a.ruleIds.includes(ID)));
});

test('an idle dip is not throttling: performance 40% only on probes with CPU below 10%, 140-150% at every hang', () => {
  const r = rule(thermal.idleDip().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.ok(r.disprover.values.every((v) => v.meanPerfPct >= 0.9 * v.calmMedianPerfPct));
});

test('missing performance data is not "no throttling": fired null, disprover not-evaluable, the missing signal and recorded reason named', () => {
  const { diagnosis: d } = thermal.missingPerf();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, null);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
  assert.match(r.reason, /cpu\.perf_pct/);
  assert.match(r.reason, /processor performance counter returned no value/);
  assert.ok(!d.hangs[0].ranked.includes(ID));
  assert.ok(!/ruled out by|no throttling/i.test(JSON.stringify(r)));
});

test('the trace-wide minimum of the legacy maximum-frequency statistic is not an input anywhere in the diagnosis', () => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', '..', 'lib', 'diagnosis');
  const hits = [];
  const walk = (p) => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, f.name); if (f.isDirectory()) walk(q); else if (/maxFreqMin/.test(fs.readFileSync(q, 'utf8'))) hits.push(q); } };
  walk(dir);
  assert.deepStrictEqual(hits, []);
});
