'use strict';
// Effective settings with their source (flag > config > default) and any clamp.
const DURATION = { min: 10, max: 28800, def: 60 }; // 8 h maximum (OQ-11); record/trace defaults live with their modes
const INTERVAL = { min: 100, max: 2000, def: 1000 };

const THRESHOLD_FLAGS = {
  hang: ['--hang', 800, 'int'], commit: ['--commit', 85], minFreeGB: ['--min-free', 2.0],
  pages: ['--pages', 500], queue: ['--queue', 4], diskSec: ['--disk-sec', 0.025],
  ramHigh: ['--ram-high', 85], severeCommit: ['--severe-commit', 90], severeFree: ['--severe-free', 1.5],
  defender: ['--defender', 20], recovery: ['--recovery', 400, 'int'],
};

// {value, source} where value is the raw string (or undefined)
function lookup(argv, cfg, flag) {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return { value: argv[i + 1], source: 'flag' };
  const ck = flag.replace(/^--/, '');
  if (cfg && cfg[ck] !== undefined) return { value: String(cfg[ck]), source: 'config' };
  return { value: undefined, source: 'default' };
}

function clampSetting(raw, { min, max, def }, unit, noun) {
  const parsed = parseInt(raw.value, 10);
  const out = { value: def, source: raw.source };
  if (raw.value === undefined) return out;
  if (!Number.isFinite(parsed)) {
    return { value: def, source: 'default', requested: raw.value, clamped: { from: raw.value, to: def, reason: `${noun} '${raw.value}' is not a number; default ${def}${unit} used` } };
  }
  out.value = parsed;
  if (parsed < min) { out.requested = parsed; out.value = min; out.clamped = { from: parsed, to: min, reason: `minimum ${noun} is ${min}${unit}` }; }
  else if (parsed > max) { out.requested = parsed; out.value = max; out.clamped = { from: parsed, to: max, reason: noun === 'duration' ? `maximum ${max / 3600} h` : `maximum ${noun} is ${max}${unit}` }; }
  return out;
}

function thresholdValues(argv, cfg) {
  const values = {}, sources = {};
  for (const [k, [flag, def, kind]] of Object.entries(THRESHOLD_FLAGS)) {
    const r = lookup(argv, cfg, flag);
    const parsed = r.value === undefined ? def : (kind === 'int' ? parseInt(r.value, 10) : parseFloat(r.value));
    values[k] = Number.isFinite(parsed) ? parsed : def;
    sources[k] = Number.isFinite(parsed) ? r.source : 'default';
  }
  return { values, sources };
}

// input-response stall detector (lib/input): flag > config (nested `inputStall` object) > default
const INPUT_STALL = {
  stallMs: { flag: '--stall-ms', def: 250, min: 50, max: 5000 },
  recentInputMs: { def: 1000, min: 100, max: 10000 },
  mergeGapMs: { def: 1000, min: 100, max: 10000 },
  lateMs: { def: 200, min: 50, max: 5000 },
  tickMs: { def: 250, min: 100, max: 1000 },
  timeoutMs: { def: 1000, min: 250, max: 10000 },
};
function inputStallSettings(argv, cfg) {
  const c = (cfg && cfg.inputStall && typeof cfg.inputStall === 'object') ? cfg.inputStall : {};
  const out = {};
  // enabled: --no-input-stall beats config beats default (on)
  if (argv.includes('--no-input-stall')) out.enabled = { value: false, source: 'flag' };
  else if (c.enabled === false || c.enabled === 'false') out.enabled = { value: false, source: 'config' };
  else if (c.enabled === true || c.enabled === 'true') out.enabled = { value: true, source: 'config' };
  else out.enabled = { value: true, source: 'default' };
  for (const [k, spec] of Object.entries(INPUT_STALL)) {
    let raw = { value: undefined, source: 'default' };
    if (spec.flag) { const i = argv.indexOf(spec.flag); if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) raw = { value: argv[i + 1], source: 'flag' }; }
    if (raw.value === undefined && c[k] !== undefined) raw = { value: String(c[k]), source: 'config' };
    const r = clampSetting(raw, spec, 'ms', k);
    out[k] = { value: r.value, source: r.source, ...(r.requested !== undefined ? { requested: r.requested } : {}), ...(r.clamped ? { clamped: r.clamped } : {}) };
  }
  const ig = Array.isArray(c.ignoreGroups) ? c.ignoreGroups.map((x) => String(x).trim().toLowerCase().replace(/\.exe$/, '')).filter(Boolean) : [];
  out.ignoreGroups = { value: ig, source: ig.length ? 'config' : 'default' };
  return out;
}

function buildSettings({ argv, cfg = {}, anonymize, scope, recordDefaults = {} }) {
  const dur = clampSetting(lookup(argv, cfg, '--duration'), DURATION, 's', 'duration');
  const itv = clampSetting(lookup(argv, cfg, '--interval'), INTERVAL, 'ms', 'interval');
  if (recordDefaults.duration && dur.source === 'flag') dur.source = 'record-default';
  const th = thresholdValues(argv, cfg);
  const thresholds = {};
  for (const k of Object.keys(th.values)) thresholds[k] = { value: th.values[k], source: th.sources[k] };
  const anonSrc = argv.includes('--anonymize') ? 'flag' : (cfg.anonymize === true || cfg.anonymize === 'true') ? 'config' : 'default';
  return {
    duration: dur, interval: itv,
    anonymize: { value: !!anonymize, source: anonSrc },
    scope: scope || { value: { mode: 'open' }, source: 'default' },
    thresholds,
    inputStall: inputStallSettings(argv, cfg),
  };
}

// console lines for every setting the tool changed
function clampLines(settings) {
  const out = [];
  for (const k of ['duration', 'interval']) {
    const s = settings[k];
    if (s && s.clamped) out.push(`[hanger] ${k} clamped from ${s.clamped.from} to ${s.clamped.to}: ${s.clamped.reason}`);
  }
  for (const [k, s] of Object.entries(settings.inputStall || {})) {
    if (s && s.clamped) out.push(`[hanger] inputStall.${k} clamped from ${s.clamped.from} to ${s.clamped.to}: ${s.clamped.reason}`);
  }
  return out;
}

module.exports = { INPUT_STALL, inputStallSettings, DURATION, INTERVAL, THRESHOLD_FLAGS, lookup, buildSettings, thresholdValues, clampLines };
