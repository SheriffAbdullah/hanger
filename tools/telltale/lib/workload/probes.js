'use strict';
// Workload latency probe (opt-in, declared in the scope file). Timing only:
//  argv array, no shell, hidden window, output ignored and never read, killed at its timeout,
//  never run from an elevated session. Only the probe NAME ever appears in an artifact; the command is never echoed.
const { R } = require('./reasons');

const STOP_AFTER_NOT_FOUND = 3;

// exec: EXEC.execA-compatible (stdio is forced to 'ignore' so no output is ever read)
async function runProbeOnce({ probe, exec, now = Date.now }) {
  const t0 = now();
  const r = await exec(probe.command[0], probe.command.slice(1), { timeoutMs: probe.timeoutMs, tier: 'workloadProbe', opts: { stdio: 'ignore', shell: false, windowsHide: true } });
  const wall = now() - t0;
  let status;
  if (r.timedOut) status = 'timeout';
  else if (r.enoent) status = 'not-found';
  else if (r.code === 0) status = 'ok';
  else status = 'nonzero';
  return { at: new Date(t0).toISOString(), ms: status === 'timeout' ? probe.timeoutMs : wall, status };
}

// scheduler for one run: starts a loop per declared probe; overlapping runs are impossible (next attempt waits).
// sink.append('wl-probe', {name, at, ms, status}); stops a probe after 3 consecutive not-found results.
function startProbes({ probes, exec, sink, elevated = false, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onEvent = () => {} }) {
  const state = {};
  const timers = new Map();
  let stopped = false;
  const out = { stopped: () => stopped, stop() { stopped = true; for (const t of timers.values()) clearTimer(t); timers.clear(); }, state, declared: probes.map((p) => p.name) };
  if (!probes.length) return out;
  if (elevated) {
    for (const p of probes) state[p.name] = { running: false, reason: R.ELEVATED_NO_PROBE };
    onEvent({ kind: 'refused', reason: R.ELEVATED_NO_PROBE });
    return out;
  }
  for (const p of probes) {
    state[p.name] = { running: true, reason: null, attempts: 0, notFoundStreak: 0 };
    const tick = async () => {
      if (stopped) return;
      let res;
      try { res = await runProbeOnce({ probe: p, exec, now }); }
      catch { res = { at: new Date(now()).toISOString(), ms: p.timeoutMs, status: 'nonzero' }; }
      const st = state[p.name];
      st.attempts++;
      st.notFoundStreak = res.status === 'not-found' ? st.notFoundStreak + 1 : 0;
      if (sink) sink.append('wl-probe', { name: p.name, ...res });
      if (st.notFoundStreak >= STOP_AFTER_NOT_FOUND) {
        st.running = false; st.reason = `command not found ${STOP_AFTER_NOT_FOUND} times in a row; probe stopped`;
        if (sink) sink.append('wl-probe-stop', { name: p.name, at: new Date(now()).toISOString(), reason: st.reason });
        return;
      }
      const wait = Math.max(0, p.everySec * 1000 - (now() - Date.parse(res.at)));
      if (!stopped) timers.set(p.name, setTimer(tick, wait));
    };
    timers.set(p.name, setTimer(tick, 0));
  }
  return out;
}

module.exports = { runProbeOnce, startProbes, STOP_AFTER_NOT_FOUND };
