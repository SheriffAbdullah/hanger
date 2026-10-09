'use strict';
// Database memory and I/O for an IN-SCOPE database process group (the group name is one the user declared; an
// out-of-scope database is never named). Two variants, whichever the recorded inputs support:
//   memory (class memory): group memory + configured memory settings >= 25% of RAM on >= 3 probes within +-10 s of the hang
//   I/O    (class disk)  : disk latency >= 25 ms with queue >= 1 while the group performs I/O, on >= 3 probes
// A missing configuration is named, never assumed: the memory variant then uses group memory alone.
const K = require('./_kit');
const { DB_GROUP_RE, namedGroups } = require('../cause-signals');

const ID = 'database-memory-io';
const CONFIG_NAMES = ['shared_buffers', 'work_mem', 'max_connections'];

// run-level: configured memory from the opt-in workload configuration facts (null when not collected)
function configFacts(ctx) {
  return K.runLevel(ctx, `${ID}:config`, () => {
    const facts = (Array.isArray(ctx.report.workloadConfig) ? ctx.report.workloadConfig : []).filter((f) => f && f.kind === 'postgres');
    const by = {};
    for (const n of CONFIG_NAMES) { const f = facts.find((x) => x.fact === n); by[n] = f && f.value !== null && f.value !== undefined ? f.value : null; }
    const buffers = K.parseMB(by.shared_buffers), workMem = K.parseMB(by.work_mem), conns = Number(by.max_connections);
    if (buffers === null) return { available: false, configuredMB: null, missing: facts.length ? facts.filter((f) => f.value === null || f.value === undefined).map((f) => `${f.fact} (${f.unavailableReason || 'not collected'})`) : ['database configuration facts (not collected: declare config in the scope file)'] };
    const ceiling = workMem !== null && Number.isFinite(conns) ? workMem * conns : 0;
    return { available: true, configuredMB: buffers + ceiling, parts: { sharedBuffersMB: buffers, workMemTimesConnectionsMB: ceiling || null }, missing: [] };
  });
}

// the in-scope database group named at a probe (the one with the most memory when several match)
function dbGroupAt(ctx, q) {
  const p = q.p.procs;
  if (!p || !Array.isArray(p.groups)) return null;
  const hit = namedGroups(q.p).filter((n) => DB_GROUP_RE.test(n) && p.groups.some((g) => g && g.group === n));
  if (!hit.length) return null;
  return hit.map((n) => ({ n, m: ctx.sig(q, `proc.group_mem_mb[${n}]`) || 0 })).sort((a, b) => b.m - a.m)[0].n;
}

