'use strict';
// The single asynchronous spawn wrapper: every process the sampler launches goes through here, so launches
// are counted by tier, child PIDs join the self-exclusion set, and a kill timer enforces the budget.
// Tests inject spawnFn; TELLTALE_TEST_FAIL_ALL makes every launch fail like a missing binary.
const { spawn } = require('child_process');

const clean = (s) => (s || '').toString().replace(/\0/g, '').replace(/\r/g, '');

function createExec({ observer = null, registerPid = () => {}, spawnFn = spawn, failAll = !!process.env.TELLTALE_TEST_FAIL_ALL, maxBytes = 8 * 1024 * 1024 } = {}) {
  // execA(file, argv, {timeoutMs, tier, ctx}) -> Promise<{stdout, stderr, code, timedOut, enoent, elapsedMs, pid}>
  // ctx (from the heavy runner) receives a kill hook and the partial stdout so far.
  function execA(file, argv, { timeoutMs = 15000, tier = 'onTrigger', ctx = null, opts = {} } = {}) {
    const t0 = Date.now();
    if (observer) observer.launch(tier);
    if (failAll) return Promise.resolve({ stdout: '', stderr: `spawn ${file} ENOENT (test: fail-all)`, code: 1, timedOut: false, enoent: true, elapsedMs: 0, pid: null });
    return new Promise((resolve) => {
      let child, out = '', err = '', done = false, timedOut = false, timer = null;
      const finish = (code, extra = {}) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        const stdout = clean(out).trim();
        resolve({ stdout, stderr: clean(err || extra.errText || (timedOut ? 'killed (budget)' : '')).slice(0, 500), code, timedOut, enoent: !!extra.enoent, elapsedMs: Date.now() - t0, pid: child ? child.pid : null });
      };
      try { child = spawnFn(file, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
      catch (e) { finish(1, { errText: e.message, enoent: e.code === 'ENOENT' }); return; }
      registerPid(child.pid);
      const kill = () => { try { child.kill(); } catch { /* already gone */ } };
      if (ctx) ctx.abort(kill);
      if (child.stdout) child.stdout.on('data', (d) => { if (out.length < maxBytes) out += d; if (ctx) ctx.setPartial(clean(out).trim()); });
      if (child.stderr) child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
      child.on('error', (e) => finish(1, { errText: e.message, enoent: e.code === 'ENOENT' }));
      child.on('close', (code) => finish(timedOut ? 1 : (code === null ? 1 : code)));
      timer = setTimeout(() => { timedOut = true; kill(); setTimeout(() => finish(1), 300); }, timeoutMs);
    });
  }
  const sh = (cmdline, opts) => {
    const re = /"([^"]*)"|(\S+)/g; const t = []; let m;
    while ((m = re.exec(cmdline))) t.push(m[1] !== undefined ? m[1] : m[2]);
    return execA(t[0], t.slice(1), opts);
  };
  const ps = (script, opts) => execA('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], opts);
  return { execA, sh, ps };
}

module.exports = { createExec };
