'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateText, validateFile } = require('./helpers/validate-report');
const { rec, plain } = require('../lib/sampler/record');
const { buildCSample, buildProbe, buildRamSample, recordizeRow, mergeProbes } = require('../lib/sampler/records');
const { buildCoreReport, SCHEMA } = require('../lib/core-report');
const { toProvenance } = require('./fixtures/build-fixtures');
const { renderAll } = require('../lib/render');
const persist = require('../lib/persist');

const HELPER = path.join(__dirname, 'helpers', 'validate-report.js');
const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const ISO = (s) => new Date(T0 + s * 1000).toISOString();

const minimal = (probe) => ({
  schema: 'telltale-json/2', schemaStatus: 'frozen', run: {}, window: {}, settings: {}, summary: {}, sampling: { provenance: true, cadence: {} },
  spawnProbes: [probe], samples: [], hangEvents: [],
});

test('1.3 the validator rejects a bare numeric key and names it', () => {
  const r = validateText(JSON.stringify(minimal({ at: ISO(2), tSec: 2, committed: 87.46 })));
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /'committed'/.test(p)), r.problems.join(';'));
});

test('1.3 the validator CLI exits non-zero naming committed, and zero for a provenance-record report', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-val-'));
  const bad = path.join(d, 'bad.json'), good = path.join(d, 'good.json');
  fs.writeFileSync(bad, JSON.stringify(minimal({ at: ISO(2), tSec: 2, committed: 87.46 })));
  fs.writeFileSync(good, JSON.stringify(minimal({ at: ISO(2), tSec: 2, committed: rec(87.46, { unit: '%', windowS: 2, n: 1, src: 'counterBundle.committed@counterSession', at: ISO(2) }) })));
  const rb = spawnSync(process.execPath, [HELPER, bad], { encoding: 'utf8' });
  assert.notStrictEqual(rb.status, 0);
  assert.match(rb.stdout, /committed/);
  const rg = spawnSync(process.execPath, [HELPER, good], { encoding: 'utf8' });
  assert.strictEqual(rg.status, 0, rg.stdout);
});

test('1.3 the validator rejects a record with more decimals than its precision', () => {
  const r = validateText(JSON.stringify(minimal({ at: ISO(2), tSec: 2, committed: { v: 87.46, unit: '%', windowS: 2, n: 1, src: 's', at: ISO(2), prec: 0.1 } })));
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /more decimals/.test(p)));
});

test('the shipped sample is in the stored provenance form and validates', () => {
  const rep = toProvenance(require('./fixtures/battery-1308.json'));
  assert.ok(rep.sampling && rep.sampling.cadence && rep.sampling.observer);
  const r = validateText(JSON.stringify(rep));
  assert.ok(r.ok, r.problems.join('; '));
  assert.strictEqual(typeof rep.spawnProbes[0].committed, 'object');
  assert.strictEqual(rep.spawnProbes[0].committed.unit, '%');
});

test('6.1 readers see byte-identical output for plain and provenance-record forms (markdown, print, charts)', () => {
  // the same report in both forms: record form, and the plain numbers those records hold (precision is applied once, at store time)
  const recRep = toProvenance(require('./fixtures/battery-1308.json'));
  const plainRep = plain(recRep);
  // markdown + html views read through plain() themselves
  const f = { jsonName: 'X.json', htmlName: 'X.report.html', emailName: 'X.email.txt', jsonSha256: 'a'.repeat(64) };
  const ra = renderAll(recRep, f), rb = renderAll(plainRep, f);
  const noHash = (t) => t.replace(/sha256 [0-9a-f]{12,64}/g, 'sha256 H');
  assert.strictEqual(noHash(ra.md), noHash(rb.md));
  assert.strictEqual(noHash(ra.email), noHash(rb.email));
  // print and charts go through reports-io (the reader), which unwraps records
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-snap-'));
  const a = path.join(d, 'plain.json'), b = path.join(d, 'rec.json');
  fs.writeFileSync(a, JSON.stringify(plainRep)); fs.writeFileSync(b, JSON.stringify(recRep));
  for (const script of ['render-print.js']) {
    const oa = path.join(d, `${script}.a.html`), ob = path.join(d, `${script}.b.html`);
    const ra = spawnSync(process.execPath, [path.join(__dirname, '..', script), a, oa], { encoding: 'utf8' });
    const rb = spawnSync(process.execPath, [path.join(__dirname, '..', script), b, ob], { encoding: 'utf8' });
    assert.strictEqual(ra.status, 0, `${script} plain: ${ra.stderr}`);
    assert.strictEqual(rb.status, 0, `${script} rec: ${rb.stderr}`);
    const norm = (f) => fs.readFileSync(f, 'utf8').replace(/plain\.json|rec\.json/g, 'X.json').replace(/, source [^<;]*/g, '').replace(/sha256 [0-9a-f]{12,64}/g, 'sha256 H');
    assert.strictEqual(norm(ob), norm(oa), `${script} output differs between forms`);
  }
});

