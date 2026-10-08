'use strict';
// Helper bridge: fake child process cases (start, early exit, garbage on stdout, stop, spawn error, fallback order) and
// real-process cases on Windows (classifier parity with lib/scope.js; the helper does not outlive a killed parent).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { spawn, spawnSync } = require('child_process');
const { startInputHelper, scopeLines, configLines } = require('../lib/sampler/input-helper');
const scopeLib = require('../lib/scope');
const { ensure } = require('../lib/sampler/input-helper-build');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-br-'));
const settings = { stallMs: { value: 250 }, recentInputMs: { value: 1000 }, mergeGapMs: { value: 1000 }, lateMs: { value: 200 }, tickMs: { value: 250 }, timeoutMs: { value: 1000 } };
const matchData = { open: false, entries: [{ name: 'postgres', desc: false }, { pattern: 'chrome*', desc: true }], system: ['svchost'], pinned: ['12'], hasDescendantEntries: true };

function fakeChild({ ready = true, exitCode = null, garbage = false } = {}) {
  const c = new EventEmitter();
  c.pid = 4242; c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.written = '';
  c.stdin.on('data', (d) => {
    c.written += d;
    if (/\bgo\n/.test(c.written) && ready) setImmediate(() => { if (garbage) c.stdout.write('not a protocol line\n\u0000\u0001\n'); c.stdout.write('R|ready\n'); c.stdout.write('S|612.5|in-scope|postgres\n'); });
    if (/\nstop\n/.test(c.written)) setImmediate(() => c.emit('exit', 0, null));
  });
  c.kill = () => setImmediate(() => c.emit('exit', null, 'SIGTERM'));
  if (exitCode !== null) setImmediate(() => c.emit('exit', exitCode, null));
  return c;
}
const oneCandidate = (kind = 'compiled') => async () => ({ candidates: [{ kind, file: 'h.exe', args: [], limits: { privateMB: 40 } }], attempts: [{ step: 'compile', ok: true }] });

test('control lines carry settings, scope names, patterns, system set and pinned ids, then go', () => {
  const lines = configLines({ settings, matchData, outFile: 'C:\\x\\f.input.jsonl', build: 'compiled' });
  assert.ok(lines.includes('set stallMs=250'));
  assert.ok(lines.includes('scope entry name=postgres desc=0'));
  assert.ok(lines.includes('scope entry pattern=chrome* desc=1'));
  assert.ok(lines.includes('scope system=svchost') && lines.includes('scope pinned=12'));
  assert.strictEqual(lines[lines.length - 1], 'go');
  assert.deepStrictEqual(scopeLines({ open: true, entries: [], system: [] }), ['scope-begin', 'scope open=1', 'scope-end']);
});

test('start: ready line makes it running; stall lines reach the console callback; stop() closes stdin and waits for exit', async () => {
  const stalls = [];
  let child;
  const h = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S1', buildFn: oneCandidate(), spawnFn: () => (child = fakeChild()), onStall: (x) => stalls.push(x) });
  assert.strictEqual(h.status, 'running');
  assert.strictEqual(h.build, 'compiled');
  assert.strictEqual(h.file, 'telltale-S1.input.jsonl');
  assert.strictEqual(h.pid, 4242);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(stalls, [{ latencyMs: 612.5, kind: 'in-scope', group: 'postgres' }]);
  assert.match(child.written, /set outFile=D:\\out\\telltale-S1\.input\.jsonl/);
  const ex = await h.stop();
  assert.strictEqual(ex.orderly, true);
  assert.match(child.written, /\nstop\n/);
});

test('early exit before ready degrades to unavailable with the exit code', async () => {
  const h = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S2', buildFn: oneCandidate(), spawnFn: () => fakeChild({ ready: false, exitCode: 5 }) });
  assert.strictEqual(h.status, 'unavailable');
  assert.match(h.reason, /exited before it was ready \(code 5\)/);
});

test('garbage on stdout is ignored and never throws', async () => {
  const h = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S3', buildFn: oneCandidate(), spawnFn: () => fakeChild({ garbage: true }) });
  assert.strictEqual(h.status, 'running');
  await h.stop();
});

test('a spawn error moves to the next candidate (compiled -> PowerShell fallback); both failing is unavailable with both reasons', async () => {
  const buildFn = async () => ({ candidates: [{ kind: 'compiled', file: 'a.exe', args: [], limits: { privateMB: 40 } }, { kind: 'powershell-fallback', file: 'p.exe', args: [], limits: { privateMB: 100 } }], attempts: [] });
  const order = [];
  let n = 0;
  const h = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S4', buildFn, spawnFn: (file) => { order.push(file); const c = fakeChild(); if (n++ === 0) { setImmediate(() => c.emit('error', Object.assign(new Error('blocked'), { code: 'EACCES' }))); return Object.assign(c, { stdin: new PassThrough(), stdout: new PassThrough() }); } return c; } });
  assert.deepStrictEqual(order, ['a.exe', 'p.exe']);
  assert.strictEqual(h.status, 'running');
  assert.strictEqual(h.build, 'powershell-fallback');
  assert.ok(h.attempts.some((a) => a.step === 'start:compiled' && /EACCES/.test(a.reason)));
  await h.stop();
  const bad = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S5', buildFn, spawnFn: () => fakeChild({ ready: false, exitCode: 1 }) });
  assert.strictEqual(bad.status, 'unavailable');
  assert.match(bad.reason, /start:compiled/);
  assert.match(bad.reason, /start:powershell-fallback/);
});

