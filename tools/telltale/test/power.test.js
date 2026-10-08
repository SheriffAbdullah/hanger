'use strict';
// data-signals-completeness 1.x: power truth. Canned outputs only; live checks are in tasks.md.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/collectors/power');
const { createSignals } = require('../lib/collectors');

test('1.1 single-line power status line=Online;pct=99 yields AC true and battery 99', () => {
  const p = P.parsePowerStatusText('line=Online;pct=99');
  assert.strictEqual(p.plugged, true);
  assert.strictEqual(p.batteryPct, 99);
  assert.strictEqual(p.hasBattery, true);
});

test('1.1 the same keys on separate lines (the old shape) still parse', () => {
  const p = P.parsePowerStatusText('line=Offline\r\npct=41\r\nstatus=Low');
  assert.strictEqual(p.plugged, false);
  assert.strictEqual(p.batteryPct, 41);
});

test('1.1 a platform that reports no battery is the only case with no battery', () => {
  const a = P.parsePowerStatusText('line=Online;pct=255');
  assert.strictEqual(a.hasBattery, false);
  assert.strictEqual(a.batteryPct, null);
  const b = P.parsePowerStatusText('line=Online;pct=100;status=NoSystemBattery');
  assert.strictEqual(b.hasBattery, false);
  assert.strictEqual(b.batteryPct, null);
  // a laptop that reports a charging status keeps its percentage even at 100
  const c = P.parsePowerStatusText('line=Online;pct=100;status=High, Charging');
  assert.strictEqual(c.hasBattery, true);
  assert.strictEqual(c.batteryPct, 100);
});

test('1.1 the session power block: Win32 flag 128 means no system battery, 255 percent means unknown', () => {
  const none = P.parsePowerBlock({ line: 'Online', pct: '255', flag: '128', overlay: '', saver: '0' });
  assert.strictEqual(none.hasBattery, false);
  assert.strictEqual(none.batteryPct, null);
  assert.strictEqual(none.reasons.batteryPct, 'no-battery');
  const lap = P.parsePowerBlock({ line: 'Online', pct: '99', flag: '9', overlay: 'ded574b5-45a0-4f42-8737-46345c09c238', saver: '0' });
  assert.strictEqual(lap.ac, true);
  assert.strictEqual(lap.batteryPct, 99);
  assert.strictEqual(lap.hasBattery, true);
  const unk = P.parsePowerBlock({ line: 'Online', pct: '255', flag: '1', overlay: '', saver: '' });
  assert.strictEqual(unk.hasBattery, true);
  assert.strictEqual(unk.batteryPct, null);
  assert.strictEqual(unk.reasons.batteryPct, 'unknown');
});

test('1.2 AC to battery yields exactly one transition stamped with the second sample time', () => {
  const t = P.createPowerTracker();
  assert.strictEqual(t.observe('2026-10-07T10:00:00.000Z', true), null);
  assert.strictEqual(t.observe('2026-10-07T10:00:02.000Z', true), null);
  const tr = t.observe('2026-10-07T10:00:04.000Z', false);
  assert.deepStrictEqual(tr, { at: '2026-10-07T10:00:04.000Z', from: 'ac', to: 'battery' });
  assert.strictEqual(t.observe('2026-10-07T10:00:06.000Z', false), null);
  assert.strictEqual(t.observe('2026-10-07T10:00:08.000Z', null), null); // unknown never flips
  assert.strictEqual(t.transitions().length, 1);
});

test('1.2 every power value carries its as-of time and a null carries a reason, never 0', () => {
  const sig = createSignals({ resolver: { classifyName: () => 'in', noteOutName() {} }, logicalCpus: 12, fail: () => {} });
  const at = '2026-10-07T10:00:00.000Z';
  const ok = sig.build({ lines: [], power: { line: 'Online', pct: '99', flag: '9', overlay: 'ded574b5-45a0-4f42-8737-46345c09c238', saver: '0' }, atIso: at }).fields.power;
  assert.strictEqual(ok.ac, true); assert.strictEqual(ok.acAsOf, at);
  assert.strictEqual(ok.batteryPct.v, 99); assert.strictEqual(ok.batteryAsOf, at);
  const none = sig.build({ lines: [], power: { line: 'Online', pct: '255', flag: '128', overlay: '', saver: '' }, atIso: at }).fields.power;
  assert.strictEqual(none.batteryPct.v, null);
  assert.strictEqual(none.batteryAsOf, null);
  assert.strictEqual(none.batteryPctReason, 'no-battery');
  assert.strictEqual(none.powerMode, null);
  assert.strictEqual(none.powerModeReason, 'not-exposed');
});

test('1.2 the active scheme is stored as {name, guid}', () => {
  assert.deepStrictEqual(P.parseActiveScheme('Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)'), { name: 'Balanced', guid: '381b4222-f694-41f0-9685-ff5bb260df2e' });
  assert.deepStrictEqual(P.parseActiveScheme('garbage'), { name: null, guid: null });
});

test('1.3 the three overlay GUIDs map to best-power-efficiency, balanced and best-performance; energy saver is a flag', () => {
  assert.strictEqual(P.overlayName('961cc777-2547-4f9d-8174-7d86181b8a7a'), 'best-power-efficiency');
  assert.strictEqual(P.overlayName('00000000-0000-0000-0000-000000000000'), 'balanced');
  assert.strictEqual(P.overlayName('DED574B5-45A0-4F42-8737-46345C09C238'), 'best-performance');
  assert.strictEqual(P.overlayName(''), null);
  assert.match(P.overlayName('11111111-2222-3333-4444-555555555555'), /^other:/);
  assert.strictEqual(P.parsePowerBlock({ line: 'Offline', pct: '50', flag: '2', overlay: '', saver: '1' }).energySaver, true);
  assert.strictEqual(P.parsePowerBlock({ line: 'Offline', pct: '50', flag: '2', overlay: '', saver: '0' }).energySaver, false);
});

test('1.3 a power-mode switch between two samples changes the stored value while the plan stays', () => {
  const sig = createSignals({ resolver: { classifyName: () => 'in', noteOutName() {} }, logicalCpus: 12, fail: () => {} });
  const blk = (overlay, at) => sig.build({ lines: [], power: { line: 'Online', pct: '80', flag: '1', overlay, saver: '0' }, atIso: at }).fields.power;
  assert.strictEqual(blk('00000000-0000-0000-0000-000000000000', '2026-10-07T10:00:00.000Z').powerMode, 'balanced');
  assert.strictEqual(blk('961cc777-2547-4f9d-8174-7d86181b8a7a', '2026-10-07T10:00:02.000Z').powerMode, 'best-power-efficiency');
});
