'use strict';
// workload-session-and-containers 4.x (containers, VM), 5.x (probes), 6.x (config): canned outputs, no live Docker
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createExec } = require('../lib/sampler/exec');
const { createResolver, createMatcher } = require('../lib/scope');
const containers = require('../lib/workload/containers');
const vm = require('../lib/workload/vm');
const probes = require('../lib/workload/probes');
const config = require('../lib/workload/config');
const { reasonFromExec, R } = require('../lib/workload/reasons');
const { createWorkload } = require('../lib/workload');
const { createHeavyRunner } = require('../lib/sampler/scheduler');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'workload', n), 'utf8');
const resolverFor = (names) => createResolver(createMatcher(names.map((name) => ({ name, includeDescendants: false }))), {});
const ok = (stdout) => ({ stdout, stderr: '', code: 0, timedOut: false, enoent: false });
const T0 = Date.parse('2026-10-07T10:00:00.000Z');

// ---------- 4.1 container parsers ----------
test('parsePs and parseStats read the runtime JSON lines, units MiB/GiB/kB/B included', () => {
  const ps = containers.parsePs(fx('docker-ps.jsonl'));
  assert.deepStrictEqual(ps.map((p) => p.name), ['pg-db', 'zzcanary-web', 'zzcanary-cache']);
  const st = containers.parseStats(fx('docker-stats.jsonl'));
  assert.strictEqual(st[0].cpuPct, 2.5);
  assert.ok(Math.abs(st[0].memUsedMB - 118.4) < 0.01);
  assert.ok(Math.abs(st[0].memLimitMB - 7.62 * 1024) < 0.01);
  assert.ok(Math.abs(st[2].memUsedMB - 1536) < 0.01);
  assert.strictEqual(containers.parseSizeMB('512kB'), 0.5);
  assert.strictEqual(containers.parseSizeMB('1048576B'), 1);
  assert.strictEqual(containers.parseSizeMB('garbage'), null);
  assert.deepStrictEqual(containers.parseStats(''), []);
  assert.deepStrictEqual(containers.parsePs('not json\n{broken'), []);
});

test('in-scope series by container name or image base name; everything else is an anonymous aggregate', () => {
  const resolver = resolverFor(['postgres']); // matches the image "postgres:16", not the name "pg-db"
  const ps = containers.parsePs(fx('docker-ps.jsonl'));
  const st = containers.parseStats(fx('docker-stats.jsonl'));
  const s = containers.buildSample({ ps, stats: st, resolver, atIso: '2026-10-07T10:00:10.000Z' });
  assert.strictEqual(s.series.length, 1);
  assert.deepStrictEqual(Object.keys(s.series[0]).sort(), ['at', 'cpuPct', 'memLimitMB', 'memUsedMB', 'name']);
  assert.strictEqual(s.series[0].name, 'pg-db');
  assert.strictEqual(s.series[0].cpuPct, 2.5);
  assert.deepStrictEqual(s.outOfScope, { at: '2026-10-07T10:00:10.000Z', count: 2, cpuPct: 10.5, memUsedMB: 2048, memLimitMB: 15606 });
  assert.ok(!/zzcanary/.test(JSON.stringify([s.series, s.outOfScope])), 'no out-of-scope name or id in what is stored');
  assert.strictEqual(containers.imageBase('registry.local:5000/team/zzcanary-img:latest'), 'zzcanary-img');
});

test('empty list: ok with no series', async () => {
  const exec = async (_f, argv) => ok(argv[0] === 'ps' ? '' : '');
  const r = await containers.pollContainers({ exec, resolver: resolverFor(['postgres']) });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.sample.series, []);
});

test('a stats failure with a working ps keeps the series with null values and a reason', async () => {
  const exec = async (_f, argv) => (argv[0] === 'ps' ? ok(fx('docker-ps.jsonl')) : { stdout: '', stderr: 'boom', code: 1, timedOut: false, enoent: false });
  const r = await containers.pollContainers({ exec, resolver: resolverFor(['postgres']) });
  assert.ok(r.ok);
  assert.strictEqual(r.sample.series[0].cpuPct, null);
  assert.ok(r.statsReason);
});

test('back-off doubles after a timeout up to 60 s and resets after a success', () => {
  let i = 10;
  const seq = [];
  for (let k = 0; k < 5; k++) { i = containers.nextInterval({ baseS: 10, currentS: i, outcome: 'timeout' }); seq.push(i); }
  assert.deepStrictEqual(seq, [20, 40, 60, 60, 60]);
  assert.strictEqual(containers.nextInterval({ baseS: 10, currentS: 60, outcome: 'ok' }), 10);
});

