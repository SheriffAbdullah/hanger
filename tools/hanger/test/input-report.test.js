'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildInputStall, evaluatedFromSection, episodesForJoin } = require('../lib/input/report');
const { probeAgreement } = require('../lib/input/agreement');
const { buildSettings } = require('../lib/settings');
const { isRec } = require('../lib/sampler/record');
const { load, hangsOf, at, DIR, T0 } = require('./helpers/input-fix');

const eff = (extra = {}, argv = ['trace']) => buildSettings({ argv, cfg: { inputStall: extra }, anonymize: false }).inputStall;
const NOW = new Date(T0 + 3600000).toISOString();

function run(name, o = {}) {
  const f = load(name);
  return buildInputStall({ settings: eff(), bridge: f.bridge, file: f.file, dir: DIR, hangs: hangsOf(f.expected), runEndMs: at(f.expected.runEndS || 0) || null, nowIso: NOW, ...o });
}

test('input report: basic-3-episodes has the full shape with provenance records', () => {
  const s = run('basic-3-episodes');
  assert.strictEqual(s.status, 'running');
  assert.strictEqual(s.episodes.length, 3);
  const e = s.episodes[0];
  for (const k of ['id', 'startAt', 'endAt', 'durationMs', 'worstLatencyMs', 'samples', 'sampleRefs', 'foreground', 'endReason', 'guards', 'corroboratedBy', 'confidence']) assert.ok(k in e, k);
  assert.ok(isRec(e.durationMs) && isRec(e.worstLatencyMs));
  assert.deepStrictEqual([e.durationMs.v, e.durationMs.unit, e.durationMs.windowS, e.durationMs.n, e.durationMs.src, e.durationMs.prec], [1800, 'ms', 1.8, 3, 'input-helper', 1]);
  assert.deepStrictEqual(e.corroboratedBy, ['probe-hang', 'os-not-responding']);
  assert.deepStrictEqual(Object.keys(e.confidence.components), ['S', 'L', 'X', 'N', 'G']);
  for (const k of ['observedS', 'evaluatedS', 'idleS', 'notEvaluableS']) assert.ok(isRec(s.evaluable[k]) && s.evaluable[k].unit === 's', k);
  assert.ok(s.evaluable.evaluatedS.v > 0);
  assert.strictEqual(s.settings.stallMs.v, 250);
  assert.strictEqual(s.settings.stallMs.provisional, true);
  assert.ok(s.cannotSee.length > 0 && s.cannotSee.some((c) => /keeps answering/.test(c)));
  assert.strictEqual(s.helper.badLines, 0);
});

