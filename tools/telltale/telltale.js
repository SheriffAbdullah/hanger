#!/usr/bin/env node
// telltale v0.4 — registry-driven (METRIC_REGISTRY.md): 2s probe bundle, on-HANG snapshots, user marks
// Usage: node diag.js --duration 30 --out ./reports [--anonymize]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync, spawn } = require('child_process');
const crypto = require('crypto');
const { num, pct, parseTasklist, rollup } = require('./lib/numbers');
const { scrubString, scrubValue } = require('./lib/anonymize');
const { writeJsonChecked } = require('./lib/serialize');
const settingsLib = require('./lib/settings');
const selfLib = require('./lib/self');
const persist = require('./lib/persist');
const { buildCoreReport } = require('./lib/core-report');
const eventsLib = require('./lib/events');
const reportsIo = require('./lib/reports-io');
const packCalc = require('./lib/pack-calc');
const diagnosisEngine = require('./lib/diagnosis/engine');
const ruleParams = require('./lib/diagnosis/rule-params');
const notResponding = require('./lib/diagnosis/notresponding');
const renderPipeline = require('./lib/render');
const sysProfile = require('./lib/system-profile');
const scopeLib = require('./lib/scope');
const { createRegistry } = require('./lib/sampler/registry');
const { createContinuous, createHeavyRunner, resolveDuration, MAX_DURATION_S } = require('./lib/sampler/scheduler');
const { createObserver } = require('./lib/sampler/observer');
const { createExec } = require('./lib/sampler/exec');
const { createFailureLog } = require('./lib/sampler/failures');
const { startKeyCapture } = require('./lib/sampler/keycap');
const { startInputHelper } = require('./lib/sampler/input-helper');
const { runHangTrigger } = require('./lib/sampler/hang-trigger');
const sessionLib = require('./lib/sampler/session');
const { parseBundleLines, META: BUNDLE_META } = require('./lib/sampler/bundle');
const { rec: mkRec, plain } = require('./lib/sampler/record');
const sRecords = require('./lib/sampler/records');
const signalsLib = require('./lib/collectors');
const powerLib = require('./lib/collectors/power');
const gpuSignals = require('./lib/collectors/gpu');
const workloadLib = require('./lib/workload');
const { reasonFromExec: platformReason } = require('./lib/workload/reasons');

const args = process.argv.slice(2);
const _cfgIdx = args.indexOf('--config');
let CFG = {};
try {
  const cfgPath = (_cfgIdx >= 0 && args[_cfgIdx + 1]) ? args[_cfgIdx + 1] : path.join(process.cwd(), 'telltale.config.json');
  if (fs.existsSync(cfgPath)) CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) { console.log(`[telltale] config unreadable, ignoring: ${e.message.slice(0, 100)}`); }
const getArg = (k, d) => {
  const r = settingsLib.lookup(args, CFG, k);
  return r.value !== undefined ? r.value : d;
};
const hasFlag = (k) => args.includes(k) || CFG[k.replace(/^--/, '')] === true || CFG[k.replace(/^--/, '')] === 'true';
const MODE = args[0] && !args[0].startsWith('--') ? args[0] : 'trace'; // watch | trace | trend | check-stub | record | pack | recover
const RECORD_DEFAULTS = {};
if (MODE === 'record') {
  // one-click defaults applied BEFORE any const reads args (flag > config > record-default)
  if (!args.includes('--duration') && CFG.duration === undefined) { args.push('--duration', '60'); RECORD_DEFAULTS.duration = true; }
}
// v14 effective duration/interval: flag > config > default, any clamp recorded (never silent).
const _early = settingsLib.buildSettings({ argv: args, cfg: CFG, anonymize: false, recordDefaults: RECORD_DEFAULTS });
const DURATION = _early.duration.value;
// v10: 60s default applies ONLY when neither --duration flag nor config duration is set.
const DURATION_SRC = args.includes('--duration') ? 'flag' : (CFG.duration !== undefined ? 'config' : 'default-60s');
const INTERVAL = _early.interval.value;
// v0.6 capability tiers: admin signals collected when elevatable, graceful skip otherwise.
// Detected inside main() (not at require time) so the module can be required by tests.
function detectTier() {
  const r = ps('[bool]([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))', 15000);
  return r.stdout.trim() === 'True' ? 'admin' : 'user';
}
let TIER = 'user';
// v1x CLI look: pure-ASCII banner + sparkline + STATE card (OEM code pages mangle Unicode)
function banner() {
  console.log(`
 _____ _____ _     _     _____ _____ _     _____
|_   _| ____| |   | |   |_   _|  _  | |   |  ___|
  | | |  _| | |   | |     | | | |_| | |   | |__
  | | | |___| |___| |___  | | | |_| | |___| |__
  |_| |_____|_____|_____| |_| |_____|_____|____|
  hang-evidence surface * numbers + ranked candidate causes * never verdicts`);
}
const SPARKS = [' ', '.', ':', '-', '=', '+', '*', '#'];
function sparkline(samples, hangs = [], width = 56) {
  if (!samples.length) return '(no samples)';
  const bucket = Math.max(1, Math.floor(samples.length / width));
  const hangAt = new Set(hangs.map((h) => Math.floor(h.tSec)));
  let out = '';
  for (let i = 0; i < samples.length; i += bucket) {
    const seg = samples.slice(i, i + bucket);
    const avg = seg.reduce((a, s) => a + s.usedPct, 0) / seg.length;
    const isHang = seg.some((s) => hangAt.has(Math.floor(s.tSec)));
    out += isHang ? '!' : SPARKS[Math.min(7, Math.max(0, Math.floor((avg - 50) / 6)))];
  }
  return out;
}
function findingCard({ finding, rollup, hwConfigSignal, culprits, power, powerScheme, hangEvents, calmShare, base }) {
  const line = (s) => `  ${(s || '').slice(0, 76)}`;
  const bar = '+' + '-'.repeat(73) + '+';
  const wrap = (t, w = 69) => { const out = []; let cur = ''; for (const word of String(t || '').split(' ')) { if ((cur + ' ' + word).trim().length > w) { out.push(cur); cur = word; } else cur = (cur + ' ' + word).trim(); } if (cur) out.push(cur); return out; };
  console.log(`\n${bar}`);
  console.log(`| ${('Finding: ' + finding.class).slice(0, 71).padEnd(71)}|`);
  console.log(`|${'-'.repeat(73)}|`);
  for (const l of wrap(finding.sentence).slice(0, 5)) console.log(`| ${l.padEnd(71)}|`);
  console.log(`| ${(`strength: ${finding.strength} - scope: ${finding.scope}`).slice(0, 71).padEnd(71)}|`);
  const cf = finding.confirmations || {};
  console.log(`| ${(`confirmations: user mark ${cf['user-mark'] || 0}, OS not-responding ${cf['os-not-responding'] || 0}, workload probe ${cf['workload-probe'] || 0}, input-response check ${cf['input-stall'] || 0}, probe-only ${cf['probe-only'] || 0}`).slice(0, 71).padEnd(71)}|`);
  for (const r of (rollup || []).slice(0, 3)) console.log(`| - ${(`${r.hangs} of ${r.of} hangs: ${r.id} (confidence ${r.confidence})`).slice(0, 69).padEnd(69)}|`);
  if (hwConfigSignal) console.log(`| ${(`hardware-vs-configuration signal: ${hwConfigSignal.value}`).slice(0, 71).padEnd(71)}|`);
  console.log(`|- top ${'-'.repeat(67)}|`);
  for (const c of culprits.slice(0, 3)) console.log(line(`${c.detail || c.friendly || c.name} - ${c.totalMB}MB`));
  console.log(`|- power ${'-'.repeat(65)}|`);
  console.log(line(`${power.plugged === null ? 'plug unknown' : power.plugged ? 'PLUGGED IN' : 'ON BATTERY'} - ${String(powerScheme).split('\n')[0].slice(0, 50)}`));
  console.log(`|${'-'.repeat(73)}|`);
  console.log(line(`${hangEvents.length} HANGs - calm ${calmShare}% - full pack: ${base}.md`));
  console.log(`${bar}`);
}
// Collector registry (lib/sampler/registry.js). Tiers: continuous (one shared counter session, never a per-tick
// launch) | probe (the hang probe, the one allowed per-tick launch) | on-trigger (hang/schedule/end, each within
// its budget) | once. There is no global load gate: a collector is skipped only by its OWN budget and interval.
const REG = createRegistry();
const BUNDLE_PATHS = [
  '\\Memory\\% Committed Bytes In Use', '\\Memory\\Available MBytes', '\\Memory\\Pages/sec', '\\Memory\\Page Faults/sec',
  '\\Memory\\Transition Faults/sec', '\\System\\Processor Queue Length', '\\Processor(_Total)\\% Processor Time',
  '\\System\\Context Switches/sec', '\\PhysicalDisk(_Total)\\Current Disk Queue Length', '\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer',
  '\\Processor(_Total)\\% DPC Time', '\\Processor(_Total)\\% Interrupt Time',
  '\\Processor Information(_Total)\\% of Maximum Frequency', '\\Memory\\Pages Input/sec', '\\Paging File(_Total)\\% Usage',
  '\\Memory\\Pool Nonpaged Bytes', '\\Memory\\Modified Page List Bytes',
  // GPU total, security-software CPU and every new signal family are collectors in lib/collectors (data-signals-completeness)
];
const ON = (id, inference, budgetMs, triggers, extra = {}) => REG.registerCollector({ id, inference, tier: 'on-trigger', triggers, budgetMs, unit: 'ms', source: { kind: 'oneshot' }, ...extra });
const ONCE = (id, inference, budgetMs, extra = {}) => REG.registerCollector({ id, inference, tier: 'once', budgetMs, unit: 'ms', source: { kind: 'oneshot' }, ...extra });
REG.registerCollector({ id: 'spawnProbe', inference: 'hang.events', tier: 'probe', unit: 'ms', source: { kind: 'hang-probe' }, scheduleS: 2 });
REG.registerCollector({ id: 'counterBundle', inference: 'mem.committed_pct', tier: 'continuous', unit: 'multi', source: { kind: 'counter-session', paths: BUNDLE_PATHS } });
REG.registerCollector({ id: 'powerSample', inference: 'power.on_wall_power', tier: 'continuous', unit: 'multi', source: { kind: 'counter-session', paths: [] } });
signalsLib.registerAll(REG); // per-process CPU/I/O, thermal, turbo-aware throttle, commit, disk, network, GPU, handles (lib/collectors)
ON('tasklistSnap', 'proc.top_hoarders', 4000, ['hang', 'end']);
ON('lightSnap', 'proc.top_hoarders', 3000, ['hang']);
ON('midTasklist', 'proc.top_hoarders', 4000, ['schedule'], { scheduleS: 60, minIntervalS: 60 });
ON('respondPoll', 'hang.os_confirmed', 5000, ['hang']);
ON('gpuEngines', 'gpu.util_per_proc', 8000, ['hang', 'end'], { minIntervalS: 20 });
ON('gpuMem', 'gpu.vram_per_proc', 8000, ['hang', 'end'], { minIntervalS: 20 });
ONCE('filedesc', 'proc.identity_unresolved', 20000);
ONCE('werCounts', 'sys.os_events', 30000);
ONCE('winEvents', 'sys.os_events', 20000);
ONCE('dockerState', 'container.state', 10000);
ONCE('assetBlock', 'sys.asset', 25000);
ONCE('adminSnap', 'sys.admin_signals', 20000, { adminOnly: true });
ONCE('wprCapture', 'hang.events', 60000, { adminOnly: true });
workloadLib.registerCollectors(REG); // workload session: container / VM polls, config facts, latency probes (lib/workload)
// legacy {id: {weight, budgetMs, policy, inference, tier}} view for check-stub and --help
const COLLECTORS = REG.legacyView();

