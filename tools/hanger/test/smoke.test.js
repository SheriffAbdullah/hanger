'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every lib module requires without side effects', () => {
  const dir = path.join(__dirname, '..', 'lib');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 8);
  for (const f of files) assert.doesNotThrow(() => require(path.join(dir, f)), f);
});

test('hanger.js is requirable and does not start a trace', () => {
  const t = require('../hanger.js');
  assert.strictEqual(typeof t.main, 'function');
});
