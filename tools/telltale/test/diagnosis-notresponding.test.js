'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nr = require('../lib/diagnosis/notresponding');
const S = require('../lib/scope');

const resolverFor = (only) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-nr-'));
  const sc = S.loadScope({ cfg: {}, args: only ? ['x', '--only', only] : ['x'], cwd });
  return S.createResolver(sc.matcher, { open: !only });
};

const HANG = Date.parse('2026-02-01T09:00:40.000Z');

test('suspended store apps never confirm a hang and their names are never recorded', () => {
  const stdout = 'Microsoft.Notes|1\r\nSystemSettings|1\r\n';
  const r = nr.evaluatePoll({ stdout, resolver: resolverFor('postgres'), hangAtMs: HANG, pollAtMs: HANG + 400 });
  assert.strictEqual(r.osConfirmed, false);
  assert.strictEqual(r.osConfirmState, 'denied');
  assert.strictEqual(r.suspendedIgnored, 2);
  const text = JSON.stringify(r);
  assert.ok(!/Notes|SystemSettings/.test(text), text);
  assert.strictEqual(r.osPollAt, new Date(HANG + 400).toISOString());
});

test('without a suspended flag, known background store apps are still dropped', () => {
  const rows = nr.parsePoll('Microsoft.Notes\nSystemSettings\npostgres\n');
  assert.deepStrictEqual(rows.map((x) => [x.name, x.suspended]), [['Microsoft.Notes', true], ['SystemSettings', true], ['postgres', false]]);
});

test('an in-scope foreground process that is not responding confirms, with the poll time and the group name', () => {
  const stdout = 'postgres|0\nSystemSettings|1\nchrome|0\n';
  const r = nr.evaluatePoll({ stdout, resolver: resolverFor('postgres'), hangAtMs: HANG, pollAtMs: HANG + 900 });
  assert.strictEqual(r.osConfirmed, true);
  assert.strictEqual(r.osConfirmState, 'confirmed');
  assert.deepStrictEqual(r.osHungWindows, ['postgres']);
  assert.strictEqual(r.outOfScopeNotResponding, 1, 'an out-of-scope window is counted, never named');
  assert.ok(!JSON.stringify(r).includes('chrome'));
});

test('every in-scope process responding is a denial with the poll time kept', () => {
  const r = nr.evaluatePoll({ stdout: '', resolver: resolverFor('postgres'), hangAtMs: HANG, pollAtMs: HANG + 300 });
  assert.strictEqual(r.osConfirmed, false);
  assert.strictEqual(r.osConfirmState, 'denied');
  assert.ok(r.osPollAt);
});

test('a deferred poll is not back-filled: a poll started more than 2 s after the hang, or before it, is not-evaluated', () => {
  const late = nr.evaluatePoll({ stdout: 'postgres|0\n', resolver: resolverFor('postgres'), hangAtMs: HANG, pollAtMs: HANG + 9000 });
  assert.strictEqual(late.osConfirmed, null);
  assert.strictEqual(late.osConfirmState, 'not-evaluated');
  assert.match(late.osUnavailableReason, /after the hang/);
  assert.ok(!('osHungWindows' in late));
  const early = nr.evaluatePoll({ stdout: 'postgres|0\n', resolver: resolverFor('postgres'), hangAtMs: HANG, hangStartMs: HANG - 1500, pollAtMs: HANG - 20000 });
  assert.strictEqual(early.osConfirmState, 'not-evaluated');
  assert.match(early.osUnavailableReason, /before this hang/);
});

test('open scope names a non-responding foreground process (open scope declares that names appear)', () => {
  const r = nr.evaluatePoll({ stdout: 'chrome|0\nMicrosoft.Notes|1\n', resolver: resolverFor(null), hangAtMs: HANG, pollAtMs: HANG + 100 });
  assert.deepStrictEqual(r.osHungWindows, ['chrome']);
});

test('the poll script asks for windowed processes and their suspended state', () => {
  assert.match(nr.POLL_SCRIPT, /MainWindowHandle/);
  assert.match(nr.POLL_SCRIPT, /Suspended/);
});
