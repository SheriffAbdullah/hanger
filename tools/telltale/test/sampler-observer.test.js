'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createObserver } = require('../lib/sampler/observer');
const { createExec } = require('../lib/sampler/exec');
const selfLib = require('../lib/self');
const scopeLib = require('../lib/scope');
const sessionLib = require('../lib/sampler/session');
const { startKeyCapture } = require('../lib/sampler/keycap');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('4.1 observer arithmetic: CPU seconds, percent of one logical CPU, peak private, I/O, launches per minute by tier', () => {
  const obs = createObserver({ readSources: () => [
    { pid: 1, role: 'main', cpuS: 10, privateMB: 60 },
    { pid: 2, role: 'session', cpuS: 14, privateMB: 40 },
  ] });
  for (let i = 0; i < 30; i++) obs.launch('hangProbe');
  obs.launch('onTrigger'); obs.launch('onTrigger'); obs.launch('once');
  obs.setIo({ readMB: 3, writeMB: 1 });
  const rep = obs.report({ windowS: 600 });
  assert.strictEqual(rep.cpuS.v, 24);
  assert.strictEqual(rep.cpuPctOneLogical.v, 4);
  assert.strictEqual(rep.peakPrivateMB.v, 100);
  assert.strictEqual(rep.ioReadMB.v, 3);
  assert.strictEqual(rep.ioWriteMB.v, 1);
  assert.strictEqual(rep.launchesPerMin.continuous, 0);
  assert.strictEqual(rep.launchesPerMin.hangProbe, 3);
  assert.strictEqual(rep.launchesPerMin.onTrigger, 0.2);
  for (const k of ['cpuS', 'cpuPctOneLogical', 'peakPrivateMB', 'ioReadMB', 'ioWriteMB']) { assert.ok(rep[k].unit, k); assert.ok('n' in rep[k], k); }
});

test('4.1 the single spawn wrapper counts launches by tier and registers child PIDs for self-exclusion', async () => {
  const launches = [];
  const registered = [];
  const obs = { launch: (t) => launches.push(t) };
  const fakeSpawn = () => {
    const c = new EventEmitter(); c.pid = 4242; c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
    setTimeout(() => { c.stdout.emit('data', 'ok'); c.emit('close', 0); }, 5);
    return c;
  };
  const { execA } = createExec({ observer: obs, registerPid: (p) => registered.push(p), spawnFn: fakeSpawn, failAll: false });
  const r = await execA('x', [], { tier: 'hangProbe', timeoutMs: 1000 });
  await execA('x', [], { tier: 'onTrigger', timeoutMs: 1000 });
  assert.strictEqual(r.stdout, 'ok');
  assert.deepStrictEqual(launches, ['hangProbe', 'onTrigger']);
  assert.deepStrictEqual(registered, [4242, 4242]);
});

test('4.1 the wrapper kills a child at its timeout and returns its partial output', async () => {
  let killed = false;
  const fakeSpawn = () => {
    const c = new EventEmitter(); c.pid = 9; c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.kill = () => { killed = true; setTimeout(() => c.emit('close', null), 5); };
    setTimeout(() => c.stdout.emit('data', 'part'), 5);
    return c;
  };
  const { execA } = createExec({ spawnFn: fakeSpawn, failAll: false });
  const r = await execA('x', [], { timeoutMs: 60 });
  assert.strictEqual(killed, true);
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(r.stdout, 'part');
});

test('4.2 budget exceedance is recorded with value, limit, unit and window, and prints exactly one line', () => {
  const lines = [];
  const obs = createObserver({ print: (l) => lines.push(l), readSources: () => [{ pid: 1, role: 'main', cpuS: 24, privateMB: 90 }] });
  const rep = obs.report({ windowS: 600 });
  assert.strictEqual(rep.budget.exceeded, true);
  assert.deepStrictEqual(rep.budget.items, [{ budget: 'cpu', value: 4, limit: 2, unit: '% of one logical CPU', windowS: 600 }]);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /cpu/);
});

test('4.2 within budget: 1.2% CPU and 90 MB is not an exceedance', () => {
  const lines = [];
  const obs = createObserver({ print: (l) => lines.push(l), readSources: () => [{ pid: 1, role: 'main', cpuS: 7.2, privateMB: 90 }] });
  const rep = obs.report({ windowS: 600 });
  assert.strictEqual(rep.cpuPctOneLogical.v, 1.2);
  assert.strictEqual(rep.budget.exceeded, false);
  assert.strictEqual(lines.length, 0);
});

