'use strict';
// data-signals-completeness: signal collectors registered through the sampler's collector registry.
// Every family below is a continuous-tier collector on the ONE shared counter session (no per-tick process launch).
// buildSignals() turns one session block into the stored per-sample fields; it is pure apart from the scope resolver's
// in-memory name set, so canned counter text can drive it in tests.
const { rec } = require('../sampler/record');
const { indexLines } = require('./common');
const cpu = require('./cpu');
const thermal = require('./thermal');
const memory = require('./memory');
const disk = require('./disk');
const network = require('./network');
const gpu = require('./gpu');
const system = require('./system');
const procs = require('./procs');
const power = require('./power');

// counter families the session may read every Nth tick when over budget (see pdh-script.js) -> collector module
const FAMILY = { procs: 'Process', gpu: 'GPU Engine', network: 'Network Interface' };
const MODULES = [
  { m: cpu, key: 'cpu' }, { m: memory, key: 'mem' }, { m: disk, key: 'disk' }, { m: system, key: 'sys' },
  { m: network, key: 'net', fam: FAMILY.network }, { m: gpu, key: 'gpu', fam: FAMILY.gpu }, { m: procs, key: 'procs', fam: FAMILY.procs },
];
const BUDGET_MS = { procs: 15, gpu: 15, network: 5 };

function registerAll(REG) {
  const add = (m, extra = {}) => REG.registerCollector({ id: m.id, inference: m.inference, tier: 'continuous', unit: 'multi', scopeAware: m === procs,
    ...extra, source: { kind: 'counter-session', paths: m.COUNTERS || [], dynamic: m.DYNAMIC || [] } });
  add(cpu); add(memory); add(disk); add(system);
  add(thermal);
  add(network, { budgetMs: BUDGET_MS.network });
  add(gpu, { budgetMs: BUDGET_MS.gpu });
  add(procs, { budgetMs: BUDGET_MS.procs });
}

const NOT_COLLECTED = [
  { datum: 'ecoQoS per-process power-throttling state', reason: 'returned denied/unknown on every local trace, cost a compile per run, and was stored on hang rows although collected after the run; removed' },
  { datum: 'per-process network activity', reason: 'declared non-goal: only aggregate adapter throughput and errors are collected' },
  { datum: 'per-process handle, thread and GDI counts', reason: 'deferred; only the system-wide handle count is collected' },
];
const NOTES = {
  maxFreq: 'maxFreq (% of Maximum Frequency) is kept as a legacy field: it reads 100 on a turbo-capable laptop clamped to base clock; use cpu.perfPct and cpu.perfLimitPct',
  perfLimitPct: 'perfLimitPct = 100 - the OS "% Performance Limit" counter (0 = not limited); the raw counter reads 100 when nothing limits the processor',
  defender: 'defender (legacy flat key) is normalized to a share of the whole machine (0-100); the per-core-scaled raw value is not stored',
  cpuNormalization: 'per-process CPU is a share of the whole machine: the per-core-scaled counter value divided by machine.logicalCpus',
  powerPlan: 'power.plan is {name, guid} of the active scheme; power.scheme is the legacy one-line text',
};

function createSignals({ resolver, logicalCpus, fail = () => {}, descendants = false, minTicksBeforeFailure = 2 } = {}) {
  const tracker = power.createPowerTracker();
  const reported = new Set();
  const fam = {};              // counter family -> {ticks, sumMs, maxMs, every}
  let ticks = 0, procsTicks = 0;
  const lastEvery = {};

  function report(f) {
    if (ticks < minTicksBeforeFailure) return;
    const key = f.inference;
    if (reported.has(key)) return;
    reported.add(key);
    fail(f.inference, f.collector, f.mode, f.reason);
  }

  // block: {lines, power, costs, atIso, windowS}; returns {fields, transition}
  function build(block) {
    ticks++;
    const atIso = block.atIso, windowS = block.windowS || 2;
    const idx = indexLines(block.lines || [], { decimal: block.decimal || '.' });
    const mk = (value, unit, o = {}) => rec(value, { unit, windowS: o.windowS !== undefined ? o.windowS : windowS, n: 1, src: o.src, at: atIso, prec: o.prec });
    const ran = new Set();
    for (const c of block.costs || []) {
      ran.add(c.counter);
      const f = fam[c.counter] || (fam[c.counter] = { ticks: 0, sumMs: 0, maxMs: 0, every: 1 });
      f.ticks++; f.sumMs += c.ms; f.maxMs = Math.max(f.maxMs, c.ms);
      if (c.every > 1 && f.every === 1) fail('run.continuous', 'counterSession', 'skipped-overload', `${c.counter} counters exceeded their ${BUDGET_MS[Object.keys(FAMILY).find((k) => FAMILY[k] === c.counter)] || 15} ms per-tick budget; read every ${c.every}th tick instead`);
      f.every = c.every; lastEvery[c.counter] = c.every;
    }
    const fields = {};
    const ctx = { mk, resolver, logicalCpus, at: atIso, windowS, descendantsNote: descendants };
    for (const { m, key, fam: family } of MODULES) {
      // a family read every Nth tick is simply absent on the ticks it was not read (cadence is in the run summary)
      if (family && !ran.has(family) && (lastEvery[family] || 1) > 1) continue;
      const r = m.build(idx, ctx);
      fields[key] = r[key];
      for (const f of r.failures) report(f);
    }
    if (fields.procs && fields.procs.groups) procsTicks++;
    const t = thermal.build(idx, ctx);
    fields.thermal = t.thermal;
    for (const f of t.failures) report(f);
    if (fields.gpu) { fields.gpu.tempC = t.gpuTemp.tempC; if (t.gpuTemp.tempReason) fields.gpu.tempReason = t.gpuTemp.tempReason; }
    // power: one cheap Win32 read per tick
    const pp = power.parsePowerBlock(block.power);
    fields.power = power.buildPower(pp, ctx);
    const tr = tracker.observe(atIso, pp.ac);
    if (pp.hasBattery === false) report({ inference: 'power.battery_pct', collector: 'powerSample', mode: 'not-exposed', reason: 'the platform reports no system battery' });
    else if (pp.reasons.batteryPct) report({ inference: 'power.battery_pct', collector: 'powerSample', mode: 'not-exposed', reason: `battery percentage ${pp.reasons.batteryPct}` });
    if (pp.reasons.powerMode) report({ inference: 'power.mode', collector: 'powerSample', mode: 'not-exposed', reason: 'power-mode overlay is not exposed by this Windows build' });
    if (pp.reasons.energySaver) report({ inference: 'power.energy_saver', collector: 'powerSample', mode: 'not-exposed', reason: 'energy-saver state is not exposed' });
    if (pp.reasons.ac) report({ inference: 'power.on_wall_power', collector: 'powerSample', mode: 'not-exposed', reason: 'AC line status is not exposed' });
    return { fields, transition: tr };
  }

  function summary() {
    const families = {};
    for (const [name, f] of Object.entries(fam)) families[name] = { reads: f.ticks, meanMs: f.ticks ? +(f.sumMs / f.ticks).toFixed(2) : null, maxMs: +f.maxMs.toFixed(2), readEveryNthTick: f.every };
    return { logicalCpus, ticks, procsTicks, counterFamilies: families, powerTransitions: tracker.transitions(), notCollected: NOT_COLLECTED.slice(), notes: { ...NOTES } };
  }
  return { build, summary, transitions: () => tracker.transitions() };
}

module.exports = { registerAll, createSignals, NOT_COLLECTED, NOTES, FAMILY, BUDGET_MS };