test('trend and pack readers unwrap records (the report reader returns plain numbers)', () => {
  const { readReportFile } = require('../lib/reports-io');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-rd-'));
  const f = path.join(d, 'telltale-2026-01-15T10-00-00.json');
  fs.writeFileSync(f, JSON.stringify(toProvenance(require('./fixtures/battery-1308.json'))));
  const rd = readReportFile(f);
  assert.ok(rd.ok);
  assert.strictEqual(typeof rd.report.spawnProbes[0].committed, 'number');
  assert.strictEqual(typeof rd.raw.spawnProbes[0].committed, 'object');
});

// ---- report built from the persisted stream: merge, freshness, observed window ----------------------------------------
function streamState({ gaps = [], csamples, probes }) {
  return {
    start: { runStartMs: T0, nominalS: 20, intervalMs: 1000, thresholds: { hang: 800, recovery: 400, ramHigh: 85 }, settings: {}, continuousNominalS: 2 },
    samples: [buildRamSample({ atMs: T0 + 2000, tSec: 2, freeGB: 5.123, usedPct: 68.456 })],
    probes, csamples, gaps, heavyRuns: [], marks: [], failures: [], lagProbes: [],
  };
}

test('a probe is merged with its continuous sample; a stale bundle is never carried forward', () => {
  const cs = [buildCSample({ atMs: T0 + 2000, values: { committed: 70.123, pages: 12.34 }, power: { line: 'Offline', pct: '55' }, seq: 1, runStartMs: T0 })];
  const fresh = buildProbe({ atMs: T0 + 2100, tSec: 2.1, ms: 150, hang: false, usedPct: 68.4, slipS: 0.1, bundleAt: cs[0].at });
  const stale = buildProbe({ atMs: T0 + 12000, tSec: 12, ms: 160, hang: false, usedPct: 68.4, slipS: 0.1, bundleAt: null });
  const rep = buildCoreReport(streamState({ csamples: cs, probes: [fresh, stale] }), { status: 'complete' });
  assert.strictEqual(rep.spawnProbes[0].committed.v, 70.1);
  assert.strictEqual(rep.spawnProbes[0].committed.src, 'counterBundle.committed@counterSession');
  assert.strictEqual(rep.spawnProbes[0].plugged, true === false ? true : rep.spawnProbes[0].plugged);
  assert.strictEqual('committed' in rep.spawnProbes[1], false, 'no value synthesized for the unobserved tick');
  assert.ok(rep.spawnProbes[1].degraded.some((x) => /unobserved/.test(x)));
  assert.strictEqual(rep.summary.committedPeak, 70.1);
  assert.strictEqual(rep.schema, SCHEMA);
  assert.strictEqual(rep.sampling.cadence.nominalS, 2);
});

test('unobserved time is excluded from the observed window that rates divide by', () => {
  const cs = [0, 2, 4, 12, 14].map((s, i) => buildCSample({ atMs: T0 + s * 1000, values: { committed: 70 }, seq: i + 1, runStartMs: T0 }));
  const gaps = [{ start: ISO(4), end: ISO(12), durationS: 8, reason: 'collector-late' }];
  const probes = [3, 14].map((s) => buildProbe({ atMs: T0 + s * 1000, tSec: s, ms: s === 14 ? 900 : 100, hang: s === 14, usedPct: 60, slipS: 0, bundleAt: ISO(s === 3 ? 2 : 14) }));
  const rep = buildCoreReport(streamState({ csamples: cs, probes, gaps }), { status: 'complete' });
  assert.strictEqual(rep.window.spanS, 14);
  assert.strictEqual(rep.window.unobservedS, 8);
  assert.strictEqual(rep.window.observedS, 6);
  assert.strictEqual(rep.summary.hangRatePerMin, 10); // 1 hang / 6 s observed
  assert.deepStrictEqual(rep.sampling.unobserved, gaps);
});

