'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { episodeConfidence, MODEL, SOURCES } = require('../lib/input/confidence');

const base = { worstLatencyMs: 1500, samples: 3, corroboratedBy: [], guards: [] };
const C = (ep, o = {}) => episodeConfidence({ ...base, ...ep }, { stallMs: 250, ...o });

test('episode confidence: worst 1500 ms scores strictly higher than 300 ms, both list components and weights', () => {
  const hi = C({ worstLatencyMs: 1500 }), lo = C({ worstLatencyMs: 300 });
  assert.ok(hi.value > lo.value);
  for (const x of [hi, lo]) { assert.deepStrictEqual(Object.keys(x.components), ['S', 'L', 'X', 'N', 'G']); assert.deepStrictEqual(Object.keys(x.weights), ['S', 'L', 'X']); }
});

test('episode confidence: an overlapping helper late period lowers it strictly', () => {
  assert.ok(C({ guards: ['helper-late'] }).value < C({ guards: [] }).value);
});

test('episode confidence: chronic-slow and foreground-changed also lower it; the guard penalty is capped at 0.3', () => {
  const g = C({ guards: ['helper-late', 'chronic-slow-app', 'foreground-changed-near'] });
  assert.strictEqual(g.components.G, 0.3);
  assert.ok(g.value < C({ guards: ['helper-late', 'chronic-slow-app'] }).value);
});

test('episode confidence: a noisy baseline lowers it', () => {
  assert.ok(C({}, { noisy: true }).value < C({}).value);
  assert.strictEqual(C({}, { noisy: true }).components.N, 0.15);
});

test('episode confidence: every component at its maximum is exactly 0.95, never 1.0', () => {
  const x = C({ worstLatencyMs: 10000, samples: 50, corroboratedBy: SOURCES.slice() });
  assert.strictEqual(x.value, 0.95);
  assert.strictEqual(x.value, MODEL.cap);
});

test('episode confidence: an uncorroborated episode is non-zero and low; more sources raise it', () => {
  const none = C({ worstLatencyMs: 300, samples: 1 });
  assert.ok(none.value > 0 && none.value < 0.5);
  assert.ok(C({ worstLatencyMs: 300, samples: 1, corroboratedBy: ['probe-hang'] }).value > none.value);
  assert.ok(C({ corroboratedBy: ['probe-hang', 'user-mark'] }).value > C({ corroboratedBy: ['probe-hang'] }).value);
});

test('episode confidence: helper-late is corroboration only, not one of the four sources', () => {
  assert.ok(!SOURCES.includes('helper-late'));
  assert.strictEqual(C({ corroboratedBy: ['helper-late'] }).components.X, 0);
});

test('episode confidence: a mild single sample just over the threshold is not constant across inputs', () => {
  const vals = new Set([C({ worstLatencyMs: 260, samples: 1 }).value, C({ worstLatencyMs: 600, samples: 2 }).value, C({ worstLatencyMs: 900, samples: 4 }).value]);
  assert.strictEqual(vals.size, 3);
});
