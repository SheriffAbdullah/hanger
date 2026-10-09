#!/usr/bin/env node
'use strict';
// Deterministic synthetic v2 reports (no real machine, user, or host data).
// Usage: node build-fixtures.js [outDir]            -> sample-r03.json, battery-1308.json, loaded-78s.json
//        node build-fixtures.js --sample <reportsDir> -> also regenerates sample-hanger.{json,md,report.html,email.txt}
const fs = require('fs');
const path = require('path');
const { buildCoreReport } = require('../../lib/core-report');
const { renderAll } = require('../../lib/render');
const scopeLib = require('../../lib/scope');
const { recordizeRow } = require('../../lib/sampler/records');
const { rec } = require('../../lib/sampler/record');
const { diagnose } = require('../../lib/diagnosis/engine');
const os = require('os');
const { buildInputStall } = require('../../lib/input/report');

const T0 = Date.parse('2026-01-15T10:00:00.000Z');
const TH = { hang: 800, commit: 85, minFreeGB: 2, pages: 500, queue: 4, diskSec: 0.025, ramHigh: 85, severeCommit: 90, severeFree: 1.5, defender: 20, recovery: 400 };
const TH_SRC = { hang: 'NN/g response limits [cited]', commit: 'MS perf troubleshooting [derived]' };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (v) => +v.toFixed(2);
const iso = (offS) => new Date(T0 + Math.round(offS * 1000)).toISOString();

function sampleAt(tSec, usedPct) {
  return { at: iso(tSec), tSec: r2(tSec), freeGB: r2(16 * (1 - usedPct / 100)), usedPct: r2(usedPct) };
}
function probeAt(tSec, o) {
  return {
    tSec: r2(tSec), at: iso(tSec), ms: o.ms, usedPct: r2(o.usedPct), hang: o.ms >= TH.hang, bundleMs: o.bundleMs ?? 180,
    slipS: o.slipS ?? 0, plugged: o.plugged, batteryPct: o.batteryPct ?? null, weightMs: { spawn: o.ms, bundle: o.bundleMs ?? 180 }, degraded: [],
    committed: r2(o.committed), pages: o.pages, cpuQ: o.cpuQ ?? 1, diskQ: o.diskQ ?? 0.2, diskSec: o.diskSec ?? 0.004, maxFreq: o.maxFreq ?? 100,
    ...(o.hang ? { culpritsAtHang: [{ name: 'node.exe', totalMB: 6200, n: 14, pids: [1100, 1104, 1108] }] } : {}),
  };
}

