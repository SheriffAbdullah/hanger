'use strict';
// Scheduler: the continuous tier's cadence, unobserved intervals and rolling window, plus the
// on-trigger runner (budgets, coalescing, heavyRuns records). The clock and the sink are injected,
// so every behavior is testable on a fake clock. Nothing here launches a process.
const { pct } = require('../numbers');
const { rec } = require('./record');

const round = (v, d) => +Number(v).toFixed(d);

// ---- continuous tier: cadence + gaps + rolling window ---------------------------------------------
function createContinuous({ nominalS = 2, gapFactor = 2, rollingS = 120, sink = null, toIso = (ms) => new Date(ms).toISOString() } = {}) {
  const deltas = [];       // seconds between consecutive samples (small numbers, bounded by run length / nominal)
  const unobserved = [];
  const rolling = [];      // recent samples only: memory stays bounded regardless of run length
  let prevMs = null, pendingReason = null, count = 0, lastMs = null;

  // reason for the NEXT gap (set by the session manager on restart, by a suspend detector, ...)
  const noteGapReason = (reason) => { pendingReason = reason; };

  function onSample(atMs, payload = {}) {
    count++;
    if (prevMs !== null) {
      const d = (atMs - prevMs) / 1000;
      deltas.push(round(d, 3));
      if (d > gapFactor * nominalS) {
        const g = { start: toIso(prevMs), end: toIso(atMs), durationS: round(d, 3), reason: pendingReason || 'collector-late' };
        unobserved.push(g);
        if (sink) sink.append('gap', g);
        pendingReason = null;
      }
    }
    prevMs = atMs; lastMs = atMs;
    rolling.push({ atMs, ...payload });
    const cut = atMs - rollingS * 1000;
    while (rolling.length && rolling[0].atMs < cut) rolling.shift();
  }

  // at run end: a tail with no sample for more than gapFactor x nominal is also an unobserved interval
  function finish(endMs) {
    if (lastMs !== null && (endMs - lastMs) / 1000 > gapFactor * nominalS) {
      const g = { start: toIso(lastMs), end: toIso(endMs), durationS: round((endMs - lastMs) / 1000, 3), reason: pendingReason || 'collector-late' };
      unobserved.push(g);
      if (sink) sink.append('gap', g);
    }
    if (lastMs === null && endMs !== null) {
      // never observed: recorded as a failure by the caller, not as an interval (no start time exists)
    }
  }

  function cadence(at = null) {
    return {
      nominalS,
      achievedMedianS: deltas.length ? round(pct(deltas, 50), 3) : null,
      achievedP95S: deltas.length ? round(pct(deltas, 95), 3) : null,
      n: deltas.length,
      basis: 'seconds between consecutive continuous samples (counter-sample timestamps)',
      ...(at ? { at } : {}),
    };
  }
  // seconds of the interval [startMs, endMs] that were not observed (rates exclude it)
  const unobservedS = () => round(unobserved.reduce((a, g) => a + g.durationS, 0), 3);
  const latest = () => rolling[rolling.length - 1] || null;
  return { onSample, finish, noteGapReason, cadence, unobserved, unobservedS, rolling, latest, get count() { return count; } };
}

