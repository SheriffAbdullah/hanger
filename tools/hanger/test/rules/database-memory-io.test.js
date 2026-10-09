'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { db } = require('./_scenarios');
const { rule, resolves } = require('./_fx');
const ID = 'database-memory-io';

test('the I/O variant fires with class disk: latency 31-48 ms, queue 2-3, the in-scope database group doing I/O', () => {
  const { report, diagnosis: d } = db.ioFires();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'disk');
  assert.strictEqual(r.extra.group, 'postgres');
  assert.strictEqual(r.extra.variant, 'io');
  assert.ok(resolves(report, r));
  assert.ok(r.inputs.some((i) => i.signal === 'proc.group_io_bps[postgres]'));
  assert.ok(d.suggestedActions.some((a) => a.key === 'storage-health'));
  assert.strictEqual(d.rollup.find((x) => x.id === ID).class, 'disk');
});

test('configuration unavailable: the memory variant uses group memory alone (4.5 GB of 16 GB) and names the configuration as missing', () => {
  const r = rule(db.memoryNoConfig().diagnosis, ID);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.class, 'memory');
  assert.strictEqual(r.extra.variant, 'memory');
  assert.strictEqual(r.extra.config, null);
  assert.ok(r.extra.missingInputs.some((m) => /configuration/.test(m)));
  assert.ok(r.confounds.some((c) => c.id === 'config-unavailable'));
});

test('configured buffers count: 1.5 GB resident + 4 GB shared_buffers + work_mem x connections fires; the same resident memory alone does not', () => {
  const withCfg = rule(db.memoryWithConfig().diagnosis, ID);
  assert.strictEqual(withCfg.fired, true);
  assert.strictEqual(withCfg.extra.config.sharedBuffersMB, 4096);
  assert.strictEqual(withCfg.extra.config.configuredMB, 4096 + 400);
  assert.ok(withCfg.confounds.some((c) => c.id === 'config-overlaps-resident' && c.active));
  const alone = rule(db.memoryWithConfigButSmall().diagnosis, ID);
  assert.strictEqual(alone.fired, false);
});

test('no database group in scope: not fired with the stated reason, and an out-of-scope database is never named', () => {
  const { diagnosis: d } = db.noDatabase();
  const r = rule(d, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reason, 'no in-scope database group');
  assert.ok(!/postgres/i.test(JSON.stringify(r)));
});

test('disproved: latency 5 ms and a 300 MB group (1.8% of RAM) at every hang', () => {
  const r = rule(db.quiet().diagnosis, ID);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.disprover.result, 'disproved');
});

test('no process data: not evaluated', () => {
  const r = rule(db.noProcData().diagnosis, ID);
  assert.strictEqual(r.fired, null);
  assert.strictEqual(r.disprover.result, 'not-evaluable');
});
