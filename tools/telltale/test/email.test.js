'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildEmail, checkEmail, EmailTraceError } = require('../lib/render/email');

const dir = path.join(__dirname, 'fixtures', 'report');
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8'));
const F = { jsonName: 'x.json', jsonSha256: 'ab'.repeat(32), htmlName: 'x.report.html', htmlSha256: 'cd'.repeat(32) };
const TRACES = ['full-signals', 'zero-hang', 'open-scope', 'scoped-nothing-running', 'gpu-present'];

test('subject names model, serial and the freeze count over the observed minutes', () => {
  const e = buildEmail(load('full-signals'), F).text;
  assert.match(e.split('\n')[0], /^Subject: Freeze evidence - SX-1 Laptop SYN0000001 - 3 freezes in 1\.1 min$/);
  const z = buildEmail(load('zero-hang'), F).text;
  assert.match(z.split('\n')[0], /- 0 freezes in /);
  assert.match(z, /no freeze of 800 ms or more was observed/);
  assert.ok(!/memory pressure|CPU saturation|disk stall|thermal|GPU contention|security-software contention/i.test(z), z);
});

test('every numeric token is backed by the JSON, on every fixture', () => {
  for (const n of TRACES) { const e = buildEmail(load(n), F); assert.ok(e.check(), n); }
});

test('an unbacked number fails the render and is named; a missing path renders "not available"', () => {
  const raw = load('full-signals');
  const e = buildEmail(raw, F);
  assert.throws(() => checkEmail(`${e.text}\nExtra 987654 ms`, raw, e.opaque), (x) => x instanceof EmailTraceError && x.tokens.includes('987654') && /987654/.test(x.message));
  const bare = load('full-signals'); delete bare.systemProfile; delete bare.diagnosis.hangDefinition;
  const t = buildEmail(bare, F);
  assert.match(t.text, /not available/);
  assert.ok(t.check());
});

test('scope and gaps lines: open warning, scoped summary without names, admin-only list', () => {
  assert.match(buildEmail(load('open-scope'), F).text, /OPEN SCOPE: names of all running software may appear in the attached report\./);
  const s = buildEmail(load('full-signals'), F).text;
  assert.match(s, /monitored postgres, docker/); assert.match(s, /41 other running groups not monitored and not named/);
  const r = load('full-signals');
  r.spawnProbes.forEach((p) => { p.thermal = { zones: null, zonesReason: 'requires admin' }; });
  assert.match(buildEmail(r, F).text, /Not measurable without admin: [^\n]*temperature/);
});

test('attachment manifest lists json and report.html with 12-hex hashes, never an inventory', () => {
  const e = buildEmail(load('full-signals'), F).text;
  assert.match(e, /Attached: x\.json \(sha256 abababababab\), x\.report\.html \(sha256 cdcdcdcdcdcd\)\./);
  assert.ok(!/inventory/.test(e));
});

test('no "not available" placeholder for the full-signals fixture; actions listed cheapest-first when present', () => {
  const r = load('full-signals');
  assert.ok(!/not available/.test(buildEmail(r, F).text.replace(/^Storage:.*$/m, '')), 'the storage line is its own placeholder, tested in storage-render.test.js');
  r.diagnosis.suggestedActions = [{ text: 'Set the VM cap', ruleIds: ['a'] }, { text: 'Check the app', ruleIds: ['b'] }];
  const e = buildEmail(r, F);
  assert.match(e.text, /1\) Set the VM cap; 2\) Check the app/);
  assert.ok(e.check());
});
