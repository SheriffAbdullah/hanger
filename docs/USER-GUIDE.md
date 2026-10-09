# Hanger user guide

**Hanger: hang evidence, captured while it happens.**

Your terminal freezes for a few seconds, once a minute, and nobody can see it from outside.
Hanger is how you reproduce it with the evidence recording: you run it on your own machine
while you work, and it hands you a report and an email draft that already hold what IT needs
(system profile, what was running, ranked candidate causes, calm-versus-freeze numbers),
so the first ticket is complete and nobody has to ask for the same detail twice.

How it is used: IT asks a developer to run it; the report comes back complete. There is no
fleet rollout, no telemetry, and nothing leaves the machine until you send the files.

## Prerequisites

Windows 10+, Node 18+, PowerShell 5.1. No admin needed (admin unlocks thermal,
Sysmon, SMART, WER-system, SeDebug — everything else works unelevated).
No `npm install`: zero dependencies. No Mac/Linux collectors yet
(`check-stub` defines the contract the port must satisfy).

```
git clone <url> && cd machine-not-sufficient
node --version  # must be >= 18
node tools/hanger/hanger.js watch --watch-secs 10   # 10s sanity check
node tools/hanger/hanger.js trace --duration 60 --out ./reports --anonymize
# work normally; tap any key the moment it freezes
```

Persistent defaults live in `hanger.config.json` (scope path, duration,
anonymize) — CLI flags override it, `--config PATH` points elsewhere.

## Modes

- `trace` — deep incident capture (default 60s, up to 8 h with `--duration`; use 60s+ for intermittent hangs)
- `inventory` — local-only list of what is running (`reports/private/inventory-<stamp>.json`, never packed or shared); `--write-scope` drafts `hanger.scope.json`
- `record` — one-click 60s trace; with no scope declared it runs `inventory` first and drafts `hanger.scope.draft.json` (open scope when there is no terminal)
- `watch [--watch-secs N]` — light 2s watch log to `reports/watch/*.jsonl` from the same continuous counter session as `trace` (wall-clock bounded; `reports/baseline/` is still read for one release), hints when to trace
- `trace --preset dev` — template scope: node, docker executables, postgres, redis-server, chromium (writes a draft `hanger.scope.json` if none exists; `code` and `playwright` are not in it)
- `trace --only a,b` — ad-hoc scope (exact executable names or `*`/`?` patterns), recorded as source `flag`
- `check-stub` — 14 checks (14/14 on a healthy Windows WDDM box) toward the Mac port
- `trend` — compare reports over time; `pack` — approval JSON assembly (both name every unreadable report; pack and the renderers need `hanger-json/2`)
- `recover <stream.jsonl>` — rebuild a summary from a run that died. Every `trace` appends each sample, probe, hang, mark and failure to `reports/hanger-<stamp>.jsonl` as it is measured; a stream with no `run-end` record is `unfinished`. Ctrl+C writes an `interrupted` summary.
- Tests: `node --test tools/hanger/test/` (zero dependencies)

You get: timestamped HANG rows (spawn latency + RAM/commit/pages at that instant),
named culprits (`Node: server.js`, not `node.exe`), power truth (plugged? throttled?),
and a Finding card (one ranked cause list) — per-trace, never a verdict on your machine.

## Scope

Privacy here is **declared scope, not redaction**. You choose what Hanger may name; the run records only that
scope, and every view opens by saying what the scope was.

1. `node tools/hanger/hanger.js inventory --write-scope` lists what is running (local file under
   `reports/private/`, marked `"shareable": false`; `pack`, `trend` and the renderers refuse it) and drafts
   `hanger.scope.json` with every entry `"enabled": false`.
2. Edit the file: set `"enabled": true` on what you want monitored. An entry is a case-insensitive executable `name`
   (with or without `.exe`) or a `pattern` using only `*` and `?`. Friendly labels and command lines never match.
   `"includeDescendants": true` also scopes child processes, pinned by PID plus creation time (a reused PID is not adopted).
   An invalid file stops the run with exit code 2 naming the file and the key.
3. Run `trace`, `watch` or `record`. Scope comes from `--only`, then `--scope FILE` / config `scope`, then
   `--preset`, then `./hanger.scope.json`; with none of them the run is **open scope** and every view says
   `OPEN SCOPE: names of all running software may appear in this report`.