// ---- on-trigger tier: budgets, coalescing, heavyRuns ----------------------------------------------
// run({id, trigger, budgetMs, minIntervalS, coalesce, fn}):
//   fn(ctx) -> Promise<value>; ctx.abort(cb) registers a kill hook, ctx.setPartial(v) keeps parseable partial output.
//   The caller is released at budget with the partial value; the heavyRuns record is written when the
//   work settles, so elapsedMs is the real time it took (a killed child settles right after the budget).
function createHeavyRunner({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, toIso = (ms) => new Date(ms).toISOString(), onRecord = () => {}, onFailure = () => {} } = {}) {
  const records = [];
  const lastStart = new Map();
  const inflight = new Map();
  const settledPromises = [];
  const GRACE_MS = 5000; // an abandoned task that never settles is recorded this long after budget

  function write(r) { records.push(r); onRecord(r); }

  function run({ id, trigger, budgetMs, minIntervalS = 0, coalesce = false, fn, inference = id }) {
    const t0 = now();
    if (coalesce && inflight.has(id)) {
      const cur = inflight.get(id);
      cur.coalesced++;
      return cur.result.then((r) => ({ ...r, coalesced: true }));
    }
    if (minIntervalS > 0 && lastStart.has(id) && (t0 - lastStart.get(id)) / 1000 < minIntervalS) {
      const r = { collector: id, trigger, at: toIso(t0), elapsedMs: 0, budgetMs, outcome: 'skipped', reason: `min-interval ${minIntervalS}s not elapsed` };
      write(r);
      return Promise.resolve({ outcome: 'skipped', value: null, reason: r.reason, elapsedMs: 0 });
    }
    lastStart.set(id, t0);
    const ctx = { partial: null, killHooks: [], abort(cb) { this.killHooks.push(cb); }, setPartial(v) { this.partial = v; }, killed: false };
    const kill = () => { ctx.killed = true; for (const k of ctx.killHooks) { try { k(); } catch { /* child already gone */ } } };
    let task;
    try { task = Promise.resolve(fn(ctx)); } catch (e) { task = Promise.reject(e); }
    const entry = { coalesced: 0 };
    let released = false, timer = null, releaseResolve;
    const result = new Promise((resolve) => { releaseResolve = resolve; });
    entry.result = result;
    const release = (r) => { if (released) return; released = true; if (timer) clearTimer(timer); releaseResolve(r); };
    // settle -> record
    const settled = task.then(
      (value) => ({ ok: true, value }),
      (err) => ({ ok: false, err }),
    ).then((s) => {
      const elapsed = now() - t0;
      const overBudget = elapsed > budgetMs || ctx.killed;
      let outcome, reason = null, value = s.ok ? s.value : null;
      if (!s.ok) { outcome = 'failed'; reason = String(s.err && s.err.message || s.err).slice(0, 200); onFailure({ inference, collector: id, mode: 'failed', reason, at: toIso(now()) }); }
      else if (overBudget) { outcome = 'over-budget'; reason = 'over-budget'; }
      else outcome = 'ok';
      if (!s.ok && ctx.partial !== null) value = ctx.partial;
      if (outcome === 'over-budget' && value === null) value = ctx.partial;
      const r = { collector: id, trigger, at: toIso(t0), elapsedMs: elapsed, budgetMs, outcome, reason };
      if (entry.coalesced) r.coalescedCalls = entry.coalesced;
      if (ctx.partial !== null && outcome !== 'ok') r.partial = true;
      write(r);
      if (outcome === 'over-budget') onFailure({ inference, collector: id, mode: 'over-budget', reason: `${id} took ${elapsed}ms against a ${budgetMs}ms budget (trigger ${trigger})`, at: toIso(t0) });
      inflight.delete(id);
      release({ outcome, value, reason, elapsedMs: elapsed });
      return r;
    });
    settledPromises.push(settled);
    inflight.set(id, entry);
    // budget timer: release the caller early with the partial value; the work is killed
    timer = setTimer(() => {
      if (released) return;
      kill();
      release({ outcome: 'over-budget', value: ctx.partial, reason: 'over-budget', elapsedMs: now() - t0 });
      // if the task ignores the kill, still write a record after the grace period
      setTimer(() => {
        if (inflight.get(id) === entry) {
          inflight.delete(id);
          write({ collector: id, trigger, at: toIso(t0), elapsedMs: now() - t0, budgetMs, outcome: 'over-budget', reason: 'abandoned (did not stop after kill)' });
        }
      }, GRACE_MS);
    }, budgetMs);
    return result;
  }
  const whenSettled = () => Promise.all(settledPromises.splice(0));
  return { run, records, whenSettled };
}

// ---- duration: requested vs used vs actual ------------------------------------------------------
const MAX_DURATION_S = 28800; // 8 h (OQ-11)
function resolveDuration({ requestedS, source = 'default', maxS = MAX_DURATION_S }) {
  if (requestedS > maxS) return { requestedS, usedS: maxS, source, clampReason: `maximum ${maxS / 3600} h` };
  return { requestedS, usedS: requestedS, source, clampReason: null };
}

module.exports = { createContinuous, createHeavyRunner, resolveDuration, MAX_DURATION_S, rec };