test('4.2 the observer baseline excludes the tool start-up from the run cost', () => {
  let cpu = 5;
  const obs = createObserver({ readSources: () => [{ pid: 1, role: 'main', cpuS: cpu, privateMB: 10 }] });
  obs.markStart();
  cpu = 6.2;
  assert.strictEqual(obs.report({ windowS: 100 }).cpuS.v, 1.2);
});

test('4.3 observer PIDs never appear in workload rollups or out-of-scope aggregates', () => {
  selfLib.registerPid(31001); selfLib.registerPid(31002);
  const obs = createObserver({ pidSource: () => selfLib.listSelfPids() });
  const rows = [
    { name: 'powershell.exe', pid: 31001, memMB: 900 }, { name: 'node.exe', pid: 31002, memMB: 800 },
    { name: 'postgres.exe', pid: 500, memMB: 300 }, { name: 'zzother.exe', pid: 501, memMB: 200 },
  ];
  const kept = obs.excludeFrom(rows);
  assert.deepStrictEqual(kept.map((r) => r.pid), [500, 501]);
  const scope = scopeLib.loadScope({ cfg: {}, args: ['trace', '--only', 'postgres.exe'], cwd: process.cwd() });
  const res = scopeLib.createResolver(scope.matcher, { open: false }).resolve(kept, {});
  const agg = scopeLib.runAggregate(res);
  assert.strictEqual(agg.memMB, 200, 'only the real out-of-scope process is aggregated; the tool is not counted as workload');
});

test('session: protocol blocks are split, power and observer lines are kept apart from counters', () => {
  const blocks = [];
  const p = sessionLib.createBlockParser((b) => blocks.push(b));
  p.push('BEGIN|2026-10-07T10:00:00.000Z\n\\\\h\\memory\\pages/sec=1.5\nPOWER|Online|100\nOBS|0.5|1048576|2097152\nEND\nBEGIN|2026-10-07T10:00:02.000Z\n\\\\h\\mem');
  p.push('ory\\pages/sec=2.5\r\nEND\r\n');
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].lines.length, 1);
  assert.deepStrictEqual(blocks[0].power, { line: 'Online', pct: '100' });
  assert.deepStrictEqual(blocks[0].obs, { cpuS: '0.5', privateB: '1048576', nodePrivateB: '2097152' });
  assert.strictEqual(blocks[1].atMs - blocks[0].atMs, 2000);
});

test('session: counter paths are validated against what answered, wildcards included', () => {
  const v = sessionLib.validatePaths(['\\Memory\\Pages/sec', '\\Process(MsMpEng*)\\% Processor Time', '\\GPU Engine(*_Total)\\Utilization Percentage'],
    ['\\\\host\\memory\\pages/sec', '\\\\host\\process(msmpeng)\\% processor time']);
  assert.strictEqual(v.ok.length, 2);
  assert.deepStrictEqual(v.missing, ['\\GPU Engine(*_Total)\\Utilization Percentage']);
});

test('session: the manager restarts a dying session at most 3 times, then gives up and says why', async () => {
  const spawns = []; const restarts = []; let gaveUp = null;
  const fakeSpawn = () => {
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stdout.setEncoding = () => {}; c.kill = () => {}; c.pid = 100 + spawns.length;
    spawns.push(c);
    setTimeout(() => c.emit('exit', 1, null), 5);
    return c;
  };
  const mgr = sessionLib.createSessionManager({ spawnFn: fakeSpawn, buildArgs: () => [], onBlock: () => {}, onRestart: (r) => restarts.push(r.n), onGiveUp: (reason, n) => { gaveUp = { reason, n }; }, restartDelayMs: 5 });
  mgr.start();
  await sleep(200);
  assert.strictEqual(spawns.length, 4, '1 start + 3 restarts');
  assert.deepStrictEqual(restarts, [1, 2, 3]);
  assert.ok(gaveUp && gaveUp.n === 3 && /exited/.test(gaveUp.reason));
});

