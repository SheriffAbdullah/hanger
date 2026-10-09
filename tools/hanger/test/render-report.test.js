'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { renderAll, writeViews } = require('../lib/render');
const { buildSections, profileRows } = require('../lib/render/sections');
const { renderCharts } = require('../lib/render/svg-charts');
const { extract } = require('../lib/render/series');
const { fmt } = require('../lib/render/format');
const { walkFacts } = require('../lib/system-profile');

const dir = path.join(__dirname, 'fixtures', 'report');
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8'));
const F = { jsonName: 'x.json', htmlName: 'x.report.html', emailName: 'x.email.txt', jsonSha256: 'a'.repeat(64) };
const NAMES = ['full-signals', 'zero-hang', 'open-scope', 'scoped-nothing-running', 'gpu-present'];
const ORDER = ['Run and scope', 'Finding', 'What IT can do', 'Evidence', 'System profile', 'Gaps and receipts', 'Appendix'];
const htmlOrder = (h) => [...h.matchAll(/<h2>\d\. ([^<]+)<\/h2>/g)].map((m) => m[1]);
const mdOrder = (m) => [...m.matchAll(/^## \d\. (.+)$/gm)].map((x) => x[1]);

test('fixtures parse', () => {
  for (const f of fs.readdirSync(dir)) JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
});

test('section order is fixed and identical in HTML and Markdown, trace and pack; scope leads page one', () => {
  for (const n of [...NAMES, 'pack']) {
    const raw = load(n);
    assert.deepStrictEqual(buildSections(raw, F).sections.map((s) => s.title), ORDER, n);
    const out = renderAll(raw, F);
    assert.deepStrictEqual(htmlOrder(out.html), ORDER, `${n} html`);
    assert.deepStrictEqual(mdOrder(out.md), ORDER, `${n} md`);
    assert.ok(out.html.indexOf('class="banner') < out.html.indexOf('data-section="finding"'), n);
    assert.ok(out.md.indexOf('SCOPE') < out.md.indexOf('## 2. Finding'), n);
  }
  const o = renderAll(load('full-signals'), F);
  assert.ok(o.html.indexOf('data-section="finding"') < o.html.indexOf('<table class="hangs"'));
  assert.match(o.html, /SX-1 Laptop/); assert.match(o.html, /SYN0000001/); assert.match(o.html, /2026-01-15/); assert.match(o.html, /allowlist/);
  assert.match(o.html, /id="email-draft"/);
});

test('finding reproduces the diagnosis in at most three lines; zero-hang names no cause', () => {
  const fb = buildSections(load('full-signals'), F).sections[1].blocks[0];
  assert.ok(fb.lines.length <= 3);
  const text = fb.lines.join(' ');
  for (const t of ['3 freezes', '91', '62', 'n=3/8', 'memory pressure', '2 confirmed by your marks']) assert.ok(text.includes(t), t);
  assert.match(fb.head, /memory pressure/);
  const z = buildSections(load('zero-hang'), F).sections[1].blocks[0];
  const zt = `${z.head} ${z.lines.join(' ')}`;
  assert.match(zt, /No freeze/);
  assert.ok(!/memory pressure|CPU saturation|disk stall|thermal|GPU contention|security-software/i.test(zt), zt);
});

test('what IT can do lists suggested actions cheapest-first with rule ids; an empty list says so', () => {
  const r = load('full-signals');
  r.diagnosis.suggestedActions = [{ key: 'vm-memory-cap', text: 'Set or lower the VM memory cap', ruleIds: ['vm-memory-dominance'], hangs: 3, of: 3, confidence: 0.8 }, { key: 'app-memory', text: 'Investigate the application memory use', ruleIds: ['single-process-dominance'], hangs: 2, of: 3 }];
  const b = buildSections(r, F).sections[2].blocks[0];
  assert.strictEqual(b.t, 'ol');
  assert.match(b.items[0], /VM memory cap.*vm-memory-dominance.*3 of 3/);
  assert.match(b.items[1], /single-process-dominance/);
  r.diagnosis.suggestedActions = [];
  assert.match(buildSections(r, F).sections[2].blocks[0].text, /No action suggested/);
});

test('suggested actions in the engine shape (hangs {k, of}, rules objects) render with k of M', () => {
  const r = load('full-signals');
  r.diagnosis.suggestedActions = [{ key: 'app-memory', rank: 5, text: 'Investigate memory', ruleIds: ['single-process-dominance'], rules: [{ id: 'single-process-dominance', hangs: 2, of: 3, confidence: 0.7 }], hangs: { k: 2, of: 3, label: '2/3' }, confidence: 0.7 }];
  assert.match(buildSections(r, F).sections[2].blocks[0].items[0], /single-process-dominance; 2 of 3 freezes; confidence 0.7/);
});

test('evidence: one hang-table row per freeze with per-rule columns; run summary present', () => {
  const o = renderAll(load('full-signals'), F);
  assert.match(o.html, /<table class="hangs" data-rows="3">/);
  assert.match(o.html, /memory-pressure \(calm 62\.2%, n=8\)/);
  assert.match(o.md, /Run summary/);
});

test('system profile: one row per fact, null facts carry their reason', () => {
  const r = load('full-signals');
  const n = []; walkFacts(r.systemProfile, (f) => n.push(f));
  assert.strictEqual(profileRows(r.systemProfile).length, n.length);
  const o = renderAll(r, F);
  assert.match(o.md, /Battery design capacity \| not available \(requires admin\)/);
  assert.match(o.html, /Battery design capacity<\/td><td>not available \(requires admin\)/);
  assert.strictEqual((o.html.match(/<table class="profile" data-rows="(\d+)"/) || [])[1], String(n.length));
});

test('gaps: every failure appears once in plain words; raw shell text never appears', () => {
  const r = load('full-signals');
  r['collection.failures'] = [
    { inference: 'container.state', collector: 'dockerState', mode: 'missing', reason: 'not installed' },
    { inference: 'gpu.nvidia_info', collector: 'nvidiaSmi', mode: 'missing', reason: "'nvidia-smi' is not recognized as an internal or external command" },
    { inference: 'sys.admin_signals', collector: 'adminSnap', mode: 'tier', reason: 'process not elevated' },
  ];
  const o = renderAll(r, F);
  assert.match(o.html, /Docker: not installed/);
  assert.ok(!/is not recognized as an internal or external command/.test(o.html + o.md + o.email));
  const ul = o.html.match(/<ul class="gaps-failure">([\s\S]*?)<\/ul>/)[1];
  assert.strictEqual((ul.match(/<li>/g) || []).length, 3);
  assert.match(o.md, /Docker: not installed/);
});

test('appendix: events split, cost only with hangs, file hash', () => {
  const o = renderAll(load('full-signals'), F);
  assert.match(o.html, /Windows events during this run/); assert.match(o.html, /History before this run/);
  assert.match(o.html, /Measured time lost/); assert.ok(o.html.includes('a'.repeat(64)));
  const z = renderAll(load('zero-hang'), F);
  assert.ok(!/Measured time lost/.test(z.html + z.md));
  assert.ok(!/\$\d|currency|min\/day/.test(o.html + z.html + o.email));
});

test('display precision: no over-precise numbers; null never shown as zero', () => {
  assert.strictEqual(fmt(64.7166289074152, '%'), '64.7%');
  assert.strictEqual(fmt(18176.0803, '/s'), '18176/s');
  assert.strictEqual(fmt(null, 'ms', 'counter missing'), 'not available (counter missing)');
  assert.strictEqual(fmt({ v: 5.123, unit: 'MB', prec: 1, src: 's' }, null), '5 MB');
  const r = load('full-signals');
  r.summary.committedPeak = 64.7166289074152; r.summary.pagesPeak = 18176.0803;
  const strip = (t) => t.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\b\d+\.\d+\.\d+(\.\d+)*\b/g, '').replace(/[0-9a-f]{40,}/g, '');
  for (const rep of [r, load('zero-hang')]) {
    const o = renderAll(rep, F);
    assert.ok(!/\d+\.\d{3,}/.test(strip(o.html)), (strip(o.html).match(/.{20}\d+\.\d{3,}.{10}/) || [''])[0]);
    assert.ok(!/\d+\.\d{3,}/.test(strip(o.md)));
  }
  assert.match(renderAll(r, F).md, /64\.7%/);
  const d = load('full-signals'); d.summary.minFreeGB = null; d.summary.nulls = { minFreeGB: 'counter missing' };
  assert.match(renderAll(d, F).md, /Lowest free memory \| not available \(counter missing\)/);
});

test('IT views carry no developer-only rows; the JSON keeps the fields', () => {
  const r = load('full-signals');
  Object.assign(r.summary, { loopP50ms: 3, loopP95ms: 80, loopConfoundNote: 'loop-lag polluted by prover sync exec', warpSeenMB: 10, openspecSeenMB: 5 });
  r.flags = { hasWarp: true, hasOpenspec: true };
  const o = renderAll(r, F);
  assert.ok(!/loop lag|loop-lag|Warp|openspec|prover/i.test(o.html + o.md + o.email));
  assert.ok('loopP95ms' in r.summary && r.flags.hasWarp);
});

test('charts: required panels share one wall-clock domain, honest axes, captions with n', () => {
  const raw = load('full-signals');
  const ch = renderCharts(extract(raw));
  assert.deepStrictEqual(ch.panels.map((p) => p.id), ['freeze', 'memory', 'cpu', 'clock-thermal-power', 'disk', 'processes']);
  const stamps = [...raw.samples, ...raw.spawnProbes].map((x) => Date.parse(x.at));
  const t0 = Math.min(...stamps), t1 = Math.max(...stamps);
  for (const p of ch.panels) {
    assert.ok(p.html.includes(`data-x0="${t0}"`) && p.html.includes(`data-x1="${t1}"`), p.id);
    assert.match(p.html, /<figcaption class="caption">[^<]*n=\d+/);
  }
  const subs = [...ch.html.matchAll(/<g class="subplot"[^>]*data-unit="([^"]*)" data-domain="([^"]*)"/g)];
  assert.ok(subs.length >= 10);
  for (const [, unit, dom] of subs) { assert.ok(unit.length > 0); if (unit === '%') assert.strictEqual(dom, '0,100'); }
  const fz = ch.panels[0].html;
  assert.strictEqual((fz.match(/class="probe probe-hang"/g) || []).length, 3);
  assert.match(fz, /class="threshold"/);
  assert.strictEqual((fz.match(/class="user-mark"/g) || []).length, 2);
  assert.ok(['s-ramUsed', 's-commit', 's-pagefile', 's-avail', 's-pagesIn', 's-pagesOut'].every((id) => ch.panels[1].html.includes(id)));
  assert.ok(['s-cpu', 's-defender', 's-dpcIntr', 's-queue'].every((id) => ch.panels[2].html.includes(id)));
  assert.ok(['s-diskLat', 's-diskQ', 's-diskBusy', 's-diskTput'].every((id) => ch.panels[4].html.includes(id)));
  assert.ok(!/data-panel="standby"/.test(ch.html));
});

test('annotations: every panel carries the same hang bands, marks, AC/battery boundary, unobserved shading and workload labels', () => {
  const ch = renderCharts(extract(load('full-signals')));
  let ref = null;
  for (const p of ch.panels) {
    const bands = [...p.html.matchAll(/class="hang-band" data-hang="(\d)" x="([\d.]+)"/g)].map((m) => m[2]);
    assert.strictEqual(bands.length, 3, p.id);
    if (ref) assert.deepStrictEqual(bands, ref, p.id); else ref = bands;
    assert.strictEqual((p.html.match(/class="user-mark"/g) || []).length, 2, p.id);
    assert.strictEqual((p.html.match(/class="ac-batt-boundary"/g) || []).length, 1, p.id);
    assert.strictEqual((p.html.match(/class="unobserved"/g) || []).length, 1, p.id);
    assert.ok(p.html.includes('docker compose up'), p.id);
    assert.ok(/container start: db/.test(p.html), p.id);
  }
});

test('placeholders: temperature null renders its reason; GPU panel is conditional; scoped output names no out-of-scope program', () => {
  const full = renderCharts(extract(load('full-signals')));
  assert.match(full.html, /Temperature: not available \(not exposed at user tier\)/);
  assert.ok(!full.panels.some((p) => p.id === 'gpu'));
  assert.ok(renderCharts(extract(load('gpu-present'))).panels.some((p) => p.id === 'gpu'));
  assert.match(renderAll(load('scoped-nothing-running'), F).html, /load outside the declared scope \(aggregate\)/);
  const proc = renderCharts(extract(load('scoped-nothing-running'))).panels.find((p) => p.id === 'processes').html;
  assert.ok((proc.match(/class="layer/g) || []).length <= 6);
  assert.ok(!/data-layer="(postgres|docker)/.test(proc));
});

test('long traces are downsampled with the fact stated in the caption', () => {
  const r = load('full-signals');
  const base = r.spawnProbes[0];
  r.spawnProbes = Array.from({ length: 5000 }, (_, i) => ({ ...base, at: new Date(Date.parse(base.at) + i * 2000).toISOString(), ms: i % 977 === 0 ? 2000 : 150 }));
  const html = renderCharts(extract(r)).html;
  assert.match(html, /downsampled from 5000 to \d+ points/);
  assert.ok(html.includes('class="probe probe-hang"'));
});

test('self-contained: no external reference, no script, print CSS never hides a chart', () => {
  for (const n of [...NAMES, 'pack']) {
    const o = renderAll(load(n), F);
    assert.ok(!/(src|href)=["']https?:|@import|url\(["']?https?:|https?:\/\//.test(o.html), n);
    assert.ok(!/<script/i.test(o.html), n);
    const print = [...o.html.matchAll(/@media print\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    for (const rule of print.split('}')) {
      const [sel, body] = rule.split('{');
      if (body && /display\s*:\s*none|visibility\s*:\s*hidden/.test(body)) assert.ok(!/(^|[\s,.])(chart|svg|section|figure|body|html|page)\b/.test(sel.replace(/\.noprint/, '')), `${n}: print rule hides ${sel}`);
    }
  }
});

test('pack renders through the same renderer; sections it lacks name the trace file', () => {
  const o = renderAll(load('pack'), F);
  assert.match(o.html, /Not in pack: per-sample charts - see trace hanger-x\.json/);
  assert.match(o.html, /Not in pack: suggested actions/);
});

test('default outputs: exactly json/md/report.html/email.txt; hashes match disk; copy block equals the draft; no inventory name', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-out-'));
  const stem = 'hanger-2026-01-15T10-00-00';
  fs.writeFileSync(path.join(d, `${stem}.json`), fs.readFileSync(path.join(dir, 'full-signals.json')));
  fs.mkdirSync(path.join(d, 'private')); fs.writeFileSync(path.join(d, 'private', 'inventory-2026-01-15.json'), '{}');
  const res = writeViews(path.join(d, stem), {});
  assert.deepStrictEqual(fs.readdirSync(d).filter((f) => f !== 'private').sort(), [`${stem}.email.txt`, `${stem}.json`, `${stem}.md`, `${stem}.report.html`]);
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex');
  const email = fs.readFileSync(path.join(d, `${stem}.email.txt`), 'utf8');
  assert.match(email, /^Subject: Freeze evidence - /);
  assert.ok(email.includes(sha(`${stem}.json`).slice(0, 12)));
  assert.ok(email.includes(sha(`${stem}.report.html`).slice(0, 12)));
  assert.strictEqual(res.htmlSha256, sha(`${stem}.report.html`));
  const html = fs.readFileSync(path.join(d, `${stem}.report.html`), 'utf8');
  const block = html.match(/<pre id="email-text">([\s\S]*?)<\/pre>/)[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const body = (t) => t.split('\n').filter((l) => !/^Attached:/.test(l)).join('\n');
  assert.strictEqual(body(block), body(email));
  assert.ok(html.includes(sha(`${stem}.json`)));
  assert.ok(!/inventory-/.test(html + email + fs.readFileSync(path.join(d, `${stem}.md`), 'utf8')));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-out2-'));
  fs.writeFileSync(path.join(d2, 'hanger-x.json'), fs.readFileSync(path.join(dir, 'full-signals.json')));
  writeViews(path.join(d2, 'hanger-x'), { report: false });
  assert.deepStrictEqual(fs.readdirSync(d2).sort(), ['hanger-x.json', 'hanger-x.md']);
});
