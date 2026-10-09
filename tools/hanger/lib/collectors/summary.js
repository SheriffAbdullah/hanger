'use strict';
// Run-level views of the per-process series, computed from the persisted continuous samples (so an interrupted or
// recovered run gets them too) plus the footprint / commit rankings used by the group rollup.
//   rank(groups): footprint ranking is by working set, commit attribution is by private bytes (they differ on purpose:
//   a flat-WS process can hold the commit while a large-WS process holds mostly shared pages).
const { plain } = require('../sampler/record');

function rank(groups) {
  const list = (groups || []).filter(Boolean);
  const name = (g) => g.group || g.member || g.name;
  return {
    footprint: [...list].sort((a, b) => (b.wsMB || 0) - (a.wsMB || 0)).map((g) => ({ name: name(g), wsMB: g.wsMB })),
    commit: [...list].sort((a, b) => (b.privateMB || 0) - (a.privateMB || 0)).map((g) => ({ name: name(g), privateMB: g.privateMB })),
  };
}

const r1 = (x) => Math.round(x * 10) / 10;
function acc(map, key, row) {
  let e = map.get(key);
  if (!e) { e = { n: 0, cpuSum: 0, cpuN: 0, cpuPeak: null, readPeak: null, writePeak: null, wsPeak: 0, privPeak: 0 }; map.set(key, e); }
  e.n++;
  if (Number.isFinite(row.cpuPctMachine)) { e.cpuSum += row.cpuPctMachine; e.cpuN++; e.cpuPeak = e.cpuPeak === null ? row.cpuPctMachine : Math.max(e.cpuPeak, row.cpuPctMachine); }
  if (Number.isFinite(row.readBps)) e.readPeak = e.readPeak === null ? row.readBps : Math.max(e.readPeak, row.readBps);
  if (Number.isFinite(row.writeBps)) e.writePeak = e.writePeak === null ? row.writeBps : Math.max(e.writePeak, row.writeBps);
  e.wsPeak = Math.max(e.wsPeak, row.wsMB || 0); e.privPeak = Math.max(e.privPeak, row.privateMB || 0);
}
const fin = (map, label) => [...map.entries()].map(([k, e]) => ({ [label]: k, samples: e.n, cpuPctMachineMean: e.cpuN ? r1(e.cpuSum / e.cpuN) : null, cpuPctMachinePeak: e.cpuPeak,
  readBpsPeak: e.readPeak, writeBpsPeak: e.writePeak, wsMBPeak: e.wsPeak, privateMBPeak: e.privPeak }))
  .sort((a, b) => (b.cpuPctMachinePeak || 0) - (a.cpuPctMachinePeak || 0) || b.wsMBPeak - a.wsMBPeak);

// csamples: persisted continuous samples (stored form). Returns null when no sample carried per-process data.
function summarizeProcs(csamples) {
  const groups = new Map(), system = new Map();
  let outN = 0, outCpuSum = 0, outCpuN = 0, outCpuPeak = null, outReadPeak = null, outWritePeak = null, outWsPeak = 0, outGroupsMax = 0, n = 0, unavailable = 0;
  let logicalCpus = null, truncated = false;
  for (const raw of csamples || []) {
    const p = plain(raw.procs);
    if (p === undefined) continue;
    if (!p || !p.groups) { unavailable++; continue; }
    n++; logicalCpus = p.prov && p.prov.logicalCpus ? p.prov.logicalCpus : logicalCpus;
    for (const g of p.groups) acc(groups, g.group, g);
    for (const s of p.system || []) acc(system, s.member, s);
    if (p.otherInScope) truncated = true;
    const o = p.outOfScope;
    if (o) {
      outN++; outGroupsMax = Math.max(outGroupsMax, o.groupCount || 0);
      if (Number.isFinite(o.cpuPctMachine)) { outCpuSum += o.cpuPctMachine; outCpuN++; outCpuPeak = outCpuPeak === null ? o.cpuPctMachine : Math.max(outCpuPeak, o.cpuPctMachine); }
      if (Number.isFinite(o.readBps)) outReadPeak = outReadPeak === null ? o.readBps : Math.max(outReadPeak, o.readBps);
      if (Number.isFinite(o.writeBps)) outWritePeak = outWritePeak === null ? o.writeBps : Math.max(outWritePeak, o.writeBps);
      outWsPeak = Math.max(outWsPeak, o.wsMB || 0);
    }
  }
  if (!n && !unavailable) return null;
  return {
    samples: n, samplesWithoutProcessData: unavailable, logicalCpus,
    units: { cpuPctMachineMean: '% of machine', cpuPctMachinePeak: '% of machine', readBpsPeak: 'bytes/s', writeBpsPeak: 'bytes/s', wsMBPeak: 'MB', privateMBPeak: 'MB' },
    groups: fin(groups, 'group'), system: fin(system, 'member'),
    outOfScope: outN ? { samples: outN, groupCountMax: outGroupsMax, cpuPctMachineMean: outCpuN ? r1(outCpuSum / outCpuN) : null, cpuPctMachinePeak: outCpuPeak, readBpsPeak: outReadPeak, writeBpsPeak: outWritePeak, wsMBPeak: outWsPeak } : null,
    ...(truncated ? { note: 'open scope: only the busiest groups are stored per sample; the rest are summed in otherInScope' } : {}),
  };
}

module.exports = { rank, summarizeProcs };