function assemble(name, { nominalS, intervalMs, samples, probes, marks = [], plugged, batteryPct, culprits, status = 'complete', workload = null }) {
  const state = {
    start: { at: iso(0), runStartMs: T0, tool: 'hanger v0.6', nominalS, intervalMs, tier: 'user', utcOffsetMin: 0, thresholds: { ...TH },
      settings: { duration: { value: nominalS, source: 'flag' }, interval: { value: intervalMs, source: 'config' }, anonymize: { value: true, source: 'config' },
        scope: { value: { mode: 'open' }, source: 'default' }, thresholds: Object.fromEntries(Object.entries(TH).map(([k, v]) => [k, { value: v, source: 'default' }])) } },
    samples, probes, marks, failures: [], lagProbes: [1.2, 0.8, 2.5, 1.1, 0.9],
    observer: { pidCount: 3, wsMB: 96, wsMBAvg: 90, cpuPctAvg: null, note: 'synthetic fixture' },
  };
  const core = buildCoreReport(state, { status, endedAt: iso(core_end(samples, probes)), streamName: `hanger-${name}.jsonl` });
  // open scope (no allow-list), declared the same way a real run declares it; aggregates derived from the culprit rows
  const open = scopeLib.loadScope({ cfg: {}, args: [], cwd: path.join(__dirname, 'no-scope-file-here') });
  const openRes = scopeLib.createResolver(open.matcher, { open: true }).resolve(culprits.map((c, i) => ({ name: c.name, pid: 1100 + i, memMB: c.totalMB })), { measuredAt: new Date(iso(0)) });
  const fixtureScope = { decl: { ...open.decl, counts: { ...openRes.counts } }, agg: scopeLib.runAggregate(openRes) };
  const last = (k) => { const v = probes.map((p) => p[k]).filter(Number.isFinite); return v.length ? v[v.length - 1] : null; };
  const first = (k) => { const v = probes.map((p) => p[k]).filter(Number.isFinite); return v.length ? v[0] : null; };
  const rep = {
    tool: core.tool, schema: core.schema, schemaStatus: core.schemaStatus, registry: 'registry v0.4',
    run: core.run, window: core.window, settings: core.settings, observer: core.observer,
    tier: 'user', startedAt: iso(0), hostname: '<host>', anonymized: true,
    machine: { totalGB: 16, cpus: 8, cpuModel: 'Synthetic CPU 8-thread', uptimeMin: 1234.5 },
    systemProfile: synthProfile(),
    power: { scheme: 'Power Scheme GUID: 00000000-0000-0000-0000-000000000000  (Balanced)', plugged, batteryPct },
    admin: { tier: 'user', skipped: 'process not elevated; re-run as admin for thermal/SMART/Sysmon/WER-sys/SeDebug' },
    wprEtl: null,
    gpu: { engines: { unavailable: 'synthetic fixture: no GPU data' }, mem: { unavailable: 'synthetic fixture: no GPU data' }, nvidia: { present: false, reason: 'synthetic fixture' }, bundleTotalNote: 'synthetic fixture' },
    summary: {
      ...core.summary,
      committedStart: first('committed'), committedEnd: last('committed'), pagesStart: first('pages'), pagesEnd: last('pages'), availMB: 4096, cpuQueue: 1, loopN: 5,
      thresholds: { ...TH, sources: TH_SRC, ideal: 'TBD (orders-framework ideal table)', status: 'provisional' },
      bundleOkProbes: `${probes.length}/${probes.length}`, loopConfoundNote: 'synthetic fixture', loopNote: null,
      warpSeenMB: null, openspecSeenMB: null, unresolvedNames: 0, werArchive: { total: 12, apphang: 3 },
      hangCount: 0,
    },
    hangEvents: core.hangEvents, userMarks: marks,
    culprits, privateTop: [{ name: 'node.exe', privateMB: culprits[0] ? culprits[0].totalMB : 0, instances: 14 }],
    topProcesses: culprits.map((c, i) => ({ name: c.name, pid: 1100 + i, memMB: c.totalMB })),
    scope: fixtureScope.decl, outOfScope: fixtureScope.agg,
    containers: null, containersNote: 'synthetic fixture: no daemon', flags: { hasChromeHeadless: false, hasDockerVmmem: false, hasWarp: false, hasOpenspec: false },
    events: { window: { from: iso(-60), to: iso(core_end(samples, probes)), leadS: 60 }, mode: 'none-in-window', inWindow: { appHang: [], appCrash: [], resourceExhaustion: [] },
      history: { appHang: { count: 1, newest: '2026-01-14T09:00:00.000Z', countCapped: false }, appCrash: { count: 0, newest: null, countCapped: false }, resourceExhaustion: { count: 0, newest: null, countCapped: false } } },
    wer: { archivePresent: true, searchedWindow: { from: iso(0), to: iso(core_end(samples, probes)) }, inRun: { total: 0, apphang: 0 }, history: { total: 12, apphang: 3, window: 'all-time', capped: false } },
    docker: { present: false, containers: { total: 0, inScope: [], outOfScopeCount: 0 }, statsOutOfScopeCount: 0, wsl: { present: false, distros: [], outOfScopeCount: 0 } }, disk: 'C: 190.0/460.0GB free', errors: [],
    'collection.failures': core['collection.failures'], spawnProbes: core.spawnProbes, samples: core.samples,
    ...(workload ? { workload } : {}),
  };
  rep.diagnosis = diagnose(rep);
  return rep;
}
// deterministic synthetic system profile (no real machine data): fact records {value|null, unit?, source, tier, asOf, unavailableReason?}
function synthProfile() {
  const asOf = '2026-01-15T10:00:00.000Z';
  const f = (value, source, o = {}) => ({ value, ...(o.unit ? { unit: o.unit } : {}), source, tier: o.tier || 'user', asOf, ...(value === null ? { unavailableReason: o.why || 'not available' } : {}) });
  return {
    collectedAt: asOf, collectionMs: 1200, tier: 'user', workloadConfigRef: null, groupStatus: {},
    identity: { hostname: f('<host>', 'os'), manufacturer: f('Synthetic Corp', 'firmware-system-info'), model: f('SX-1 Laptop', 'firmware-system-info'), serial: f('SYN0000001', 'firmware-bios') },
    processor: { model: f('Synthetic CPU 8-thread', 'cpu-info'), physicalCores: f(4, 'cpu-info', { unit: 'cores' }), logicalProcessors: f(8, 'cpu-info', { unit: 'threads' }), baseClockMHz: f(2400, 'cpu-info', { unit: 'MHz' }), maxClockMHz: f(null, 'cpu-info', { unit: 'MHz', why: 'max turbo clock not exposed at user tier' }) },
    memory: { installedGB: f(16, 'physical-memory-info', { unit: 'GB' }), modules: f([{ slot: 'Slot 1', sizeGB: 16, speedMTs: 3200, formFactor: 'SODIMM' }], 'physical-memory-info'), slotsUsed: f(1, 'physical-memory-info'), slotsTotal: f(2, 'physical-memory-info') },
    storage: { disks: f([{ model: 'Synthetic NVMe 512', mediaType: 'SSD', bus: 'NVMe', capacityGB: 512, health: 'Healthy' }], 'physical-disk-info'), systemVolume: f({ volume: 'C:', freeGB: 190, totalGB: 460 }, 'logical-disk-info', { unit: 'GB' }) },
    firmware: { biosVendor: f('Synthetic', 'firmware-bios'), biosVersion: f('SYN 1.02', 'firmware-bios'), biosDate: f('2025-06-01', 'firmware-bios') },
    os: { edition: f('Windows 11 Pro', 'os-info'), version: f('10.0.26200', 'os-info'), build: f('26200', 'os-info'), uptimeMin: f(1234, 'os-info', { unit: 'min' }) },
    power: { planName: f('Balanced', 'powercfg'), powerMode: f('Balanced', 'powercfg'), batteryDesignWh: f(null, 'battery-static-data', { unit: 'Wh', why: 'requires admin' }) },
    virtualMemory: { pagefiles: f([{ location: 'C:\pagefile.sys', currentMB: 2048, initialMB: 4096, maxMB: 8192 }], 'pagefile-info'), systemManaged: f(false, 'pagefile-info'), commitLimitGB: f(24, 'os-info', { unit: 'GB' }) },
    security: { products: f([{ name: 'Synthetic Defender', state: 'enabled' }], 'security-center'), domainJoined: f(false, 'domain-join-info') },
  };
}
function core_end(samples, probes) {
  return Math.max(...samples.map((s) => s.tSec), ...probes.map((p) => p.tSec)) + 0.1;
}

