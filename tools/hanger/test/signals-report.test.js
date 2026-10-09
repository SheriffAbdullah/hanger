'use strict';
// data-signals-completeness: the new series land in the report built from a run stream, survive an interrupted run, and
// the report stays valid with no EcoQoS keys and no out-of-scope name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const persist = require('../lib/persist');
const scope = require('../lib/scope');
const signals = require('../lib/collectors');
const { buildCoreReport } = require('../lib/core-report');
const { buildCSample } = require('../lib/sampler/records');
const { validateText } = require('./helpers/validate-report');
const { parseBundleLines } = require('../lib/sampler/bundle');

const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'collectors', 'signals-laptop.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const T0 = Date.parse('2026-10-07T10:00:00.000Z');

function stream(file, { acFlips = true } = {}) {
  const s = persist.openStream(file);
  const resolver = scope.createResolver(scope.createMatcher([{ name: 'postgres' }]), { open: false });
  const sig = signals.createSignals({ resolver, logicalCpus: 12, fail: () => {} });
  s.append('run-start', { at: new Date(T0).toISOString(), runStartMs: T0, tool: 'hanger test', nominalS: 20, intervalMs: 1000, continuousNominalS: 2, settings: {}, thresholds: { hang: 800, recovery: 400, ramHigh: 85 }, logicalCpus: 12 });
  for (let i = 0; i < 6; i++) {
    const atMs = T0 + i * 2000;
    const at = new Date(atMs).toISOString();
    const power = { line: acFlips && i >= 3 ? 'Offline' : 'Online', pct: '90', flag: '9', overlay: 'ded574b5-45a0-4f42-8737-46345c09c238', saver: '0' };
    const r = sig.build({ lines: FIX, power, atIso: at, windowS: 2 });
    const parsed = parseBundleLines(FIX);
    const cs = Object.assign(buildCSample({ atMs, values: parsed.values, power, seq: i + 1, windowS: 2, runStartMs: T0 }), r.fields);
    s.append('csample', cs);
    if (r.transition) s.append('power-transition', r.transition);
    s.append('sample', { at, tSec: i * 2, usedPct: { v: 60, unit: '%', windowS: 0, n: 1, src: 't', at, prec: 0.1 }, freeGB: { v: 6, unit: 'GB', windowS: 0, n: 1, src: 't', at, prec: 0.01 } });
    s.append('probe', { at, tSec: i * 2, hang: false, ms: { v: 150, unit: 'ms', windowS: 0.15, n: 1, src: 't', at, prec: 1 }, bundleAt: at, degraded: [] });
  }
  s.append('signals', sig.summary());
  s.close();
  return sig;
}

test('the report carries the new series on every probe row, the run-level facts, and no EcoQoS keys', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sig-'));
  const f = path.join(d, 'hanger-2026-10-07T10-00-00.jsonl');
  stream(f);
  const rec = persist.recover(f);
  const rep = buildCoreReport({ ...rec, observer: null }, { status: 'complete', streamName: rec.streamName });
  const text = JSON.stringify(rep);
  const v = validateText(text);
  assert.ok(v.ok, v.problems.join('; '));
  for (const row of rep.spawnProbes) for (const k of ['cpu', 'mem', 'disk', 'sys', 'net', 'gpu', 'procs', 'thermal', 'power']) assert.ok(row[k], `${k} on the probe row`);
  assert.strictEqual(rep.machine.logicalCpus, 12);
  assert.strictEqual(rep.power.transitions.length, 1);
  assert.strictEqual(rep.power.transitions[0].from, 'ac');
  assert.strictEqual(rep.power.transitions[0].to, 'battery');
  assert.ok(rep['collection.notCollected'].some((n) => /ecoQoS/i.test(n.datum)));
  assert.strictEqual(rep.procsSummary.groups[0].group, 'postgres');
  assert.strictEqual(rep.signals.logicalCpus, 12);
  assert.ok(!/"ecoQoS"|"ecoDeferred"|"ecoMs"/.test(text));
  assert.ok(!text.toLowerCase().includes('zzcanary'), 'out-of-scope name is in no stored field');
});

test('an unfinished stream (no signals record) still recovers its power transitions and falls back to the not-collected list', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sig-'));
  const f = path.join(d, 'hanger-2026-10-07T10-00-00.jsonl');
  stream(f);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && !l.startsWith('{"type":"signals"'));
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const rec = persist.recover(f);
  const rep = buildCoreReport({ ...rec, observer: null }, { status: 'unfinished', streamName: rec.streamName });
  assert.strictEqual(rep.signals, null);
  assert.strictEqual(rep.power.transitions.length, 1);
  assert.ok(rep['collection.notCollected'].length >= 1);
  assert.ok(validateText(JSON.stringify(rep)).ok);
});

test('every stored per-process value is within 0-100 for CPU and the sample stays small', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sig-'));
  const f = path.join(d, 'hanger-2026-10-07T10-00-00.jsonl');
  stream(f);
  const rec = persist.recover(f);
  for (const c of rec.csamples) {
    for (const r of [...c.procs.groups, ...c.procs.system, c.procs.outOfScope]) assert.ok(r.cpuPctMachine === null || (r.cpuPctMachine >= 0 && r.cpuPctMachine <= 100));
    assert.ok(JSON.stringify(c).length < 20000, 'a scoped sample is well under 20 KB');
  }
});
