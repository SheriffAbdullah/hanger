'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { probeAgreement, corroboration, corroboratedBy, isEligible, overlaps } = require('../lib/input/agreement');
const { buildEpisodes, activeIntervals } = require('../lib/input/episodes');
const { parts, SETTINGS, hangsOf, at } = require('./helpers/input-fix');

const S = (s) => at(s);
const E = (i, a, b, o = {}) => ({ ref: `inputStall.episodes[${i}]`, id: `ep${i + 1}`, startMs: S(a), endMs: S(b), durationMs: (b - a) * 1000, foreground: { kind: 'in-scope', group: 'code' }, guards: [], corroboratedBy: [], ...o });
const H = (i, atS, ms) => ({ ref: `spawnProbes[${i}]`, atMs: S(atS), ms, osConfirmed: false });
const ALL = { active: [{ fromMs: S(0), toMs: S(1000) }], notEvaluable: [], observed: null };

// 5 episodes, 4 probe hangs: hang A covers E1 and E2, hang B covers E3, hangs C and D match nothing
const eps5 = () => [E(0, 100, 101), E(1, 102, 103), E(2, 200, 201), E(3, 300, 301), E(4, 400, 401)];
const hangs4 = () => [H(0, 102.5, 1000), { ...H(1, 200.5, 500), osConfirmed: true }, H(2, 500, 900), H(3, 600, 900)];

test('agreement: precision 2/4 and recall 3/5, each with numerator and denominator', () => {
  const a = probeAgreement({ hangs: hangs4(), episodes: eps5(), evaluated: ALL, probeIntervalS: 2 });
  assert.deepStrictEqual([a.precision.num, a.precision.den, a.precision.value], [2, 4, 0.5]);
  assert.deepStrictEqual([a.recall.num, a.recall.den, a.recall.value], [3, 5, 0.6]);
  assert.strictEqual(a.toleranceMs, 2000);
});

test('agreement: a probe hang with no felt stall is listed and counts against precision; unmatched episodes are listed; refs are stored', () => {
  const a = probeAgreement({ hangs: hangs4(), episodes: eps5(), evaluated: ALL, probeIntervalS: 2 });
  assert.deepStrictEqual(a.probeHangsWithoutStall.map((x) => x.ref), ['spawnProbes[2]', 'spawnProbes[3]']);
  assert.deepStrictEqual(a.stallsWithoutProbeHang.map((x) => x.ref), ['inputStall.episodes[3]', 'inputStall.episodes[4]']);
  for (const x of [...a.probeHangsWithoutStall, ...a.stallsWithoutProbeHang]) assert.ok(x.ref && x.at);
});

test('agreement: a probe hang during idle time is excluded from the precision denominator and counted as idle', () => {
  const ev = { active: [{ fromMs: S(0), toMs: S(550) }, { fromMs: S(590), toMs: S(1000) }], notEvaluable: [], observed: null };
  // the hang at 500 s is in active time; the one at 570 s has no input within the window, so it is idle
  const a = probeAgreement({ hangs: [H(0, 500, 900), H(1, 570, 900)], episodes: [], evaluated: ev, probeIntervalS: 2 });
  assert.strictEqual(a.excluded.idle, 1);
  assert.strictEqual(a.precision.den, 1);
});

test('agreement: a probe hang inside a not-evaluable span is excluded and counted apart', () => {
  const ev = { ...ALL, notEvaluable: [{ fromMs: S(490), toMs: S(520) }] };
  const a = probeAgreement({ hangs: [H(0, 500, 900)], episodes: [], evaluated: ev, probeIntervalS: 2 });
  assert.deepStrictEqual([a.excluded.notEvaluable, a.precision.den], [1, 0]);
});

test('agreement: a hang outside the helper-observed time is excluded as unobserved', () => {
  const ev = { ...ALL, observed: [{ fromMs: S(0), toMs: S(100) }] };
  const a = probeAgreement({ hangs: [H(0, 500, 900)], episodes: [], evaluated: ev, probeIntervalS: 2 });
  assert.strictEqual(a.excluded.unobserved, 1);
});

test('agreement: an episode shorter than the probe interval counts against recall but not against recall at probe resolution', () => {
  const eps = [E(0, 100, 100.7), E(1, 200, 203)];
  const a = probeAgreement({ hangs: [H(0, 202, 1500)], episodes: eps, evaluated: ALL, probeIntervalS: 2 });
  assert.deepStrictEqual([a.recall.num, a.recall.den], [1, 2]);
  assert.deepStrictEqual([a.recallAtProbeResolution.num, a.recallAtProbeResolution.den], [1, 1]);
});

test('agreement: no episodes means recall is not evaluated and precision is 0 of n with a note', () => {
  const a = probeAgreement({ hangs: [H(0, 100, 900), H(1, 200, 900), H(2, 300, 900)], episodes: [], evaluated: ALL, probeIntervalS: 2 });
  assert.strictEqual(a.recall.status, 'not evaluated');
  assert.deepStrictEqual([a.precision.num, a.precision.den], [0, 3]);
  assert.match(a.note, /no stall in evaluated time/);
});

