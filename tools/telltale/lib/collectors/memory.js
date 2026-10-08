'use strict';
// Commit charge (bytes + limit + %), paging direction (pages in / pages out per second), paging-file usage.
const { one, unavailable } = require('./common');

const COUNTERS = ['\\Memory\\Committed Bytes', '\\Memory\\Commit Limit', '\\Memory\\Pages Input/sec', '\\Memory\\Pages Output/sec', '\\Paging File(_Total)\\% Usage'];

// idx: indexed counter lines. mk(value, unit, {prec, src}) builds a provenance record.
function build(idx, { mk }) {
  const committed = one(idx, 'memory', 'committed bytes', '');
  const limit = one(idx, 'memory', 'commit limit', '');
  const pctCounter = one(idx, 'memory', '% committed bytes in use', '');
  // committed % comes from the OS counter when present, else from the two byte values
  const pct = pctCounter !== null ? pctCounter : (committed !== null && limit > 0 ? committed / limit * 100 : null);
  const pagesIn = one(idx, 'memory', 'pages input/sec', '');
  const pagesOut = one(idx, 'memory', 'pages output/sec', '');
  const pagefile = one(idx, 'paging file', '% usage');
  const src = (k) => `memory.${k}@counterSession`;
  const mem = {
    committedBytes: mk(committed, 'bytes', { prec: 1, src: src('committedBytes') }),
    commitLimitBytes: mk(limit, 'bytes', { prec: 1, src: src('commitLimitBytes') }),
    committedPct: mk(pct, '%', { src: src('committedPct') }),
    pagesInPerS: mk(pagesIn, '/s', { src: src('pagesInPerS') }),
    pagesOutPerS: mk(pagesOut, '/s', { src: src('pagesOutPerS') }),
    pagefileUsePct: mk(pagefile, '%', { src: src('pagefileUsePct') }),
  };
  const failures = [];
  const missing = { committedBytes: committed, commitLimitBytes: limit, pagesInPerS: pagesIn, pagesOutPerS: pagesOut, pagefileUsePct: pagefile };
  for (const [k, v] of Object.entries(missing)) if (v === null) failures.push(unavailable('signals.memory', `mem.${k}`, 'not-exposed', `${k} counter returned no value`));
  return { mem, failures };
}

module.exports = { COUNTERS, build, id: 'signals.memory', inference: 'mem.commit' };
