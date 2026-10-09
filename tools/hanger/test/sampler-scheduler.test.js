'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createContinuous, createHeavyRunner, resolveDuration } = require('../lib/sampler/scheduler');
const { createFailureLog } = require('../lib/sampler/failures');
const { runHangTrigger } = require('../lib/sampler/hang-trigger');
const persist = require('../lib/persist');
const { buildCSample } = require('../lib/sampler/records');
const { validateFile } = require('./helpers/validate-report');
const v8 = require('v8');
v8.setFlagsFromString('--expose-gc');
const forceGc = require('vm').runInNewContext('gc');

const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const at = (s) => T0 + Math.round(s * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('3.1 achieved cadence is recorded: median 2.0 s, p95 6.0 s, n=5', () => {
  const c = createContinuous({ nominalS: 2 });
  let t = 0;
  c.onSample(at(t));
  for (const d of [2.0, 2.1, 1.9, 6.0, 2.0]) { t += d; c.onSample(at(t)); }
  const cad = c.cadence();
  assert.strictEqual(cad.nominalS, 2);
  assert.strictEqual(cad.achievedMedianS, 2.0);
  assert.strictEqual(cad.achievedP95S, 6.0);
  assert.strictEqual(cad.n, 5);
});

test('3.2 a 7 s gap becomes one unobserved interval and no sample sits inside it', () => {
  const stream = [];
  const c = createContinuous({ nominalS: 2, sink: { append: (t, r) => stream.push({ t, r }) } });
  for (const s of [0, 2, 4, 6, 8, 10, 17, 19]) c.onSample(at(s), {});
  assert.strictEqual(c.unobserved.length, 1);
  const g = c.unobserved[0];
  assert.strictEqual(g.start, new Date(at(10)).toISOString());
  assert.strictEqual(g.end, new Date(at(17)).toISOString());
  assert.strictEqual(g.durationS, 7);
  assert.ok(g.reason.length > 0);
  assert.strictEqual(stream.filter((x) => x.t === 'gap').length, 1);
  assert.ok(c.rolling.every((x) => !(x.atMs > at(10) && x.atMs < at(17))), 'no synthesized sample inside the gap');
  assert.strictEqual(c.unobservedS(), 7);
});

test('3.2 a 3.9 s gap at a 2 s nominal is jitter, not a gap', () => {
  const c = createContinuous({ nominalS: 2 });
  c.onSample(at(0)); c.onSample(at(3.9)); c.onSample(at(5.9));
  assert.strictEqual(c.unobserved.length, 0);
});

test('3.2 a session restart gives its reason to the next gap; a trailing silence is closed at run end', () => {
  const c = createContinuous({ nominalS: 2 });
  c.onSample(at(0)); c.noteGapReason('session-restart'); c.onSample(at(9));
  assert.strictEqual(c.unobserved[0].reason, 'session-restart');
  c.finish(at(30));
  assert.strictEqual(c.unobserved.length, 2);
  assert.strictEqual(c.unobserved[1].durationS, 21);
});

test('3.3 over-budget heavy work is recorded (collector, trigger, elapsed, budget, reason) and continuous samples keep cadence', async () => {
  const records = [];
  const failures = createFailureLog();
  const runner = createHeavyRunner({ onRecord: (r) => records.push(r), onFailure: (f) => failures.fail(f.inference, f.collector, f.mode, f.reason, { at: f.at }) });
  const cont = createContinuous({ nominalS: 0.05 }); // scaled: 50 ms stands for 2 s
  const stamps = [];
  const feeder = setInterval(() => { const n = Date.now(); stamps.push(n); cont.onSample(n); }, 50);
  const res = await runner.run({ id: 'fakeHeavy', trigger: 'hang', budgetMs: 200, fn: () => sleep(500).then(() => 'late') });
  assert.strictEqual(res.outcome, 'over-budget');
  await runner.whenSettled();
  clearInterval(feeder);
  const r = records.find((x) => x.collector === 'fakeHeavy');
  assert.ok(r, 'a heavyRuns record exists');
  assert.strictEqual(r.trigger, 'hang');
  assert.strictEqual(r.budgetMs, 200);
  assert.ok(r.elapsedMs >= 450 && r.elapsedMs < 900, `elapsed ${r.elapsedMs}`);
  assert.strictEqual(r.outcome, 'over-budget');
  assert.strictEqual(r.reason, 'over-budget');
  assert.ok(failures.list.some((f) => f.mode === 'over-budget' && f.collector === 'fakeHeavy'));
  // the continuous feed was never delayed by the heavy work: no gap, intervals near nominal
  assert.strictEqual(cont.unobserved.length, 0);
  assert.ok(cont.cadence().achievedP95S < 0.2, `p95 ${cont.cadence().achievedP95S}`);
});

test('3.3 a collector that kills its child at budget settles right after the budget and keeps its partial output', async () => {
  const runner = createHeavyRunner();
  const res = await runner.run({ id: 'partialC', trigger: 'hang', budgetMs: 100, fn: (ctx) => new Promise((resolve) => {
    ctx.setPartial('row1\nrow2');
    ctx.abort(() => resolve('killed'));
  }) });
  assert.strictEqual(res.outcome, 'over-budget');
  assert.strictEqual(res.value, 'row1\nrow2');
  await runner.whenSettled();
  const rec = runner.records.find((x) => x.collector === 'partialC');
  assert.strictEqual(rec.partial, true);
});

test('3.3 heavy collectors do not run per tick: min-interval skips are recorded with their reason', async () => {
  const runner = createHeavyRunner();
  let calls = 0;
  const run = () => runner.run({ id: 'sched', trigger: 'schedule', budgetMs: 100, minIntervalS: 60, fn: async () => { calls++; return 1; } });
  const a = await run(), b = await run();
  assert.strictEqual(a.outcome, 'ok');
  assert.strictEqual(b.outcome, 'skipped');
  assert.match(b.reason, /min-interval/);
  assert.strictEqual(calls, 1);
});

test('3.3 overlapping hangs coalesce onto one in-flight run', async () => {
  const runner = createHeavyRunner();
  let calls = 0;
  const fn = () => new Promise((r) => { calls++; setTimeout(() => r('rows'), 80); });
  const [x, y] = await Promise.all([
    runner.run({ id: 'enum', trigger: 'hang', budgetMs: 500, coalesce: true, fn }),
    runner.run({ id: 'enum', trigger: 'hang', budgetMs: 500, coalesce: true, fn }),
  ]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(x.value, 'rows'); assert.strictEqual(y.value, 'rows'); assert.strictEqual(y.coalesced, true);
});

test('3.4 the melting gate is gone and the on-hang snapshot is attempted after a 3 s heavy run', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'hanger.js'), 'utf8');
  assert.ok(!/melting|MELT\b|function gate\(/.test(src), 'no melting gate remains in hanger.js');
  const runner = createHeavyRunner();
  // an earlier collection took "3 s" (scaled): it must not suppress the next hang's snapshot
  await runner.run({ id: 'earlier', trigger: 'schedule', budgetMs: 10, fn: () => sleep(30) });
  let snapshotCalled = false;
  const out = await runHangTrigger({ runner, steps: { procEnum: { id: 'tasklistSnap', budgetMs: 500, fn: async () => { snapshotCalled = true; return { rows: [{ name: 'a.exe' }] }; } } } });
  assert.strictEqual(snapshotCalled, true);
  assert.strictEqual(out.procEnum.outcome, 'ok');
});

