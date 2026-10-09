'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const persist = require('../lib/persist');
const { validateFile } = require('./helpers/validate-report');
const rep = require('./fixtures/battery-1308.json');

const TT = path.join(__dirname, '..', 'hanger.js');

function writeStream(file, { withEnd }) {
  const s = persist.openStream(file);
  s.append('run-start', { at: rep.run.startedAt, runStartMs: Date.parse(rep.run.startedAt), tool: rep.tool, nominalS: 60, intervalMs: 1000, settings: rep.settings, thresholds: rep.summary.thresholds });
  for (const x of rep.samples) s.append('sample', x);
  for (const p of rep.spawnProbes) { s.append('probe', p); if (p.hang) s.append('hang', { at: p.at, tSec: p.tSec, ms: p.ms }); }
  s.append('mark', rep.userMarks[0]);
  if (withEnd) s.append('run-end', { at: rep.run.endedAt, status: 'interrupted', reason: 'SIGINT' });
  s.close();
}

test('a stream killed mid-line recovers as unfinished with equal probe counts', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-rec-'));
  const file = path.join(d, 'hanger-2026-01-15T10-00-00.jsonl');
  writeStream(file, { withEnd: false });
  fs.appendFileSync(file, '{"type":"probe","tSec":99,"ms"'); // torn last write
  const r = spawnSync(process.execPath, [TT, 'recover', file], { encoding: 'utf8', cwd: d });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = path.join(d, 'hanger-2026-01-15T10-00-00.json');
  assert.ok(validateFile(out).ok);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(report.run.status, 'unfinished');
  assert.strictEqual(report.spawnProbes.length, rep.spawnProbes.length);
  assert.strictEqual(report.summary.hangEventCount, 5);
  assert.match(r.stdout, /1 unreadable line/);
});

test('a stream with a run-end record keeps its status', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-rec-'));
  const file = path.join(d, 'hanger-2026-01-15T10-00-00.jsonl');
  writeStream(file, { withEnd: true });
  const { records } = persist.readStream(file);
  assert.strictEqual(records[records.length - 1].type, 'run-end');
  const r = spawnSync(process.execPath, [TT, 'recover', file], { encoding: 'utf8', cwd: d });
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(d, 'hanger-2026-01-15T10-00-00.json'), 'utf8'));
  assert.strictEqual(report.run.status, 'interrupted');
});
