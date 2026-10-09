'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { packDerived } = require('../lib/pack-calc');
const loaded = require('./fixtures/loaded-78s.json');
const battery = require('./fixtures/battery-1308.json');


test('pack recomputation uses the thresholds recorded in the trace, not current flags', () => {
  const traced = JSON.parse(JSON.stringify(battery));
  traced.summary.thresholds.commit = 85;
  const current = { ...traced.summary.thresholds, commit: 50 }; // as if `pack --commit 50`
  const d = packDerived(traced, current);
  assert.strictEqual(d.thresholds.used.commit, 85);
  assert.deepStrictEqual(d.thresholds.ignoredCurrent.commit, { current: 50, used: 85 });
  assert.strictEqual(d.thresholds.source, 'trace');
});

test('pack window comes from the observed window, not granularity x probes', () => {
  const d = packDerived(loaded, { ...loaded.summary.thresholds });
  assert.strictEqual(d.windowS, Math.round(loaded.window.observedS));
  assert.ok(d.windowS !== loaded.summary.granularityMs / 1000 * loaded.spawnProbes.length);
});
