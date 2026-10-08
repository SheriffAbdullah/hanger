'use strict';
// data-signals-completeness 4.x: per-process CPU and I/O, reduced through the scope resolver before storage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const scope = require('../lib/scope');
const signals = require('../lib/collectors');
const procs = require('../lib/collectors/procs');
const summary = require('../lib/collectors/summary');
const { indexLines } = require('../lib/collectors/common');
const { parseBundleLines } = require('../lib/sampler/bundle');

const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'collectors', 'signals-laptop.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const AT = '2026-10-07T10:00:00.000Z';
const scoped = (names = ['postgres']) => scope.createResolver(scope.createMatcher(names.map((name) => ({ name }))), { open: false });
const line = (name, counter, val) => `\\\\H\\process(${name})\\${counter}=${val}`;
const group = (name, o) => [line(name, '% Processor Time', o.cpu ?? 0), line(name, 'IO Read Bytes/sec', o.read ?? 0), line(name, 'IO Write Bytes/sec', o.write ?? 0),
  line(name, 'Working Set', (o.ws ?? 0) * 1048576), line(name, 'Private Bytes', (o.priv ?? 0) * 1048576), line(name, 'instances', o.n ?? 1)];

test('4.1 270 raw on 12 CPUs is 22.5 % of machine, with read/write bytes per second', () => {
  const p = procs.build(indexLines(FIX), { resolver: scoped(), logicalCpus: 12, at: AT }).procs;
  const pg = p.groups.find((g) => g.group === 'postgres');
  assert.strictEqual(pg.cpuPctMachine, 22.5);
  assert.strictEqual(pg.writeBps, 8000000);
  assert.strictEqual(pg.readBps, 3000000);
  assert.strictEqual(p.prov.units.cpuPctMachine, '% of machine');
  assert.strictEqual(p.prov.units.writeBps, 'bytes/s');
  assert.strictEqual(p.prov.logicalCpus, 12);
});

test('4.1 no stored per-process CPU exceeds 100, even from a raw value above the CPU count', () => {
  const lines = [...group('postgres', { cpu: 1500, ws: 10 }), ...group('zzcanary', { cpu: 9999, ws: 10 })];
  const p = procs.build(indexLines(lines), { resolver: scoped(), logicalCpus: 12, at: AT }).procs;
  for (const r of [...p.groups, ...p.system, p.outOfScope]) assert.ok(r.cpuPctMachine === null || r.cpuPctMachine <= 100, JSON.stringify(r));
  assert.strictEqual(p.groups[0].cpuPctMachine, 100);
});

test('4.1 out-of-scope load is an anonymous aggregate and the name appears nowhere in the stored sample', () => {
  const res = scoped();
  const sig = signals.createSignals({ resolver: res, logicalCpus: 12, fail: () => {} });
  const f = sig.build({ lines: FIX, power: null, atIso: AT }).fields;
  assert.strictEqual(f.procs.outOfScope.groupCount, 1);
  assert.strictEqual(f.procs.outOfScope.cpuPctMachine, 30);
  assert.strictEqual(f.procs.outOfScope.wsMB, 100);
  assert.deepStrictEqual(Object.keys(f.procs.outOfScope).sort(), ['cpuPctMachine', 'groupCount', 'readBps', 'writeBps', 'wsMB']);
  assert.ok(!JSON.stringify(f).toLowerCase().includes('zzcanary'), 'the canary name is in no stored field');
  assert.ok(!JSON.stringify(sig.summary()).toLowerCase().includes('zzcanary'));
});

test('4.1 with nothing out of scope the aggregate is a true zero, not a missing reading', () => {
  const p = procs.build(indexLines(group('postgres', { cpu: 12, ws: 5 })), { resolver: scoped(), logicalCpus: 12, at: AT }).procs;
  assert.strictEqual(p.outOfScope.groupCount, 0);
  assert.strictEqual(p.outOfScope.cpuPctMachine, 0);
});

test('4.1 a group with no valid rate yet (a new process) stores null, not 0', () => {
  const lines = [line('postgres', 'Working Set', 5 * 1048576), line('postgres', 'Private Bytes', 5 * 1048576), line('postgres', 'instances', 1)];
  const p = procs.build(indexLines(lines), { resolver: scoped(), logicalCpus: 12, at: AT }).procs;
  assert.strictEqual(p.groups[0].cpuPctMachine, null);
  assert.strictEqual(p.groups[0].readBps, null);
  assert.strictEqual(p.groups[0].wsMB, 5);
});

test('4.1 open scope names everything but caps the stored groups at the busiest and sums the rest', () => {
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(...group(`app${i}`, { cpu: i, ws: 10 }));
  const open = scope.createResolver(scope.createMatcher([]), { open: true });
  const p = procs.build(indexLines(lines), { resolver: open, logicalCpus: 12, at: AT }).procs;
  assert.strictEqual(p.groups.length, procs.OPEN_CAP);
  assert.strictEqual(p.groups[0].group, 'app39');
  assert.strictEqual(p.otherInScope.groupCount, 40 - procs.OPEN_CAP);
});

test('4.1 descendant entries carry an honest note: the series matches by name only', () => {
  const r = scope.createResolver(scope.createMatcher([{ name: 'postgres', includeDescendants: true }]), { open: false });
  const p = procs.build(indexLines(FIX), { resolver: r, logicalCpus: 12, at: AT, descendantsNote: true }).procs;
  assert.match(p.scopeNote, /name only/);
});

