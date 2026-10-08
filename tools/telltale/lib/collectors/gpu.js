'use strict';
// GPU activity when the platform exposes it. WDDM exposes no total, so the total is derived: engines of one adapter
// and type are summed, and the busiest type is the total (Task Manager's rule). Per-process GPU data is on-trigger only,
// in-scope only (see perProcessOnTrigger); nothing per process is read on the continuous tick.
const { rows, unavailable } = require('./common');

const COUNTERS = ['\\GPU Adapter Memory(*)\\Dedicated Usage'];
const DYNAMIC = [{ path: '\\GPU Engine(*)\\Utilization Percentage', reducer: 'gpu' }];
const DERIVED_NOTE = 'derived: busiest engine type of the per-engine utilization sums (the platform exposes no total)';

// raw "pid_10192_luid_0x00000000_0x00011ee7_phys_0_eng_0_engtype_3d" and reduced "luid_0x00000000_0x00011ee7_engtype_3d" -> "luid|type"
function engineKey(inst) {
  const m = String(inst).toLowerCase().match(/luid_(0x[0-9a-f]+_0x[0-9a-f]+).*engtype_([a-z0-9_]*)$/);
  return m ? `${m[1]}|${m[2]}` : null;
}

function build(idx, { mk }) {
  const eng = rows(idx, 'gpu engine', 'utilization percentage');
  const sums = new Map();
  for (const r of eng) {
    if (!Number.isFinite(r.v)) continue;
    const k = engineKey(r.inst);
    if (k) sums.set(k, (sums.get(k) || 0) + r.v);
  }
  const total = sums.size ? Math.min(100, Math.max(...sums.values())) : null;
  const vram = rows(idx, 'gpu adapter memory', 'dedicated usage').filter((r) => Number.isFinite(r.v));
  const vramMB = vram.length ? vram.reduce((a, r) => a + r.v, 0) / 1048576 : null;
  const gpu = {
    totalUtilPct: mk(total, '%', { prec: 1, src: 'gpu.totalUtilPct@counterSession' }),
    vramUsedMB: mk(vramMB, 'MB', { prec: 1, src: 'gpu.vramUsedMB@counterSession' }),
  };
  if (total !== null) gpu.note = 'derived';
  else gpu.reason = 'not-exposed';
  const failures = [];
  if (total === null) failures.push(unavailable('signals.gpu', 'gpu.totalUtilPct', 'not-exposed', 'no GPU engine counters are exposed (basic display driver or no WDDM 2 adapter)'));
  if (vramMB === null) failures.push(unavailable('signals.gpu', 'gpu.vramUsedMB', 'not-exposed', 'no GPU adapter memory counters are exposed'));
  return { gpu, failures };
}

// On-trigger per-process GPU: {pid: {pct|mb, n}} maps are reduced to in-scope groups only. `groupOfPid(pid)` returns the
// in-scope group name or null (out of scope / system / unknown); nothing else is kept.
function perProcessByGroup(gsnap, groupOfPid) {
  const by = {};
  const add = (pid, field, v, n) => {
    const g = groupOfPid(pid);
    if (!g) return;
    const e = by[g] || (by[g] = { utilPct: null, vramMB: null, pids: 0 });
    e[field] = (e[field] || 0) + v;
    e.pids += field === 'utilPct' ? 1 : 0;
    void n;
  };
  const eng = gsnap && gsnap.engines && gsnap.engines.byPid;
  const mem = gsnap && gsnap.mem && gsnap.mem.byPid;
  if (eng) for (const [pid, e] of Object.entries(eng)) add(pid, 'utilPct', Number(e.pct) || 0, e.n);
  if (mem) for (const [pid, e] of Object.entries(mem)) add(pid, 'vramMB', Number(e.mb) || 0, e.n);
  for (const e of Object.values(by)) { if (e.utilPct !== null) e.utilPct = Math.round(e.utilPct * 10) / 10; if (e.vramMB !== null) e.vramMB = Math.round(e.vramMB * 10) / 10; }
  return by;
}

module.exports = { COUNTERS, DYNAMIC, DERIVED_NOTE, build, engineKey, perProcessByGroup, id: 'signals.gpu', inference: 'gpu.util_total' };
