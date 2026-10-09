'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeJsonChecked } = require('../lib/serialize');

test('valid JSON is written and read back', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ser-'));
  const r = writeJsonChecked(path.join(d, 'a.json'), { x: 1 });
  assert.ok(r.ok);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d, 'a.json'), 'utf8')), { x: 1 });
});

test('a corrupt serializer is caught: message, .invalid file, non-zero exit, no view', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ser-'));
  const lib = path.join(__dirname, '..', 'lib', 'serialize.js');
  const script = [
    `const { writeJsonCheckedOrFail } = require(${JSON.stringify(lib)});`,
    "const fs = require('fs');",
    `const r = writeJsonCheckedOrFail(${JSON.stringify(path.join(d, 'r.json'))}, {}, { serialize: () => '{"p": "C:\\\\Users\\\\x" broken' });`,
    `if (r.ok) fs.writeFileSync(${JSON.stringify(path.join(d, 'r.md'))}, 'view');`,
  ].join('\n');
  const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /INVALID JSON/);
  assert.match(res.stderr, /r\.json/);
  assert.ok(fs.existsSync(path.join(d, 'r.json.invalid')));
  assert.ok(!fs.existsSync(path.join(d, 'r.md')));
});
