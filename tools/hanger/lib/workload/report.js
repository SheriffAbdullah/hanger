'use strict';
// Builds report.workload and report.workloadConfig from the persisted run stream (wl-* records), so a
// recovered or interrupted run gets the same sections as a finished one. Pure: no clock, no I/O.
const { phasesFromRecords, phaseSummary } = require('./phases');
const { R } = require('./reasons');

const NO_PHASES = 'no workload phases were declared';
const NO_PROBE = 'no workload probe declared';
const NOT_POLLED = 'not collected (run ended before the first poll)';
const PROV_CONTAINERS = {
  cpuPct: { unit: '% of one logical CPU (runtime-reported; can exceed 100)', windowS: null, windowNote: 'runtime-defined, about 1-2 s', source: 'container-runtime stats' },
  memUsedMB: { unit: 'MB', windowS: 0, source: 'container-runtime stats' },
  memLimitMB: { unit: 'MB', windowS: 0, source: 'container-runtime stats' },
};

const ofType = (recs, t) => recs.filter((r) => r.type === t);
const strip = (r) => { const { type, ...rest } = r; void type; return rest; };

// numeric provenance values -> [{atMs, v}] per signal id
function signalsFromState(state) {
  const out = {};
  const push = (id, atMs, v) => { if (Number.isFinite(atMs) && Number.isFinite(v)) (out[id] || (out[id] = [])).push({ atMs, v }); };
  for (const c of state.csamples || []) {
    const t = Date.parse(c.at);
    for (const [k, x] of Object.entries(c)) if (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && typeof x.v === 'number') push(k, t, x.v);
  }
  for (const s of state.samples || []) { const x = s.usedPct; push('ramUsedPct', Date.parse(s.at), x && typeof x === 'object' ? x.v : x); }
  for (const p of state.probes || []) { const x = p.ms; push('spawnProbeMs', Date.parse(p.at), x && typeof x === 'object' ? x.v : x); }
  return out;
}

function buildWorkloadReport(state, { declared = null, runEndMs = null, scoped = true } = {}) {
  const recs = state.wl || [];
  const decl = declared || { phases: [], probes: [], config: [] };
  const phases = phasesFromRecords(recs);
  const summary = phases.length ? phaseSummary(phases, signalsFromState(state), { gaps: state.gaps || [], runEndMs }) : null;

  const markers = ofType(recs, 'wl-marker').map(strip);
  const contRecs = ofType(recs, 'wl-containers');
  const series = contRecs.flatMap((r) => r.series || []);
  const outOfScope = contRecs.map((r) => r.outOfScope).filter(Boolean);
  const unavail = ofType(recs, 'wl-unavail').filter((r) => r.what === 'containers');
  const lastCont = [...recs].reverse().find((r) => r.type === 'wl-containers' || (r.type === 'wl-unavail' && r.what === 'containers'));
  let contUnavailable = null;
  if (!lastCont) contUnavailable = { reason: NOT_POLLED, since: null };
  else if (lastCont.type === 'wl-unavail') contUnavailable = { reason: lastCont.reason, since: lastCont.at };
  const containers = {
    series, outOfScope,
    unavailable: contUnavailable,
    unavailablePeriods: unavail.map((r) => ({ at: r.at, reason: r.reason })),
    polls: { ok: contRecs.length, unavailable: unavail.length },
    provenance: PROV_CONTAINERS,
  };

  const vmRecs = ofType(recs, 'wl-vm');
  const hostSeries = vmRecs.filter((r) => Number.isFinite(r.hostMemMB)).map((r) => ({ at: r.at, value: r.hostMemMB }));
  const lastVm = vmRecs[vmRecs.length - 1] || null;
  const capRec = ofType(recs, 'wl-vmcap').pop();
  const cap = capRec ? capRec.cap : { value: null, unavailableReason: 'not collected', source: 'user VM config' };
  const guestSeries = vmRecs.filter((r) => r.guestMem && Number.isFinite(r.guestMem.value)).map((r) => ({ at: r.at, usedMB: r.guestMem.value, totalMB: r.guestMem.totalMB }));
  let guest;
  if (guestSeries.length) guest = { series: guestSeries, source: 'guest /proc/meminfo' };
  else if (lastVm && lastVm.guestMem) guest = { value: null, unavailableReason: lastVm.guestMem.unavailableReason };
  else guest = { value: null, unavailableReason: lastVm ? R.VM_STOPPED : NOT_POLLED };
  const vm = {
    hostMemMB: hostSeries,
    ...(hostSeries.length ? {} : { hostMemUnavailable: lastVm ? (lastVm.hostReason || R.VM_STOPPED) : NOT_POLLED }),
    hostProvenance: { unit: 'MB', windowS: 0, source: 'VM host process working set' },
    configuredCapMB: cap,
    guestMem: guest,
  };

  const probes = {};
  for (const name of decl.probes) probes[name] = [];
  for (const r of ofType(recs, 'wl-probe')) (probes[r.name] || (probes[r.name] = [])).push({ at: r.at, ms: r.ms, status: r.status });
  const probeStops = ofType(recs, 'wl-probe-stop').map((r) => ({ name: r.name, at: r.at, reason: r.reason }));
  const refused = ofType(recs, 'wl-probe-refused');
  const probeNote = !decl.probes.length ? NO_PROBE : refused.length ? refused[0].reason : null;

  const workloadConfig = ofType(recs, 'wl-config').flatMap((r) => r.facts || []);

  const workload = {
    declared: { phases: decl.phases, probes: decl.probes, config: decl.config },
    phases, phaseSummary: summary,
    ...(summary ? {} : { phasesNote: NO_PHASES }),
    markers,
    markersNote: scoped
      ? 'process markers have about 60 s resolution (taken from the periodic process snapshot); container markers about 10 s'
      : 'open scope: process lifecycle is not recorded; container lifecycle is',
    containers, vm,
    probes, ...(probeNote ? { probesNote: probeNote } : {}), ...(probeStops.length ? { probeStops } : {}),
  };
  return { workload, workloadConfig };
}