// the tool's own cost, the one spawn wrapper, and the failure log (one shape on every path)
const OBS_LAST = { sessionCpuS: null, sessionPrivMB: null, nodePrivMB: null, sessionPid: null, helperPid: null, helperCpuS: null, helperPrivMB: null, helperLimits: null };
const OBSERVER = createObserver({
  logicalCpus: os.cpus().length, print: (l) => console.log(l), pidSource: () => selfLib.listSelfPids(),
  readSources: () => {
    const cu = process.cpuUsage();
    const out = [{ pid: process.pid, role: 'main', cpuS: (cu.user + cu.system) / 1e6, privateMB: OBS_LAST.nodePrivMB !== null ? OBS_LAST.nodePrivMB : process.memoryUsage().rss / 1048576 }];
    if (OBS_LAST.sessionCpuS !== null) out.push({ pid: OBS_LAST.sessionPid, role: 'session', cpuS: OBS_LAST.sessionCpuS, privateMB: OBS_LAST.sessionPrivMB });
    if (OBS_LAST.helperCpuS !== null) out.push({ pid: OBS_LAST.helperPid, role: 'input-helper', cpuS: OBS_LAST.helperCpuS, privateMB: OBS_LAST.helperPrivMB, limits: OBS_LAST.helperLimits });
    return out;
  },
});
const EXEC = createExec({ observer: OBSERVER, registerPid: selfLib.registerPid });
const HEAVY = createHeavyRunner({ onRecord: (r) => streamAppend('heavy', r), onFailure: (f) => fail(f.inference, f.collector, f.mode, f.reason, { at: f.at }) });
const FAILLOG = createFailureLog({ onRecord: (r) => streamAppend('failure', r) });
// v0.7 cannot-observe evidence: every skip/failure lands here with the same schema {inference, collector, mode, reason, at}
const FAILURES = FAILLOG.list;
let STREAM = null; // append-only run stream (trace); failures are persisted as they occur
function fail(inference, collector, mode, reason, extra) { return FAILLOG.fail(inference, collector, mode, reason, extra); }
// measurement-only records carry no process or host names, so they skip the scope guard and the identity scrub
// (the walk costs more CPU than the measurement itself); everything else is guarded and scrubbed before it is written
const MEASUREMENT_ONLY = new Set(['csample', 'sample', 'gap']);
function streamAppend(type, rec) {
  if (!STREAM) return;
  if (MEASUREMENT_ONLY.has(type)) { STREAM.append(type, rec); return; }
  const g = RESOLVER.guard(rec);
  STREAM.append(type, ANON ? scrubValue(g, SCRUB_CTX) : g);
}
// a name prints only when it is in scope or in the system set
const nmSafe = (n) => (RESOLVER.classifyName(n) === 'out' ? scopeLib.OUT_TOKEN : n);
function checkStub() {
  const stub = JSON.parse(fs.readFileSync(path.join(__dirname, 'mac-stub.json'), 'utf8'));
  const strict = hasFlag('--strict');
  if (strict) {
    const orphans = stub.inferences.filter((e) => !COLLECTORS[e.collectorId]);
    if (orphans.length) { console.log(`STRICT FAIL: orphan stub entries: ${orphans.map((o) => o.inference).join(', ')}`); process.exitCode = 1; return; }
    console.log(`strict: all ${stub.inferences.length} stub entries map to COLLECTORS rows`);
  }
  const res = [];
  const ok = (inference, green, detail) => { res.push({ inference, green, detail }); console.log(`  ${green ? 'GREEN' : 'RED  '} ${inference}${detail ? ` - ${detail}` : ''}`); };
  const pw = powerState();
  ok('power.on_wall_power', pw.plugged !== null, pw.plugged === null ? 'plug state unknown' : pw.plugged ? 'PLUGGED IN' : 'ON BATTERY');
  ok('power.battery_pct', pw.hasBattery === false || pw.batteryPct !== null, pw.hasBattery === false ? 'the platform reports no system battery' : pw.batteryPct === null ? 'battery percentage not reported by the platform' : `${pw.batteryPct}%`);
  const b = probeBundle();
  // new signal families: one real read through the same counter session the trace uses
  const sg = signalsOneShot();
  const sv = (x) => (x && x.v !== undefined ? x.v : x);
  const sgOk = (inference, green, detail) => ok(inference, !!sg && green, sg ? detail : 'counter session produced no sample');
  sgOk('power.throttled', sg && sv(sg.cpu.perfPct) !== null, sg ? `perf ${sv(sg.cpu.perfPct)}% of base, limit ${sv(sg.cpu.perfLimitPct)}%, legacy maxFreq ${b.maxFreq == null ? 'n/a' : b.maxFreq + '%'}, reasons ${sg.cpu.throttleReasons === null ? 'not exposed' : sg.cpu.throttleReasons.length ? sg.cpu.throttleReasons.join(',') : 'none'}` : '');
  sgOk('thermal.temperature', sg && !!sg.thermal.zones, sg ? (sg.thermal.zones ? `${sg.thermal.zones.length} zones, hottest ${Math.max(...sg.thermal.zones.map((z) => z.c))} C, ${sg.thermal.droppedImplausible} implausible dropped` : `null (${sg.thermal.zonesReason})`) : '');
  sgOk('mem.commit', sg && sv(sg.mem.committedBytes) !== null, sg ? `${sv(sg.mem.committedBytes)} of ${sv(sg.mem.commitLimitBytes)} bytes (${sv(sg.mem.committedPct)}%), pages in ${sv(sg.mem.pagesInPerS)}/s out ${sv(sg.mem.pagesOutPerS)}/s` : '');
  sgOk('disk.latency', sg && sv(sg.disk.latencyMs) !== null, sg ? `${sv(sg.disk.latencyMs)} ms, busy ${sv(sg.disk.busyPct)}%, queue ${sv(sg.disk.queue)}` : '');
  sgOk('net.aggregate', sg && !!sg.net && !!sg.net.adapters, sg && sg.net ? (sg.net.adapters ? `${sg.net.adapters.length} adapters, VPN ${sg.net.adapters.some((a) => a.isVpn) ? 'present' : 'absent'}` : `null (${sg.net.reason})`) : '');
  sgOk('gpu.util_total', sg && !!sg.gpu && sv(sg.gpu.totalUtilPct) !== null, sg && sg.gpu ? `${sv(sg.gpu.totalUtilPct)}% (derived), VRAM ${sv(sg.gpu.vramUsedMB)} MB` : '');
  sgOk('sys.handles', sg && sv(sg.sys.handleCount) !== null, sg ? `${sv(sg.sys.handleCount)} handles` : '');
  sgOk('proc.cpu_io', sg && !!sg.procs && !!sg.procs.groups, sg && sg.procs ? (sg.procs.groups ? `${sg.procs.groups.length} in-scope groups, ${sg.procs.system.length} system members, out of scope: ${sg.procs.outOfScope.groupCount} groups ${sg.procs.outOfScope.cpuPctMachine}% CPU (no names)` : `null (${sg.procs.reason})`) : '');
  ok('mem.committed_pct', Number.isFinite(b.committed), b.committed == null ? 'unavailable' : `${b.committed.toFixed(1)}%`);
  ok('mem.pressure', Number.isFinite(b.committed), 'derives from committed');
  ok('mem.thrashing', Number.isFinite(b.pages), b.pages == null ? 'unavailable' : `${b.pages.toFixed(0)}/s`);
  ok('cpu.saturated', Number.isFinite(b.cpuQ), b.cpuQ == null ? 'unavailable' : `queue ${b.cpuQ}`);
  ok('disk.stalled', Number.isFinite(b.diskQ), b.diskQ == null ? 'unavailable' : `queue ${b.diskQ}`);
  const rows = parseTasklist(sh('tasklist /FO CSV /NH').stdout);
  const grp = rollup(rows);
  ok('proc.top_hoarders', grp.length > 0 && grp[0].totalMB > 0, grp.length ? `${nmSafe(grp[0].name)} ${grp[0].totalMB}MB` : 'empty process list');
  const fd = filedescFor(grp.slice(0, 5).map((g) => g.name).filter((n) => !KNOWN[n.toLowerCase()]));
  const unres = grp.slice(0, 5).filter((g) => friendly(g.name, fd).source === 'unresolved').length;
  ok('proc.identity_unresolved', true, `${unres} unresolved in top-5`);
  const s0 = Date.now(); sh('node -e ""', 10000);
  ok('hang.events', true, `spawn probe ${Date.now() - s0}ms (array shape holds empty or not)`);
  const nr = ps(`Get-Process -ErrorAction SilentlyContinue | Where-Object { !$_.Responding } | Select-Object -ExpandProperty Name -Unique`, 10000);
  ok('hang.os_confirmed', !nr.stderr, nr.stderr ? 'poll failed' : `${nr.stdout.split('\n').filter((s) => s.trim()).length} non-responding now`);
  const ev = ps(`Get-WinEvent -FilterHashtable @{LogName='Application'; ID=1002} -MaxEvents 1 -ErrorAction SilentlyContinue | Out-Null; 'ok'`, 15000);
  ok('sys.os_events', ev.stdout.includes('ok'), 'event log queried');
  const dk = sh('docker ps --format "{{.Names}}"', 10000);
  ok('container.state', true, dk.code === 0 ? 'daemon present' : 'absent (recorded, not an error)');
  // v11 GPU: one combined per-PID poll (~2-3s); absent driver -> RED with reason, never zeros
  const pidName = {};
  for (const p of rows) if (!(p.pid in pidName)) pidName[p.pid] = p.name;
  const gsnap = gpuPoll();
  const topPid = (byPid, k) => Object.entries(byPid).sort((a, b) => b[1][k] - a[1][k])[0];
  if (gsnap.engines.unavailable) ok('gpu.util_per_proc', false, gsnap.engines.unavailable);
  else {
    const [pid, e] = topPid(gsnap.engines.byPid, 'pct');
    ok('gpu.util_per_proc', true, `top ${pidName[pid] ? nmSafe(pidName[pid]) : 'pid'} ${e.pct}% (n=${e.n} engines, ${Object.keys(gsnap.engines.byPid).length} PIDs, poll ${gsnap.engines.ms}ms)`);
  }
  if (gsnap.mem.unavailable) ok('gpu.vram_per_proc', false, gsnap.mem.unavailable);
  else {
    const [pid, e] = topPid(gsnap.mem.byPid, 'mb');
    ok('gpu.vram_per_proc', true, `top ${pidName[pid] ? nmSafe(pidName[pid]) : 'pid'} ${e.mb}MB (n=${e.n}, ${Object.keys(gsnap.mem.byPid).length} PIDs, poll ${gsnap.mem.ms}ms)`);
  }
  const greens = res.filter((r) => r.green).length;
  console.log(`[check-stub] ${greens}/${res.length} green on ${os.platform()} (tier=${TIER})`);
  if (greens < res.length) process.exitCode = 1;
}
function printHelp() {
  console.log(`telltale - hang-evidence surface (numbers + ranked candidate causes, never verdicts)
usage: node telltale.js [inventory|watch|trace|record|trend|pack|recover|check-stub] [options]
  inventory             LOCAL-ONLY list of running software groups -> <out>/private/inventory-<stamp>.json (never shareable); --write-scope drafts telltale.scope.json (every entry disabled)
  watch                 light 2s watch log -> reports/watch/*.jsonl (reports/baseline/ still read for one release)
  trace                 deep trace (default 60s, up to 8 h): continuous counter session + hang probe; heavy work only on a hang, within budgets
  trend                 compare table over reports/telltale-*.json (date, finding class, hangs, worst, commit, pages, plug + delta vs newest)
  trend --compare A B   delta table for two report files (A-minus-B; paths or names in --out dir)
  trend --windows A,B   aggregate two tagged windows (date/tag substrings) and delta their peaks/totals
  watch --rollup weekly sustained aggregates from the watch log (reports/watch/*.jsonl) (per-day rows with n/window/cadence)
  pack [trace.json]     approval JSON + .report.html: scope declaration + system profile + sustained + hangs + finding + tier audit + power -> reports/pack-<stamp>.json (refuses private/ paths)
  recover <stream.jsonl> build a summary report from an interrupted run's stream (run.status unfinished)
  (trace appends every record to reports/telltale-<stamp>.jsonl as it is measured; a run without run-end is unfinished)
  check-stub [--strict] validate this machine against tools/telltale/mac-stub.json
  system profile (static facts for IT, each with source and tier): --serial S --warranty-date D --warranty-note T (unknowns are listed with a reason, never blank)
  time lost: measured from observed hangs (frozen seconds in the observed window); with BOTH --active-min M and --cost-rate R it also extrapolates, labelled user-supplied. --cost-min, --ram-cost, --laptop-cost are deprecated and ignored
  record              one-click trace; with no scope declared it runs inventory first and drafts telltale.scope.draft.json (open scope without a TTY)
  --no-report         write only .json and .md (default also writes .report.html with inline charts and .email.txt, a ready-to-send draft; the tool never sends anything)
  --print/--charts    deprecated: the report is written by default (--charts prints a notice)
options: --duration S (default 60, flag > config > default) --interval MS --out DIR --hang MS --commit % --min-free GB
  --pages N --queue N --disk-sec S --defender % (of the whole machine) --recovery MS --ram-high %
  --severe-commit % --severe-free GB --active-min M --cost-rate R --watch-secs N
  scope (privacy is DECLARED SCOPE, not redaction): --scope FILE (default ./telltale.scope.json) | --only a,b (exact exe names or * ? patterns; recorded as source=flag)
    --preset dev (template: node, docker, postgres, redis-server, chromium; drafts telltale.scope.json if absent) | --preset plain (open scope)
    system set (OS components, registered security products, virtualization hosts) is always monitored; software outside scope is recorded only as anonymous aggregates
    --log FILE writes this run's own resolved log (use instead of redirecting raw console output)
    --hide / --focus / --extras were REMOVED (exit 2): list what to monitor in telltale.scope.json
  --watch-trigger (watch spawns ONE detached 'trace' on the 3rd streak; --no-trigger disables)
  workload session: --phase <label[,label]> (labels for successive presses of the phase key 'p'; the key is then not a mark) | --phase-now (open a phase at run start) | scope file keys phases / probes[] / config[] (see README "Workload session")
  input-response check (automatic, on by default): a small helper process notes when input happened and how long the foreground application takes to answer a trivial liveness request; it never records what is typed or clicked, window titles, the clipboard or pointer positions, and names the foreground application only when it is in scope
    --no-input-stall turn it off | --stall-ms N stall threshold (default 250 ms; config: inputStall.{enabled,stallMs,recentInputMs,mergeGapMs,lateMs,tickMs,timeoutMs,ignoreGroups}); pack keeps the thresholds recorded in the trace
  --wpr --deep-admin --anonymize
collector registry (collector: tier weight budget -> inference); continuous = one shared counter session, probe = the hang probe (the only per-tick launch):`);
  for (const [id, c] of Object.entries(COLLECTORS))
    console.log(`  ${id}: tier=${c.tier} ${c.weight} budget=${c.budgetMs ? c.budgetMs + 'ms' : 'n/a (continuous)'} -> ${c.inference}`);
}
// v0.6 first-order thresholds: all externalized, all provisional (ideals TBD in orders-framework)
const TH = {
  hang: parseInt(getArg('--hang', '800'), 10),
  commit: parseFloat(getArg('--commit', '85')),
  minFreeGB: parseFloat(getArg('--min-free', '2.0')),
  pages: parseFloat(getArg('--pages', '500')),
  queue: parseFloat(getArg('--queue', '4')),
  diskSec: parseFloat(getArg('--disk-sec', '0.025')),
  ramHigh: parseFloat(getArg('--ram-high', '85')),
  severeCommit: parseFloat(getArg('--severe-commit', '90')),
  severeFree: parseFloat(getArg('--severe-free', '1.5')),
  defender: parseFloat(getArg('--defender', '20')),
  recovery: parseInt(getArg('--recovery', '400'), 10),
};
// v0.9 citations (threshold-citations.md): every default keeps its value, gains source+confidence.
// cited = external source; derived = computed from a cited rule; guess = heuristic, needs calibration.
const TH_SRC = {
  hang: 'NN/g response limits (0.1s instant / 1s flow-break); 800 sits under flow-break [cited]',
  commit: 'MS perf troubleshooting (>10% or 4GB free); 85 ~= complement [derived]',
  minFreeGB: 'MS >10%-free rule scaled to 8-16GB laptops [derived]',
  pages: 'no modern MS number; 500/s sustained = aggressive thrash flag, judged on windowed avg not spikes [guess]',
  queue: 'AskPerf/BizTalk sustained queue>5 bottleneck; 2/core suspect [cited-ish]',
  diskSec: 'MS SQL-IO guidance >10-15ms bottleneck; 0.025 conservative [cited]',
  defender: 'no vendor threshold; security-software CPU as a share of the whole machine (0-100; it was per-core-scaled before), alibi flag only [guess]',
  recovery: '~half HANG, above healthy spawn (~100-200ms) [guess]',
  ramHigh: 'Windows 75-85 watch bands; Apple pressure colors qualitative cross-ref [derived]',
  severeCommit: 'commit band upper edge [derived]',
  severeFree: 'SCOM-style 0.5-3GB alert practice, lower edge [derived]',
  discrimDelta: 'hang-vs-calm commit delta >=5 bands: heuristic separation floor [guess]',
  discrimBloat: 'bloat >=500MB band: single-vendor-utility footprint heuristic [guess]',
};
// Discover exact standby/modified/lifetime counter paths once (Perflib naming varies by build).
// NOTE: -ListSet returns FULL paths ("\Memory\…") — use as-is, dedupe vs hardcoded bundle list.
const HARDCODED = ['pool nonpaged bytes', 'modified page list bytes'];
let MEM_EXTRA = null;
function memExtraPaths() {
  if (MEM_EXTRA) return MEM_EXTRA;
  MEM_EXTRA = [];
  try {
    const r = ps(`(Get-Counter -ListSet Memory -ErrorAction Stop).Counter | Where-Object { $_ -match 'Standby|Long-Term Average' }`, 15000);
    for (const line of r.stdout.split('\n')) {
      const name = line.trim();
      if (!name) continue;
      const low = name.toLowerCase();
      if (HARDCODED.some((h) => low.includes(h))) continue; // already bundled explicitly
      if (MEM_EXTRA.some((e) => e.toLowerCase() === low)) continue;
      MEM_EXTRA.push(name.startsWith('\\') ? name : `\\Memory\\${name}`);
    }
  } catch {}
  return MEM_EXTRA;
}
const OUTDIR = getArg('--out', path.join(__dirname, '..', '..', 'reports'));
const ANON = hasFlag('--anonymize');

// v14 identity scrubbing context: values are scrubbed BEFORE serialization (never in JSON text)
const SCRUB_CTX = { hostname: os.hostname(), username: (() => { try { return os.userInfo().username || ''; } catch { return ''; } })() };
const anon = (s) => (ANON ? scrubString(s, SCRUB_CTX) : s);
if (ANON) {
  for (const k of ['log', 'error', 'warn']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => orig(...a.map((x) => (typeof x === 'string' ? scrubString(x, SCRUB_CTX) : x)));
  }
}

