'use strict';
// Workload session: phases, lifecycle markers, container and VM visibility, latency probes and configuration
// facts, wired to the sampler through its registry and heavy runner. The sampler core is not edited: every
// poll is an on-trigger collector with its own budget, and every record is appended to the run stream as
// it is measured (wl-* record types), so an interrupted run keeps what it saw.
const { R, unresponsive } = require('./reasons');
const { createPhases } = require('./phases');
const { createMarkerTracker } = require('./markers');
const containersLib = require('./containers');
const vmLib = require('./vm');
const probesLib = require('./probes');
const configLib = require('./config');
const reportLib = require('./report');

const CONTAINER_BUDGET_MS = 3500, CONTAINER_CALL_MS = 3000;
const VM_BUDGET_MS = 4000, VM_CALL_MS = 3000;
const CONFIG_BUDGET_MS = 9000;

// collectors are declared through the registry (never by editing the sampler); the scheduling is below
function registerCollectors(registry) {
  const def = (d) => registry.registerCollector({ tier: 'on-trigger', triggers: ['schedule'], unit: 'multi', source: { kind: 'oneshot' }, scopeAware: true, ...d });
  def({ id: 'workloadContainers', inference: 'container.state', budgetMs: CONTAINER_BUDGET_MS, scheduleS: 10 });
  def({ id: 'workloadVm', inference: 'container.vm', budgetMs: VM_BUDGET_MS, scheduleS: 60 });
  registry.registerCollector({ id: 'workloadConfig', inference: 'workload.config', tier: 'once', budgetMs: CONFIG_BUDGET_MS, unit: 'multi', source: { kind: 'oneshot' }, scopeAware: true });
  // probes run on their own per-probe timers (declared in the scope file); each attempt has its own timeout
  def({ id: 'workloadProbe', inference: 'workload.latency', budgetMs: 60000, scheduleS: 5 });
}