const p95Of = (arr) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(0.95 * arr.length))] : null);

// console run summary (phases, marker count, container status, probe p95)
function summaryLines(w) {
  if (!w) return [];
  const lines = [];
  const ph = w.phases.length ? `${w.phases.length} phase(s): ${w.phases.map((p) => `${p.label} ${p.endStatus}`).join(', ')}` : NO_PHASES;
  lines.push(`workload: ${ph}; ${w.markers.length} lifecycle marker(s)`);
  if (w.phaseSummary) {
    const rows = Object.entries(w.phaseSummary).filter(([, v]) => Object.entries(v).some(([k, s]) => k !== 'untaggedN' && s && s.n > 0)).slice(0, 4);
    for (const [id, v] of rows) {
      const sides = Object.entries(v).filter(([k]) => k !== 'untaggedN').map(([k, s]) => `${k} ${s.mean === null ? 'n/a' : s.mean} (p95 ${s.p95 === null ? 'n/a' : s.p95}, n=${s.n})`);
      lines.push(`  ${id}: ${sides.join(' | ')} | untagged ${v.untaggedN}`);
    }
  }
  const c = w.containers;
  const cs = c.series.length ? `${c.series.length} in-scope sample(s)` : c.unavailable ? `unavailable (${c.unavailable.reason})` : 'no in-scope container sample';
  lines.push(`  containers: ${cs}${c.outOfScope.length ? `; ${c.outOfScope.length} out-of-scope aggregate(s)` : ''}`);
  const cap = w.vm.configuredCapMB;
  lines.push(`  vm: host memory ${w.vm.hostMemMB.length ? `${w.vm.hostMemMB.length} sample(s)` : `unavailable (${w.vm.hostMemUnavailable})`}; cap ${cap.value !== null ? `${cap.value} MB` : cap.unavailableReason}`);
  const names = Object.keys(w.probes);
  if (!names.length) lines.push(`  probes: ${w.probesNote || NO_PROBE}`);
  for (const n of names) {
    const ok = w.probes[n].filter((p) => p.status === 'ok').map((p) => p.ms).sort((a, b) => a - b);
    const p95 = p95Of(ok);
    lines.push(`  probe ${n}: ${w.probes[n].length} attempt(s), ${w.probes[n].filter((p) => p.status === 'timeout').length} timeout(s), p95 ${p95 === null ? 'n/a' : `${p95} ms`}`);
  }
  return lines;
}

module.exports = { buildWorkloadReport, summaryLines, signalsFromState, NO_PHASES, NO_PROBE };
