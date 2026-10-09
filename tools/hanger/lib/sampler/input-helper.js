'use strict';
// Bridge to the independent input helper process (same shape as keycap.js): spawn, send settings and scope match data on
// stdin, read the optional live lines on stdout, stop(). The helper stamps and writes its own file (hanger-<stamp>.input.jsonl);
// this bridge never re-stamps, copies or back-fills a record. It never throws: any failure degrades to
// {status: 'unavailable', reason} and the run continues.
const { spawn } = require('child_process');
const path = require('path');
const ensureDefault = require('./input-helper-build').ensure;

// serializable scope match data (lib/scope.js matchDataFor) -> helper control lines
function scopeLines(md) {
  const clean = (s) => String(s).replace(/[\r\n]/g, ' ');
  const out = ['scope-begin', `scope open=${md && md.open ? 1 : 0}`];
  if (md && md.system && md.system.length) out.push(`scope system=${md.system.map(clean).join(',')}`);
  if (md && md.pinned && md.pinned.length) out.push(`scope pinned=${md.pinned.map(clean).join(',')}`);
  for (const e of (md && md.entries) || []) out.push(`scope entry ${e.name !== undefined ? `name=${clean(e.name)}` : `pattern=${clean(e.pattern)}`} desc=${e.desc ? 1 : 0}`);
  out.push('scope-end');
  return out;
}

function configLines({ settings, matchData, outFile, build }) {
  const v = (k) => (settings && settings[k] ? settings[k].value : undefined);
  const lines = [];
  for (const k of ['stallMs', 'recentInputMs', 'mergeGapMs', 'lateMs', 'tickMs', 'timeoutMs']) if (Number.isFinite(v(k))) lines.push(`set ${k}=${v(k)}`);
  lines.push(`set outFile=${outFile}`, `set build=${build}`, ...scopeLines(matchData), 'go');
  return lines;
}

// returns { status, reason, build, file, at, pid, attempts, limits, child, stop(), updateScope(md), exited() }
async function startInputHelper({ settings, matchData, streamDir, stamp, spawnFn = spawn, buildFn = ensureDefault, env = process.env, onStall = () => {}, onExit = () => {}, readyTimeoutMs = null, now = () => new Date() } = {}) {
  const fileName = `hanger-${stamp}.input.jsonl`;
  const outFile = path.join(streamDir, fileName);
  const base = { status: 'unavailable', reason: null, build: null, file: fileName, at: now().toISOString(), pid: null, attempts: [], limits: null, child: null };
  const fin = (o) => ({ ...base, ...o, stop: async () => {}, updateScope: () => {}, exited: () => null });
  let built;
  try { built = await buildFn({ env }); } catch (e) { return fin({ reason: `helper build failed: ${String(e.message || e).slice(0, 160)}`, attempts: [{ step: 'build', ok: false, reason: String(e.message || e).slice(0, 160) }] }); }
  base.attempts = built.attempts || [];
  if (!built.candidates || !built.candidates.length) return fin({ reason: built.reason || 'the helper could not be built' });
  if (String(env.HANGER_TEST_HELPER_FAIL || '') === 'start') return fin({ reason: 'test: forced start failure (HANGER_TEST_HELPER_FAIL=start)', attempts: [...base.attempts, { step: 'start', ok: false, reason: 'forced' }] });

  for (const cand of built.candidates) {
    const outcome = await tryStart(cand);
    if (outcome.ok) return outcome.handle;
    base.attempts.push({ step: `start:${cand.kind}`, ok: false, reason: outcome.reason });
  }
  return fin({ reason: base.attempts.filter((a) => !a.ok).map((a) => `${a.step}: ${a.reason}`).slice(-3).join('; ') || 'the helper did not start' });

  function tryStart(cand) {
    return new Promise((resolve) => {
      let child;
      let settled = false;
      const done = (o) => { if (!settled) { settled = true; clearTimeout(timer); resolve(o); } };
      try { child = spawnFn(cand.file, cand.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); } catch (e) { return resolve({ ok: false, reason: `spawn failed: ${String(e.message || e).slice(0, 140)}` }); }
      const limitMs = readyTimeoutMs || (cand.kind === 'powershell-fallback' ? 25000 : 6000);
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } done({ ok: false, reason: `no ready signal within ${limitMs} ms` }); }, limitMs);
      let exited = null, stopping = false, ready = false, buf = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line === 'R|ready') { ready = true; done({ ok: true, handle: handle() }); continue; }
          const m = line.match(/^S\|([\d.]+)\|(in-scope|system|out-of-scope|unknown)\|(.*)$/);
          if (m) { try { onStall({ latencyMs: +m[1], kind: m[2], group: m[3] || null }); } catch { /* a console callback must not stop the bridge */ } }
        }
      });
      child.stdin.on('error', () => { /* helper gone: handled by exit */ });
      child.on('error', (e) => { done({ ok: false, reason: `spawn error: ${String(e.code || e.message || e).slice(0, 120)}` }); });
      child.on('exit', (code, signal) => {
        exited = { code, signal, at: now().toISOString(), orderly: stopping };
        done({ ok: false, reason: `helper exited before it was ready (code ${code}${signal ? `, ${signal}` : ''})` });
        if (ready && !stopping) { try { onExit(exited); } catch { /* callback must not throw into the bridge */ } }
      });
      try { child.stdin.write(configLines({ settings, matchData, outFile, build: cand.kind }).join('\n') + '\n'); } catch (e) { done({ ok: false, reason: `cannot talk to the helper: ${String(e.message || e).slice(0, 100)}` }); }

      function handle() {
        const h = {
          ...base, status: 'running', reason: null, build: cand.kind, pid: child.pid, limits: cand.limits, child,
          async stop() {
            if (exited) return exited;
            stopping = true;
            await new Promise((res) => {
              const kill = setTimeout(() => { try { child.kill(); } catch { /* gone */ } res(); }, 5000);
              child.once('exit', () => { clearTimeout(kill); res(); });
              try { child.stdin.write('stop\n'); child.stdin.end(); } catch { try { child.kill(); } catch { /* gone */ } }
            });
            return exited;
          },
          updateScope(md) { try { child.stdin.write(scopeLines(md).join('\n') + '\n'); } catch { /* helper gone */ } },
          exited: () => exited,
        };
        const failAt = /^exit@(\d+(?:\.\d+)?)$/.exec(String(env.HANGER_TEST_HELPER_FAIL || ''));
        if (failAt) setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, +failAt[1] * 1000);
        return h;
      }
    });
  }
}

module.exports = { startInputHelper, scopeLines, configLines };
