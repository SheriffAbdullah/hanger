'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCore } = require('../lib/timebase');
const { validateText } = require('./helpers/validate-report');
const { TH } = require('./fixtures/build-fixtures');

const T0 = Date.parse('2026-01-15T10:00:00.000Z');
const sample = (t, used) => ({ at: new Date(T0 + t * 1000).toISOString(), tSec: t, freeGB: 4, usedPct: used });

test('no disk data: peaks are null with a reason, never 0', () => {
  const probes = [{ at: new Date(T0 + 2000).toISOString(), tSec: 2, ms: 100, usedPct: 60, committed: 50, pages: 10 }];
  const core = buildCore({ runStartMs: T0, nominalS: 10, intervalMs: 1000, samples: [sample(1, 60)], probes, th: TH });
  assert.strictEqual(core.summary.diskSecPeak, null);
  assert.strictEqual(core.summary.diskQPeak, null);
  assert.ok(core.nulls.diskSecPeak && core.nulls.diskQPeak);
  const txt = JSON.stringify({ schema: 's', run: {}, window: core.window, settings: {}, summary: core.summary });
  assert.ok(validateText(txt).ok);
});

test('no samples: min free is null, never Infinity, and the report still parses', () => {
  const core = buildCore({ runStartMs: T0, nominalS: 10, intervalMs: 1000, samples: [], probes: [], th: TH });
  assert.strictEqual(core.summary.minFreeGB, null);
  assert.ok(core.nulls.minFreeGB);
  assert.strictEqual(core.summary.hangRatePerMin, null);
  assert.strictEqual(core.summary.spawnMaxMs, null);
  assert.strictEqual(core.window.observedS, null);
  const txt = JSON.stringify({ schema: 's', run: {}, window: core.window, settings: {}, summary: core.summary });
  const v = validateText(txt);
  assert.ok(v.ok, v.problems && v.problems.join(';'));
  assert.ok(!txt.includes('Infinity'));
});