test('input report: a worst latency of 1203.6 ms over 5 samples is stored as 1204 ms with the episode window, n and source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-in-'));
  const mk = (sec, lat) => ({ type: 'input-stall-sample', at: new Date(T0 + sec * 1000).toISOString(), latencyMs: lat, timeout: false, fg: { kind: 'in-scope', group: 'code' }, helperLate: false });
  const f = load('calm-5min');
  const recs = [f.records[0], ...f.records.filter((r) => r.type === 'input-window').slice(0, 3), mk(10, 300), mk(10.3, 600), mk(10.6, 900), mk(10.9, 1203.6), mk(11.2, 500)];
  const file = path.join(dir, 'h.input.jsonl');
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const s = buildInputStall({ settings: eff(), bridge: { status: 'running', file: 'h.input.jsonl', build: 'compiled' }, file, nowIso: NOW });
    const e = s.episodes[0];
    assert.strictEqual(e.worstLatencyMs.v, 1204);
    assert.strictEqual(e.worstLatencyMs.unit, 'ms');
    assert.strictEqual(e.worstLatencyMs.n, 5);
    assert.strictEqual(e.worstLatencyMs.windowS, e.durationMs.v / 1000);
    assert.strictEqual(e.worstLatencyMs.src, 'input-helper');
    assert.strictEqual(e.worstLatencyMs.prec, 1);
    assert.ok(!Number.isNaN(Date.parse(e.worstLatencyMs.at)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('input report: a calm run keeps the section with an empty episode list, evaluated time and a baseline', () => {
  const s = run('calm-5min');
  assert.deepStrictEqual(s.episodes, []);
  assert.ok(s.evaluable.evaluatedS.v > 0);
  assert.deepStrictEqual([s.calmBaseline.medianMs.v, s.calmBaseline.p95Ms.v, s.calmBaseline.maxMs.v, s.calmBaseline.overThresholdPct.v, s.calmBaseline.noisy], [3, 12, 30, 0, false]);
});

test('input report: no evaluated moment gives null baseline values with a reason, never zero', () => {
  const f = load('idle-after-typing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-in-'));
  const file = path.join(dir, 'h.input.jsonl');
  fs.writeFileSync(file, f.records.filter((r) => r.type !== 'input-window' || r.evalMs === 0).map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const s = buildInputStall({ settings: eff(), bridge: { status: 'running', file: 'h.input.jsonl' }, file, nowIso: NOW });
    assert.strictEqual(s.calmBaseline.medianMs, null);
    assert.ok(s.calmBaseline.medianMsReason);
    assert.strictEqual(s.evaluable.evaluatedS.v, 0);
    assert.strictEqual(s.evaluable.idleS.v, 20);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('input report: a torn last line is counted and every complete line is used', () => {
  const s = run('torn-last-line', { runEndMs: null });
  assert.strictEqual(s.helper.badLines, 1);
  assert.strictEqual(s.episodes.length, 1);
  assert.strictEqual(s.evaluable.observedS.v, 20);
});

test('input report: helper-unavailable keeps the section with a reason and null episodes, not an empty list', () => {
  const f = load('helper-unavailable');
  const s = buildInputStall({ settings: eff(), bridge: f.bridge, dir: DIR, nowIso: NOW });
  assert.strictEqual(s.status, 'unavailable');
  assert.strictEqual(s.reason, 'helper blocked by policy');
  assert.strictEqual(s.episodes, null);
  assert.ok(s.determinedAt);
  assert.ok(s.cannotSee.length > 0);
});

test('input report: a deleted helper file is unavailable with the file named; recovery otherwise proceeds', () => {
  const s = buildInputStall({ settings: eff(), bridge: { status: 'running', file: 'hanger-gone.input.jsonl', build: 'compiled' }, dir: DIR, nowIso: NOW });
  assert.strictEqual(s.status, 'unavailable');
  assert.match(s.reason, /hanger-gone\.input\.jsonl is missing/);
  assert.strictEqual(s.episodes, null);
});

test('input report: a stream with no helper record is unavailable; a stream that predates the detector has no section', () => {
  assert.strictEqual(buildInputStall({ settings: eff(), bridge: null, dir: DIR, nowIso: NOW }).status, 'unavailable');
  assert.strictEqual(buildInputStall({ settings: null, bridge: null, dir: DIR }), null);
});

test('input report: a detector turned off by the user is not-requested with its source, not unavailable', () => {
  const s = buildInputStall({ settings: eff({}, ['trace', '--no-input-stall']), bridge: null, dir: DIR, nowIso: NOW });
  assert.strictEqual(s.status, 'not-requested');
  assert.strictEqual(s.source, 'flag');
  assert.strictEqual(s.episodes, null);
  assert.strictEqual(buildInputStall({ settings: eff({ enabled: false }), bridge: null, dir: DIR, nowIso: NOW }).source, 'config');
});

test('input report: a completed run and its recovered stream produce equal episodes', () => {
  const f = load('basic-3-episodes');
  const done = run('basic-3-episodes', { runEndMs: at(60) });
  const recovered = buildInputStall({ settings: eff(), bridge: f.bridge, dir: DIR, hangs: hangsOf(f.expected), runEndMs: at(60), nowIso: NOW });
  assert.deepStrictEqual(recovered.episodes, done.episodes);
});

test('input report: out-of-scope episodes are anonymous and counted with their total duration', () => {
  const s = run('out-of-scope-episodes');
  assert.ok(s.episodes.every((e) => e.foreground.kind === 'out-of-scope' && !('group' in e.foreground)));
  assert.deepStrictEqual([s.outOfScope.episodes.v, s.outOfScope.totalMs.v], [2, 1400]);
  assert.ok(!/zz|"group":"[^"]*"/.test(JSON.stringify(s.episodes)));
});

test('input report: a chronically slow group is flagged and its episodes carry the guard', () => {
  const s = run('chronic-slow-app');
  assert.strictEqual(s.flags.chronicSlowGroups[0].group, 'slowtool');
  assert.ok(s.episodes.every((e) => e.guards.includes('chronic-slow-app')));
});

test('input report: an ignored group is declared with its ignored-sample count', () => {
  const s = run('chronic-slow-app', { settings: eff({ ignoreGroups: ['slowtool'] }) });
  assert.deepStrictEqual(s.episodes, []);
  assert.deepStrictEqual(s.flags.ignored, [{ group: 'slowtool', samples: 4 }]);
  assert.deepStrictEqual(s.settings.ignoreGroups.v, ['slowtool']);
});

test('input report: helper lateness periods are stored with the episode guard', () => {
  const s = run('helper-late');
  assert.strictEqual(s.helperLateness.latePeriods.length, 1);
  assert.strictEqual(s.helperLateness.latePeriods[0].maxMs.v, 850);
  assert.ok(s.episodes[0].guards.includes('helper-late'));
  assert.strictEqual(s.flags.helperLateSamples.v, 1);
});

test('input report: a helper that stopped writing before the run ended leaves a helper-exited interval', () => {
  const s = run('torn-last-line', { runEndMs: at(60) });
  assert.ok(s.unobserved.some((u) => u.reason === 'helper-exited'));
  assert.ok(s.evaluable.notEvaluable.some((u) => u.reason === 'helper-exited'));
  const done = run('basic-3-episodes', { runEndMs: at(60) });
  assert.deepStrictEqual(done.unobserved, []);
});

test('input report: not-evaluable spans are listed with reasons and out of the evaluated time', () => {
  const s = run('suspend-resume');
  assert.deepStrictEqual(s.evaluable.notEvaluable.map((x) => x.reason), ['suspend-resume']);
  assert.strictEqual(s.evaluable.notEvaluable[0].durationS.v, 26);
  assert.strictEqual(s.episodes[0].endReason, 'not-evaluable:suspend-resume');
});

test('input report: agreement recomputed from the stored section equals agreement computed from the helper data', () => {
  const f = load('basic-3-episodes');
  const s = run('basic-3-episodes');
  const hangs = hangsOf(f.expected);
  const fromStored = probeAgreement({ hangs, episodes: episodesForJoin(s), evaluated: evaluatedFromSection(s), probeIntervalS: 2 });
  assert.deepStrictEqual([fromStored.precision.num, fromStored.precision.den, fromStored.recall.num, fromStored.recall.den], [2, 3, 2, 3]);
  const again = probeAgreement({ hangs, episodes: episodesForJoin(JSON.parse(JSON.stringify(s))), evaluated: evaluatedFromSection(JSON.parse(JSON.stringify(s))), probeIntervalS: 2 });
  assert.deepStrictEqual(again, fromStored);
});
