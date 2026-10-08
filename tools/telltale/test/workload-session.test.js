'use strict';
// workload-session-and-containers 2.x (phases), 3.x (markers), 7.x (report assembly)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPhases, phasesFromRecords, phaseSummary } = require('../lib/workload/phases');
const { createMarkerTracker } = require('../lib/workload/markers');
const { buildWorkloadReport, summaryLines } = require('../lib/workload/report');
const { createResolver, createMatcher } = require('../lib/scope');
const persist = require('../lib/persist');
const { buildCoreReport } = require('../lib/core-report');

const sinkTo = (arr) => ({ append: (type, r) => arr.push({ type, ...r }) });
const T0 = Date.parse('2026-10-07T10:00:00.000Z');

// ---------- 2.1 phases ----------
test('phase key opens then closes a labelled phase with wall-clock bounds and source "key"', () => {
  const recs = [];
  const ph = createPhases({ labels: ['loaded'], sink: sinkTo(recs) });
  ph.toggle(T0 + 5000);
  ph.toggle(T0 + 185000);
  const phases = phasesFromRecords(recs);
  assert.strictEqual(phases.length, 1);
  assert.deepStrictEqual(phases[0], { label: 'loaded', startAt: '2026-10-07T10:00:05.000Z', endAt: '2026-10-07T10:03:05.000Z', endStatus: 'closed', source: 'key' });
});

test('record sequence: start/end records are appended immediately, in order', () => {
  const recs = [];
  const ph = createPhases({ labels: ['idle', 'loaded'], sink: sinkTo(recs) });
  ph.toggle(T0 + 1000); ph.toggle(T0 + 2000); ph.toggle(T0 + 3000);
  assert.deepStrictEqual(recs.map((r) => `${r.action}:${r.label}`), ['start:idle', 'end:idle', 'start:loaded']);
  assert.ok(recs.every((r) => r.type === 'wl-phase' && r.source === 'key'));
});

test('a phase left open (run killed) is reported with end "unfinished"', () => {
  const recs = [];
  const ph = createPhases({ labels: ['loaded'], sink: sinkTo(recs) });
  ph.toggle(T0 + 1000);
  const phases = phasesFromRecords(recs);
  assert.strictEqual(phases[0].endAt, null);
  assert.strictEqual(phases[0].endStatus, 'unfinished');
});

test('--phase-now opens a flag phase at run start; the last label repeats; unlabeled phases get a number', () => {
  const recs = [];
  const ph = createPhases({ labels: ['loaded'], sink: sinkTo(recs) });
  ph.startAtRun(T0);
  assert.strictEqual(recs[0].source, 'flag');
  ph.toggle(T0 + 1000); // closes
  ph.toggle(T0 + 2000); // opens again: last label repeats
  assert.strictEqual(recs[recs.length - 1].label, 'loaded');
  const anon = createPhases({ sink: sinkTo([]) });
  assert.strictEqual(anon.toggle(T0).label, 'phase-1');
});

// ---------- 2.2 / 2.3 summary ----------
test('idle vs loaded: 30 and 45 samples give n=30/45 and untagged samples join neither side', () => {
  const phases = [
    { label: 'idle', startAt: new Date(T0).toISOString(), endAt: new Date(T0 + 60000).toISOString(), endStatus: 'closed', source: 'key' },
    { label: 'loaded', startAt: new Date(T0 + 70000).toISOString(), endAt: new Date(T0 + 160000).toISOString(), endStatus: 'closed', source: 'key' },
  ];
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push({ atMs: T0 + i * 2000, v: 40 });           // idle: 0..58 s
  for (let i = 0; i < 45; i++) pts.push({ atMs: T0 + 70000 + i * 2000, v: 80 });   // loaded: 70..158 s
  for (let i = 0; i < 5; i++) pts.push({ atMs: T0 + 61000 + i * 1500, v: 99 });    // between phases: untagged
  const gaps = [{ start: new Date(T0 + 10000).toISOString(), end: new Date(T0 + 16000).toISOString() }];
  const s = phaseSummary(phases, { committed: pts }, { gaps });
  assert.strictEqual(s.committed.idle.n, 30);
  assert.strictEqual(s.committed.loaded.n, 45);
  assert.strictEqual(s.committed.untaggedN, 5);
  assert.strictEqual(s.committed.idle.mean, 40);
  assert.strictEqual(s.committed.loaded.p95, 80);
  assert.strictEqual(s.committed.idle.unobservedS, 6);
  assert.strictEqual(s.committed.loaded.unobservedS, 0);
});

