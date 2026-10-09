'use strict';
// Temperature time series per labelled zone, in degrees C, readable without admin where the platform exposes it.
// Readings below 5 C or above 130 C are implausible (sensor glitches, unpopulated zones) and are dropped and counted.
const { rows, unavailable } = require('./common');

const COUNTERS = ['\\Thermal Zone Information(*)\\Temperature', '\\Thermal Zone Information(*)\\High Precision Temperature',
  '\\Thermal Zone Information(*)\\Throttle Reasons'];
const KELVIN = 273.15;
const MIN_C = 5, MAX_C = 130;

// zone instance "\_TZ.CPUZ" -> label "CPUZ"; the role comes from the label only, never from a value
const labelOf = (inst) => String(inst).replace(/^\\?_?tz\./i, '').replace(/^\\+/, '') || String(inst);
const roleOf = (label) => (/gfx|gpu|graphics/i.test(label) ? 'gpu' : /cpu|package|core|proc/i.test(label) ? 'cpu' : 'other');

// Kelvin per zone: prefer the high-precision counter (tenths of a Kelvin) over the whole-Kelvin one
function zoneKelvin(idx) {
  const hp = rows(idx, 'thermal zone information', 'high precision temperature');
  const lo = rows(idx, 'thermal zone information', 'temperature');
  const byZone = new Map();
  for (const r of lo) if (Number.isFinite(r.v)) byZone.set(r.inst, r.v);
  for (const r of hp) if (Number.isFinite(r.v)) byZone.set(r.inst, r.v / 10);
  return byZone;
}

function build(idx, { mk }) {
  const z = zoneKelvin(idx);
  const zones = [];
  let dropped = 0;
  for (const [inst, k] of z) {
    const c = k - KELVIN;
    if (!(c >= MIN_C && c <= MAX_C)) { dropped++; continue; }
    const label = labelOf(inst);
    zones.push({ label, role: roleOf(label), c: Math.round(c * 10) / 10 });
  }
  const failures = [];
  const thermal = { prov: { unit: 'C', windowS: 0, n: 1, src: 'thermal.zones@counterSession', prec: 0.1 }, zones: zones.length ? zones : null, droppedImplausible: dropped };
  if (!zones.length) {
    thermal.zonesReason = z.size ? 'implausible' : 'not-exposed';
    failures.push(unavailable('signals.thermal', 'thermal.zones', 'not-exposed', z.size ? 'every thermal zone reading was outside 5-130 C' : 'no thermal zone is exposed to the user tier on this machine'));
  }
  // GPU temperature: a zone whose label names the graphics processor (null with a reason otherwise)
  const g = zones.find((x) => x.role === 'gpu');
  const gpuTemp = { tempC: g ? mk(g.c, 'C', { prec: 0.1, src: 'thermal.gpuZone@counterSession' }) : mk(null, 'C', { prec: 0.1, src: 'thermal.gpuZone@counterSession' }), tempReason: g ? null : 'not-exposed' };
  return { thermal, gpuTemp, failures };
}

module.exports = { COUNTERS, build, labelOf, roleOf, id: 'signals.thermal', inference: 'thermal.temperature', MIN_C, MAX_C };