4. The report's `scope` block (source, path, SHA-256, entries, match rule, system set, counts) is the first thing in the
   JSON, Markdown, print page, pack and console summary. Software outside the scope is recorded only as an anonymous
   aggregate (group, process and memory totals), at run level and at every hang. Names of software outside the scope
   are not recorded; command lines are never persisted (in-scope processes get a derived label such as `Node: server.js`).

**System set (always monitored, list version 1).** Not user applications. OS components: System, Registry, Memory
Compression, Secure System, smss, csrss, wininit, winlogon, services, lsass, fontdrvhost, dwm, svchost (as
"Windows services"), SearchIndexer. Security products: MsMpEng, MpDefenderCoreService, NisSrv, SecurityHealthService,
SecurityHealthSystray, MsSense, Sense. Virtualization hosts: vmmem, vmmemWSL, vmmemCmFnd, vmcompute, vmwp,
docker-desktop, docker-desktop-data.

Not a compliance scanner: Hanger does not list, sign-check or judge software outside your declared scope.
`--hide`, `--focus` and `--extras` were removed (they exit with code 2): list what to monitor in `hanger.scope.json`.
`--log FILE` writes the run's own scope-resolved log (`elevated-trace.bat` uses it instead of redirecting raw console output).
The privacy canary (`node tools/hanger/test/canary-leak.js`, Windows) proves an out-of-scope process name reaches no file
and no console line.

## Workload session (phases, containers, WSL2, latency probe)

Hanger can see the workload that reproduces the hang (Postgres, Docker), not just the machine. Everything here is
declared by you and obeys the declared scope: a container, image or distro is named in the report only when it is in
scope, everything else is an anonymous count and total.

- **Phases.** `--phase idle,loaded` gives the labels for successive presses of the phase key `p` (the key then starts or
  stops a phase instead of leaving a mark); `--phase-now` opens one at run start; a scope file `"phases": [...]` supplies the
  label order when no flag is given. Each bound is written to the run stream the moment it happens, so a killed run still
  shows which phase a hang fell in (an open phase is reported `unfinished`). The report's `workload.phaseSummary` compares
  each signal per phase (mean, p95, n, unobserved seconds); samples outside every phase are counted as `untaggedN` and
  included in neither side. With no phases the report says `no workload phases were declared`.
- **Lifecycle markers.** Start and exit of in-scope processes (about 60 s resolution, from the periodic process snapshot)
  and start and stop of in-scope containers (about 10 s) become `workload.markers[]`. Out-of-scope lifecycle is never recorded.
- **Containers and the WSL2 VM, over time.** Per in-scope container CPU % and memory used / limit every 10 s
  (`workload.containers.series[]`, plus an anonymous out-of-scope aggregate). The VM host memory (the `vmmem` working
  set) and the configured cap from `%UserProfile%\.wslconfig` (`workload.vm`); guest memory only when an in-scope distro is
  already running. Hanger never starts a stopped VM or distro. When Docker is absent, stopped or unresponsive the values
  are null with a fixed reason (`not installed`, `not running`, `unresponsive (timed out after N s)`); raw shell error text is
  never stored. Each call is time-bounded and a timeout doubles the poll interval up to 60 s.
- **Latency probe (opt-in).** A `probes` entry in the scope file runs your command every `everySec` (at least 2, default 5)
  seconds and records only wall time and a status (`ok`, `nonzero`, `timeout`, `not-found`). The command is an argument
  list, never a shell string; it is not echoed anywhere (only its `name` is), its output is discarded, it has a timeout
  (default 5 s), it is never run from an elevated session (so not under `elevated-trace.bat`) and it stops after three
  consecutive `not-found` results.
- **Configuration facts (opt-in).** A `config` entry reads Postgres `shared_buffers`, `work_mem` and `max_connections` only
  when the database is in scope and reachable without a password (`-w`, connect timeout 3 s), or the configured WSL memory
  cap. Facts land in the top-level `workloadConfig[]` as a value or an unavailable reason with their source. Credentials
  are never stored or prompted for: any key named like `pass`, `pwd`, `secret` or `token` rejects the scope file at load.

