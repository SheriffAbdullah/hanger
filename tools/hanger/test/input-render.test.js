'use strict';
// input-response-stall-detector: renderers (charts, evidence subsection, finding, email, pack) for the scenarios in the
// report-views and it-handoff spec deltas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderAll } = require('../lib/render');
const { buildSections } = require('../lib/render/sections');
const { renderCharts } = require('../lib/render/svg-charts');
const { extract } = require('../lib/render/series');
const { buildEmail } = require('../lib/render/email');
const { attachDiagnosis } = require('../lib/diagnosis/engine');
const { buildInputStall } = require('../lib/input/report');
const { mkReport, calm, T0 } = require('./helpers/diag-report');
const { section } = require('./helpers/input-section');
const { DIR } = require('./helpers/input-fix');

const F = { jsonName: 'x.json', htmlName: 'x.report.html', emailName: 'x.email.txt', jsonSha256: 'a'.repeat(64) };
const HANGS = [40, 60, 80];
// 4 episodes, 3 probe hangs: precision 2/3, recall 3/4 (two episodes sit next to the first hang)
const EPS = [{ t0: 38, t1: 39 }, { t0: 41, t1: 42 }, { t0: 59, t1: 61 }, { t0: 100, t1: 101 }];

function report(is, { hangs = HANGS, withKey = true } = {}) {
  const probes = [{ t: 2, ms: 150 }, ...calm(12), ...hangs.map((t) => ({ t, ms: 1500, hang: true }))];
  const r = mkReport({ probes, durationS: 120, extra: { summary: { hangEventCount: hangs.length, thresholds: { hang: 800, recovery: 400, ramHigh: 85 } }, machine: { logicalCpus: 12, totalGB: 16 }, ...(withKey ? { inputStall: is } : {}) } });
  attachDiagnosis(r, {});
  return r;
}
const html = (r) => renderAll(r, F);
const secBlocks = (r) => buildSections(r, F).sections.find((s) => s.id === 'evidence').blocks;
const inputText = (r) => { const b = secBlocks(r); const i = b.findIndex((x) => x.t === 'sub' && x.text === 'Input-response check'); const j = b.findIndex((x, k) => k > i && x.t === 'sub'); return JSON.stringify(b.slice(i, j)); };
const stallEls = (svg) => [...svg.matchAll(/<rect class="stall-band" data-stall="(\d+)" x="([\d.]+)"/g)].map((m) => [m[1], m[2]]);

test('every panel draws the episodes as stall bands at the same x-positions; hang bands unchanged; key names them', () => {
  const r = report(section({ episodes: EPS }));
  const ex = extract(r);
  const c = renderCharts(ex);
  const hangsOnly = renderCharts(extract(report(section({ episodes: [] }))));
  assert.match(c.key, /hatched bands = automatically detected input-response stalls/);
  assert.ok(c.panels.length >= 4);
  const ref = stallEls(c.panels[0].html);
  assert.strictEqual(ref.length, 4);
  for (const p of c.panels) {
    assert.deepStrictEqual(stallEls(p.html), ref, p.id);
    assert.strictEqual((p.html.match(/class="hang-band"/g) || []).length, 3, p.id);
  }
  // x-positions follow the episode start times
  const xs = ref.map((m) => +m[1]);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3]);
  // the freeze panel has its own row under the strip; the hang bands are identical with and without episodes
  assert.match(c.panels[0].html, /class="stall-row"/);
  const hb = (h) => [...h.matchAll(/class="hang-band"[^>]* x="([\d.]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(hb(c.panels[0].html), hb(hangsOnly.panels[0].html));
  assert.ok(!/stall-band/.test(hangsOnly.panels[0].html));
});

test('an episode that overlaps no probe hang is still drawn', () => {
  const r = report(section({ episodes: [{ t0: 100, t1: 101 }] }));
  const c = renderCharts(extract(r));
  assert.strictEqual(stallEls(c.panels[1].html).length, 1);
  assert.strictEqual((c.panels[1].html.match(/class="hang-band"/g) || []).length, 3);
});

