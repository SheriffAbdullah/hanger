'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildEpisodes, evaluable } = require('../lib/input/episodes');
const { parts, SETTINGS, at } = require('./helpers/input-fix');

const build = (name, over = {}) => { const p = parts(name); return { p, r: buildEpisodes({ samples: p.samples, spans: p.spans, settings: { ...SETTINGS, ...over }, runEndMs: at(p.expected.runEndS) }) }; };
const shape = (e) => ({ startS: (e.startMs - at(0)) / 1000, endS: (e.endMs - at(0)) / 1000, durationMs: e.durationMs, worstLatencyMs: e.worstLatencyMs, samples: e.samples, sampleRefs: e.sampleRefs, endReason: e.endReason, group: e.foreground.group, kind: e.foreground.kind, guards: e.guards });
const expShape = (e) => ({ startS: e.startS, endS: e.endS, durationMs: e.durationMs, worstLatencyMs: e.worstLatencyMs, samples: e.samples, sampleRefs: e.sampleRefs, endReason: e.endReason, group: e.foreground.group, kind: e.foreground.kind, guards: e.builderGuards });

for (const name of ['basic-3-episodes', 'blip-only', 'suspend-resume', 'secure-desktop', 'elevated-foreground', 'remote-session', 'helper-late', 'out-of-scope-episodes', 'foreground-changed', 'chronic-slow-app']) {
  test(`episodes: fixture ${name} matches its expected file`, () => {
    const { p, r } = build(name);
    assert.deepStrictEqual(r.episodes.map(shape), p.expected.episodes.map(expShape));
    assert.strictEqual(r.blips, p.expected.blips);
    if (p.expected.droppedInSpan !== undefined) assert.strictEqual(r.droppedInSpan, p.expected.droppedInSpan);
    if (p.expected.helperLateSamples !== undefined) assert.strictEqual(r.helperLateSamples, p.expected.helperLateSamples);
  });
}

test('episodes: adjacent samples merge, the sample 1.9 s later is a blip (spec 10.0 / 10.3 / 10.6 / 12.5 s)', () => {
  const s = [{ at: '2026-02-01T09:00:10.000Z', latencyMs: 400 }, { at: '2026-02-01T09:00:10.300Z', latencyMs: 700 }, { at: '2026-02-01T09:00:10.600Z', latencyMs: 1200 }, { at: '2026-02-01T09:00:12.500Z', latencyMs: 300 }];
  const r = buildEpisodes({ samples: s, spans: [], settings: SETTINGS });
  assert.strictEqual(r.episodes.length, 1);
  assert.strictEqual(r.episodes[0].startMs, at(10));
  assert.strictEqual(r.episodes[0].worstLatencyMs, 1200);
  assert.strictEqual(r.episodes[0].samples, 3);
  assert.strictEqual(r.blips, 1);
});

test('episodes: a lone mild sample is a blip; a lone sample at twice the threshold is an episode', () => {
  const mild = buildEpisodes({ samples: [{ at: '2026-02-01T09:00:10.000Z', latencyMs: 300 }], spans: [], settings: SETTINGS });
  assert.deepStrictEqual([mild.episodes.length, mild.blips], [0, 1]);
  const sev = buildEpisodes({ samples: [{ at: '2026-02-01T09:00:10.000Z', latencyMs: 600 }], spans: [], settings: SETTINGS });
  assert.deepStrictEqual([sev.episodes.length, sev.episodes[0].samples], [1, 1]);
});

test('episodes: back-to-back timeouts one second apart merge into one episode (unanswered)', () => {
  const s = [0, 1.0, 2.0, 3.0].map((o) => ({ at: new Date(at(20 + o)).toISOString(), latencyMs: 1000, timeout: true }));
  const r = buildEpisodes({ samples: s, spans: [], settings: SETTINGS });
  assert.strictEqual(r.episodes.length, 1);
  assert.strictEqual(r.episodes[0].timeouts, 4);
  assert.strictEqual(r.episodes[0].endReason, 'unanswered');
});

