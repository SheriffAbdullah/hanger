'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { rec, val, plain, isRec, PRECISION, roundTo } = require('../lib/sampler/record');
const { parseNum, parseField } = require('../lib/sampler/parse-num');
const { parseBundleLines } = require('../lib/sampler/bundle');
const fs = require('fs');
const path = require('path');

test('1.1 a percent reading is stored to its declared precision', () => {
  const r = rec(64.7166289074152, { unit: '%', windowS: 2, n: 1, src: 'counterBundle.committed@counterSession', at: '2026-10-07T13:08:16.120Z' });
  assert.strictEqual(r.v, 64.7);
  assert.strictEqual(r.prec, 0.1);
  assert.strictEqual(r.unit, '%');
  assert.strictEqual(r.at, '2026-10-07T13:08:16.120Z');
  assert.ok(isRec(r));
});

test('1.1 default precision per unit (design D6)', () => {
  assert.deepStrictEqual([PRECISION['%'], PRECISION.MB, PRECISION.ms, PRECISION.s, PRECISION.count, PRECISION['/s'], PRECISION.C], [0.1, 1, 1, 0.001, 1, 1, 0.1]);
  assert.strictEqual(rec(1234.567, { unit: 'MB', src: 'x' }).v, 1235);
  assert.strictEqual(rec(0.123456, { unit: 's', src: 'x' }).v, 0.123);
});

test('1.1 a collector may override the unit precision', () => {
  assert.strictEqual(rec(0.00437, { unit: 's', src: 'x', prec: 0.0001 }).v, 0.0044);
});

test('1.1 null is preserved (never zero) and val() reads records and legacy numbers', () => {
  const r = rec(null, { unit: '%', src: 'x' });
  assert.strictEqual(r.v, null);
  assert.strictEqual(val(r), null);
  assert.strictEqual(val(87.5), 87.5);
  assert.strictEqual(val(rec(87.46, { unit: '%', src: 'x' })), 87.5);
  assert.strictEqual(val(undefined), undefined);
  assert.strictEqual(roundTo(NaN, 0.1), null);
});

test('1.1 plain() unwraps records deeply and leaves other values alone', () => {
  const o = { a: rec(1.26, { unit: '%', src: 'x' }), b: [{ c: rec(5, { unit: 'MB', src: 'x' }), d: 'text' }], e: null, f: 3 };
  assert.deepStrictEqual(plain(o), { a: 1.3, b: [{ c: 5, d: 'text' }], e: null, f: 3 });
});

test('1.2 decimal-comma output parses to the same numbers (de-DE)', () => {
  assert.strictEqual(parseNum('87,5', { decimal: ',' }), 87.5);
  assert.strictEqual(parseNum('1.234,0', { decimal: ',' }), 1234.0);
  assert.strictEqual(parseNum('1 234,5', { decimal: ',' }), 1234.5);
  assert.strictEqual(parseNum('87.5'), 87.5);
  assert.strictEqual(parseNum('1,234.5'), 1234.5);
  assert.strictEqual(parseNum('-3'), -3);
});

test('1.2 unparsable text is null with a parse failure naming the field', () => {
  assert.strictEqual(parseNum('n/a'), null);
  assert.strictEqual(parseNum(''), null);
  const f = parseField('n/a', 'committed');
  assert.strictEqual(f.v, null);
  assert.strictEqual(f.failure.mode, 'parse');
  assert.strictEqual(f.failure.field, 'committed');
});

test('1.2 canned de-DE and en-US counter output parse identically', () => {
  const dir = path.join(__dirname, 'fixtures', 'collectors', 'locale');
  const de = fs.readFileSync(path.join(dir, 'de-DE.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const en = fs.readFileSync(path.join(dir, 'en-US.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const a = parseBundleLines(de, { decimal: ',' }), b = parseBundleLines(en, { decimal: '.' });
  assert.strictEqual(a.values.committed, 87.5);
  assert.strictEqual(a.values.pages, 1234.0);
  assert.deepStrictEqual(a.values, b.values);
  assert.strictEqual(a.failures.length, 0);
});

test('1.2 an n/a counter value is null with a parse failure for that field', () => {
  const r = parseBundleLines(['\\\\h\\memory\\% committed bytes in use=n/a', '\\\\h\\memory\\pages/sec=12.5'], { decimal: '.' });
  assert.strictEqual(r.values.committed, null);
  assert.strictEqual(r.values.pages, 12.5);
  assert.deepStrictEqual(r.failures.map((f) => [f.mode, f.field]), [['parse', 'committed']]);
});

test('bundle parser: bytes are converted to MB, GPU totals sum, wildcard standby variants are keyed', () => {
  const r = parseBundleLines([
    '\\\\h\\memory\\pool nonpaged bytes=1048576000', '\\\\h\\gpu engine(a_total)\\utilization percentage=10', '\\\\h\\gpu engine(b_total)\\utilization percentage=5',
    '\\\\h\\memory\\standby cache odd bytes=2097152', '\\\\h\\process(msmpeng)\\% processor time=100.5', '\\\\h\\processor(_total)\\% processor time=40',
  ]);
  assert.strictEqual(r.values.poolNonpagedMB, 1000);
  assert.strictEqual(r.values.gpuTotal, 15);
  assert.strictEqual(r.values.standbyOtherMB['standby cache odd bytes'], 2);
  // a per-process counter line never folds into the machine totals; security-software CPU is set by the caller from the
  // normalized security-software member (data-signals-completeness), so the raw per-core-scaled 100.5 is not stored
  assert.strictEqual(r.values.defender, undefined);
  assert.strictEqual(r.values.cpuPct, 40);
});