test('unavailable, off and old reports draw nothing and the key says why', () => {
  const un = renderCharts(extract(report(section({ status: 'unavailable', reason: 'helper blocked by policy' }))));
  assert.ok(un.panels.every((p) => !/stall-band|stall-row/.test(p.html)));
  assert.match(un.key, /input-response check was not available \(helper blocked by policy\)/);
  const off = renderCharts(extract(report(section({ status: 'not-requested', reason: 'turned off by the user' }))));
  assert.match(off.key, /turned off by the user/);
  assert.ok(off.panels.every((p) => !/stall-band/.test(p.html)));
  const old = renderCharts(extract(report(null, { withKey: false })));
  assert.match(old.key, /report predates the input-response check/);
});

test('evidence subsection: automatic, episodes, precision 2/3 and recall 3/4 in Markdown and HTML', () => {
  const r = report(section({ episodes: EPS.map((e, i) => ({ ...e, by: i < 3 ? ['probe-hang'] : [] })) }));
  const out = html(r);
  for (const v of [out.md, out.html]) {
    assert.match(v, /Input-response check/);
    assert.match(v, /automatic/);
    assert.match(v, /Probe precision against felt stalls/);
    assert.match(v, /2\/3/); assert.match(v, /3\/4/);
    assert.match(v, /probe hang 3\/4/);
  }
  // after the hang table, before the run summary
  const i = out.md.indexOf('### Input-response check');
  assert.ok(i > out.md.indexOf('### Freezes') && i < out.md.indexOf('### Run summary'));
  assert.match(inputText(r), /Stalls with no probe hang/);
  assert.match(inputText(r), /What this check cannot see/);
});

test('finding keeps three lines and counts the input-response confirmations', () => {
  const r = report(section({ episodes: [{ t0: 39, t1: 41 }, { t0: 59, t1: 61 }, { t0: 79, t1: 81 }] }));
  const f = buildSections(r, F).sections[1].blocks[0];
  assert.ok(f.lines.length <= 3);
  assert.match(f.lines.join(' '), /3 by the input-response check/);
  assert.match(html(r).html, /input-response check/);
});

