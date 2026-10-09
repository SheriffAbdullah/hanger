'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calmBaseline, chronicSlowGroups, foregroundChangedDropped, groupTotals } = require('../lib/input/guards');
const { buildEpisodes } = require('../lib/input/episodes');
const { parts, SETTINGS } = require('./helpers/input-fix');

test('guards: a calm 5-minute run has no episodes, a baseline with share 0, and is not noisy', () => {
  const p = parts('calm-5min');
  const r = buildEpisodes({ samples: p.samples, spans: p.spans, settings: SETTINGS });
  assert.deepStrictEqual(r.episodes, []);
  const b = calmBaseline({ windows: p.windows, stallMs: 250, blips: r.blips });
  const x = p.expected.baseline;
  assert.deepStrictEqual([b.n, b.medianMs, b.p95Ms, b.maxMs, b.overThresholdPct, b.noisy], [x.n, x.medianMs, x.p95Ms, x.maxMs, x.overThresholdPct, x.noisy]);
});

test('guards: a calm p95 of 180 ms against a 250 ms threshold flags the detector noisy with the measured p95 and the limit', () => {
  const p = parts('noisy-baseline');
  const b = calmBaseline({ windows: p.windows, stallMs: 250, blips: 0 });
  assert.strictEqual(b.noisy, true);
  assert.deepStrictEqual(b.noisyWhy, { p95Ms: p.expected.baseline.p95Ms, limitMs: p.expected.baseline.limitMs });
});

test('guards: noisy also when more than 5% of measurements outside episodes are over the threshold', () => {
  const p = parts('calm-5min');
  const b = calmBaseline({ windows: p.windows, stallMs: 250, blips: 100 });
  assert.strictEqual(b.noisy, true);
  assert.ok(b.noisyWhy.overThresholdPct > 5);
});

test('guards: no evaluated moment gives nulls with a reason, never zero', () => {
  const p = parts('idle-after-typing');
  const b = calmBaseline({ windows: p.windows.slice(1), stallMs: 250 });
  assert.strictEqual(b.n, 0);
  assert.strictEqual(b.medianMs, null);
  assert.strictEqual(b.p95Ms, null);
  assert.strictEqual(b.maxMs, null);
  assert.ok(b.reason.length > 5);
});

test('guards: a group over the threshold on 32 of 40 measurements is chronically slow; its episodes are recorded', () => {
  const p = parts('chronic-slow-app');
  assert.deepStrictEqual(chronicSlowGroups(p.windows), p.expected.chronic);
  assert.strictEqual(buildEpisodes({ samples: p.samples, spans: [], settings: SETTINGS }).episodes.length, 2);
});

test('guards: fewer than 20 measurements or under half over the threshold is not chronic; anonymous groups are never named', () => {
  const w = (g) => [{ groups: g }];
  assert.deepStrictEqual(chronicSlowGroups(w({ a: { n: 19, over: 19 } })), []);
  assert.deepStrictEqual(chronicSlowGroups(w({ a: { n: 40, over: 19 } })), []);
  assert.strictEqual(chronicSlowGroups(w({ a: { n: 20, over: 10 } })).length, 1);
  assert.deepStrictEqual(chronicSlowGroups(w({ 'out-of-scope': { n: 40, over: 40 }, unknown: { n: 40, over: 40 } })), []);
});

test('guards: group totals add across windows', () => {
  assert.deepStrictEqual(groupTotals([{ groups: { a: { n: 5, over: 1 } } }, { groups: { a: { n: 7, over: 2 }, b: { n: 1, over: 0 } } }]), { a: { n: 12, over: 3 }, b: { n: 1, over: 0 } });
});

test('guards: an ignored group creates no episode and is reported with its ignored-sample count', () => {
  const p = parts('chronic-slow-app');
  const r = buildEpisodes({ samples: p.samples, spans: [], settings: { ...SETTINGS, ignoreGroups: ['slowtool'] } });
  assert.strictEqual(r.episodes.length, 0);
  assert.deepStrictEqual(r.ignored, { slowtool: 4 });
});

test('guards: foreground-changed drops are counted from the window records', () => {
  assert.strictEqual(foregroundChangedDropped(parts('foreground-changed').windows), 3);
});
