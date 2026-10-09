'use strict';
// Named synthetic scenarios, one family per cause rule: fires / quiet / disproved / not-applicable (or missing data).
// Used by the per-rule tests, the contract-shape test and the evidence-resolution test.
const { incident, baseline, scenario, seq, calm } = require('./_fx');

const NO_CAP = { value: null, unavailableReason: 'no cap configured (default applies)', source: 'user VM config' };
const wl = (cap) => ({ vm: { configuredCapMB: cap, hostMemMB: [] }, probes: {} });
const sys = (...members) => ({ groups: [{ group: 'code', wsMB: 900, privateMB: 800 }], system: members, outOfScope: { groupCount: 30, cpuPctMachine: 5, wsMB: 3000 } });

// ---------------------------------------------------------------- commit-limit-pressure
const commit = {
  fires: () => scenario([
    ...baseline({ commit: 60, availMB: 5000, row: { mem: { pagefileUsePct: 38 } } }),
    ...incident((i) => ({ commit: [93, 94, 95, 96, 96][i], availMB: [410, 450, 500, 600, 560][i], row: { mem: { pagefileUsePct: [40, 42, 44, 46, 46][i] } } })),
  ]),
  highCommitOnly: () => scenario([
    ...baseline({ commit: 60, availMB: 5000, row: { mem: { pagefileUsePct: 38 } } }),
    ...incident((i) => ({ commit: 92, availMB: 3100, row: { mem: { pagefileUsePct: 40 } } })),
  ]),
  // three hangs; commit is 70% at two of them
  disproved: () => scenario([
    ...baseline({ commit: 60, availMB: 5000, row: { mem: { pagefileUsePct: 38 } } }),
    ...incident((i) => ({ commit: [93, 94, 95, 96, 96][i], availMB: [410, 450, 500, 600, 560][i], row: { mem: { pagefileUsePct: [40, 42, 44, 46, 46][i] } } }), { at: 40 }),
    ...incident((i) => ({ commit: 70, availMB: 3000, row: { mem: { pagefileUsePct: 38 } } }), { at: 80 }),
    ...incident((i) => ({ commit: 70, availMB: 3000, row: { mem: { pagefileUsePct: 38 } } }), { at: 120 }),
  ]),
  noPagefile: () => scenario([
    ...baseline({ commit: 60, availMB: 5000 }),
    ...incident((i) => ({ commit: 95, availMB: 450 })),
  ]),
};

// ---------------------------------------------------------------- hard-fault-thrash
const thrashCalm = { row: { mem: { pagesOutPerS: 2, pagesInPerS: 30, pagefileUsePct: 30 }, modifiedMB: 400 } };
const thrash = {
  fires: (extra = {}) => scenario([
    ...baseline(thrashCalm),
    ...incident((i) => ({ row: { mem: { pagesOutPerS: [350, 500, 900, 800, 600][i], pagesInPerS: 600, pagefileUsePct: [30, 31, 32, 34, 35][i] }, modifiedMB: [400, 420, 460, 490, 520][i] } })),
  ], extra),
  imageLoadOnly: () => scenario([
    ...baseline({ row: { mem: { pagesOutPerS: 0, pagesInPerS: 4513, pagefileUsePct: 8 }, modifiedMB: 400 } }),
    ...incident(() => ({ row: { mem: { pagesOutPerS: 0, pagesInPerS: 4513, pagefileUsePct: 8 }, modifiedMB: 400 } })),
  ]),
  observerRecorded: () => thrash.fires({ extra: { observer: { launches: { hangProbe: 20, continuous: 1 }, cpuS: 1.2 } } }),
  noCounter: () => scenario([...baseline({}), ...incident(() => ({}))]),
};

