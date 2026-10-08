'use strict';
// Per-process CPU and disk I/O, reduced through the scope resolver in memory BEFORE anything is stored.
// The counter session sums instances by process name; this module classifies each name:
//   in-scope  -> one named row            (user's allow-list; every name here is one the user declared)
//   system    -> one named row            (fixed published system set; security products collapse to one member)
//   out       -> anonymous aggregate only (group count, CPU share, I/O rates, working set; no names)
// CPU is stored as a share of the whole machine (0-100): raw per-core-scaled value / logical CPU count.
const scope = require('../scope');
const { rows, unavailable } = require('./common');

const DYNAMIC = [
  { path: '\\Process(*)\\% Processor Time', reducer: 'proc' }, { path: '\\Process(*)\\IO Read Bytes/sec', reducer: 'proc' },
  { path: '\\Process(*)\\IO Write Bytes/sec', reducer: 'proc' }, { path: '\\Process(*)\\Working Set', reducer: 'proc' },
  { path: '\\Process(*)\\Private Bytes', reducer: 'proc' },
];
const MB = 1048576;
const OPEN_CAP = 25;            // open scope names everything: keep the busiest groups per sample, aggregate the rest
const TOOL_PROCS = new Set(['node', 'powershell', 'pwsh']);
const r1 = (x) => Math.round(x * 10) / 10;
const r0 = (x) => Math.round(x);

// name -> {cpu, read, write, ws, priv, n} from the shared counter index
function byName(idx) {
  const m = new Map();
  const slot = (inst) => { const k = inst; let e = m.get(k); if (!e) { e = { name: inst, cpu: null, read: null, write: null, ws: null, priv: null, n: 1 }; m.set(k, e); } return e; };
  const feed = (counter, field) => { for (const r of rows(idx, 'process', counter)) if (Number.isFinite(r.v) && r.instL !== '_total') slot(r.inst)[field] = r.v; };
  feed('% processor time', 'cpu'); feed('io read bytes/sec', 'read'); feed('io write bytes/sec', 'write'); feed('working set', 'ws'); feed('private bytes', 'priv');
  for (const r of rows(idx, 'process', 'instances')) if (Number.isFinite(r.v) && m.has(r.inst)) m.get(r.inst).n = r.v;
  return m;
}

const memberLabel = (name) => {
  const cat = scope.systemCategory(name);
  if (cat === 'security') return 'Security software';
  return scope.SYSTEM_LABELS[scope.normName(name)] || name;
};

// a field is null when no instance of the group had a valid reading this tick (a new process has no rate yet)
function add(into, e, cpus) {
  if (e.cpu !== null) { into.cpu = (into.cpu || 0) + e.cpu / cpus; }
  if (e.read !== null) into.read = (into.read || 0) + e.read;
  if (e.write !== null) into.write = (into.write || 0) + e.write;
  into.ws += e.ws || 0; into.priv += e.priv || 0; into.n += e.n;
}
const fresh = () => ({ cpu: null, read: null, write: null, ws: 0, priv: 0, n: 0 });
const nz = (x, f) => (x === null ? null : f(x));
const shape = (e) => ({ cpuPctMachine: nz(e.cpu, (x) => Math.min(100, Math.max(0, r1(x)))), readBps: nz(e.read, r0), writeBps: nz(e.write, r0), wsMB: r0(e.ws / MB), privateMB: r0(e.priv / MB), instances: e.n });

// resolver: scope resolver (classifyName, noteOutName). logicalCpus: machine logical CPU count.
function build(idx, { resolver, logicalCpus, at, windowS = 2, descendantsNote = false }) {
  const cpus = Math.max(1, logicalCpus || 1);
  const names = byName(idx);
  const failures = [];
  const prov = { windowS, n: 1, src: 'procs.byGroup@counterSession', at, logicalCpus: cpus,
    units: { cpuPctMachine: '% of machine', readBps: 'bytes/s', writeBps: 'bytes/s', wsMB: 'MB', privateMB: 'MB', instances: 'count' },
    prec: { cpuPctMachine: 0.1, readBps: 1, writeBps: 1, wsMB: 1, privateMB: 1, instances: 1 } };
  if (!names.size) {
    failures.push(unavailable('signals.procs', 'proc.cpu_io', 'not-exposed', 'process counters returned no instances'));
    return { procs: { prov, groups: null, system: null, outOfScope: null, reason: 'not-exposed' }, failures };
  }
  const groups = [], system = new Map(), out = { ...fresh(), groupCount: 0 };
  for (const e of names.values()) {
    const cls = resolver.classifyName(e.name);
    if (cls === 'out') { resolver.noteOutName(e.name); add(out, e, cpus); out.groupCount++; continue; }
    if (cls === 'sys') {
      const label = memberLabel(e.name);
      let s = system.get(label); if (!s) { s = fresh(); system.set(label, s); }
      add(s, e, cpus);
      continue;
    }
    const g = fresh(); add(g, e, cpus);
    groups.push({ group: e.name, ...shape(g), ...(TOOL_PROCS.has(scope.normName(e.name)) ? { includesObserver: true } : {}) });
  }
  // no out-of-scope group at all means the aggregate is truly zero (not a missing reading)
  if (out.groupCount === 0) { out.cpu = 0; out.read = 0; out.write = 0; }
  groups.sort((a, b) => (b.cpuPctMachine || 0) - (a.cpuPctMachine || 0) || b.wsMB - a.wsMB);
  let otherInScope = null;
  if (groups.length > OPEN_CAP) {
    const rest = groups.splice(OPEN_CAP);
    const o = { cpu: 0, read: 0, write: 0, ws: 0, priv: 0, n: 0 };
    for (const g of rest) { o.cpu += g.cpuPctMachine || 0; o.read += g.readBps || 0; o.write += g.writeBps || 0; o.ws += g.wsMB * MB; o.priv += g.privateMB * MB; o.n += g.instances; }
    // groups here are already machine-share, so rebuild the shape without dividing again
    otherInScope = { groupCount: rest.length, cpuPctMachine: Math.min(100, r1(o.cpu)), readBps: r0(o.read), writeBps: r0(o.write), wsMB: r0(o.ws / MB), privateMB: r0(o.priv / MB), instances: o.n };
  }
  const procs = {
    prov,
    groups,
    system: [...system.entries()].map(([member, e]) => ({ member, ...shape(e) })).sort((a, b) => a.member.localeCompare(b.member)),
    outOfScope: { groupCount: out.groupCount, cpuPctMachine: nz(out.cpu, (x) => Math.min(100, r1(x))), readBps: nz(out.read, r0), writeBps: nz(out.write, r0), wsMB: r0(out.ws / MB) },
  };
  if (otherInScope) procs.otherInScope = otherInScope;
  if (descendantsNote) procs.scopeNote = 'descendants are matched by process name only in this series (parent links are not read per tick)';
  return { procs, failures };
}

module.exports = { DYNAMIC, build, byName, memberLabel, OPEN_CAP, id: 'signals.procs', inference: 'proc.cpu_io' };
