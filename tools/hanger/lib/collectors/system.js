'use strict';
// System-wide handle count (no per-process handles: deferred).
const { one, unavailable } = require('./common');

const COUNTERS = ['\\Process(_Total)\\Handle Count'];

function build(idx, { mk }) {
  const n = one(idx, 'process', 'handle count');
  const failures = n === null ? [unavailable('signals.system', 'sys.handleCount', 'not-exposed', 'system handle count counter returned no value')] : [];
  return { sys: { handleCount: mk(n, 'count', { prec: 1, src: 'sys.handleCount@counterSession' }) }, failures };
}

module.exports = { COUNTERS, build, id: 'signals.system', inference: 'sys.handles' };
