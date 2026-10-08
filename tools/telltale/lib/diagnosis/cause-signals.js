'use strict';
// Signals read by the cause rules of diagnosis-cause-rules, registered with the engine's signal registry (the engine
// does not change). Each accessor reads ONE stored probe row (plain, record-free) and returns a number or null;
// null means "not recorded", never zero. Requiring this module registers the signals once; it performs no I/O.
const signals = require('./signals');

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const bool01 = (b) => (b === true ? 1 : b === false ? 0 : null);

// the virtualization host process groups (WSL2 / container VM, Hyper-V worker)
const VM_HOST_RE = /^(vmmem[a-z0-9]*|vmwp)(\.exe)?$/i;
// in-scope database process groups (a name the user declared; an out-of-scope database never reaches a row with its name)
const DB_GROUP_RE = /^(postgres(ql)?|pg_ctl|mysqld?|mariadbd|sqlservr|mongod|redis-server|oracle)(\.exe)?$/i;

const memOf = (g) => (g && num(g.privateMB) !== null && g.privateMB > 0 ? g.privateMB : (g ? num(g.wsMB) : null));
const ioOf = (g) => {
  if (!g) return null;
  const a = num(g.readBps), b = num(g.writeBps);
  return a === null && b === null ? null : (a || 0) + (b || 0);
};
// a group by name among the in-scope groups, then the fixed system set (never the anonymous out-of-scope aggregate)
function findGroup(row, name) {
  const p = row && row.procs;
  if (!p) return null;
  const g = Array.isArray(p.groups) ? p.groups.find((x) => x && x.group === name) : null;
  if (g) return g;
  return Array.isArray(p.system) ? p.system.find((x) => x && x.member === name) || null : null;
}
function vmHosts(row) {
  const p = row && row.procs;
  if (!p || !Array.isArray(p.system)) return null;
  const hosts = p.system.filter((x) => x && VM_HOST_RE.test(String(x.member || '')));
  return hosts;
}
const usedMB = (row, env) => {
  if (env.totalMB && num(row.usedPct) !== null) return env.totalMB * row.usedPct / 100;
  if (env.totalMB && num(row.availMB) !== null) return env.totalMB - row.availMB;
  return null;
};

