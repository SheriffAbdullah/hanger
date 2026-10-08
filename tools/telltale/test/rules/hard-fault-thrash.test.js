'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { thrash } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'hard-fault-thrash';

test('real swap fires: pages out 350-900/s, page file 30% to 35%, modified list 400 to 520 MB', () => {
  const { report, diagnosis: d } = thrash.fires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'memory');
  assert.ok(resolves(report, r));
  assert.deepStrictEqual(r.extra.modified, { firstMB: 400, lastMB: 520, growthPct: 30 });
  assert.ok(r.inputs.some((i) => i.signal === 'mem.pages_out_per_s' && i.value === 900));
  assert.ok(!r.confounds.some((c) => c.id === 'observer-process-launches'), 'no observer cost recorded, no observer confound');
  assert.strictEqual(r.disprover.result, 'not-disproved');
});

test('image-load reads do not fire: pages in 4513/s, pages out 0/s, page file flat at 8%', () => {
  const d = thrash.imageLoadOnly().diagnosis;
  const r = rule(d, ID);
  assert.strictEqual(r.fired, false);
  assert.ok(r.confounds.some((c) => /image/.test(c.text)), 'image or mapped-file reads are listed as a confound');
  assert.strictEqual(r.disprover.result, 'disproved', 'pages out stay below 20/s at the hang');
});

test('the observer own process launches are a confound whenever observer cost was recorded', () => {
  const r = rule(thrash.observerRecorded().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  const c = r.confounds.find((x) => x.id === 'observer-process-launches');
  assert.ok(c && c.active);
  const base = rule(thrash.fires().diagnosis, ID);
  assert.ok(r.confidence < base.confidence, 'an active confound lowers the derived confidence');
});

test('no paging counters: not evaluated, never "no swap"', () => {
  const r = rule(thrash.noCounter().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /mem\.pages_out_per_s/);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
});