const cleanOut = (s) => (s || '').toString().replace(/\0/g, '').replace(/\r/g, '');
// Every child the tool spawns is recorded in the self PID set (self-exclusion).
function runChild(file, argv, timeout, spawnOpts = {}) {
  OBSERVER.launch('once'); // synchronous launches are start-up or end-of-run collectors, never per tick
  if (process.env.TELLTALE_TEST_FAIL_ALL) return { stdout: '', stderr: `spawn ${file} ENOENT (test: fail-all)`, code: 1, enoent: true };
  const r = spawnSync(file, argv, { timeout, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...spawnOpts });
  selfLib.registerPid(r.pid);
  if (r.error || (r.status !== 0 && r.status !== null) || r.signal) {
    return {
      stdout: cleanOut(r.stdout).slice(0, 2000),
      stderr: cleanOut(r.stderr || (r.error && r.error.message) || 'killed').slice(0, 500),
      code: r.status ?? 1, enoent: !!(r.error && r.error.code === 'ENOENT'),
    };
  }
  return { stdout: cleanOut(r.stdout).trim(), stderr: '', code: 0 };
}
function tokenize(cmd) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}
// simple commands only: run directly (no cmd.exe) so the child PID is known
function sh(cmd, timeout = 15000) {
  const t = tokenize(cmd);
  const r = runChild(t[0], t.slice(1), timeout);
  if (r.enoent) return runChild(cmd, [], timeout, { shell: true });
  return r;
}
// powershell via argv (no cmd.exe quote-stripping)
function ps(script, timeout = 20000) {
  return runChild('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], timeout);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OBS = { wsPeakMB: 0, wsSumMB: 0, snaps: 0, pids: new Set() };
// tasklist snapshot with the tool's own processes removed; their cost goes to observer
function snapTasklist(timeout = 15000) {
  const r = sh('tasklist /FO CSV /NH', timeout);
  const x = selfLib.excludeSelf(parseTasklist(r.stdout));
  OBS.wsPeakMB = Math.max(OBS.wsPeakMB, x.observer.wsMB); OBS.wsSumMB += x.observer.wsMB; OBS.snaps++;
  for (const p of x.observer.pids) OBS.pids.add(p);
  return x.rows;
}
const observerReport = () => ({
  pidCount: OBS.pids.size, wsMB: OBS.snaps ? OBS.wsPeakMB : null, wsMBAvg: OBS.snaps ? +(OBS.wsSumMB / OBS.snaps).toFixed(1) : null,
  cpuPctAvg: null, note: 'working set of the tool and its helper processes at tasklist snapshots (peak/average); CPU not measured in this release',
});

// Declared scope (lib/scope.js): ONE resolver classifies every process-identifying datum as
// in-scope / system set / out-of-scope BEFORE it is written or printed. Out-of-scope identity is held
// in memory only to decide membership; it contributes anonymous aggregates only.
let SCOPE_ERROR = null, SCOPE = null;
try { SCOPE = scopeLib.loadScope({ cfg: CFG, args, cwd: process.cwd() }); } catch (e) { SCOPE_ERROR = e; }
if (!SCOPE) SCOPE = scopeLib.loadScope({ cfg: {}, args: [], cwd: path.join(os.tmpdir(), 'telltale-no-scope-dir') });
const SCOPE_DECL = SCOPE.decl;
const MATCHER = SCOPE.matcher;
const SCOPED = SCOPE_DECL.mode === 'allowlist';
const RESOLVER = scopeLib.createResolver(MATCHER, { open: !SCOPED });
const PRESET = SCOPE.preset;
const ONLY = SCOPED ? SCOPE_DECL.entries.map((e) => (e.name !== undefined ? e.name : e.pattern)) : [];
const _scopeSrc = SCOPE_DECL.source === 'flag' ? 'flag' : SCOPE_DECL.source === 'none' ? 'default' : 'config';
const SETTINGS = settingsLib.buildSettings({ argv: args, cfg: CFG, anonymize: ANON, recordDefaults: RECORD_DEFAULTS,
  scope: { value: { mode: SCOPE_DECL.mode, source: SCOPE_DECL.source, path: SCOPE_DECL.path, only: ONLY, preset: PRESET || null }, source: _scopeSrc } });

// Console and log output pass the scope guard: a name seen out of scope is never printed.
// --log FILE writes the run's own (guarded, anonymized) log; elevated-trace.bat uses it instead of raw redirection.
const LOG_FILE = getArg('--log', '');
{
  const guardText = (x) => (typeof x === 'string' ? RESOLVER.scopeSafe(x) : x);
  for (const k of ['log', 'error', 'warn']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      const out = a.map(guardText);
      orig(...out);
      if (LOG_FILE) { try { fs.appendFileSync(LOG_FILE, out.map((x) => (typeof x === 'string' ? x : require('util').inspect(x))).join(' ') + '\n'); } catch { /* a log write failure must not stop the run */ } }
    };
  }
}
// v10 single-flight CIM cache: ONE Win32_Process snapshot per round. It carries NO command lines:
// parent id + creation time only (descendant pinning). Names live in memory just to decide membership.
let CIM_CACHE = null;
const CIM_SCRIPT = `Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object { $ct=0; if ($_.CreationDate) { $ct=$_.CreationDate.ToFileTimeUtc() }; $_.ProcessId.ToString() + '|' + $_.Name + '|' + $_.ParentProcessId.ToString() + '|' + $ct }`;
function parseCim(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\|([^|]+)\|(\d+)\|(\d+)$/);
    if (m) rows.push({ pid: +m[1], name: m[2], ppid: +m[3], ct: +m[4] });
  }
  return rows;
}
function cimSnapshot(force = false) {
  if (CIM_CACHE && !force) return CIM_CACHE;
  const r = ps(CIM_SCRIPT, 20000);
  const rows = parseCim(r.stdout);
  if (!rows.length) fail('proc.top_hoarders', 'cimSnapshot', r.stderr ? 'timeout' : 'counter-missing', (r.stderr || 'process tree query returned zero rows (denied?)').slice(0, 150));
  CIM_CACHE = rows;
  return rows;
}
async function cimSnapshotA(ctx) {
  const r = await EXEC.ps(CIM_SCRIPT, { timeoutMs: 20000, tier: 'onTrigger', ctx });
  const rows = parseCim(r.stdout);
  if (!rows.length) fail('proc.top_hoarders', 'cimSnapshot', r.timedOut ? 'timeout' : 'counter-missing', (r.stderr || 'process tree query returned zero rows (denied?)').slice(0, 150));
  return rows;
}
// Classify a raw tasklist-style snapshot [{name,pid,memMB}] through the resolver.
// Parent/creation-time info is merged in only when some scope entry opted into descendants.
function resolveSnapshot(rows, { allowTree = true, cim: cimIn } = {}) {
  let input = rows, treeUnavailable = null;
  if (MATCHER.hasDescendantEntries) {
    if (!allowTree) treeUnavailable = 'tree query skipped (collection budget)';
    else {
      // an on-trigger caller passes the rows it fetched asynchronously; sync callers (end of run) query here
      const cim = cimIn !== undefined ? (cimIn || []) : cimSnapshot(true);
      if (!cim.length) treeUnavailable = 'process tree query returned no rows';
      else {
        const byPid = new Map(cim.map((c) => [String(c.pid), c]));
        input = rows.map((r) => { const c = byPid.get(String(r.pid)); return c ? { ...r, ppid: c.ppid, ct: c.ct } : r; });
      }
    }
  }
  return RESOLVER.resolve(input, { treeUnavailable });
}
// Command lines are read ONLY for in-scope PIDs, in memory, to derive an application label. Never persisted.
function cmdlineForPids(pids) {
  const list = [...new Set(pids.map((p) => +p).filter((p) => p > 0))].slice(0, 24);
  if (!list.length) return {};
  const filt = list.map((p) => `ProcessId=${p}`).join(' or ');
  const r = ps(`Get-CimInstance Win32_Process -Filter "${filt}" -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }`, 20000);
  const out = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\|(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
// {label, rule} for a resolved group; rule table in lib/scope.js (APP_LABEL_RULES)
function labelFor(g, cmdByPid = {}, fdCache = {}) {
  const f = friendly(g.name, fdCache);
  const cmd = (g.pids || []).map((p) => cmdByPid[String(p)]).find(Boolean) || '';
  return scopeLib.deriveLabel(g.name, cmd, f.source === 'unresolved' ? g.name : f.friendly);
}
// presets: dev = template (writes a draft scope file when none exists); plain = open scope
const KNOWN = {
  'warp.exe': 'Warp terminal', 'opencode.exe': 'opencode agent (Bun runtime — serve --service vs bare differ)', 'claude.exe': 'Claude Code CLI (npm — check --resume session)',
  'node.exe': 'Node.js runtime', 'chrome-headless-shell.exe': 'Playwright Chromium (headless)',
  'chrome.exe': 'Chrome browser', 'msedge.exe': 'Edge browser', 'code.exe': 'VS Code',
  'mmpeng.exe': 'Defender Antimalware', 'msmpeng.exe': 'Defender Antimalware',
  'vmmem': 'Docker WSL2 VM (all containers)', 'docker.exe': 'Docker CLI', 'dockerd.exe': 'Docker daemon',
  'postgres.exe': 'PostgreSQL database', 'redis-server.exe': 'Redis cache',
  'br-uxendm.exe': 'HP Sure Click micro-VM (Bromium user-Xen isolation — persistent guest footprint, NOT a printer)',
  'brservice.exe': 'HP Sure Click broker service (session 0)',
  'brhostsvr.exe': 'HP Sure Click host server (isolated-app GUI)',
  'brendpointsvc.exe': 'HP Sure Click Endpoint Service (usually service-only, rarely a process)', 'bemsvc.exe': 'HP Sure Click Endpoint Service binary (NOT a support agent — do not flag bloat)',
  'explorer.exe': 'Windows Explorer', 'dwm.exe': 'Desktop compositor', 'searchindexer.exe': 'Windows Search indexer',
  'svchost.exe': 'Windows service host (group with tasklist /svc to split)',
  'secure system': 'Windows kernel secure isolate (not a process — memory accounting only)',
  'msedgewebview2.exe': 'Edge WebView2 runtime (embedded browser in apps)',
  'pwsh.exe': 'PowerShell 7 shell', 'powershell.exe': 'Windows PowerShell 5 shell',
  'widgets.exe': 'Windows Widgets board',
  'memory compression': 'Windows Memory Compression (compressed RAM store — high MB here = pressure, not a leak)',
  'onedrive.exe': 'OneDrive sync', 'spotify.exe': 'Spotify', 'slack.exe': 'Slack', 'teams.exe': 'Teams',
  'zoom.exe': 'Zoom meeting', 'obs64.exe': 'OBS recorder', 'putty.exe': 'PuTTY SSH',
};
function friendly(name, filedescCache = {}) {
  const k = (name || '').toLowerCase();
  if (KNOWN[k]) return { friendly: KNOWN[k], source: 'known' };
  if (filedescCache[k]) return { friendly: filedescCache[k], source: 'filedesc' };
  return { friendly: name, source: 'unresolved' };
}
// FileDescription for top-unknown exes in ONE ps call (Netdata apps_os_windows.c fallback idea).
// Get-Command misses non-PATH exes (services, vendor utils) → fall back to live process path.
function filedescFor(names) {
  if (!names.length) return {};
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  const r = ps(`$p=@(${list}); foreach ($n in $p) { $f=(Get-Command $n -ErrorAction SilentlyContinue).Source; if (!$f) { try { $f=(Get-Process -Name $n.Replace('.exe','') -ErrorAction Stop | Select-Object -First 1).Path } catch {} } if ($f) { try { $d=(Get-Item $f -ErrorAction Stop).VersionInfo.FileDescription; if ($d) { $n + '=>' + $d } } catch {} } }`, 20000);
  const out = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(.+?)=>+(.+)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}
// Power truth: plugged? battery %? (Glances batpercent idea, no admin via SystemInformation)
function powerState() {
  const r = ps(`Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue; $s=[System.Windows.Forms.SystemInformation]::PowerStatus; 'line=' + $s.PowerLineStatus + ';pct=' + ([double]([math]::Round($s.BatteryLifePercent*100))).ToString('R', [cultureinfo]::InvariantCulture) + ';status=' + $s.BatteryChargeStatus`, 15000);
  // the output is ONE line (line=Online;pct=99;status=...): lib/collectors/power.js splits it (canned-output tests cover both shapes)
  return powerLib.parsePowerStatusText(r.stdout);
}
// v12 asset block, now a derived alias of systemProfile (system-profile-for-it). The profile
// is collected once per run by collectSystemProfile(); pack mode collects it on demand.
// The alias is removed by report-and-visualization.
function collectSystemProfile() {
  const p = sysProfile.collectProfile({
    elevated: TIER === 'admin', anonymize: ANON,
    userInput: { serial: getArg('--serial', null) || null, warrantyDate: getArg('--warranty-date', null) || null, warrantyNote: getArg('--warranty-note', null) || null },
  });
  for (const [g, st] of Object.entries(p.groupStatus || {})) if (st !== 'ok') fail('sys.asset', 'systemProfile', 'counter-missing', `profile group ${g}: ${st}`);
  return p;
}
function assetBlock(profile) {
  return sysProfile.deriveAsset(profile || collectSystemProfile(), {});
}
// v12 baseline reader shared by rollup + pack.
// Reads reports/watch/ and (for one release) the old reports/baseline/. Typed records
// (e.g. watch-end cadence) are not samples and are skipped here.
function loadBaselineRows() {
  const rows = [], files = [];
  for (const sub of ['watch', 'baseline']) {
    const dir = path.join(OUTDIR, sub);
    let list = [];
    try { list = fs.readdirSync(dir).filter((f) => /\.jsonl$/i.test(f)).sort(); }
    catch (e) { if (sub === 'watch') fail('watch.rollup', 'watchRollup', 'missing', `watch log dir unreadable: ${String(e.message || e).slice(0, 120)}`); continue; }
    for (const f of list) {
      files.push(`${sub}/${f}`);
      try {
        for (const ln of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
          if (!ln.trim()) continue;
          try { const o = JSON.parse(ln); if (!o.type) rows.push({ ...plain(o), _file: f }); } catch { /* skip bad line, keep rollup going */ }
        }
      } catch (e) { fail('watch.rollup', 'watchRollup', 'counter-missing', `${f}: ${String(e.message || e).slice(0, 120)}`); }
    }
  }
  return { rows, files };
}
// v12 watch --rollup weekly: JSONL -> per-day sustained aggregates.
function watchRollup() {
  const mode = getArg('--rollup', 'weekly');
  const { rows, files } = loadBaselineRows();
  if (!rows.length) {
    console.log(`[rollup] no baseline rows in ${path.join(OUTDIR, 'baseline')} (${files.length} files)`);
    return { days: [] };
  }
  const byDay = new Map();
  for (const r of rows) {
    const day = String(r.at || '').slice(0, 10) || 'unknown-date';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(r);
  }
  console.log(`[rollup] ${rows.length} rows across ${files.length} files -> ${byDay.size} day(s) (mode=${mode}, threshold --commit ${TH.commit})`);
  console.log('date | rows | window | cadence_s | commit>85%_hrs | commitPeak | pagesP95 | hangs/day | plug');
  const days = [];
  for (const day of [...byDay.keys()].sort()) {
    const rs = byDay.get(day).sort((a, b) => (String(a.at) < String(b.at) ? -1 : 1));
    const n = rs.length;
    const t0 = Date.parse(rs[0].at), t1 = Date.parse(rs[n - 1].at);
    const spanH = (Number.isFinite(t0) && Number.isFinite(t1) && n > 1) ? +(((t1 - t0) / 36e5).toFixed(2)) : 0;
    const gaps = [];
    for (let i = 1; i < n; i++) {
      const d = (Date.parse(rs[i].at) - Date.parse(rs[i - 1].at)) / 1000;
      if (Number.isFinite(d) && d >= 0) gaps.push(d);
    }
    const cadence = gaps.length ? +pct(gaps, 50).toFixed(1) : null;
    const over = rs.filter((r) => Number.isFinite(r.committed) && r.committed >= TH.commit).length;
    const pctHrs = n ? +((over / n) * 100).toFixed(1) : 0;
    const commits = rs.map((r) => r.committed).filter(Number.isFinite);
    const pages = rs.map((r) => r.pages).filter(Number.isFinite);
    const commitPeak = commits.length ? +Math.max(...commits).toFixed(1) : null;
    const pagesP95 = pages.length ? +pct(pages, 95).toFixed(0) : null;
    const plugN = rs.filter((r) => r.plugged === true).length;
    const plug = `AC ${plugN}/${n}`;
    const window = n > 1 ? `${String(rs[0].at).slice(11, 19)}-${String(rs[n - 1].at).slice(11, 19)}` : String(rs[0].at).slice(11, 19);
    console.log(`${day} | n=${n} | ${window} (${spanH}h) | ${cadence === null ? '?' : cadence}s | ${pctHrs}% (${over}/${n}) | ${commitPeak === null ? '?' : commitPeak} | ${pagesP95 === null ? '?' : pagesP95} | n/a (watch has no spawn probes) | ${plug}`);
    days.push({ date: day, n, window: { first: rs[0].at, last: rs[n - 1].at, spanH }, cadenceS: cadence,
      pctHoursCommitOver85: pctHrs, overN: over, commitPeak, pagesP95, hangsPerDay: 'n/a',
      hangsNote: 'impossible from watch rows (no spawn latency); use trace hangRatePerMin', plugAC: plugN, threshold: TH.commit });
  }
  console.log(`[rollup] basis: commit threshold --commit ${TH.commit}; pages p95 per day; hangs n/a honestly (watch rows carry no spawn probes); every row shows n/window/cadence.`);
  return { days, files };
}
// current declaration with fallbacks recorded so far (counts are filled from a run's end snapshot)
const currentDecl = () => ({ ...SCOPE_DECL, fallbacks: [...RESOLVER.fallbacks] });
// v12 pack mode: one approval JSON (asset + sustained + hangs + audit + power + cost).
// Readers are loud: every unreadable trace is named with its error; pack never reports
// "no trace" or $0 because a file failed to parse. Pack requires telltale-json/2.
function packMode() {
  const packInput = args[1] && !args[1].startsWith('--') ? args[1] : null;
  try { scopeLib.assertShareablePath(packInput || OUTDIR); } catch (e) { console.error(`[pack] ${e.message}`); process.exitCode = 2; return; }
  console.log('[pack] assembling approval JSON (system profile + sustained + hangs + finding + audit + power)...');
  const packProfile = collectSystemProfile();
  const asset = assetBlock(packProfile);
  const scheme = sh('powercfg /GETACTIVESCHEME').stdout.split('\n')[0] || 'unknown';
  const live = powerState();
  const scan = packInput ? (() => {
    const full = path.resolve(packInput), file = path.basename(full), rd = reportsIo.readReportFile(full);
    if (!rd.ok) return { files: [{ file, full, ok: false, error: rd.error }] };
    const v = reportsIo.schemaVersion(rd.report);
    return { files: [v.version === 'v1' || v.version === 'v2' ? { file, full, ok: true, report: rd.report, version: v.version, schema: v.schema } : { file, full, ok: false, error: `unknown schema ${v.schema === null ? '(none declared)' : `'${v.schema}'`}` }] };
  })() : reportsIo.scanTraceReports(OUTDIR);
  const unreadable = scan.files.filter((f) => !f.ok).map((f) => ({ file: f.file, error: f.error }));
  const v1Files = scan.files.filter((f) => f.ok && f.version === 'v1').map((f) => f.file);
  const v2 = scan.files.filter((f) => f.ok && f.version === 'v2');
  for (const u of unreadable) console.log(`[pack] UNREADABLE trace ${u.file}: ${u.error}`);
  const pick = v2.length ? v2[v2.length - 1] : null;
  const traceFile = pick ? pick.file : null, latest = pick ? pick.report : null;
  const newerBad = pick ? unreadable.filter((u) => u.file > pick.file).map((u) => u.file) : [];
  if (newerBad.length) console.log(`[pack] using ${traceFile}: newer trace file(s) ${newerBad.join(', ')} could not be read (see above)`);
  if (!pick && v1Files.length) console.log(`[pack] newest readable trace ${v1Files[v1Files.length - 1]} is telltale-json/1 (pre-fix); pack needs telltale-json/2 - re-capture with this version`);
  const noTraceNote = unreadable.length
    ? `no readable v2 trace; unreadable: ${unreadable.map((u) => u.file).join(', ')}`
    : v1Files.length ? `only telltale-json/1 traces present (${v1Files.join(', ')}); re-capture with this version` : 'no trace report found';
  const { rows: bRows, files: bFiles } = loadBaselineRows();
  for (const dep of ['--cost-min', '--ram-cost', '--laptop-cost']) if (getArg(dep, null) !== null) console.log(`[pack] ${dep} is deprecated and ignored (no assumed or purchase context is computed)`);
  const derived = latest ? packCalc.packDerived(latest, TH) : null;
  const THU = derived ? derived.thresholds.used : TH;
  let sustained;
  if (bRows.length >= 5) {
    const commits = bRows.map((r) => r.committed).filter(Number.isFinite);
    const pages = bRows.map((r) => r.pages).filter(Number.isFinite);
    const over = bRows.filter((r) => Number.isFinite(r.committed) && r.committed >= THU.commit).length;
    const ts = bRows.map((r) => Date.parse(r.at)).filter(Number.isFinite).sort((x, y) => x - y);
    sustained = { source: 'watch-log-jsonl', files: bFiles, n: bRows.length,
      window: { first: bRows[0].at, spanH: ts.length > 1 ? +(((ts[ts.length - 1] - ts[0]) / 36e5).toFixed(2)) : 0 },
      pctHoursCommitOver85: bRows.length ? +((over / bRows.length) * 100).toFixed(1) : 0,
      commitPeak: commits.length ? +Math.max(...commits).toFixed(1) : null,
      pagesP95: pages.length ? +pct(pages, 95).toFixed(0) : null,
      hangsNote: 'n/a from watch (no spawn probes); see hangs section', threshold: THU.commit };
  } else if (latest && latest.spawnProbes && latest.spawnProbes.length) {
    const obsS = latest.window ? latest.window.observedS : null;
    sustained = { source: 'trace-window (no watch log; single-window, not sustained)', file: traceFile,
      n: latest.spawnProbes.length, windowS: obsS, windowBasis: 'observed',
      cadenceS: latest.summary.granularityMs / 1000,
      commitPeak: latest.summary.committedPeak, pagesAvg: latest.summary.pagesAvg,
      note: 'run watch for multi-day sustained evidence' };
  } else {
    sustained = { source: 'none', note: 'no watch log and no readable trace report; run watch or trace first' };
    fail('pack.sustained', 'packMode', 'missing', 'no watch log and no readable trace report available');
  }
  const hangs = latest ? { source: traceFile, count: latest.summary.hangEventCount,
    hangRatePerMin: latest.summary.hangRatePerMin, n: latest.summary.totalSpawnProbes, worstMs: latest.summary.spawnMaxMs,
    p95Ms: latest.summary.spawnP95ms, thresholdMs: THU.hang,
    events: (latest.hangEvents || []).slice(0, 5).map((h) => ({ at: h.at, tSec: h.tSec, ms: h.ms, usedPct: h.usedPct, committed: h.committed, pages: h.pages })) }
    : { source: null, count: 'unknown', note: noTraceNote };
  // the finding is the stored diagnosis of the trace (never recomputed here)
  const finding = derived ? derived.finding : null;
  const hwConfigSignal = derived ? derived.hwConfigSignal : null;
  const timeLost = derived ? derived.timeLost : null;
  const findingNote = derived ? derived.note : noTraceNote;
  // the scope declaration leads the pack; out-of-scope load is an anonymous aggregate (no per-group entries)
  const packScope = latest && latest.scope ? latest.scope : currentDecl();
  const pack = { tool: 'telltale pack/1', schema: 'telltale-pack/1', assembledAt: new Date().toISOString(), tier: TIER, ...packCalc.packInputBlock(latest, parseInt(getArg('--stall-ms', ''), 10) || null),
    scope: packScope, outOfScope: latest && latest.outOfScope ? latest.outOfScope : null,
    systemProfile: packProfile, sustained, hangs,
    finding, rollup: derived ? derived.rollup : [], ...(findingNote ? { findingNote } : {}), hwConfigSignal, timeLost,
    admin: latest && latest.admin ? { tier: latest.admin.tier, thermalC: latest.admin.thermalC, sysmon: latest.admin.sysmon, smart: typeof latest.admin.smart === 'string' ? latest.admin.smart.slice(0, 300) : latest.admin.smart, memdiag: latest.admin.memdiag, werSysQueue: latest.admin.werSysQueue, seDebug: typeof latest.admin.seDebug === 'string' ? latest.admin.seDebug.slice(0, 120) : null, skipped: latest.admin.skipped || null }
      : { tier: TIER, note: 'no trace report with admin tier; run elevated trace' },
    werArchive: latest && latest.summary ? latest.summary.werArchive : null,
    serial: (asset && asset.serial && asset.serial !== 'unknown') ? asset.serial : 'unknown (pass --serial or run elevated)',
    power: { plugged: latest ? latest.power.plugged : live.plugged, batteryPct: latest ? latest.power.batteryPct : live.batteryPct,
      scheme: latest ? latest.power.scheme : scheme, liveNow: live, source: latest ? `trace ${traceFile} + live sample` : 'live sample only' },
    audit: { tier: TIER, anonymized: ANON, scopeSource: packScope.source, scopeMode: packScope.mode,
      thresholds: { ...THU }, thresholdSource: derived ? derived.thresholds.source : 'current-flags (no trace)',
      thresholdsIgnoredFromCurrentFlags: derived ? derived.thresholds.ignoredCurrent : {},
      thresholdSources: TH_SRC,
      flags: { hangMs: THU.hang, commit: THU.commit, costRate: getArg('--cost-rate', null), activeMin: getArg('--active-min', null),
        warrantyDate: getArg('--warranty-date', 'unknown'), warrantyNote: getArg('--warranty-note', 'unknown') } },
    provenance: { traceReport: traceFile, baselineFiles: bFiles, unreadableReports: unreadable, v1ReportsSkipped: v1Files,
      sustainedBasis: sustained.source, findingBasis: finding ? `diagnosis stored in ${traceFile}` : (findingNote || 'no finding') } };
  fs.mkdirSync(OUTDIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(OUTDIR, `pack-${stamp}.json`);
  const wr = writeJsonChecked(out, ANON ? scrubValue(pack, SCRUB_CTX) : pack);
  if (!wr.ok) { process.exitCode = 1; return pack; }
  console.log(`[pack] asset: ${asset.manufacturer} ${asset.model} | RAM ${asset.ramFittedNote} | disk ${asset.diskNote} | OS ${asset.osCaption} (${asset.osBuild}) | warranty ${asset.warrantyDate}`);
  console.log(`[pack] sustained: ${sustained.source} (n=${sustained.n === undefined ? '?' : sustained.n})`);
  console.log(`[pack] hangs: ${hangs.count} (rate ${hangs.hangRatePerMin === undefined ? '?' : hangs.hangRatePerMin}/min over observed window, worst ${hangs.worstMs === undefined ? '?' : hangs.worstMs}ms, threshold ${THU.hang}ms [${derived ? derived.thresholds.source : 'current flags'}], source ${hangs.source || noTraceNote})`);
  console.log(`[pack] finding: ${finding ? `${finding.class} - ${finding.sentence}` : `none (${findingNote})`}`);
  for (const l of scopeLib.declarationLines(packScope, pack.outOfScope)) console.log(`[pack] ${l}`);
  console.log(`[pack] audit: tier=${TIER} scope=${packScope.mode}/${packScope.source}`);
  console.log(`[pack] wrote ${out}`);
  if (!hasFlag('--no-report')) {
    try {
      const htmlOut = out.replace(/.json$/, '.report.html');
      fs.writeFileSync(htmlOut, require('./render-print').render(JSON.parse(fs.readFileSync(out, 'utf8')), { jsonName: path.basename(out), jsonSha256: renderPipeline.sha(fs.readFileSync(out)) }));
      console.log(`[pack] wrote ${htmlOut}`);
    } catch (e) { console.log(`[pack] report rendering failed: ${String(e.message || e).slice(0, 300)}`); }
  }
  return pack;
}
// check-stub: run the REAL counter session for a few seconds and build the new signal families from its last block.
function signalsOneShot() {
  const script = sessionLib.buildSessionScript({ paths: REG.counterPaths(), dynamic: REG.dynamicCounters(), intervalS: 1 });
  const r = spawnSync('powershell', sessionLib.bootstrapArgs(), { input: script, encoding: 'utf8', timeout: 14000, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  let last = null;
  sessionLib.createBlockParser((b) => { last = b; }).push(String(r.stdout || ''));
  if (!last) return null;
  const sg = signalsLib.createSignals({ resolver: RESOLVER, logicalCpus: os.cpus().length, fail: () => {}, descendants: MATCHER.hasDescendantEntries });
  return sg.build({ lines: last.lines, power: last.power, costs: last.costs, atIso: last.atIso, windowS: 1 }).fields;
}
// One-shot counter read for check-stub (a single launch, once per CLI call). The trace and watch loops do NOT use
// this: they read the one long-lived counter session. Parsing is shared (lib/sampler/bundle.js).
function probeBundle() {
  const paths = [...BUNDLE_PATHS, ...memExtraPaths()].map((p) => `'${p}'`).join(',');
  const r = ps(`(Get-Counter ${paths} -ErrorAction SilentlyContinue).CounterSamples | ForEach-Object { $_.Path + '=' + ([double]$_.CookedValue).ToString('R', [cultureinfo]::InvariantCulture) }`, 15000);
  const parsed = parseBundleLines(r.stdout.split('\n').map((l) => l.trim()), { decimal: '.' });
  return { gpuTotal: null, ...parsed.values };
}
// v11 per-process GPU attribution (Task Manager's own source: WDDM counters, no admin).
// Counter-set presence is probed once per process (cached); absent set (Basic Display
// driver / no WDDM2+) -> {unavailable: reason}, NEVER zeros. Every emitted number carries n.
let GPU_STATE = null;
function gpuCounterState() {
  if (GPU_STATE) return GPU_STATE;
  const eng = ps(`(Get-Counter -ListSet 'GPU Engine' -ErrorAction SilentlyContinue).Counter`, 15000);
  const mem = ps(`(Get-Counter -ListSet 'GPU Process Memory' -ErrorAction SilentlyContinue).Counter`, 15000);
  GPU_STATE = {
    hasEngine: /utilization percentage/i.test(eng.stdout),
    hasMem: /local usage/i.test(mem.stdout),
  };
  return GPU_STATE;
}
// ONE powershell flight for both per-PID polls (saves a ~200ms spawn vs two calls).
// Returns {engines, mem}; each is {byPid: {pid: {pct|mb, n}}, n, ms} or {unavailable: reason}.
const GPU_SCRIPT = `$ErrorActionPreference='SilentlyContinue'; 'mode=eng'; $e=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples; if ($e) { $e | ForEach-Object { $_.Path + '=' + ([double]$_.CookedValue).ToString('R', [cultureinfo]::InvariantCulture) } }; 'mode=mem'; $m=(Get-Counter '\\GPU Process Memory(*)\\Local Usage').CounterSamples; if ($m) { $m | ForEach-Object { $_.Path + '=' + ([double]$_.CookedValue).ToString('R', [cultureinfo]::InvariantCulture) } }`;
function gpuAbsent() {
  const reason = 'GPU counter sets absent (Basic Display driver or no WDDM2+ adapter)';
  fail('gpu.util_per_proc', 'gpuEngines', 'counter-missing', reason);
  fail('gpu.vram_per_proc', 'gpuMem', 'counter-missing', reason);
  return { engines: { unavailable: reason }, mem: { unavailable: reason } };
}
function gpuParse(stdout, st, ms) {
  const out = { engines: null, mem: null };
  let mode = null;
  const eng = {}, mem = {};
  let engN = 0, memN = 0;
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (t === 'mode=eng') { mode = 'eng'; continue; }
    if (t === 'mode=mem') { mode = 'mem'; continue; }
    const eq = t.lastIndexOf('=');
    if (eq < 0 || !mode) continue;
    const v = num(t.slice(eq + 1));
    if (v === null) continue;
    const m = t.slice(0, eq).match(/pid_(\d+)/i);
    if (!m) continue;
    const pid = m[1];
    if (mode === 'eng') {
      const e = eng[pid] || (eng[pid] = { pct: 0, n: 0 });
      e.pct += v; e.n += 1; engN++;
    } else {
      const e = mem[pid] || (mem[pid] = { mb: 0, n: 0 });
      e.mb += v / 1048576; e.n += 1; memN++;
    }
  }
  for (const pid of Object.keys(eng)) eng[pid].pct = +eng[pid].pct.toFixed(1);
  for (const pid of Object.keys(mem)) mem[pid].mb = +mem[pid].mb.toFixed(1);
  if (st.hasEngine) {
    out.engines = engN ? { byPid: eng, n: engN, ms } : { unavailable: 'GPU Engine set present but poll returned zero samples (transient?)' };
    if (out.engines.unavailable) fail('gpu.util_per_proc', 'gpuEngines', 'counter-missing', out.engines.unavailable);
  } else {
    out.engines = { unavailable: 'GPU Engine counter set absent (Basic Display driver or no WDDM2+ adapter)' };
    fail('gpu.util_per_proc', 'gpuEngines', 'counter-missing', out.engines.unavailable);
  }
  if (st.hasMem) {
    out.mem = memN ? { byPid: mem, n: memN, ms } : { unavailable: 'GPU Process Memory set present but poll returned zero samples (transient?)' };
    if (out.mem.unavailable) fail('gpu.vram_per_proc', 'gpuMem', 'counter-missing', out.mem.unavailable);
  } else {
    out.mem = { unavailable: 'GPU Process Memory counter set absent (Basic Display driver or no WDDM2+ adapter)' };
    fail('gpu.vram_per_proc', 'gpuMem', 'counter-missing', out.mem.unavailable);
  }
  return out;
}
function gpuPoll() {
  const st = gpuCounterState();
  if (!st.hasEngine && !st.hasMem) return gpuAbsent();
  const t0 = Date.now();
  const r = ps(GPU_SCRIPT, 30000);
  return gpuParse(r.stdout, st, Date.now() - t0);
}
// on-trigger form: asynchronous, killed at its budget, never blocks the continuous tier
// on a hang only the in-scope PIDs are polled (a wildcard poll of every process costs 6-16 s); pids === null means no snapshot
// was obtained, so the full poll is used and the stored result is still reduced to in-scope groups
const gpuScriptFor = (pids) => `$ErrorActionPreference='SilentlyContinue'; $ids=@(${pids.slice(0, 40).filter(Number.isFinite).join(',')}); 'mode=eng'; $e=(Get-Counter -Counter @($ids | ForEach-Object { '\\GPU Engine(pid_' + $_ + '_*)\\Utilization Percentage' })).CounterSamples; if ($e) { $e | ForEach-Object { $_.Path + '=' + ([double]$_.CookedValue).ToString('R', [cultureinfo]::InvariantCulture) } }; 'mode=mem'; $m=(Get-Counter -Counter @($ids | ForEach-Object { '\\GPU Process Memory(pid_' + $_ + '_*)\\Local Usage' })).CounterSamples; if ($m) { $m | ForEach-Object { $_.Path + '=' + ([double]$_.CookedValue).ToString('R', [cultureinfo]::InvariantCulture) } }`;
async function gpuPollA(ctx, pids = null) {
  const st = gpuCounterState();
  if (!st.hasEngine && !st.hasMem) return gpuAbsent();
  if (pids && !pids.length) { const why = 'no in-scope process was running at the hang'; return { engines: { unavailable: why }, mem: { unavailable: why } }; }
  const t0 = Date.now();
  const r = await EXEC.ps(pids ? gpuScriptFor(pids) : GPU_SCRIPT, { timeoutMs: 30000, tier: 'onTrigger', ctx });
  return gpuParse(r.stdout, st, Date.now() - t0);
}
// Collector wrappers (COLLECTORS ids); share one poll per call-site via gpuPoll().
function gpuEngines() { return gpuPoll().engines; }
function gpuMem() { return gpuPoll().mem; }
// v11 nvidia-smi parse-only fallback: runs ONLY when the binary is on PATH, never in the bundle.
function nvidiaSmi() {
  const w = sh('where nvidia-smi', 10000);
  if (w.code !== 0 || !w.stdout.trim()) {
    const reason = 'nvidia-smi not on PATH (no NVIDIA driver or not installed)';
    fail('gpu.nvidia_info', 'nvidiaSmi', 'missing', reason);
    return { present: false, reason };
  }
  const r = sh('nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu --format=csv,noheader,nounits', 15000);
  const gpus = [];
  for (const line of r.stdout.split('\n')) {
    const parts = line.trim().split(',').map((s) => s.trim());
    if (parts.length < 3) continue;
    const u = num(parts[0]), m = num(parts[1]), t = num(parts[2]);
    if (u === null && m === null && t === null) continue;
    gpus.push({ utilPct: u, memUsedMB: m, tempC: t });
  }
  if (!gpus.length) {
    const reason = ('nvidia-smi query failed: ' + (r.stderr || 'unparsable output')).slice(0, 150);
    fail('gpu.nvidia_info', 'nvidiaSmi', 'counter-missing', reason);
    return { present: false, reason };
  }
  return { present: true, gpus, n: gpus.length };
}
// Join per-PID gpu maps onto culprit rows (dwm.exe/warp.exe compositor attribution).
// Only sets fields when >=1 recorded pid has data; otherwise leaves the row untouched (no zeros).
function attachGpu(rows, snap) {
  if (!rows || !snap) return;
  const eng = snap.engines && !snap.engines.unavailable ? snap.engines.byPid : null;
  const mem = snap.mem && !snap.mem.unavailable ? snap.mem.byPid : null;
  if (!eng && !mem) return;
  for (const c of rows) {
    let pct = 0, mb = 0, n = 0, kp = 0;
    for (const pid of c.pids || []) {
      const e = eng && eng[String(pid)];
      const m = mem && mem[String(pid)];
      if (e) { pct += e.pct; n += e.n; kp++; }
      if (m) { mb += m.mb; n += m.n; if (!e) kp++; }
    }
    if (kp > 0) { c.gpuPct = +pct.toFixed(1); c.gpuMB = +mb.toFixed(1); c.gpuPids = kp; c.gpuN = n; }
  }
}
// v0.6 admin tier (deep-admin-surface.md). Every collector best-effort; unelevated → skipped+reason.
function adminSnapshot(deepDir) {
  if (TIER !== 'admin') return { tier: 'user', skipped: 'process not elevated; re-run as admin for thermal/SMART/Sysmon/WER-sys/SeDebug' };
  const out = { tier: 'admin' };
  const th = ps(`Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round($_.CurrentTemperature/10 - 273.15,1) }`, 15000);
  out.thermalC = th.stdout.split('\n').map((s) => parseFloat(s)).filter(Number.isFinite);
  const sy = ps(`Get-Service Sysmon64 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`, 10000);
  out.sysmon = sy.stdout.trim() || 'not installed (detect-only; install out of scope)';
  const sm = ps(`Get-PhysicalDisk -ErrorAction SilentlyContinue | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | Format-Table DeviceId, Temperature, Wear, ReadErrorsTotal, WriteErrorsTotal -AutoSize | Out-String -Width 160`, 20000);
  out.smart = (sm.stdout || sm.stderr).slice(0, 600);
  const md = ps(`Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='MemoryDiagnostics-Results'} -MaxEvents 3 -ErrorAction SilentlyContinue | ForEach-Object { $_.TimeCreated.ToString('s') + ' ' + $_.Message.Split(\"\\n\")[0] } | Out-String -Width 200`, 15000);
  out.memdiag = (md.stdout || '(no results)').slice(0, 400);
  const wq = ps(`$d=$env:ProgramData + '\\Microsoft\\Windows\\WER\\ReportQueue'; if (Test-Path $d) { 'sysqueue=' + (Get-ChildItem $d -Recurse -Filter *.wer -ErrorAction SilentlyContinue | Select-Object -First 200 | Measure-Object).Count } else { 'sysqueue=0' }`, 20000);
  out.werSysQueue = wq.stdout.trim();
  const dbg = ps(`whoami /priv | Select-String SeDebugPrivilege`, 10000);
  out.seDebug = dbg.stdout.trim() || 'SeDebugPrivilege absent';
  if (hasFlag('--sleep-study') && deepDir) {
    console.log('[telltale:end] sleepstudy/batteryreport (slow one-shots, --sleep-study opted in)');
    const ss = sh(`powercfg /sleepstudy /duration 3 /xml "${deepDir}\\sleepstudy.xml"`, 90000);
    const br = sh(`powercfg /batteryreport /duration 7 /xml "${deepDir}\\battery.xml"`, 90000);
    out.sleepStudy = ss.code === 0 ? 'sleepstudy.xml' : ('skipped: ' + ss.stderr.slice(0, 150));
    out.batteryReport = br.code === 0 ? 'battery.xml' : ('skipped: ' + br.stderr.slice(0, 150));
  } else out.reportsNote = 'sleepstudy/batteryreport need --sleep-study (they can wedge end-phase for minutes)';
  return out;
}
// ---- continuous tier: ONE long-lived counter session; no per-tick process launch --------------------------------
// Validates the counter paths with one one-shot launch, then starts the session. `cont` is the scheduler's
// continuous recorder (cadence, unobserved intervals); `onCSample(cs, values)` receives each persisted-form sample.
let SIGNALS = null; // per-run signal builder (lib/collectors): per-process CPU/I/O, thermal, throttle, commit, disk, network, GPU, power
async function startContinuousTier({ nominalS = 2, cont, onCSample, runStartMsFn = () => null, onPowerTransition = (t) => streamAppend('power-transition', t) }) {
  const wanted = REG.counterPaths();
  const dynamic = REG.dynamicCounters();
  SIGNALS = signalsLib.createSignals({ resolver: RESOLVER, logicalCpus: os.cpus().length, fail, descendants: MATCHER.hasDescendantEntries });
  if (process.env.TELLTALE_TEST_FAIL_ALL) { fail('run.continuous', 'counterSession', 'counter-missing', 'test hook: every launch fails (TELLTALE_TEST_FAIL_ALL)'); fail('mem.committed_pct', 'counterBundle', 'counter-missing', 'continuous tier unavailable'); return null; }
  let seq = 0, ready = null;
  const skipped = [];
  const mgr = sessionLib.createSessionManager({
    spawnFn: (cmd, argv, opts) => { OBSERVER.launch('once'); const c = spawn(cmd, argv, opts); selfLib.registerPid(c.pid); OBS_LAST.sessionPid = c.pid; return c; },
    buildArgs: () => sessionLib.bootstrapArgs(),
    buildStdin: () => sessionLib.buildSessionScript({ paths: wanted, dynamic, intervalS: nominalS, nodePid: process.pid, helperPid: OBS_LAST.helperPid || 0 }),
    // a counter that cannot be created on this machine is evidence, never a stop
    onSkip: (p, reason) => { skipped.push(p); fail('sys.counters', 'counterBundle', 'counter-missing', `counter ${p}: ${reason}`); },
    onReady: (n) => { ready = n; },
    onBlock: (b) => {
      if (!Number.isFinite(b.atMs)) return;
      const parsed = parseBundleLines(b.lines, { decimal: '.' });
      for (const f of parsed.failures) fail('mem.committed_pct', 'counterBundle', 'parse', f.reason, { field: f.field });
      // new signal families: reduced through the scope resolver in memory before anything is stored
      const sig = SIGNALS.build({ lines: b.lines, power: b.power, costs: b.costs, atIso: b.atIso, windowS: nominalS });
      // legacy flat key: security-software CPU as a share of the whole machine (was a per-core-scaled raw counter)
      if (sig.fields.procs && sig.fields.procs.system) { const sec = sig.fields.procs.system.find((x) => x.member === 'Security software'); parsed.values.defender = sec ? sec.cpuPctMachine : null; }
      if (b.obs) {
        OBS_LAST.sessionCpuS = Number(b.obs.cpuS); OBS_LAST.sessionPrivMB = Number(b.obs.privateB) / 1048576;
        if (Number(b.obs.nodePrivateB) > 0) OBS_LAST.nodePrivMB = Number(b.obs.nodePrivateB) / 1048576;
        if (b.obs.helperCpuS !== undefined && Number.isFinite(Number(b.obs.helperCpuS))) { OBS_LAST.helperCpuS = Number(b.obs.helperCpuS); OBS_LAST.helperPrivMB = Number(b.obs.helperPrivateB) / 1048576; }
      }
      const cs = Object.assign(sRecords.buildCSample({ atMs: b.atMs, values: parsed.values, power: b.power, seq: ++seq, windowS: nominalS, runStartMs: runStartMsFn() }), sig.fields);
      if (sig.transition) onPowerTransition(sig.transition);
      cont.onSample(b.atMs);
      OBSERVER.sample();
      onCSample(cs, parsed.values);
    },
    onRestart: ({ n, reason }) => { cont.noteGapReason('session-restart'); fail('run.continuous', 'counterSession', 'session-restart', `restart ${n}/3: ${reason}`); },
    onGiveUp: (reason) => fail('run.continuous', 'counterSession', 'counter-missing', `counter session gave up after 3 restarts: ${reason}; continuing on the remaining collectors`),
  });
  mgr.start();
  return { mgr, paths: wanted, skipped, get ready() { return ready; } };
}

// Enumerate processes on a trigger: asynchronous, killed at the collector's budget. Rows exclude the tool's own PIDs.
function tasklistRows(stdout) {
  const x = selfLib.excludeSelf(parseTasklist(stdout));
  OBS.wsPeakMB = Math.max(OBS.wsPeakMB, x.observer.wsMB); OBS.wsSumMB += x.observer.wsMB; OBS.snaps++;
  for (const p of x.observer.pids) OBS.pids.add(p);
  return x.rows;
}
async function enumTasklistA(ctx, { withTree = false } = {}) {
  const r = await EXEC.sh('tasklist /FO CSV /NH', { timeoutMs: 4000, tier: 'onTrigger', ctx });
  if (r.timedOut || r.code !== 0 || !r.stdout) throw new Error(r.timedOut ? 'tasklist exceeded its budget' : `tasklist failed: ${r.stderr || 'empty output'}`);
  const rows = tasklistRows(r.stdout);
  const cim = withTree && MATCHER.hasDescendantEntries ? await cimSnapshotA(ctx) : undefined;
  return { rows, cim, path: 'tasklist' };
}
async function enumLightA(ctx) {
  const lp = await EXEC.ps(`Get-Process -ErrorAction SilentlyContinue | Select-Object Name, Id, @{n='MB';e={[math]::Round($_.WS/1MB)}} | ForEach-Object { $_.Name + '|' + $_.Id + '|' + $_.MB }`, { timeoutMs: 3000, tier: 'onTrigger', ctx });
  const rows = scopeLib.parseProcessList(lp.stdout, selfLib.isSelf);
  if (!rows.length) throw new Error('light process enumeration returned no rows');
  return { rows, cim: undefined, path: 'get-process' };
}
const nowIso = () => new Date().toISOString();

async function watchMode() {
  // continuous-tier watch: the 2s counter bundle + RAM -> JSONL of provenance records (no spawn probes, no per-tick launch).
  // --watch-secs N exits after N wall-clock seconds (default: run until Ctrl+C); rotates file at 5MB.
  const WATCH_SECS = parseInt(getArg('--watch-secs', '0'), 10);
  const wdir = path.join(OUTDIR, 'watch');
  fs.mkdirSync(wdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let log = path.join(wdir, `watch-${stamp}.jsonl`);
  console.log(`[telltale watch] every 2s -> ${log}${WATCH_SECS ? ` for ${WATCH_SECS}s (wall clock)` : ' (Ctrl+C to stop)'}`);
  const rawAppend = (rec) => { try { fs.appendFileSync(log, JSON.stringify(rec) + '\n'); } catch (e) { console.log(`[watch] log write failed: ${e.message.slice(0, 120)}`); } };
  // the scope declaration leads the watch log (typed record; sample readers skip typed records)
  rawAppend({ type: 'watch-scope', at: nowIso(), scope: currentDecl() });
  const cont = createContinuous({ nominalS: 2, sink: { append: (t, r) => rawAppend({ type: `watch-${t}`, ...r }) } });
  let hot = 0, hotStreaks = 0, rows = 0, watchFired = false, pendingTop = null, topBusy = false, lastTopMs = 0, stopWatch = false;
  const watchT0 = Date.now();
  const scheduleTop = () => {
    if (topBusy) return;
    topBusy = true; lastTopMs = Date.now();
    HEAVY.run({ id: 'tasklistSnap', trigger: 'schedule', budgetMs: 4000, inference: 'proc.top_hoarders', fn: (ctx) => enumTasklistA(ctx, { withTree: true }) })
      .then((r) => {
        if (r.outcome !== 'ok' || !r.value || !r.value.rows) return;
        // same resolver and matcher as trace: top groups within scope + system set; the rest is one anonymous aggregate
        const res = resolveSnapshot(r.value.rows, { allowTree: !!r.value.cim, cim: r.value.cim });
        const wr = scopeLib.watchRow(res, 3);
        pendingTop = { top: wr.top.map((g) => ({ ...g, ...friendly(g.name) })), outOfScope: wr.outOfScope };
      }).catch(() => {}).finally(() => { topBusy = false; });
  };
  const tier = await startContinuousTier({
    nominalS: 2, cont, runStartMsFn: () => watchT0, onPowerTransition: (t) => rawAppend({ type: 'watch-power-transition', ...t }),
    onCSample: (cs, vals) => {
      const c = vals.committed, pg = vals.pages;
      if ((c ?? 0) >= TH.commit || (pg ?? 0) > TH.pages) hot++; else hot = 0;
      if (hot === 3) {
        hotStreaks++;
        // v10 --watch-trigger: detached auto-trace, max 1 per watch run (no spawn storms) + --no-trigger kills it
        if (hasFlag('--watch-trigger') && !hasFlag('--no-trigger') && !watchFired) {
          watchFired = true;
          try {
            OBSERVER.launch('once');
            const child = spawn(process.execPath, [__filename, 'trace'], { detached: true, stdio: 'ignore' });
            selfLib.registerPid(child.pid);
            child.unref();
            console.log(`[watch] trigger: pressure streak #${hotStreaks} -> spawned detached trace pid=${child.pid} (report lands in reports/telltale-<timestamp>.json; one per watch run)`);
          } catch (e) { console.log(`[watch] trigger spawn failed: ${String(e.message || e).slice(0, 120)}`); watchFired = false; }
        }
      }
      if (Date.now() - lastTopMs >= 10000) scheduleTop();
      const freeGB = os.freemem() / 1024 ** 3, usedPct = (1 - os.freemem() / os.totalmem()) * 100;
      const { at, seq, tSec, ...rest } = cs; void seq; void tSec;
      const ram = sRecords.buildRamSample({ atMs: Date.parse(at), tSec: null, freeGB, usedPct });
      const top = pendingTop ? pendingTop.top : null, outOfScope = pendingTop ? pendingTop.outOfScope : null;
      pendingTop = null;
      const row = { at, usedPct: ram.usedPct, freeGB: ram.freeGB, ...rest, top, outOfScope };
      try {
        if (fs.existsSync(log) && fs.statSync(log).size > 5 * 1024 * 1024) log = path.join(wdir, `watch-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jsonl`);
      } catch { /* rotation check is best effort */ }
      rawAppend(RESOLVER.guard(row));
      rows++;
      const flag = hot >= 3 ? '  <-- PRESSURE 3x: consider `telltale trace`' : '';
      const pwTxt = cs.plugged === null || cs.plugged === undefined ? '' : cs.plugged ? ' AC' : ' BAT';
      if (rows % 5 === 1 || hot >= 3) console.log(`  RAM ${usedPct.toFixed(1)}% commit ${cs.committed ? cs.committed.v : '?'}% pages ${cs.pages ? cs.pages.v : '?'}/s${pwTxt}${flag}`);
    },
  });
  if (!tier) { console.log('[telltale watch] continuous tier unavailable (see collection failures); nothing to record'); }
  const onSig = () => { stopWatch = true; };
  for (const sig of ['SIGINT', 'SIGBREAK']) process.once(sig, onSig);
  while (!stopWatch && (WATCH_SECS > 0 ? Date.now() - watchT0 < WATCH_SECS * 1000 : true) && tier) await sleep(250);
  const endMs = Date.now();
  OBSERVER.sample();
  const obsRep = OBSERVER.report({ windowS: (endMs - watchT0) / 1000 });
  if (tier) tier.mgr.stop();
  cont.finish(endMs);
  await HEAVY.whenSettled();
  const cad = cont.cadence();
  rawAppend({ type: 'watch-end', at: nowIso(), rows, requestedS: WATCH_SECS || null, elapsedS: +((endMs - watchT0) / 1000).toFixed(1), achievedMedianCadenceS: cad.achievedMedianS, nominalCadenceS: 2,
    sampling: { cadence: cad, unobserved: cont.unobserved, observer: obsRep }, failures: FAILURES.length, signals: SIGNALS ? SIGNALS.summary() : null });
  console.log(`[telltale watch] done: ${rows} rows in ${((endMs - watchT0) / 1000).toFixed(1)}s (median cadence ${cad.achievedMedianS === null ? 'unknown' : cad.achievedMedianS + 's'}, ${cont.unobserved.length} unobserved gap(s)), observer ${obsRep.cpuPctOneLogical.v === null ? '?' : obsRep.cpuPctOneLogical.v + '%'} of one logical CPU -> ${log}, pressure streaks: ${hotStreaks}`);
  process.exitCode = process.exitCode || 0;
}

// inventory: the ONE place that lists every running group. Local-only: written under <out>/private/
// with "shareable": false, never packed, rendered, or attached. Prints a short local view to the console.
function inventoryMode(opts = {}) {
  const rows = snapTasklist();
  const groups = rollup(rows);
  const top = groups.filter((g) => !scopeLib.systemCategory(g.name)).slice(0, 15);
  const fd = filedescFor(top.map((g) => g.name).filter((n) => !KNOWN[n.toLowerCase()]));
  const inv = scopeLib.buildInventory(groups, { friendlyFn: (n) => { const f = friendly(n, fd); return f.source === 'unresolved' ? n : f.friendly; } });
  const dir = path.join(OUTDIR, 'private');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `inventory-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(inv, null, 2));
  let draft = null;
  if (opts.draftPath || hasFlag('--write-scope')) {
    let p = opts.draftPath || path.resolve(getArg('--scope', 'telltale.scope.json'));
    if (fs.existsSync(p)) p = p.replace(/\.json$/i, '') + '.draft.json';
    fs.writeFileSync(p, JSON.stringify(scopeLib.draftScopeFromInventory(inv), null, 2) + '\n');
    draft = p;
  }
  if (!opts.quiet) {
    console.log(`[inventory] ${inv.groups.length} running groups -> ${file}  (LOCAL ONLY: never attach or share this file)`);
    for (const g of inv.groups.filter((x) => x.category === 'user').slice(0, 15)) console.log(`  ${String(g.memMB).padStart(6)} MB  x${String(g.instances).padEnd(3)} ${g.name}${g.friendly && g.friendly !== g.name ? `  (${g.friendly})` : ''}`);
    if (draft) console.log(`[inventory] drafted scope file ${draft}: every entry is disabled; set "enabled": true on what to monitor`);
    else console.log('[inventory] next: node tools/telltale/telltale.js inventory --write-scope   (drafts telltale.scope.json), edit it, then run trace');
  }
  return { file, draft, groups: inv.groups.length };
}
async function recordInventoryFirst() {
  const inv = inventoryMode({ quiet: true, draftPath: path.join(process.cwd(), 'telltale.scope.draft.json') });
  console.log(`[telltale] no scope declared: inventory written to ${inv.file} (local only); draft scope ${inv.draft} has every entry disabled.`);
  console.log('[telltale] review the draft, save it as telltale.scope.json, and re-run record to monitor only what you choose.');
  if (process.stdin.isTTY) {
    process.stdout.write('Press Enter to continue with OPEN scope now, or type s + Enter to stop and edit the scope file: ');
    const ans = await new Promise((res) => {
      const t = setTimeout(() => res(''), 30000);
      process.stdin.resume();
      process.stdin.once('data', (d) => { clearTimeout(t); res(d.toString()); });
    });
    try { process.stdin.pause(); } catch { /* not a TTY on this host */ }
    if (/^\s*s/i.test(ans)) { console.log('[telltale] stopped so you can edit the scope file.'); process.exit(0); }
  } else console.log('[telltale] non-interactive: continuing with OPEN scope (declared loudly in every view).');
}

async function main() {
  if (hasFlag('--help') || args[0] === 'help') { printHelp(); return; }
  // invalid scope file or retired flag (--hide/--focus/--extras): exit 2 naming the problem, write nothing
  if (SCOPE_ERROR) { console.error(`[telltale] ${SCOPE_ERROR.message}`); process.exitCode = 2; return; }
  if (MODE === 'inventory') return inventoryMode();
  if (MODE === 'recover') return recoverMode();
  if (MODE === 'trend') return require('./trend').runTrend({ outdir: OUTDIR });
  if (MODE === 'watch' && (hasFlag('--rollup') || getArg('--rollup', '') !== '')) return watchRollup();
  TIER = detectTier();
  if (MODE === 'check-stub') return checkStub();
  if (MODE === 'record') {
    // OQ-1: record with no scope declared runs inventory first and asks the user to save a scope
    if (SCOPE_DECL.source === 'none' && PRESET !== 'plain') await recordInventoryFirst();
    console.log(`[telltale] record: one-click capture (${DURATION}s, ${SCOPED ? 'scoped' : 'OPEN'} scope) — work normally, tap a key on freezes`);
  }
  if (MODE === 'pack') return packMode();
  banner();
  if (MODE === 'watch') return watchMode();
  const startedAt = new Date();
  for (const line of settingsLib.clampLines(SETTINGS)) console.log(line);
  console.log(`[telltale v0.6] tier=${TIER} ${TIER === 'admin' ? '(elevated - admin signals on)' : '(standard - admin signals will skip gracefully)'}`);
  // the scope declaration leads the run: the user sees what will be recorded before anything is
  if (PRESET === 'dev' && SCOPE_DECL.source === 'template:dev') {
    const drafted = scopeLib.writeTemplateDraft(process.cwd(), 'dev');
    if (drafted) console.log(`[telltale] drafted ${drafted} from template:dev (edit it to change what is monitored)`);
  }
  for (const w of SCOPE_DECL.warnings || []) console.log(`[telltale] WARNING: ${w}`);
  for (const l of scopeLib.declarationLines(currentDecl(), null)) console.log(`[telltale] ${l}`);
  const HANG_MS = TH.hang;
  // WPR session can never leak: normal stop + interrupt/crash handlers (review gate §5)
  const stopWpr = (why) => {
    if (!wprEtl) return;
    const w1 = sh(`wpr.exe -stop "${wprEtl}"`, 60000);
    console.log(w1.code === 0 ? `[telltale] wpr stopped (${why}) -> ${wprEtl}` : `[telltale] wpr stop issue: ${w1.stderr.slice(0, 150)}`);
    if (w1.code !== 0) wprEtl = null;
  };
  let wprEtl = null;
  if (hasFlag('--wpr')) {
    if (TIER !== 'admin') console.log('[telltale] --wpr needs elevation: skipped (tier=user)');
    else {
      wprEtl = path.join(OUTDIR, `telltale-${startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.etl`);
      const w0 = sh(`wpr.exe -start CPU -start Memory -start DiskIO -filemode`, 30000);
      if (w0.code !== 0) { console.log(`[telltale] wpr start failed: ${w0.stderr.slice(0, 150)}`); wprEtl = null; }
      else console.log(`[telltale] wpr capturing -> ${wprEtl} (analyze: CPU Usage (Precise), DPC/ISR, Hard Faults)`);
    }
  }
  console.log(`[telltale v0.6] tracing ${DURATION}s @ ${INTERVAL}ms on ${ANON ? '<host>' : os.hostname()}... (duration source: ${DURATION_SRC})`);
  console.log(`[telltale] keep working - type, run Playwright, leave Docker up.`);

  // system profile (system-profile-for-it): collected once, before continuous sampling begins
  const systemProfile = collectSystemProfile();
  console.log(sysProfile.digestLine(systemProfile));
  const totalGB = os.totalmem() / 1024 ** 3;
  const cpus = os.cpus();
  const powerScheme = sh('powercfg /GETACTIVESCHEME').stdout.split('\n')[0] || '(unknown)';

  // --- timeline (sampling engine): in-process RAM samples every INTERVAL; the continuous tier is ONE long-lived
  // counter session (no per-tick launch); the spawn-latency hang probe is the only per-tick launch; heavy work
  // (process enumeration, OS poll, GPU) runs on a hang trigger inside its own budget and never blocks the loop.
  const ramTail = []; // rolling tail only (the stream is the record)
  const lagRes = { n: 0, max: 0, res: [], cap: 5000 }; // loop-lag reservoir: bounded memory over an 8 h run
  const liveSpark = []; // live CLI sparkline: one char appended per hang probe
  let lastResT = 0;
  const lagTimer = setInterval(() => {
    const t0 = process.hrtime.bigint();
    setImmediate(() => {
      const d = Math.max(0, Number(process.hrtime.bigint() - t0) / 1e6 - 0.5);
      lagRes.n++; if (d > lagRes.max) lagRes.max = d;
      if (lagRes.res.length < lagRes.cap) lagRes.res.push(d);
      else { const j = Math.floor(Math.random() * lagRes.n); if (j < lagRes.cap) lagRes.res[j] = d; }
    });
  }, 250); // loop-lag is supporting info only; 250 ms keeps its own cost small

  let warpSeenMB = null;
  let openspecSeenMB = null;
  const hangPids = new Set();
  const userMarks = [];
  let interruptRun = () => {};
  let session = null, keycap = null, stopRequested = null, inputHelper = null;
  let WL = null; // workload session (created once the run stream is open)
  const pendingProbes = new Map(); // hang probes whose on-trigger collection is still running
  // elapsed time is measured from the moment the counter session was launched
  const cont = createContinuous({ nominalS: 2, sink: { append: (t, r) => streamAppend(t, r) } });
  let traceT0 = Date.now();
  let lastCS = null, firstCS = null;
  const onKeyMark = (atMs) => {
    const mark = { tSec: +((atMs - traceT0) / 1000).toFixed(2), at: new Date(atMs).toISOString() };
    userMarks.push(mark);
    streamAppend('mark', mark);
    console.log(`  ** user-mark @ t+${mark.tSec}s`);
  };
  // append-only run stream: every record is flushed as it is measured (survives hang/reboot/Ctrl+C)
  fs.mkdirSync(OUTDIR, { recursive: true });
  const stampId = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(OUTDIR, `telltale-${stampId}`);
  const streamPath = base + '.jsonl';
  STREAM = persist.openStream(streamPath);
  gpuCounterState(); // counter-set presence is probed once, before the loop (a once-tier launch)
  const dur = resolveDuration({ requestedS: SETTINGS.duration.requested !== undefined ? SETTINGS.duration.requested : DURATION, source: SETTINGS.duration.source, maxS: MAX_DURATION_S });
  console.log(`[telltale] run stream: ${streamPath} (every record is appended as measured; \`telltale recover\` rebuilds a summary if the run dies)`);
  // the report is always rebuilt from the persisted stream, so memory stays bounded however long the run is
  const stateFromStream = () => {
    const st = persist.recover(streamPath);
    st.lagProbes = lagRes.res.length ? lagRes.res : [];
    if (lagRes.n) { const hasMax = st.lagProbes.some((x) => x >= lagRes.max); if (!hasMax) st.lagProbes = [...st.lagProbes, lagRes.max]; }
    st.failures = FAILURES; // authoritative in-memory list (also streamed)
    return st;
  };
  let OBS_CAPTURE = null;
  const samplingExtras = (endMs, captureMs = endMs) => ({
    samplingObserver: OBS_CAPTURE || OBSERVER.report({ windowS: Math.max(0.001, (endMs - traceT0) / 1000) }),
    duration: { requestedS: dur.requestedS, usedS: dur.usedS, source: dur.source, clampReason: dur.clampReason, actualS: +((captureMs - traceT0) / 1000).toFixed(1), wrapUpS: +((endMs - captureMs) / 1000).toFixed(1), probesStartedAtS: warmedAt },
  });
  let finishing = false;
  // Ctrl+C / terminal close / crash: keep the evidence, write a best-effort summary, exit.
  interruptRun = async (why, code = 130) => {
    if (finishing) return;
    finishing = true;
    const endMs = Date.now();
    // the helper file must be complete before the summary reads it (bounded wait; the helper exits by itself when stdin closes)
    try { if (inputHelper) await Promise.race([inputHelper.stop(), sleep(2500)]); } catch { /* best effort */ }
    try { stopWpr(why); } catch { /* best effort */ }
    try { if (WL) WL.stop(); } catch { /* best effort */ }
    for (const [, p] of pendingProbes) { p.degraded.push('interrupted before on-trigger collection finished'); streamAppend('probe', p); }
    cont.finish(endMs);
    if (SIGNALS) streamAppend('signals', SIGNALS.summary());
    streamAppend('run-end', { at: new Date(endMs).toISOString(), status: 'interrupted', reason: why });
    try {
      const rep = buildCoreReport({ ...stateFromStream(), ...samplingExtras(endMs) }, { status: 'interrupted', endReason: why, endedAt: new Date(endMs).toISOString(), streamName: path.basename(streamPath) });
      diagnosisEngine.attachDiagnosis(rep, {});
      const w = writeJsonChecked(base + '.json', ANON ? scrubValue(RESOLVER.guard(rep), SCRUB_CTX) : RESOLVER.guard(rep));
      console.log(`[telltale] interrupted (${why}): evidence kept in ${streamPath}; ${w.ok ? 'summary ' + base + '.json (run.status interrupted)' : 'summary write failed'}`);
    } catch (e) { console.error(`[telltale] interrupted (${why}); summary failed: ${e.message}`); }
    try { if (session) session.mgr.stop(); if (keycap) keycap.stop(); } catch { /* best effort */ }
    if (STREAM) STREAM.close();
    process.exit(code);
  };
  for (const sig of ['SIGINT', 'SIGHUP', 'SIGBREAK']) process.once(sig, () => interruptRun(sig, 130));
  process.once('uncaughtException', (e) => { console.error(e); interruptRun('uncaughtException', 1); });
  // test hook: simulate Ctrl+C after N seconds (Windows cannot deliver SIGINT to a background child)
  if (process.env.TELLTALE_TEST_INTERRUPT_AFTER_S) setTimeout(() => interruptRun('SIGINT', 130), +process.env.TELLTALE_TEST_INTERRUPT_AFTER_S * 1000);
  // workload phases: --phase <label[,label]> (labels for successive phase-key presses), --phase-now (open one at run start),
  // or `phases` in the scope file. When any is declared the key 'p' toggles a phase instead of leaving a mark.
  const PHASE_LABELS = String(getArg('--phase', '')).split(',').map((s) => s.trim()).filter(Boolean);
  const PHASE_NOW = hasFlag('--phase-now');
  const PHASES_ON = PHASE_LABELS.length > 0 || SCOPE.workload.phases.length > 0 || PHASE_NOW;
  if (PHASES_ON) process.env.TELLTALE_PHASE_KEY = '1';
  const onPhaseKey = (atMs) => {
    const r = WL ? WL.onPhaseKey(atMs) : null;
    if (r) console.log(`  ** workload phase ${r.action} "${r.label}" @ t+${((atMs - traceT0) / 1000).toFixed(1)}s`);
  };
  // key presses are stamped by a helper process at read time: collection work in this process cannot delay a mark
  if (process.stdin.isTTY) {
    keycap = startKeyCapture({ onMark: onKeyMark, onPhase: onPhaseKey, onInterrupt: () => interruptRun('SIGINT', 130), stdin: 'inherit' });
    console.log(`[telltale] press any key the instant Warp freezes - logs ground truth.${PHASES_ON ? " Key 'p' starts/stops a workload phase instead (it is not a mark)." : ''}`);
  } else if (process.env.TELLTALE_TEST_KEYS || process.env.TELLTALE_TEST_PHASE_KEYS) {
    // test hook: inject key presses (seconds after the run starts) through the same capture helper a terminal uses
    keycap = startKeyCapture({ onMark: onKeyMark, onPhase: onPhaseKey, onInterrupt: () => {}, stdin: 'pipe' });
  }
  // input-response check: an independent helper process stamps and writes its own file (lib/sampler/input-helper.js).
  // Started before the counter session so the session can meter its CPU and memory; with the check off no process is launched.
  const IS = SETTINGS.inputStall;
  if (IS.enabled.value) {
    console.log('[telltale] input-response check ON (automatic, no action needed): input timing is observed without recording what is typed or clicked; --no-input-stall turns it off');
    inputHelper = await startInputHelper({
      settings: IS, matchData: RESOLVER.matchData(), streamDir: OUTDIR, stamp: stampId,
      env: process.env.TELLTALE_TEST_FAIL_ALL ? { ...process.env, TELLTALE_TEST_HELPER_FAIL: 'compile' } : process.env,
      onStall: (x) => console.log(`  ** input-stall ${Math.round(x.latencyMs)} ms (foreground: ${x.kind === 'in-scope' || x.kind === 'system' ? x.group : x.kind})`),
      onExit: (x) => { streamAppend('input-helper-exit', { at: x.at, code: x.code, signal: x.signal || null }); console.log(`[telltale] input helper exited at ${x.at} (code ${x.code}); the rest of the run is not observed by the input-response check`); },
    });
    streamAppend('input-helper', { status: inputHelper.status, reason: inputHelper.reason, build: inputHelper.build, file: inputHelper.status === 'running' ? inputHelper.file : null, at: inputHelper.at, attempts: inputHelper.attempts });
    if (inputHelper.status === 'running') { selfLib.registerPid(inputHelper.pid); OBS_LAST.helperPid = inputHelper.pid; OBS_LAST.helperLimits = inputHelper.limits; console.log(`[telltale] input helper running (${inputHelper.build}) -> ${inputHelper.file}`); }
    else { fail('input.helper', 'inputHelper', 'unavailable', inputHelper.reason || 'helper unavailable'); console.log(`[telltale] input-response check not available: ${inputHelper.reason}`); }
  } else {
    streamAppend('input-helper', { status: 'not-requested', reason: 'turned off by the user', build: null, file: null, at: new Date().toISOString() });
    console.log(`[telltale] input-response check OFF (${IS.enabled.source})`);
  }
  // continuous tier: one session. Started before the clock so session start-up is not counted as run time.
  session = await startContinuousTier({
    nominalS: 2, cont, runStartMsFn: () => traceT0,
    onCSample: (cs) => {
      if (!firstCS) firstCS = cs;
      lastCS = { ...cs, atMs: Date.parse(cs.at) };
      streamAppend('csample', cs);
    },
  });
  // the run clock starts once the session is launched (its own start-up is counted in the observer cost, not as run time)
  traceT0 = Date.now();
  OBSERVER.markStart();
  if (keycap && process.env.TELLTALE_TEST_KEYS) {
    for (const sec of process.env.TELLTALE_TEST_KEYS.split(',').map(Number).filter(Number.isFinite)) {
      setTimeout(() => { console.log(`[test] key injected at ${new Date().toISOString()}`); keycap.child.stdin.write('x'); }, Math.max(0, traceT0 + sec * 1000 - Date.now()));
    }
  }
  WL = workloadLib.createWorkload({
    ext: SCOPE.workload, scoped: SCOPED, resolver: RESOLVER, exec: EXEC.execA, heavy: HEAVY, sink: { append: streamAppend }, fail,
    elevated: TIER === 'admin', phaseFlag: PHASE_LABELS, phaseNow: PHASE_NOW,
  });
  if (keycap && process.env.TELLTALE_TEST_PHASE_KEYS) {
    for (const sec of process.env.TELLTALE_TEST_PHASE_KEYS.split(',').map(Number).filter(Number.isFinite)) {
      setTimeout(() => { console.log(`[test] phase key injected at ${new Date().toISOString()}`); keycap.child.stdin.write('p'); }, Math.max(0, traceT0 + sec * 1000 - Date.now()));
    }
  }
  const runStartRec = { at: new Date(traceT0).toISOString(), runStartMs: traceT0, tool: 'telltale v0.6', nominalS: DURATION, intervalMs: INTERVAL, continuousNominalS: 2,
    tier: TIER, settings: SETTINGS, thresholds: { ...TH }, durationUsedS: dur.usedS, logicalCpus: os.cpus().length,
    workloadDecl: WL.declaration(), workloadScoped: SCOPED, workloadDrives: SCOPE.workload.drives || [], utcOffsetMin: -new Date(traceT0).getTimezoneOffset() };
  streamAppend('run-start', runStartRec);
  WL.start(); // phases, container / VM polls, probes and config facts begin with the run (all append to the stream)
  for (const f of FAILURES) STREAM.append('failure', f); // failures recorded before the stream opened
  if (!session) console.log('[telltale] continuous tier unavailable: recording spawn probes and RAM only (see collection.failures)');
  const powerNow = () => ({ plugged: lastCS && lastCS.plugged !== undefined ? lastCS.plugged : null, batteryPct: lastCS && lastCS.batteryPct ? lastCS.batteryPct.v : null });
  console.log(`[telltale] continuous tier: ${session ? `${session.paths.length} counter paths in one session (no per-tick launch; counters that this machine lacks are recorded as failures)` : 'off'}; hang probe every 2s; on-trigger collectors have budgets`);
  const runEndAt = traceT0 + dur.usedS * 1000;
  const probeEvery = Math.max(1, Math.round(2000 / INTERVAL));
  let warmedAt = null, probeInFlight = false, ramN = 0, lastDiskCheck = traceT0, lastMid = traceT0, ramPrintedAt = -1;

  // everything heavy a hang triggers: process snapshot, OS not-responding poll, per-PID GPU; each within its budget
  async function collectAtHang(probe, ctxInfo) {
    let hangSnap = null; // the process snapshot this hang obtained (rows + optional tree), reused to scope the GPU poll
    const hangGpuPids = () => {
      if (!hangSnap) return null;
      const allowed = resolveSnapshot(hangSnap.rows, { allowTree: hangSnap.path === 'tasklist', cim: hangSnap.cim }).pidSet();
      return hangSnap.rows.filter((r) => allowed.has(String(r.pid)) && RESOLVER.classifyName(r.name) !== 'sys' && !selfLib.isSelf(r.pid)).map((r) => +r.pid);
    };
    const steps = {
      procEnum: { id: 'tasklistSnap', inference: 'proc.top_hoarders', budgetMs: 4000, fn: async (c) => { const r = await enumTasklistA(c, { withTree: true }); hangSnap = r; return r; } },
      // started at once, in parallel with the process snapshot: it must observe the freeze itself (poll time is recorded)
      osConfirm: { id: 'respondPoll', inference: 'hang.os_confirmed', budgetMs: 5000, fn: async (c) => {
        const pollAtMs = Date.now();
        const r = await EXEC.ps(notResponding.POLL_SCRIPT, { timeoutMs: 5000, tier: 'onTrigger', ctx: c });
        if (r.timedOut) throw new Error('not-responding poll exceeded its budget');
        return { stdout: r.stdout, stderr: r.stderr, pollAtMs };
      } },
      gpu: { id: 'gpuEngines', inference: 'gpu.util_per_proc', budgetMs: 8000, minIntervalS: 20, fn: (c) => gpuPollA(c, hangGpuPids()) },
    };
    const t = await runHangTrigger({ runner: HEAVY, steps });
    // process snapshot: tasklist first, light Get-Process when tasklist did not deliver
    let enumRes = t.procEnum && t.procEnum.outcome === 'ok' && t.procEnum.value && t.procEnum.value.rows ? t.procEnum : null;
    let degradedNote = null;
    if (!enumRes) {
      degradedNote = `tasklist ${t.procEnum ? t.procEnum.outcome : 'skipped'}${t.procEnum && t.procEnum.reason ? ` (${t.procEnum.reason})` : ''}; light Get-Process path used`;
      const lt = await HEAVY.run({ id: 'lightSnap', trigger: 'hang', budgetMs: 3000, coalesce: true, inference: 'proc.top_hoarders', fn: (c) => enumLightA(c) });
      if (lt.outcome === 'ok' && lt.value && lt.value.rows) enumRes = lt;
    }
    probe.snapMs = mkRec(enumRes ? enumRes.elapsedMs : (t.procEnum ? t.procEnum.elapsedMs : 0), { unit: 'ms', windowS: null, n: 1, src: 'tasklistSnap.elapsed@onTrigger', at: nowIso() });
    let hangRes = null;
    if (enumRes) {
      const v = enumRes.value;
      hangRes = resolveSnapshot(v.rows, { allowTree: v.path === 'tasklist', cim: v.cim });
      probe.snapshotPath = v.path;
      if (enumRes.coalesced) probe.snapshotCoalesced = true;
      if (degradedNote) probe.snapshotDegraded = degradedNote;
    }
    let hangAllowedPids = new Set();
    if (hangRes) {
      const hs = scopeLib.hangSnapshot(hangRes);
      probe.culpritsAtHang = hs.culpritsAtHang;
      probe.scopeShare = hs.scopeShare;
      hangAllowedPids = hangRes.pidSet();
      for (const c of probe.culpritsAtHang) for (const pid of c.pids || []) hangPids.add(pid);
    } else {
      probe.culpritsAtHang = null;
      probe.snapshotSkippedReason = degradedNote || 'snapshot not obtained within its budget';
    }
    // OS-confirm: in-scope, non-suspended processes only; the result is attached only to the hang it was polled for
    const os1 = t.osConfirm;
    if (os1 && os1.outcome === 'ok' && os1.value) {
      Object.assign(probe, notResponding.evaluatePoll({ stdout: os1.value.stdout, resolver: RESOLVER, hangAtMs: Date.parse(probe.at), hangStartMs: Date.parse(probe.at) - (Number(plain(probe.ms)) || 0), pollAtMs: os1.value.pollAtMs }));
      probe.respondMs = mkRec(os1.elapsedMs, { unit: 'ms', windowS: null, n: 1, src: 'respondPoll.elapsed@onTrigger', at: nowIso() });
    } else {
      probe.osConfirmed = null;
      probe.osConfirmState = 'not-evaluated';
      probe.osUnavailableReason = `not-responding poll ${os1 ? os1.outcome : 'skipped'}${os1 && os1.reason ? ` (${os1.reason})` : ''}`;
    }
    // GPU per-PID
    const g1 = t.gpu;
    if (g1 && g1.outcome === 'ok' && g1.value) {
      const gsnap = g1.value;
      probe.gpuMs = mkRec(g1.elapsedMs, { unit: 'ms', windowS: null, n: 1, src: 'gpuEngines.elapsed@onTrigger', at: nowIso() });
      if (gsnap.engines.unavailable && gsnap.mem.unavailable) probe.gpuDeferred = gsnap.engines.unavailable;
      else {
        // only in-scope groups survive, keyed by group name; PIDs and every other process are discarded here
        const inScopePids = new Map();
        for (const r of (enumRes && enumRes.value ? enumRes.value.rows : [])) if (hangAllowedPids.has(String(r.pid)) && RESOLVER.classifyName(r.name) !== 'sys' && !selfLib.isSelf(r.pid)) inScopePids.set(String(r.pid), String(r.name).replace(/\.exe$/i, '')); // same group name as procs.groups[]
        probe.gpuAtHang = { pollMs: mkRec(g1.elapsedMs, { unit: 'ms', windowS: null, n: 1, src: 'gpuEngines.poll@onTrigger', at: nowIso(), prec: 1 }), byGroup: gpuSignals.perProcessByGroup(gsnap, (pid) => inScopePids.get(String(pid)) || null) };
        attachGpu(probe.culpritsAtHang, gsnap);
      }
    } else probe.gpuDeferred = `per-PID GPU poll ${g1 ? g1.outcome : 'skipped'}${g1 && g1.reason ? ` (${g1.reason})` : ''}`;
    void ctxInfo;
  }

  async function probeTick(k) {
    probeInFlight = true;
    const launchMs = Date.now();
    const r = await EXEC.execA(process.execPath, ['-e', ''], { timeoutMs: 10000, tier: 'hangProbe', opts: { stdio: 'ignore' } });
    const lat = Date.now() - launchMs;
    const atMs = Date.now();
    if ((r.enoent || r.code !== 0) && !r.timedOut) {
      fail('hang.events', 'spawnProbe', 'missing', `probe launch failed: ${(r.stderr || 'no output').slice(0, 120)}`, { at: new Date(atMs).toISOString() });
      probeInFlight = false;
      return;
    }
    const tSec = +((atMs - traceT0) / 1000).toFixed(2);
    const usedPct = (1 - os.freemem() / os.totalmem()) * 100;
    const nominalT = (k * probeEvery * INTERVAL) / 1000;
    const slipS = +(tSec - nominalT).toFixed(1);
    const fresh = lastCS && (atMs - lastCS.atMs) <= 4500 ? lastCS : null; // never carry a stale bundle forward
    const probe = sRecords.buildProbe({ atMs, tSec, ms: lat, hang: lat >= TH.hang, usedPct, slipS, bundleAt: fresh ? fresh.at : null, plugged: powerNow().plugged });
    if (r.timedOut) probe.degraded.push('probe killed at its 10 s timeout');
    const b = fresh || {};
    const bv = (key) => (b[key] && b[key].v !== undefined ? b[key].v : null);
    liveSpark.push(probe.hang ? '!' : SPARKS[Math.min(7, Math.max(0, Math.floor((usedPct - 50) / 6)))]);
    console.log(`  [live t+${tSec}s] ${liveSpark.slice(-60).join('')} (n=${liveSpark.length})`);
    if (tSec - (lastResT || 0) >= 10) {
      lastResT = tSec;
      console.log(`  [res t+${tSec}s] RAM ${usedPct.toFixed(1)}% commit ${bv('committed') ?? '?'}% pages ${bv('pages') ?? '?'}/s cpuQ ${bv('cpuQ') ?? '?'} slip ${slipS}s`);
    }
    if (probe.hang) {
      // the probe is appended when its on-trigger collection settles; the loop keeps sampling meanwhile
      pendingProbes.set(probe.at, probe);
      const done = collectAtHang(probe).catch((e) => { probe.degraded.push(`on-hang collection failed: ${String(e.message || e).slice(0, 100)}`); })
        .then(() => {
          pendingProbes.delete(probe.at);
          streamAppend('probe', probe);
          streamAppend('hang', { at: probe.at, tSec: probe.tSec, ms: probe.ms.v });
          console.log(`  !! HANG ${lat}ms at t+${tSec}s (${probe.at.slice(11, 19)}) RAM ${usedPct.toFixed(1)}% commit ${bv('committed') ?? '?'}% pages ${bv('pages') ?? '?'}/s cpuQ ${bv('cpuQ') ?? '?'} diskQ ${bv('diskQ') ?? '?'} snap ${probe.snapMs ? probe.snapMs.v : '?'}ms osConfirm=${probe.osConfirmed === null || probe.osConfirmed === undefined ? 'n/a' : probe.osConfirmed ? (probe.osHungWindows || []).join(',') : 'no'}`);
        });
      hangTasks.add(done); done.finally(() => hangTasks.delete(done));
    } else streamAppend('probe', probe);
    probeInFlight = false;
  }
  const hangTasks = new Set();

  while (Date.now() < runEndAt && !stopRequested) {
    // wall-clock grid; a missed tick is skipped, never replayed as a burst of samples
    const nowM = Date.now();
    let kk = ramN + 1;
    if (traceT0 + kk * INTERVAL < nowM - INTERVAL / 2) kk = Math.ceil((nowM - traceT0) / INTERVAL);
    ramN = kk;
    await sleep(Math.max(0, traceT0 + ramN * INTERVAL - Date.now()));
    if (Date.now() >= runEndAt) break;
    const freeGB = os.freemem() / 1024 ** 3;
    const usedPct = (1 - os.freemem() / os.totalmem()) * 100;
    const sampleMs = Date.now();
    const tSec = +((sampleMs - traceT0) / 1000).toFixed(2);
    const sample = sRecords.buildRamSample({ atMs: sampleMs, tSec, freeGB, usedPct });
    streamAppend('sample', sample);
    ramTail.push({ tSec, usedPct: sample.usedPct.v }); if (ramTail.length > 400) ramTail.shift();
    // warm-up: the session's own start-up would inflate the first spawn probes (observer-induced stalls); probes begin once
    // the first continuous sample has arrived, or after 15 s when there is no session
    const warm = !session || firstCS || (sampleMs - traceT0) > 15000;
    if (warm && !warmedAt) { warmedAt = tSec; console.log(`[telltale] hang probes start at t+${tSec}s (continuous tier warm)`); }
    if (warm && ramN % probeEvery === 0 && !probeInFlight) probeTick(ramN / probeEvery);
    if (sampleMs - lastMid >= 60000) {
      lastMid = sampleMs;
      HEAVY.run({ id: 'midTasklist', trigger: 'schedule', budgetMs: 4000, minIntervalS: 60, inference: 'proc.top_hoarders', fn: (c) => enumTasklistA(c, { withTree: false }) })
        .then((m) => {
          if (m.outcome !== 'ok' || !m.value || !m.value.rows) return;
          // only in-scope and system-set groups are ever inspected by name; out-of-scope rows are not read here
          WL.observeProcesses(m.value.rows); // in-scope lifecycle markers (out-of-scope rows are dropped inside)
          const midRes = resolveSnapshot(m.value.rows, { allowTree: false });
          if (inputHelper && inputHelper.status === 'running' && MATCHER.hasDescendantEntries) inputHelper.updateScope(RESOLVER.matchData());
          const midRows = [...midRes.inScope, ...midRes.system];
          const w = midRows.filter((p) => /warp/i.test(p.name)).reduce((a, p) => a + p.totalMB, 0);
          const o = midRows.filter((p) => /openspec|opencode|node/i.test(p.name)).reduce((a, p) => a + p.totalMB, 0);
          if (w) warpSeenMB = w;
          if (o) openspecSeenMB = o;
        }).catch(() => {});
    }
    // every 10 min: stop cleanly rather than fill the disk
    if (sampleMs - lastDiskCheck >= 600000) {
      lastDiskCheck = sampleMs;
      try {
        const st = fs.statfsSync(OUTDIR);
        const freeMB = (st.bavail * st.bsize) / 1048576;
        if (freeMB < 500) { fail('run.disk', 'diskGuard', 'disk-full', `only ${Math.round(freeMB)} MB free on the output drive (limit 500 MB); stopping the run cleanly`); stopRequested = 'disk-full'; }
      } catch { /* statfs unavailable: skip the guard */ }
    }
    if (process.env.TELLTALE_DEBUG_CPU && ramN % 20 === 0) { const cu = process.cpuUsage(); console.log(`[dbg] t+${tSec}s cpu user ${(cu.user / 1e6).toFixed(2)} sys ${(cu.system / 1e6).toFixed(2)} rssMB ${(process.memoryUsage().rss / 1048576).toFixed(0)}`); }
    if (ramN % Math.max(1, Math.round(10000 / INTERVAL)) === 0 || ramN === 1) {
      if (ramPrintedAt !== tSec) console.log(`  [${tSec}/${dur.usedS}s] RAM ${usedPct.toFixed(1)}% free ${freeGB.toFixed(2)}GB`);
      ramPrintedAt = tSec;
    }
  }
  clearInterval(lagTimer);
  WL.stop();
  const captureEndMs = Date.now(); // capture window ends here; finishing in-flight on-hang collection below is wrap-up
  // let on-hang collections finish inside their own budgets, then stop the observation
  await Promise.all([...hangTasks]);
  await HEAVY.whenSettled();
  const runEndMs = Date.now();
  const runEndIso = new Date(runEndMs).toISOString();
  OBSERVER.sample();
  // cumulative I/O of the tool and its session (one once-tier read before the session is stopped)
  {
    const ids = [process.pid, OBS_LAST.sessionPid].filter((x) => Number.isFinite(x) && x > 0);
    if (ids.length) {
      const io = ps(`Get-CimInstance Win32_Process -Filter "${ids.map((p) => `ProcessId=${p}`).join(' or ')}" -ErrorAction SilentlyContinue | ForEach-Object { $_.ReadTransferCount.ToString() + '|' + $_.WriteTransferCount.ToString() }`, 15000);
      let rd = 0, wr = 0, got = 0;
      for (const ln of io.stdout.split('\n')) { const m = ln.trim().match(/^(\d+)\|(\d+)$/); if (m) { rd += +m[1]; wr += +m[2]; got++; } }
      if (got) OBSERVER.setIo({ readMB: rd / 1048576, writeMB: wr / 1048576 });
      else fail('observer.io', 'observerMeter', 'counter-missing', 'process I/O counters unreadable for the tool and its session');
    }
  }
  // the observer cost is reported for the CAPTURE window; the end-of-run collection and report building that follow
  // are wrap-up, listed separately (wrapUpS) and not charged to the continuous tier
  OBS_CAPTURE = OBSERVER.report({ windowS: Math.max(0.001, (captureEndMs - traceT0) / 1000) });
  if (session) session.mgr.stop();
  if (keycap) keycap.stop();
  if (inputHelper) await inputHelper.stop();
  cont.finish(captureEndMs);
  stopWpr('trace-end');
  const admin = adminSnapshot(OUTDIR);
  console.log(`[telltale:end] admin tier done (${admin.tier}) - writing pack...`);
  await sleep(300); // flush

  // context values come from the continuous tier's first and last sample (no extra launches)
  const power = powerNow();
  const csv = (cs, k) => (cs && cs[k] && cs[k].v !== undefined ? cs[k].v : null);
  const c0 = csv(firstCS, 'committed'), pg0 = csv(firstCS, 'pages');
  const c1 = csv(lastCS, 'committed'), pg1 = csv(lastCS, 'pages'), availMB = csv(lastCS, 'availMB'), queue = csv(lastCS, 'cpuQ');
  // Private Bytes (commit charge, no shared-DLL double count) for top groups - verdict signal.
  // The tool's own PIDs (and this PowerShell) are excluded inside the script.
  const selfIds = selfLib.listSelfPids().join(',');
  const privRaw = ps(`$x=@(${selfIds}); Get-Process -ErrorAction SilentlyContinue | Where-Object { $x -notcontains $_.Id -and $_.Id -ne $PID } | Group-Object Name | ForEach-Object { $_.Name + '|' + [math]::Round((($_.Group | Measure-Object PagedMemorySize64 -Sum).Sum)/1MB) + '|' + $_.Count } | Sort-Object { [int]$_.Split('|')[1] } -Descending`);
  // names are classified before storage: only in-scope and system-set groups survive (top 12 WITHIN scope)
  const privateTop = privRaw.stdout.split('\n').map((l) => l.trim().split('|')).filter((p) => p.length === 3 && +p[1] > 0)
    .map(([name, mb, n]) => ({ name, privateMB: +mb, instances: +n }))
    .filter((p) => RESOLVER.classifyName(p.name) !== 'out' || (RESOLVER.noteOutName(p.name), false)).slice(0, 12);

  // --- end snapshots with fallbacks (P0: docker ps + wsl, not just stats which hangs when frozen) ---
  console.log('[telltale:end] snapshots done - collecting events, identities, admin signals (each announces; a stuck one stays visible)');
  const topEnd = snapTasklist();
  // ONE resolver: out-of-scope rows become an anonymous aggregate and never leave this call
  const endRes = resolveSnapshot(topEnd);
  const grouped = [...endRes.inScope, ...endRes.system];
  const endAllowedPids = endRes.pidSet();
  const dockerPs = sh('docker ps --format "{{.Names}} {{.Status}}"', 10000);
  if (dockerPs.code !== 0) fail('container.state', 'dockerState', 'missing', 'docker CLI absent or daemon unreachable');
  const dockerStats = dockerPs.code === 0 ? sh('docker stats --no-stream --format "{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}"', 10000) : { stdout: '', stderr: 'skipped (daemon missing)', code: 1 };
  // docker/WSL text is parsed to rows and resolved; raw text is never stored. Out-of-scope containers are a count.
  const dockerRowsAll = dockerPs.code === 0 ? scopeLib.parseDockerPs(dockerPs.stdout) : [];
  const dockerResolved = scopeLib.resolveNamedRows(RESOLVER, dockerRowsAll);
  let containers = null, containersNote = null, statsOutOfScope = 0;
  if (dockerStats.code === 0 && dockerStats.stdout.includes('|')) {
    const statsResolved = scopeLib.resolveNamedRows(RESOLVER, scopeLib.parseDockerStats(dockerStats.stdout));
    containers = statsResolved.kept; statsOutOfScope = statsResolved.outOfScope;
    if (!containers.length) containersNote = statsOutOfScope ? 'no running container is in the declared scope' : 'stats unparsable';
  } else containersNote = dockerPs.code === 0 ? 'stats frozen - vmmem aggregate stands' : 'no daemon - vmmem aggregate stands';
  const wsl = sh('wsl -l -v', 10000);
  if (wsl.code !== 0) fail('container.state', 'dockerState', 'missing', 'wsl absent');
  const wslResolved = scopeLib.resolveNamedRows(RESOLVER, wsl.code === 0 ? scopeLib.parseWslList(wsl.stdout) : []);
  const dockerSection = {
    present: dockerPs.code === 0,
    unavailable: dockerPs.code === 0 ? null : platformReason(dockerPs),
    containers: { total: dockerRowsAll.length, inScope: dockerResolved.kept.map((r) => ({ name: r.name, status: r.status })), outOfScopeCount: dockerResolved.outOfScope },
    statsOutOfScopeCount: statsOutOfScope,
    wsl: { present: wsl.code === 0, unavailable: wsl.code === 0 ? null : platformReason(wsl), distros: wslResolved.kept.map((r) => ({ name: r.name, state: r.state, version: r.version })), outOfScopeCount: wslResolved.outOfScope },
  };
  const disk = ps(`Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Format-Table DeviceID, @{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,1)}}, @{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}} -AutoSize | Out-String -Width 120`);

  // OS events windowed to the run (start - 60 s lead .. end); older records are history only.
  console.log('[telltale:end] event logs (1002/1000/2004, windowed to the run)...');
  const evRaw = {
    appHang: ps(eventsLib.eventQueryScript('Application', 1002)),
    appCrash: ps(eventsLib.eventQueryScript('Application', 1000)),
    resourceExhaustion: ps(eventsLib.eventQueryScript('System', 2004, { withMessage: true, provider: eventsLib.EXHAUSTION_PROVIDER })),
  };
  const evBuilt = eventsLib.buildEventsSection({ raw: evRaw, runStartMs: traceT0, runEndMs });
  for (const f of evBuilt.failures) fail('sys.os_events', 'winEvents', f.mode, f.reason);
  // event excerpts: provider, id, time, and in-scope name matches only; message text is never stored
  const eventsSection = scopeLib.sanitizeEventsSection(evBuilt.section, RESOLVER);
  const hangCount = eventsSection.inWindow.appHang.length;
  if (admin.skipped) fail('sys.admin_signals', 'adminSnap', 'tier', admin.skipped);

  // --- analysis: every rate and share uses the observed window (core), nulls carry reasons ---
  if (SIGNALS) streamAppend('signals', SIGNALS.summary());
  streamAppend('run-end', { at: runEndIso, status: 'complete', reason: null });
  finishing = true; // normal completion: interrupt handlers no longer write a summary
  const core = buildCoreReport({ ...stateFromStream(), ...samplingExtras(runEndMs, captureEndMs) }, { status: stopRequested ? 'complete' : 'complete', endReason: stopRequested || null, endedAt: runEndIso, streamName: path.basename(streamPath) });
  // stored form = provenance records; the analysis below reads the same data through the one accessor (plain)
  const spawnProbes = plain(core.spawnProbes), samples = plain(core.samples);
  const S = core.summary;
  const hangEvents = plain(core.hangEvents);
  const observedS = core.window.observedS;
  const bundleOk = spawnProbes.filter((s) => Number.isFinite(s.committed) && Number.isFinite(s.pages)).length;
  const lagP95 = S.loopP95ms;
  const calmShare = S.calmSharePct;

  const hasChromeHeadless = grouped.some((p) => /chrome-headless|playwright|chromium/i.test(p.name));
  const hasDockerVmmem = grouped.some((p) => /vmmem|docker/i.test(p.name)) || dockerPs.code === 0;
  const hasWarp = grouped.some((p) => /warp/i.test(p.name)) || warpSeenMB != null;
  const hasOpenspec = grouped.some((p) => /openspec/i.test(p.name)) || openspecSeenMB != null;

  // culprit ranking: only in-scope and system-set groups exist past this point (v0.5: no unknown names)
  const gpuNvidia = nvidiaSmi();
  if (SCOPED) console.log(`[telltale] scope: ${endRes.counts.inScopeGroups} in-scope + ${endRes.counts.systemGroups} system groups recorded; ${endRes.counts.outOfScopeGroups} groups (${endRes.share.outOfScope.memMB}MB) outside scope recorded only as an aggregate`);
  const fdCache = filedescFor(endRes.top(8).map((g) => g.name).filter((n) => !KNOWN[n.toLowerCase()]));
  console.log('[telltale:end] identities + application labels...');
  const hangCulprits = spawnProbes.filter((p) => p.hang && p.culpritsAtHang).flatMap((p) => p.culpritsAtHang);
  // command lines: in-scope PIDs only, read in memory to derive a label, then discarded
  const cmdByPid = cmdlineForPids([...endRes.top(8), ...hangCulprits].filter((g) => g.category === 'user').flatMap((g) => g.pids || []));
  const labeler = (g) => labelFor(g, cmdByPid, fdCache);
  const topRows = scopeLib.rowsForJson(endRes, { n: 6, labeler });
  const culprits = topRows.map((r) => ({ name: r.name, ...friendly(r.name, fdCache), detail: r.label, labelRule: r.labelRule, totalMB: r.totalMB, instances: r.instances, category: r.category,
    ...(r.gpuPct !== undefined ? { gpuPct: r.gpuPct, gpuMB: r.gpuMB, gpuPids: r.gpuPids, gpuN: r.gpuN } : {}) }));
  for (const c of hangCulprits) { const lab = labeler(c); c.detail = lab.label; c.labelRule = lab.rule; }
  const finalDecl = { ...SCOPE_DECL, counts: { ...endRes.counts }, fallbacks: [...RESOLVER.fallbacks] };
  const outAgg = scopeLib.runAggregate(endRes);
  const unresolvedCount = culprits.filter((c) => c.source === 'unresolved').length;
  // WER fault-bucket history: in-run entries kept apart from all-time history
  const wer = ps(eventsLib.werListingScript(), 30000);
  const werSec = eventsLib.parseWerListing(wer.stdout, traceT0, runEndMs);
  const werCounts = { total: werSec.history.total, apphang: werSec.history.apphang };

  // loop-lag is polluted by the prover's own synchronous work: supporting information only, never an input to a cause
  const loopNote = lagP95 !== null && lagP95 > 50 ? `loop p95 ${lagP95.toFixed(1)}ms (prover self-block confound - ignored for diagnosis)` : null;
  // zero usable samples still writes valid evidence, exits 0, never crashes
  if (samples.length === 0 && spawnProbes.length === 0) fail('run.usable_samples', 'traceLoop', 'skipped-overload', 'zero samples and zero probes recorded');
  if (getArg('--cost-min', null) !== null) console.log('[telltale] --cost-min is deprecated and ignored (it assumed lost minutes); time lost is measured from observed hangs. Pass --active-min and --cost-rate to extrapolate.');
  const userCost = { activeMin: num(getArg('--active-min', null)), ratePerHr: num(getArg('--cost-rate', null)) };
  const asset = assetBlock(systemProfile); // console line only; never stored

  const report = {
    tool: 'telltale v0.6', schema: core.schema, schemaStatus: core.schemaStatus, registry: 'registry v0.4',
    run: core.run, window: core.window, settings: core.settings,
    // the scope declaration leads the report; out-of-scope load is an anonymous aggregate
    scope: finalDecl, outOfScope: outAgg,
    observer: observerReport(),
    tier: TIER, startedAt: startedAt.toISOString(), hostname: ANON ? '<host>' : os.hostname(), anonymized: ANON,
    machine: { totalGB: +totalGB.toFixed(2), cpus: cpus.length, logicalCpus: cpus.length, cpuModel: cpus[0]?.model, uptimeMin: +(os.uptime() / 60).toFixed(1) },
    systemProfile,
    storage: core.storage,
    power: { scheme: powerScheme, plan: powerLib.parseActiveScheme(powerScheme), plugged: power.plugged, batteryPct: power.batteryPct, hasBattery: lastCS && lastCS.power ? lastCS.power.hasBattery : null, transitions: core.power.transitions },
    signals: core.signals, 'collection.notCollected': core['collection.notCollected'], procsSummary: core.procsSummary,
    admin, wprEtl,
    gpu: {
      nvidia: gpuNvidia,
      perProcessOnTrigger: spawnProbes.filter((p) => p.gpuAtHang).map((p) => ({ at: p.at, pollMs: p.gpuAtHang.pollMs, byGroup: p.gpuAtHang.byGroup })),
      note: 'GPU utilization and dedicated memory are per-sample series on spawnProbes[].gpu; per-process GPU is collected only on a hang and only for in-scope processes (no end-of-run full poll)',
    },
    summary: {
      ...S,
      committedStart: c0, committedEnd: c1,
      pagesStart: pg0, pagesEnd: pg1,
      availMB, cpuQueue: queue, loopN: lagRes.n,
      thresholds: { ...TH, sources: TH_SRC, settingSources: Object.fromEntries(Object.entries(SETTINGS.thresholds).map(([k, v]) => [k, v.source])), ideal: 'TBD (orders-framework ideal table)', status: 'provisional', rules: ruleParams.recorded(CFG.rules) },
      bundleOkProbes: `${bundleOk}/${spawnProbes.length}`,
      loopConfoundNote: 'loop-lag polluted by prover sync exec; supporting info only, excluded from diagnosis',
      loopNote,
      warpSeenMB, openspecSeenMB,
      unresolvedNames: unresolvedCount,
      werArchive: werCounts,
      hangCount,
    },
    hangEvents: core.hangEvents,
    userMarks,
    culprits, privateTop,
    topProcesses: topEnd.filter((p) => endAllowedPids.has(String(p.pid))).slice(0, 20),
    flags: { hasChromeHeadless, hasDockerVmmem, hasWarp, hasOpenspec },
    events: eventsSection,
    wer: werSec,
    docker: dockerSection,
    workload: core.workload, workloadConfig: core.workloadConfig,
    ...(core.inputStall ? { inputStall: core.inputStall } : {}),
    disk: disk.stdout.slice(0, 500),
    errors: [evRaw.appHang.stderr, evRaw.appCrash.stderr].filter(Boolean).map((s) => s.slice(0, 200)),
    'collection.failures': FAILURES,
    sampling: core.sampling,
    spawnProbes: core.spawnProbes, samples: core.samples,
  };

  // one ranked cause list, judged per hang against calm periods (lib/diagnosis); every other label derives from it
  diagnosisEngine.attachDiagnosis(report, { userCost });
  const DIAG = report.diagnosis;

  // Values are scrubbed BEFORE serialization; the file is parsed back after writing.
  // every string passes the scope guard first (backstop), then identity scrubbing, then the parse-back check
  const guardedReport = RESOLVER.guard(report);
  const outReport = ANON ? scrubValue(guardedReport, SCRUB_CTX) : guardedReport;
  // the guard is a backstop: any activation means a code path let an out-of-scope token reach a string (a bug to fix)
  if (RESOLVER.guardHits()) console.log(`[telltale] scope guard masked ${RESOLVER.guardHits()} out-of-scope token(s) (structural-leak backstop)`);
  const wr = writeJsonChecked(base + '.json', outReport);
  if (STREAM) STREAM.close();
  if (!wr.ok) { process.exitCode = 1; return; }
  // views are rendered strictly from the (scrubbed) JSON
  // md + report.html + email.txt (or md only with --no-report); all read the JSON just written
  if (hasFlag('--charts')) console.log('[telltale] --charts is deprecated: the report (with its charts) is written by default as .report.html; --print is accepted and does nothing extra');
  let viewsRes;
  try { viewsRes = renderPipeline.writeViews(base, { report: !hasFlag('--no-report'), anon }); } catch (e) { console.log(`[telltale] report rendering failed: ${String(e.message || e).slice(0, 300)}`); process.exitCode = 1; viewsRes = { written: [] }; }
  for (const w of viewsRes.written) console.log(`[telltale] wrote ${path.join(path.dirname(base), w)}`);

  for (const l of scopeLib.declarationLines(finalDecl, outAgg)) console.log(`[telltale] ${l}`);
  for (const l of workloadLib.summaryLines(outReport.workload)) console.log(`[telltale] ${l}`);
  console.log(`\n[telltale v0.6] finding: ${DIAG.finding.class}\n[telltale] ${DIAG.finding.sentence}\n[telltale] HANGS: ${hangEvents.length} >=${HANG_MS}ms (n=${spawnProbes.length} probes, ${observedS}s observed)\n[telltale] RAM timeline:\n  ${sparkline(samples, hangEvents)}\n  50% ${'-'.repeat(50)} 100% (! = HANG)`);
  console.log(`[telltale] asset: ${asset.manufacturer} ${asset.model} | RAM ${asset.ramFittedNote} | disk ${asset.diskNote} | OS ${asset.osCaption} (${asset.osBuild}) | warranty ${asset.warrantyDate}`);
  findingCard({ finding: DIAG.finding, rollup: DIAG.rollup, hwConfigSignal: DIAG.hwConfigSignal, culprits, power, powerScheme, hangEvents, calmShare, base });
}

// rebuild a summary report from a run stream (works when the run never wrote run-end)
function recoverMode() {
  const file = args[1];
  if (!file || file.startsWith('--')) { console.log('usage: telltale recover <stream.jsonl> [--out DIR]'); process.exitCode = 2; return; }
  let rec;
  try { rec = persist.recover(path.resolve(file)); } catch (e) { console.error(`[recover] cannot read ${file}: ${e.message}`); process.exitCode = 1; return; }
  if (!rec.start) { console.error(`[recover] ${file}: no run-start record; nothing to recover`); process.exitCode = 1; return; }
  const status = rec.end ? rec.end.status : 'unfinished';
  const endReason = rec.end ? (rec.end.reason || null) : 'no run-end record (process killed, crash, or power loss)';
  const report = buildCoreReport({ ...rec, observer: null }, { status, endReason, streamName: rec.streamName });
  diagnosisEngine.attachDiagnosis(report, {});
  const dir = args.includes('--out') ? OUTDIR : path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.basename(file).replace(/\.jsonl$/i, '');
  let out = path.join(dir, `${stem}.json`);
  if (fs.existsSync(out)) out = path.join(dir, `${stem}.recovered.json`);
  const anonOn = !!(rec.start.settings && rec.start.settings.anonymize && rec.start.settings.anonymize.value);
  const wr = writeJsonChecked(out, anonOn ? scrubValue(report, SCRUB_CTX) : report);
  if (!wr.ok) { process.exitCode = 1; return; }
  console.log(`[recover] ${rec.probes.length} probes, ${rec.samples.length} samples, ${rec.badLines} unreadable line(s) -> ${out} (run.status ${status})`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { COLLECTORS, main, recoverMode, sh, ps };
