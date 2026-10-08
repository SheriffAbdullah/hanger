'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { single } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'single-process-dominance';

test('growth fires: node 4.8 -> 5.5 -> 6.2 GB across snapshots that span the hang, with the snapshot values and times as inputs', () => {
  const { report, diagnosis: d } = single.growth();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.group, 'node');
  assert.strictEqual(r.extra.kind, 'growth');
  assert.ok(r.extra.growthPct >= 10);
  assert.ok(r.extra.snapshots.length >= 3 && r.extra.snapshots.length <= 6);
  assert.ok(r.extra.snapshots.every((s) => s.ref && s.at && Number.isFinite(s.valueMB)));
  assert.ok(resolves(report, r));
  assert.ok(r.inputs.every((i) => i.signal === 'proc.group_mem_mb[node]'));
  assert.ok(d.suggestedActions.some((a) => a.key === 'app-memory' && a.names.includes('node')));
});

test('dominance fires: one group holds 8 GB of 11.2 GB used (71%) on every probe at the hang', () => {
  const { report, diagnosis: d } = single.dominance();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.kind, 'dominance');
  assert.strictEqual(r.extra.group, 'java');
  assert.ok(r.extra.sharePct >= 40);
  assert.ok(resolves(report, r));
});

test('balanced memory does not fire: five groups at 21% each, nothing grows', () => {
  const r = rule(single.balanced().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'not-disproved', 'a 21% group is above the 20% disprove line');
});

test('small flat groups are disproved: no group above 20% and no growth at any hang', () => {
  const r = rule(single.small().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'disproved');
});

test('the largest holder is outside the declared scope: this rule does not name it, and fires nothing', () => {
  const { diagnosis: d } = single.outOfScopeLargest();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.inputs.length, 0);
  assert.ok(!/9100|outOfScope/.test(JSON.stringify(r)));
  assert.notStrictEqual(rule(d, 'outside-scope'), undefined, 'the outside-scope rule remains the engine rule for that load');
});
