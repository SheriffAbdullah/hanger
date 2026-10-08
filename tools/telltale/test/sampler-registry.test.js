'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createRegistry } = require('../lib/sampler/registry');
const { parseBundleLines } = require('../lib/sampler/bundle');
const { bundleToRecords } = require('../lib/sampler/records');

const base = { id: 'x.one', inference: 'x.one', tier: 'continuous', unit: '%', source: { kind: 'counter-session', paths: ['\\Memory\\Pages/sec'] } };

test('2.1 the registry accepts a well-formed collector and exposes its counter paths', () => {
  const r = createRegistry();
  r.registerCollector(base);
  assert.deepStrictEqual(r.counterPaths(), ['\\Memory\\Pages/sec']);
  assert.strictEqual(r.get('x.one').tier, 'continuous');
});

test('2.1 it rejects a duplicate id', () => {
  const r = createRegistry();
  r.registerCollector(base);
  assert.throws(() => r.registerCollector(base), /duplicate id/);
});

test('2.1 it rejects a missing unit', () => {
  const r = createRegistry();
  assert.throws(() => r.registerCollector({ ...base, unit: undefined }), /missing a unit/);
});

test('2.1 it rejects a continuous collector that would launch its own process', () => {
  const r = createRegistry();
  assert.throws(() => r.registerCollector({ ...base, source: { kind: 'oneshot', run: () => {} } }), /shared counter session/);
});

test('2.1 on-trigger collectors need a budget; the probe tier needs the hang-probe source', () => {
  const r = createRegistry();
  assert.throws(() => r.registerCollector({ id: 'h', inference: 'h', tier: 'on-trigger', unit: 'ms', source: { kind: 'oneshot' } }), /budgetMs/);
  assert.throws(() => r.registerCollector({ id: 'p', inference: 'p', tier: 'probe', unit: 'ms', source: { kind: 'oneshot' } }), /hang-probe/);
});

test('2.2 telltale.js registers every legacy collector with an explicit tier, and every stub entry maps to one', () => {
  const { COLLECTORS } = require('../telltale.js');
  const stub = require('../mac-stub.json');
  for (const e of stub.inferences) assert.ok(COLLECTORS[e.collectorId], `stub entry ${e.inference} -> ${e.collectorId}`);
  assert.strictEqual(COLLECTORS.counterBundle.tier, 'continuous');
  assert.strictEqual(COLLECTORS.powerSample.tier, 'continuous');
  assert.strictEqual(COLLECTORS.spawnProbe.tier, 'probe');
  for (const id of ['tasklistSnap', 'respondPoll', 'gpuEngines', 'gpuMem', 'midTasklist']) { assert.strictEqual(COLLECTORS[id].tier, 'on-trigger', id); assert.ok(COLLECTORS[id].budgetMs > 0, id); }
  for (const id of ['winEvents', 'werCounts', 'dockerState', 'assetBlock', 'filedesc']) assert.strictEqual(COLLECTORS[id].tier, 'once', id);
  assert.strictEqual(COLLECTORS.ecoQoS, undefined, 'the EcoQoS batch is removed (data-signals-completeness)');
  for (const id of ['signals.cpu', 'signals.thermal', 'signals.memory', 'signals.disk', 'signals.network', 'signals.gpu', 'signals.system', 'signals.procs']) assert.strictEqual(COLLECTORS[id].tier, 'continuous', id);
});

// 2.3 worked example from lib/sampler/README.md: a collector registered through the interface, parsed on canned text
test('2.3 worked example: a new continuous collector is registered and its parse runs on canned text', () => {
  const example = require(path.join('..', 'lib', 'sampler', 'example-collector.js'));
  const r = createRegistry();
  r.registerCollector(example.collector);
  assert.deepStrictEqual(r.counterPaths(), ['\\Memory\\Pages Output/sec']);
  const parsed = example.parse(['\\\\host\\memory\\pages output/sec=12,5'], { decimal: ',' });
  assert.deepStrictEqual(parsed.values, { pagesOut: 12.5 });
  assert.strictEqual(parsed.failures.length, 0);
  const bad = example.parse(['\\\\host\\memory\\pages output/sec=n/a']);
  assert.strictEqual(bad.values.pagesOut, null);
  assert.strictEqual(bad.failures[0].mode, 'parse');
});

test('provenance: a counter bundle becomes records carrying unit, window, n, source, time and precision', () => {
  const { values } = parseBundleLines(['\\\\h\\memory\\% committed bytes in use=87.46', '\\\\h\\memory\\pages/sec=1234.5']);
  const rec = bundleToRecords(values, { at: '2026-10-07T13:08:16.120Z', windowS: 2 });
  assert.deepStrictEqual({ ...rec.committed }, { v: 87.5, unit: '%', windowS: 2, n: 1, src: 'counterBundle.committed@counterSession', at: '2026-10-07T13:08:16.120Z', prec: 0.1 });
  assert.strictEqual(rec.pages.v, 1235);
});