// ---------------------------------------------------------------- vm-memory-dominance
const vmCalm = { usedPct: 60, row: { usedPct: 60, procs: sys({ member: 'vmmem', wsMB: 2000, privateMB: 2000 }) } };
const vm = {
  fires: () => scenario([
    ...baseline(vmCalm),
    ...incident((i) => ({ row: { usedPct: 85, procs: sys({ member: 'vmmem', wsMB: [7200, 7400, 7800, 7700, 7500][i], privateMB: [7200, 7400, 7800, 7700, 7500][i] }) } })),
  ], { workload: wl(NO_CAP) }),
  capped: () => scenario([
    ...baseline(vmCalm),
    ...incident((i) => ({ row: { usedPct: 85, procs: sys({ member: 'vmmem', wsMB: [7200, 7400, 7800, 7700, 7500][i], privateMB: [7200, 7400, 7800, 7700, 7500][i] }) } })),
  ], { workload: wl({ value: 6144, unit: 'MB', source: 'user VM config' }) }),
  noVm: () => scenario([
    ...baseline({ row: { procs: sys({ member: 'MsMpEng', wsMB: 300 }) } }),
    ...incident(() => ({ row: { procs: sys({ member: 'MsMpEng', wsMB: 300 }) } })),
  ], { workload: wl(NO_CAP) }),
  capUnknown: () => scenario([
    ...baseline(vmCalm),
    ...incident(() => ({ row: { usedPct: 85, procs: sys({ member: 'vmmem', wsMB: 7500, privateMB: 7500 }) } })),
  ], { workload: wl({ value: null, unavailableReason: 'not collected', source: 'user VM config' }) }),
  noProcData: () => scenario([...baseline({}), ...incident(() => ({}))]),
};

// ---------------------------------------------------------------- database-memory-io
const pg = (mb, rd = 0, wr = 0) => ({ groups: [{ group: 'postgres', wsMB: mb + 100, privateMB: mb, readBps: rd, writeBps: wr, instances: 6 }], system: [], outOfScope: { groupCount: 20, wsMB: 2000 } });
const PGCFG = [{ kind: 'postgres', fact: 'shared_buffers', value: '4GB', source: 'database settings' }, { kind: 'postgres', fact: 'work_mem', value: '4MB', source: 'database settings' }, { kind: 'postgres', fact: 'max_connections', value: '100', source: 'database settings' }];
const db = {
  ioFires: () => scenario([
    ...baseline({ row: { disk: { latencyMs: 4, queue: 0.2 }, procs: pg(1200, 100000, 50000) } }),
    ...incident((i) => ({ row: { disk: { latencyMs: [31, 40, 48, 45, 35][i], queue: [2, 3, 3, 3, 2][i] }, procs: pg(1200, 8e6, 4e6) } })),
  ]),
  memoryNoConfig: () => scenario([
    ...baseline({ row: { disk: { latencyMs: 4, queue: 0.2 }, procs: pg(1500) } }),
    ...incident(() => ({ row: { disk: { latencyMs: 5, queue: 0.2 }, procs: pg(4608) } })),
  ]),
  memoryWithConfig: () => scenario([
    ...baseline({ row: { disk: { latencyMs: 4, queue: 0.2 }, procs: pg(1000) } }),
    ...incident(() => ({ row: { disk: { latencyMs: 5, queue: 0.2 }, procs: pg(1536) } })),
  ], { extra: { workloadConfig: PGCFG } }),
  memoryWithConfigButSmall: () => scenario([
    ...baseline({ row: { disk: { latencyMs: 4, queue: 0.2 }, procs: pg(1000) } }),
    ...incident(() => ({ row: { disk: { latencyMs: 5, queue: 0.2 }, procs: pg(1536) } })),
  ]),
  noDatabase: () => scenario([
    ...baseline({ row: { procs: { groups: [{ group: 'node', wsMB: 500, privateMB: 400 }], system: [], outOfScope: { groupCount: 20, wsMB: 9000 } } } }),
    ...incident(() => ({ row: { procs: { groups: [{ group: 'node', wsMB: 500, privateMB: 400 }], system: [], outOfScope: { groupCount: 20, wsMB: 9000 } } } })),
  ]),
  quiet: () => scenario([
    ...baseline({ row: { disk: { latencyMs: 4, queue: 0.2 }, procs: pg(300, 1000, 1000) } }),
    ...incident(() => ({ row: { disk: { latencyMs: 5, queue: 0.2 }, procs: pg(300, 1000, 1000) } })),
  ]),
  noProcData: () => scenario([...baseline({}), ...incident(() => ({}))]),
};

