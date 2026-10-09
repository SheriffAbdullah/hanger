'use strict';
// Signal registry: a named, unit-carrying accessor over one stored probe row. Rules and the reference
// resolver read values ONLY through this table, so a number in a finding can always be located again.
// A rule from another change registers its own signals with register(); the engine does not change.
const { plain } = require('../sampler/record');

const SIGNALS = new Map();
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

// get(row, env) -> number | null; env = {logicalCpus, defenderIsMachineShare}; row is a plain (record-free) probe
function register(name, { unit, get, failureKeys = [] }) { SIGNALS.set(name, { name, unit, get, failureKeys }); }
// A signal family is one registered accessor addressed as 'prefix[arg]' (e.g. a process group by name), so a stored
// reference such as 'proc.group_mem_mb[node]' resolves in any process, with no per-run registration.
// get(row, env, arg) -> number | null
const FAMILIES = new Map();
function registerFamily(prefix, { unit, get, failureKeys = [] }) { FAMILIES.set(prefix, { prefix, unit, get, failureKeys }); }
const FAMILY_RE = /^([A-Za-z0-9._]+)\[(.+)\]$/;
function lookup(name) {
  const s = SIGNALS.get(name);
  if (s) return { def: s, arg: undefined };
  const m = FAMILY_RE.exec(String(name || ''));
  const f = m ? FAMILIES.get(m[1]) : null;
  return f ? { def: f, arg: m[2] } : null;
}
const has = (name) => !!lookup(name);
const unitOf = (name) => { const l = lookup(name); return l ? l.def.unit : null; };
const failureKeysOf = (name) => { const l = lookup(name); return l ? l.def.failureKeys : []; };
function read(row, name, env = {}) {
  const l = lookup(name);
  if (!l || !row) return null;
  return num(l.def.get(row, env, l.arg));
}