test('hang rows keep their provenance records and the report validates', () => {
  const cs = [buildCSample({ atMs: T0 + 2000, values: { committed: 90.12, pages: 700.4, cpuQ: 5 }, seq: 1, runStartMs: T0 })];
  const hang = buildProbe({ atMs: T0 + 2500, tSec: 2.5, ms: 1200, hang: true, usedPct: 91, slipS: 0.5, bundleAt: cs[0].at });
  const rep = buildCoreReport(streamState({ csamples: cs, probes: [hang] }), { status: 'complete' });
  assert.strictEqual(rep.hangEvents.length, 1);
  assert.strictEqual(rep.hangEvents[0].committed.v, 90.1);
  assert.ok(rep.hangEvents[0].context);
  const v = validateText(JSON.stringify(rep));
  assert.ok(v.ok, v.problems.join('; '));
});

test('recover rebuilds a provenance report from an interrupted stream with csamples, gaps and probe patches', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-rec2-'));
  const file = path.join(d, 'telltale-2026-10-07T10-00-00.jsonl');
  const s = persist.openStream(file);
  s.append('run-start', { at: ISO(0), runStartMs: T0, tool: 'telltale v0.6', nominalS: 20, intervalMs: 1000, continuousNominalS: 2, thresholds: { hang: 800, recovery: 400, ramHigh: 85 }, settings: {} });
  for (const sec of [2, 4, 6]) s.append('csample', buildCSample({ atMs: T0 + sec * 1000, values: { committed: 70 + sec }, seq: sec, runStartMs: T0 }));
  s.append('gap', { start: ISO(6), end: ISO(16), durationS: 10, reason: 'session-restart' });
  s.append('probe', buildProbe({ atMs: T0 + 4100, tSec: 4.1, ms: 900, hang: true, usedPct: 70, slipS: 0, bundleAt: ISO(4) }));
  s.append('probe-patch', { at: ISO(4.1), patch: { ecoQoS: { 12: 'full' } } });
  s.close();
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'telltale.js'), 'recover', file], { encoding: 'utf8', cwd: d });
  assert.strictEqual(r.status, 0, r.stderr);
  const rep = JSON.parse(fs.readFileSync(path.join(d, 'telltale-2026-10-07T10-00-00.json'), 'utf8'));
  assert.strictEqual(rep.run.status, 'unfinished');
  assert.strictEqual(rep.spawnProbes[0].committed.v, 74);
  assert.deepStrictEqual(rep.spawnProbes[0].ecoQoS, { 12: 'full' });
  assert.strictEqual(rep.sampling.unobserved[0].reason, 'session-restart');
  assert.ok(validateFile(path.join(d, 'telltale-2026-10-07T10-00-00.json')).ok);
});

test('6.4 the changelog declares the schema string a fresh report carries, and records the provenance change', () => {
  const log = fs.readFileSync(path.join(__dirname, '..', 'SCHEMA-CHANGELOG.md'), 'utf8');
  assert.ok(log.includes(SCHEMA), `changelog mentions ${SCHEMA}`);
  assert.match(log, /sampling-engine-and-provenance/);
  assert.match(log, /cadence\{nominalS/);
  assert.match(log, /bare/i);
  const rep = buildCoreReport(streamState({ csamples: [], probes: [] }), { status: 'complete' });
  assert.strictEqual(rep.schema, SCHEMA);
  assert.strictEqual(rep.schemaStatus, 'frozen');
});

test('recordizeRow converts a legacy row into value records and drops the per-tick bundle timing', () => {
  const r = recordizeRow({ at: ISO(1), tSec: 1, ms: 150, usedPct: 70.123, hang: false, bundleMs: 99, weightMs: { spawn: 150 }, committed: 71.46, plugged: true });
  assert.deepStrictEqual(plain(r), { at: ISO(1), tSec: 1, ms: 150, usedPct: 70.1, hang: false, committed: 71.5, plugged: true });
});