test('episodes: an episode open at run end is closed with end reason run-end', () => {
  const s = [{ at: '2026-02-01T09:00:58.500Z', latencyMs: 400 }, { at: '2026-02-01T09:00:58.900Z', latencyMs: 700 }];
  const r = buildEpisodes({ samples: s, spans: [], settings: SETTINGS, runEndMs: at(60) });
  assert.strictEqual(r.episodes[0].endReason, 'run-end');
});

test('episodes: an episode cut by a lock ends at the lock time and no stall time is added inside the span', () => {
  const s = [{ at: '2026-02-01T09:00:10.000Z', latencyMs: 500 }, { at: '2026-02-01T09:00:10.400Z', latencyMs: 900 }, { at: '2026-02-01T09:00:15.000Z', latencyMs: 900 }];
  const r = buildEpisodes({ samples: s, spans: [{ from: '2026-02-01T09:00:10.800Z', to: '2026-02-01T09:00:20.000Z', reason: 'locked' }], settings: SETTINGS });
  assert.strictEqual(r.episodes.length, 1);
  assert.strictEqual(r.episodes[0].endMs, at(10.8));
  assert.strictEqual(r.episodes[0].endReason, 'not-evaluable:locked');
  assert.strictEqual(r.droppedInSpan, 1);
});

test('episodes: an ignored in-scope group creates no episode and is counted', () => {
  const s = [0, 0.3].map((o) => ({ at: new Date(at(5 + o)).toISOString(), latencyMs: 500, fg: { kind: 'in-scope', group: 'slowtool' } }));
  const r = buildEpisodes({ samples: s, spans: [], settings: { ...SETTINGS, ignoreGroups: ['slowtool'] } });
  assert.strictEqual(r.episodes.length, 0);
  assert.deepStrictEqual(r.ignored, { slowtool: 2 });
});

test('episodes: samples in different foreground groups never merge', () => {
  const s = [{ at: new Date(at(5)).toISOString(), latencyMs: 500, fg: { kind: 'in-scope', group: 'a' } }, { at: new Date(at(5.3)).toISOString(), latencyMs: 500, fg: { kind: 'in-scope', group: 'b' } }];
  const r = buildEpisodes({ samples: s, spans: [], settings: SETTINGS });
  assert.strictEqual(r.episodes.length, 2);
});

// ---- 4.2 evaluable seconds ----
for (const name of ['basic-3-episodes', 'idle-after-typing', 'suspend-resume', 'remote-session', 'elevated-foreground', 'secure-desktop', 'blip-only']) {
  test(`evaluable: ${name} totals match the fixture and add up to the observed time`, () => {
    const p = parts(name);
    const ev = evaluable({ windows: p.windows, spans: p.spans });
    const x = p.expected.evaluable;
    assert.deepStrictEqual({ observedMs: ev.observedMs, evaluatedMs: ev.evaluatedMs, idleMs: ev.idleMs, notEvaluableMs: ev.notEvaluableMs }, x);
    assert.ok(Math.abs(ev.evaluatedMs + ev.idleMs + ev.notEvaluableMs - ev.observedMs) <= 250, 'total within one tick');
  });
}

test('evaluable: idle-after-typing has no stall sample, no liveness measurement while idle, and idle is not counted as evaluated calm', () => {
  const p = parts('idle-after-typing');
  assert.strictEqual(p.samples.length, 0);
  const { episodes } = buildEpisodes({ samples: p.samples, spans: p.spans, settings: SETTINGS });
  assert.strictEqual(episodes.length, 0);
  const ev = evaluable({ windows: p.windows, spans: p.spans });
  assert.strictEqual(ev.idleMs, 20000);
  assert.strictEqual(ev.evaluatedMs, 10000);
  assert.strictEqual(ev.measured, p.expected.measuredTotal, 'measurements come only from the input-recent window');
});

test('evaluable: not-evaluable spans are listed with their reason and duration', () => {
  const p = parts('suspend-resume');
  const ev = evaluable({ windows: p.windows, spans: p.spans });
  assert.deepStrictEqual(ev.notEvaluable.map((s) => ({ reason: s.reason, durationMs: s.durationMs })), p.expected.notEvaluable);
});