function createWorkload({
  ext = { phases: [], probes: [], config: [] }, scoped = true, resolver, exec, heavy, sink, fail = () => {},
  now = Date.now, elevated = false, phaseFlag = [], phaseNow = false, readConfiguredCap = null,
  setTimer = setTimeout, clearTimer = clearTimeout, intervals = {},
} = {}) {
  const every = { containers: 10, vm: 60, ...intervals }; // VM poll: wsl listing is ~30 ms CPU, so 60 s keeps it near 0.05% of one logical CPU
  const labels = phaseFlag.length ? phaseFlag : ext.phases;
  const phases = createPhases({ labels, labelSource: phaseFlag.length ? 'flag' : 'scope-file', now, sink });
  const tracker = createMarkerTracker({ resolver, now: () => new Date(now()), sink, includeProcesses: scoped });
  const inScope = containersLib.makeInScope(resolver);
  const timers = new Set();
  let stopped = false, probeRun = null;
  const lastReason = {};

  const later = (fn, sec) => {
    if (stopped) return;
    const t = setTimer(() => { timers.delete(t); fn(); }, Math.max(0, sec * 1000));
    if (t && t.unref) t.unref();
    timers.add(t);
  };
  // unavailable is written on change of reason only: a stopped daemon is one record, not one per poll
  const noteUnavailable = (what, reason, atIso) => {
    if (lastReason[what] === reason) return;
    lastReason[what] = reason;
    sink.append('wl-unavail', { what, reason, at: atIso });
  };

  // ---- containers ----
  let contEvery = every.containers;
  async function containersTick() {
    if (stopped) return;
    let nextS = every.containers;
    try {
      const r = await heavy.run({ id: 'workloadContainers', trigger: 'schedule', budgetMs: CONTAINER_BUDGET_MS, inference: 'container.state', fn: (ctx) => containersLib.pollContainers({ exec, resolver, ctx, timeoutMs: CONTAINER_CALL_MS, now }) });
      const atIso = new Date(now()).toISOString();
      if (r.outcome !== 'ok' || !r.value) {
        noteUnavailable('containers', unresponsive(CONTAINER_BUDGET_MS), atIso);
        nextS = containersLib.nextInterval({ baseS: every.containers, currentS: contEvery, outcome: 'timeout' });
      } else if (!r.value.ok) {
        const reason = r.value.reason;
        noteUnavailable('containers', reason, r.value.atIso);
        if (reason.startsWith('unresponsive')) nextS = containersLib.nextInterval({ baseS: every.containers, currentS: contEvery, outcome: 'timeout' });
        else nextS = reason === R.NOT_INSTALLED ? 300 : reason === R.NOT_RUNNING ? 30 : 60;
      } else {
        lastReason.containers = null;
        const v = r.value;
        tracker.observeContainers(v.sample.running, inScope, v.atMs);
        sink.append('wl-containers', { at: v.atIso, series: v.sample.series, outOfScope: v.sample.outOfScope, ...(v.statsReason ? { statsUnavailable: v.statsReason } : {}) });
      }
    } catch (e) {
      fail('container.state', 'workloadContainers', 'failed', `container poll failed: ${String(e && e.message || e).slice(0, 100)}`);
      nextS = 60;
    }
    contEvery = nextS;
    later(containersTick, nextS);
  }

  // ---- VM host memory, configured cap, guest memory ----
  async function vmTick() {
    if (stopped) return;
    try {
      const r = await heavy.run({
        id: 'workloadVm', trigger: 'schedule', budgetMs: VM_BUDGET_MS, inference: 'container.vm',
        fn: async (ctx) => {
          const v = await vmLib.pollVm({ exec, resolver, ctx, timeoutMs: VM_CALL_MS });
          let host = { value: null, unavailableReason: v.ok ? R.VM_STOPPED : v.reason };
          if (v.ok && v.runningCount > 0) {
            const t = await exec('tasklist', ['/FI', 'IMAGENAME eq vmmem*', '/FO', 'CSV', '/NH'], { timeoutMs: VM_CALL_MS, tier: 'onTrigger', ctx });
            host = t.code === 0 && !t.timedOut ? vmLib.hostMemFromRows(vmLib.parseVmHostRows(t.stdout)) : { value: null, unavailableReason: R.FAILED };
          }
          return { v, host };
        },
      });
      const atIso = new Date(now()).toISOString();
      if (r.outcome !== 'ok' || !r.value) sink.append('wl-vm', { at: atIso, hostMemMB: null, hostReason: unresponsive(VM_BUDGET_MS), guestMem: { value: null, unavailableReason: unresponsive(VM_BUDGET_MS) } });
      else {
        const { v, host } = r.value;
        sink.append('wl-vm', { at: atIso, hostMemMB: host.value, ...(host.value === null ? { hostReason: host.unavailableReason } : {}), guestMem: v.guestMem, ...(v.ok ? { distros: v.distros, running: v.runningCount } : {}) });
      }
    } catch (e) { fail('container.vm', 'workloadVm', 'failed', `VM poll failed: ${String(e && e.message || e).slice(0, 100)}`); }
    later(vmTick, every.vm);
  }

  // ---- configuration facts (once) ----
  async function collectConfig() {
    const cap = (readConfiguredCap || vmLib.readConfiguredCap)();
    sink.append('wl-vmcap', { at: new Date(now()).toISOString(), cap });
    if (!ext.config.length) return;
    const r = await heavy.run({ id: 'workloadConfig', trigger: 'schedule', budgetMs: CONFIG_BUDGET_MS, inference: 'workload.config', fn: (ctx) => configLib.collectConfigFacts({ entries: ext.config, exec, resolver, ctx, readConfiguredCap }) });
    const atIso = new Date(now()).toISOString();
    const facts = r.outcome === 'ok' && Array.isArray(r.value) ? r.value : ext.config.flatMap((c) => (c.kind === 'postgres' ? configLib.PG_SETTINGS.map((n) => ({ kind: 'postgres', fact: n, value: null, source: 'database settings', unavailableReason: unresponsive(CONFIG_BUDGET_MS) })) : []));
    sink.append('wl-config', { at: atIso, facts });
  }

  return {
    phases,
    markers: tracker,
    start() {
      if (phaseNow) phases.startAtRun(now());
      // measurement hook: HANGER_TEST_NO_WORKLOAD=1 skips every poll, probe and config read (used to measure the added cost)
      if (process.env.HANGER_TEST_NO_WORKLOAD === '1') return;
      probeRun = probesLib.startProbes({ probes: ext.probes, exec, sink, elevated, now, setTimer, clearTimer, onEvent: (e) => { if (e.kind === 'refused') sink.append('wl-probe-refused', { at: new Date(now()).toISOString(), reason: e.reason }); } });
      collectConfig().catch((e) => fail('workload.config', 'workloadConfig', 'failed', `config facts failed: ${String(e && e.message || e).slice(0, 100)}`));
      later(containersTick, 0);
      later(vmTick, 1);
    },
    // process rows from the periodic in-scope snapshot (pid, name); out-of-scope rows are dropped inside
    observeProcesses(rows, atMs) { return tracker.observeProcesses(rows, atMs); },
    onPhaseKey(atMs) { return phases.toggle(atMs); },
    stop() {
      stopped = true;
      for (const t of timers) clearTimer(t);
      timers.clear();
      if (probeRun) probeRun.stop();
    },
    get probeState() { return probeRun ? probeRun.state : {}; },
    declaration() { return { phases: ext.phases, probes: ext.probes.map((p) => p.name), config: ext.config.map((c) => c.kind), phaseLabels: labels }; },
  };
}

module.exports = { createWorkload, registerCollectors, buildWorkloadReport: reportLib.buildWorkloadReport, summaryLines: reportLib.summaryLines };
