#!/usr/bin/env node
'use strict';
// Deterministic synthetic report fixtures for the report renderers (no real machine data).
//   full-signals.json  3 freezes, 2 user marks, AC->battery transition, 1 unobserved interval, a workload phase and a container start
//   zero-hang.json     the R03 sample case: 0 freezes, commit 52-65%
//   open-scope.json    open scope, 2 freezes
//   scoped-nothing-running.json  scoped to one program that is not running; everything else is an anonymous aggregate
//   gpu-present.json   GPU utilization series present
//   pack.json          an evidence pack
// Usage: node build-report-fixtures.js [outDir]   (default: ./report)
const fs = require('fs');
const path = require('path');
const { assemble, probeAt, sampleAt, iso, rng, synthProfile } = require('./build-fixtures');
const { diagnose } = require('../../lib/diagnosis/engine');

const SCOPED = (names, outGroups) => ({
  mode: 'allowlist', source: 'file', path: 'hanger.scope.json', sha256: 'a'.repeat(64),
  entries: names.map((n) => ({ name: n, includeDescendants: false })),
  matchRule: 'exact executable name (with or without .exe) or explicit * ? pattern',
  systemSet: { listVersion: 1, categories: ['os', 'security', 'virtualization'], names: [] },
  counts: { inScopeGroups: names.length, systemGroups: 12, outOfScopeGroups: outGroups }, fallbacks: [],
  statement: 'Names of software outside this scope were not recorded.',
});

// a run with rich per-probe blocks, hangs at the given probe seconds
function richRun(name, { hangsAt = [30, 40, 50], gpu = false, nProbes = 30, plugAt = 20, startMem = 1229, scoped = true } = {}) {
  const rnd = rng(7);
  const samples = [];
  for (let t = 1; t <= nProbes * 2 + 4; t += 1.5) samples.push(sampleAt(t, 66 + rnd() * 4 + (hangsAt.length ? Math.max(0, (t - 25) / 4) : 0)));
  const probes = [];
  for (let k = 0; k < nProbes; k++) {
    const t = 4 + k * 2;
    const hang = hangsAt.some((h) => Math.abs(h - t) < 1);
    const commit = hang ? 90 + rnd() * 2 : 60 + rnd() * 4;
    const base = probeAt(t, { ms: hang ? 1400 + Math.round(rnd() * 600) : 120 + Math.round(rnd() * 100), usedPct: hang ? 93 : 66 + rnd() * 3, committed: commit, pages: hang ? 900 : 50 + Math.round(rnd() * 60), plugged: t < plugAt, batteryPct: 80 - Math.floor(k / 3), cpuQ: hang ? 3 : 1, hang });
    const p = {
      ...base, availMB: hang ? 280 : 5200, cpuPct: hang ? 40 : 25 + rnd() * 10, defender: 3 + rnd() * 2, dpcPct: 0.8, intrPct: 0.5,
      cpu: { perfPct: 100 + rnd() * 20, perfLimitPct: 0, dpcPct: 0.8, interruptPct: 0.5 },
      mem: { committedPct: +commit.toFixed(1), pagefileUsePct: 5 + k * 0.1, pagesInPerS: hang ? 900 : 50, pagesOutPerS: hang ? 300 : 0 },
      disk: { latencyMs: 4, queue: 0.2, busyPct: 6, readBps: 1000000, writeBps: 2500000 },
      thermal: { zones: null, zonesReason: 'not exposed at user tier' },
      power: { ac: t < plugAt, hasBattery: true },
      procs: { groups: [{ group: 'postgres', wsMB: startMem + k * 30, privateMB: 1000, instances: 4 }, { group: 'docker', wsMB: 800, privateMB: 700, instances: 2 }],
        outOfScope: { groupCount: 41, cpuPctMachine: 10, readBps: 0, writeBps: 0, wsMB: 4200 }, prov: { src: 'procs.byGroup@counterSession' } },
    };
    if (gpu) p.gpu = { totalUtilPct: 20 + (hang ? 60 : rnd() * 10), vramUsedMB: 600 };
    probes.push(p);
  }
  const rep = assemble(name, { nominalS: nProbes * 2 + 8, intervalMs: 1000, samples, probes, marks: hangsAt.length ? [{ tSec: hangsAt[0] + 0.8, at: iso(hangsAt[0] + 0.8), kind: 'hung', note: 'terminal froze' }, { tSec: hangsAt[1] + 0.5, at: iso(hangsAt[1] + 0.5), kind: 'hung' }] : [], plugged: false, batteryPct: 60,
    culprits: [{ name: 'postgres.exe', friendly: 'PostgreSQL', detail: 'PostgreSQL server', totalMB: 2048, instances: 4, source: 'known', category: 'user' }] });
  rep.machine.logicalCpus = 8;
  rep.run.utcOffsetMin = 120;
  rep.power.hasBattery = true;
  rep.power.transitions = [{ at: iso(plugAt), from: 'ac', to: 'battery' }];
  rep.sampling = { cadence: { nominalS: 2, achievedMedianS: 2.05, achievedP95S: 2.4, n: nProbes, basis: 'synthetic fixture' }, unobserved: [{ start: iso(52), end: iso(55), durationS: 3, reason: 'collector-late' }], heavyRuns: [] };
  rep.workload = { declared: { phases: [], probes: [], config: [] }, phases: [{ label: 'docker compose up', startAt: iso(6), endAt: iso(42), endStatus: 'closed', source: 'flag' }], phaseSummary: null,
    markers: [{ at: iso(8), kind: 'container-start', name: 'db', id: 'c1' }], containers: { series: [], outOfScope: [], unavailable: null }, vm: { hostMemMB: [], configuredCapMB: { value: null, unavailableReason: 'no cap configured' } }, probes: {} };
  rep['collection.failures'] = [{ inference: 'container.state', collector: 'dockerState', mode: 'missing', reason: 'not installed', at: iso(60) }];
  rep.scope = scoped ? SCOPED(['postgres', 'docker'], 41) : rep.scope;
  if (scoped) rep.outOfScope = { groups: 41, processes: 130, memMB: 4200, cpuPctOfMachine: 10, inScope: { memMB: 2800, cpuPctOfMachine: 8 }, system: { memMB: 900, cpuPctOfMachine: 2 }, measuredAt: iso(60) };
  rep.hangEvents = rep.hangEvents.map((h) => ({ ...h, culpritsAtHang: [{ name: 'postgres.exe', totalMB: 2048 }] }));
  rep.diagnosis = diagnose(rep);
  return rep;
}

