'use strict';
// data-signals-completeness 2.x-5.x: every signal family parsed from canned counter text (no live collection).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const scope = require('../lib/scope');
const { createRegistry } = require('../lib/sampler/registry');
const signals = require('../lib/collectors');
const { indexLines } = require('../lib/collectors/common');
const { rec } = require('../lib/sampler/record');
const { parseBundleLines } = require('../lib/sampler/bundle');
const cpu = require('../lib/collectors/cpu');
const thermal = require('../lib/collectors/thermal');
const memory = require('../lib/collectors/memory');
const disk = require('../lib/collectors/disk');
const network = require('../lib/collectors/network');
const gpu = require('../lib/collectors/gpu');
const system = require('../lib/collectors/system');

const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'collectors', 'signals-laptop.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const AT = '2026-10-07T10:00:00.000Z';
const mk = (value, unit, o = {}) => rec(value, { unit, windowS: 2, n: 1, src: o.src, at: AT, prec: o.prec });
const idx = (lines = FIX) => indexLines(lines);
const v = (x) => x.v;

test('2.1 performance above 100 and a limit rising 0 to 85 register while maxFreq stays 100', () => {
  const lines = (perf, lim) => [`\\\\H\\Processor Information(_Total)\\% Processor Performance=${perf}`, `\\\\H\\Processor Information(_Total)\\% Performance Limit=${lim}`,
    '\\\\H\\Processor Information(_Total)\\% of Maximum Frequency=100'];
  const a = cpu.build(indexLines(lines(148, 100)), { mk }).cpu;
  const b = cpu.build(indexLines(lines(60, 15)), { mk }).cpu;
  assert.strictEqual(v(a.perfPct), 148); assert.strictEqual(a.perfPct.unit, '% of base');
  assert.strictEqual(v(b.perfPct), 60);
  assert.strictEqual(v(a.perfLimitPct), 0); assert.strictEqual(v(b.perfLimitPct), 85);
  // the legacy field is untouched by the new collector and still reads 100
  assert.strictEqual(parseBundleLines(lines(60, 15)).values.maxFreq, 100);
});

test('2.1 throttle reasons are null with a reason when no counter exposes them, never an empty success', () => {
  const none = cpu.build(indexLines(['\\\\H\\Processor Information(_Total)\\% Processor Performance=100']), { mk });
  assert.strictEqual(none.cpu.throttleReasons, null);
  assert.strictEqual(none.cpu.throttleReasonsReason, 'not-exposed');
  assert.ok(none.failures.some((f) => f.inference === 'cpu.throttleReasons' && f.mode === 'not-exposed'));
  const flagged = cpu.build(indexLines(['\\\\H\\Processor Information(_Total)\\Performance Limit Flags=4']), { mk });
  assert.deepStrictEqual(flagged.cpu.throttleReasons, ['perf-limit-flags:0x4']);
  const clean = cpu.build(idx(), { mk });
  assert.deepStrictEqual(clean.cpu.throttleReasons, []);
});

test('2.2 zones are labelled, 344.15 K is 71.0 C, and the 0.1 C zone is dropped and counted', () => {
  const t = thermal.build(idx(), { mk }).thermal;
  const z = t.zones.find((x) => x.label === 'CPU package');
  assert.strictEqual(z.role, 'cpu');
  assert.strictEqual(z.c, 71.0);
  assert.ok(!t.zones.some((x) => x.label === 'ACPI zone 3'));
  assert.strictEqual(t.droppedImplausible, 1);
  assert.strictEqual(t.prov.unit, 'C');
});

test('2.2 a high-precision reading (tenths of a Kelvin) is preferred and implausible highs are dropped', () => {
  const t = thermal.build(indexLines(['\\\\H\\Thermal Zone Information(\\_TZ.CPUZ)\\Temperature=309', '\\\\H\\Thermal Zone Information(\\_TZ.CPUZ)\\High Precision Temperature=3441.5',
    '\\\\H\\Thermal Zone Information(\\_TZ.HOTZ)\\Temperature=500']), { mk }).thermal;
  assert.strictEqual(t.zones.length, 1);
  assert.strictEqual(t.zones[0].c, 71.0);
  assert.strictEqual(t.droppedImplausible, 1);
});

test('2.2 no readable zone is null with reason not-exposed and one failure entry, never 0', () => {
  const r = thermal.build(indexLines(['\\\\H\\Memory\\Committed Bytes=1']), { mk });
  assert.strictEqual(r.thermal.zones, null);
  assert.strictEqual(r.thermal.zonesReason, 'not-exposed');
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].mode, 'not-exposed');
  // through the signal builder the failure is recorded once per run, not once per tick
  const seen = [];
  const sig = signals.createSignals({ resolver: { classifyName: () => 'in', noteOutName() {} }, logicalCpus: 12, fail: (...a) => seen.push(a) });
  for (let i = 0; i < 5; i++) sig.build({ lines: ['\\\\H\\Memory\\Committed Bytes=1'], power: null, atIso: AT });
  assert.strictEqual(seen.filter((a) => a[0] === 'thermal.zones').length, 1);
});

