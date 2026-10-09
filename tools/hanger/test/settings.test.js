'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSettings, clampLines } = require('../lib/settings');

test('config-sourced interval is recorded with source config', () => {
  const s = buildSettings({ argv: ['trace'], cfg: { interval: 500 }, anonymize: false });
  assert.strictEqual(s.interval.value, 500);
  assert.strictEqual(s.interval.source, 'config');
});

test('flag beats config and default; defaults say so', () => {
  const s = buildSettings({ argv: ['trace', '--duration', '30'], cfg: { duration: '90' }, anonymize: false });
  assert.strictEqual(s.duration.value, 30);
  assert.strictEqual(s.duration.source, 'flag');
  assert.strictEqual(buildSettings({ argv: ['trace'], cfg: {}, anonymize: false }).duration.source, 'default');
});

test('an over-maximum duration is clamped visibly with the requested value and reason (8 h maximum)', () => {
  const s = buildSettings({ argv: ['trace', '--duration', '36000'], cfg: {}, anonymize: false });
  assert.strictEqual(s.duration.value, 28800);
  assert.strictEqual(s.duration.requested, 36000);
  assert.deepStrictEqual([s.duration.clamped.from, s.duration.clamped.to], [36000, 28800]);
  assert.ok(s.duration.clamped.reason.length > 5);
  const lines = clampLines(s);
  assert.ok(lines.some((l) => /36000/.test(l) && /28800/.test(l)));
});

test('a 900 s duration is no longer clamped', () => {
  const s = buildSettings({ argv: ['trace', '--duration', '900'], cfg: {}, anonymize: false });
  assert.strictEqual(s.duration.value, 900);
  assert.strictEqual(s.duration.clamped, undefined);
});

test('thresholds carry their source', () => {
  const s = buildSettings({ argv: ['trace', '--hang', '1000'], cfg: { commit: 80 }, anonymize: false });
  assert.deepStrictEqual(s.thresholds.hang, { value: 1000, source: 'flag' });
  assert.deepStrictEqual(s.thresholds.commit, { value: 80, source: 'config' });
  assert.strictEqual(s.thresholds.pages.source, 'default');
});

// ---------- input-response stall detector settings ----------
test('inputStall defaults: on, 250/1000/1000/200/250/1000 ms, every value says default', () => {
  const s = buildSettings({ argv: ['trace'], cfg: {}, anonymize: false }).inputStall;
  assert.deepStrictEqual(s.enabled, { value: true, source: 'default' });
  assert.deepStrictEqual(['stallMs', 'recentInputMs', 'mergeGapMs', 'lateMs', 'tickMs', 'timeoutMs'].map((k) => s[k].value), [250, 1000, 1000, 200, 250, 1000]);
  assert.ok(Object.values(s).every((x) => x.source === 'default'));
  assert.deepStrictEqual(s.ignoreGroups, { value: [], source: 'default' });
});
test('inputStall: flag beats config beats default and each records its source', () => {
  const s = buildSettings({ argv: ['trace', '--stall-ms', '300'], cfg: { inputStall: { stallMs: 400, recentInputMs: 1500, ignoreGroups: ['SlowTool.exe'] } }, anonymize: false }).inputStall;
  assert.deepStrictEqual(s.stallMs, { value: 300, source: 'flag' });
  assert.deepStrictEqual(s.recentInputMs, { value: 1500, source: 'config' });
  assert.deepStrictEqual(s.ignoreGroups, { value: ['slowtool'], source: 'config' });
  assert.strictEqual(buildSettings({ argv: ['trace'], cfg: { inputStall: { stallMs: 400 } }, anonymize: false }).inputStall.stallMs.value, 400);
});
test('inputStall: --no-input-stall and config enabled:false disable it with their source', () => {
  assert.deepStrictEqual(buildSettings({ argv: ['trace', '--no-input-stall'], cfg: {}, anonymize: false }).inputStall.enabled, { value: false, source: 'flag' });
  assert.deepStrictEqual(buildSettings({ argv: ['trace'], cfg: { inputStall: { enabled: false } }, anonymize: false }).inputStall.enabled, { value: false, source: 'config' });
  assert.strictEqual(buildSettings({ argv: ['trace', '--no-input-stall'], cfg: { inputStall: { enabled: true } }, anonymize: false }).inputStall.enabled.source, 'flag');
});
test('inputStall: out-of-range values are clamped visibly (stall 50..5000 ms, tick 100..1000 ms) with a console line', () => {
  const s = buildSettings({ argv: ['trace', '--stall-ms', '10'], cfg: { inputStall: { tickMs: 5000 } }, anonymize: false });
  assert.deepStrictEqual([s.inputStall.stallMs.value, s.inputStall.stallMs.requested, s.inputStall.stallMs.clamped.to], [50, 10, 50]);
  assert.deepStrictEqual([s.inputStall.tickMs.value, s.inputStall.tickMs.requested], [1000, 5000]);
  const lines = clampLines(s);
  assert.ok(lines.some((l) => /inputStall\.stallMs/.test(l) && /10/.test(l) && /50/.test(l)));
  assert.ok(lines.some((l) => /inputStall\.tickMs/.test(l)));
  assert.strictEqual(buildSettings({ argv: ['trace', '--stall-ms', '9000'], cfg: {}, anonymize: false }).inputStall.stallMs.value, 5000);
});
test('inputStall: a non-numeric flag value falls back to the default and says so', () => {
  const s = buildSettings({ argv: ['trace', '--stall-ms', 'abc'], cfg: {}, anonymize: false }).inputStall.stallMs;
  assert.strictEqual(s.value, 250);
  assert.ok(s.clamped);
});
