'use strict';
// On-hang heavy collection. Every step runs through the heavy runner inside its own declared budget.
// There is NO global "melting" state: a step is attempted whenever a hang fires, regardless of how long
// an earlier collection took. Overlapping hangs coalesce onto one in-flight run per collector (the
// shared result is attached to each hang), so a hang storm cannot stack processes.
//
// steps: { procEnum, osConfirm, gpu } each {id, budgetMs, fn(ctx)}; absent steps are skipped.
// The OS not-responding check starts at once (it must observe the hang itself), in parallel with the
// process snapshot; the per-PID GPU poll follows the snapshot because it needs its PID list.
async function runHangTrigger({ runner, steps, trigger = 'hang' }) {
  const out = {};
  const one = async (name) => {
    const s = steps[name];
    if (!s) return;
    out[name] = await runner.run({ id: s.id, trigger, budgetMs: s.budgetMs, coalesce: true, minIntervalS: s.minIntervalS || 0, fn: s.fn, inference: s.inference });
  };
  await Promise.all([one('osConfirm'), (async () => { await one('procEnum'); await one('gpu'); })()]);
  return out;
}

module.exports = { runHangTrigger };