```json
{
  "version": 1,
  "entries": [{ "name": "postgres" }, { "name": "docker" }, { "name": "com.docker.backend" }],
  "phases": ["idle", "loaded"],
  "probes": [{ "name": "pg-select1", "command": ["docker", "exec", "pg", "psql", "-U", "postgres", "-c", "select 1"], "everySec": 5, "timeoutMs": 5000 }],
  "config": [{ "kind": "postgres", "container": "pg" }, { "kind": "wsl" }],
  "drives": ["D:"]
}
```

Optional `"drives": ["D:"]` declares which drive letters hold the monitored workload. It is the only way the report knows the workload drive: it is never guessed from process activity, and without it the report says "workload drive not declared".

Container scope matches on the container name or the image's base name (`postgres:16` matches an entry named `postgres`).
Run it with `node tools/hanger/hanger.js trace --duration 120 --phase loaded --scope ./hanger.scope.json`.

## How it samples (and what that costs)

The tool must not become the load it is trying to explain, so observation is split into tiers:

- **Continuous** (every 2 s): one long-lived helper process reads all Windows performance counters through a single
  query. There is **no process launch per tick** for this tier. The achieved median and p95 interval are recorded in
  `sampling.cadence`; a gap longer than twice the nominal interval is written as an unobserved interval in
  `sampling.unobserved[]` (never interpolated), and rates and shares divide by the observed time only.
- **Hang probe** (every 2 s): the one per-tick launch (a tiny `node` start-up time). It begins after the continuous tier
  is warm (`sampling.duration.probesStartedAtS`) so the helper's own start-up is not read as a hang.
- **On a hang** (and on a slow schedule): process snapshot, not-responding poll and per-process GPU run asynchronously,
  each inside its own time budget (`sampling.heavyRuns[]` says what ran, how long it took, and why it was skipped or cut
  short). There is no global "the machine is melting" switch that disables them.
- **Observer cost**: the tool measures its own CPU, private memory, I/O and launches per minute (`sampling.observer`),
  checks them against a declared budget (2% of one logical CPU, 150 MB) and prints one line when a run exceeds it. Its
  processes are never counted as workload.
- **Marks**: a key press is stamped by a small helper process at the moment you press it, so a busy collector cannot
  delay it. Every stored value is a record `{v, unit, windowS, n, src, at, prec}` rounded to the precision of its unit;
  counters parse the same under any display language or decimal separator. See `tools/hanger/lib/sampler/README.md`
  for how a new collector registers.

## Input-response check (automatic)

What it does: when you have just typed or clicked and the foreground application does not answer a trivial liveness
request within 250 ms, the run records a **stall sample**; adjacent samples merge into an **episode** (start, end,
duration, worst latency). It needs no action from you and no administrator rights, and it is on by default: the console
says so at the start of every run (`input timing is observed without recording what is typed or clicked`).

What is observed, and what is not:

- Observed: the fact and time that input occurred (one system-wide "last input" time that does not say which key, button
  or device), and how long the foreground application takes to answer. The foreground application is named **only** when
  it is in your declared scope (or the fixed system set); any other application is written as the literal `out-of-scope`
  with no name, process id or title.
- Never observed or stored: keys, typed text, window titles, the clipboard, pointer positions, per-event counts. There is
  no keyboard hook and no raw-input listener; `node --test` searches the helper source for such mechanisms and
  `node tools/hanger/test/canary-leak.js` types a canary string into a test window (with a canary title and an
  out-of-scope canary foreground name) during a trace and requires zero hits in every file and console line.

