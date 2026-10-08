'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { commit } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'commit-limit-pressure';

test('commit limit pressure fires: commit 93-96% of the limit, page file 40% to 46%, available 410-600 MB of 16 GB', () => {
  const { report, diagnosis: d } = commit.fires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'memory');
  assert.ok(r.n >= 3);
  assert.ok(resolves(report, r), 'every input re-reads to the stored value');
  assert.strictEqual(r.calm.signal, 'mem.commit_of_limit_pct');
  assert.deepStrictEqual({ mean: r.calm.mean, n: r.calm.n }, { mean: 60, n: 14 });
  assert.ok(r.confidence > 0 && r.confidence <= 0.95);
  assert.deepStrictEqual(r.extra.pagefile, { firstPct: 40, lastPct: 46, deltaPp: 6, risePpNeeded: 2 });
  assert.ok(d.hangs[0].ranked.includes(ID));
  assert.ok(d.suggestedActions.some((a) => a.key === 'memory-capacity' && a.ruleIds.includes(ID)));
});

test('high commit alone does not fire: 92% of the limit, page file flat, 3.1 GB available of 16 GB', () => {
  const r = rule(commit.highCommitOnly().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.match(r.reason, /not sustained/);
  assert.match(r.reason, /available < 819 MB/);
  assert.strictEqual(r.confidence, null);
});

test('disproved: commit below 80% of the limit at 2 of 3 hangs removes the rule from the ranking', () => {
  const d = commit.disproved().diagnosis;
  const r = rule(d, ID, 0);
  assert.strictEqual(r.fired, true, 'the first hang crossed');
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.strictEqual(r.disprover.values.length, 3);
  assert.ok(!d.hangs[0].ranked.includes(ID));
  assert.ok(!d.rollup.some((x) => x.id === ID));
  assert.ok(!d.suggestedActions.some((a) => a.ruleIds.includes(ID)));
});

test('a missing page-file series is not evaluated (fired null) and names the missing signal', () => {
  const r = rule(commit.noPagefile().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /mem\.pagefile_pct/);
});
