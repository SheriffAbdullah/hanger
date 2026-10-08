'use strict';
// Worked example for lib/sampler/README.md: how a later change (6 or 7) adds a continuous collector.
// This file is documentation that runs: test/sampler-registry.test.js registers it and parses canned text.
const { parseNum } = require('./parse-num');

// 1. Declare the collector. A continuous collector contributes counter paths to the ONE shared session.
const collector = {
  id: 'memory.pagesOut',
  inference: 'mem.thrashing',
  tier: 'continuous',
  unit: '/s',
  precision: 1,
  source: { kind: 'counter-session', paths: ['\\Memory\\Pages Output/sec'] },
};

// 2. Parse is pure: raw lines in, {values, failures} out. Unit-test it on canned text (de-DE too).
function parse(lines, { decimal = '.' } = {}) {
  const values = {}, failures = [];
  for (const raw of lines) {
    const eq = raw.lastIndexOf('=');
    if (eq < 0 || !raw.slice(0, eq).toLowerCase().includes('pages output/sec')) continue;
    const text = raw.slice(eq + 1);
    const n = parseNum(text, { decimal });
    values.pagesOut = n;
    if (n === null) failures.push({ mode: 'parse', field: 'pagesOut', reason: `unparsable value '${text.trim().slice(0, 40)}'` });
  }
  return { values, failures };
}

module.exports = { collector, parse };
