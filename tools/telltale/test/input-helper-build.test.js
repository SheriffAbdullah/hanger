'use strict';
// Build chain order and reasons (design decision 9), with injected fake compilers; no real compile here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensure, sourceHash } = require('../lib/sampler/input-helper-build');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-hb-'));
const env = (extra = {}) => ({ WINDIR: 'C:\\Windows', LOCALAPPDATA: tmp(), ...extra });

test('success: compiles once, then the second call is cached; the PowerShell fallback follows the compiled helper', async () => {
  const e = env();
  const dir = path.join(e.LOCALAPPDATA, 'telltale', 'bin');
  let compiles = 0;
  const exec = async (file, args) => { compiles++; const out = args.find((a) => a.startsWith('/out:')).slice(5); fs.writeFileSync(out, 'MZ'); return { err: null, stdout: '', stderr: '' }; };
  const common = { env: e, cacheDir: dir, exec, findCscFn: () => 'csc.exe', existsFn: (p) => (/powershell\.exe$/i.test(p) ? true : fs.existsSync(p)) };
  const a = await ensure(common);
  assert.deepStrictEqual(a.candidates.map((c) => c.kind), ['compiled', 'powershell-fallback']);
  assert.ok(a.candidates[0].file.includes(sourceHash()));
  assert.strictEqual(a.candidates[0].limits.privateMB, 40);
  assert.strictEqual(a.candidates[1].limits.privateMB, 100);
  const b = await ensure(common);
  assert.deepStrictEqual(b.candidates.map((c) => c.kind), ['cached', 'powershell-fallback']);
  assert.strictEqual(compiles, 1);
});

test('compile failure is recorded with its reason and the PowerShell fallback is still offered', async () => {
  const e = env();
  const exec = async () => ({ err: new Error('blocked'), stdout: '', stderr: 'error CS0016: could not write output file (blocked by policy)' });
  const r = await ensure({ env: e, cacheDir: path.join(e.LOCALAPPDATA, 'b'), exec, findCscFn: () => 'csc.exe', existsFn: (p) => (/powershell\.exe$/i.test(p) ? true : fs.existsSync(p)) });
  assert.deepStrictEqual(r.candidates.map((c) => c.kind), ['powershell-fallback']);
  const c = r.attempts.find((a) => a.step === 'compile');
  assert.strictEqual(c.ok, false);
  assert.match(c.reason, /blocked by policy/);
});

test('no compiler and no PowerShell: no candidates and a plain reason naming both', async () => {
  const e = env();
  const r = await ensure({ env: e, cacheDir: path.join(e.LOCALAPPDATA, 'c'), findCscFn: () => null, existsFn: () => false });
  assert.deepStrictEqual(r.candidates, []);
  assert.match(r.reason, /compile: the in-box C# compiler/);
  assert.match(r.reason, /powershell-fallback: powershell\.exe not found/);
});

test('TELLTALE_TEST_HELPER_FAIL=compile fails every build step', async () => {
  const r = await ensure({ env: env({ TELLTALE_TEST_HELPER_FAIL: 'compile' }) });
  assert.deepStrictEqual(r.candidates, []);
  assert.match(r.reason, /forced build failure/);
});

test('a non-Windows platform is unavailable with that reason', async () => {
  const r = await ensure({ env: env(), platform: 'linux' });
  assert.deepStrictEqual(r.candidates, []);
  assert.match(r.reason, /Windows-only/);
});

test('the source hash changes when the source changes (cache is keyed by source hash)', () => {
  const d = tmp();
  const a = path.join(d, 'a.cs'), b = path.join(d, 'b.cs');
  fs.writeFileSync(a, 'class A{}'); fs.writeFileSync(b, 'class B{}');
  assert.notStrictEqual(sourceHash(a), sourceHash(b));
});
