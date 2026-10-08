'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { renderAll } = require('../lib/render');
const fx = path.join(__dirname, 'fixtures');
const base = require('./fixtures/sample-r03.json');

test('every view says the power source is not recorded when the state is unknown, never Battery', () => {
  const rep = JSON.parse(JSON.stringify(base));
  rep.power.plugged = null;
  for (const p of rep.spawnProbes) p.plugged = null;
  const out = renderAll(rep, { jsonName: 'x.json', htmlName: 'x.report.html', emailName: 'x.email.txt' });
  assert.match(out.email, /power source not recorded/);
  assert.ok(!/on battery|ON BATTERY/.test(out.email + out.md));
  assert.ok(!/power-battery/.test(out.html));
});

test('print renderer CLI renders a v2 fixture and refuses unreadable/v1 files by name', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-views-'));
  const script = path.join(__dirname, '..', 'render-print.js');
  const ok = spawnSync(process.execPath, [script, path.join(fx, 'battery-1308.json'), path.join(d, 'o.html')], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(d, 'o.html')));
  fs.writeFileSync(path.join(d, 'broken.json'), '{ not json');
  const bad = spawnSync(process.execPath, [script, path.join(d, 'broken.json')], { encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /broken\.json/);
  const v1 = JSON.parse(fs.readFileSync(path.join(fx, 'battery-1308.json'), 'utf8'));
  v1.schema = 'telltale-json/1';
  fs.writeFileSync(path.join(d, 'old.json'), JSON.stringify(v1));
  const old = spawnSync(process.execPath, [script, path.join(d, 'old.json')], { encoding: 'utf8' });
  assert.notStrictEqual(old.status, 0);
  assert.match(old.stderr, /re-capture/);
});