function buildSampleR03() {
  const rnd = rng(3);
  const samples = [1, 2, 3, 4, 5, 15, 16, 17, 18, 19].map((t, i) => sampleAt(t, 66 + rnd() * 3 + i * 0.2));
  const commits = [52.4, 55.1, 58.9, 61.7, 64.8];
  const probes = [2.0, 11.0, 14.0, 17.0, 19.5].map((t, i) => probeAt(t, { ms: 140 + Math.round(rnd() * 90), usedPct: 66 + i, committed: commits[i], pages: 40 + Math.round(rnd() * 30), plugged: true, bundleMs: i === 0 ? 8849 : 210, slipS: i === 0 ? 0 : 0.2 }));
  return assemble('sample-r03', { nominalS: 10, intervalMs: 1000, samples, probes, plugged: true, batteryPct: null,
    culprits: [{ name: 'chrome.exe', friendly: 'Chrome browser', detail: 'Browser (tabs share processes)', totalMB: 2100, instances: 22, source: 'known' }] });
}

function buildBattery1308() {
  const rnd = rng(1308);
  const samples = [];
  for (let i = 1; i <= 60; i++) samples.push(sampleAt(i + 0.3 + rnd() * 0.2, 80 + (i / 60) * 12 + rnd() * 2));
  const hangAtProbe = new Set([8, 12, 17, 22, 27]);
  const probes = [];
  for (let k = 1; k <= 30; k++) {
    const hang = hangAtProbe.has(k);
    probes.push(probeAt(k * 2 + 0.5, { ms: hang ? 900 + k * 40 : 120 + Math.round(rnd() * 150), usedPct: 80 + (k / 30) * 12, committed: 78 + (k / 30) * 14, pages: hang ? 900 + k * 10 : 60 + Math.round(rnd() * 200), plugged: false, batteryPct: 61 - Math.floor(k / 10), cpuQ: hang ? 6 : 1, maxFreq: 100, hang }));
  }
  return assemble('battery-1308', { nominalS: 60, intervalMs: 1000, samples, probes, marks: [{ tSec: 17.2, at: iso(17.2) }], plugged: false, batteryPct: 58,
    culprits: [{ name: 'node.exe', friendly: 'Node.js runtime', detail: 'Node.js runtime (4.8 GB at start, 6.2 GB at end)', totalMB: 6349, instances: 14, source: 'known' },
      { name: 'chrome.exe', friendly: 'Chrome browser', detail: 'Browser (tabs share processes)', totalMB: 2400, instances: 18, source: 'known' }] });
}