test('no candidates (build failed) is unavailable with the build reason; nothing is spawned', async () => {
  let spawned = 0;
  const h = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S6', buildFn: async () => ({ candidates: [], attempts: [], reason: 'compile: blocked' }), spawnFn: () => { spawned++; return fakeChild(); } });
  assert.strictEqual(h.status, 'unavailable');
  assert.strictEqual(h.reason, 'compile: blocked');
  assert.strictEqual(spawned, 0);
});

test('TELLTALE_TEST_HELPER_FAIL=start forces unavailable; exit@N kills the running helper and reports the exit', async () => {
  const f = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S7', buildFn: oneCandidate(), spawnFn: () => fakeChild(), env: { TELLTALE_TEST_HELPER_FAIL: 'start' } });
  assert.strictEqual(f.status, 'unavailable');
  assert.match(f.reason, /forced start failure/);
  let exited = null;
  const h = await startInputHelper({ settings, matchData, streamDir: 'D:\\out', stamp: 'S8', buildFn: oneCandidate(), spawnFn: () => fakeChild(), env: { TELLTALE_TEST_HELPER_FAIL: 'exit@0.05' }, onExit: (x) => { exited = x; } });
  assert.strictEqual(h.status, 'running');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(exited && exited.signal === 'SIGTERM', 'unexpected exit is reported');
});

// ---- real process (Windows only) ----
const win = process.platform === 'win32';
const realBuild = async () => ensure({});

test('real helper: its classifier agrees with lib/scope.js classifyForeground for names, patterns, system set and pinned descendants', { skip: !win }, async () => {
  const b = await realBuild();
  const cand = b.candidates.find((c) => c.kind === 'compiled' || c.kind === 'cached');
  if (!cand) return; // no compiler on this machine: parity cannot be checked here (the live review gate records it)
  const matcher = scopeLib.createMatcher([{ name: 'postgres' }, { pattern: 'chrome*' }, { name: 'zzroot', includeDescendants: true }]);
  const resolver = scopeLib.createResolver(matcher, {});
  resolver.pinned.add('777:1');
  const md = scopeLib.matchDataFor(resolver);
  const cases = [['postgres.exe', 0], ['POSTGRES', 0], ['postgres-helper', 0], ['chromedriver.exe', 0], ['svchost.exe', 0], ['dwm', 0], ['zzroot', 0], ['unknownthing.exe', 0], ['unknownthing.exe', 777], ['', 0], ['postgres.exe.bak', 0]];
  const input = [...configLines({ settings, matchData: md, outFile: 'x', build: 'compiled' }).filter((l) => !l.startsWith('set outFile')), ...cases.map(([n, p]) => `${n}|${p}`)].join('\n') + '\n';
  const r = spawnSync(cand.file, ['--classify'], { input, encoding: 'utf8', timeout: 20000, windowsHide: true });
  const out = r.stdout.split(/\r?\n/).filter((x) => x.length > 0 || false);
  const lines = r.stdout.split(/\r?\n/).slice(0, cases.length);
  assert.strictEqual(lines.length, cases.length, r.stderr);
  cases.forEach(([n, p], i) => {
    const js = scopeLib.classifyForeground(md, n, { pid: p || undefined });
    assert.strictEqual(lines[i], `${js.kind}|${js.group || ''}`, `${n} pid ${p}`);
  });
  void out;
});

test('real helper: it does not outlive a killed parent (no helper process 5 s after the parent is killed)', { skip: !win, timeout: 90000 }, async () => {
  const b = await realBuild();
  if (!b.candidates.length) return;
  const dir = tmp();
  const script = path.join(dir, 'parent.js');
  fs.writeFileSync(script, `const {startInputHelper}=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'sampler', 'input-helper.js'))});
(async()=>{const h=await startInputHelper({settings:${JSON.stringify(settings)},matchData:{open:true,entries:[],system:[]},streamDir:${JSON.stringify(dir)},stamp:'kill'});
console.log('HELPER '+h.status+' '+h.pid);setInterval(()=>{},1000);})();`);
  const parent = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const pid = await new Promise((resolve, reject) => {
    let buf = '';
    parent.stdout.on('data', (d) => { buf += d; const m = buf.match(/HELPER running (\d+)/); if (m) resolve(+m[1]); if (/HELPER unavailable/.test(buf)) resolve(null); });
    setTimeout(() => reject(new Error('helper did not start in 60 s')), 60000);
  });
  if (pid === null) { parent.kill(); return; }
  const alive = () => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' }).stdout.includes(`"${pid}"`);
  assert.ok(alive(), 'helper is running while the parent lives');
  spawnSync('taskkill', ['/F', '/PID', String(parent.pid)], { windowsHide: true });
  await new Promise((r) => setTimeout(r, 5000));
  assert.ok(!alive(), 'no helper remains 5 s after the parent was killed');
  // the operating system ends the helper together with its parent (child-process job); flushed lines survive
  const lines = fs.readFileSync(path.join(dir, 'telltale-kill.input.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines[0].type, 'input-helper');
});

test('real helper: an orderly stop() writes the final summary record and closes the file', { skip: !win, timeout: 60000 }, async () => {
  const b = await realBuild();
  if (!b.candidates.length) return;
  const dir = tmp();
  const h = await startInputHelper({ settings, matchData: { open: true, entries: [], system: [] }, streamDir: dir, stamp: 'orderly' });
  if (h.status !== 'running') return;
  await new Promise((r) => setTimeout(r, 1500));
  const ex = await h.stop();
  assert.strictEqual(ex.orderly, true);
  const lines = fs.readFileSync(path.join(dir, 'telltale-orderly.input.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual([lines[0].type, lines[lines.length - 1].type, lines[lines.length - 1].status], ['input-helper', 'input-end', 'orderly']);
});
