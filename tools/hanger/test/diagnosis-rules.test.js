'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diagnose } = require('../lib/diagnosis/engine');
const { mkReport, calm, iso } = require('./helpers/diag-report');

const lead = [{ t: 2, ms: 150 }];
const rule = (d, id, hang = 0) => d.hangs[hang].rules.find((r) => r.id === id);

// ---- memory-pressure at the hang ----
test('run-wide peak does not convict a calm hang (peak 88% at t=5, hang at commit 83%)', () => {
  const probes = [{ t: 2, ms: 150 }, { t: 5, ms: 150, commit: 88 }, ...calm(12, 10, 1, { commit: 62 }), { t: 40, ms: 1100, hang: true, commit: 83, pages: 292 }];
  const d = diagnose(mkReport({ probes }));
  const m = rule(d, 'memory-pressure');
  assert.strictEqual(m.fired, false);
  assert.ok(!JSON.stringify(m.inputs).includes('spawnProbes[1]'), 'the t=5 peak is not an input');
  assert.strictEqual(d.hangs[0].ranked.includes('memory-pressure'), false);
});

test('at-hang pressure fires with the hang probe as input and the calm mean with n', () => {
  const probes = [...lead, ...calm(18, 10, 1, { commit: 62 }), { t: 40, ms: 1600, hang: true, commit: 91, availMB: 300 }];
  const d = diagnose(mkReport({ probes }));
  const m = rule(d, 'memory-pressure');
  assert.strictEqual(m.fired, true);
  assert.deepStrictEqual(m.calm, { mean: 62, n: 18, signal: 'mem.committed_pct' });
  assert.ok(m.inputs.some((i) => i.ref === 'spawnProbes[19]' && i.signal === 'mem.committed_pct' && i.value === 91));
  assert.strictEqual(m.threshold.value, 85);
  assert.strictEqual(m.threshold.unit, '%');
});

test('low available memory alone can fire the memory rule (minimum-free threshold)', () => {
  const probes = [...lead, ...calm(14, 10, 1, { commit: 70, availMB: 5000 }), { t: 40, ms: 1600, hang: true, commit: 78, availMB: 600 }];
  const m = rule(diagnose(mkReport({ probes })), 'memory-pressure');
  assert.strictEqual(m.fired, true);
  assert.strictEqual(m.threshold.unit, 'GB');
});

// ---- CPU saturation ----
test('queue is normalized per logical processor: 96% CPU and queue 30 on 12 logical processors fires and names the top in-scope groups', () => {
  const procs = { groups: [{ group: 'postgres', cpuPctMachine: 61 }, { group: 'node', cpuPctMachine: 22 }, { group: 'code', cpuPctMachine: 4 }, { group: 'x', cpuPctMachine: 1 }] };
  const probes = [...lead, ...calm(12, 10, 1, { cpuPct: 25, cpuQ: 2 }), { t: 40, ms: 1500, hang: true, cpuPct: 96, cpuQ: 30, procs }];
  const c = rule(diagnose(mkReport({ probes, logicalCpus: 12 })), 'cpu-saturation');
  assert.strictEqual(c.fired, true);
  assert.deepStrictEqual(c.extra.topInScopeGroups.map((g) => g.group), ['postgres', 'node', 'code']);
  assert.strictEqual(c.inputs.find((i) => i.signal === 'cpu.queue_per_lp').value, 2.5);
});

test('busy CPU with a short queue does not fire (95% and queue 12 on 12 logical processors)', () => {
  const probes = [...lead, ...calm(12, 10, 1), { t: 40, ms: 1500, hang: true, cpuPct: 95, cpuQ: 12 }];
  assert.strictEqual(rule(diagnose(mkReport({ probes, logicalCpus: 12 })), 'cpu-saturation').fired, false);
});

// ---- disk stall ----
test('sustained disk stall: three probes within +-10 s above 25 ms with a queue fire with n=3 and three references', () => {
  const probes = [...lead, ...calm(12, 10, 1, { diskLat: 4 }), { t: 36, ms: 200, diskLat: 38, diskQ: 1 }, { t: 40, ms: 1500, hang: true, diskLat: 41, diskQ: 2 }, { t: 44, ms: 220, diskLat: 55, diskQ: 3 }];
  const d = diagnose(mkReport({ probes }));
  const k = rule(d, 'disk-stall');
  assert.strictEqual(k.fired, true);
  assert.strictEqual(k.n, 3);
  assert.strictEqual(k.inputs.filter((i) => i.signal === 'disk.latency_ms').length, 3);
  assert.strictEqual(k.threshold.value, 25);
  assert.strictEqual(k.threshold.unit, 'ms');
});

test('a single slow probe does not fire the disk rule', () => {
  const probes = [...lead, ...calm(12, 10, 1, { diskLat: 4 }), { t: 40, ms: 1500, hang: true, diskLat: 41, diskQ: 2 }];
  const k = rule(diagnose(mkReport({ probes })), 'disk-stall');
  assert.strictEqual(k.fired, false);
  assert.match(k.reason, /1 of \d+ probes, minimum 3/);
});