test('no phases: phaseSummary is null and the report says so', () => {
  assert.strictEqual(phaseSummary([], { x: [{ atMs: 1, v: 1 }] }), null);
  const { workload } = buildWorkloadReport({ wl: [], csamples: [], samples: [], probes: [] }, { declared: { phases: [], probes: [], config: [] } });
  assert.strictEqual(workload.phaseSummary, null);
  assert.strictEqual(workload.phasesNote, 'no workload phases were declared');
  assert.strictEqual(workload.probesNote, 'no workload probe declared');
});

// ---------- 3.1 markers ----------
const resolverFor = (names) => createResolver(createMatcher(names.map((name) => ({ name, includeDescendants: false }))), {});
test('in-scope process and container lifecycle become markers; out-of-scope never does (canary)', () => {
  const resolver = resolverFor(['postgres']);
  const recs = [];
  const tr = createMarkerTracker({ resolver, sink: sinkTo(recs), includeProcesses: true });
  const inScope = (c) => resolver.classifyName(c.name) === 'in';
  tr.observeProcesses([{ name: 'postgres.exe', pid: 10 }, { name: 'zzcanaryproc.exe', pid: 11 }], T0);          // baseline
  tr.observeProcesses([{ name: 'postgres.exe', pid: 10 }, { name: 'postgres.exe', pid: 12 }, { name: 'zzcanaryproc.exe', pid: 13 }], T0 + 60000);
  tr.observeProcesses([{ name: 'postgres.exe', pid: 12 }], T0 + 120000);
  tr.observeContainers([{ id: 'aaaaaaaaaaaaaaaa', name: 'postgres' }], inScope, T0);
  tr.observeContainers([{ id: 'aaaaaaaaaaaaaaaa', name: 'postgres' }, { id: 'bbbbbbbbbbbbbbbb', name: 'zzcanarybox' }], inScope, T0 + 10000);
  tr.observeContainers([{ id: 'bbbbbbbbbbbbbbbb', name: 'zzcanarybox' }], inScope, T0 + 20000);
  const kinds = tr.markers.map((m) => m.kind);
  assert.deepStrictEqual(kinds, ['process-start', 'process-exit', 'container-stop']);
  assert.ok(tr.markers.every((m) => m.at && m.name));
  const serialized = JSON.stringify(recs) + JSON.stringify(tr.markers);
  assert.ok(!/zzcanary/i.test(serialized), 'canary names appear nowhere');
});

test('open scope records container lifecycle but not process lifecycle', () => {
  const resolver = createResolver(createMatcher([]), { open: true });
  const tr = createMarkerTracker({ resolver, includeProcesses: false });
  tr.observeProcesses([{ name: 'a.exe', pid: 1 }], T0);
  assert.deepStrictEqual(tr.observeProcesses([{ name: 'b.exe', pid: 2 }], T0 + 1), []);
  tr.observeContainers([], () => true, T0);
  const m = tr.observeContainers([{ id: 'cccccccccccccccc', name: 'x' }], () => true, T0 + 1);
  assert.strictEqual(m[0].kind, 'container-start');
});

