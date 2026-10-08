'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseWerListing } = require('../lib/events');

const T0 = Date.parse('2026-01-15T10:00:00.000Z');
const END = T0 + 60000;

test('in-run and all-time history counts are separate and carry their windows', () => {
  const lines = ['2026-01-15T10:00:20.0000000Z|1']; // in the run
  for (let i = 0; i < 11; i++) lines.push(`2025-1${i % 3}-0${1 + (i % 8)}T08:00:00.0000000Z|${i % 2}`); // history (6 AppHang? computed below)
  const out = parseWerListing(lines.join('\n') + '\nlisted\n', T0, END);
  const hist = lines.slice(1).filter((l) => l.endsWith('|1')).length;
  assert.strictEqual(out.inRun.apphang, 1);
  assert.strictEqual(out.inRun.total, 1);
  assert.strictEqual(out.history.total, 12);
  assert.strictEqual(out.history.apphang, hist + 1);
  assert.strictEqual(out.history.window, 'all-time');
  assert.strictEqual(out.searchedWindow.from, new Date(T0).toISOString());
});

test('no WER entries is an explicit zero with the searched window', () => {
  const out = parseWerListing('listed\n', T0, END);
  assert.strictEqual(out.inRun.total, 0);
  assert.strictEqual(out.history.apphang, 0);
  assert.ok(out.searchedWindow.to);
  assert.strictEqual(parseWerListing('absent\n', T0, END).archivePresent, false);
});