// ---------------------------------------------------------------- single-process-dominance
const grp = (name, mb, extra = {}) => ({ groups: [{ group: name, wsMB: mb + 50, privateMB: mb, ...extra }, { group: 'code', wsMB: 700, privateMB: 600 }], system: [], outOfScope: { groupCount: 40, wsMB: 3000 } });
const single = {
  growth: () => scenario([
    ...baseline({ row: { usedPct: 92, procs: grp('node', 4800) } }),
    ...incident((i) => ({ row: { usedPct: 92, procs: grp('node', [4900, 5200, 5500, 5900, 6200][i]) } })),
  ]),
  dominance: () => scenario([
    ...baseline({ row: { usedPct: 70, procs: grp('java', 3000) } }),
    ...incident(() => ({ row: { usedPct: 70, procs: grp('java', 8000) } })),
  ]),
  balanced: () => scenario([
    ...baseline({ row: { usedPct: 70, procs: { groups: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ group: n, wsMB: 2500, privateMB: 2400 })), system: [], outOfScope: { groupCount: 10, wsMB: 1000 } } } }),
    ...incident(() => ({ row: { usedPct: 70, procs: { groups: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ group: n, wsMB: 2500, privateMB: 2400 })), system: [], outOfScope: { groupCount: 10, wsMB: 1000 } } } })),
  ]),
  small: () => scenario([
    ...baseline({ row: { usedPct: 70, procs: { groups: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ group: n, wsMB: 1300, privateMB: 1200 })), system: [], outOfScope: { groupCount: 10, wsMB: 1000 } } } }),
    ...incident(() => ({ row: { usedPct: 70, procs: { groups: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ group: n, wsMB: 1300, privateMB: 1200 })), system: [], outOfScope: { groupCount: 10, wsMB: 1000 } } } })),
  ]),
  // the largest memory holder is outside the declared scope: it exists only as an anonymous aggregate
  outOfScopeLargest: () => scenario([
    ...baseline({ row: { usedPct: 85, procs: { groups: [{ group: 'code', wsMB: 700, privateMB: 600 }], system: [], outOfScope: { groupCount: 60, wsMB: 9100 } } } }),
    ...incident(() => ({ row: { usedPct: 85, procs: { groups: [{ group: 'code', wsMB: 700, privateMB: 600 }], system: [], outOfScope: { groupCount: 60, wsMB: 9100 } } } })),
  ], { scope: ['code'] }),
};

// ---------------------------------------------------------------- thermal-power-throttle
const calmCpu = { cpuPct: 30, row: { cpu: { perfPct: 148, perfLimitPct: 0, throttleReasons: [] }, power: { ac: false } } };
const thermal = {
  // turbo laptop clamped at the hang, on battery, a thermal limit reported
  fires: () => scenario([
    ...baseline(calmCpu),
    ...incident((i) => ({ cpuPct: 85, row: { cpu: { perfPct: [71, 74, 80, 77, 75][i], perfLimitPct: 30, throttleReasons: ['thermal-zone-reasons:0x1'] }, power: { ac: false } } })),
  ]),
  // low performance only on idle probes; 140-150 at every hang
  idleDip: () => scenario([
    ...calm(14, 10, 1, {}).map((p, i) => (i % 4 === 0 ? { ...p, cpuPct: 5, row: { cpu: { perfPct: 40, perfLimitPct: 0, throttleReasons: [] }, power: { ac: true } } } : { ...p, ...calmCpu })),
    ...incident((i) => ({ cpuPct: 80, row: { cpu: { perfPct: [140, 145, 150, 148, 146][i], perfLimitPct: 0, throttleReasons: [] }, power: { ac: true } } })),
  ]),
  missingPerf: () => scenario([
    ...baseline({ cpuPct: 30 }),
    ...incident(() => ({ cpuPct: 85 })),
  ], { failures: [{ inference: 'power.throttled', collector: 'signals.cpu', mode: 'not-exposed', reason: 'processor performance counter returned no value' }] }),
  // power-limited on battery under an efficiency mode, no thermal evidence
  powerLimited: () => scenario([
    ...baseline({ cpuPct: 30, row: { cpu: { perfPct: 148, perfLimitPct: 0, throttleReasons: [] }, power: { ac: false, powerMode: 'best-power-efficiency' } } }),
    ...incident((i) => ({ cpuPct: 85, row: { cpu: { perfPct: 70, perfLimitPct: 35, throttleReasons: [] }, power: { ac: false, powerMode: 'best-power-efficiency' } } })),
  ]),
};

