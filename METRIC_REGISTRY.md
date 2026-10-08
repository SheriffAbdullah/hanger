# Metric Registry — telltale v0.4 (merged from 3 spec crews)

Rule (manifesto): every value emits `{id, value, unit, windowS, n, threshold?, conf?}`.
First-order never overwritten. Thresholds recorded per report. Version: `registry v0.4`.

## A. OS first-order (no admin, no wmic)

| id | unit | collector | cadence | healthy | confounds |
|---|---|---|---|---|---|
| `mem.committed_pct` | % | `Get-Counter '\Memory\% Committed Bytes In Use'` | 2s (probe bundle) | <75 ok, 75–85 watch, >85 stall-risk | grows w/o used% moving; 80% = real ceiling |
| `mem.available_MB` | MB | `Get-Counter '\Memory\Available MBytes'` | 2s | >3000 ok, <1500 pressure | SuperFetch/cache noise; read with committed |
| `mem.pages_per_sec` | pg/s | `Get-Counter '\Memory\Pages/sec'` | 2s, judge on 5s avg | <50 idle, <200 loaded, >500 sustained = thrashing | single spike ≠ proof; AV bursts |
| `mem.faults` / `mem.trans_faults` | faults/s | `'\Memory\Page Faults/sec'`, `'\Memory\Transition Faults/sec'` | 2s | trans <1000 | soft faults normal; need pages/sec to confirm hard stall |
| `cpu.queue_len` | threads | `'\System\Processor Queue Length'` | 2s | 0–2 ok, >4 sustained CPU-starved | single-sample noisy |
| `cpu.pct_total` | % | `'\Processor(_Total)\% Processor Time'` | 2s | <60 ok; 100%+freeze=spin, low%+freeze=I/O wait | 250ms aliases; 2s bundle only |
| `cpu.ctx_switches` | ctx/s | `'\System\Context Switches/sec'` | 2s | <10000 | scales w/ cores; DPC storms inflate |
| `disk.queue_total` | ops | `'\PhysicalDisk(_Total)\Current Disk Queue Length'` | 2s | <1 ok, >2 sustained stall | SSD hides latency; pagefile I/O identical to app I/O |
| `disk.sec_per_transfer` | s | `'\PhysicalDisk(_Total)\Avg. Disk sec/Transfer'` | 2s | <0.010 SSD ok, >0.025 stall | meaningless when queue=0 |
| `pagefile.use_pct` | % | `'\Paging File(_Total)\% Usage'` | start/end only | <10 ok, >25 + high commit = backing-store active | monotonic; sample rarely |
| `power.scheme` / `cpu.pct_maxfreq` | str / % | `powercfg /GETACTIVESCHEME` + `'\Processor Information(_Total)\% of Maximum Frequency'` | once + 2s | >90%max on AC; <60 in hang = throttle alibi | EC caps, thermals, battery vs AC |
| `proc.alibi_defender_cpu` | % of machine | `'\Process(*)\% Processor Time'` summed over the registered security products, divided by logical CPUs (see section E) | 2s | ~0 idle; spike+hang = AV alibi | per-core-scaled raw values (79-190 on 12 CPUs) were compared with a 20 threshold before; now 0-100 of the whole machine |
| `gpu.total_util` / `dwm_MB` | % / MB | `'\GPU Engine(*)\Utilization Percentage'` summed per adapter and engine type, busiest type = total (WDDM exposes no `_Total`); see section E + tasklist dwm/warp | 2s | util<50, dwm<300MB | derived, not a platform total; per-process GPU only on a hang for in-scope PIDs |
| `sys.event_hang/crash/exhaust` | rows | `Get-WinEvent` App 1002/1000, System 2004, `-MaxEvents 5` | once/run | 0 fresh | Security log/ETW need admin — never poll |

Cost note: one bundled ps call per 2s (~150–300ms) replaces 7 separate calls. No polling at 250ms.

## B. App/process first-order

| id | unit | collector | cadence | healthy | confounds |
|---|---|---|---|---|---|
| `proc.rollup.<name>` | MB WS + n + pids≤4 | `tasklist /FO CSV`, group lowercase sum | start/end + on-HANG | top-5 stable | short-lived Playwright children inflate n |
| `proc.private.<group>` | MB commit | `Get-Process PM` (PagedMemorySize64) top groups | start/end | node<400; Br-uxendm<200 | PM excludes shared; use for verdict |
| `proc.cpu.<group>` | % | CPU-seconds delta / wall / cores, ±5s around hang | on-HANG | warp/node<15% sustained | cumulative wraps; first sample 0 |
| `proc.handles/threads` | count | `Get-Process Handles,Threads.Count` | start/end; Δ alert >+200 | flat ±10% | worker threads legit; compare parent+children |
| `proc.tree` | PID→PPID | `Win32_Process PPID,CommandLine` for node/playwright | on-HANG + end | depth≤3 | match by CommandLine, not name |
| `docker.state` | text | `docker ps` + `vmmem` WS + `wsl -l -v`; `stats` 10s timeout, never gate verdict | end + on-HANG | daemon <3s | stats blocks when frozen |

Verdict uses Private/commit; WS only for footprint ranking.

## C. Second-order (computed, threshold-explicit)