test('3.5 one failure shape with a time on every path; parse failures are recorded once per field', () => {
  const log = createFailureLog({ now: () => new Date(T0) });
  log.fail('mem.committed_pct', 'counterBundle', 'timeout', 'no reply', { at: new Date(at(14)).toISOString() });
  log.fail('mem.committed_pct', 'counterBundle', 'parse', 'bad', { field: 'committed' });
  log.fail('mem.committed_pct', 'counterBundle', 'parse', 'bad again', { field: 'committed' });
  assert.strictEqual(log.list.length, 2);
  assert.deepStrictEqual(Object.keys(log.list[0]).sort(), ['at', 'collector', 'inference', 'mode', 'reason']);
  assert.strictEqual(log.list[0].at, '2026-10-07T10:00:14.000Z');
  assert.strictEqual(log.list[0].mode, 'timeout');
});

test('3.5 every collector failing still yields a valid report and exit 0', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-failall-'));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hanger.js'), 'trace', '--duration', '10', '--anonymize', '--out', d], { encoding: 'utf8', timeout: 180000, env: { ...process.env, HANGER_TEST_FAIL_ALL: '1' }, cwd: d });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout.slice(-400));
  const reports = fs.readdirSync(d).filter((f) => /^hanger-.*\.json$/.test(f));
  assert.strictEqual(reports.length, 1);
  const v = validateFile(path.join(d, reports[0]));
  assert.ok(v.ok, v.problems && v.problems.join('; '));
  const rep = JSON.parse(fs.readFileSync(path.join(d, reports[0]), 'utf8'));
  const failures = rep['collection.failures'];
  assert.ok(failures.length >= 2);
  for (const f of failures) assert.ok(f.at && f.inference && f.collector && f.mode && f.reason, JSON.stringify(f));
  for (const c of ['counterBundle', 'spawnProbe']) assert.ok(failures.some((f) => f.collector === c), `a failure for ${c}`);
});