// ---------- 4.2 platform state reasons ----------
test('platform states map to fixed reasons and never carry raw text', async () => {
  const notInstalled = { stdout: '', stderr: "'docker' is not recognized as an internal or external command", code: 1, timedOut: false, enoent: false };
  const notRunning = { stdout: '', stderr: 'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.46/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.', code: 1, timedOut: false, enoent: false };
  const enoent = { stdout: '', stderr: 'spawn docker ENOENT', code: 1, timedOut: false, enoent: true };
  assert.strictEqual(reasonFromExec(notInstalled), 'not installed');
  assert.strictEqual(reasonFromExec(notRunning), 'not running');
  assert.strictEqual(reasonFromExec(enoent), 'not installed');
  assert.strictEqual(reasonFromExec({ timedOut: true }, { timeoutMs: 3000 }), 'unresponsive (timed out after 3 s)');
  for (const r of [notInstalled, notRunning, enoent]) {
    const out = await containers.pollContainers({ exec: async () => r, resolver: resolverFor(['postgres']) });
    assert.strictEqual(out.ok, false);
    assert.ok(!/recogni|pipe|ENOENT|error during/i.test(JSON.stringify(out)), 'no raw text');
  }
});

test('a hanging command is killed at its time bound and reported as unresponsive', async () => {
  const exec = createExec({ failAll: false }).execA;
  const t0 = Date.now();
  const r = await exec(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 400, tier: 'onTrigger', opts: { stdio: 'ignore' } });
  assert.ok(r.timedOut);
  assert.ok(Date.now() - t0 < 4000);
  assert.strictEqual(reasonFromExec(r, { timeoutMs: 400 }), 'unresponsive (timed out after 1 s)');
});

// ---------- 4.3 VM ----------
test('configured cap: 8 GB, no cap, absent file, malformed file', () => {
  const read = (name) => () => fx(name);
  assert.deepStrictEqual(vm.readConfiguredCap({ readFile: read('wslconfig-8gb.ini') }), { value: 8192, unit: 'MB', source: 'user VM config' });
  assert.strictEqual(vm.readConfiguredCap({ readFile: read('wslconfig-nocap.ini') }).unavailableReason, 'no cap configured (default applies)');
  assert.strictEqual(vm.readConfiguredCap({ readFile: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } }).unavailableReason, 'no cap configured (default applies)');
  assert.match(vm.readConfiguredCap({ readFile: read('wslconfig-malformed.ini') }).unavailableReason, /unreadable/);
  assert.strictEqual(vm.parseMemoryValue('4096MB'), 4096);
  assert.strictEqual(vm.parseMemoryValue('1TB'), 1048576);
});

test('host VM memory from the process rows: value, hidden at user tier, or not running', () => {
  assert.deepStrictEqual(vm.hostMemFromRows(vm.parseVmHostRows(fx('tasklist-vmmem.csv'))), { value: 2560 });
  assert.strictEqual(vm.hostMemFromRows([{ name: 'vmmem', memMB: 0 }]).unavailableReason, 'not visible at user tier');
  assert.strictEqual(vm.hostMemFromRows([]).unavailableReason, 'VM not running');
});

test('a stopped VM yields guest memory null "VM not running" and no start command is issued', async () => {
  const calls = [];
  const exec = async (f, argv) => { calls.push([f, ...argv].join(' ')); return ok(fx('wsl-list-stopped.txt')); };
  const r = await vm.pollVm({ exec, resolver: resolverFor(['Ubuntu']) });
  assert.strictEqual(r.guestMem.unavailableReason, 'VM not running');
  assert.deepStrictEqual(calls, ['wsl.exe -l -v'], 'only the listing ran');
});

test('guest memory is read only from an in-scope RUNNING distro; out-of-scope distros are never named', async () => {
  const calls = [];
  const exec = async (f, argv) => { calls.push([f, ...argv].join(' ')); return argv[0] === '-l' ? ok(fx('wsl-list-running.txt')) : ok(fx('meminfo.txt')); };
  const inScope = await vm.pollVm({ exec, resolver: resolverFor(['Ubuntu']) });
  assert.deepStrictEqual(inScope.guestMem, { value: 5859, totalMB: 7813, unit: 'MB', source: 'guest /proc/meminfo' });
  assert.ok(calls.some((c) => c === 'wsl.exe -d Ubuntu -e cat /proc/meminfo'));
  assert.ok(!calls.some((c) => /zzcanary|docker-desktop/.test(c)));
  const none = await vm.pollVm({ exec: async () => ok(fx('wsl-list-running.txt')), resolver: resolverFor(['postgres']) });
  assert.strictEqual(none.guestMem.unavailableReason, 'not declared in scope');
  assert.deepStrictEqual(vm.parseWslList(fx('wsl-list-running.txt')).map((d) => d.state), ['running', 'running', 'stopped']);
});

