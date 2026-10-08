'use strict';
// Pure parsing of counter-session text into the stored fields. No process launches, no I/O.
// One table maps a counter path fragment to a stored key, unit, precision and scale.
const { parseNum } = require('./parse-num');

// order matters: the first matching fragment wins (more specific fragments first)
const FIELDS = [
  { match: (p) => p.includes('gpu engine') && p.includes('total'), key: 'gpuTotal', unit: '%', agg: 'sum' },
  { match: (p) => p.includes('page faults/sec'), key: 'faults', unit: '/s' },
  { match: (p) => p.includes('transition faults/sec'), key: 'transFaults', unit: '/s' },
  { match: (p) => p.includes('pages/sec'), key: 'pages', unit: '/s' },
  { match: (p) => p.includes('committed bytes in use'), key: 'committed', unit: '%' },
  { match: (p) => p.includes('available mbytes'), key: 'availMB', unit: 'MB' },
  { match: (p) => p.includes('processor queue length'), key: 'cpuQ', unit: 'count' },
  { match: (p) => p.includes('context switches/sec'), key: 'ctx', unit: '/s' },
  { match: (p) => p.includes('current disk queue length'), key: 'diskQ', unit: 'count' },
  { match: (p) => p.includes('avg. disk sec/transfer'), key: 'diskSec', unit: 's', prec: 0.0001 },
  { match: (p) => p.includes('of maximum frequency'), key: 'maxFreq', unit: '%' },
  { match: (p) => p.includes('% dpc time'), key: 'dpcPct', unit: '%' },
  { match: (p) => p.includes('% interrupt time'), key: 'intrPct', unit: '%' },
  { match: (p) => p.includes('pool nonpaged bytes'), key: 'poolNonpagedMB', unit: 'MB', scale: 1 / 1048576 },
  { match: (p) => p.includes('modified page list bytes'), key: 'modifiedMB', unit: 'MB', scale: 1 / 1048576 },
  { match: (p) => p.includes('standby cache normal priority bytes'), key: 'standbyNormalMB', unit: 'MB', scale: 1 / 1048576 },
  { match: (p) => p.includes('standby cache reserve bytes'), key: 'standbyReserveMB', unit: 'MB', scale: 1 / 1048576 },
  { match: (p) => p.includes('standby cache core bytes'), key: 'standbyCoreMB', unit: 'MB', scale: 1 / 1048576 },
  { match: (p) => p.includes('long-term average standby cache lifetime'), key: 'standbyLifetimeS', unit: 's' },
  { match: (p) => p.includes('standby cache'), key: 'standbyOtherMB', unit: 'MB', scale: 1 / 1048576, bag: true },
  { match: (p) => p.includes('pages input/sec'), key: 'pagesIn', unit: '/s' },
  { match: (p) => p.includes('paging file') && p.includes('% usage'), key: 'pagefile', unit: '%' },
  // defender: set by the caller from the security-software system member (share of the whole machine, 0-100); no counter line maps here
  { match: () => false, key: 'defender', unit: '%' },
  { match: (p) => p.includes('% processor time'), key: 'cpuPct', unit: '%' },
];

const META = {};
for (const f of FIELDS) META[f.key] = f;
const ALL_KEYS = [...new Set(FIELDS.map((f) => f.key))];

// lines: ['\\host\memory\pages/sec=1234.5', ...]. Returns {values: {key: number|null}, failures: [{mode:'parse', field, reason}]}
function parseBundleLines(lines, { decimal = '.' } = {}) {
  const values = {}, failures = [];
  for (const raw of lines) {
    const eq = raw.lastIndexOf('=');
    if (eq < 0) continue;
    const p = raw.slice(0, eq).toLowerCase();
    // per-process counters (collectors/procs.js) share counter names with the machine totals: never fold them in here
    if (p.includes('\\process(')) continue;
    const f = FIELDS.find((x) => x.match(p));
    if (!f) continue;
    const text = raw.slice(eq + 1);
    const n = parseNum(text, { decimal });
    if (n === null && text.trim() !== '') failures.push({ mode: 'parse', field: f.key, reason: `unparsable value '${text.trim().slice(0, 40)}'` });
    const v = n === null ? null : (f.scale ? n * f.scale : n);
    if (f.bag) { values[f.key] = values[f.key] || {}; values[f.key][p.split('\\').pop()] = v; }
    else if (f.agg === 'sum') { if (v !== null) values[f.key] = (values[f.key] ?? 0) + v; else if (!(f.key in values)) values[f.key] = null; }
    else values[f.key] = v;
  }
  return { values, failures };
}

module.exports = { FIELDS, META, ALL_KEYS, parseBundleLines };
