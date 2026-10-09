'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TT = path.join(__dirname, '..', 'hanger.js');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'battery-1308.json'), 'utf8'));
const withSchema = (schema) => JSON.stringify({ ...base, schema });

test('trend shows v1 labelled pre-fix and reports a v9 file as an unknown schema', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ver-'));
  fs.writeFileSync(path.join(d, 'hanger-2026-01-15T10-00-00.json'), withSchema('telltale-json/1'));
  fs.writeFileSync(path.join(d, 'hanger-2026-01-15T11-00-00.json'), withSchema('hanger-json/9'));
  fs.writeFileSync(path.join(d, 'hanger-2026-01-15T12-00-00.json'), withSchema('hanger-json/2'));
  const r = spawnSync(process.execPath, [TT, 'trend', '--out', d], { encoding: 'utf8', cwd: d });
  assert.match(r.stdout, /v1 \(pre-fix; rates may be overstated\)/);
  assert.match(r.stdout, /SKIPPED hanger-2026-01-15T11-00-00\.json: unknown schema 'hanger-json\/9'/);
  assert.match(r.stdout, /2 reports/);
});

test('reports declare v2 frozen in the fixtures', () => {
  assert.strictEqual(base.schema, 'hanger-json/2');
  assert.strictEqual(base.schemaStatus, 'frozen');
});

// ---- storage-coverage 5.1: additive fields under the frozen schema
const { validateText } = require('./helpers/validate-report');
const S = require('./rules/_storage-scenarios');
const { renderAll } = require('../lib/render');
const { diagnose } = require('../lib/diagnosis/engine');
const { SCHEMA, buildCoreReport } = require('../lib/core-report');

test('the changelog has a dated 2.x section naming every storage field, and the schema stays frozen hanger-json/2', () => {
  const log = fs.readFileSync(path.join(__dirname, '..', 'SCHEMA-CHANGELOG.md'), 'utf8');
  const sec = log.split(/^## /m).find((s) => /storage-coverage/.test(s));
  assert.ok(sec, 'a section for storage-coverage');
  assert.match(sec, /^v2\.x \(still `hanger-json\/2`, `schemaStatus` stays `frozen`\) - 2026-10-09/);
  for (const f of ['disk.drives', 'disk.volumes', '`storage` (root)', 'workloadDrives', 'pagefiles.value[].drive', 'storage.disks.value[].number', 'disk-nearly-full', 'drives']) assert.ok(sec.includes(f), f);
  assert.strictEqual(SCHEMA, 'hanger-json/2');
  const rep = buildCoreReport({ start: { runStartMs: Date.parse('2026-10-07T10:00:00.000Z'), thresholds: {} }, samples: [], probes: [], csamples: [], marks: [], failures: [], gaps: [] }, { status: 'complete', streamName: 's.jsonl' });
  assert.strictEqual(rep.schema, 'hanger-json/2');
  assert.strictEqual(rep.schemaStatus, 'frozen');
});

test('the validator accepts a report that carries the new fields, rejects malformed ones, and accepts an older report without them', () => {
  const r = JSON.parse(JSON.stringify(S.multi.pagefileOnSlow(['D:']).report));
  r.schemaStatus = 'frozen';
  r.diagnosis = diagnose(r);
  assert.ok(validateText(JSON.stringify(r)).ok, validateText(JSON.stringify(r)).problems.join('; '));
  r.futureStorageKey = { whatever: 1 };
  r.spawnProbes[5].disk.somethingNew = [1, 2];
  assert.ok(validateText(JSON.stringify(r)).ok, 'unknown storage content is ignored');
  const bad = JSON.parse(JSON.stringify(r));
  bad.storage = { workloadDrives: ['D:\data'] };
  assert.match(validateText(JSON.stringify(bad)).problems.join(';'), /workloadDrives/);
  const bad2 = JSON.parse(JSON.stringify(r));
  bad2.spawnProbes[3].disk.drives = null;
  assert.match(validateText(JSON.stringify(bad2)).problems.join(';'), /without a drivesReason/);
  assert.ok(validateText(JSON.stringify(base)).ok, 'the older fixture still validates');
});

test('an older report with no storage fields still renders, diagnoses again and shows the placeholder with a reason', () => {
  const old = JSON.parse(JSON.stringify(base));
  assert.ok(!old.storage && !old.spawnProbes.some((p) => p.disk && p.disk.drives));
  const d = diagnose(old);
  assert.ok(d.hangs.length > 0);
  const ns = d.hangs[0].rules.find((x) => x.id === 'disk-nearly-full');
  assert.ok(ns && ns.fired === null && /disk\.relevant_free_pct/.test(ns.reason), 'not evaluable, never negative');
  const out = renderAll(old, { jsonName: 'x.json', htmlName: 'x.report.html', emailName: 'x.email.txt', jsonSha256: 'a'.repeat(64) });
  assert.match(out.md, /Per-drive disk data: not available \(/);
  assert.match(out.md, /Volume free space: not available \(/);
});