// ---------- 5.1 probes ----------
const realExec = () => createExec({ failAll: false }).execA;
const NODE = process.execPath;

test('probe: ok status, timing recorded, canary output and canary argument never appear', async () => {
  const probe = { name: 'p', command: [NODE, '-e', 'console.log("zzcanaryout"); process.exit(0)', 'zzcanaryarg'], timeoutMs: 5000, everySec: 5 };
  const r = await probes.runProbeOnce({ probe, exec: realExec() });
  assert.strictEqual(r.status, 'ok');
  assert.ok(r.ms >= 0 && r.at);
  assert.ok(!/zzcanary/.test(JSON.stringify(r)));
});

test('probe: blocked command -> status timeout, duration equals the timeout, process terminated', async () => {
  const probe = { name: 'p', command: [NODE, '-e', 'setTimeout(()=>{},60000)'], timeoutMs: 500, everySec: 5 };
  const t0 = Date.now();
  const r = await probes.runProbeOnce({ probe, exec: realExec() });
  assert.strictEqual(r.status, 'timeout');
  assert.strictEqual(r.ms, 500);
  assert.ok(Date.now() - t0 < 5000, 'returned promptly after the kill');
});

test('probe: nonzero exit and missing executable', async () => {
  const exec = realExec();
  assert.strictEqual((await probes.runProbeOnce({ probe: { command: [NODE, '-e', 'process.exit(3)'], timeoutMs: 5000 }, exec })).status, 'nonzero');
  assert.strictEqual((await probes.runProbeOnce({ probe: { command: ['zz-no-such-binary-xyz'], timeoutMs: 5000 }, exec })).status, 'not-found');
});

test('probe loop: stops after 3 consecutive not-found, records the reason, and refuses when elevated', async () => {
  const stream = [];
  const sink = { append: (t, r) => stream.push({ type: t, ...r }) };
  const timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const exec = async () => ({ stdout: '', stderr: '', code: 1, timedOut: false, enoent: true });
  const run = probes.startProbes({ probes: [{ name: 'gone', command: ['nope'], timeoutMs: 1000, everySec: 5 }], exec, sink, setTimer, clearTimer: () => {} });
  for (let i = 0; i < 6 && timers.length; i++) await timers.shift()();
  assert.strictEqual(stream.filter((r) => r.type === 'wl-probe').length, 3);
  const stop = stream.find((r) => r.type === 'wl-probe-stop');
  assert.ok(stop && /not found 3 times/.test(stop.reason));
  assert.strictEqual(run.state.gone.running, false);
  const ev = [];
  const elevated = probes.startProbes({ probes: [{ name: 'x', command: ['nope'], timeoutMs: 1000, everySec: 5 }], exec, sink, elevated: true, onEvent: (e) => ev.push(e) });
  assert.strictEqual(elevated.state.x.reason, R.ELEVATED_NO_PROBE);
  assert.strictEqual(ev[0].kind, 'refused');
});

test('no probe declared: nothing is executed', () => {
  let ran = 0;
  const run = probes.startProbes({ probes: [], exec: async () => { ran++; return ok(''); }, sink: { append() {} } });
  assert.strictEqual(ran, 0);
  assert.deepStrictEqual(run.declared, []);
});

// ---------- 6.1 config facts ----------
test('postgres settings parse from canned psql output; the command never prompts and uses a connect timeout', async () => {
  const seen = [];
  const exec = async (f, argv, o) => { seen.push({ f, argv, env: o.opts && o.opts.env }); return ok(fx('psql-settings.txt')); };
  const facts = await config.collectConfigFacts({ entries: [{ kind: 'postgres', connection: 'host=localhost port=5432' }], exec, resolver: resolverFor(['postgres']) });
  assert.deepStrictEqual(facts.map((f) => [f.fact, f.value, f.source]), [['shared_buffers', '128MB', 'database settings'], ['work_mem', '4MB', 'database settings'], ['max_connections', '100', 'database settings']]);
  assert.ok(seen[0].argv.includes('-w'), 'password prompting is disabled');
  assert.strictEqual(seen[0].env.PGCONNECT_TIMEOUT, '3');
});