test('detector unavailable: placeholders, no zero, finding and email say so', () => {
  const r = report(section({ status: 'unavailable', reason: 'helper blocked by policy' }));
  const out = html(r);
  assert.match(inputText(r), /Input-response check: not available \(helper blocked by policy\)/);
  assert.match(out.md, /Input-response check: not available \(helper blocked by policy\)/);
  const f = buildSections(r, F).sections[1].blocks[0];
  assert.match(f.lines.join(' '), /the input-response check was not available/);
  assert.ok(!/0 by the input-response check/.test(f.lines.join(' ')));
  assert.ok(!/episode|precision/i.test(inputText(r).replace(/Input-response check: not available[^"]*/, '')));
  const line = buildEmail(r, F).text.split('\n').find((l) => /^Input-response check/.test(l));
  assert.match(line, /not available \(helper blocked by policy\)/);
  assert.ok(!/\d/.test(line.replace('Input-response check', '')), line);
});

test('detector off: the subsection says the user turned it off', () => {
  const r = report(section({ status: 'not-requested', reason: 'turned off by the user' }));
  assert.match(html(r).md, /turned off by the user/);
  assert.match(buildEmail(r, F).text, /Input-response check: turned off by the user/);
});

test('older report without the key renders the placeholder and does not fail', () => {
  const r = report(null, { withKey: false });
  const out = html(r);
  assert.match(out.md, /Input-response check: not available \(report predates the input-response check\)/);
  assert.match(out.html, /report predates the input-response check/);
  assert.ok(!/Input-response check/.test(buildEmail(r, F).text)); // an old report's email says nothing about a check that did not exist
  buildEmail(r, F).check();
});

test('detector running with probe hangs and no episodes: recall is not evaluated with a reason; no claim that nothing froze', () => {
  const r = report(section({ episodes: [] }));
  const t = inputText(r);
  assert.match(t, /recall.*not evaluated \(the detector observed no stall in evaluated time\)/i);
  assert.match(t, /No input-response stall was observed in the evaluated time/);
  assert.ok(!/did not freeze"|no freeze/i.test(t.replace(/does not show that the machine did not freeze/, '')));
  const line = buildEmail(r, F).text.split('\n').find((l) => /^Input-response check/.test(l));
  assert.match(line, /no input-response stall was observed in the evaluated time/);
  assert.match(line, /does not show that the machine did not freeze/);
});

test('email: one line with episodes, freezes also seen and threshold, every number JSON-backed', () => {
  const r = report(section({ episodes: [{ t0: 39, t1: 41 }, { t0: 59, t1: 61 }, { t0: 79, t1: 81 }, { t0: 100, t1: 101 }] }));
  const e = buildEmail(r, F);
  const lines = e.text.split('\n').filter((l) => /^Input-response check/.test(l));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /4 stall episodes/);
  assert.match(lines[0], /3 of 3 freezes also seen/);
  assert.match(lines[0], /250 ms/);
  assert.ok(e.check());
});

test('out-of-scope episodes: counts and total only, no application name anywhere', () => {
  const canary = 'zzfgcanary9x';
  const is = section({ episodes: [{ t0: 39, t1: 41, kind: 'out-of-scope' }, { t0: 59, t1: 61, kind: 'out-of-scope' }] });
  is.outOfScope = { episodes: { v: 2, unit: 'count', windowS: null, n: 1, src: 'input-helper', at: null, prec: 1 }, totalMs: { v: 4000, unit: 'ms', windowS: null, n: 2, src: 'input-helper', at: null, prec: 1 } };
  is.episodes.forEach((e) => { e.foreground.group = canary; }); // even if a name were present in the data, an out-of-scope row never renders it
  const r = report(is);
  const out = html(r);
  const all = `${out.md}\n${out.html}\n${out.email}`;
  assert.ok(!all.includes(canary));
  assert.match(inputText(r), /outside the declared scope: 2, 4000 ms in total \(no application is named\)/);
  // the stall table lists no out-of-scope rows
  assert.ok(!/"cls":"stalls"/.test(inputText(r)));
});

test('a section built from the fixture helper file renders; no fixture name or title leaks', () => {
  const file = path.join(DIR, 'out-of-scope-episodes.input.jsonl');
  const bridge = JSON.parse(fs.readFileSync(path.join(DIR, 'out-of-scope-episodes.stream-bridge.json'), 'utf8'));
  const is = buildInputStall({ settings: { enabled: { value: true, source: 'default' }, stallMs: { value: 250, source: 'default' }, mergeGapMs: { value: 1000, source: 'default' }, tickMs: { value: 250, source: 'default' }, lateMs: { value: 200, source: 'default' }, ignoreGroups: { value: [], source: 'default' } }, bridge, file, hangs: [], marksMs: [], runEndMs: null });
  assert.strictEqual(is.status, 'running');
  const r = report(is);
  const out = html(r);
  assert.match(out.md, /Input-response check/);
  assert.ok(!/"group":"zz/.test(JSON.stringify(is)));
});

test('pack view tolerates both a pack with and without the input-response block', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'report', 'pack.json'), 'utf8'));
  const a = renderAll(pack, F);
  assert.match(a.md, /Input-response check: not available \(report predates the input-response check\)/);
  const withIs = { ...pack, inputStall: section({ status: 'unavailable', reason: 'helper blocked by policy' }) };
  assert.match(renderAll(withIs, F).md, /not available \(helper blocked by policy\)/);
});

void T0;
