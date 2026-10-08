'use strict';
// The input-stall fixture builder is deterministic (byte-identical on rerun), matches the committed files, and its full
// report fixture is a valid stored report.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAll, OUT } = require('./fixtures/build-input-fixtures');
const { validateFile } = require('./helpers/validate-report');

const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('input fixture builder: two runs are byte-identical and equal the committed fixtures', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-inx-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-inx-'));
  writeAll(a); writeAll(b);
  const files = fs.readdirSync(a);
  assert.ok(files.length > 40);
  for (const f of files) {
    assert.strictEqual(hash(path.join(a, f)), hash(path.join(b, f)), `${f} differs between runs`);
    assert.strictEqual(hash(path.join(a, f)), hash(path.join(OUT, f)), `${f} is stale: rerun build-input-fixtures.js`);
  }
});

test('basic-3-episodes.report.json validates, carries 3 episodes and the agreement block', () => {
  const f = path.join(OUT, 'basic-3-episodes.report.json');
  const v = validateFile(f);
  assert.ok(v.ok, v.problems.join('; '));
  assert.strictEqual(v.obj.inputStall.episodes.length, 3);
  assert.deepStrictEqual([v.obj.diagnosis.probeAgreement.precision.num, v.obj.diagnosis.probeAgreement.precision.den], [2, 3]);
  assert.ok(v.obj.diagnosis.hangs.some((h) => h.confirmedBy.includes('input-stall')));
});

test('a bare number in an episode is rejected by the validator and names the field', () => {
  const v = validateFile(path.join(OUT, 'basic-3-episodes.report.json'));
  const j = JSON.parse(JSON.stringify(v.obj));
  j.inputStall.episodes[0].durationMs = 1840;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-inx-bad-'));
  fs.writeFileSync(path.join(d, 'bad.json'), JSON.stringify(j));
  const bad = validateFile(path.join(d, 'bad.json'));
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.problems.some((p) => /inputStall\.episodes\[0\]\.durationMs/.test(p)), bad.problems.join('; '));
});
