'use strict';
// Deliberate legacy "telltale" aliases (product renamed to Hanger). Remove with lib/legacy.js after one release.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const legacy = require('../lib/legacy');
const reportsIo = require('../lib/reports-io');
const scopeLib = require('../lib/scope');
const { validateText } = require('./helpers/validate-report');

const fx = path.join(__dirname, 'fixtures');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hg-legacy-'));
const base = JSON.parse(fs.readFileSync(path.join(fx, 'battery-1308.json'), 'utf8'));

test('legacy env names alias to HANGER_* with a notice; the new name wins', () => {
  const env = { TELLTALE_TEST_KEYS: '5', TELLTALE_PHASE_KEY: '1', HANGER_PHASE_KEY: '0' };
  const lines = [];
  const used = legacy.applyLegacyEnv(env, (l) => lines.push(l));
  assert.deepStrictEqual(used.sort(), ['TELLTALE_PHASE_KEY', 'TELLTALE_TEST_KEYS']);
  assert.strictEqual(env.HANGER_TEST_KEYS, '5');
  assert.strictEqual(env.HANGER_PHASE_KEY, '0');
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /deprecated/);
  assert.strictEqual(legacy.applyLegacyEnv({ HANGER_X: '1' }, () => assert.fail('no notice expected')).length, 0);
});

test('a legacy telltale.scope.json is found, used, and announced - never silently ignored', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'telltale.scope.json'), JSON.stringify({ version: 1, entries: [{ name: 'node', enabled: true }] }));
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let s;
  try { s = scopeLib.loadScope({ cfg: {}, args: [], cwd: d }); } finally { console.log = orig; }
  assert.strictEqual(s.decl.mode, 'allowlist');
  assert.ok(logs.some((l) => /legacy telltale\.scope\.json/.test(l) && /hanger\.scope\.json/.test(l)), logs.join('|'));
});

test('the new scope file name wins over the legacy one', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'telltale.scope.json'), JSON.stringify({ version: 1, entries: [{ name: 'old', enabled: true }] }));
  fs.writeFileSync(path.join(d, 'hanger.scope.json'), JSON.stringify({ version: 1, entries: [{ name: 'new', enabled: true }] }));
  const s = scopeLib.loadScope({ cfg: {}, args: [], cwd: d });
  assert.ok(/hanger\.scope\.json$/.test(s.decl.filePath || s.decl.path || ''), JSON.stringify(s.decl).slice(0, 200));
});

test('findWithLegacy resolves hanger.config.json first, then the legacy name with a hint', () => {
  const d = tmp();
  assert.strictEqual(legacy.findWithLegacy(d, 'hanger.config.json', 'telltale.config.json', () => {}), null);
  fs.writeFileSync(path.join(d, 'telltale.config.json'), '{}');
  const lines = [];
  assert.strictEqual(legacy.findWithLegacy(d, 'hanger.config.json', 'telltale.config.json', (l) => lines.push(l)), path.join(d, 'telltale.config.json'));
  assert.match(lines[0], /Rename it to hanger\.config\.json/);
  fs.writeFileSync(path.join(d, 'hanger.config.json'), '{}');
  assert.strictEqual(legacy.findWithLegacy(d, 'hanger.config.json', 'telltale.config.json', () => assert.fail('no hint')), path.join(d, 'hanger.config.json'));
});

test('readers accept hanger-json/2 and the legacy telltale-json/2 id, and scan both file stems', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'hanger-2026-01-15T10-00-00.json'), JSON.stringify({ ...base, schema: 'hanger-json/2' }));
  fs.writeFileSync(path.join(d, 'telltale-2026-01-14T10-00-00.json'), JSON.stringify({ ...base, schema: 'telltale-json/2' }));
  const scan = reportsIo.scanTraceReports(d);
  assert.strictEqual(scan.files.length, 2);
  assert.ok(scan.files.every((f) => f.ok && f.version === 'v2'), JSON.stringify(scan.files.map((f) => f.error)));
  assert.strictEqual(reportsIo.schemaVersion({ schema: 'telltale-json/1' }).version, 'v1');
  assert.strictEqual(reportsIo.schemaVersion({ schema: 'hanger-json/9' }).version, 'unknown');
});

test('the validator accepts a legacy telltale-json/2 report', () => {
  const r = validateText(JSON.stringify({ ...base, schema: 'telltale-json/2' }));
  assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
});

test('an old telltale-json/2 report still renders', () => {
  const d = tmp();
  const inp = path.join(d, 'telltale-2026-01-14T10-00-00.json');
  fs.writeFileSync(inp, JSON.stringify({ ...base, schema: 'telltale-json/2' }));
  const out = path.join(d, 'o.html');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'render-print.js'), inp, out], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));
});
