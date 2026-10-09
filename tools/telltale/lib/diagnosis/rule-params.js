'use strict';
// Provisional parameters of the cause rules added by diagnosis-cause-rules. They are recorded in the report at
// summary.thresholds.rules.<ruleId>.<param> = {value, unit, source, origin} so a stored report recomputes identically,
// and can be overridden from telltale.config.json as { "rules": { "<ruleId>": { "<param>": number } } }.
// Pure data and two pure functions: requiring this module does no I/O.

const SOURCE = 'provisional (diagnosis-cause-rules design)';

const DEFAULTS = Object.freeze({
  'commit-limit-pressure': { commitPct: [90, '%'], availPctRam: [5, '% of RAM'], pagefileRisePp: [2, 'percentage points'], disproveCommitPct: [80, '%'] },
  'hard-fault-thrash': { pagesOutPerS: [100, '/s'], pagefileRisePp: [2, 'percentage points'], modifiedGrowthPct: [5, '%'], disprovePagesOutPerS: [20, '/s'] },
  'vm-memory-dominance': { vmPctRam: [40, '% of RAM'], capPctRam: [50, '% of RAM'], disproveVmPctRam: [25, '% of RAM'] },
  'database-memory-io': { memPctRam: [25, '% of RAM'], latencyMs: [25, 'ms'], queue: [1, 'count'], ioBps: [1048576, 'bytes/s'], disproveLatencyMs: [10, 'ms'], disproveMemPctRam: [10, '% of RAM'] },
  'single-process-dominance': { sharePct: [40, '% of used memory'], growthPct: [10, '%'], growthTolerancePct: [1, '%'], disproveSharePct: [20, '% of used memory'] },
  'thermal-power-throttle': { cpuPct: [50, '%'], perfPctOfCalm: [60, '% of calm median'], limitPct: [10, '%'], thermalC: [85, 'C'], disprovePerfPctOfCalm: [90, '% of calm median'] },
  'battery-power-plan': { rateRatio: [2, 'x AC rate'], minHangsPerSide: [3, 'count'], minProbesPerSide: [10, 'count'], modeHangShare: [0.667, 'share'], modeCalmShare: [0.333, 'share'], disproveRatio: [1.25, 'x'] },
  'driver-interrupt-storm': { sumPct: [10, '%'], disproveSumPct: [3, '%'] },
  // storage-coverage
  'disk-nearly-full': { lowFreePct: [10, '%'], warnFreePct: [15, '%'], fallMB: [500, 'MB'], disproveFreePct: [25, '%'] },
  'disk-stall': { culpritMinBps: [5242880, 'bytes/s'], culpritSharePct: [50, '% of observed disk I/O'], syncClientBps: [1048576, 'bytes/s'] },
  'gpu-contention': { enginePct: [90, '%'], vramPct: [95, '% of dedicated memory'], disproveEnginePct: [50, '%'], disproveVramPct: [80, '% of dedicated memory'] },
});

// config: the parsed telltale.config.json "rules" object (or undefined) -> the object written to summary.thresholds.rules
function recorded(configRules) {
  const out = {};
  const cfg = configRules && typeof configRules === 'object' ? configRules : {};
  for (const [id, params] of Object.entries(DEFAULTS)) {
    out[id] = {};
    for (const [k, [def, unit]] of Object.entries(params)) {
      const over = cfg[id] && cfg[id][k];
      const ok = typeof over === 'number' && Number.isFinite(over);
      out[id][k] = { value: ok ? over : def, unit, source: SOURCE, origin: ok ? 'config' : 'default' };
    }
  }
  return out;
}

// the value a rule uses: the one recorded in this report, else the default
function param(report, ruleId, key) {
  const rec = report && report.summary && report.summary.thresholds && report.summary.thresholds.rules
    && report.summary.thresholds.rules[ruleId] && report.summary.thresholds.rules[ruleId][key];
  const d = DEFAULTS[ruleId] && DEFAULTS[ruleId][key];
  if (rec && typeof rec.value === 'number' && Number.isFinite(rec.value)) return { value: rec.value, unit: rec.unit || (d && d[1]) || '', source: rec.source || SOURCE, origin: rec.origin || 'recorded', key: `${ruleId}.${key}` };
  if (!d) throw new Error(`no default for rule parameter ${ruleId}.${key}`);
  return { value: d[0], unit: d[1], source: SOURCE, origin: 'default', key: `${ruleId}.${key}` };
}

module.exports = { DEFAULTS, SOURCE, recorded, param };