test('5.1 durations above 300 s are honored; above 8 h they are clamped with a recorded reason', () => {
  const ok = resolveDuration({ requestedS: 900, source: 'flag' });
  assert.deepStrictEqual([ok.requestedS, ok.usedS, ok.source, ok.clampReason], [900, 900, 'flag', null]);
  const big = resolveDuration({ requestedS: 36000, source: 'flag' });
  assert.deepStrictEqual([big.requestedS, big.usedS, big.clampReason], [36000, 28800, 'maximum 8 h']);
  const { buildSettings, clampLines } = require('../lib/settings');
  const s = buildSettings({ argv: ['trace', '--duration', '36000'], cfg: {}, anonymize: false });
  assert.strictEqual(s.duration.value, 28800);
  assert.strictEqual(s.duration.requested, 36000);
  assert.strictEqual(s.duration.clamped.reason, 'maximum 8 h');
  assert.ok(clampLines(s).some((l) => /36000/.test(l) && /28800/.test(l) && /maximum 8 h/.test(l)));
  assert.strictEqual(buildSettings({ argv: ['trace', '--duration', '900'], cfg: {}, anonymize: false }).duration.value, 900);
});

test('5.2 a 2 h fake-clock run keeps memory bounded and persists 3600 +- 1 continuous samples', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-long-'));
  const file = path.join(d, 'long.jsonl');
  const stream = persist.openStream(file);
  const cont = createContinuous({ nominalS: 2, sink: stream.append ? { append: (t, r) => stream.append(t, r) } : null });
  const values = { committed: 70.123, pages: 12.34, availMB: 4096.4, cpuQ: 1, diskQ: 0, diskSec: 0.0042 };
  const heapAt = {};
  for (let i = 0; i < 3600; i++) {
    const ms = at(i * 2);
    cont.onSample(ms);
    stream.append('csample', buildCSample({ atMs: ms, values, power: { line: 'Online', pct: '100' }, seq: i + 1, runStartMs: T0 }));
    if (i === 300 || i === 3599) { forceGc(); heapAt[i] = process.memoryUsage().heapUsed; }
  }
  stream.close();
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('"type":"csample"'));
  assert.ok(Math.abs(lines.length - 3600) <= 1, `csamples ${lines.length}`);
  assert.ok(cont.rolling.length <= 70, `rolling window holds ${cont.rolling.length} samples (120 s)`);
  assert.strictEqual(cont.cadence().n, 3599);
  // heap growth between 10 min (sample 300) and 2 h (sample 3599) stays within 20 MB (retained state only: deltas + rolling window)
  const growthMB = (heapAt[3599] - heapAt[300]) / 1048576;
  assert.ok(growthMB < 20, `heap grew ${growthMB.toFixed(1)} MB`);
});
