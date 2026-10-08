'use strict';
// Build chain for the input helper (design decision 9), in order:
//   (a) cached compiled helper in %LOCALAPPDATA%\telltale\bin\ named by source hash (outside OneDrive and outside reports/)
//   (b) compile with the in-box .NET Framework C# compiler (no install, no administrator rights)
//   (c) long-lived PowerShell fallback: the same source compiled in memory inside powershell.exe
//   (d) unavailable, with a plain reason
// Every step failure is recorded. A policy block (AppLocker, WDAC, endpoint protection) is reported as it happened and is
// never worked around. Test hook: TELLTALE_TEST_HELPER_FAIL=compile makes every build step fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const SOURCE = path.join(__dirname, 'input-helper', 'InputHelper.cs');

function cacheDirDefault(env = process.env) {
  const base = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'telltale', 'bin');
}
function sourceHash(srcPath = SOURCE) { return crypto.createHash('sha256').update(fs.readFileSync(srcPath)).digest('hex').slice(0, 16); }

function findCsc(env = process.env, exists = fs.existsSync) {
  const win = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  for (const d of ['Framework64', 'Framework']) {
    const p = path.join(win, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe');
    if (exists(p)) return p;
  }
  return null;
}

// older cached builds (other source hashes) are removed after a fresh compile; one in use by a running run simply stays
function pruneStale(dir, keep) {
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (/^telltale-input-[0-9a-f]+\.exe$/.test(f) && p !== keep) { try { fs.rmSync(p, { force: true }); } catch { /* in use */ } } } } catch { /* best effort */ }
}

const run = (file, args, timeoutMs) => new Promise((resolve) => {
  execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

// opts: { srcPath, cacheDir, env, exec(file,args,timeoutMs)->{err,stdout,stderr}, findCscFn, existsFn, platform }
// returns { candidates: [{kind, file, args, limits}], attempts: [{step, ok, reason}], hash }
async function ensure(opts = {}) {
  const env = opts.env || process.env;
  const srcPath = opts.srcPath || SOURCE;
  const exec = opts.exec || run;
  const exists = opts.existsFn || fs.existsSync;
  const platform = opts.platform || process.platform;
  const attempts = [];
  const result = { candidates: [], attempts, hash: null, reason: null };
  const note = (step, ok, reason) => attempts.push({ step, ok, reason: reason || null });
  if (platform !== 'win32') { result.reason = `the input helper is Windows-only (platform ${platform})`; note('platform', false, result.reason); return result; }
  if (String(env.TELLTALE_TEST_HELPER_FAIL || '') === 'compile') { result.reason = 'test: forced build failure (TELLTALE_TEST_HELPER_FAIL=compile)'; note('build', false, result.reason); return result; }
  let hash;
  try { hash = sourceHash(srcPath); } catch (e) { result.reason = `helper source unreadable: ${e.message}`; note('source', false, result.reason); return result; }
  result.hash = hash;
  const dir = opts.cacheDir || cacheDirDefault(env);
  const exe = path.join(dir, `telltale-input-${hash}.exe`);
  // (a) cached
  if (exists(exe)) { note('cached', true); result.candidates.push({ kind: 'cached', file: exe, args: [], limits: { privateMB: 40 } }); }
  else {
    // (b) in-box compiler
    const csc = (opts.findCscFn || findCsc)(env, exists);
    if (!csc) note('compile', false, 'the in-box C# compiler (csc.exe, .NET Framework 4) was not found');
    else {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { note('compile', false, `cannot create ${dir}: ${e.message}`); }
      const tmp = path.join(dir, `telltale-input-${hash}.${process.pid}.tmp.exe`);
      const r = await exec(csc, ['/nologo', '/target:exe', '/optimize+', `/out:${tmp}`, srcPath], 60000);
      if (r.err || !exists(tmp)) {
        const why = (r.stderr || r.stdout || (r.err && r.err.message) || 'no output').replace(/\s+/g, ' ').slice(0, 200);
        note('compile', false, `compiler failed: ${why}`);
        try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      } else {
        try { fs.renameSync(tmp, exe); note('compile', true); pruneStale(dir, exe); result.candidates.push({ kind: 'compiled', file: exe, args: [], limits: { privateMB: 40 } }); } catch (e) {
          // another run may have won the race; use the file that is there
          if (exists(exe)) { note('compile', true, 'another run cached it first'); result.candidates.push({ kind: 'cached', file: exe, args: [], limits: { privateMB: 40 } }); } else note('compile', false, `cannot place compiled helper: ${e.message}`);
          try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
        }
      }
    }
  }
  // (c) PowerShell fallback: the same source compiled in memory (84 MB measured; limit 100 MB)
  const ps = path.join(env.WINDIR || env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(ps)) {
    const script = `Add-Type -TypeDefinition ([IO.File]::ReadAllText('${srcPath.replace(/'/g, "''")}')) -Language CSharp; exit [TelltaleInput.Program]::Main(@())`;
    result.candidates.push({ kind: 'powershell-fallback', file: ps, args: ['-NoProfile', '-NonInteractive', '-Command', script], limits: { privateMB: 100 } });
    note('powershell-fallback', true, 'available if the compiled helper cannot run');
  } else note('powershell-fallback', false, 'powershell.exe not found');
  if (!result.candidates.length) result.reason = attempts.filter((a) => !a.ok).map((a) => `${a.step}: ${a.reason}`).join('; ') || 'no way to build the helper';
  return result;
}

module.exports = { ensure, findCsc, sourceHash, cacheDirDefault, SOURCE };