// ---------- 7.1 report assembly + stream round trip ----------
test('report assembles from stream records; an interrupted stream keeps the open phase', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-wl-'));
  const file = path.join(d, 'run.jsonl');
  const s = persist.openStream(file);
  s.append('run-start', { at: new Date(T0).toISOString(), runStartMs: T0, nominalS: 60, intervalMs: 1000, thresholds: { hang: 800, recovery: 400, ramHigh: 85 }, workloadDecl: { phases: ['idle', 'loaded'], probes: ['pg-select1'], config: ['postgres'] }, workloadScoped: true });
  s.append('wl-phase', { action: 'start', label: 'idle', at: new Date(T0 + 1000).toISOString(), source: 'key' });
  s.append('wl-phase', { action: 'end', label: 'idle', at: new Date(T0 + 5000).toISOString(), source: 'key' });
  s.append('wl-phase', { action: 'start', label: 'loaded', at: new Date(T0 + 6000).toISOString(), source: 'key' });
  s.append('wl-marker', { at: new Date(T0 + 7000).toISOString(), kind: 'container-start', name: 'pg', id: 'aaaaaaaaaaaa' });
  s.append('wl-probe', { name: 'pg-select1', at: new Date(T0 + 8000).toISOString(), ms: 12, status: 'ok' });
  s.append('wl-containers', { at: new Date(T0 + 9000).toISOString(), series: [{ at: new Date(T0 + 9000).toISOString(), name: 'pg', cpuPct: 3.5, memUsedMB: 120, memLimitMB: 7800 }], outOfScope: { at: new Date(T0 + 9000).toISOString(), count: 2, cpuPct: 1, memUsedMB: 50, memLimitMB: 7800 } });
  s.append('wl-vm', { at: new Date(T0 + 9500).toISOString(), hostMemMB: 2048, guestMem: { value: null, unavailableReason: 'not declared in scope' } });
  s.append('wl-vmcap', { at: new Date(T0).toISOString(), cap: { value: 8192, unit: 'MB', source: 'user VM config' } });
  s.append('wl-config', { at: new Date(T0).toISOString(), facts: [{ kind: 'postgres', fact: 'shared_buffers', value: '128MB', source: 'database settings', unavailableReason: null }] });
  s.close();
  const rec = persist.recover(file); // no run-end: the run was killed
  const rep = buildCoreReport({ ...rec, observer: null }, { status: 'unfinished', endReason: 'no run-end', streamName: 'run.jsonl' });
  const w = rep.workload;
  assert.ok(w, 'workload section present');
  assert.strictEqual(w.phases.length, 2);
  assert.strictEqual(w.phases[1].endStatus, 'unfinished');
  assert.strictEqual(w.markers.length, 1);
  assert.strictEqual(w.containers.series.length, 1);
  assert.strictEqual(w.containers.outOfScope[0].count, 2);
  assert.ok(!('name' in w.containers.outOfScope[0]), 'out-of-scope aggregate has no name');
  assert.deepStrictEqual(w.vm.hostMemMB, [{ at: new Date(T0 + 9500).toISOString(), value: 2048 }]);
  assert.strictEqual(w.vm.configuredCapMB.value, 8192);
  assert.strictEqual(w.probes['pg-select1'][0].status, 'ok');
  assert.strictEqual(rep.workloadConfig[0].fact, 'shared_buffers');
  const lines = summaryLines(w).join('\n');
  assert.match(lines, /2 phase\(s\): idle closed, loaded unfinished/);
  assert.match(lines, /probe pg-select1: 1 attempt/);
});

test('a stream from before the workload session existed produces no workload keys', () => {
  const rep = buildCoreReport({ start: { runStartMs: T0, thresholds: { hang: 800, recovery: 400, ramHigh: 85 } }, samples: [], probes: [], marks: [], failures: [], csamples: [], gaps: [], heavyRuns: [], observer: null, wl: [] }, { status: 'complete' });
  assert.ok(!('workload' in rep) && !('workloadConfig' in rep));
});
