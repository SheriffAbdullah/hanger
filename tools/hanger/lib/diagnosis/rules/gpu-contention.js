'use strict';
// GPU contention: the busiest GPU engine at least 90%, or dedicated GPU memory at least 95% of its total, on at least 3
// usable probes within +-10 s of the hang. Evaluated only when GPU data exists for the hang window; otherwise the result
// is "not evaluated" and carries the recorded unavailable reason. The memory condition also needs a dedicated-memory total
// (from the system profile, when it is not a 32-bit reporting ceiling); without it only the engine condition applies.
const K = require('./_kit');

const ID = 'gpu-contention';
const ENG = 'gpu.engine_util_pct', VRAM = 'gpu.vram_used_mb';

// dedicated GPU memory total in MB from the system profile, or null
function vramTotalMB(ctx) {
  return K.runLevel(ctx, `${ID}:total`, () => {
    const sp = ctx.report.systemProfile;
    const f = sp && sp.graphics && sp.graphics.adapters;
    const list = Array.isArray(f) ? f : (f && Array.isArray(f.value) ? f.value : []);
    const t = list.filter((a) => a && K.finite(a.dedicatedMB) && !a.lowerBound).map((a) => a.dedicatedMB);
    return t.length ? Math.max(...t) : null;
  });
}

module.exports = {
  id: ID,
  class: 'gpu',
  phrase: 'GPU contention',
  valueLabel: 'busiest GPU engine',
  evaluate(ctx, h) {
    const tE = K.th(ctx, ID, 'enginePct'), tV = K.th(ctx, ID, 'vramPct');
    const rows = K.windowRows(ctx, h, [ENG, VRAM]);
    if (!rows.some((x) => x[ENG] !== null || x[VRAM] !== null)) return K.nullResult(tE, ctx.missing(ENG));
    const total = vramTotalMB(ctx);
    const vramPct = (x) => (total && x[VRAM] !== null ? x[VRAM] / total * 100 : null);
    const s = ctx.sustained(rows, (x) => (x[ENG] !== null && x[ENG] >= tE.value) || (vramPct(x) !== null && vramPct(x) >= tV.value));
    const byVram = s.hit.length > 0 && s.hit.every((x) => !(x[ENG] !== null && x[ENG] >= tE.value));
    return { fired: s.sustained, reason: s.sustained ? null : `not sustained (${s.text}; busiest engine >= ${tE.value}%${total ? ` or dedicated memory >= ${tV.value}% of ${Math.round(total)} MB` : '; dedicated memory total not available, so that condition was not evaluated'})`,
      inputs: K.inputsOf(ctx, s.hit.map((x) => x.q), [ENG, VRAM]), threshold: tE, n: s.count,
      calmSignal: ENG, hangValue: K.T.mean(s.hit.map((x) => x[ENG])), effThreshold: tE.value, direction: 'higher',
      confounds: [{ id: 'display-or-video', text: 'an external display or video playback keeps the GPU busy without contending with the workload', active: false }],
      extra: { dedicatedTotalMB: total, memoryConditionEvaluated: total !== null, trigger: byVram ? 'dedicated-memory' : 'engine' } };
  },
  disprove(ctx) {
    const tE = K.th(ctx, ID, 'disproveEnginePct'), tV = K.th(ctx, ID, 'disproveVramPct');
    const check = `busiest GPU engine < ${tE.value}% and dedicated memory < ${tV.value}% of its total within +-10 s of every hang`;
    const total = vramTotalMB(ctx);
    const hs = ctx.hangs.map((q) => {
      const rows = K.windowRows(ctx, q, [ENG, VRAM]);
      const e = rows.map((x) => x[ENG]).filter(K.finite), v = rows.map((x) => x[VRAM]).filter(K.finite);
      return e.length ? { q, maxEngine: Math.max(...e), maxVramPct: total && v.length ? Math.round(Math.max(...v) / total * 1000) / 10 : null } : null;
    }).filter(Boolean);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: hs.every((x) => x.maxEngine < tE.value && (x.maxVramPct === null || x.maxVramPct < tV.value)) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, maxEnginePct: x.maxEngine, maxDedicatedMemoryPct: x.maxVramPct })) };
  },
};
