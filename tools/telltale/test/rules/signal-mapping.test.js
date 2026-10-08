'use strict';
// diagnosis-cause-rules 1.1: every signal id a cause rule reads is pinned against what the real collectors store.
// The probe row is built by the collectors' own builder from canned counter text, then read through the signal registry.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const scope = require('../../lib/scope');
const collectors = require('../../lib/collectors');
const { plain } = require('../../lib/sampler/record');
const { parseBundleLines } = require('../../lib/sampler/bundle');
const signals = require('../../lib/diagnosis/signals');
require('../../lib/diagnosis/cause-signals');

const FIX = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'collectors', 'signals-laptop.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const EXTRA = ['\\\\TESTHOST\\Memory\\Modified Page List Bytes=524288000', '\\\\TESTHOST\\process(vmmem)\\Working Set=7864320000', '\\\\TESTHOST\\process(vmmem)\\Private Bytes=7900000000', '\\\\TESTHOST\\process(vmmem)\\instances=1'];
const AT = '2026-10-07T10:00:00.000Z';

function row() {
  const resolver = scope.createResolver(scope.createMatcher([{ name: 'postgres' }]), { open: false });
  const sig = collectors.createSignals({ resolver, logicalCpus: 12, fail: () => {} });
  const lines = [...FIX, ...EXTRA];
  const power = { line: 'Offline', pct: '57', flag: '0', overlay: '961cc777-2547-4f9d-8174-7d86181b8a7a', saver: '0' };
  const fields = sig.build({ lines, power, atIso: AT }).fields;
  const legacy = parseBundleLines(lines).values;
  return plain({ at: AT, ms: 150, usedPct: 72, availMB: 4000, ...legacy, ...fields });
}
const ENV = { logicalCpus: 12, totalMB: 16384 };

test('1.1 each machine-level signal id reads a real collector field (non-null), with the stored unit', () => {
  const r = row();
  const want = {
    'mem.commit_of_limit_pct': 79.3, 'mem.pagefile_pct': 8, 'mem.pages_out_per_s': 0, 'mem.pages_in_per_s': 4513, 'mem.modified_mb': 500,
    'cpu.perf_pct': 148, 'cpu.perf_limit_pct': 85, 'cpu.throttle_flag': 0, 'cpu.dpc_intr_pct': 1.7,
    'gpu.engine_util_pct': 65, 'power.on_ac': 0, 'power.on_battery': 1, 'power.efficiency_mode': 1, 'thermal.cpu_c': 71,
  };
  for (const [name, v] of Object.entries(want)) {
    const got = signals.read(r, name, ENV);
    assert.notStrictEqual(got, null, `${name} is null from the collector row`);
    assert.ok(Math.abs(got - v) < 0.06, `${name}: ${got} vs ${v}`);
    assert.ok(signals.unitOf(name), `${name} has a unit`);
  }
  assert.ok(signals.read(r, 'gpu.vram_used_mb', ENV) === 512);
});

test('1.1 process signals read the in-scope group and the system set, and the VM host group; an out-of-scope name is not addressable', () => {
  const r = row();
  assert.strictEqual(signals.read(r, 'proc.group_mem_mb[postgres]', ENV), 1100);
  assert.strictEqual(signals.read(r, 'proc.group_io_bps[postgres]', ENV), 11000000);
  assert.ok(signals.read(r, 'proc.group_share_pct[postgres]', ENV) > 9 && signals.read(r, 'proc.group_share_pct[postgres]', ENV) < 10);
  assert.strictEqual(signals.read(r, 'proc.vm_host_mb', ENV), 7534);
  assert.ok(Math.abs(signals.read(r, 'proc.vm_host_pct_ram', ENV) - 46) < 0.1);
  assert.strictEqual(signals.read(r, 'proc.group_mem_mb[zzcanary]', ENV), null, 'zzcanary is out of scope: only an anonymous aggregate exists');
  assert.ok(!JSON.stringify(r).includes('zzcanary'));
});

test('1.1 a family reference resolves with no per-run registration, and an unknown family or argument is null', () => {
  assert.strictEqual(signals.has('proc.group_mem_mb[anything]'), true);
  assert.strictEqual(signals.unitOf('proc.group_mem_mb[anything]'), 'MB');
  assert.strictEqual(signals.read(row(), 'proc.no_such_family[x]', ENV), null);
  assert.strictEqual(signals.read(row(), 'proc.group_mem_mb[nothing-here]', ENV), null);
});

test('1.1 absent collector blocks read null, never zero', () => {
  const empty = { at: AT, ms: 150 };
  for (const n of ['mem.pages_out_per_s', 'cpu.perf_pct', 'cpu.throttle_flag', 'cpu.dpc_intr_pct', 'gpu.engine_util_pct', 'power.on_ac', 'power.efficiency_mode', 'thermal.cpu_c', 'proc.vm_host_mb', 'proc.group_mem_mb[x]']) {
    assert.strictEqual(signals.read(empty, n, ENV), null, n);
  }
});
