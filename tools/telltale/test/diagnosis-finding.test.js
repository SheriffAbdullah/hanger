'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { diagnose } = require('../lib/diagnosis/engine');
const { mkReport, calm } = require('./helpers/diag-report');
const { validateFile } = require('./helpers/validate-report');
const r03 = require('./fixtures/diagnosis/sample-r03.json');
const mem = require('./fixtures/diagnosis/memory-13-08-14.json');
const battery = require('./fixtures/battery-1308.json');

const TT = path.join(__dirname, '..', 'telltale.js');
const lead = [{ t: 2, ms: 150 }];
const BANNED = /RAM-BOUND|PRESSURED|STALL-OBSERVED|SUSTAINED-PRESSURE/;
const ADVICE = /\b(buy|upgrade|replace|purchase|reimage)\b/i;

// ---- ranking and roll-up ----
test('roll-up counts coinciding hangs: memory 4 of 5 ranks above disk 1 of 5', () => {
  const probes = [...lead, ...calm(11, 10, 1, { commit: 60, diskLat: 4 })];
  [30, 60, 90, 120].forEach((t) => probes.push({ t, ms: 1500, hang: true, commit: 91, availMB: 300, diskLat: 4 }));
  probes.push({ t: 147, ms: 220, commit: 60, diskLat: 41, diskQ: 2 }, { t: 150, ms: 1500, hang: true, commit: 60, diskLat: 40, diskQ: 2 }, { t: 153, ms: 230, commit: 60, diskLat: 44, diskQ: 2 });
  const d = diagnose(mkReport({ probes }));
  const byId = Object.fromEntries(d.rollup.map((r) => [r.id, r]));
  assert.deepStrictEqual([byId['memory-pressure'].hangs, byId['memory-pressure'].of], [4, 5]);
  assert.deepStrictEqual([byId['disk-stall'].hangs, byId['disk-stall'].of], [1, 5]);
  assert.strictEqual(d.rollup[0].id, 'memory-pressure');
  assert.ok(d.rollup.findIndex((r) => r.id === 'memory-pressure') < d.rollup.findIndex((r) => r.id === 'disk-stall'));
  assert.match(d.finding.sentence, /^4 of 5 usable hangs coincide with memory pressure/);
});

// ---- finding outcomes ----
test('the R03 sample (0 hangs) is no-freeze-observed with insufficient strength and no memory label', () => {
  const d = diagnose(r03);
  assert.strictEqual(d.finding.class, 'no-freeze-observed');
  assert.strictEqual(d.finding.strength, 'insufficient (4 usable probes, minimum 10)');
  assert.deepStrictEqual(d.rollup, []);
  assert.ok(!/memory/i.test(d.finding.sentence));
  assert.ok(d.observations.length >= 2 && d.observations.some((o) => /commit/.test(o)));
  assert.strictEqual(d.timeLost, null);
});

test('the 13-08-14 fixture is memory with 5 of 5, 90%, 62% and n=18, no STATE token', () => {
  const d = diagnose(mem);
  assert.strictEqual(d.finding.class, 'memory');
  for (const s of ['5 of 5', '90%', '62%', 'n=18']) assert.ok(d.finding.sentence.includes(s), `${s} in: ${d.finding.sentence}`);
  assert.ok(!/STATE/.test(JSON.stringify(d)));
  assert.deepStrictEqual(d.finding.confirmations, { 'user-mark': 2, 'os-not-responding': 0, 'workload-probe': 0, 'probe-only': 3 });
  assert.strictEqual(d.finding.strength, 'sufficient');
  assert.strictEqual(d.finding.scope, 'open scope');
  assert.strictEqual(d.finding.window.observedS, mem.window.observedS);
});

test('undetermined: enough probes and hangs but no rule fires, and every rule is listed with its non-firing reason', () => {
  const probes = [...lead, ...calm(12, 10, 1), { t: 40, ms: 1500, hang: true }, { t: 60, ms: 1500, hang: true }, { t: 80, ms: 1500, hang: true }];
  const d = diagnose(mkReport({ probes }));
  assert.strictEqual(d.finding.class, 'undetermined');
  assert.deepStrictEqual(d.finding.rulesChecked.map((r) => r.id).sort(), ['battery-power-plan', 'commit-limit-pressure', 'cpu-saturation', 'database-memory-io', 'disk-nearly-full', 'disk-stall', 'driver-interrupt-storm', 'gpu-contention', 'hard-fault-thrash', 'memory-pressure', 'outside-scope', 'security-contention', 'single-process-dominance', 'thermal-power-throttle', 'vm-memory-dominance']);
  assert.ok(d.finding.rulesChecked.every((r) => r.reason || r.disproved));
  assert.deepStrictEqual(d.rollup, []);
});