// ---- security-software contention ----
test('normalized AV CPU convicts at a calm-memory hang and always lists the observer-induced scanning confound', () => {
  const sec = (v) => ({ system: [{ member: 'Security software', cpuPctMachine: v }] });
  const probes = [...lead, ...calm(15, 10, 1, { commit: 55, procs: sec(1.5) }), { t: 40, ms: 1500, hang: true, commit: 60, procs: sec(12) }];
  const d = diagnose(mkReport({ probes, logicalCpus: 12 }));
  const s = rule(d, 'security-contention');
  assert.strictEqual(s.fired, true);
  assert.strictEqual(s.calm.n, 15);
  assert.ok(s.confounds.some((c) => /probe process starts may trigger scanning/.test(c.text)));
  assert.strictEqual(s.inputs[0].unit, '% of machine');
  assert.strictEqual(s.components.P, 0.1, 'the active confound lowers confidence');
});

test('a per-core raw value is never compared directly: raw 180 on 12 logical processors is read as 15 % of machine', () => {
  const probes = [...lead, ...calm(15, 10, 1, { commit: 55, defender: 18 }), { t: 40, ms: 1500, hang: true, commit: 60, defender: 180 }];
  const s = rule(diagnose(mkReport({ probes, logicalCpus: 12 })), 'security-contention');
  assert.strictEqual(s.inputs[0].value, 15);
  assert.strictEqual(s.inputs[0].unit, '% of machine');
  assert.strictEqual(s.inputs[0].rawValue, 180);
  assert.strictEqual(s.fired, true);
});

test('a machine-share defender value from the signal collectors is used as it is', () => {
  const probes = [...lead, ...calm(15, 10, 1, { commit: 55, defender: 1.5 }), { t: 40, ms: 1500, hang: true, commit: 60, defender: 12 }];
  const s = rule(diagnose(mkReport({ probes, logicalCpus: 12, signalsNotes: { defender: 'normalized to a share of the whole machine' } })), 'security-contention');
  assert.strictEqual(s.inputs[0].value, 12);
  assert.ok(!('rawValue' in s.inputs[0]));
});

test('security rule does not fire when the memory rule fired at the same hang', () => {
  const sec = (v) => ({ system: [{ member: 'Security software', cpuPctMachine: v }] });
  const probes = [...lead, ...calm(15, 10, 1, { commit: 55, procs: sec(1.5) }), { t: 40, ms: 1500, hang: true, commit: 92, availMB: 300, procs: sec(12) }];
  const d = diagnose(mkReport({ probes }));
  assert.strictEqual(rule(d, 'memory-pressure').fired, true);
  const s = rule(d, 'security-contention');
  assert.strictEqual(s.fired, false);
  assert.match(s.reason, /memory-pressure rule fired/);
});

// ---- outside the declared scope ----
const share = (inMB, outMB, outGroups = 23) => ({ inScope: { memMB: inMB, cpuPctOfMachine: 1, groups: 1 }, outOfScope: { memMB: outMB, cpuPctOfMachine: 40, groups: outGroups }, system: { memMB: 0, cpuPctOfMachine: 2 } });

test('out-of-scope load is named as the cause (postgres scope, 0.4 GB in scope vs 7.1 GB outside)', () => {
  const probes = [...lead, ...calm(14, 10, 1, { commit: 60 }), { t: 40, ms: 1500, hang: true, commit: 92, availMB: 300, scopeShare: share(410, 7270) }];
  const d = diagnose(mkReport({ probes, scope: ['postgres'] }));
  const o = rule(d, 'outside-scope');
  assert.strictEqual(o.fired, true);
  assert.strictEqual(o.extra.outOfScopeGroups, 23);
  assert.strictEqual(d.finding.class, 'outside-scope');
  assert.match(d.finding.sentence, /outside the declared scope/);
  assert.match(d.finding.sentence, /7\.1 GB/);
  assert.match(d.finding.sentence, /23 groups not monitored/);
});

test('outside-scope does not fire when in-scope groups hold most of the load', () => {
  const probes = [...lead, ...calm(14, 10, 1, { commit: 60 }), { t: 40, ms: 1500, hang: true, commit: 92, availMB: 300, scopeShare: share(7000, 500, 4) }];
  const d = diagnose(mkReport({ probes, scope: ['postgres'] }));
  assert.strictEqual(rule(d, 'outside-scope').fired, false);
  assert.strictEqual(d.finding.class, 'memory');
});

test('outside-scope is not evaluable in open scope', () => {
  const probes = [...lead, ...calm(14, 10, 1, { commit: 60 }), { t: 40, ms: 1500, hang: true, commit: 92, availMB: 300 }];
  const o = rule(diagnose(mkReport({ probes, scope: 'open' })), 'outside-scope');
  assert.strictEqual(o.fired, null);
  assert.strictEqual(o.reason, 'open scope');
});

// ---- OS event records ----
test("yesterday's event is history only: no input or confirmation references it", () => {
  const events = { inWindow: { appHang: [
    { at: iso(-20 * 3600), id: 1002, provider: 'Application Hang' },
    { at: iso(41), id: 1002, provider: 'Application Hang' },
    { at: iso(42), id: 1002, provider: 'Some Other Provider' },
  ], appCrash: [], resourceExhaustion: [] } };
  const probes = [...lead, ...calm(14, 10, 1, { commit: 60 }), { t: 40, ms: 1500, hang: true, commit: 92, availMB: 300 }];
  const d = diagnose(mkReport({ probes, events }));
  assert.deepStrictEqual(d.eventsUsed.map((e) => e.at), [iso(41)]);
  assert.strictEqual(d.eventsHistory.length, 2);
  assert.deepStrictEqual(d.hangs[0].confirmedBy, ['probe-only'], 'a log record alone never confirms');
  assert.ok(!JSON.stringify(d.hangs).includes(iso(-20 * 3600)));
});