test('authentication failure -> every database fact is null with the fixed reason, and no raw text', async () => {
  const exec = async () => ({ stdout: '', stderr: fx('psql-auth-failure.txt'), code: 2, timedOut: false, enoent: false });
  const facts = await config.collectConfigFacts({ entries: [{ kind: 'postgres' }], exec, resolver: resolverFor(['postgres']) });
  assert.ok(facts.every((f) => f.value === null && f.unavailableReason === 'authentication required (credentials are never stored)'));
  assert.ok(!/fe_sendauth|localhost/.test(JSON.stringify(facts)));
});

test('database out of scope -> not declared in scope, and no query is executed (spy)', async () => {
  let calls = 0;
  const exec = async () => { calls++; return ok(fx('psql-settings.txt')); };
  const facts = await config.collectConfigFacts({ entries: [{ kind: 'postgres' }], exec, resolver: resolverFor(['node']) });
  assert.strictEqual(calls, 0);
  assert.ok(facts.every((f) => f.value === null && f.unavailableReason === 'not declared in scope'));
});

test('a postgres entry in a declared container uses docker exec and respects the container scope', async () => {
  const seen = [];
  const exec = async (f, argv) => { seen.push([f, ...argv.slice(0, 3)].join(' ')); return ok(fx('psql-settings.txt')); };
  const inS = await config.collectConfigFacts({ entries: [{ kind: 'postgres', container: 'pg-db' }], exec, resolver: resolverFor(['pg-db']) });
  assert.strictEqual(inS[0].value, '128MB');
  assert.match(seen[0], /^docker exec pg-db psql/);
  seen.length = 0;
  const outS = await config.collectConfigFacts({ entries: [{ kind: 'postgres', container: 'pg-db' }], exec, resolver: resolverFor(['node']) });
  assert.strictEqual(seen.length, 0);
  assert.strictEqual(outS[0].unavailableReason, 'not declared in scope');
});

test('wsl config fact carries the cap value or the reason, with its source', async () => {
  const f1 = await config.collectConfigFacts({ entries: [{ kind: 'wsl' }], exec: async () => ok(''), resolver: resolverFor([]), readConfiguredCap: () => vm.readConfiguredCap({ readFile: () => fx('wslconfig-8gb.ini') }) });
  assert.deepStrictEqual(f1[0], { kind: 'wsl', fact: 'memoryCapMB', value: 8192, source: 'user VM config', unavailableReason: null, unit: 'MB' });
  const f2 = await config.collectConfigFacts({ entries: [{ kind: 'wsl' }], exec: async () => ok(''), resolver: resolverFor([]), readConfiguredCap: () => vm.readConfiguredCap({ readFile: () => fx('wslconfig-nocap.ini') }) });
  assert.strictEqual(f2[0].value, null);
  assert.strictEqual(f2[0].unavailableReason, 'no cap configured (default applies)');
});

// ---------- orchestrator: end to end with canned platform ----------
test('orchestrator: a poll cycle writes container series, lifecycle markers and VM records; out-of-scope names never reach the stream', async () => {
  const stream = [];
  const sink = { append: (t, r) => stream.push({ type: t, ...r }) };
  const heavy = createHeavyRunner({});
  let docker = fx('docker-ps.jsonl');
  const exec = async (f, argv) => {
    if (f === 'docker') return ok(argv[0] === 'ps' ? docker : fx('docker-stats.jsonl'));
    if (f === 'wsl.exe') return ok(fx('wsl-list-stopped.txt'));
    return ok('');
  };
  const timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const wl = createWorkload({ ext: { phases: [], probes: [], config: [{ kind: 'wsl' }] }, scoped: true, resolver: resolverFor(['postgres']), exec, heavy, sink, setTimer, clearTimer: () => {}, now: () => T0, readConfiguredCap: () => ({ value: 8192, unit: 'MB', source: 'user VM config' }) });
  wl.start();
  await new Promise((r) => setImmediate(r));
  await timers.shift()(); // containers tick 1
  docker = fx('docker-ps.jsonl').split('\n').slice(1).join('\n'); // the postgres container stops
  await timers.find(Boolean)?.();
  await heavy.whenSettled();
  const types = stream.map((s) => s.type);
  assert.ok(types.includes('wl-containers'));
  assert.ok(types.includes('wl-vmcap'));
  assert.ok(types.includes('wl-config'));
  assert.ok(!/zzcanary/i.test(JSON.stringify(stream)), 'canary container, image and distro names never appear in the stream');
  wl.stop();
});