register('latency.ms', { unit: 'ms', get: (r) => r.ms });
register('mem.committed_pct', { unit: '%', get: (r) => (r.mem && r.mem.committedPct !== undefined ? r.mem.committedPct : r.committed), failureKeys: ['mem.commit', 'mem.committed_pct', 'signals.memory'] });
register('mem.avail_mb', { unit: 'MB', get: (r) => r.availMB, failureKeys: ['mem.avail', 'mem.committed_pct'] });
register('mem.pages_per_s', { unit: '/s', get: (r) => r.pages });
register('cpu.pct_total', { unit: '%', get: (r) => r.cpuPct, failureKeys: ['cpu.total', 'sys.counters'] });
register('cpu.queue_per_lp', { unit: 'per logical processor', get: (r, e) => (num(r.cpuQ) !== null && e.logicalCpus > 0 ? r2(r.cpuQ / e.logicalCpus) : null), failureKeys: ['cpu.queue', 'sys.counters'] });
register('disk.latency_ms', { unit: 'ms', get: (r) => (r.disk && r.disk.latencyMs !== undefined ? r.disk.latencyMs : (num(r.diskSec) !== null ? r2(r.diskSec * 1000) : null)), failureKeys: ['disk.latency', 'signals.disk'] });
register('disk.queue', { unit: 'count', get: (r) => (r.disk && r.disk.queue !== undefined ? r.disk.queue : r.diskQ), failureKeys: ['disk.latency', 'disk.queue', 'signals.disk'] });
// storage-coverage: per-drive series (family addressed by the drive instance, for example 'disk.drive_latency_ms[0 C:]') and
// per-volume free space (family addressed by the letter). null = not recorded.
const driveOf = (r, id) => (r.disk && Array.isArray(r.disk.drives) ? r.disk.drives.find((x) => x && x.drive === id) || null : null);
const volumeOf = (r, id) => (r.disk && Array.isArray(r.disk.volumes) ? r.disk.volumes.find((x) => x && String(x.volume).toUpperCase() === String(id).toUpperCase()) || null : null);
registerFamily('disk.drive_latency_ms', { unit: 'ms', failureKeys: ['disk.drives', 'signals.disk'], get: (r, e, a) => { const d = driveOf(r, a); return d ? d.latencyMs : null; } });
registerFamily('disk.drive_queue', { unit: 'count', failureKeys: ['disk.drives', 'signals.disk'], get: (r, e, a) => { const d = driveOf(r, a); return d ? d.queue : null; } });
registerFamily('disk.drive_busy_pct', { unit: '%', failureKeys: ['disk.drives', 'signals.disk'], get: (r, e, a) => { const d = driveOf(r, a); return d ? d.busyPct : null; } });
registerFamily('disk.drive_io_bps', { unit: 'bytes/s', failureKeys: ['disk.drives', 'signals.disk'], get: (r, e, a) => { const d = driveOf(r, a); return d && (num(d.readBps) !== null || num(d.writeBps) !== null) ? (num(d.readBps) || 0) + (num(d.writeBps) || 0) : null; } });
registerFamily('disk.volume_free_pct', { unit: '%', failureKeys: ['disk.volumes', 'signals.disk'], get: (r, e, a) => { const v = volumeOf(r, a); return v ? v.freePct : null; } });
registerFamily('disk.volume_free_mb', { unit: 'MB', failureKeys: ['disk.volumes', 'signals.disk'], get: (r, e, a) => { const v = volumeOf(r, a); return v ? v.freeMB : null; } });
// lowest free percent across the relevant volumes (all volumes when none is identified)
const relevantVols = (r, e) => (r.disk && Array.isArray(r.disk.volumes) ? r.disk.volumes.filter((v) => v && num(v.freePct) !== null && (!e.relevantVolumes || e.relevantVolumes.includes(String(v.volume).toUpperCase()))) : []);
register('disk.relevant_free_pct', { unit: '%', failureKeys: ['disk.volumes', 'signals.disk'], get: (r, e) => { const v = relevantVols(r, e); return v.length ? Math.min(...v.map((x) => x.freePct)) : null; } });
register('disk.relevant_free_mb', { unit: 'MB', failureKeys: ['disk.volumes', 'signals.disk'], get: (r, e) => { const v = relevantVols(r, e).sort((a, b) => a.freePct - b.freePct)[0]; return v ? num(v.freeMB) : null; } });
// security-software CPU as a share of the whole machine (0-100). A stored per-core-scaled value is divided by the logical
// processor count here, so a raw 180 on 12 logical processors is read as 15 "% of machine".
register('security.cpu_pct_machine', { unit: '% of machine', get: (r, e) => {
  const sys = r.procs && Array.isArray(r.procs.system) ? r.procs.system.find((x) => x && x.member === 'Security software') : null;
  if (sys && num(sys.cpuPctMachine) !== null) return sys.cpuPctMachine;
  const flat = num(r.defender);
  if (flat === null) return null;
  if (e.defenderIsMachineShare) return flat;                  // reports from the data-signals-completeness collectors
  return e.logicalCpus > 0 ? r2(flat / e.logicalCpus) : null; // older per-core-scaled raw value
}, failureKeys: ['proc.cpu_io', 'signals.procs'] });

// the raw (un-normalized) stored value, kept beside a normalized input for traceability
function rawOf(row, name, env = {}) {
  if (name !== 'security.cpu_pct_machine' || !row) return null;
  const sys = row.procs && Array.isArray(row.procs.system) ? row.procs.system.find((x) => x && x.member === 'Security software') : null;
  if (sys && num(sys.cpuPctMachine) !== null) return null;
  return env.defenderIsMachineShare ? null : num(row.defender);
}

const rowsOf = (report) => (Array.isArray(report && report.spawnProbes) ? report.spawnProbes : []).map((p) => plain(p));
function envOf(report) {
  const m = (report && report.machine) || {};
  const notes = report && report.signals && report.signals.notes;
  return { logicalCpus: num(m.logicalCpus) || num(m.cpus) || null, totalMB: num(m.totalGB) ? m.totalGB * 1024 : null, defenderIsMachineShare: !!(notes && notes.defender), relevantVolumes: require('../storage').relevantVolumes(report) };
}

module.exports = { register, registerFamily, has, unitOf, failureKeysOf, read, rawOf, rowsOf, envOf, SIGNALS };
