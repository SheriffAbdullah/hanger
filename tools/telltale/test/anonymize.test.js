'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scrubValue, scrubString } = require('../lib/anonymize');

const ctx = { hostname: 'DESKTOP-ABC123', username: 'alice' };

test('all path and identity shapes are scrubbed and output parses', () => {
  const rep = {
    a: 'D:\\Users\\alice\\x', b: 'C:/Users/alice/y', c: 'C--Users-alice-repo', d: 'OneDrive - Contoso Ltd',
    e: 'machine DESKTOP-ABC123 is slow', f: '/home/alice/z', nested: { 'D:\\Users\\alice\\key': ['C:\\Users\\alice\\Documents\\Foo'] },
  };
  const text = JSON.stringify(scrubValue(rep, ctx), null, 2);
  assert.doesNotThrow(() => JSON.parse(text));
  for (const needle of ['alice', 'Contoso', 'DESKTOP-ABC123']) assert.ok(!text.toLowerCase().includes(needle.toLowerCase()), needle);
});

test('scrubbing never mutates the input and keeps non-identity values', () => {
  const rep = { path: 'C:\\Users\\alice\\x', n: 5, ok: true };
  const out = scrubValue(rep, ctx);
  assert.strictEqual(rep.path, 'C:\\Users\\alice\\x');
  assert.strictEqual(out.n, 5);
  assert.strictEqual(out.ok, true);
});

test('text views use the same scrubber', () => {
  const s = scrubString('<p>host DESKTOP-ABC123 at C:\\Users\\alice\\r</p>', ctx);
  assert.ok(!/alice|DESKTOP-ABC123/i.test(s));
});

test('unknown username in an encoded fragment is still scrubbed', () => {
  assert.ok(!scrubString('C--Users-bob-project', { hostname: 'h1', username: 'alice' }).includes('bob'));
});