function buildLoaded78() {
  const rnd = rng(78);
  const samples = [];
  for (let i = 0; i < 40; i++) samples.push(sampleAt(1.95 * (i + 1), 70 + rnd() * 6));
  const probes = [];
  for (let k = 1; k <= 10; k++) {
    const t = samples[k * 4 - 1].tSec;
    const hang = k === 5;
    probes.push(probeAt(t, { ms: hang ? 6000 : 150 + Math.round(rnd() * 100), usedPct: 72, committed: 70 + k, pages: 80 + Math.round(rnd() * 100), plugged: true, slipS: r2(t - (k * 4 * 0.5)), hang }));
  }
  return assemble('loaded-78s', { nominalS: 20, intervalMs: 500, samples, probes, plugged: true, batteryPct: null,
    culprits: [{ name: 'node.exe', friendly: 'Node.js runtime', detail: 'Node.js runtime', totalMB: 3100, instances: 9, source: 'known' }] });
}

function buildAll() {
  return { 'sample-r03.json': buildSampleR03(), 'battery-1308.json': buildBattery1308(), 'loaded-78s.json': buildLoaded78() };
}

function writeAll(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const all = buildAll();
  for (const [f, rep] of Object.entries(all)) fs.writeFileSync(path.join(outDir, f), JSON.stringify(rep, null, 2) + '\n');
  return all;
}

// the shipped sample is the synthetic memory-pressure fixture (battery-1308: 5 probe hangs, a ranked cause, a user mark), rendered to MD and HTML from its JSON
// the shipped sample is the stored provenance form: value records on every probe/sample/hang row + a sampling section
function toProvenance(rep) {
  const out = JSON.parse(JSON.stringify(rep));
  out.spawnProbes = out.spawnProbes.map((p) => recordizeRow(p, { src: 'synthetic.counterBundle' }));
  out.samples = out.samples.map((x) => recordizeRow(x, { src: 'synthetic.os.freemem', windowS: 0 }));
  out.hangEvents = out.hangEvents.map((h) => ({ ...recordizeRow(h, { src: 'synthetic.counterBundle' }), label: h.label, context: h.context }));
  const at = out.run.endedAt;
  const mk = (v, unit, src, prec) => rec(v, { unit, windowS: out.window.observedS, n: out.spawnProbes.length, src, at, prec });
  out.sampling = {
    provenance: true,
    cadence: { nominalS: 2, achievedMedianS: 2.05, achievedP95S: 2.4, n: 29, basis: 'synthetic fixture' },
    unobserved: [], heavyRuns: [],
    observer: { cpuS: mk(0.6, 's', 'synthetic.observer'), cpuPctOneLogical: mk(1, '%', 'synthetic.observer'), peakPrivateMB: mk(96, 'MB', 'synthetic.observer'),
      ioReadMB: mk(2, 'MB', 'synthetic.observer'), ioWriteMB: mk(0, 'MB', 'synthetic.observer'), launchesPerMin: { continuous: 0, hangProbe: 30, onTrigger: 0, once: 0 },
      budget: { cpuPctLimit: 2, privateMBLimit: 150, exceeded: false, items: [] } },
    duration: { requestedS: out.settings.duration.value, usedS: out.settings.duration.value, source: out.settings.duration.source, clampReason: null, actualS: out.window.observedS },
  };
  out.diagnosis = diagnose(out); // recomputed on the stored (rounded) provenance form
  return out;
}

