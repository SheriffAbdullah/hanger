'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { gpu } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'gpu-contention';

test('a saturated GPU engine fires: 94-99% on every probe at the hang', () => {
  const { report, diagnosis: d } = gpu.fires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'gpu');
  assert.ok(resolves(report, r));
  assert.strictEqual(r.extra.trigger, 'engine');
  assert.strictEqual(r.extra.memoryConditionEvaluated, false, 'no dedicated-memory total is stored, so that condition is not evaluated');
});

test('a 40% engine does not fire and disproves', () => {
  const r = rule(gpu.quiet().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'disproved');
});

test('no GPU data: not evaluated, and the recorded unavailable reason is carried', () => {
  const r = rule(gpu.noData().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /counters not exposed/);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
});

test('dedicated memory at 96% of the profile total fires even with a quiet engine', () => {
  const r = rule(gpu.vramFull().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.trigger, 'dedicated-memory');
  assert.strictEqual(r.extra.dedicatedTotalMB, 8192);
});
