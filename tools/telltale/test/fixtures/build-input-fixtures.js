#!/usr/bin/env node
'use strict';
// Deterministic fixtures for the input-response stall detector: helper files (JSONL) with their expected results.
// node tools/telltale/test/fixtures/build-input-fixtures.js  -> test/fixtures/input-stall/<name>.input.jsonl + .expected.json
// Every time is the fixed base T0 plus an offset in seconds; nothing here reads the clock or a random source.
const fs = require('fs');
const path = require('path');

const T0 = Date.parse('2026-02-01T09:00:00.000Z');
const iso = (s) => new Date(T0 + Math.round(s * 1000)).toISOString();
const SET = { stallMs: 250, recentInputMs: 1000, mergeGapMs: 1000, lateMs: 200, tickMs: 250, timeoutMs: 1000 };
const OUT = path.join(__dirname, 'input-stall');

const start = () => ({ type: 'input-helper', v: 1, at: iso(0), build: 'compiled', settings: { ...SET } });
const end = (s) => ({ type: 'input-end', at: iso(s), status: 'orderly' });
// one 10 s window; defaults describe 10 s of typing with calm answers
function win(i, o = {}) {
  return {
    type: 'input-window', from: iso(i * 10), to: iso(i * 10 + 10), durMs: 10000, evalMs: 10000, idleMs: 0, skipMs: 0, measured: 40, stalls: 0, fgChanged: 0,
    groups: { code: { n: 40, over: 0 } }, active: [[0, 10000]], latMedianMs: 3, latP95Ms: 12, latMaxMs: 30, lateN: 40, lateMedianMs: 2, lateP95Ms: 5, lateMaxMs: 8, ...o,
  };
}
const idleWin = (i, o = {}) => win(i, { evalMs: 0, idleMs: 10000, measured: 0, groups: {}, active: [], latMedianMs: null, latP95Ms: null, latMaxMs: null, ...o });
const skipWin = (i, o = {}) => win(i, { evalMs: 0, idleMs: 0, skipMs: 10000, measured: 0, groups: {}, active: [], latMedianMs: null, latP95Ms: null, latMaxMs: null, ...o });
const sample = (s, lat, o = {}) => ({ type: 'input-stall-sample', at: iso(s), latencyMs: lat, timeout: false, fg: { kind: 'in-scope', group: 'code' }, helperLate: false, ...o });
const skip = (a, b, reason) => ({ type: 'input-skip', from: iso(a), to: iso(b), reason });
const bridge = (name) => ({ status: 'running', reason: null, build: 'compiled', file: `${name}.input.jsonl`, at: iso(0) });
const ep = (startS, endS, worst, samples, refs, o = {}) => ({ startS, endS, durationMs: Math.round((endS - startS) * 1000), worstLatencyMs: worst, samples, sampleRefs: refs, endReason: 'answered', foreground: { kind: 'in-scope', group: 'code' }, guards: [], builderGuards: [], ...o });
const windows = (n, f = (i) => win(i)) => Array.from({ length: n }, (_, i) => f(i));
const hang = (ref, atS, ms, osConfirmed = false) => ({ ref, atS, ms, osConfirmed });