function buildAll() {
  const full = richRun('full-signals');
  const zero = require('./build-fixtures').buildAll()['sample-r03.json'];
  const open = richRun('open-scope', { hangsAt: [30, 44], scoped: false });
  const nothing = richRun('scoped-nothing-running', { hangsAt: [], scoped: true });
  nothing.scope = SCOPED(['postgres'], 52);
  nothing.outOfScope = { groups: 52, processes: 210, memMB: 7000, cpuPctOfMachine: 20, inScope: { memMB: 0, cpuPctOfMachine: 0 }, system: { memMB: 900, cpuPctOfMachine: 2 }, measuredAt: iso(60) };
  nothing.culprits = [];
  nothing.spawnProbes = nothing.spawnProbes.map((p) => ({ ...p, procs: { groups: [], outOfScope: { groupCount: 52, cpuPctMachine: 20, readBps: 0, writeBps: 0, wsMB: 7000 }, prov: p.procs.prov } }));
  nothing.diagnosis = diagnose(nothing);
  const gpu = richRun('gpu-present', { gpu: true });
  const pack = {
    tool: 'hanger pack/1', schema: 'hanger-pack/1', assembledAt: '2026-01-15T11:00:00.000Z', tier: 'user',
    scope: SCOPED(['postgres', 'docker'], 41), outOfScope: full.outOfScope, systemProfile: synthProfile(),
    sustained: { source: 'trace-window (no watch log; single-window, not sustained)', file: 'hanger-x.json', n: 30, windowS: 60, commitPeak: 92, pagesAvg: 120, note: 'run watch for multi-day sustained evidence' },
    hangs: { source: 'hanger-x.json', count: 3, hangRatePerMin: 3, n: 30, worstMs: 1900, p95Ms: 1800, thresholdMs: 800, events: [{ at: iso(30), tSec: 30, ms: 1900, usedPct: 93, committed: 91, pages: 900 }] },
    finding: full.diagnosis.finding, rollup: full.diagnosis.rollup, hwConfigSignal: null, timeLost: full.diagnosis.timeLost,
    admin: { tier: 'user', skipped: 'process not elevated' }, power: { plugged: false, batteryPct: 60, scheme: 'Balanced' },
    audit: { tier: 'user', anonymized: true, scopeSource: 'file', scopeMode: 'allowlist', thresholds: { hang: 800, commit: 85 }, thresholdSource: 'trace' },
    provenance: { traceReport: 'hanger-x.json', baselineFiles: [], unreadableReports: [], v1ReportsSkipped: [], sustainedBasis: 'trace-window', findingBasis: 'diagnosis stored in hanger-x.json' },
  };
  return { 'full-signals.json': full, 'zero-hang.json': zero, 'open-scope.json': open, 'scoped-nothing-running.json': nothing, 'gpu-present.json': gpu, 'pack.json': pack };
}

function writeAll(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const all = buildAll();
  for (const [f, rep] of Object.entries(all)) fs.writeFileSync(path.join(outDir, f), `${JSON.stringify(rep, null, 2)}\n`);
  return all;
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'report'));
  writeAll(out);
  console.log(`wrote ${Object.keys(buildAll()).length} report fixtures to ${out}`);
}
module.exports = { buildAll, writeAll };
