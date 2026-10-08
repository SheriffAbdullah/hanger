'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TT = path.join(__dirname, '..', 'telltale.js');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'battery-1308.json'), 'utf8'));
const withSchema = (schema) => JSON.stringify({ ...base, schema });

test('trend shows v1 labelled pre-fix and reports a v9 file as an unknown schema', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ver-'));
  fs.writeFileSync(path.join(d, 'telltale-2026-01-15T10-00-00.json'), withSchema('telltale-json/1'));
  fs.writeFileSync(path.join(d, 'telltale-2026-01-15T11-00-00.json'), withSchema('telltale-json/9'));
  fs.writeFileSync(path.join(d, 'telltale-2026-01-15T12-00-00.json'), withSchema('telltale-json/2'));
  const r = spawnSync(process.execPath, [TT, 'trend', '--out', d], { encoding: 'utf8', cwd: d });
  assert.match(r.stdout, /v1 \(pre-fix; rates may be overstated\)/);
  assert.match(r.stdout, /SKIPPED telltale-2026-01-15T11-00-00\.json: unknown schema 'telltale-json\/9'/);
  assert.match(r.stdout, /2 reports/);
});

test('reports declare v2 frozen in the fixtures', () => {
  assert.strictEqual(base.schema, 'telltale-json/2');
  assert.strictEqual(base.schemaStatus, 'frozen');
});
