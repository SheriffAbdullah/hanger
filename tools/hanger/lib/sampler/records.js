'use strict';
// Builds the stored provenance-record forms of samples, continuous bundles and probes.
// Working code may use plain numbers; everything that is persisted passes through here.
const { rec, isRec } = require('./record');
const { META } = require('./bundle');

const BUNDLE_SRC = 'counterBundle';

// plain bundle values {committed: 67.7, ...} -> {committed: rec, ...}; null stays a record with v null
function bundleToRecords(values, { at, windowS = 2, collectorId = BUNDLE_SRC } = {}) {
  const out = {};
  for (const [key, v] of Object.entries(values)) {
    const m = META[key];
    if (!m) continue;
    const mk = (x, sub) => rec(x, { unit: m.unit, windowS, n: 1, src: `${collectorId}.${key}${sub ? `.${sub}` : ''}@counterSession`, at, prec: m.prec });
    if (m.bag && v && typeof v === 'object') { out[key] = {}; for (const [k2, x] of Object.entries(v)) out[key][k2] = mk(x, k2); }
    else out[key] = mk(v);
  }
  return out;
}

// one continuous sample: counter-sample time + bundle records + power
function buildCSample({ atMs, values, power = null, seq, windowS = 2, runStartMs = null }) {
  const at = new Date(atMs).toISOString();
  const s = { at, seq, ...(runStartMs !== null ? { tSec: +((atMs - runStartMs) / 1000).toFixed(2) } : {}), ...bundleToRecords(values, { at, windowS }) };
  if (power) {
    const line = String(power.line || '');
    s.plugged = /online/i.test(line) ? true : /offline/i.test(line) ? false : null;
    const pct = Number(power.pct);
    s.batteryPct = rec(Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null, { unit: '%', windowS: 1, n: 1, src: 'powerSample.batteryPct@counterSession', at, prec: 1 });
  }
  return s;
}

// in-process RAM sample (not a counter-session value)
function buildRamSample({ atMs, tSec, freeGB, usedPct }) {
  const at = new Date(atMs).toISOString();
  return {
    at, tSec,
    freeGB: rec(freeGB, { unit: 'GB', windowS: 0, n: 1, src: 'os.freemem@process', at }),
    usedPct: rec(usedPct, { unit: '%', windowS: 0, n: 1, src: 'os.freemem@process', at }),
  };
}

// hang-probe row (the spawn-latency measurement); bundle values are merged in at report build
function buildProbe({ atMs, tSec, ms, hang, usedPct, slipS, bundleAt = null, plugged = null, extra = {} }) {
  const at = new Date(atMs).toISOString();
  return {
    at, tSec, hang,
    ms: rec(ms, { unit: 'ms', windowS: ms / 1000, n: 1, src: 'spawnProbe.latency@hangProbe', at }),
    usedPct: rec(usedPct, { unit: '%', windowS: 0, n: 1, src: 'os.freemem@process', at }),
    slipS: rec(slipS, { unit: 's', windowS: null, n: 1, src: 'scheduler.slip', at }),
    bundleAt, plugged,
    degraded: [],
    ...extra,
  };
}

// merge each probe with the continuous sample it belongs to; a bundle older than maxAgeS is NOT carried
// forward (the probe keeps its own fields and says the bundle was not observed at that tick)
function mergeProbes(probes, csamples, { maxAgeS = 4 } = {}) {
  const byAt = new Map(csamples.map((c) => [c.at, c]));
  const out = probes.map((p) => {
    const c = p.bundleAt ? byAt.get(p.bundleAt) : null;
    if (!c) return { ...p, degraded: [...(p.degraded || []), ...(p.bundleAt ? ['continuous sample missing from stream'] : ['no fresh continuous sample at this tick (unobserved)'])] };
    const { at, seq, tSec, plugged, ...vals } = c; void at; void seq; void tSec;
    return { ...p, ...vals, plugged: p.plugged !== null && p.plugged !== undefined ? p.plugged : (plugged ?? null) };
  });
  void maxAgeS;
  out.sort((a, b) => a.tSec - b.tSec);
  return out;
}

// do any bare numeric value keys remain (for the validator and tests)
const BARE_VALUE_KEYS = ['committed', 'availMB', 'pages', 'faults', 'transFaults', 'cpuQ', 'cpuPct', 'ctx', 'diskQ', 'diskSec', 'defender',
  'dpcPct', 'intrPct', 'maxFreq', 'pagesIn', 'pagefile', 'poolNonpagedMB', 'modifiedMB', 'standbyNormalMB', 'standbyReserveMB', 'standbyCoreMB',
  'standbyLifetimeS', 'gpuTotal', 'usedPct', 'freeGB', 'ms', 'slipS', 'batteryPct'];

// Convert a legacy plain probe/sample/hang row (bare numbers) into the stored provenance-record form.
// Used by the synthetic fixture builder and by tests; real runs build records at measurement time.
const UNITS = { usedPct: ['%', 0.1], freeGB: ['GB', 0.01], ms: ['ms', 1], slipS: ['s', 0.001], batteryPct: ['%', 1], snapMs: ['ms', 1], respondMs: ['ms', 1], gpuMs: ['ms', 1], ecoMs: ['ms', 1] };
function recordizeRow(row, { src = 'fixture', windowS = 2 } = {}) {
  const out = { ...row };
  for (const [k, x] of Object.entries(row)) {
    if (typeof x !== 'number' && x !== null) continue;
    const m = META[k];
    const u = UNITS[k] || (m ? [m.unit, m.prec] : null);
    if (!u || (x === null && !BARE_VALUE_KEYS.includes(k))) continue;
    out[k] = rec(x, { unit: u[0], windowS: k === 'usedPct' || k === 'freeGB' ? 0 : windowS, n: 1, src: `${src}.${k}`, at: row.at || null, prec: u[1] });
  }
  delete out.bundleMs; delete out.weightMs; // replaced: the bundle is read by the continuous session, not timed per tick
  return out;
}

module.exports = { recordizeRow, bundleToRecords, buildCSample, buildRamSample, buildProbe, mergeProbes, BARE_VALUE_KEYS, isRec };
