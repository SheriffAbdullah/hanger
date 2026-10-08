'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { grepArtifacts } = require('./helpers/grep-artifacts');
const { validateText } = require('./helpers/validate-report');
const fx = path.join(__dirname, 'fixtures');

test('grep-artifacts finds a hit and reports a clean directory', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-grep-'));
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello\nUser ALICE here\n');
  const hits = grepArtifacts(d, ['alice']);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].line, 2);
  assert.strictEqual(grepArtifacts(d, ['bob']).length, 0);
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'helpers', 'grep-artifacts.js'), d, 'alice']);
  assert.strictEqual(cli.status, 1);
});

test('validate-report accepts fixtures and rejects Infinity', () => {
  for (const f of ['sample-r03.json', 'battery-1308.json', 'loaded-78s.json']) {
    assert.ok(validateText(fs.readFileSync(path.join(fx, f), 'utf8')).ok, f);
  }
  assert.strictEqual(validateText('{"a": Infinity}').ok, false);
  const bad = validateText(JSON.stringify({ schema: 'x', run: {}, window: {}, settings: {}, summary: { v: 'Infinity' } }));
  assert.strictEqual(bad.ok, false);
});