test('2.2 GPU temperature comes from a graphics zone when exposed, else null with a reason', () => {
  const sig = signals.createSignals({ resolver: { classifyName: () => 'in', noteOutName() {} }, logicalCpus: 12, fail: () => {} });
  const f = sig.build({ lines: FIX, power: null, atIso: AT }).fields;
  assert.strictEqual(f.gpu.tempC.v, 24.9);
  const g = sig.build({ lines: FIX.filter((l) => !/GFXZ/.test(l)), power: null, atIso: AT }).fields;
  assert.strictEqual(g.gpu.tempC.v, null);
  assert.strictEqual(g.gpu.tempReason, 'not-exposed');
});

test('2.3 DPC and interrupt time are continuous series with unit %', () => {
  const c = cpu.build(idx(), { mk }).cpu;
  assert.strictEqual(c.dpcPct.v, 1.1); assert.strictEqual(c.dpcPct.unit, '%');
  assert.strictEqual(c.interruptPct.v, 0.6); assert.strictEqual(c.interruptPct.unit, '%');
});

test('3.1 commit bytes, commit limit and the percentage are stored together', () => {
  const m = memory.build(idx(), { mk }).mem;
  assert.strictEqual(m.committedBytes.v, 16100000000); assert.strictEqual(m.committedBytes.unit, 'bytes');
  assert.strictEqual(m.commitLimitBytes.v, 20300000000);
  assert.strictEqual(m.committedPct.v, 79.3);
});

test('3.2 pages in and pages out are separate series and the pagefile usage is on the same sample', () => {
  const m = memory.build(idx(), { mk }).mem;
  assert.strictEqual(m.pagesInPerS.v, 4513);
  assert.strictEqual(m.pagesOutPerS.v, 0);
  assert.strictEqual(m.pagefileUsePct.v, 8);
});

test('3.2 a missing counter is null with a failure, never 0', () => {
  const r = memory.build(indexLines(['\\\\H\\Memory\\Committed Bytes=100', '\\\\H\\Memory\\Commit Limit=200']), { mk });
  assert.strictEqual(r.mem.pagesOutPerS.v, null);
  assert.ok(r.failures.some((f) => f.inference === 'mem.pagesOutPerS'));
});

test('3.3 disk latency is milliseconds, busy is 100 minus idle, queue and throughput are stored', () => {
  const d = disk.build(idx(), { mk }).disk;
  assert.strictEqual(d.latencyMs.v, 4.2); assert.strictEqual(d.latencyMs.unit, 'ms');
  assert.strictEqual(d.busyPct.v, 12);
  assert.strictEqual(d.queue.v, 0.3);
  assert.strictEqual(d.readBps.v, 1200000); assert.strictEqual(d.writeBps.v, 340000); assert.strictEqual(d.readBps.unit, 'bytes/s');
});

test('3.4 the AnyConnect adapter is a VPN with its rule, Wi-Fi is not, and no per-process network exists', () => {
  const n = network.build(idx(), { mk }).net;
  const vpn = n.adapters.find((a) => /AnyConnect/.test(a.adapter));
  const wifi = n.adapters.find((a) => a.adapter === 'Wi-Fi');
  assert.strictEqual(vpn.isVpn, true); assert.strictEqual(vpn.vpnRule, 'anyconnect');
  assert.strictEqual(wifi.isVpn, false); assert.strictEqual(wifi.vpnRule, null);
  assert.strictEqual(wifi.inBps, 21000); assert.strictEqual(wifi.outBps, 9000); assert.strictEqual(wifi.errors, 0);
  const sig = signals.createSignals({ resolver: scope.createResolver(scope.createMatcher([{ name: 'postgres' }]), { open: false }), logicalCpus: 12, fail: () => {} });
  const f = sig.build({ lines: FIX, power: null, atIso: AT }).fields;
  assert.ok(!JSON.stringify(f.procs).toLowerCase().includes('bytes received'), 'no network key under procs');
  for (const row of [...f.procs.groups, ...f.procs.system]) assert.ok(!Object.keys(row).some((k) => /net|inBps|outBps/i.test(k)));
});

test('3.5 the system handle count is stored with unit count', () => {
  const s = system.build(idx(), { mk }).sys;
  assert.strictEqual(s.handleCount.v, 98213); assert.strictEqual(s.handleCount.unit, 'count');
});

test('5.1 total GPU utilization is derived from engines (40+25 on 3D, 5 copy -> 65) with a derived note', () => {
  const g = gpu.build(idx(), { mk }).gpu;
  assert.strictEqual(g.totalUtilPct.v, 65);
  assert.strictEqual(g.note, 'derived');
  assert.strictEqual(g.vramUsedMB.v, 512);
  assert.strictEqual(gpu.engineKey('pid_9_luid_0x00000000_0x00011ee7_phys_0_eng_0_engtype_3D'), gpu.engineKey('luid_0x00000000_0x00011ee7_engtype_3d'));
});