test('5.3 a key press during a blocked main loop is stamped within 250 ms of the press', async () => {
  const marks = [];
  const kc = startKeyCapture({ onMark: (atMs) => marks.push(atMs), stdin: 'pipe' });
  await sleep(700); // child start-up
  const pressMs = Date.now();
  kc.child.stdin.write('x');
  // the parent now blocks for 1.5 s (a stand-in for the 10 s collector); the child stamps the press regardless
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  await sleep(300);
  kc.stop();
  assert.strictEqual(marks.length, 1);
  const delta = marks[0] - pressMs;
  assert.ok(delta >= 0 && delta <= 250, `stamp delta ${delta} ms`);
});

// ---- input helper cost (input-response stall detector, task 9.1) ----
test('9.1 helper: 0.9% average CPU over 600 s is exceeded (value 0.9, limit 0.5, window 600) and prints one line', () => {
  const lines = [];
  const o = createObserver({ readSources: () => [{ pid: 1, role: 'main', cpuS: 1, privateMB: 60 }, { pid: 2, role: 'input-helper', cpuS: 5.4, privateMB: 12 }], logicalCpus: 12, print: (l) => lines.push(l) });
  const r = o.report({ windowS: 600 });
  assert.strictEqual(r.helper.exceeded, true);
  assert.deepStrictEqual(r.helper.items.map((i) => [i.budget, i.value, i.limit, i.windowS]), [['cpu', 0.9, 0.5, 600]]);
  assert.strictEqual(r.helper.cpuPct.v, 0.9);
  assert.strictEqual(r.helper.limits.cpuPct, 0.5);
  assert.strictEqual(lines.filter((l) => /input helper budget exceeded/.test(l)).length, 1);
  assert.strictEqual(r.budget.exceeded, false, 'the tool total is still within its own budget');
});

test('9.1 helper: 0.2% CPU is within; private memory has a 40 MB limit (100 MB for the PowerShell fallback)', () => {
  const mk = (priv, limits) => createObserver({ readSources: () => [{ pid: 1, role: 'main', cpuS: 1, privateMB: 60 }, { pid: 2, role: 'input-helper', cpuS: 1.2, privateMB: priv, ...(limits ? { limits } : {}) }], logicalCpus: 12, print: () => {} }).report({ windowS: 600 });
  assert.strictEqual(mk(30).helper.exceeded, false);
  assert.strictEqual(mk(30).helper.cpuPct.v, 0.2);
  assert.strictEqual(mk(60).helper.exceeded, true);
  assert.strictEqual(mk(60, { privateMB: 100 }).helper.exceeded, false);
  assert.strictEqual(mk(60, { privateMB: 100 }).helper.limits.privateMB, 100);
});

test('9.1 helper: its cost is inside the total observer cost and absent when there is no helper', () => {
  const withH = createObserver({ readSources: () => [{ pid: 1, role: 'main', cpuS: 1, privateMB: 60 }, { pid: 2, role: 'input-helper', cpuS: 2, privateMB: 12 }], print: () => {} }).report({ windowS: 100 });
  assert.strictEqual(withH.cpuS.v, 3);
  assert.strictEqual(withH.cpuSBySource['input-helper'], 2);
  assert.strictEqual(withH.peakPrivateMB.v, 72);
  const without = createObserver({ readSources: () => [{ pid: 1, role: 'main', cpuS: 1, privateMB: 60 }], print: () => {} }).report({ windowS: 100 });
  assert.strictEqual('helper' in without, false);
});

test('9.1 helper: the helper pid is excluded from workload rollups (culprit lists) through the self pid set', () => {
  const o = createObserver({ pidSource: () => [100, 4242], print: () => {} });
  const rows = [{ pid: '100', name: 'node' }, { pid: '4242', name: 'telltale-input-abc' }, { pid: '7', name: 'postgres' }];
  assert.deepStrictEqual(o.excludeFrom(rows).map((r) => r.name), ['postgres']);
  const parsed = sessionLib.createBlockParser(() => {});
  assert.ok(parsed);
});

test('9.1 helper: the session OBS line carries the helper cpu and private bytes when a helper pid was given', () => {
  const blocks = [];
  const p = sessionLib.createBlockParser((b) => blocks.push(b));
  p.push('BEGIN|2026-10-07T10:00:00.000Z\nOBS|0.5|1048576|2097152|0.25|3145728\nEND\nBEGIN|2026-10-07T10:00:02.000Z\nOBS|0.6|1048576|2097152||\nEND\n');
  assert.deepStrictEqual([blocks[0].obs.helperCpuS, blocks[0].obs.helperPrivateB], ['0.25', '3145728']);
  assert.strictEqual(blocks[1].obs.helperCpuS, undefined);
});
