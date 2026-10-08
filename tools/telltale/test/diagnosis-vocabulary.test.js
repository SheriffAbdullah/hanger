'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vocab = require('../lib/diagnosis/vocabulary');

test('the vocabulary is exactly the ten classes and every rule id maps into it', () => {
  assert.deepStrictEqual([...vocab.CLASSES], ['memory', 'cpu', 'disk', 'thermal-power', 'gpu', 'security-software', 'outside-scope', 'undetermined', 'no-freeze-observed', 'insufficient-evidence']);
  assert.deepStrictEqual(vocab.RULE_CLASS, { 'memory-pressure': 'memory', 'cpu-saturation': 'cpu', 'disk-stall': 'disk', 'security-contention': 'security-software', 'outside-scope': 'outside-scope', 'commit-limit-pressure': 'memory', 'hard-fault-thrash': 'memory', 'vm-memory-dominance': 'memory', 'database-memory-io': 'memory', 'single-process-dominance': 'memory', 'thermal-power-throttle': 'thermal-power', 'battery-power-plan': 'thermal-power', 'driver-interrupt-storm': 'cpu', 'gpu-contention': 'gpu' });
  for (const c of Object.values(vocab.RULE_CLASS)) assert.ok(vocab.isClass(c));
  assert.ok(!vocab.isClass('RAM-BOUND') && !vocab.isClass('PRESSURED') && !vocab.isClass('STALL-OBSERVED') && !vocab.isClass('SUSTAINED-PRESSURE'));
  for (const c of vocab.CLASSES) assert.ok(vocab.CLASS_LABEL[c], `label for ${c}`);
});

test('requiring the diagnosis modules performs no I/O (loading rules happens when diagnose() runs)', () => {
  const dir = path.join(__dirname, '..', 'lib', 'diagnosis');
  for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
  const calls = [];
  const orig = {};
  for (const fn of ['readdirSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'existsSync', 'statSync']) {
    orig[fn] = fs[fn];
    fs[fn] = function patched(...a) { calls.push(`${fn}(${String(a[0]).slice(-40)})`); return orig[fn].apply(this, a); };
  }
  const origRead = fs.readFileSync;
  fs.readFileSync = function patched(p, ...a) { if (!/\.(js|json)$/.test(String(p))) calls.push(`readFileSync(${String(p).slice(-40)})`); return origRead.call(this, p, ...a); };
  try {
    require('../lib/diagnosis/vocabulary'); require('../lib/diagnosis/confidence'); require('../lib/diagnosis/signals'); require('../lib/diagnosis/context');
    require('../lib/diagnosis/refs'); require('../lib/diagnosis/notresponding'); require('../lib/diagnosis/engine');
  } finally {
    for (const [fn, f] of Object.entries(orig)) fs[fn] = f;
    fs.readFileSync = origRead;
  }
  assert.deepStrictEqual(calls, [], `I/O at require time: ${calls.join(', ')}`);
});
