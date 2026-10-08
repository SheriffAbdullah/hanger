'use strict';
// Minimal synthetic reports for diagnosis tests: only the fields the engine reads, deterministic, no machine data.
// mkReport({ probes: [{ t, ms, commit, availMB, cpuPct, cpuQ, diskLat, diskQ, defender, procs, scopeShare, ... }], ... })
const T0 = Date.parse('2026-02-01T09:00:00.000Z');
const iso = (t) => new Date(T0 + Math.round(t * 1000)).toISOString();

const TH = { hang: 800, recovery: 400, commit: 85, minFreeGB: 2, pages: 500, queue: 4, diskSec: 0.025, defender: 20, ramHigh: 85 };

function probeRow(p) {
  const row = {
    at: iso(p.t), tSec: p.t, ms: p.ms ?? 150, hang: p.hang ?? ((p.ms ?? 150) >= TH.hang), slipS: p.slipS ?? 0,
    committed: p.commit ?? 60, availMB: p.availMB ?? 5000, pages: p.pages ?? 40, cpuPct: p.cpuPct ?? 30, cpuQ: p.cpuQ ?? 1,
    diskQ: p.diskQ ?? 0.2, diskSec: p.diskSec ?? 0.004, degraded: [],
  };
  if (p.diskLat !== undefined) row.disk = { latencyMs: p.diskLat, queue: p.diskQ ?? 0.2 };
  if (p.bundleMs !== undefined) row.bundleMs = p.bundleMs;
  for (const k of ['defender', 'procs', 'scopeShare', 'osConfirmed', 'osConfirmState', 'osHungWindows', 'osPollAt', 'culpritsAtHang']) if (p[k] !== undefined) row[k] = p[k];
  if (p.row) Object.assign(row, p.row); // any other stored field (mem, cpu, gpu, power, usedPct, modifiedMB, ...) passes through as given
  for (const k of ['committed', 'availMB', 'cpuPct', 'cpuQ', 'diskQ', 'diskSec']) if (p[`no_${k}`]) delete row[k];
  return row;
}

// n calm probes from t0 at the given step
const calm = (n, t0 = 10, step = 1, over = {}) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * step, ...over }));

function mkReport({ probes, logicalCpus = 12, scope = 'open', marks = [], thresholds = {}, settingsTh = {}, failures = [], events = null, workload = null, durationS = null, totalGB = 16, signalsNotes = null, heavyRuns = null, extra = null } = {}) {
  const rows = probes.map(probeRow);
  const last = Math.max(...probes.map((p) => p.t), 0);
  const th = { ...TH, ...thresholds };
  const sc = scope === 'open' ? { mode: 'open', source: 'default', entries: [] } : { mode: 'scoped', source: 'file', entries: scope.map((n) => ({ name: n })) };
  return {
    tool: 'telltale v0.6', schema: 'telltale-json/2', schemaStatus: 'frozen',
    run: { status: 'complete', startedAt: iso(0), endedAt: iso(durationS ?? last + 1) },
    startedAt: iso(0),
    window: { observedS: durationS ?? last },
    settings: { thresholds: Object.fromEntries(Object.keys(th).map((k) => [k, { value: th[k], source: settingsTh[k] || 'default' }])) },
    machine: { logicalCpus, cpus: logicalCpus, totalGB },
    scope: sc,
    summary: { thresholds: { ...th, sources: { hang: 'NN/g response limits [cited]', diskSec: 'MS SQL-IO guidance [cited]' } } },
    spawnProbes: rows,
    samples: [],
    userMarks: marks.map((m) => ({ tSec: m.t, at: iso(m.t), ...(m.kind ? { kind: m.kind } : {}), ...(m.note ? { note: m.note } : {}) })),
    'collection.failures': failures,
    ...(events ? { events } : {}),
    ...(workload ? { workload } : {}),
    ...(signalsNotes ? { signals: { notes: signalsNotes } } : {}),
    ...(heavyRuns ? { sampling: { heavyRuns } } : {}),
    ...(extra || {}),
  };
}

// a 26-probe baseline of calm probes (t 10..35) the way most scenarios start; extra probes are appended by the caller
const baseline = (n = 12, t0 = 10) => calm(n, t0, 1);

module.exports = { mkReport, calm, baseline, iso, T0, TH, probeRow };
