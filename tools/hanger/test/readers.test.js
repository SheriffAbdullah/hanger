'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TT = path.join(__dirname, '..', 'hanger.js');
const fx = path.join(__dirname, 'fixtures');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-read-'));
const run = (dir, ...a) => spawnSync(process.execPath, [TT, ...a, '--out', dir], { encoding: 'utf8', cwd: dir, timeout: 120000 });

test('pack names the unreadable newest trace and does not claim "no trace" or $0', () => {
  const d = tmp();
  fs.copyFileSync(path.join(fx, 'battery-1308.json'), path.join(d, 'hanger-2026-01-15T10-00-00.json'));
  fs.writeFileSync(path.join(d, 'hanger-2026-01-16T10-00-00.json'), '{"summary": ');
  const r = run(d, 'pack');
  const out = r.stdout + r.stderr;
  assert.match(out, /hanger-2026-01-16T10-00-00\.json/);
  assert.match(out, /UNREADABLE/);
  assert.ok(!/no trace report found/.test(out));
  const packFile = fs.readdirSync(d).find((f) => /^pack-.*\.json$/.test(f));
  const pack = JSON.parse(fs.readFileSync(path.join(d, packFile), 'utf8'));
  assert.strictEqual(pack.hangs.count, 5, 'uses the older valid trace, with its real hang count');
  assert.strictEqual(pack.provenance.unreadableReports[0].file, 'hanger-2026-01-16T10-00-00.json');
});

test('pack with only an unreadable trace explains why and reports no finding, not an invented one', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'hanger-2026-01-16T10-00-00.json'), 'garbage');
  const r = run(d, 'pack');
  assert.match(r.stdout, /hanger-2026-01-16T10-00-00\.json/);
  const packFile = fs.readdirSync(d).find((f) => /^pack-.*\.json$/.test(f));
  const pack = JSON.parse(fs.readFileSync(path.join(d, packFile), 'utf8'));
  assert.strictEqual(pack.finding, null);
  assert.strictEqual(pack.timeLost, null);
  assert.ok(!('cost' in pack));
  assert.match(pack.hangs.note, /unreadable/);
});

test('trend lists the readable reports and names the invalid file', () => {
  const d = tmp();
  fs.copyFileSync(path.join(fx, 'battery-1308.json'), path.join(d, 'hanger-2026-01-15T10-00-00.json'));
  fs.copyFileSync(path.join(fx, 'sample-r03.json'), path.join(d, 'hanger-2026-01-15T11-00-00.json'));
  fs.writeFileSync(path.join(d, 'hanger-2026-01-15T12-00-00.json'), '{ nope');
  const r = run(d, 'trend');
  assert.match(r.stdout, /2 reports/);
  assert.match(r.stdout, /SKIPPED hanger-2026-01-15T12-00-00\.json: invalid JSON/);
});