signals.register('mem.commit_of_limit_pct', { unit: '%', failureKeys: ['mem.commit', 'signals.memory'], get: (r) => {
  const b = r.mem && num(r.mem.committedBytes), l = r.mem && num(r.mem.commitLimitBytes);
  if (b !== null && l > 0) return r1(b / l * 100);
  return r.mem && r.mem.committedPct !== undefined ? r.mem.committedPct : r.committed;
} });
signals.register('mem.pagefile_pct', { unit: '%', failureKeys: ['mem.pagefile', 'signals.memory'], get: (r) => (r.mem && r.mem.pagefileUsePct !== undefined ? r.mem.pagefileUsePct : r.pagefile) });
signals.register('mem.pages_out_per_s', { unit: '/s', failureKeys: ['mem.pagesOutPerS', 'signals.memory'], get: (r) => (r.mem ? r.mem.pagesOutPerS : null) });
signals.register('mem.pages_in_per_s', { unit: '/s', failureKeys: ['mem.pagesInPerS', 'signals.memory'], get: (r) => (r.mem && r.mem.pagesInPerS !== undefined ? r.mem.pagesInPerS : r.pagesIn) });
signals.register('mem.modified_mb', { unit: 'MB', failureKeys: ['mem.modified'], get: (r) => r.modifiedMB });
signals.register('mem.used_pct', { unit: '%', get: (r) => r.usedPct });
signals.register('cpu.perf_pct', { unit: '% of base', failureKeys: ['cpu.perfPct', 'power.throttled', 'signals.cpu'], get: (r) => (r.cpu ? r.cpu.perfPct : null) });
signals.register('cpu.perf_limit_pct', { unit: '%', failureKeys: ['cpu.perfLimitPct', 'power.throttled', 'signals.cpu'], get: (r) => (r.cpu ? r.cpu.perfLimitPct : null) });
signals.register('cpu.throttle_flag', { unit: 'flag (1 = limit reported)', failureKeys: ['cpu.throttleReasons', 'power.throttled', 'signals.cpu'], get: (r) => (r.cpu && Array.isArray(r.cpu.throttleReasons) ? (r.cpu.throttleReasons.length ? 1 : 0) : null) });
signals.register('cpu.dpc_intr_pct', { unit: '%', failureKeys: ['cpu.dpcPct', 'cpu.interruptPct', 'signals.cpu'], get: (r) => {
  const d = r.cpu && r.cpu.dpcPct !== undefined ? num(r.cpu.dpcPct) : num(r.dpcPct);
  const i = r.cpu && r.cpu.interruptPct !== undefined ? num(r.cpu.interruptPct) : num(r.intrPct);
  return d === null || i === null ? null : r1(d + i);
} });
signals.register('gpu.engine_util_pct', { unit: '%', failureKeys: ['gpu.totalUtilPct', 'gpu.util_total', 'signals.gpu'], get: (r) => (r.gpu && r.gpu.totalUtilPct !== undefined ? r.gpu.totalUtilPct : r.gpuTotal) });
signals.register('gpu.vram_used_mb', { unit: 'MB', failureKeys: ['gpu.vramUsedMB', 'signals.gpu'], get: (r) => (r.gpu ? r.gpu.vramUsedMB : null) });
signals.register('power.on_ac', { unit: 'flag (1 = AC)', failureKeys: ['power.on_wall_power'], get: (r) => bool01(r.power && typeof r.power.ac === 'boolean' ? r.power.ac : r.plugged) });
signals.register('power.on_battery', { unit: 'flag (1 = battery)', failureKeys: ['power.on_wall_power'], get: (r) => {
  const a = bool01(r.power && typeof r.power.ac === 'boolean' ? r.power.ac : r.plugged);
  return a === null ? null : 1 - a;
} });
// 1 when an efficiency power mode or Energy Saver is active, 0 when both are known and off, null when neither is known
signals.register('power.efficiency_mode', { unit: 'flag (1 = efficiency mode or energy saver)', failureKeys: ['power.mode', 'power.energy_saver'], get: (r) => {
  const p = r.power;
  if (!p) return null;
  const mode = typeof p.powerMode === 'string' ? p.powerMode : null;
  const saver = typeof p.energySaver === 'boolean' ? p.energySaver : null;
  if (mode === 'best-power-efficiency' || saver === true) return 1;
  return mode !== null || saver !== null ? 0 : null;
} });
signals.register('thermal.cpu_c', { unit: 'C', failureKeys: ['thermal.zones'], get: (r) => {
  const z = r.thermal && Array.isArray(r.thermal.zones) ? r.thermal.zones.filter((x) => x && x.role === 'cpu' && num(x.c) !== null) : [];
  return z.length ? Math.max(...z.map((x) => x.c)) : null;
} });
signals.register('proc.vm_host_mb', { unit: 'MB', failureKeys: ['proc.cpu_io', 'signals.procs'], get: (r) => {
  const h = vmHosts(r);
  if (h === null) return null;                       // no process data on this probe
  return h.length ? Math.round(h.reduce((a, g) => a + (memOf(g) || 0), 0)) : 0; // no VM host group listed: 0 MB held by one
} });
signals.register('proc.vm_host_pct_ram', { unit: '% of RAM', failureKeys: ['proc.cpu_io', 'signals.procs'], get: (r, e) => {
  const h = vmHosts(r);
  if (h === null || !e.totalMB) return null;
  return r1((h.reduce((a, g) => a + (memOf(g) || 0), 0)) / e.totalMB * 100);
} });
signals.registerFamily('proc.group_mem_mb', { unit: 'MB', failureKeys: ['proc.cpu_io', 'signals.procs'], get: (r, e, g) => { void e; return memOf(findGroup(r, g)); } });
signals.registerFamily('proc.group_mem_pct_ram', { unit: '% of RAM', failureKeys: ['proc.cpu_io', 'signals.procs'], get: (r, e, g) => { const m = memOf(findGroup(r, g)); return m === null || !e.totalMB ? null : r1(m / e.totalMB * 100); } });
signals.registerFamily('proc.group_share_pct', { unit: '% of used memory', failureKeys: ['proc.cpu_io', 'signals.procs'], get: (r, e, g) => {
  const m = memOf(findGroup(r, g)), u = usedMB(r, e);
  return m === null || !(u > 0) ? null : r1(m / u * 100);
} });
signals.registerFamily('proc.group_io_bps', { unit: 'bytes/s', failureKeys: ['proc.cpu_io', 'signals.procs'], get: (r, e, g) => { void e; return ioOf(findGroup(r, g)); } });

// groups a rule may name: in-scope groups, then the system set; the out-of-scope aggregate carries no name and is never listed
function namedGroups(row) {
  const p = row && row.procs;
  if (!p) return [];
  return [...(Array.isArray(p.groups) ? p.groups.filter((g) => g && g.group).map((g) => g.group) : []),
    ...(Array.isArray(p.system) ? p.system.filter((g) => g && g.member).map((g) => g.member) : [])];
}

module.exports = { VM_HOST_RE, DB_GROUP_RE, memOf, ioOf, findGroup, vmHosts, usedMB, namedGroups };