test('agreement: out-of-scope and chronic-slow episodes are not eligible; out-of-scope is its own bucket and explains the hang', () => {
  const eps = [E(0, 100, 101, { foreground: { kind: 'out-of-scope' } }), E(1, 200, 201, { guards: ['chronic-slow-app'] })];
  assert.deepStrictEqual(eps.map(isEligible), [false, false]);
  const a = probeAgreement({ hangs: [H(0, 100.5, 900)], episodes: eps, evaluated: ALL, probeIntervalS: 2 });
  assert.strictEqual(a.outOfScopeEpisodes, 1);
  assert.strictEqual(a.precision.num, 0);
  assert.match(a.probeHangsWithoutStall[0].reason, /out-of-scope/);
});

test('agreement: an unavailable or off detector makes every metric not evaluated with the reason and emits no count', () => {
  const a = probeAgreement({ status: 'unavailable', reason: 'helper blocked by policy', hangs: hangs4(), episodes: [], evaluated: ALL, probeIntervalS: 2 });
  assert.strictEqual(a.status, 'not evaluated');
  assert.strictEqual(a.reason, 'helper blocked by policy');
  assert.strictEqual(a.precision, undefined);
  const c = corroboration({ status: 'unavailable', reason: 'helper blocked by policy', episodes: [] });
  assert.deepStrictEqual(c, { status: 'not evaluated', reason: 'helper blocked by policy' });
});

test('corroboration: probe hang 3/5, Windows not-responding 1/5, user mark 1/5, workload probe 0/5, uncorroborated 1/5', () => {
  const eps = eps5();
  const ctx = { hangs: hangs4(), marksMs: [S(300.5)], workloadTimeoutsMs: [], latePeriods: [] };
  for (const e of eps) e.corroboratedBy = corroboratedBy(e, ctx);
  const c = corroboration({ episodes: eps });
  assert.deepStrictEqual([c.episodes, c.probeHang, c.osNotResponding, c.userMark, c.workloadProbe, c.none], [5, { num: 3, den: 5 }, { num: 1, den: 5 }, { num: 1, den: 5 }, { num: 0, den: 5 }, { num: 1, den: 5 }]);
});

test('corroboration: an episode may count under several sources; a helper late period is corroboration, never a hang source', () => {
  const e = E(0, 100, 101);
  const by = corroboratedBy(e, { hangs: [{ ...H(0, 100.5, 900), osConfirmed: true }], marksMs: [S(100.2)], workloadTimeoutsMs: [S(99)], latePeriods: [{ startMs: S(100.1), endMs: S(100.5) }] });
  assert.deepStrictEqual(by.sort(), ['helper-late', 'os-not-responding', 'probe-hang', 'user-mark', 'workload-probe']);
});

test('corroboration: zero episodes is 0 of 0 with a note that does not claim the machine did not freeze', () => {
  const c = corroboration({ episodes: [] });
  assert.deepStrictEqual([c.episodes, c.probeHang], [0, { num: 0, den: 0 }]);
  assert.match(c.note, /no input-response stall was observed/);
  assert.match(c.note, /does not show that the machine did not freeze/);
});

test('agreement: the basic fixture reproduces its expected numbers end to end (helper file, no report layer)', () => {
  const p = parts('basic-3-episodes');
  const built = buildEpisodes({ samples: p.samples, spans: p.spans, settings: SETTINGS, runEndMs: at(60) });
  const eps = built.episodes.map((e, i) => ({ ref: `inputStall.episodes[${i}]`, ...e }));
  const hangs = hangsOf(p.expected);
  const ev = { active: activeIntervals(p.windows), notEvaluable: [], observed: null };
  const a = probeAgreement({ hangs, episodes: eps, evaluated: ev, probeIntervalS: p.expected.probeIntervalS });
  assert.deepStrictEqual([a.precision.num, a.precision.den, a.recall.num, a.recall.den], [p.expected.agreement.precision.num, p.expected.agreement.precision.den, p.expected.agreement.recall.num, p.expected.agreement.recall.den]);
  assert.deepStrictEqual(a.probeHangsWithoutStall.map((x) => x.ref), p.expected.agreement.probeHangsWithoutStall);
  assert.deepStrictEqual(a.stallsWithoutProbeHang.map((x) => x.ref), p.expected.agreement.stallsWithoutProbeHang);
  eps.forEach((e, i) => { e.corroboratedBy = corroboratedBy(e, { hangs, marksMs: [], workloadTimeoutsMs: [], latePeriods: [] }); assert.deepStrictEqual(e.corroboratedBy, p.expected.corroboration[i]); });
});

test('agreement: overlap helper widens by the tolerance', () => {
  assert.ok(overlaps(0, 1000, 2500, 3000, 2000));
  assert.ok(!overlaps(0, 1000, 3500, 4000, 2000));
});
