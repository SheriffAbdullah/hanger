'use strict';
// Time-series and annotation extraction for the report charts. Reads ONLY the report JSON:
// no re-collection, no re-inference (hang bands come from the stored diagnosis).
// All times are wall-clock epoch milliseconds taken from the per-row `at` fields.
const { isRec, plain } = require('../sampler/record');
const storage = require('../storage');

const get = (o, p) => String(p).split('.').reduce((a, k) => (a === null || a === undefined ? undefined : a[k]), o);
const numOf = (x) => { const v = isRec(x) ? x.v : x; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

// null value reason: a record's own reason, a sibling `<leaf>Reason`/`reason`, else null
function reasonNear(row, path) {
  if (!row) return null;
  const parts = String(path).split('.');
  const leaf = parts.pop();
  const parent = parts.length ? get(row, parts.join('.')) : row;
  const own = get(row, path);
  if (own && typeof own === 'object') { if (typeof own.reason === 'string') return own.reason; if (typeof own.unavailableReason === 'string') return own.unavailableReason; }
  if (parent && typeof parent === 'object') {
    if (typeof parent[`${leaf}Reason`] === 'string') return parent[`${leaf}Reason`];
    if (typeof parent.reason === 'string') return parent.reason;
  }
  return null;
}

// one series from rows: value paths tried in order (first path that has any data wins), or a derive function
function column(rows, paths, { derive = null, scale = 1 } = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  let best = null;
  for (const p of derive ? [null] : list) {
    const pts = [];
    let src = null;
    for (const r of rows) {
      const t = ms(r.at);
      if (t === null) continue;
      const raw = derive ? derive(r) : get(r, p);
      const v = derive ? (Number.isFinite(raw) ? raw : null) : numOf(raw);
      if (src === null && isRec(derive ? null : raw)) src = raw.src || null;
      pts.push({ t, v: v === null ? null : v * scale });
    }
    const n = pts.filter((q) => q.v !== null).length;
    if (!best || n > best.n) best = { pts, n, src, path: p };
    if (n > 0) break;
  }
  let reason = null;
  if (best && best.n === 0) for (const r of rows) { const rs = list.map((p) => reasonNear(r, p)).find(Boolean); if (rs) { reason = rs; break; } }
  return { pts: best ? best.pts : [], n: best ? best.n : 0, src: best ? best.src : null, reason };
}

function sum(...vals) { return vals.every((x) => x === null) ? null : vals.reduce((a, x) => a + (x || 0), 0); }

// hang windows come from the stored diagnosis (never recomputed); the legacy hang list is the fallback
function hangWindows(r) {
  const dh = r.diagnosis && Array.isArray(r.diagnosis.hangs) ? r.diagnosis.hangs : null;
  const src = dh || (r.hangEvents || []);
  return src.map((h, i) => {
    const t0 = ms(h.at);
    const dur = numOf(h.ms) || 0;
    return t0 === null ? null : { i: i + 1, t0, t1: t0 + dur, ms: dur, confirmedBy: h.confirmedBy || [], ref: h.ref || null };
  }).filter(Boolean);
}

function powerPeriods(probes, domain) {
  const rows = probes.map((p) => {
    let ac = p.plugged;
    if (ac !== true && ac !== false) { const a = get(p, 'power.ac'); ac = a === true || a === false ? a : null; }
    return { t: ms(p.at), ac };
  }).filter((x) => x.t !== null);
  const periods = [], boundaries = [];
  let cur = null;
  rows.forEach((x, idx) => {
    if (x.ac === null) { cur = null; return; }
    if (!cur || cur.ac !== x.ac) {
      if (cur) { boundaries.push({ t: x.t, from: cur.ac ? 'ac' : 'battery', to: x.ac ? 'ac' : 'battery' }); cur.t1 = x.t; }
      cur = { t0: x.t, t1: domain.t1, ac: x.ac };
      periods.push(cur);
    }
    if (idx === rows.length - 1 && cur) cur.t1 = domain.t1;
  });
  return { periods: periods.map((p) => ({ t0: p.t0, t1: p.t1, state: p.ac ? 'ac' : 'battery' })), boundaries };
}

function extract(raw) {
  const r = plain(raw);
  const probes = Array.isArray(raw.spawnProbes) ? raw.spawnProbes : [];
  const samples = Array.isArray(raw.samples) ? raw.samples : [];
  const stamps = [...probes, ...samples].map((x) => ms(x.at)).filter((t) => t !== null);
  let t0 = stamps.length ? Math.min(...stamps) : ms(r.run && r.run.startedAt || r.startedAt);
  let t1 = stamps.length ? Math.max(...stamps) : ms(r.run && r.run.endedAt);
  if (t0 === null) t0 = 0;
  if (t1 === null || t1 <= t0) t1 = t0 + 1000;
  const domain = { t0, t1 };
  const logical = numOf(get(r, 'machine.logicalCpus')) || numOf(get(r, 'machine.cpus')) || null;
  const off = Number.isFinite(get(r, 'run.utcOffsetMin')) ? get(r, 'run.utcOffsetMin') : null;

  const S = {};
  // freeze strip
  S.probeMs = column(probes, ['ms']);
  // memory
  S.ramUsed = samples.length ? column(samples, ['usedPct']) : column(probes, ['usedPct']);
  S.commit = column(probes, ['mem.committedPct', 'committed']);
  S.pagefile = column(probes, ['mem.pagefileUsePct', 'pagefile']);
  S.avail = column(probes, ['availMB']);
  S.pagesIn = column(probes, ['mem.pagesInPerS', 'pagesIn']);
  S.pagesOut = column(probes, ['mem.pagesOutPerS']);
  S.standby = column(probes, null, { derive: (p) => sum(numOf(p.standbyNormalMB), numOf(p.standbyCoreMB), numOf(p.standbyReserveMB)) });
  S.modified = column(probes, ['modifiedMB']);
  // CPU
  S.cpu = column(probes, ['cpuPct']);
  S.queue = column(probes, null, { derive: (p) => { const q = numOf(p.cpuQ); return q === null || !logical ? null : +(q / logical).toFixed(3); } });
  S.queue.src = S.queue.src || (probes[0] && isRec(probes[0].cpuQ) ? probes[0].cpuQ.src : null);
  S.defender = column(probes, ['defender']);
  S.dpcIntr = column(probes, null, { derive: (p) => { const d = numOf(get(p, 'cpu.dpcPct') ?? p.dpcPct), i = numOf(get(p, 'cpu.interruptPct') ?? p.intrPct); return d === null && i === null ? null : sum(d, i); } });
  // clock / thermal / power
  S.perf = column(probes, ['cpu.perfPct', 'maxFreq']);
  S.perfLimit = column(probes, ['cpu.perfLimitPct']);
  S.battery = column(probes, ['batteryPct', 'power.batteryPct']);
  const zones = new Map();
  let zonesReason = null;
  for (const p of probes) {
    const z = get(p, 'thermal.zones'); const t = ms(p.at);
    if (Array.isArray(z)) for (const q of z) { if (!zones.has(q.label)) zones.set(q.label, { label: q.label, role: q.role || 'other', pts: [] }); zones.get(q.label).pts.push({ t, v: numOf(q.c) }); }
    else if (!zonesReason) zonesReason = get(p, 'thermal.zonesReason') || get(p, 'thermal.reason') || null;
  }
  S.zones = [...zones.values()].map((z) => ({ ...z, n: z.pts.filter((q) => q.v !== null).length, max: Math.max(...z.pts.map((q) => (q.v === null ? -Infinity : q.v))) }));
  S.zonesReason = zonesReason;
  S.zonesSrc = (probes.find((p) => get(p, 'thermal.prov')) || {}).thermal ? get(probes.find((p) => get(p, 'thermal.prov')), 'thermal.prov.src') : null;
  S.hasBattery = get(r, 'power.hasBattery');
  // disk
  S.diskLat = column(probes, ['disk.latencyMs'], {});
  if (!S.diskLat.n) { const alt = column(probes, ['diskSec'], { scale: 1000 }); if (alt.n) S.diskLat = alt; }
  S.diskQ = column(probes, ['disk.queue', 'diskQ']);
  S.diskBusy = column(probes, ['disk.busyPct']);
  S.diskTput = column(probes, null, { derive: (p) => { const a = numOf(get(p, 'disk.readBps')), b = numOf(get(p, 'disk.writeBps')); return a === null && b === null ? null : +((((a || 0) + (b || 0)) / 1e6)).toFixed(3); } });
  S.diskTput.src = (probes.find((p) => isRec(get(p, 'disk.readBps'))) ? get(probes.find((p) => isRec(get(p, 'disk.readBps'))), 'disk.readBps.src') : null);
  // per physical drive (storage-coverage): one series each, beside the machine total; absent when the report predates them
  const driveOf = (p, d) => (p.disk && Array.isArray(p.disk.drives) ? p.disk.drives.find((y) => y && y.drive === d.drive) : null);
  const driveCol = (d, f) => {
    const col = column(probes, null, { derive: (p) => { const x = driveOf(p, d); return x ? numOf(x[f]) : null; } });
    col.src = 'disk.drive@counterSession';
    return col;
  };
  S.drives = storage.drivesSeen(r).map((d) => ({ ...d, lat: driveCol(d, 'latencyMs'), queue: driveCol(d, 'queue'), busy: driveCol(d, 'busyPct'),
    tput: column(probes, null, { derive: (p) => { const x = driveOf(p, d); const a = x ? numOf(x.readBps) : null, b = x ? numOf(x.writeBps) : null; return a === null && b === null ? null : +((((a || 0) + (b || 0)) / 1e6)).toFixed(3); } }) }));
  // GPU
  S.gpuUtil = column(probes, ['gpu.totalUtilPct']);
  S.gpuVram = column(probes, ['gpu.vramUsedMB']);

  // top in-scope processes (stacked working set) + the anonymous outside-scope aggregate
  const procTicks = [];
  for (const p of probes) {
    const pr = p.procs; const t = ms(p.at);
    if (!pr || t === null || !Array.isArray(pr.groups)) continue;
    const g = {};
    for (const x of pr.groups) { const v = numOf(x.wsMB); if (v !== null) g[x.group] = { v, observer: !!x.includesObserver }; }
    procTicks.push({ t, g, out: numOf(get(pr, 'outOfScope.wsMB')) });
  }
  const peak = new Map();
  for (const tk of procTicks) for (const [name, x] of Object.entries(tk.g)) peak.set(name, Math.max(peak.get(name) || 0, x.v));
  const top = [...peak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  S.procs = {
    ticks: procTicks, top,
    observerGroups: top.filter((n) => procTicks.some((tk) => tk.g[n] && tk.g[n].observer)),
    hasOutAgg: procTicks.some((tk) => tk.out !== null),
    src: (probes.find((p) => p.procs && isRec(p.procs.prov) === false && p.procs.prov) || {}).procs ? probes.find((p) => p.procs && p.procs.prov).procs.prov.src || null : null,
    omittedGroups: Math.max(0, peak.size - top.length),
  };

  // annotations
  const hangs = hangWindows(r);
  const marks = (r.userMarks || []).map((m) => ({ t: ms(m.at), kind: m.kind || null, note: m.note || null })).filter((m) => m.t !== null);
  const wl = r.workload || {};
  const phases = (wl.phases || []).map((p) => ({ label: p.label, t0: ms(p.startAt), t1: p.endAt ? ms(p.endAt) : domain.t1, open: !p.endAt })).filter((p) => p.t0 !== null);
  const markers = (wl.markers || []).map((m) => ({ t: ms(m.at), kind: m.kind, name: m.name })).filter((m) => m.t !== null);
  const pw = powerPeriods(probes, domain);
  const unobserved = ((r.sampling && r.sampling.unobserved) || []).map((u) => ({ t0: ms(u.start), t1: ms(u.end), reason: u.reason || null })).filter((u) => u.t0 !== null && u.t1 !== null);
  // automatically detected input-response stalls: foreground kind only, never a name for an out-of-scope application
  const is = r.inputStall;
  const inputStatus = !is || typeof is !== 'object' ? 'absent' : (is.status || 'unavailable');
  const stalls = inputStatus === 'running' && Array.isArray(is.episodes)
    ? is.episodes.map((e, i) => ({ i: i + 1, t0: ms(e.startAt), t1: ms(e.endAt), worstMs: numOf(e.worstLatencyMs), kind: e.foreground && e.foreground.kind })).filter((e) => e.t0 !== null && e.t1 !== null) : [];
  const inputReason = inputStatus === 'running' ? null : inputStatus === 'absent' ? 'report predates the input-response check' : (is.reason || null);
  const osConfirmed = hangs.filter((h) => h.confirmedBy.includes('os-not-responding')).map((h) => ({ t: h.t0, i: h.i }));

  return { r, raw, domain, off, logical, S, annotations: { hangs, stalls, inputStatus, inputReason, marks, phases, markers, power: pw.periods, boundaries: pw.boundaries, unobserved, osConfirmed }, thresholdMs: numOf(get(r, 'diagnosis.hangDefinition.thresholdMs')) ?? numOf(get(r, 'summary.hangThresholdMs')) ?? numOf(get(r, 'summary.thresholds.hang')) };
}

// wall-clock text; local when the run recorded its UTC offset, otherwise UTC
function clock(t, off) {
  const d = new Date(t + (off || 0) * 60000);
  return d.toISOString().slice(11, 19);
}
function offsetLabel(off) {
  if (off === null || off === undefined) return 'UTC';
  const a = Math.abs(off), h = String(Math.floor(a / 60)).padStart(2, '0'), m = String(a % 60).padStart(2, '0');
  return `UTC${off < 0 ? '-' : '+'}${h}:${m}`;
}
function dateText(t, off) { return new Date(t + (off || 0) * 60000).toISOString().slice(0, 10); }

module.exports = { extract, column, clock, offsetLabel, dateText, get, numOf, ms, hangWindows };
