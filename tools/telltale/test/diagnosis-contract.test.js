'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diagnose, loadRules, RuleContractError, validateResult } = require('../lib/diagnosis/engine');
const { mkReport, calm } = require('./helpers/diag-report');

// 12 calm probes + one memory-pressure hang: enough for the engine to evaluate rules (>= 10 usable after the startup probe)
const hungReport = () => mkReport({ probes: [...calm(13, 10, 1), { t: 30, ms: 1500, hang: true, commit: 91, availMB: 300 }] });

const stubOk = {
  id: 'stub-ok', class: 'thermal-power', phrase: 'stub', valueLabel: 'stub',
  evaluate: (ctx, h) => ({ fired: false, reason: 'stub', inputs: [ctx.input(h, 'mem.committed_pct')], threshold: { value: 1, unit: '%', source: 'provisional', origin: 'default' }, n: 1 }),
  disprove: () => ({ check: 'stub check', result: 'not-evaluable', values: [] }),
};

test('every rule result carries the full contract (id, class, fired, inputs, threshold, n, calm, confidence, disprover, confounds)', () => {
  const d = diagnose(hungReport());
  assert.strictEqual(d.hangs.length, 1);
  for (const r of d.hangs[0].rules) {
    validateResult(r);
    assert.ok('id' in r && 'class' in r && 'fired' in r && Array.isArray(r.inputs) && 'n' in r && r.calm && 'confidence' in r);
    assert.ok(r.threshold && 'value' in r.threshold && r.threshold.unit && r.threshold.source && r.threshold.origin, `${r.id} threshold`);
    assert.ok(r.disprover.check && ['disproved', 'not-disproved', 'not-evaluable'].includes(r.disprover.result), `${r.id} disprover`);
    assert.ok(Array.isArray(r.confounds));
  }
});

test('a complete stub rule is accepted; one that omits a contract field is refused loudly', () => {
  const d = diagnose(hungReport(), { rules: [stubOk] });
  assert.strictEqual(d.hangs[0].rules[0].id, 'stub-ok');
  const noThreshold = { ...stubOk, id: 'stub-no-threshold', evaluate: (ctx, h) => { const r = stubOk.evaluate(ctx, h); delete r.threshold; return r; } };
  assert.throws(() => diagnose(hungReport(), { rules: [noThreshold] }), (e) => e instanceof RuleContractError && /threshold/.test(e.message));
  const noInputs = { ...stubOk, id: 'stub-no-inputs', evaluate: () => ({ fired: true, threshold: { value: 1, unit: '%', source: 'provisional', origin: 'default' }, n: 1 }) };
  assert.throws(() => diagnose(hungReport(), { rules: [noInputs] }), (e) => e instanceof RuleContractError && /inputs/.test(e.message));
  const noDisprover = { ...stubOk, id: 'stub-no-disprover', disprove: undefined };
  assert.throws(() => diagnose(hungReport(), { rules: [noDisprover] }), RuleContractError);
  const badFired = { ...stubOk, id: 'stub-bad-fired', evaluate: (ctx, h) => ({ ...stubOk.evaluate(ctx, h), fired: 'yes' }) };
  assert.throws(() => diagnose(hungReport(), { rules: [badFired] }), /fired must be/);
  const badClass = { ...stubOk, id: 'stub-bad-class', class: 'RAM-BOUND' };
  assert.throws(() => diagnose(hungReport(), { rules: [badClass] }), /vocabulary/);
});

test('missing data yields fired:null with a reason that names the signal, never false', () => {
  const report = mkReport({ probes: [...calm(13, 10, 1, { diskLat: 4 }), { t: 30, ms: 1500, hang: true, commit: 60, no_diskSec: true, no_diskQ: true }],
    failures: [{ inference: 'disk.latency', collector: 'signals.disk', mode: 'counter-missing', reason: 'counter absent' }] });
  const d = diagnose(report);
  const disk = d.hangs[0].rules.find((r) => r.id === 'disk-stall');
  assert.strictEqual(disk.fired, null);
  assert.match(disk.reason, /disk\.latency_ms/);
  assert.match(disk.reason, /counter-missing/);
});

test('rules load from lib/diagnosis/rules/*.js and each declares an id, class, evaluate and disprove', () => {
  const rules = loadRules();
  assert.deepStrictEqual(rules.map((r) => r.id).sort(), ['battery-power-plan', 'commit-limit-pressure', 'cpu-saturation', 'database-memory-io', 'disk-nearly-full', 'disk-stall', 'driver-interrupt-storm', 'gpu-contention', 'hard-fault-thrash', 'memory-pressure', 'outside-scope', 'security-contention', 'single-process-dominance', 'thermal-power-throttle', 'vm-memory-dominance']);
  for (const r of rules) assert.ok(typeof r.evaluate === 'function' && typeof r.disprove === 'function' && r.class);
});
