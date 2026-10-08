'use strict';
// Loads the input-stall fixtures (test/fixtures/input-stall) for the unit tests of lib/input.
const fs = require('fs');
const path = require('path');
const { T0 } = require('../fixtures/build-input-fixtures');

const DIR = path.join(__dirname, '..', 'fixtures', 'input-stall');
const SETTINGS = { stallMs: 250, mergeGapMs: 1000, tickMs: 250, lateMs: 200, ignoreGroups: [] };

function load(name) {
  const file = path.join(DIR, `${name}.input.jsonl`);
  const records = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.expected.json`), 'utf8'));
  const bf = path.join(DIR, `${name}.stream-bridge.json`);
  return { file, records, expected, bridge: fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : null };
}
const byType = (records, t) => records.filter((r) => r.type === t);
const at = (s) => T0 + Math.round(s * 1000);
// the parts the episode builder reads
function parts(name) {
  const f = load(name);
  return { ...f, samples: byType(f.records, 'input-stall-sample'), spans: byType(f.records, 'input-skip'), windows: byType(f.records, 'input-window') };
}
// expected hang list -> the shape agreement.js reads
const hangsOf = (expected) => (expected.hangs || []).map((h) => ({ ref: h.ref, atMs: at(h.atS), ms: h.ms, osConfirmed: !!h.osConfirmed }));

module.exports = { DIR, SETTINGS, load, parts, byType, at, hangsOf, T0 };
