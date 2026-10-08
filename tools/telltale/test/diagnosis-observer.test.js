'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diagnose } = require('../lib/diagnosis/engine');
const { mkReport, calm, iso } = require('./helpers/diag-report');
const r03 = require('./fixtures/diagnosis/sample-r03.json');

test('the R03 sample startup probe (8849 ms collection) is excluded as startup-window and observer-slow, and no rule input uses it', () => {
  const d = diagnose(r03);
  const ex = d.excludedProbes.find((e) => e.ref === 'spawnProbes[0]');
  assert.deepStrictEqual(ex.reasons, ['startup-window', 'observer-slow']);
  assert.deepStrictEqual(d.usable, { probes: 4, excluded: 1, minimum: 10, sustainedMin: 3 });
  const refs = JSON.stringify(d.hangs);
  assert.ok(!refs.includes('spawnProbes[0]"'));
});

test('slip beyond the probe own latency, a long collection and the first 10 s all exclude a probe; a long hang alone does not', () => {
  const probes = [{ t: 2, ms: 150 }, { t: 5, ms: 150 }, { t: 12, ms: 150, slipS: 3.4 }, { t: 14, ms: 150, bundleMs: 2600 }, { t: 16, ms: 3000, hang: true, slipS: 3.1, commit: 90 }, ...calm(10, 20, 1)];
  const d = diagnose(mkReport({ probes }));
  const by = Object.fromEntries(d.excludedProbes.map((e) => [e.ref, e.reasons]));
  assert.deepStrictEqual(by['spawnProbes[0]'], ['startup-window']);
  assert.deepStrictEqual(by['spawnProbes[1]'], ['startup-window']);
  assert.deepStrictEqual(by['spawnProbes[2]'], ['observer-slip']);
  assert.deepStrictEqual(by['spawnProbes[3]'], ['observer-slow']);
  assert.ok(!('spawnProbes[4]' in by), 'a 3 s hang whose slip equals its own latency is a real hang');
  assert.strictEqual(d.hangs.length, 1);
});

test('a probe that overlaps a heavy collection longer than 2 s is observer-slow', () => {
  const heavy = [{ collector: 'tasklistSnap', trigger: 'hang', at: iso(11), elapsedMs: 3500, outcome: 'ok' }];
  const probes = [{ t: 2, ms: 150 }, { t: 13, ms: 900, hang: true, commit: 90 }, ...calm(12, 20, 1)];
  const d = diagnose(mkReport({ probes, heavyRuns: heavy }));
  assert.deepStrictEqual(d.excludedProbes.find((e) => e.ref === 'spawnProbes[1]').reasons, ['observer-slow']);
  assert.strictEqual(d.usable.excluded, 2);
});

test('excluded count is disclosed and excluded hangs are still counted', () => {
  const probes = [{ t: 2, ms: 150 }, { t: 3, ms: 150 }, { t: 12, ms: 1500, hang: true, slipS: 5, commit: 90 }, ...calm(12, 20, 1)];
  const d = diagnose(mkReport({ probes }));
  assert.strictEqual(d.usable.probes, 12);
  assert.strictEqual(d.usable.excluded, 3);
  assert.strictEqual(d.finding.excludedHangs, 1);
  assert.strictEqual(d.hangs.length, 0, 'the observer-affected hang is not ranked');
});
