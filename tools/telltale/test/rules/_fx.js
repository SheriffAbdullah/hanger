'use strict';
// Fixture helpers for the cause-rule tests (diagnosis-cause-rules). Every scenario is a small synthetic v2 report built with
// the diagnosis test helper: no machine data. Each scenario function returns { report, diagnosis }.
const { diagnose } = require('../../lib/diagnosis/engine');
const { mkReport, calm } = require('../helpers/diag-report');

const lead = [{ t: 2, ms: 150 }];

// n probes around `at` (step s apart); the middle probe is the hang. fn(i, mid) -> overrides for probe i ({ ..., row: {...} })
function incident(fn, { at = 40, n = 5, step = 2 } = {}) {
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => {
    const o = typeof fn === 'function' ? fn(i, mid) : (fn || {});
    return { t: at + (i - mid) * step, ms: i === mid ? 1500 : 200, ...(i === mid ? { hang: true } : {}), ...o };
  });
}
// calm baseline probes (t = 10..)
const baseline = (over = {}, n = 14) => calm(n, 10, 1, over);

function scenario(probes, opts = {}) {
  const report = mkReport({ probes: [...lead, ...probes], ...opts });
  return { report, diagnosis: diagnose(report) };
}
const refs = require('../../lib/diagnosis/refs');
// every evidence input of a rule result re-reads to the same time and value from the stored report
const resolves = (report, res) => res.inputs.length > 0 && res.inputs.every((i) => refs.resolveInput(report, i).ok);
const rule = (d, id, hang = 0) => d.hangs[hang].rules.find((r) => r.id === id);
const seq = (arr) => (i) => arr[i];

module.exports = { resolves, lead, incident, baseline, scenario, rule, seq, calm, mkReport, diagnose };