How it works: a small separate helper process (compiled once with the in-box .NET Framework C# compiler and cached in
`%LOCALAPPDATA%\hanger\bin\`; a PowerShell host is the fallback) stamps every observation with its own clock and
appends it to `hanger-<stamp>.input.jsonl` beside the run stream, so a stalled or killed main process cannot delay or
lose it. `recover` merges that file. If a managed laptop (AppLocker, WDAC, endpoint protection) blocks the helper, the run
continues and the report says `Input-response check: not available (<reason>)` with the reason, never a zero.

What the report shows (evidence section, charts, finding line and the email draft): episodes and where they fall on
every chart (hatched bands), evaluated, idle and not-evaluable time (locked screen, secure desktop, elevated foreground,
remote session, suspend and resume, no foreground window are never judged), a calm baseline, helper wake-lateness, how
many episodes were corroborated by the probe, Windows not-responding, your marks or a workload probe, and **probe
agreement**: of the probe's hangs during evaluated time, the share that overlapped a felt stall (precision), and of the
felt stalls, the share the probe's hangs overlapped (recall), each with its numerator and denominator at a 2 s join, plus
recall for stalls at least as long as the probe interval. A felt stall the probe missed is the point of the check.

What it cannot see: waits inside an application whose interface keeps answering (a database call behind a responsive
window), freezes of the system's own input thread, stalls while you provide no input, and anything it declines to judge.
An episode is a lower bound (the check stops asking once input has been quiet for the recent-input window).

Defaults, all provisional: stall threshold 250 ms, recent-input window 1000 ms, merge gap 1000 ms, late threshold 200 ms,
tick 250 ms, request timeout 1000 ms. Turn it off with `--no-input-stall` or `"inputStall": {"enabled": false}`.
`hanger.config.json` keys under `inputStall`: `enabled`, `stallMs` (flag `--stall-ms`), `recentInputMs`, `mergeGapMs`,
`lateMs`, `tickMs`, `timeoutMs`, `ignoreGroups` (in-scope groups to ignore; the ignored sample counts are reported).
`pack` keeps the thresholds recorded in the trace. A hang confirmed only by the input-response check carries half the
confirmation weight of a user mark (weights are recorded in the diagnosis).

Cost, measured on the development laptop (HP ProBook 440 G9, 12 logical CPUs, 2026-10-08): over a 10-minute trace with
typing for 3 minutes the helper used 0.78 s of CPU (0.13% of one logical CPU) and 16 MB private memory; four 3-minute
runs read 0.1% to 0.2% and 15 MB. That is under the helper budget below. The tool's total observer cost (mostly the
existing counter session) varied from 1.6% to 5.4% of one logical CPU from run to run, with and without the helper, so
the helper's share of it is about 0.1 to 0.15 percentage points; the total regularly exceeds its own 2% budget on this
laptop and the report says so.
Budget: 0.5% of one logical CPU and 40 MB private (100 MB when the PowerShell host runs it), reported in
`sampling.observer.helper` with an exceedance line on the console.

A later change (`global-hang-marking`) will let you add a mark with a global shortcut from any application; it will reuse
this helper's process and file.

## Signals collected every 2 s

All of these ride the one counter session (no per-tick launch) and appear as per-sample values on `spawnProbes[]`
(and in the watch log). A value the machine does not expose is `null` with a reason in `collection.failures[]`
(`not-exposed`, `tier`); a missing reading is never stored as 0.

| Signal | Where | Notes |
|---|---|---|
| CPU per process, as a share of the whole machine (0-100) | `procs.groups[]`, `procs.system[]` | in-scope groups and the system set by name; everything else only as the anonymous `procs.outOfScope` aggregate (group count, CPU, I/O, working set). `procsSummary` has per-group mean/peak over the run |
| Disk read/write bytes per second per process | same rows | in-scope and system-set only |
| Processor performance and limit | `cpu.perfPct` (can exceed 100), `cpu.perfLimitPct`, `cpu.throttleReasons` | turbo-aware: the legacy `maxFreq` reads 100 on a laptop clamped to base clock |
| Temperature per labelled zone, deg C | `thermal.zones[]` | no admin where the platform exposes it; readings outside 5-130 C are dropped and counted |
| AC/battery, battery %, power mode, energy saver | `power` (each value has an as-of time); `power.transitions[]` | check-stub says "no system battery" only when the platform reports none |
| Commit bytes and limit, pages in and out, pagefile % | `mem` | |
| Disk latency (ms), queue, busy %, throughput | `disk` | |
| Network bytes/s and errors per adapter, VPN adapter presence | `net.adapters[]` | aggregate only, never per process |
| GPU utilization (derived from engines) and VRAM | `gpu` | per-process GPU is read only on a hang, only for in-scope processes, and its poll time is recorded |
| System handle count | `sys.handleCount` | |

CPU per process is the per-core-scaled counter divided by `machine.logicalCpus`, so 270 on a 12-CPU machine is 22.5.
Security software is normalized the same way (`defender` is a share of the whole machine). The per-process series matches
a scope entry by process name only, even for an entry with `includeDescendants` (the `procs.scopeNote` says so). The
tool's own `node` and `powershell` processes are included in a group of the same name (flagged `includesObserver`);
the observer cost is reported separately. The EcoQoS batch is removed (it returned no data); it is listed in
`collection.notCollected[]`.

## System profile for IT

Every `trace`/`record` collects static machine facts once, before sampling starts, into the
report JSON under `systemProfile` (the `[profile]` console line is a one-line digest). Each
fact is `{value | null, source, tier, asOf, unavailableReason?}`: a number or text, or null
with the reason (never blank, never zero for unknown). Groups: identity, processor (physical
cores and logical processors are separate facts), memory modules and slots, storage (media,
bus, health, system volume), graphics and driver, firmware, OS (VBS, memory integrity,
uptime), power plan and battery health, pagefile and commit limit, WSL/Docker Desktop
versions and configured limits, and OS-registered security products with domain/MDM state.

- The **firmware serial is shown to IT, even under `--anonymize`**; the hostname is replaced
  by `<host>`. `--serial X` overrides it (recorded as `user-input`).
- Security product names (Defender and similar) are listed because they are IT-installed;
  no other software is named in the profile.
- Unelevated runs attempt user-tier facts only. Admin-only facts (disk wear, Hyper-V/VM
  platform state, battery-report fallback) show `requires elevation` and `tier: admin`.
- Reads only; it never starts a container, a WSL distribution, or a workload. Cost
  is recorded as `systemProfile.collectionMs`. The old `asset` alias is gone (removed with the schema freeze); every view reads `systemProfile`.

## Diagnosis (one ranked cause list)

Every trace carries `diagnosis`; all views, the pack, `trend` and the console derive from it.

- **Hang** = a hang probe (time to start a trivial process) at or above `--hang` (default 800 ms). The probe alone cannot see UI lag that does not delay process start, or freezes between probes; the automatic input-response check (below) observes the first of these and says how often the probe's hangs match what a user felt. It still cannot see waits inside an application whose interface keeps answering. Keys pressed at a felt freeze are `hung` marks; a mark within 2 s confirms a hang, and precision/recall against marks are reported (`not validated` with no marks).
- **Judged at the hang, against calm.** Each rule reads the values at the hang and compares them with the calm mean (probes under the recovery threshold, at least 10 s from any hang), never a run-wide peak. Probes the tool itself slowed (startup, collection over 2 s, slip over 1 s) are excluded and counted.
- **Minimum evidence.** At least 10 usable probes to rank causes; at least 3 probes for "sustained". Otherwise the finding is `no-freeze-observed` or `insufficient-evidence`.
- **Finding classes:** `memory`, `cpu`, `disk`, `thermal-power`, `gpu`, `security-software`, `outside-scope`, `undetermined`, `no-freeze-observed`, `insufficient-evidence`. The finding is an association sentence ("4 of 5 usable hangs coincide with memory pressure; commit 90% at hangs vs 62% calm (n=...)"), never a certainty. The word STATE and the old RAM-BOUND/PRESSURED labels are gone.
- **Confidence is derived**, not constant: threshold crossing, hang-vs-calm delta, co-occurrence share, confirmation share and a confound penalty, with published weights, capped at 0.95. Every rule input is `{ref, signal, at, value, unit}` and resolves to a stored probe in the same JSON.
- **Outside the declared scope** is a cause: machine pressure while in-scope groups hold under 30% (not evaluable in open scope).
- **OS not-responding** counts only in-scope, non-suspended windowed processes polled at the hang; a late poll is `not-evaluated`.
- **Time lost** appears only with at least one hang, from measured hang seconds and the observed window, in the appendix. `--active-min` with `--cost-rate` adds a labelled user-supplied extrapolation. `--cost-min`, `--ram-cost`, `--laptop-cost` are ignored.

### Cause rules and suggested actions

Fifteen rules run at every usable hang (the five core rules, nine from `diagnosis-cause-rules`, and `disk-nearly-full` from `storage-coverage`). Each result carries its inputs (resolvable evidence references), the threshold with its source, the calm mean with n, a derived confidence, an evaluated disprover and its confounds. A rule whose signal was not recorded is `fired: null` ("not evaluated") with the missing signal named; absence is never read as "ruled out". Rules judge on the usable probes within +-10 s of the hang (3 or more for "sustained"), never a trace-wide peak or minimum.

| Rule | Class | Fires when (defaults, all provisional) | Disproved when |
|---|---|---|---|
| `commit-limit-pressure` | memory | commit >= 90% of the limit, page file rising >= 2 points, available < 5% of RAM | commit < 80% at 2/3 of hangs |
| `hard-fault-thrash` | memory | pages written out >= 100/s, page file rising, modified list growing >= 5% (pages read in alone never fires) | pages out < 20/s at every hang |
| `vm-memory-dominance` | memory | VM host (`vmmem*`) >= 40% of RAM and the configured VM cap absent or above 50% of RAM | cap <= 50% of RAM, or VM < 25% at 2/3 of hangs |
| `database-memory-io` | memory or disk | in-scope database group: memory (+ configured settings) >= 25% of RAM, or disk latency >= 25 ms with queue >= 1 while it does I/O | latency < 10 ms and memory < 10% of RAM at every hang |
| `single-process-dominance` | memory | one in-scope or system-set group >= 40% of used memory, or monotonic growth >= 10% over >= 3 snapshots | no group >= 20% and no growth at any hang |
| `thermal-power-throttle` | thermal-power | CPU >= 50% and performance < 60% of the calm median (turbo-aware) or an active performance limit | performance >= 90% of the calm median at 2/3 of hangs |
| `battery-power-plan` | thermal-power | battery hang rate per minute >= 2x the AC rate (3+ hangs and 10+ probes per side), or 2/3 of hangs under an efficiency mode while < 1/3 of calm probes are | rates within 1.25x |
| `driver-interrupt-storm` | cpu | DPC + interrupt time >= 10% | below 3% at every hang |
| `disk-nearly-full` | disk | the system volume, a volume holding a pagefile or a declared workload drive has < 10% free on 3+ probes near the hang, or < 15% free while its free space falls by >= 500 MB across the run | free space >= 25% at 2/3 of hangs |
| `gpu-contention` | gpu | busiest engine >= 90%, or dedicated memory >= 95% of its total (when a total is known) | engine < 50% and memory < 80% at every hang |

Parameters are recorded in `summary.thresholds.rules.<ruleId>.<param>` and can be overridden in `hanger.config.json`: `{ "rules": { "driver-interrupt-storm": { "sumPct": 15 } } }`. They are provisional until cited.

`diagnosis.suggestedActions[]` maps each fired, non-disproved rule to one action from a fixed table, cheapest first (never ordered by confidence), each citing its rules and the `k/M` hangs: security-software exclusions, VM memory cap, AC power / power mode, driver and firmware check, application memory use, storage health, installed-memory comparison with the workload's commit need. The wording never recommends a purchase. Rules without a mapped action (`memory-pressure`, `cpu-saturation`, `outside-scope`) contribute none; an empty list means "no action suggested by this evidence".
### Storage: per drive, free space, pagefile placement

- **Per physical drive.** Latency, queue, busy time and read/write throughput are recorded for every physical drive beside the machine total (`spawnProbes[].disk.drives[]`), so a slow drive no longer hides behind a fast one. A drive is labelled `Disk 1 (D:)` (disk number and volume letters) and, in views, by its class from the system profile (for example "NVMe SSD"); no serial number is ever read. When Windows does not expose per-drive counters the value is `null` with a reason and the views say "Per-drive disk data: not available (reason)".
- **Free space** per volume letter is recorded the same way (`disk.volumes[]`). `disk-nearly-full` judges only the volumes that can matter: the system volume, volumes holding a pagefile, and drives you declared in the scope file's `drives`. If none can be identified every volume is judged and the result says so. Limits are provisional; override them in `hanger.config.json`: `{ "rules": { "disk-nearly-full": { "lowFreePct": 15, "warnFreePct": 20, "fallMB": 300, "disproveFreePct": 30 } } }`. A run with no volume readings is "not evaluated", never "ruled out".
- **Pagefile placement.** The system profile records the drive of each pagefile. The `disk-stall` rule fires on one slow drive even when the machine total looks fine, names it, and states whether it hosts the pagefile and the declared workload (yes, no, or unknown with the reason).
- **Who drove the I/O.** A disk finding names a process group only when it is in your declared scope (or the fixed system set) and holds at least half of the observed disk I/O at 5 MB/s or more (`disk-stall` parameters `culpritMinBps`, `culpritSharePct`). When load outside the scope leads, the report states only its rate and group count: "dominated by load outside the declared scope". Out-of-scope names never appear.
- **Known confound: file-sync clients.** A sync client such as OneDrive reading or writing files under the monitored folders (including a synced repository folder) can cause or mimic a disk stall. It is named as a confound only when it is in your declared scope or the system set and was active near the hang (`syncClientBps`, default 1 MB/s); if it is outside the scope it appears only in the anonymous aggregate. To see it, add it to the scope file.

### Adding a cause rule

Drop a module in `tools/hanger/lib/diagnosis/rules/` exporting `{id, class, phrase, valueLabel, evaluate(ctx, hang, prior), disprove(ctx, hang)}`; the engine loads it, validates every result against the contract, derives confidence, ranks it and writes it into the finding. Optional: `after: [ruleIds]`, `priority`, `describe(ctx, fired)`; `evaluate` may return a per-hang `class` (a variant of the module class). Files starting with `_` in the rules folder are helpers, not rules (`_kit.js`). Build inputs with `ctx.input(probe, signal)`; register new signals with `lib/diagnosis/signals.js` `register()` (or `registerFamily()` for `name[arg]` signals such as a process group), as `lib/diagnosis/cause-signals.js` does. Return `fired: null` with a reason when data is missing. The full contract is in the header of `lib/diagnosis/engine.js`.

## Outputs (the report you send to IT)

Every `trace` / `record` writes four files per run stamp in `--out` (default `reports/`), all rendered from the one JSON file (JSON is truth):

| File | What it is |
|---|---|
| `hanger-<stamp>.json` | the evidence (`hanger-json/2`, frozen). Attach this. |
| `hanger-<stamp>.report.html` | the report: one self-contained A4 page, no network, no script needed. Charts are inline SVG on one wall-clock axis (freeze strip, memory, CPU, clock/thermal/power, disk, top in-scope processes; GPU only when present) with freezes, your marks, workload phases, AC/battery and unobserved intervals drawn on every chart. Open it and print to PDF; the charts print. Attach this too. |
| `hanger-<stamp>.md` | the same sections as text |
| `hanger-<stamp>.email.txt` | a ready-to-send email draft built only from the JSON (every number in it is checked against the JSON). It lists the attachments with sha256 prefixes and repeats the scope (an open scope carries a warning). **The tool never sends anything**; paste it into your mail client. The same text is a copy block in the report after section 3. |

Report order: 1 run and scope (what was monitored, first), 2 finding, 3 what IT can do (cheapest first, each tied to a rule), 4 evidence (ranked causes, at-freeze versus calm per rule, charts), 5 system profile (every fact with value or the reason it is missing), 6 gaps and receipts in plain words, 7 appendix (culprit table, events during versus before the run, method, file hashes). `pack` writes the same layout as `pack-<stamp>.report.html`.

- `--no-report` writes only `.json` and `.md` (for CI). `--charts` is a deprecated alias (it prints a notice; the report is always written); `--print` is accepted and does nothing extra.
- The legacy `.html` view and the separate `.charts.html` (which loaded a script from a CDN) are removed.
- Re-render any saved JSON: `node tools/hanger/render-print.js <trace-or-pack.json> [out.report.html] [--email out.email.txt]`. The HTML cannot contain its own hash, so its copy block says the report's hash is listed in the `.email.txt`.

## Positioning

Evidence surface, not a judge. Numbers + ranked candidate causes with evaluated disprovers.
Thresholds are CLI flags, all provisional, ideals TBD. See PRODUCT_MANIFESTO.md.
Reports stay local (`reports/` is git-ignored — your machine data never ships
unless you attach it).