function build() {
  const F = {};

  // 3 episodes, 2 overlapping spawn-probe hangs, 1 not; 1 OS-confirmed
  F['basic-3-episodes'] = {
    records: [start(), ...windows(6, (i) => (i === 1 ? win(1, { stalls: 3, groups: { code: { n: 40, over: 3 } }, latMaxMs: 1200 }) : i === 3 ? win(3, { stalls: 1, groups: { code: { n: 40, over: 1 } }, latMaxMs: 900 }) : i === 4 ? win(4, { stalls: 2, groups: { code: { n: 40, over: 2 } }, latMaxMs: 600 }) : win(i))),
      sample(12.0, 400), sample(12.3, 700), sample(12.6, 1200), sample(30.0, 900), sample(45.0, 600), sample(45.6, 300), end(60)],
    expected: {
      runEndS: 60, episodes: [ep(12, 13.8, 1200, 3, [0, 1, 2]), ep(30, 30.9, 900, 1, [3]), ep(45, 45.9, 600, 2, [4, 5])], blips: 0,
      evaluable: { observedMs: 60000, evaluatedMs: 60000, idleMs: 0, notEvaluableMs: 0 },
      hangs: [hang('spawnProbes[3]', 13.5, 1000, true), hang('spawnProbes[8]', 31.0, 900), hang('spawnProbes[20]', 55, 900)], probeIntervalS: 2,
      corroboration: [['probe-hang', 'os-not-responding'], ['probe-hang'], []],
      agreement: { precision: { num: 2, den: 3 }, recall: { num: 2, den: 3 }, probeHangsWithoutStall: ['spawnProbes[20]'], stallsWithoutProbeHang: ['inputStall.episodes[2]'] },
    },
    bridge: true,
  };

  F['calm-5min'] = {
    records: [start(), ...windows(30, (i) => win(i, { latMedianMs: 3, latP95Ms: 12, latMaxMs: 30 })), end(300)],
    expected: { runEndS: 300, episodes: [], blips: 0, evaluable: { observedMs: 300000, evaluatedMs: 300000, idleMs: 0, notEvaluableMs: 0 }, baseline: { n: 1200, medianMs: 3, p95Ms: 12, maxMs: 30, overThresholdPct: 0, noisy: false } },
    bridge: true,
  };

  F['idle-after-typing'] = {
    records: [start(), win(0), idleWin(1), idleWin(2), end(30)],
    expected: { runEndS: 30, episodes: [], blips: 0, evaluable: { observedMs: 30000, evaluatedMs: 10000, idleMs: 20000, notEvaluableMs: 0 }, measuredTotal: 40 },
  };

  // one group over the threshold on 32 of 40 measurements
  F['chronic-slow-app'] = {
    records: [start(), ...windows(4, (i) => win(i, { stalls: 4, groups: { slowtool: { n: 10, over: 8 } }, latMaxMs: 700 })),
      sample(5.0, 400, { fg: { kind: 'in-scope', group: 'slowtool' } }), sample(5.4, 500, { fg: { kind: 'in-scope', group: 'slowtool' } }),
      sample(25.0, 600, { fg: { kind: 'in-scope', group: 'slowtool' } }), sample(25.4, 450, { fg: { kind: 'in-scope', group: 'slowtool' } }), end(40)],
    expected: {
      runEndS: 40, episodes: [ep(5, 5.9, 500, 2, [0, 1], { foreground: { kind: 'in-scope', group: 'slowtool' }, guards: ['chronic-slow-app'] }), ep(25, 25.85, 600, 2, [2, 3], { foreground: { kind: 'in-scope', group: 'slowtool' }, guards: ['chronic-slow-app'] })],
      blips: 0, chronic: [{ group: 'slowtool', n: 40, over: 32 }],
    },
  };

  F['noisy-baseline'] = {
    records: [start(), ...windows(6, (i) => win(i, { latMedianMs: 30, latP95Ms: 180, latMaxMs: 210 })), end(60)],
    expected: { runEndS: 60, episodes: [], blips: 0, baseline: { n: 240, p95Ms: 180, noisy: true, limitMs: 125 } },
  };

  // the machine sleeps with an episode open; one spurious sample inside the sleep is dropped
  F['suspend-resume'] = {
    records: [start(), win(0), win(1, { evalMs: 9000, skipMs: 1000, measured: 36 }), skipWin(2), skipWin(3), win(4, { evalMs: 0, idleMs: 5000, skipMs: 5000, measured: 0, active: [], groups: {} }),
      sample(18.0, 600), sample(18.4, 700), sample(21.0, 800), skip(19.0, 45.0, 'suspend-resume'), end(50)],
    expected: {
      runEndS: 50, episodes: [ep(18, 19.0, 700, 2, [0, 1], { endReason: 'not-evaluable:suspend-resume' })], blips: 0, droppedInSpan: 1,
      notEvaluable: [{ reason: 'suspend-resume', durationMs: 26000 }], evaluable: { observedMs: 50000, evaluatedMs: 19000, idleMs: 5000, notEvaluableMs: 26000 },
    },
  };

  F['remote-session'] = {
    records: [start(), ...windows(3, (i) => skipWin(i)), skip(0, 30, 'remote-session'), end(30)],
    expected: { runEndS: 30, episodes: [], blips: 0, notEvaluable: [{ reason: 'remote-session', durationMs: 30000 }], evaluable: { observedMs: 30000, evaluatedMs: 0, idleMs: 0, notEvaluableMs: 30000 } },
  };

  F['elevated-foreground'] = {
    records: [start(), win(0), win(1, { evalMs: 4000, skipMs: 6000, measured: 16 }), win(2), sample(14.0, 800), skip(12, 18, 'elevated-foreground'), end(30)],
    expected: { runEndS: 30, episodes: [], blips: 0, droppedInSpan: 1, notEvaluable: [{ reason: 'elevated-foreground', durationMs: 6000 }], evaluable: { observedMs: 30000, evaluatedMs: 24000, idleMs: 0, notEvaluableMs: 6000 } },
  };

  F['secure-desktop'] = {
    records: [start(), win(0, { evalMs: 6000, skipMs: 4000, measured: 24 }), win(1), skip(4, 8, 'secure-desktop'), end(20)],
    expected: { runEndS: 20, episodes: [], blips: 0, notEvaluable: [{ reason: 'secure-desktop', durationMs: 4000 }], evaluable: { observedMs: 20000, evaluatedMs: 16000, idleMs: 0, notEvaluableMs: 4000 } },
  };

  // a 1100 ms late wake (850 ms late) overlaps an episode; a lone late-tagged sample forms nothing
  F['helper-late'] = {
    records: [start(), ...windows(6, (i) => (i === 3 ? win(3, { lateMaxMs: 850, lateP95Ms: 850, stalls: 3, groups: { code: { n: 40, over: 3 } } }) : win(i))),
      sample(30.0, 400), sample(30.3, 700), sample(30.6, 500, { helperLate: true }), sample(50.0, 900, { helperLate: true }),
      { type: 'input-late', startAt: iso(29.9), endAt: iso(30.75), maxMs: 850, n: 1 }, end(60)],
    expected: {
      runEndS: 60, episodes: [ep(30, 31.1, 700, 3, [0, 1, 2], { guards: ['helper-late'], builderGuards: ['helper-late'] })], blips: 0, helperLateSamples: 1,
      latePeriods: [{ startS: 29.9, endS: 30.75, maxMs: 850 }],
    },
  };

  F['foreground-changed'] = {
    records: [start(), win(0), win(1, { fgChanged: 3, stalls: 2, groups: { code: { n: 37, over: 2 } }, measured: 37 }), win(2), sample(15.0, 500), sample(15.5, 400), end(30)],
    expected: { runEndS: 30, episodes: [ep(15, 15.9, 500, 2, [0, 1], { guards: ['foreground-changed-near'] })], blips: 0, foregroundChangedDropped: 3 },
  };

  // foreground application out of scope: recorded anonymously (no name anywhere)
  const oos = { kind: 'out-of-scope', group: null };
  F['out-of-scope-episodes'] = {
    records: [start(), ...windows(4, (i) => win(i, { groups: { 'out-of-scope': { n: 40, over: i === 1 || i === 2 ? 2 : 0 } }, stalls: i === 1 || i === 2 ? 2 : 0 })),
      sample(10.0, 500, { fg: oos }), sample(25.0, 400, { fg: oos }), sample(25.3, 600, { fg: oos }), end(40)],
    expected: {
      runEndS: 40, episodes: [ep(10, 10.5, 500, 1, [0], { foreground: oos }), ep(25, 25.9, 600, 2, [1, 2], { foreground: oos })], blips: 0, outOfScope: { episodes: 2, totalMs: 1400 },
      hangs: [hang('spawnProbes[5]', 10.5, 900)], probeIntervalS: 2,
    },
    bridge: true,
  };

  F['helper-unavailable'] = {
    records: null,
    expected: { episodes: null, status: 'unavailable', reason: 'helper blocked by policy' },
    bridgeRecord: { status: 'unavailable', reason: 'helper blocked by policy', build: null, file: null, at: iso(0) },
  };

  // the last line is cut off mid-write
  F['torn-last-line'] = {
    records: [start(), win(0), win(1, { stalls: 2, groups: { code: { n: 40, over: 2 } } }), sample(12.0, 400), sample(12.3, 700)],
    tail: '{"type":"input-window","from":"2026-02-01T09:00:20.000Z","to":"2026-02-01T09:00:3',
    expected: { runEndS: 40, episodes: [ep(12, 13.0, 700, 2, [0, 1])], blips: 0, badLines: 1 },
    bridge: true,
  };

  F['blip-only'] = {
    records: [start(), ...windows(5, (i) => (i === 1 || i === 4 ? win(i, { stalls: 1, groups: { code: { n: 40, over: 1 } }, latMaxMs: 350 }) : win(i))), sample(10.0, 300), sample(40.0, 350), end(50)],
    expected: { runEndS: 50, episodes: [], blips: 2, evaluable: { observedMs: 50000, evaluatedMs: 50000, idleMs: 0, notEvaluableMs: 0 } },
  };

  return F;
}