test('hangs that were all observer-affected give insufficient-evidence, not a cause', () => {
  const probes = [{ t: 2, ms: 150 }, { t: 12, ms: 1500, hang: true, slipS: 6, commit: 91 }, ...calm(12, 20, 1)];
  const d = diagnose(mkReport({ probes }));
  assert.strictEqual(d.finding.class, 'insufficient-evidence');
  assert.match(d.finding.sentence, /observer-affected/);
});

// ---- no canned or assumed content ----
test('unobserved software is never named: no Docker, Playwright, vmmem or OOM text in any diagnosis', () => {
  for (const rep of [r03, mem, battery]) {
    const text = JSON.stringify(diagnose(rep));
    assert.ok(!/Docker|Playwright|vmmem|OOM/i.test(text), text.slice(0, 200));
  }
});

test('the old verdict, RCA constants and canned consequence text are gone from the source', () => {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'telltale.js'), path.join(root, 'trend.js'), path.join(root, 'render-print.js')];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  files.push(...walk(path.join(root, 'lib')).filter((f) => f.endsWith('.js')));
  const re = /RAM-BOUND|PRESSURED|Playwright timeouts|Docker OOM|STATE:|costNote|costV2|unknown-probe-noise|discriminat/;
  const hits = [];
  for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) hits.push(`${path.relative(root, f)}:${i + 1}: ${l.trim().slice(0, 80)}`); });
  assert.deepStrictEqual(hits, []);
});

// ---- time lost ----
test('no hangs, no cost: the diagnosis holds no time-lost or currency figure', () => {
  const d = diagnose(mkReport({ probes: [...lead, ...calm(12)] }));
  assert.strictEqual(d.timeLost, null);
  assert.ok(!/cost|\$|currency|min\/day/i.test(JSON.stringify(d)));
});

test('measured window only without user inputs: 4 hangs of 2.5 s in 600 s is 10 s frozen in 600 s observed', () => {
  const probes = [...lead, ...calm(12), ...[40, 100, 160, 220].map((t) => ({ t, ms: 2500, hang: true, commit: 91 }))];
  const d = diagnose(mkReport({ probes, durationS: 600 }));
  assert.deepStrictEqual(d.timeLost, { basis: 'measured', hangs: 4, frozenS: 10, observedS: 600, meanFreezeS: 2.5, userSupplied: null });
});

test('extrapolation appears only when the user supplies both inputs, and is labelled user-supplied', () => {
  const probes = [...lead, ...calm(12), ...[40, 100, 160, 220].map((t) => ({ t, ms: 2500, hang: true, commit: 91 }))];
  const rep = mkReport({ probes, durationS: 600 });
  assert.strictEqual(diagnose(rep, { userCost: { activeMin: 450, ratePerHr: null } }).timeLost.userSupplied, null);
  const u = diagnose(rep, { userCost: { activeMin: 450, ratePerHr: 60 } }).timeLost.userSupplied;
  assert.strictEqual(u.label, 'user-supplied extrapolation');
  assert.strictEqual(u.lostMinPerDay, 7.5);
  assert.strictEqual(u.costPerDay, 7.5);
});

// ---- neutral hardware-vs-configuration signal ----
test('neutral signal with supporting deltas: 91% at 5 hangs vs 63% calm (n=20)', () => {
  const probes = [...lead, ...calm(20, 10, 1, { commit: 63 })];
  [60, 90, 120, 150, 180].forEach((t) => probes.push({ t, ms: 1500, hang: true, commit: 91, availMB: 300 }));
  const d = diagnose(mkReport({ probes }));
  assert.deepStrictEqual(d.hwConfigSignal, { value: 'pressure-at-freezes', atHang: { mean: 91, n: 5 }, calm: { mean: 63, n: 20 } });
});

test('large resident group without pressure is reported neutrally; otherwise not-separable', () => {
  const culp = [{ name: 'a', totalMB: 11000, n: 3, pids: [1] }];
  const probes = [...lead, ...calm(14, 10, 1, { commit: 60 }), { t: 40, ms: 1500, hang: true, commit: 70, availMB: 4000, culpritsAtHang: culp }, { t: 60, ms: 1500, hang: true, commit: 71, availMB: 4000, culpritsAtHang: culp }];
  assert.strictEqual(diagnose(mkReport({ probes, totalGB: 16 })).hwConfigSignal.value, 'large-resident-without-pressure');
  const small = probes.map((p) => (p.culpritsAtHang ? { ...p, culpritsAtHang: [{ name: 'a', totalMB: 900 }] } : p));
  assert.strictEqual(diagnose(mkReport({ probes: small, totalGB: 16 })).hwConfigSignal.value, 'not-separable');
});

