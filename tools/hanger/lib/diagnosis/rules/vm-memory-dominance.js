'use strict';
// Virtual machine memory dominance (Docker Desktop / WSL2 / Hyper-V): the VM host process group holds at least 40% of
// installed RAM on at least 3 usable probes within +-10 s of the hang AND the configured VM memory cap is absent or
// above 50% of RAM. The cap (or its absence) is part of the result. A cap of 50% of RAM or less disproves the rule.
const K = require('./_kit');

const ID = 'vm-memory-dominance';
const NO_CAP = /no cap configured/i;

// run-level: the configured cap as the workload collector recorded it
function capState(ctx) {
  return K.runLevel(ctx, `${ID}:cap`, () => {
    const ram = ctx.env.totalMB;
    const c = ctx.report.workload && ctx.report.workload.vm && ctx.report.workload.vm.configuredCapMB;
    if (!c) return { state: 'unknown', reason: 'the workload collector recorded no VM configuration', valueMB: null, pctRam: null };
    if (K.finite(c.value)) return { state: 'configured', valueMB: c.value, pctRam: ram ? Math.round(c.value / ram * 1000) / 10 : null, reason: null };
    if (NO_CAP.test(String(c.unavailableReason || ''))) return { state: 'absent', valueMB: null, pctRam: null, reason: c.unavailableReason };
    return { state: 'unknown', valueMB: null, pctRam: null, reason: c.unavailableReason || 'VM configuration unavailable' };
  });
}

module.exports = {
  id: ID,
  class: 'memory',
  phrase: 'virtual machine memory',
  valueLabel: 'VM host memory',
  evaluate(ctx, h) {
    const tV = K.th(ctx, ID, 'vmPctRam'), tC = K.th(ctx, ID, 'capPctRam');
    if (!ctx.env.totalMB) return K.nullResult(tV, 'installed RAM not recorded (machine.totalGB)');
    if (ctx.sig(h, 'proc.vm_host_pct_ram') === null) return K.nullResult(tV, ctx.missing('proc.vm_host_mb'));
    const rows = K.windowRows(ctx, h, ['proc.vm_host_pct_ram', 'proc.vm_host_mb']);
    if (!rows.some((x) => x['proc.vm_host_mb'] > 0)) return { fired: false, reason: 'no virtualization host process group is present in the process data (missing input: VM host group)', inputs: [], threshold: tV, n: 0, extra: { missingInput: 'virtualization host process group' } };
    const cap = capState(ctx);
    const s = ctx.sustained(rows, (x) => x['proc.vm_host_pct_ram'] !== null && x['proc.vm_host_pct_ram'] >= tV.value);
    const extra = { cap: { state: cap.state, valueMB: cap.valueMB, pctOfRam: cap.pctRam, text: cap.state === 'configured' ? `cap: ${cap.valueMB} MB` : cap.state === 'absent' ? 'cap: absent' : `cap: unknown (${cap.reason})`, source: 'user VM config' }, installedRamMB: Math.round(ctx.env.totalMB) };
    const base = { threshold: tV, calmSignal: 'proc.vm_host_pct_ram', effThreshold: tV.value, direction: 'higher', extra,
      confounds: [{ id: 'guest-page-cache', text: 'the VM host process counts the guest page cache as host memory', active: false }] };
    const inputs = K.inputsOf(ctx, s.hit.map((x) => x.q), ['proc.vm_host_mb', 'proc.vm_host_pct_ram']);
    if (!s.sustained) return { ...base, fired: false, reason: `not sustained (${s.text}; VM host memory >= ${tV.value}% of RAM)`, inputs, n: s.count };
    if (cap.state === 'unknown') return { ...base, fired: null, reason: `configured VM memory cap not known: ${cap.reason}`, inputs, n: s.count };
    if (cap.state === 'configured' && !(cap.pctRam > tC.value)) return { ...base, fired: false, reason: `a VM memory cap of ${cap.valueMB} MB (${cap.pctRam}% of RAM) is configured, at most ${tC.value}% of RAM`, inputs, n: s.count };
    return { ...base, fired: true, reason: null, inputs, n: s.count, hangValue: K.T.mean(s.hit.map((x) => x['proc.vm_host_pct_ram'])) };
  },
  disprove(ctx) {
    const tC = K.th(ctx, ID, 'capPctRam'), tD = K.th(ctx, ID, 'disproveVmPctRam');
    const check = `the configured VM memory cap is at most ${tC.value}% of RAM, or VM host memory < ${tD.value}% of RAM at 2/3 or more of the hangs`;
    const cap = capState(ctx);
    const hs = ctx.hangs.map((q) => ({ q, v: ctx.sig(q, 'proc.vm_host_pct_ram') })).filter((x) => x.v !== null);
    const values = [];
    if (cap.state === 'configured') values.push({ capMB: cap.valueMB, capPctOfRam: cap.pctRam });
    for (const x of hs) values.push({ ref: x.q.ref, vmHostPctRam: x.v });
    if (cap.state === 'configured' && cap.pctRam !== null && cap.pctRam <= tC.value) return { check, result: 'disproved', values };
    if (!hs.length) return { check, result: 'not-evaluable', values };
    return { check, result: K.twoThirds(hs, (x) => x.v < tD.value) ? 'disproved' : 'not-disproved', values };
  },
  describe(ctx, fired) {
    const f = fired[0];
    return f && f.extra ? `${f.extra.cap.text}; installed RAM ${Math.round(f.extra.installedRamMB / 102.4) / 10} GB` : null;
  },
};
