'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { vm } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'vm-memory-dominance';

test('an uncapped VM dominates memory: 7.2-7.8 GB of 16 GB with the cap absent', () => {
  const { report, diagnosis: d } = vm.fires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'memory');
  assert.ok(resolves(report, r));
  assert.ok(r.inputs.some((i) => i.signal === 'proc.vm_host_pct_ram' && i.value >= 40));
  assert.strictEqual(r.extra.cap.text, 'cap: absent');
  assert.strictEqual(r.extra.cap.state, 'absent');
  assert.strictEqual(r.disprover.result, 'not-disproved');
  assert.ok(d.suggestedActions.some((a) => a.key === 'vm-memory-cap'));
  assert.ok(d.rollup.some((x) => x.id === ID && x.hangs === 1));
});

test('a configured cap of 6 GB (37.5% of RAM) disproves the rule and cites the cap', () => {
  const r = rule(vm.capped().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.match(r.reason, /6144 MB/);
  assert.strictEqual(r.disprover.result, 'disproved');
  assert.deepStrictEqual(r.disprover.values[0], { capMB: 6144, capPctOfRam: 37.5 });
});

test('no virtualization host group in the process data: not fired, the missing input is named', () => {
  const r = rule(vm.noVm().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.match(r.reason, /missing input: VM host group/);
  assert.strictEqual(r.extra.missingInput, 'virtualization host process group');
});

test('an unknown cap is not assumed absent: fired null with the reason', () => {
  const r = rule(vm.capUnknown().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /cap not known: not collected/);
});

test('no process data at the hang: not evaluated', () => {
  const r = rule(vm.noProcData().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.match(r.reason, /proc\.vm_host_mb/);
});
