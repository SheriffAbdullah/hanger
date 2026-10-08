'use strict';
// input-response-stall-detector: diagnosis integration (confirmation source, weights, agreement, helperLate),
// validator rules for the additive schema fields, and reader tolerance (pack, trend) for the `input-stall` label.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { diagnose } = require('../lib/diagnosis/engine');
const { buildContext } = require('../lib/diagnosis/context');
const { packInputBlock } = require('../lib/pack-calc');
const { validateText, validateFile } = require('./helpers/validate-report');
const { mkReport, calm } = require('./helpers/diag-report');
const { section } = require('./helpers/input-section');

const lead = [{ t: 2, ms: 150 }];
const oneHang = (extra, more = {}) => mkReport({ probes: [...lead, ...calm(12), { t: 40, ms: 1500, hang: true }], extra, ...more });
const ctxOf = (r) => buildContext(r);

// ---- 11.1 confirmation source ----
test('an eligible in-scope episode overlapping the hang interval confirms it with input-stall', () => {
  const c = ctxOf(oneHang({ inputStall: section({ episodes: [{ t0: 39.2, t1: 41 }] }) }));
  assert.deepStrictEqual(c.allHangs[0].confirmedBy, ['input-stall']);
});
test('an out-of-scope episode does not confirm, and is counted in the agreement metrics', () => {
  const r = oneHang({ inputStall: section({ episodes: [{ t0: 39.2, t1: 41, kind: 'out-of-scope' }] }) });
  assert.deepStrictEqual(ctxOf(r).allHangs[0].confirmedBy, ['probe-only']);
  assert.strictEqual(diagnose(r).probeAgreement.outOfScopeEpisodes, 1);
});
test('a chronically slow application does not confirm', () => {
  const r = oneHang({ inputStall: section({ episodes: [{ t0: 39.2, t1: 41, guards: ['chronic-slow-app'] }] }) });
  assert.deepStrictEqual(ctxOf(r).allHangs[0].confirmedBy, ['probe-only']);
});
test('several sources are all listed', () => {
  const r = oneHang({ inputStall: section({ episodes: [{ t0: 39.2, t1: 41 }] }) }, { marks: [{ t: 40.5 }] });
  assert.deepStrictEqual(ctxOf(r).allHangs[0].confirmedBy, ['user-mark', 'input-stall']);
});
test('a hang no episode overlaps stays probe-only; so does a report without the section', () => {
  assert.deepStrictEqual(ctxOf(oneHang({ inputStall: section({ episodes: [{ t0: 60, t1: 61 }] }) })).allHangs[0].confirmedBy, ['probe-only']);
  const old = oneHang(null);
  assert.deepStrictEqual(ctxOf(old).allHangs[0].confirmedBy, ['probe-only']);
  assert.strictEqual(diagnose(old).finding.confirmations['input-stall'], undefined);
});
test('the +-2 s widening joins an episode that ends 1.5 s before the hang interval starts', () => {
  const r = oneHang({ inputStall: section({ episodes: [{ t0: 35, t1: 37 }] }) }); // hang interval 38.5..40
  assert.deepStrictEqual(ctxOf(r).allHangs[0].confirmedBy, ['input-stall']);
});

// ---- helper lateness at a hang ----
test('helperLate: true when a late period overlaps, false when none, not evaluated when the helper was not observing', () => {
  const t = oneHang({ inputStall: section({ latePeriods: [[38.8, 40]] }) });
  assert.strictEqual(ctxOf(t).allHangs[0].helperLate, true);
  assert.strictEqual(ctxOf(oneHang({ inputStall: section({}) })).allHangs[0].helperLate, false);
  const gone = ctxOf(oneHang({ inputStall: section({ observed: [0, 20], active: [[0, 20]] }) })).allHangs[0];
  assert.strictEqual(gone.helperLate, 'not evaluated');
  assert.ok(gone.helperLateReason);
  const un = ctxOf(oneHang({ inputStall: section({ status: 'unavailable', reason: 'helper blocked by policy' }) })).allHangs[0];
  assert.strictEqual(un.helperLate, 'not evaluated');
  assert.match(un.helperLateReason, /blocked by policy/);
});

// ---- 11.2 weights ----
const fiveHangs = (extra, marks = []) => {
  const probes = [...lead, ...calm(12, 10, 1, { commit: 60 })];
  [40, 60, 80, 100, 120].forEach((t) => probes.push({ t, ms: 1500, hang: true, commit: 91, availMB: 300 }));
  return mkReport({ probes, marks, extra });
};
const memConf = (d) => d.rollup.find((x) => x.id === 'memory-pressure').confidence;
test('input-stall alone is weighted below a user mark, and both record the weights', () => {
  const eps = [40, 60, 80, 100, 120].map((t) => ({ t0: t - 1, t1: t + 0.5 }));
  const stall = diagnose(fiveHangs({ inputStall: section({ episodes: eps }) }));
  const mark = diagnose(fiveHangs(null, [40, 60, 80, 100, 120].map((t) => ({ t }))));
  assert.ok(memConf(mark) > memConf(stall), `${memConf(mark)} > ${memConf(stall)}`);
  assert.strictEqual(stall.hangs[0].rules.find((x) => x.id === 'memory-pressure').components.K, 0.5);
  assert.strictEqual(mark.hangs[0].rules.find((x) => x.id === 'memory-pressure').components.K, 1);
  assert.deepStrictEqual(stall.confidenceModel.confirmationWeights, { 'user-mark': 1, 'os-not-responding': 1, 'workload-probe': 1, 'input-stall': 0.5, 'probe-only': 0 });
  assert.strictEqual(stall.hangs[0].rules.find((x) => x.id === 'memory-pressure').confirmationWeight, 0.5);
  assert.strictEqual(stall.finding.confirmations['input-stall'], 5);
  assert.match(stall.finding.sentence, /5 by the input-response check/);
});
test('input-stall plus a user mark takes the higher weight; the cap stays exactly 0.95', () => {
  const d = diagnose(fiveHangs({ inputStall: section({ episodes: [{ t0: 39, t1: 41 }] }) }, [{ t: 40 }]));
  assert.strictEqual(d.hangs[0].rules.find((x) => x.id === 'memory-pressure').confirmationWeight, 1);
  assert.strictEqual(d.confidenceModel.cap, 0.95);
  assert.ok(d.rollup.every((x) => x.confidence <= 0.95));
});