| id | formula | threshold param |
|---|---|---|
| `hang.count` | `probes.ms ≥ HANG_MS` | `--hang 800` (provisional) |
| `hang.rate_per_min` | count/DURATION*60 | — |
| `hang.pct_frozen` | `Σhang.ms/window_ms*100` (full stall; also report excess-over-threshold) | state assumption |
| `hang.mttr_ms` | median next-OK probe ms + wall gap | — |
| `hang.context[W=±10s]` | pre/post arrays: RAM%, committed, pages, cpuQ, diskQ, culprit Δ | W=10s |
| `hang.correlation` | Pearson/Spearman `hang.ms ~ lagged(metric)` lags 0/5/15s, report r,n,lag | n≥5 hangs or penalize |
| `culprit.attribution` | `conf = .4*share + .3*co-occur + .2*pagingAgree + .1*eventAgree`, cap .95 | never 1.0 |
| `cost.time_lost` | hangs/hr × mttr × hrs/day × $/hr | params, not hardcoded |
| `user.marks[]` | keypress wall timestamps; precision/recall vs detected hangs | ground truth |

## D. RCA procedure (per HANG row, ordered, each with disprover)
1. Probe valid? non-hang neighbors also slow w/o memory signals → scheduler/AV.
2. RAM? used>85 / committed>85? disproved if committed<70 + free>2GB.
3. Paging? pages>500 sustained in W? disproved if <100 pre+post → CPU/power.
4. Loop? loopP95>50ms in W? disproved if normal → child-spawn/IO.
5. OS events near `at`? +0.1–0.2 conf; absence caps ≤0.7.
6. Culprit: largest ΔMB in W + persistent top; disproved if flat while other spikes.
Output: ranked `[{cause, conf, supporting, disprover}]`.

## E. v0.4 implementation map
- 2s probe bundle: 1 ps call → committed, avail, pages, faults, cpuQ, cpu%, ctx, diskQ, diskSec, defender → attach to `spawnProbes[]`.
- On-HANG culprit snapshot (tasklist) + Private Bytes top groups; pre/post hangContext slices from 250ms RAM ring.
- `user.marks[]` via stdin keypress (TTY only). `hang.pct_frozen`, `mttr`, `rate` in summary.
- Registry version + thresholds + assumptions in every JSON.

## E. data-signals-completeness: API mapping (non-binding; the specs state the datum, not the API)

| datum (stored key) | counter / call | normalization | cadence |
|---|---|---|---|
| `cpu.perfPct`, `cpu.utilityPct` | `\Processor Information(_Total)\% Processor Performance`, `% Processor Utility` | none (can exceed 100) | 2s |
| `cpu.perfLimitPct` | `\Processor Information(_Total)\% Performance Limit` | 100 minus the counter (0 = not limited) | 2s |
| `cpu.throttleReasons` | `Performance Limit Flags`; `\Thermal Zone Information(*)\Throttle Reasons` | non-zero masks listed as `perf-limit-flags:0x..`, `thermal-zone-reasons:0x..` | 2s |
| `cpu.dpcPct`, `cpu.interruptPct` | `\Processor(_Total)\% DPC Time`, `% Interrupt Time` | none | 2s |
| `thermal.zones[].c` | `\Thermal Zone Information(*)\High Precision Temperature` (tenths of K) else `Temperature` (K) | minus 273.15; keep 5-130 C | 2s |
| `mem.committedBytes`, `commitLimitBytes` | `\Memory\Committed Bytes`, `Commit Limit` | none | 2s |
| `mem.pagesInPerS`, `pagesOutPerS`, `pagefileUsePct` | `\Memory\Pages Input/sec`, `Pages Output/sec`, `\Paging File(_Total)\% Usage` | none | 2s |
| `disk.latencyMs`, `queue`, `busyPct`, `readBps`, `writeBps` | `\PhysicalDisk(_Total)\Avg. Disk sec/Transfer`, `Current Disk Queue Length`, `% Idle Time`, `Disk Read Bytes/sec`, `Disk Write Bytes/sec` | x1000; 100 minus idle | 2s |
| `net.adapters[]` | `\Network Interface(*)\Bytes Received/sec`, `Bytes Sent/sec`, `Packets Received Errors`, `Packets Outbound Errors` | VPN flag from the adapter description (rule stored) | 2s |
| `gpu.totalUtilPct`, `vramUsedMB` | `\GPU Engine(*)\Utilization Percentage`; `\GPU Adapter Memory(*)\Dedicated Usage` | max over (adapter, engine type) of the summed engines; bytes to MB | 2s (read every Nth tick when over its 15 ms budget) |
| `sys.handleCount` | `\Process(_Total)\Handle Count` | none | 2s |
| `procs.groups[]`, `procs.system[]`, `procs.outOfScope` | `\Process(*)\% Processor Time`, `IO Read Bytes/sec`, `IO Write Bytes/sec`, `Working Set`, `Private Bytes` | instances summed by name (`#n` stripped) in the session; CPU divided by logical CPUs; resolver classifies in memory | 2s (15 ms budget) |
| `power.ac`, `batteryPct`, `hasBattery`, `energySaver` | `GetSystemPowerStatus` (ACLineStatus, BatteryLifePercent, BatteryFlag 128 = no battery, SystemStatusFlag 1 = energy saver) | 255 percent = unknown | 2s |
| `power.powerMode` | `PowerGetEffectiveOverlayScheme` | GUID to best-power-efficiency / balanced / best-performance | 2s |
| `gpu.perProcessOnTrigger[]` | `\GPU Engine(pid_<n>_*)\Utilization Percentage`, `\GPU Process Memory(pid_<n>_*)\Local Usage` for the in-scope PIDs of the hang snapshot | summed per in-scope group; PIDs not stored | on hang, 20 s min interval |

Not collected: per-process EcoQoS state (removed), per-process network, per-process handles/threads/GDI (deferred).
