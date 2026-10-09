'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { buildCore, offsetSec, ratePerMin } = require('../lib/timebase');
const rep = require('./fixtures/loaded-78s.json');
const { TH } = require('./fixtures/build-fixtures');

const T0 = Date.parse('2026-01-15T10:00:00.000Z');
void path;

test('offsets come from measured wall-clock times', () => {
  assert.strictEqual(offsetSec('2026-01-15T10:01:18.000Z', T0), 78);
  const last = rep.samples[rep.samples.length - 1];
  assert.ok(Math.abs(last.tSec - 78) < 0.5);
  // requested 40 samples at 0.5 s would end at 20 s; measured times must not
  assert.ok(last.tSec > 70);
  let prev = -1;
  for (const s of rep.samples) { assert.ok(Date.parse(s.at) >= prev); prev = Date.parse(s.at); }
});

test('rates and shares use the observed window', () => {
  const core = buildCore({ runStartMs: T0, nominalS: 20, intervalMs: 500, samples: rep.samples, probes: rep.spawnProbes, th: TH });
  assert.strictEqual(core.window.nominalS, 20);
  assert.ok(Math.abs(core.window.observedS - 78) < 0.5);
  assert.ok(Math.abs(core.summary.hangRatePerMin - 0.77) <= 0.01);
  assert.ok(Math.abs(core.summary.pctFrozenFull - 7.7) <= 0.1);
  assert.strictEqual(core.summary.windowBasis, 'observed');
  assert.strictEqual(ratePerMin(3, 120), 1.5);
});

test('hang context uses wall-clock offsets (+-10 s around 40 s)', () => {
  const core = buildCore({ runStartMs: T0, nominalS: 20, intervalMs: 500, samples: rep.samples, probes: rep.spawnProbes, th: TH });
  const h = core.hangEvents[0];
  assert.ok(Math.abs(h.tSec - 40) < 3);
  assert.strictEqual(h.context.windowS, 10);
  const pre = rep.samples.filter((x) => x.tSec >= h.tSec - 10 && x.tSec < h.tSec);
  const post = rep.samples.filter((x) => x.tSec > h.tSec && x.tSec <= h.tSec + 10);
  for (const x of [...pre, ...post]) assert.ok(x.tSec >= h.tSec - 10 && x.tSec <= h.tSec + 10);
  assert.ok(Math.min(...pre.map((x) => x.tSec)) >= 29 && Math.max(...post.map((x) => x.tSec)) <= 50);
  const mean = (a) => +(a.reduce((t, x) => t + x.usedPct, 0) / a.length).toFixed(1);
  assert.strictEqual(h.context.ramPreAvg, mean(pre));
  assert.strictEqual(h.context.ramPostAvg, mean(post));
  assert.ok(h.context.ramPreAvg !== null && h.context.ramPostAvg !== null);
});
