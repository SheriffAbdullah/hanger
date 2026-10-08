'use strict';
// Evidence references: every rule input is {ref, signal, at, value, unit}. resolveInput() finds the stored data point
// in the SAME report and re-reads the value through the signal registry (used by tests and by anyone auditing a finding).
const signals = require('./signals');

const REF_RE = /^spawnProbes\[(\d+)\]$/;

function resolveRef(report, ref) {
  const m = REF_RE.exec(String(ref || ''));
  if (!m) return null;
  const rows = signals.rowsOf(report);
  return rows[+m[1]] || null;
}

// -> {ok, reason?, row, value}; ok only when the probe exists, its time equals input.at and the value equals input.value
function resolveInput(report, input) {
  const row = resolveRef(report, input.ref);
  if (!row) return { ok: false, reason: `reference ${input.ref} does not resolve`, row: null, value: null };
  const value = signals.read(row, input.signal, signals.envOf(report));
  if (row.at !== input.at) return { ok: false, reason: `time ${row.at} != ${input.at}`, row, value };
  if (value !== input.value) return { ok: false, reason: `value ${value} != ${input.value}`, row, value };
  return { ok: true, row, value };
}

module.exports = { resolveRef, resolveInput };
