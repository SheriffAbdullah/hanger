'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAll, writeSample } = require('./fixtures/build-fixtures');
const { validateFile } = require('./helpers/validate-report');
const { grepArtifacts } = require('./helpers/grep-artifacts');

const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('fixture builder is deterministic and matches the committed fixtures', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-fx-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-fx-'));
  writeAll(a); writeAll(b);
  for (const f of fs.readdirSync(a)) {
    assert.strictEqual(hash(path.join(a, f)), hash(path.join(b, f)), f);
    assert.strictEqual(hash(path.join(a, f)), hash(path.join(__dirname, 'fixtures', f)), `${f} is stale: rerun build-fixtures.js`);
  }
});

test('fixture shapes match the stated cases', () => {
  const r03 = require('./fixtures/sample-r03.json'), bat = require('./fixtures/battery-1308.json'), ld = require('./fixtures/loaded-78s.json');
  assert.strictEqual(r03.spawnProbes.length, 5);
  assert.strictEqual(r03.summary.hangEventCount, 0);
  assert.strictEqual(r03.spawnProbes[0].bundleMs, 8849);
  assert.ok(r03.summary.committedPeak <= 65 && Math.min(...r03.spawnProbes.map((p) => p.committed)) >= 52);
  assert.strictEqual(bat.summary.hangEventCount, 5);
  assert.strictEqual(bat.power.plugged, false);
  assert.ok(bat.summary.committedPeak >= 90 && bat.summary.committedPeak <= 92.5);
  assert.strictEqual(ld.samples.length, 40);
});

test('shipped sample is synthetic, valid, and carries no host or user data', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sample-'));
  writeSample(d);
  assert.ok(validateFile(path.join(d, 'sample-telltale.json')).ok);
  const needles = [os.hostname(), os.userInfo().username].filter((x) => x && x.length > 2);
  assert.strictEqual(grepArtifacts(d, needles).length, 0);
});
