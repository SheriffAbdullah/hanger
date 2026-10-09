'use strict';
// Power truth: AC/battery state, battery %, power-mode overlay, energy saver, scheme name, and AC/battery transitions.
// Pure parsers. The continuous session reads one Win32 power-status call per tick; the one-shot text form is used by
// check-stub. A value that is not exposed is null with a reason, never 0 and never "no battery" unless the platform says so.

// effective power-mode overlay scheme GUIDs (Windows 10 1709+ / Windows 11)
const OVERLAY = Object.freeze({
  '961cc777-2547-4f9d-8174-7d86181b8a7a': 'best-power-efficiency',
  '00000000-0000-0000-0000-000000000000': 'balanced',
  'ded574b5-45a0-4f42-8737-46345c09c238': 'best-performance',
});
const overlayName = (guid) => {
  const g = String(guid || '').trim().toLowerCase();
  if (!g) return null;
  return OVERLAY[g] || `other:${g}`;
};

const pctOf = (x) => {
  const n = Number(x);
  return x !== '' && x !== null && x !== undefined && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
};
const acOf = (line) => (/^online$/i.test(String(line || '').trim()) ? true : /^offline$/i.test(String(line || '').trim()) ? false : null);

// session POWER block {line, pct, flag, overlay, saver} -> plain values + reasons
function parsePowerBlock(p) {
  if (!p) return { ac: null, batteryPct: null, hasBattery: null, powerMode: null, energySaver: null, reasons: { ac: 'not-exposed', batteryPct: 'not-exposed', powerMode: 'not-exposed', energySaver: 'not-exposed' } };
  const flag = p.flag === '' || p.flag === undefined || p.flag === null ? null : Number(p.flag);
  const hasBattery = flag === null || !Number.isFinite(flag) || flag === 255 ? null : (flag & 128) === 0;
  const ac = acOf(p.line);
  const pct = pctOf(p.pct);
  const reasons = {};
  let batteryPct = pct;
  if (hasBattery === false) { batteryPct = null; reasons.batteryPct = 'no-battery'; }
  else if (pct === null) reasons.batteryPct = hasBattery === null ? 'not-exposed' : 'unknown';
  if (ac === null) reasons.ac = 'not-exposed';
  const powerMode = overlayName(p.overlay);
  if (powerMode === null) reasons.powerMode = 'not-exposed';
  const saver = p.saver === '' || p.saver === undefined || p.saver === null ? null : Number(p.saver);
  const energySaver = saver === null || !Number.isFinite(saver) ? null : (saver & 1) === 1;
  if (energySaver === null) reasons.energySaver = 'not-exposed';
  return { ac, batteryPct, hasBattery, powerMode, energySaver, reasons };
}

// One-shot text: `line=Online;pct=99;status=High, Charging` on ONE line, or the same keys on separate lines.
// (The old parser expected one key per line, so the single-line output always lost the percentage.)
function parsePowerStatusText(text) {
  const kv = {};
  for (const piece of String(text || '').split(/[;\r\n]+/)) {
    const m = piece.trim().match(/^(line|pct|status)=(.*)$/i);
    if (m) kv[m[1].toLowerCase()] = m[2].trim();
  }
  const noBattery = /nosystembattery/i.test(kv.status || '') || (kv.status === undefined && kv.pct !== undefined && Number(kv.pct) === 255);
  const pct = pctOf(kv.pct);
  return {
    plugged: acOf(kv.line),
    batteryPct: noBattery ? null : pct,
    hasBattery: kv.line === undefined && kv.pct === undefined ? null : !noBattery,
  };
}

// "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)" -> {name, guid}; null fields when unparsable
function parseActiveScheme(text) {
  const t = String(text || '');
  const g = t.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const n = t.match(/\(([^)]+)\)\s*$/m);
  return { name: n ? n[1].trim() : null, guid: g ? g[1].toLowerCase() : null };
}

// remembers the last known AC state; returns a transition record when it flips. Unknown (null) never flips anything.
function createPowerTracker() {
  let last = null;
  const transitions = [];
  const label = (b) => (b ? 'ac' : 'battery');
  return {
    observe(at, ac) {
      if (ac === null || ac === undefined) return null;
      if (last === null) { last = ac; return null; }
      if (ac === last) return null;
      const t = { at, from: label(last), to: label(ac) };
      last = ac;
      transitions.push(t);
      return t;
    },
    transitions: () => transitions.slice(),
  };
}

// stored per-sample form: values with as-of times; null values carry a reason beside them
function buildPower(parsed, { at, mk }) {
  const out = {
    ac: parsed.ac, acAsOf: parsed.ac === null ? null : at,
    batteryPct: mk(parsed.batteryPct, '%', { src: 'powerStatus.batteryPct@counterSession', prec: 1, windowS: 0 }),
    batteryAsOf: parsed.batteryPct === null ? null : at,
    hasBattery: parsed.hasBattery,
    powerMode: parsed.powerMode, powerModeAsOf: parsed.powerMode === null ? null : at,
    energySaver: parsed.energySaver,
  };
  for (const [k, r] of Object.entries(parsed.reasons)) out[`${k}Reason`] = r;
  return out;
}

module.exports = { OVERLAY, overlayName, parsePowerBlock, parsePowerStatusText, parseActiveScheme, createPowerTracker, buildPower };
