'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ev = require('../lib/events');

const T0 = Date.parse('2026-01-15T10:00:00.000Z');
const END = T0 + 60000;
const raw = (appHang, resourceExhaustion = '', stderr = '') => ({ appHang: { stdout: appHang, stderr }, appCrash: { stdout: '', stderr: '' }, resourceExhaustion: { stdout: resourceExhaustion, stderr: '' } });

test('an event from the previous day is history, not in-window evidence', () => {
  const { section } = ev.buildEventsSection({ raw: raw('2026-01-14T09:00:00.0000000Z|1002|Application Hang|\n'), runStartMs: T0, runEndMs: END });
  assert.strictEqual(section.inWindow.appHang.length, 0);
  assert.strictEqual(section.history.appHang.count, 1);
  assert.strictEqual(section.history.appHang.newest, '2026-01-14T09:00:00.000Z');
  assert.strictEqual(section.mode, 'none-in-window');
});

test('an event inside the run window counts', () => {
  const { section } = ev.buildEventsSection({ raw: raw('2026-01-15T10:00:30.0000000Z|1002|Application Hang|\n'), runStartMs: T0, runEndMs: END });
  assert.strictEqual(section.inWindow.appHang.length, 1);
  assert.strictEqual(section.mode, 'ok');
});

test('wrong provider for resource exhaustion is filtered out', () => {
  const line = '2026-01-15T10:00:10.0000000Z|2004|Some-Other-Provider|Successfully logged OS information\n';
  const { section } = ev.buildEventsSection({ raw: raw('', line), runStartMs: T0, runEndMs: END });
  assert.strictEqual(section.inWindow.resourceExhaustion.length, 0);
  const good = `2026-01-15T10:00:10.0000000Z|2004|${ev.EXHAUSTION_PROVIDER}|Windows successfully diagnosed a low virtual memory condition\n`;
  assert.strictEqual(ev.buildEventsSection({ raw: raw('', good), runStartMs: T0, runEndMs: END }).section.inWindow.resourceExhaustion.length, 1);
});

test('an empty result is none-in-window and yields no timeout failure', () => {
  for (const stderr of ['', 'No events were found that match the specified selection criteria.']) {
    const { section, failures } = ev.buildEventsSection({ raw: raw('', '', stderr), runStartMs: T0, runEndMs: END });
    assert.strictEqual(section.mode, 'none-in-window');
    assert.ok(!failures.some((f) => f.mode === 'timeout'));
    assert.strictEqual(failures.length, 0);
  }
});

test('a real error is reported with its mode', () => {
  const { failures, section } = ev.buildEventsSection({ raw: raw('', '', 'Access is denied'), runStartMs: T0, runEndMs: END });
  assert.strictEqual(failures[0].mode, 'denied');
  assert.strictEqual(section.mode, 'denied');
});

test('window records the lead', () => {
  const { section } = ev.buildEventsSection({ raw: raw(''), runStartMs: T0, runEndMs: END });
  assert.strictEqual(section.window.leadS, 60);
  assert.strictEqual(section.window.from, new Date(T0 - 60000).toISOString());
});