// ---- agreement stored as second-order values ----
test('probe agreement and corroboration are stored and recompute equal from the stored section', () => {
  const r = fiveHangs({ inputStall: section({ episodes: [{ t0: 39, t1: 41, by: ['probe-hang'] }, { t0: 150, t1: 151, by: [] }] }) });
  const a = diagnose(r), b = diagnose(JSON.parse(JSON.stringify({ ...r, diagnosis: a })));
  assert.deepStrictEqual(b.probeAgreement, a.probeAgreement);
  assert.deepStrictEqual(b.inputStallCorroboration, a.inputStallCorroboration);
  assert.strictEqual(a.probeAgreement.status, 'evaluated');
  assert.deepStrictEqual([a.probeAgreement.recall.num, a.probeAgreement.recall.den], [1, 2]);
  assert.deepStrictEqual([a.probeAgreement.precision.num, a.probeAgreement.precision.den], [1, 5]);
  assert.strictEqual(a.probeAgreement.stallsWithoutProbeHang.length, 1);
  assert.strictEqual(a.inputStallCorroboration.none.num, 1);
  assert.strictEqual(a.hangDefinition.inputResponse.status, 'running');
  assert.ok(a.hangDefinition.cannotSee.length >= 2);
});
test('agreement is not evaluated, with a reason, when the check was off, unavailable or absent', () => {
  for (const [extra, re] of [[null, /predates/], [{ inputStall: section({ status: 'unavailable', reason: 'helper blocked by policy' }) }, /blocked by policy/], [{ inputStall: { status: 'not-requested', reason: 'turned off by the user', episodes: null } }, /turned off/]]) {
    const d = diagnose(oneHang(extra));
    assert.strictEqual(d.probeAgreement.status, 'not evaluated');
    assert.match(d.probeAgreement.reason, re);
    assert.strictEqual(d.inputStallCorroboration.status, 'not evaluated');
    assert.strictEqual(d.inputStallCorroboration.probeHang, undefined);
  }
});

// ---- 12.1 validator ----
const baseValid = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'loaded-78s.json'), 'utf8'));
test('validator accepts a report carrying a well-formed inputStall and still accepts the old fixture', () => {
  const r = baseValid(); r.inputStall = section({ episodes: [{ t0: 39, t1: 41 }] });
  assert.deepStrictEqual(validateText(JSON.stringify(r)).problems, []);
  assert.ok(validateFile(path.join(__dirname, 'fixtures', 'loaded-78s.json')).ok);
});
test('validator rejects a bare number for an episode duration and names the field', () => {
  const r = baseValid(); r.inputStall = section({ episodes: [{ t0: 39, t1: 41 }] });
  r.inputStall.episodes[0].durationMs = 1840;
  const v = validateText(JSON.stringify(r));
  assert.strictEqual(v.ok, false);
  assert.ok(v.problems.some((p) => p.includes('$.inputStall.episodes[0].durationMs')), v.problems.join('|'));
});
test('schema stays telltale-json/2 frozen in the changelog entry', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'SCHEMA-CHANGELOG.md'), 'utf8');
  assert.match(t, /input-response-stall-detector/);
  for (const f of ['inputStall', 'settings.inputStall', 'diagnosis.probeAgreement', 'diagnosis.inputStallCorroboration', 'helperLate', 'input-stall', 'sampling.observer.helper', 'input-helper-exit', 'input.jsonl', 'input-stall-sample', 'input-skip', 'input-late', 'input-window', 'input-end']) assert.ok(t.includes(f), f);
  assert.match(t, /stays `frozen`/);
});

// ---- 12.2 pack and trend ----
test('pack uses the recorded stall threshold, ignoring --stall-ms', () => {
  const r = oneHang({ inputStall: section({ episodes: [{ t0: 39, t1: 41 }] }) });
  r.diagnosis = diagnose(r);
  const b = packInputBlock(r, 500);
  assert.strictEqual(b.inputStallThreshold.stallMs, 250);
  assert.deepStrictEqual(b.inputStallThreshold.ignoredCurrent, { current: 500, used: 250 });
  assert.strictEqual(b.inputStall.status, 'running');
  assert.strictEqual(b.probeAgreement.status, 'evaluated');
  const old = packInputBlock(baseValid(), 500);
  assert.match(old.inputStall.reason, /predates/);
});
test('trend reads a report whose confirmations include input-stall', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-is-'));
  const base = baseValid();
  base.diagnosis = { ...(base.diagnosis || {}), finding: { ...((base.diagnosis && base.diagnosis.finding) || { class: 'memory', sentence: 's', strength: 'sufficient' }), confirmations: { 'user-mark': 0, 'os-not-responding': 0, 'workload-probe': 0, 'probe-only': 1, 'input-stall': 3 } } };
  base.inputStall = section({ episodes: [{ t0: 39, t1: 41 }] });
  fs.writeFileSync(path.join(d, 'telltale-2026-01-15T12-00-00.json'), JSON.stringify(base));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'telltale.js'), 'trend', '--out', d], { encoding: 'utf8', cwd: d });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 reports|1 report/);
});
