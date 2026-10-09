'use strict';
// diagnosis-cause-rules 7.1: suggested actions come from a fixed, cheapest-first table.
const test = require('node:test');
const assert = require('node:assert');
const { ACTIONS, BANNED_WORDS, deriveActions, actionKeyOf } = require('../lib/diagnosis/actions');
const { combined, dpc } = require('./rules/_scenarios');

const res = (id, over = {}) => ({ id, class: 'memory', fired: true, confidence: 0.6, disprover: { result: 'not-disproved' }, extra: {}, ...over });
const hang = (ref, ...rules) => ({ ref, rules });

test('three rules fire (VM memory, one process, commit limit): the VM cap comes first, then the application fix, then the capacity comparison', () => {
  const { diagnosis: d } = combined();
  const keys = d.suggestedActions.map((a) => a.key);
  assert.deepStrictEqual(keys, ['vm-memory-cap', 'app-memory', 'memory-capacity']);
  assert.deepStrictEqual(d.suggestedActions.map((a) => a.rank), [2, 5, 7]);
  const vm = d.suggestedActions[0];
  assert.deepStrictEqual(vm.ruleIds, ['vm-memory-dominance']);
  assert.deepStrictEqual({ k: vm.hangs.k, of: vm.hangs.of, label: vm.hangs.label }, { k: 1, of: 1, label: '1/1' });
  assert.ok(vm.confidence > 0);
  assert.deepStrictEqual(d.suggestedActions[1].names, ['vmmem']);
  for (const a of d.suggestedActions) assert.ok(a.text && a.rules.every((r) => r.hangs >= 1 && r.of === 1));
});

test('disproved rules give no action: the interrupt-storm rule is disproved and nothing else fires', () => {
  const { diagnosis: d } = dpc.quiet();
  assert.deepStrictEqual(d.suggestedActions, []);
});

test('a rule that fired but is disproved yields no action, and an unmapped rule yields none', () => {
  const out = deriveActions({ hangs: [hang('spawnProbes[3]', res('commit-limit-pressure', { disprover: { result: 'disproved' } }), res('cpu-saturation'), res('memory-pressure'))] });
  assert.deepStrictEqual(out, []);
});

test('k/M counts the hangs where any supporting rule fired; actions are deduplicated by key', () => {
  const out = deriveActions({ hangs: [
    hang('spawnProbes[3]', res('commit-limit-pressure', { confidence: 0.5 }), res('hard-fault-thrash', { confidence: 0.7 })),
    hang('spawnProbes[9]', res('hard-fault-thrash', { confidence: 0.9 })),
    hang('spawnProbes[12]'),
  ] });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].key, 'memory-capacity');
  assert.deepStrictEqual(out[0].hangs, { k: 2, of: 3, label: '2/3' });
  assert.deepStrictEqual(out[0].rules, [{ id: 'commit-limit-pressure', hangs: 1, of: 3, confidence: 0.5 }, { id: 'hard-fault-thrash', hangs: 2, of: 3, confidence: 0.8 }]);
  assert.strictEqual(out[0].confidence, 0.8);
});

test('variants map by evidence: thermal limit -> driver and firmware, power limit -> power plan, database I/O -> storage health, database memory -> application fix', () => {
  assert.strictEqual(actionKeyOf(res('thermal-power-throttle', { extra: { limitKind: 'thermal' } })), 'driver-firmware');
  assert.strictEqual(actionKeyOf(res('thermal-power-throttle', { extra: { limitKind: 'power' } })), 'power-plan');
  assert.strictEqual(actionKeyOf(res('thermal-power-throttle', { extra: { limitKind: 'unknown' } })), 'power-plan', 'unknown starts with the cheapest');
  assert.strictEqual(actionKeyOf(res('database-memory-io', { class: 'disk', extra: { variant: 'io' } })), 'storage-health');
  assert.strictEqual(actionKeyOf(res('database-memory-io', { class: 'memory', extra: { variant: 'memory' } })), 'app-memory');
  assert.strictEqual(actionKeyOf(res('security-contention', { class: 'security-software' })), 'security-exclusions');
  assert.strictEqual(actionKeyOf(res('disk-stall', { class: 'disk' })), 'storage-health');
});

test('the cost ranks are 1..7, cheapest first, with security-software exclusions first and the capacity comparison last', () => {
  const ranked = Object.entries(ACTIONS).sort((a, b) => a[1].rank - b[1].rank).map(([k]) => k);
  assert.deepStrictEqual(ranked, ['security-exclusions', 'vm-memory-cap', 'power-plan', 'driver-firmware', 'app-memory', 'storage-health', 'memory-capacity']);
});

test('no purchase language: no action template contains buy, upgrade, replace, deserve or insufficient', () => {
  assert.deepStrictEqual([...BANNED_WORDS], ['buy', 'upgrade', 'replace', 'deserve', 'insufficient']);
  for (const [key, a] of Object.entries(ACTIONS)) for (const w of BANNED_WORDS) assert.ok(!new RegExp(`\\b${w}`, 'i').test(a.text), `${key} contains "${w}"`);
});
