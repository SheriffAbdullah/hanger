'use strict';
// Observer meter: the tool's own cost (CPU, private bytes, I/O, launches by tier), kept apart from
// workload data and checked against a declared budget. Process stats come from an injected source so the
// arithmetic is unit-testable: readSources() -> [{pid, role, cpuS, privateMB, ioReadMB?, ioWriteMB?}].
const { rec } = require('./record');

const BUDGET = { cpuPctLimit: 2, privateMBLimit: 150 };
// the input helper has its own, smaller budget (input-response stall detector); 100 MB when the PowerShell fallback hosts it
const HELPER_BUDGET = { cpuPctLimit: 0.5, privateMBLimit: 40, privateMBLimitFallback: 100 };
const TIERS = ['continuous', 'hangProbe', 'onTrigger', 'once'];

function createObserver({ readSources = () => [], logicalCpus = 1, budget = BUDGET, print = () => {}, now = Date.now, pidSource = () => [] } = {}) {
  const launches = Object.fromEntries(TIERS.map((t) => [t, 0]));
  let samples = 0, peakPrivateMB = 0, lastCpuS = 0, ioReadMB = null, ioWriteMB = null, firstSrc = null;
  let baseCpuS = 0, lastParts = {};
  let helperCpuS = null, helperPeakMB = 0, helperLimitMB = HELPER_BUDGET.privateMBLimit, helperSeen = false;
  const startMs = now();

  // the run window starts here: CPU the tool spent before this (its own start-up, the system profile) is not run cost
  function markStart() {
    const srcs = readSources();
    baseCpuS = srcs.filter((x) => x.role === 'main').reduce((a, x) => a + (x.cpuS || 0), 0);
  }

  // count one process launch attributed to a tier (called by the single spawn wrapper)
  function launch(tier = 'once') { launches[tier] = (launches[tier] || 0) + 1; }

  // read process stats now: peak private is the largest sum seen; CPU is cumulative so the last read wins
  function sample() {
    const srcs = readSources();
    if (!srcs.length) return;
    samples++;
    const hs = srcs.find((x) => x.role === 'input-helper');
    if (hs) {
      helperSeen = true;
      if (Number.isFinite(hs.cpuS)) helperCpuS = hs.cpuS;
      if (Number.isFinite(hs.privateMB) && hs.privateMB > helperPeakMB) helperPeakMB = hs.privateMB;
      if (hs.limits && Number.isFinite(hs.limits.privateMB)) helperLimitMB = hs.limits.privateMB;
    }
    if (!firstSrc) firstSrc = srcs;
    const priv = srcs.reduce((a, s) => a + (s.privateMB || 0), 0);
    if (priv > peakPrivateMB) peakPrivateMB = priv;
    lastCpuS = srcs.reduce((a, s) => a + (s.cpuS || 0), 0) - baseCpuS;
    lastParts = {}; for (const x of srcs) lastParts[x.role || x.pid] = +((x.cpuS || 0) - (x.role === 'main' ? baseCpuS : 0)).toFixed(3);
    const rd = srcs.filter((s) => Number.isFinite(s.ioReadMB)), wr = srcs.filter((s) => Number.isFinite(s.ioWriteMB));
    if (rd.length) ioReadMB = rd.reduce((a, s) => a + s.ioReadMB, 0);
    if (wr.length) ioWriteMB = wr.reduce((a, s) => a + s.ioWriteMB, 0);
  }
  // cumulative I/O is read once near the end (a separate one-shot); merge it in
  function setIo({ readMB, writeMB }) { if (Number.isFinite(readMB)) ioReadMB = readMB; if (Number.isFinite(writeMB)) ioWriteMB = writeMB; }

  // windowS defaults to the wall-clock span since creation
  function report({ windowS = null, at = new Date(now()).toISOString() } = {}) {
    sample();
    const w = windowS !== null ? windowS : (now() - startMs) / 1000;
    const cpuPct = w > 0 ? (lastCpuS / w) * 100 : null;
    const mk = (v, unit, src, extra = {}) => rec(v, { unit, windowS: w, n: samples, src, at, ...extra });
    const items = [];
    if (cpuPct !== null && cpuPct > budget.cpuPctLimit) items.push({ budget: 'cpu', value: +cpuPct.toFixed(1), limit: budget.cpuPctLimit, unit: '% of one logical CPU', windowS: w });
    if (peakPrivateMB > budget.privateMBLimit) items.push({ budget: 'private', value: Math.round(peakPrivateMB), limit: budget.privateMBLimit, unit: 'MB', windowS: w });
    const exceeded = items.length > 0;
    for (const it of items) print(`[hanger] observer budget exceeded: ${it.budget} ${it.value}${it.unit === 'MB' ? ' MB' : '%'} > limit ${it.limit}${it.unit === 'MB' ? ' MB' : '%'} over ${Math.round(it.windowS)}s (the tool's own cost; reported, never hidden)`);
    // the input helper: its own CPU and private memory against its own limits (still inside the total above)
    let helper;
    if (helperSeen) {
      const hPct = w > 0 && helperCpuS !== null ? (helperCpuS / w) * 100 : null;
      const hItems = [];
      if (hPct !== null && hPct > HELPER_BUDGET.cpuPctLimit) hItems.push({ budget: 'cpu', value: +hPct.toFixed(1), limit: HELPER_BUDGET.cpuPctLimit, unit: '% of one logical CPU', windowS: w });
      if (helperPeakMB > helperLimitMB) hItems.push({ budget: 'private', value: Math.round(helperPeakMB), limit: helperLimitMB, unit: 'MB', windowS: w });
      for (const it of hItems) print(`[hanger] input helper budget exceeded: ${it.budget} ${it.value}${it.unit === 'MB' ? ' MB' : '%'} > limit ${it.limit}${it.unit === 'MB' ? ' MB' : '%'} over ${Math.round(it.windowS)}s (the helper's own cost; reported, never hidden)`);
      helper = {
        cpuPct: mk(hPct, '%', 'observer.input-helper.cpu'), privateMB: mk(helperPeakMB, 'MB', 'observer.input-helper.private'),
        limits: { cpuPct: HELPER_BUDGET.cpuPctLimit, privateMB: helperLimitMB }, exceeded: hItems.length > 0, items: hItems, window: { windowS: w, n: samples },
      };
    }
    const perMin = {};
    for (const t of Object.keys(launches)) perMin[t] = w > 0 ? +((launches[t] / w) * 60).toFixed(2) : null;
    return {
      cpuS: mk(lastCpuS, 's', 'observer.cpu'),
      cpuSBySource: lastParts,
      cpuPctOneLogical: mk(cpuPct, '%', 'observer.cpu'),
      peakPrivateMB: mk(peakPrivateMB, 'MB', 'observer.private'),
      ioReadMB: mk(ioReadMB, 'MB', 'observer.io'),
      ioWriteMB: mk(ioWriteMB, 'MB', 'observer.io'),
      launchesPerMin: perMin,
      launches: { ...launches },
      scope: 'the tool main process and its counter session; short-lived probe children are counted as launches, their own CPU is not measured',
      budget: { cpuPctLimit: budget.cpuPctLimit, privateMBLimit: budget.privateMBLimit, exceeded, items },
      ...(helper ? { helper } : {}),
    };
  }
  // observer processes never count as workload: drop them from a process list before any rollup or aggregate
  function excludeFrom(rows) {
    const set = new Set(pidSource().map(Number));
    return rows.filter((r) => !set.has(Number(r.pid)));
  }
  return { launch, markStart, sample, setIo, report, excludeFrom, pids: () => pidSource(), launches };
}

module.exports = { createObserver, BUDGET, HELPER_BUDGET, TIERS };