// ---------------------------------------------------------------- battery-power-plan
// n probes at a 30 s cadence starting at t0; hangs are the listed indexes
function side(n, t0, hangIdx, ac, row = {}) {
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * 30, ms: hangIdx.includes(i) ? 1500 : 200, ...(hangIdx.includes(i) ? { hang: true } : {}), row: { power: { ac, ...row } } }));
}
const battery = {
  // 6 hangs / 12 min on battery (24 probes), 3 hangs / 15 min on AC (30 probes)
  doubles: () => scenario([...side(24, 10, [3, 7, 11, 15, 19, 22], false), ...side(30, 10 + 24 * 30, [4, 14, 24], true)]),
  acOnly: () => scenario(side(40, 10, [6, 16, 26], true)),
  // single source, hangs under an efficiency mode while calm probes are on balanced
  acOnlyEfficiencyHangs: () => scenario(Array.from({ length: 40 }, (_, i) => {
    const h = [10, 20, 30].includes(i);
    return { t: 10 + i * 5, ms: h ? 1500 : 200, ...(h ? { hang: true } : {}), row: { power: { ac: true, powerMode: h ? 'best-power-efficiency' : 'balanced' } } };
  })),
  // 4 hangs / 10 min on battery (0.40/min), 4 hangs / 11 min on AC (0.36/min)
  equalRates: () => scenario([...side(20, 10, [2, 7, 12, 17], false), ...side(22, 10 + 20 * 30, [2, 8, 14, 19], true)]),
  noPowerData: () => scenario([...baseline({}), ...incident(() => ({}))]),
};

// ---------------------------------------------------------------- driver-interrupt-storm
const dpc = {
  fires: () => scenario([
    ...baseline({ row: { cpu: { dpcPct: 1, interruptPct: 0.2 } } }),
    ...incident((i) => ({ row: { cpu: { dpcPct: 9, interruptPct: 4 } } })),
  ]),
  quiet: () => scenario([
    ...baseline({ row: { cpu: { dpcPct: 1, interruptPct: 0.2 } } }),
    ...incident(() => ({ row: { cpu: { dpcPct: 1.5, interruptPct: 0.5 } } })),
  ]),
  legacyKeys: () => scenario([
    ...baseline({ row: { dpcPct: 1, intrPct: 0.2 } }),
    ...incident(() => ({ row: { dpcPct: 8, intrPct: 5 } })),
  ]),
  noData: () => scenario([...baseline({}), ...incident(() => ({}))]),
};

// ---------------------------------------------------------------- gpu-contention
const gpu = {
  fires: () => scenario([
    ...baseline({ row: { gpu: { totalUtilPct: 20, vramUsedMB: 1000 } } }),
    ...incident((i) => ({ row: { gpu: { totalUtilPct: [94, 97, 99, 98, 95][i], vramUsedMB: 3000 } } })),
  ]),
  quiet: () => scenario([
    ...baseline({ row: { gpu: { totalUtilPct: 20, vramUsedMB: 1000 } } }),
    ...incident(() => ({ row: { gpu: { totalUtilPct: 40, vramUsedMB: 3000 } } })),
  ]),
  noData: () => scenario([...baseline({}), ...incident(() => ({ row: { gpu: { totalUtilPct: null, vramUsedMB: null, reason: 'not-exposed' } } }))],
    { failures: [{ inference: 'gpu.util_total', collector: 'signals.gpu', mode: 'not-exposed', reason: 'counters not exposed' }] }),
  vramFull: () => scenario([
    ...baseline({ row: { gpu: { totalUtilPct: 20, vramUsedMB: 1000 } } }),
    ...incident(() => ({ row: { gpu: { totalUtilPct: 40, vramUsedMB: 7900 } } })),
  ], { extra: { systemProfile: { graphics: { adapters: { value: [{ name: 'GPU', dedicatedMB: 8192 }] } } } } }),
};

// ---------------------------------------------------------------- memory-led combination (VM + dominance + commit limit)
const combined = () => scenario([
  ...baseline({ commit: 60, availMB: 5000, row: { usedPct: 70, mem: { pagefileUsePct: 38 }, procs: sys({ member: 'vmmem', wsMB: 2000, privateMB: 2000 }) } }),
  ...incident((i) => ({ commit: [93, 94, 95, 96, 96][i], availMB: [410, 450, 500, 600, 560][i], row: { usedPct: 92, mem: { pagefileUsePct: [40, 42, 44, 46, 46][i] }, procs: sys({ member: 'vmmem', wsMB: 7500, privateMB: 7500 }) } })),
], { workload: wl(NO_CAP) });

module.exports = { commit, thrash, vm, db, single, thermal, battery, dpc, gpu, combined, side, seq };