test('4.2 security software of 190 raw on 12 CPUs is 15.8 % of machine; the legacy defender key follows it', () => {
  const sig = signals.createSignals({ resolver: scoped(), logicalCpus: 12, fail: () => {} });
  const f = sig.build({ lines: FIX, power: null, atIso: AT }).fields;
  const sec = f.procs.system.find((s) => s.member === 'Security software');
  assert.strictEqual(sec.cpuPctMachine, 15.8);
  assert.strictEqual(f.procs.prov.logicalCpus, 12);
});

test('4.2 memory compression is always present, even when it would rank 11th by working set', () => {
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(...group(`app${i}`, { cpu: 1, ws: 2000 + i }));
  lines.push(...group('Memory Compression', { ws: 640, priv: 7 }));
  const open = scope.createResolver(scope.createMatcher([]), { open: true });
  const p = procs.build(indexLines(lines), { resolver: open, logicalCpus: 12, at: AT }).procs;
  const mc = p.system.find((s) => s.member === 'Memory Compression');
  assert.strictEqual(mc.wsMB, 640);
});

test('4.2 the Search indexer is a system-set member; a sync client is sampled only when in scope', () => {
  const lines = [...group('SearchIndexer', { cpu: 24, ws: 38 }), ...group('OneDrive', { cpu: 12, ws: 200 })];
  const off = procs.build(indexLines(lines), { resolver: scoped(['postgres']), logicalCpus: 12, at: AT }).procs;
  assert.ok(off.system.some((s) => s.member === 'SearchIndexer'));
  assert.ok(!off.groups.some((g) => /onedrive/i.test(g.group)));
  assert.strictEqual(off.outOfScope.groupCount, 1);
  const on = procs.build(indexLines(lines), { resolver: scoped(['onedrive']), logicalCpus: 12, at: AT }).procs;
  assert.strictEqual(on.groups[0].group, 'OneDrive');
  assert.strictEqual(on.groups[0].cpuPctMachine, 1);
});

test('4.3 footprint ranks by working set, commit attribution ranks by private bytes', () => {
  const groups = [{ group: 'a', wsMB: 2000, privateMB: 150 }, { group: 'b', wsMB: 600, privateMB: 1800 }];
  const r = summary.rank(groups);
  assert.strictEqual(r.footprint[0].name, 'a');
  assert.strictEqual(r.commit[0].name, 'b');
  const p = procs.build(indexLines([...group('a', { ws: 2000, priv: 150 }), ...group('b', { ws: 600, priv: 1800 })]), { resolver: scoped(['a', 'b']), logicalCpus: 12, at: AT }).procs;
  assert.strictEqual(summary.rank(p.groups).footprint[0].name, 'a');
  assert.strictEqual(summary.rank(p.groups).commit[0].name, 'b');
  assert.strictEqual(p.groups.find((g) => g.group === 'b').privateMB, 1800);
});

test('4.3 the run summary keeps per-group peaks and the out-of-scope aggregate peaks (no names)', () => {
  const sig = signals.createSignals({ resolver: scoped(), logicalCpus: 12, fail: () => {} });
  const cs = [0, 1, 2].map((i) => ({ at: AT, procs: sig.build({ lines: FIX, power: null, atIso: AT }).fields.procs }));
  const s = summary.summarizeProcs(cs);
  assert.strictEqual(s.samples, 3);
  assert.strictEqual(s.groups[0].group, 'postgres');
  assert.strictEqual(s.groups[0].cpuPctMachinePeak, 22.5);
  assert.strictEqual(s.outOfScope.cpuPctMachinePeak, 30);
  assert.ok(!JSON.stringify(s).includes('zzcanary'));
  assert.strictEqual(summary.summarizeProcs([{ at: AT }]), null);
});

test('4.4 a family over budget is read every Nth tick and the cost lines are summarised', () => {
  const sig = signals.createSignals({ resolver: scoped(), logicalCpus: 12, fail: () => {} });
  for (let i = 0; i < 3; i++) sig.build({ lines: FIX, power: null, atIso: AT, costs: [{ counter: 'Process', ms: 4 + i, every: 1 }] });
  const s = sig.summary().counterFamilies.Process;
  assert.strictEqual(s.reads, 3); assert.strictEqual(s.maxMs, 6); assert.strictEqual(s.readEveryNthTick, 1);
});

test('the session script carries the wildcard reducers and builds for any dynamic list', () => {
  const { buildSessionScript } = require('../lib/sampler/pdh-script');
  const s = buildSessionScript({ paths: ['\\Memory\\Committed Bytes'], dynamic: [{ path: '\\Process(*)\\% Processor Time', reducer: 'proc', budgetMs: 15 }] });
  assert.match(s, /AddWild/); assert.match(s, /DumpWild/); assert.match(s, /Pwr\(\)/);
  assert.ok(!/System\.Windows\.Forms/.test(s), 'no WinForms assembly load per session');
  assert.match(s, /\\Process\(\*\)\\% Processor Time@proc@15/);
});

test('the session block parser keeps the full power block and the cost lines', () => {
  const { createBlockParser } = require('../lib/sampler/session');
  let got = null;
  const p = createBlockParser((b) => { got = b; });
  p.push('BEGIN|2026-10-07T10:00:00.000Z\nPOWER|Online|99|9|ded574b5-45a0-4f42-8737-46345c09c238|0\nCOST|Process|1.6|1\nEND\n');
  assert.deepStrictEqual(got.power, { line: 'Online', pct: '99', flag: '9', overlay: 'ded574b5-45a0-4f42-8737-46345c09c238', saver: '0' });
  assert.deepStrictEqual(got.costs, [{ counter: 'Process', ms: 1.6, every: 1 }]);
  assert.deepStrictEqual(parseBundleLines(FIX.filter((l) => /process\(/.test(l))).values, {});
});
