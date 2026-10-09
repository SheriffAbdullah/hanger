'use strict';
// storage-coverage 3.1 / 3.2: the drop-in disk-nearly-full rule.
const test = require('node:test');
const assert = require('node:assert');
const S = require('./_storage-scenarios');
const { rule, resolves, diagnose } = require('./_fx');
const rp = require('../../lib/diagnosis/rule-params');
const { loadRules } = require('../../lib/diagnosis/engine');
const ID = 'disk-nearly-full';

test('the rule is a drop-in: loaded from lib/diagnosis/rules by file name, class disk', () => {
  const r = loadRules().find((x) => x.id === ID);
  assert.ok(r);
  assert.strictEqual(r.class, 'disk');
});

test('nearly full volume fires: C: at 6, 6, 5, 5, 5 percent free; n and evidence resolve; confidence derived and capped', () => {
  const { report, diagnosis: d } = S.full.nearlyFull();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.ok(r.n >= 3);
  assert.ok(resolves(report, r), 'every input re-reads to the stored value');
  assert.strictEqual(r.extra.volume, 'C:');
  assert.strictEqual(r.extra.freePct, 5);
  assert.ok(r.extra.freeMB > 0);
  assert.strictEqual(r.extra.viaWarning, false);
  assert.ok(r.confidence > 0 && r.confidence <= 0.95);
  assert.strictEqual(r.calm.signal, 'disk.relevant_free_pct');
  assert.ok(r.calm.mean >= 39 && r.calm.mean <= 41, 'calm baseline is the 40 percent of the baseline probes');
  assert.match(r.threshold.source, /provisional/);
  assert.ok(d.hangs[0].ranked.includes(ID));
  assert.ok(d.suggestedActions.some((a) => a.key === 'storage-health' && a.ruleIds.includes(ID)));
  assert.match(d.finding.sentence, /nearly full volume: C: had 5% free/);
});

test('healthy volume does not fire and the reason states the observed free percent and the limit', () => {
  const r = rule(S.full.healthy().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.match(r.reason, /48% to 48% free|48/);
  assert.match(r.reason, /below 10%/);
  assert.strictEqual(r.confidence, null);
});

test('falling free space widens the limit to the warning line: 13 percent and falling fires; 13 percent flat does not', () => {
  const f = rule(S.full.falling().diagnosis, ID);
  assert.strictEqual(f.fired, true);
  assert.strictEqual(f.extra.viaWarning, true);
  assert.strictEqual(f.extra.trend.firstFreeMB, 31000);
  assert.strictEqual(f.extra.trend.lastFreeMB, 29500);
  assert.strictEqual(f.extra.trend.fellMB, 1500);
  const flat = rule(S.full.falling(true).diagnosis, ID);
  assert.strictEqual(flat.fired, false);
  assert.match(flat.reason, /not falling/);
});

test('disproved: free space 40 percent at two of three hangs removes the rule from the ranking', () => {
  const d = S.full.disproved().diagnosis;
  const r = rule(d, ID, 0);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.strictEqual(r.disprover.values.length, 3);
  assert.ok(!d.hangs[0].ranked.includes(ID));
  assert.ok(!d.rollup.some((x) => x.id === ID));
});

test('missing volume counters: fired null with a reason that names the free-space signal; the disprover is not-evaluable', () => {
  const r = rule(S.full.missing().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /disk\.relevant_free_pct/);
  assert.match(r.reason, /not-exposed|no value stored/);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
  assert.strictEqual(r.confidence, null);
});

test('only relevant volumes count: an undeclared low data drive does not fire; declaring it as a workload drive does', () => {
  assert.strictEqual(rule(S.full.irrelevantLow().diagnosis, ID).fired, false);
  const r = rule(S.full.declaredLow().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.extra.volume, 'D:');
  assert.deepStrictEqual(r.extra.relevantVolumes.slice().sort(), ['C:', 'D:']);
});

test('limits are configurable and recorded: 15 from the config shows origin config, the default shows 10 provisional', () => {
  const def = rp.recorded();
  assert.deepStrictEqual(def[ID].lowFreePct, { value: 10, unit: '%', source: 'provisional (diagnosis-cause-rules design)', origin: 'default' });
  const over = rp.recorded({ [ID]: { lowFreePct: 15 } });
  assert.strictEqual(over[ID].lowFreePct.value, 15);
  assert.strictEqual(over[ID].lowFreePct.origin, 'config');
  // a 13 percent flat volume fires under a 15 percent low limit, not under the default 10
  const { report } = S.full.falling(true);
  const copy = JSON.parse(JSON.stringify(report));
  copy.summary.thresholds.rules = over;
  assert.strictEqual(rule(diagnose(copy), ID).fired, true);
  copy.summary.thresholds.rules = def;
  assert.strictEqual(rule(diagnose(copy), ID).fired, false);
});

test('an in-scope sync client active near the hang is a named confound; out of scope it is named nowhere', () => {
  const { scenario, baseline, incident } = require('./_fx');
  const MB = S.MB;
  const mk = (names) => scenario([
    ...baseline(S.row({ vols: S.vols(40, 190000) }, names)),
    ...incident((i) => S.row({ vols: S.vols([6, 6, 5, 5, 5][i], 23000), procs: [{ name: 'OneDrive', rd: 8 * MB, wr: 4 * MB }, { name: 'code', rd: 0, wr: 0 }] }, names)),
  ], { extra: S.profile() });
  const inS = mk(['code', 'OneDrive']);
  const c = rule(inS.diagnosis, ID).confounds.find((x) => x.id === 'sync-client-io');
  assert.strictEqual(c.active, true);
  assert.match(c.text, /OneDrive/);
  const out = mk(['code']);
  assert.strictEqual(rule(out.diagnosis, ID).confounds.find((x) => x.id === 'sync-client-io').active, false);
  assert.ok(!JSON.stringify({ r: out.report, d: out.diagnosis }).toLowerCase().includes('onedrive'));
});
