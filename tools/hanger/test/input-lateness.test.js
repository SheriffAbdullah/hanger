'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { groupLate, summarize, weightedQuantile } = require('../lib/input/lateness');
const { parts, at } = require('./helpers/input-fix');

test('lateness: one wake 1100 ms after a 250 ms schedule is one late period with max 850 ms and wall start and end', () => {
  const wakes = [{ atMs: at(30.0), latenessMs: 2 }, { atMs: at(30.75), latenessMs: 850 }, { atMs: at(31.0), latenessMs: 3 }];
  const p = groupLate(wakes, 200);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].maxMs, 850);
  assert.strictEqual(p[0].startMs, at(29.9));
  assert.strictEqual(p[0].endMs, at(30.75));
});

test('lateness: consecutive late wakes join one period; a calm wake splits periods', () => {
  const w = [250, 300, 5, 400].map((l, i) => ({ atMs: at(i), latenessMs: l }));
  const p = groupLate(w, 200);
  assert.deepStrictEqual(p.map((x) => [x.n, x.maxMs]), [[2, 300], [1, 400]]);
});

test('lateness: the helper-late fixture summary has one period and the window maximum', () => {
  const f = parts('helper-late');
  const s = summarize({ windows: f.windows, latePeriods: f.records.filter((r) => r.type === 'input-late') });
  assert.strictEqual(s.periods.length, 1);
  assert.strictEqual(s.periods[0].maxMs, 850);
  assert.strictEqual(s.maxMs, 850);
  assert.ok(s.n > 0 && s.medianMs !== null && s.p95Ms !== null);
});

test('lateness: an idle run with a late period records the period and no stall sample', () => {
  const f = parts('idle-after-typing');
  const s = summarize({ windows: f.windows, latePeriods: [{ startAt: '2026-02-01T09:00:15.000Z', endAt: '2026-02-01T09:00:16.000Z', maxMs: 900, n: 3 }] });
  assert.strictEqual(s.periods.length, 1);
  assert.strictEqual(f.samples.length, 0);
});

test('lateness: main-process event-loop lag is not helper lateness (calm helper wakes give no period)', () => {
  const f = parts('calm-5min');
  assert.deepStrictEqual(summarize({ windows: f.windows, latePeriods: [] }).periods, []);
  assert.deepStrictEqual(groupLate([1, 2, 3, 4].map((i) => ({ atMs: at(i), latenessMs: 3 })), 200), []);
});

test('lateness: no wake-ups give nulls, not zero', () => {
  const s = summarize({ windows: [], latePeriods: [] });
  assert.deepStrictEqual([s.n, s.medianMs, s.p95Ms, s.maxMs], [0, null, null, null]);
});

test('lateness: weighted quantile', () => {
  assert.strictEqual(weightedQuantile([{ v: 1, w: 1 }, { v: 10, w: 1 }], 0.5), 1);
  assert.strictEqual(weightedQuantile([{ v: 1, w: 9 }, { v: 100, w: 1 }], 0.95), 100);
  assert.strictEqual(weightedQuantile([], 0.5), null);
});
