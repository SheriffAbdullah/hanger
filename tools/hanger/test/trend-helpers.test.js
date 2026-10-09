'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../lib/diagnosis/trend-helpers');

test('rising: a steady climb passes, flat and falling series do not', () => {
  assert.strictEqual(T.rising([40, 42, 44, 46], 2).ok, true);
  assert.deepStrictEqual({ first: T.rising([40, 42, 44, 46], 2).first, last: T.rising([40, 42, 44, 46], 2).last, delta: T.rising([40, 42, 44, 46], 2).delta }, { first: 40, last: 46, delta: 6 });
  assert.strictEqual(T.rising([40, 40, 40, 40], 2).ok, false);
  assert.strictEqual(T.rising([46, 44, 42, 40], 2).ok, false);
});

test('rising: a noisy series with a net rise passes; a rise below the minimum delta does not', () => {
  assert.strictEqual(T.rising([40, 43, 41, 44, 43, 46], 2).ok, true);
  assert.strictEqual(T.rising([40, 40.5, 41, 41.2], 2).ok, false);
});

test('rising and growing need at least 3 points; nulls are skipped, not counted as zero', () => {
  const two = T.rising([40, 46], 2);
  assert.strictEqual(two.ok, false);
  assert.match(two.reason, /fewer than 3/);
  assert.strictEqual(T.rising([40, null, 46], 2).ok, false);
  assert.strictEqual(T.growing([400, 460], 5).ok, false);
  assert.strictEqual(T.growing([400, null, 420, 460, 520], 5).ok, true);
});

test('growing: a relative growth threshold on the first reading', () => {
  assert.deepStrictEqual({ ok: T.growing([400, 460, 520], 5).ok, pct: T.growing([400, 460, 520], 5).growthPct }, { ok: true, pct: 30 });
  assert.strictEqual(T.growing([400, 401, 402], 5).ok, false);
  assert.strictEqual(T.growing([0, 5, 10], 5).ok, false, 'a zero first reading has no relative growth');
});

test('monotonic: 4800 -> 5500 -> 6200 grows 29% and passes; a dip beyond the tolerance, a flat series and 2 snapshots do not', () => {
  const m = T.monotonic([4800, 5500, 6200], { totalPct: 10 });
  assert.deepStrictEqual({ ok: m.ok, n: m.n, pct: m.growthPct }, { ok: true, n: 3, pct: 29.2 });
  assert.strictEqual(T.monotonic([4800, 6200, 5500], { totalPct: 10 }).ok, false);
  assert.strictEqual(T.monotonic([4800, 4800, 4800], { totalPct: 10 }).ok, false);
  assert.strictEqual(T.monotonic([4800, 6200], { totalPct: 10 }).ok, false);
  assert.strictEqual(T.monotonic([4800, 4790, 5500, 6200], { totalPct: 10, tolerancePct: 1 }).ok, true, 'a 0.2% wobble is counter noise');
});

test('median, mean and slope ignore non-numbers', () => {
  assert.strictEqual(T.median([3, 1, null, 2]), 2);
  assert.strictEqual(T.median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(T.median([]), null);
  assert.strictEqual(T.mean([2, 4, undefined]), 3);
  assert.strictEqual(T.slope([1]), null);
  assert.strictEqual(T.slope([1, 2, 3]), 1);
});