const lines = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';

function writeAll(dir = OUT) {
  fs.mkdirSync(dir, { recursive: true });
  const F = build();
  for (const [name, f] of Object.entries(F)) {
    if (f.records) {
      let text = lines(f.records);
      if (f.tail) text += f.tail; // no trailing newline: a torn write
      fs.writeFileSync(path.join(dir, `${name}.input.jsonl`), text);
    }
    fs.writeFileSync(path.join(dir, `${name}.expected.json`), JSON.stringify({ name, base: iso(0), ...f.expected }, null, 2) + '\n');
    if (f.records || f.bridgeRecord) fs.writeFileSync(path.join(dir, `${name}.stream-bridge.json`), JSON.stringify(f.bridgeRecord || bridge(name), null, 2) + '\n');
  }
  writeReportFixture(dir);
  return Object.keys(F);
}

// a full stored report built from the basic-3-episodes helper file: two of the three episodes overlap a probe hang (one is
// OS-confirmed), one probe hang has no stall. Deterministic: every time is derived from T0.
function writeReportFixture(dir) {
  const { mkReport, calm } = require('../helpers/diag-report');
  const { buildInputStall } = require('../../lib/input/report');
  const { attachDiagnosis } = require('../../lib/diagnosis/engine');
  const hangsAt = [{ t: 13.5, ms: 1000, os: true }, { t: 31.0, ms: 900 }, { t: 55, ms: 900 }];
  const probes = [{ t: 2, ms: 150 }, ...calm(12, 14.5, 1).filter((p) => p.t < 30), ...hangsAt.map((h) => ({ t: h.t, ms: h.ms, hang: true, ...(h.os ? { osConfirmed: true, osHungWindows: ['code'] } : {}) }))].sort((a, b) => a.t - b.t);
  const r = mkReport({ probes, durationS: 60 });
  const eff = { enabled: { value: true, source: 'default' }, ...Object.fromEntries(Object.entries(SET).map(([k, v]) => [k, { value: v, source: 'default' }])), ignoreGroups: { value: [], source: 'default' } };
  r.settings.inputStall = eff;
  const hangs = r.spawnProbes.map((p, i) => ({ ref: `spawnProbes[${i}]`, atMs: Date.parse(p.at), ms: p.ms, hang: !!p.hang, osConfirmed: p.osConfirmed === true })).filter((h) => h.hang);
  r.inputStall = buildInputStall({ settings: eff, bridge: bridge('basic-3-episodes'), file: path.join(dir, 'basic-3-episodes.input.jsonl'), hangs, marksMs: [], workloadTimeoutsMs: [], runEndMs: T0 + 60000, nowIso: iso(60) });
  attachDiagnosis(r, {});
  fs.writeFileSync(path.join(dir, 'basic-3-episodes.report.json'), JSON.stringify(r, null, 2) + String.fromCharCode(10));
}

if (require.main === module) console.log(`wrote ${writeAll().length} input-stall fixtures to ${OUT}`);
module.exports = { build, writeAll, T0, iso, SET, OUT };