test('no diagnosis string recommends buying, upgrading, replacing, purchasing or reimaging', () => {
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const rep of [r03, mem, battery]) walk(diagnose(rep));
  const rules = require('../lib/diagnosis/engine').loadRules();
  for (const r of rules) strings.push(r.phrase, r.valueLabel);
  assert.ok(strings.length > 50);
  assert.deepStrictEqual(strings.filter((s) => ADVICE.test(s)), []);
});

// ---- one vocabulary across outputs ----
test('pack, printable view and trend reuse the trace class (disk) and never emit the old labels', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-vocab-'));
  const probes = [...lead, ...calm(12, 10, 1, { diskLat: 4 }), { t: 36, ms: 200, diskLat: 38, diskQ: 1 }, { t: 40, ms: 1500, hang: true, diskLat: 41, diskQ: 2 }, { t: 44, ms: 220, diskLat: 55, diskQ: 3 }];
  const disk = diagnose(mkReport({ probes }));
  assert.strictEqual(disk.finding.class, 'disk');
  const trace = JSON.parse(JSON.stringify(battery));
  trace.diagnosis = disk;
  const traceFile = path.join(dir, 'telltale-2026-01-15T10-00-00.json');
  fs.writeFileSync(traceFile, JSON.stringify(trace));
  const run = (...a) => spawnSync(process.execPath, [TT, ...a, '--out', dir], { encoding: 'utf8', cwd: dir, timeout: 120000 });
  const pk = run('pack');
  const packFile = fs.readdirSync(dir).find((f) => /^pack-.*\.json$/.test(f));
  const packText = fs.readFileSync(path.join(dir, packFile), 'utf8');
  assert.strictEqual(JSON.parse(packText).finding.class, 'disk');
  const printOut = path.join(dir, 'p.html');
  const rp = spawnSync(process.execPath, [path.join(__dirname, '..', 'render-print.js'), traceFile, printOut], { encoding: 'utf8' });
  assert.strictEqual(rp.status, 0, rp.stderr);
  const html = fs.readFileSync(printOut, 'utf8');
  assert.match(html, /Finding: disk/);
  const rpp = spawnSync(process.execPath, [path.join(__dirname, '..', 'render-print.js'), path.join(dir, packFile), path.join(dir, 'pp.html')], { encoding: 'utf8' });
  assert.strictEqual(rpp.status, 0, rpp.stderr);
  const packHtml = fs.readFileSync(path.join(dir, 'pp.html'), 'utf8');
  assert.match(packHtml, /Finding: disk/);
  const tr = spawnSync(process.execPath, [TT, 'trend', '--out', dir], { encoding: 'utf8', cwd: dir, timeout: 60000 });
  assert.match(tr.stdout, /\| disk\s+\|/);
  for (const [name, text] of [['pack', packText + pk.stdout], ['print', html], ['pack print', packHtml], ['trend', tr.stdout]]) assert.ok(!BANNED.test(text), `${name} carries an old label`);
  assert.ok(!/"cost"|"discriminator"|"rca"/.test(packText));
});

test('trend shows a pre-engine verdict as legacy:<label>, never mapped onto the new vocabulary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-legacy-'));
  const old = JSON.parse(JSON.stringify(battery));
  delete old.diagnosis;
  old.summary.verdict = 'STATE: RAM-BOUND (this trace)';
  fs.writeFileSync(path.join(dir, 'telltale-2026-01-15T10-00-00.json'), JSON.stringify(old));
  const tr = spawnSync(process.execPath, [TT, 'trend', '--out', dir], { encoding: 'utf8', cwd: dir, timeout: 60000 });
  assert.match(tr.stdout, /legacy:RAM-BOUND/);
});

// ---- the shipped fixtures and sample ----
test('the diagnosis fixtures are valid reports and the fixture builder is deterministic', () => {
  const { writeAll } = require('./fixtures/build-diagnosis-fixtures');
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-dfx-'));
  writeAll(a);
  for (const f of fs.readdirSync(a)) {
    assert.ok(validateFile(path.join(a, f)).ok, f);
    assert.strictEqual(fs.readFileSync(path.join(a, f), 'utf8'), fs.readFileSync(path.join(__dirname, 'fixtures', 'diagnosis', f), 'utf8'), `${f} is stale: rerun build-diagnosis-fixtures.js`);
  }
});

test('a hang-free calm run and a calm baseline yield no cause (no rule is fired)', () => {
  const d = diagnose(mkReport({ probes: [...lead, ...calm(20)] }));
  assert.strictEqual(d.finding.class, 'no-freeze-observed');
  assert.strictEqual(d.finding.strength, 'sufficient');
  assert.deepStrictEqual(d.rollup, []);
  assert.deepStrictEqual(d.hangs, []);
});