test('5.1 absent GPU data is null with a reason on every sample and one failure', () => {
  const r = gpu.build(indexLines(['\\\\H\\Memory\\Committed Bytes=1']), { mk });
  assert.strictEqual(r.gpu.totalUtilPct.v, null);
  assert.strictEqual(r.gpu.reason, 'not-exposed');
  assert.ok(r.failures.some((f) => f.inference === 'gpu.totalUtilPct'));
});

test('5.2 per-process GPU data keeps only in-scope groups; PIDs and other processes are discarded', () => {
  const gsnap = { engines: { byPid: { 100: { pct: 30.5, n: 2 }, 200: { pct: 9, n: 1 }, 300: { pct: 1, n: 1 } }, n: 4, ms: 12 }, mem: { byPid: { 100: { mb: 128, n: 1 }, 200: { mb: 64, n: 1 } }, n: 2, ms: 12 } };
  const by = gpu.perProcessByGroup(gsnap, (pid) => ({ 100: 'postgres', 101: 'postgres' }[pid] || null));
  assert.deepStrictEqual(Object.keys(by), ['postgres']);
  assert.strictEqual(by.postgres.utilPct, 30.5);
  assert.strictEqual(by.postgres.vramMB, 128);
  assert.ok(!JSON.stringify(by).includes('200'));
});

test('6.1 EcoQoS is gone: no collector code, and the not-collected list records why', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'telltale.js'), 'utf8');
  assert.ok(!/EcoQ|ecoQoS|ecoDeferred/.test(src), 'telltale.js holds no EcoQoS code');
  assert.ok(signals.NOT_COLLECTED.some((n) => /ecoQoS/i.test(n.datum) && n.reason.length > 20));
});

test('registry: every family registers as a continuous collector on the shared counter session', () => {
  const REG = createRegistry();
  signals.registerAll(REG);
  for (const id of ['signals.cpu', 'signals.thermal', 'signals.memory', 'signals.disk', 'signals.network', 'signals.gpu', 'signals.system', 'signals.procs']) {
    assert.strictEqual(REG.get(id).tier, 'continuous', id);
    assert.strictEqual(REG.get(id).source.kind, 'counter-session', id);
  }
  assert.ok(REG.counterPaths().includes('\\Memory\\Commit Limit'));
  const dyn = REG.dynamicCounters().map((d) => d.path);
  assert.ok(dyn.includes('\\Process(*)\\% Processor Time') && dyn.includes('\\GPU Engine(*)\\Utilization Percentage') && dyn.includes('\\Network Interface(*)\\Bytes Received/sec'));
  assert.ok(REG.dynamicCounters().find((d) => d.path.includes('Process(*)')).budgetMs > 0);
});

test('the per-process counter lines never fold into the machine totals of the legacy bundle', () => {
  const p = parseBundleLines(FIX);
  assert.strictEqual(p.values.cpuPct, 37.2, 'machine % processor time is not overwritten by a process line');
  assert.strictEqual(p.values.defender, undefined, 'defender is set from the security-software member, not a raw counter');
});

test('decimal-comma output (de-DE) parses the same values', () => {
  const de = ['\\\\H\\Processor Information(_Total)\\% Processor Performance=148,5', '\\\\H\\Memory\\Committed Bytes=16.100.000.000'];
  const sig = signals.createSignals({ resolver: { classifyName: () => 'in', noteOutName() {} }, logicalCpus: 12, fail: () => {} });
  const f = sig.build({ lines: de, power: null, atIso: AT, decimal: ',' }).fields;
  assert.strictEqual(f.cpu.perfPct.v, 149);
  assert.strictEqual(f.mem.committedBytes.v, 16100000000);
});

test('a counter family read every Nth tick is absent on the skipped ticks and its cadence is in the summary', () => {
  const sig = signals.createSignals({ resolver: scope.createResolver(scope.createMatcher([{ name: 'postgres' }]), { open: false }), logicalCpus: 12, fail: () => {} });
  const ran = sig.build({ lines: FIX, power: null, atIso: AT, costs: [{ counter: 'Process', ms: 20, every: 2 }, { counter: 'GPU Engine', ms: 1, every: 1 }] }).fields;
  assert.ok(ran.procs && ran.procs.groups);
  const skipped = sig.build({ lines: FIX.filter((l) => !/process\(/i.test(l)), power: null, atIso: AT, costs: [{ counter: 'GPU Engine', ms: 1, every: 1 }] }).fields;
  assert.strictEqual(skipped.procs, undefined);
  assert.strictEqual(sig.summary().counterFamilies.Process.readEveryNthTick, 2);
});