module.exports = {
  id: ID,
  class: 'memory',
  phrase: 'database memory or I/O',
  valueLabel: 'database group memory',
  evaluate(ctx, h) {
    const tM = K.th(ctx, ID, 'memPctRam'), tL = K.th(ctx, ID, 'latencyMs'), tQ = K.th(ctx, ID, 'queue'), tI = K.th(ctx, ID, 'ioBps');
    if (!h.p.procs || !Array.isArray(h.p.procs.groups)) return K.nullResult(tM, ctx.missing('proc.group_mem_mb[database]'));
    const win = ctx.near(h, K.WINDOW_S);
    const group = dbGroupAt(ctx, h) || win.map((q) => dbGroupAt(ctx, q)).find(Boolean) || null;
    if (!group) return { fired: false, reason: 'no in-scope database group', inputs: [], threshold: tM, n: 0, extra: { missingInput: 'in-scope database group' } };
    const gm = `proc.group_mem_mb[${group}]`, gp = `proc.group_mem_pct_ram[${group}]`, gi = `proc.group_io_bps[${group}]`;
    const ram = ctx.env.totalMB;
    const cfg = configFacts(ctx);
    const rows = K.windowRows(ctx, h, [gm, gp, gi, 'disk.latency_ms', 'disk.queue']);
    const cfgPct = cfg.available && ram ? cfg.configuredMB / ram * 100 : 0;
    const memEval = !!ram && rows.some((x) => x[gp] !== null);
    const ioEval = rows.some((x) => x['disk.latency_ms'] !== null && x['disk.queue'] !== null && x[gi] !== null);
    if (!memEval && !ioEval) return K.nullResult(tM, `${ctx.missing(!ram || rows.every((x) => x[gp] === null) ? gm : 'disk.latency_ms')}; the database group's memory and I/O could not be evaluated`);
    const memS = memEval ? ctx.sustained(rows, (x) => x[gp] !== null && x[gp] + cfgPct >= tM.value) : null;
    const ioS = ioEval ? ctx.sustained(rows, (x) => x['disk.latency_ms'] !== null && x['disk.latency_ms'] >= tL.value && x['disk.queue'] !== null && x['disk.queue'] >= tQ.value && x[gi] !== null && x[gi] >= tI.value) : null;
    const confounds = [{ id: 'config-unavailable', text: 'database configuration facts were not collected; the memory variant uses group memory alone', active: false }];
    if (cfg.available) confounds[0] = { id: 'config-overlaps-resident', text: 'configured buffers may overlap memory the group already holds resident', active: true };
    const extra = { group, variants: { memory: memS ? { n: memS.count, fired: memS.sustained } : 'not evaluated', io: ioS ? { n: ioS.count, fired: ioS.sustained } : 'not evaluated (disk latency, queue or group I/O not recorded)' },
      config: cfg.available ? { configuredMB: Math.round(cfg.configuredMB), ...cfg.parts, source: 'database settings' } : null,
      missingInputs: cfg.available ? [] : cfg.missing };
    if (ioS && ioS.sustained) {
      return { fired: true, reason: null, class: 'disk', inputs: K.inputsOf(ctx, ioS.hit.map((x) => x.q), ['disk.latency_ms', 'disk.queue', gi]), threshold: tL, n: ioS.count,
        calmSignal: 'disk.latency_ms', hangValue: K.T.mean(ioS.hit.map((x) => x['disk.latency_ms'])), effThreshold: tL.value, direction: 'higher', confounds, extra: { ...extra, variant: 'io' } };
    }
    if (memS && memS.sustained) {
      return { fired: true, reason: null, class: 'memory', inputs: K.inputsOf(ctx, memS.hit.map((x) => x.q), [gm, gp]), threshold: tM, n: memS.count,
        calmSignal: gp, hangValue: K.T.mean(memS.hit.map((x) => x[gp])), effThreshold: Math.max(1, tM.value - cfgPct), direction: 'higher', confounds, extra: { ...extra, variant: 'memory' } };
    }
    const bits = [];
    if (memS) bits.push(`memory variant not sustained (${memS.text}; group + configured >= ${tM.value}% of RAM)`);
    if (ioS) bits.push(`I/O variant not sustained (${ioS.text}; latency >= ${tL.value} ms with queue >= ${tQ.value} and group I/O)`);
    return { fired: false, reason: bits.join('; '), inputs: [], threshold: tM, n: 0, confounds, extra };
  },
  disprove(ctx) {
    const tL = K.th(ctx, ID, 'disproveLatencyMs'), tM = K.th(ctx, ID, 'disproveMemPctRam');
    const check = `disk latency < ${tL.value} ms and database group memory < ${tM.value}% of RAM within +-10 s of every hang`;
    const hs = ctx.hangs.map((q) => {
      const g = dbGroupAt(ctx, q) || ctx.near(q, K.WINDOW_S).map((x) => dbGroupAt(ctx, x)).find(Boolean) || null;
      if (!g) return null;
      const rows = K.windowRows(ctx, q, ['disk.latency_ms', `proc.group_mem_pct_ram[${g}]`]);
      const lat = rows.map((x) => x['disk.latency_ms']).filter(K.finite), mem = rows.map((x) => x[`proc.group_mem_pct_ram[${g}]`]).filter(K.finite);
      return lat.length && mem.length ? { q, group: g, maxLatencyMs: Math.max(...lat), maxMemPctRam: Math.max(...mem) } : null;
    }).filter(Boolean);
    if (!hs.length) return { check, result: 'not-evaluable', values: [] };
    return { check, result: hs.every((x) => x.maxLatencyMs < tL.value && x.maxMemPctRam < tM.value) ? 'disproved' : 'not-disproved', values: hs.map((x) => ({ ref: x.q.ref, group: x.group, maxLatencyMs: x.maxLatencyMs, maxMemPctRam: x.maxMemPctRam })) };
  },
  describe(ctx, fired) {
    const f = fired[0];
    return f && f.extra ? `${f.extra.variant === 'io' ? 'disk I/O' : 'memory'} of in-scope database group ${f.extra.group}` : null;
  },
};
