'use strict';
// Turbo-aware CPU signals. The legacy "% of Maximum Frequency" reads 100 on a turbo laptop that is clamped to base
// clock, so it cannot show throttling. perfPct is actual performance relative to base (it can exceed 100);
// perfLimitPct is how much performance headroom the OS removed (0 = unlimited, 85 = capped at 15% of maximum).
const { one, rows, unavailable } = require('./common');

const COUNTERS = [
  '\\Processor Information(_Total)\\% Processor Performance', '\\Processor Information(_Total)\\% Performance Limit',
  '\\Processor Information(_Total)\\Performance Limit Flags', '\\Processor Information(_Total)\\% Processor Utility',
  '\\Processor(_Total)\\% DPC Time', '\\Processor(_Total)\\% Interrupt Time',
];

const hex = (n) => `0x${Math.round(n).toString(16)}`;

function build(idx, { mk }) {
  const perf = one(idx, 'processor information', '% processor performance');
  const limRaw = one(idx, 'processor information', '% performance limit');
  // the counter reads 100 when nothing limits the processor: store the limited share instead (0 = not limited)
  const lim = limRaw === null ? null : Math.min(100, Math.max(0, 100 - limRaw));
  const utility = one(idx, 'processor information', '% processor utility');
  const flags = one(idx, 'processor information', 'performance limit flags');
  const tz = rows(idx, 'thermal zone information', 'throttle reasons').filter((r) => Number.isFinite(r.v));
  let throttleReasons = null, throttleReason = null;
  if (flags === null && !tz.length) throttleReason = 'not-exposed';
  else {
    throttleReasons = [];
    if (flags !== null && flags !== 0) throttleReasons.push(`perf-limit-flags:${hex(flags)}`);
    for (const r of tz) if (r.v !== 0) throttleReasons.push(`thermal-zone-reasons:${hex(r.v)}`);
  }
  const dpc = one(idx, 'processor', '% dpc time');
  const intr = one(idx, 'processor', '% interrupt time');
  const src = (k) => `cpu.${k}@counterSession`;
  const cpu = {
    perfPct: mk(perf, '% of base', { prec: 1, src: src('perfPct') }),
    perfLimitPct: mk(lim, '%', { prec: 1, src: src('perfLimitPct') }),
    utilityPct: mk(utility, '% of base', { prec: 0.1, src: src('utilityPct') }),
    throttleReasons, ...(throttleReason ? { throttleReasonsReason: throttleReason } : {}),
    dpcPct: mk(dpc, '%', { src: src('dpcPct') }),
    interruptPct: mk(intr, '%', { src: src('interruptPct') }),
  };
  const failures = [];
  if (perf === null) failures.push(unavailable('signals.cpu', 'cpu.perfPct', 'not-exposed', 'processor performance counter returned no value'));
  if (limRaw === null) failures.push(unavailable('signals.cpu', 'cpu.perfLimitPct', 'not-exposed', 'performance limit counter returned no value'));
  if (throttleReason) failures.push(unavailable('signals.cpu', 'cpu.throttleReasons', 'not-exposed', 'no throttle-reason counter is exposed on this machine'));
  if (dpc === null) failures.push(unavailable('signals.cpu', 'cpu.dpcPct', 'not-exposed', 'DPC time counter returned no value'));
  if (intr === null) failures.push(unavailable('signals.cpu', 'cpu.interruptPct', 'not-exposed', 'interrupt time counter returned no value'));
  return { cpu, failures };
}

module.exports = { COUNTERS, build, id: 'signals.cpu', inference: 'power.throttled' };