// the shipped sample also shows the input-response check: one felt stall (a 1.4 s wait right after typing in a monitored
// program) that the spawn probe did not see. Synthetic helper records, built through the real assembler.
function addInputStall(rep) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sample-input-'));
  const file = path.join(dir, 'hanger-sample-r03.input.jsonl');
  const L = (o) => JSON.stringify(o);
  const lines = [
    L({ type: 'input-helper', at: iso(0), mono: 0, build: 'cached', settings: { stallMs: 250, recentInputMs: 1000, mergeGapMs: 1000, lateMs: 200, tickMs: 250, timeoutMs: 1000 } }),
    L({ type: 'input-stall-sample', at: iso(12.0), mono: 12000, latencyMs: 1004.6, timeout: true, fg: { kind: 'in-scope', group: 'code' }, helperLate: false, osHung: false }),
    L({ type: 'input-stall-sample', at: iso(13.01), mono: 13010, latencyMs: 402.2, timeout: false, fg: { kind: 'in-scope', group: 'code' }, helperLate: false, osHung: false }),
    L({ type: 'input-window', from: iso(0), to: iso(10), durMs: 10000, evalMs: 3000, idleMs: 7000, skipMs: 0, measured: 12, stalls: 0, fgChanged: 0, latMedianMs: 1, latP95Ms: 4, latMaxMs: 6, lateN: 40, lateMedianMs: 1, lateP95Ms: 3, lateMaxMs: 9, groups: { code: { n: 12, over: 0 } }, active: [[1000, 4000]] }),
    L({ type: 'input-window', from: iso(10), to: iso(20), durMs: 10000, evalMs: 6000, idleMs: 4000, skipMs: 0, measured: 14, stalls: 2, fgChanged: 0, latMedianMs: 2, latP95Ms: 402, latMaxMs: 1005, lateN: 40, lateMedianMs: 1, lateP95Ms: 3, lateMaxMs: 9, groups: { code: { n: 14, over: 2 } }, active: [[1500, 7500]] }),
    L({ type: 'input-end', at: iso(20), status: 'orderly' }),
  ];
  fs.writeFileSync(file, lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
  const eff = { enabled: { value: true, source: 'default' }, stallMs: { value: 250, source: 'default' }, recentInputMs: { value: 1000, source: 'default' }, mergeGapMs: { value: 1000, source: 'default' }, lateMs: { value: 200, source: 'default' }, tickMs: { value: 250, source: 'default' }, timeoutMs: { value: 1000, source: 'default' }, ignoreGroups: { value: [], source: 'default' } };
  rep.settings.inputStall = eff;
  const hangs = (rep.spawnProbes || []).map((p, i) => ({ ref: `spawnProbes[${i}]`, atMs: Date.parse(p.at), ms: p.ms && p.ms.v !== undefined ? p.ms.v : p.ms, hang: !!(p.hang) })).filter((h) => h.hang);
  rep.inputStall = buildInputStall({ settings: eff, bridge: { status: 'running', build: 'cached', file: path.basename(file), at: iso(0) }, file, hangs, marksMs: [], workloadTimeoutsMs: [], runEndMs: Date.parse(iso(20)), nowIso: iso(20) });
  fs.rmSync(dir, { recursive: true, force: true });
  rep.diagnosis = diagnose(rep);
  return rep;
}

function writeSample(reportsDir) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const rep = addInputStall(toProvenance(buildBattery1308())); // the memory-pressure scenario: probe hangs with a ranked cause, a user mark and one felt stall
  fs.writeFileSync(path.join(reportsDir, 'sample-hanger.json'), JSON.stringify(rep, null, 2) + '\n');
  const out = renderAll(JSON.parse(JSON.stringify(rep)), { jsonName: 'sample-hanger.json', htmlName: 'sample-hanger.report.html', emailName: 'sample-hanger.email.txt', jsonBuf: fs.readFileSync(path.join(reportsDir, 'sample-hanger.json')) });
  fs.writeFileSync(path.join(reportsDir, 'sample-hanger.md'), out.md);
  fs.writeFileSync(path.join(reportsDir, 'sample-hanger.report.html'), out.html);
  fs.writeFileSync(path.join(reportsDir, 'sample-hanger.email.txt'), out.email);
  try { fs.unlinkSync(path.join(reportsDir, 'sample-hanger.html')); } catch { /* not present */ }
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const si = a.indexOf('--sample');
  if (si >= 0) { writeSample(path.resolve(a[si + 1])); console.log('wrote sample-hanger.{json,md,report.html,email.txt}'); } else {
    const out = path.resolve(a[0] || __dirname);
    writeAll(out);
    console.log(`wrote 3 fixtures to ${out}`);
  }
}
module.exports = { synthProfile, buildAll, writeAll, writeSample, toProvenance, TH, assemble, probeAt, sampleAt, iso, rng, T0 };
