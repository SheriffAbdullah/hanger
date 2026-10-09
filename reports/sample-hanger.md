# Freeze evidence - SX-1 Laptop (SYN0000001)

_2026-01-15 10:00:00 UTC+00:00 - observed 60.5 s_

Ready-to-send email draft: `sample-hanger.email.txt` (a draft file only; nothing is sent).

## 1. Run and scope

> **SCOPE (OPEN)**
> OPEN SCOPE: names of all running software may appear in this report

| Item | Value |
|---|---|
| Machine | SX-1 Laptop |
| Serial | SYN0000001 |
| Run date | 2026-01-15 10:00:00 UTC+00:00 |
| Observed duration | 60.5 s |
| Collection tier | user |
| Run finished | yes |
| Report data | hanger-json/2 (sample-hanger.json) |
| Email draft | sample-hanger.email.txt (a draft file only; the tool never sends anything) |

## 2. Finding

**Finding: memory pressure**

- 5 freezes of 800 ms or more in 60.5 s (1 confirmed by your marks, 0 by Windows, 1 by the input-response check, 4 by the probe alone).
- At freezes: commit 88.3% vs no calm baseline (n=3/0); leading cause: memory pressure in 3 of 5 usable freezes.
- Not observed: disk stall. Confidence 0.5 (derived from the rule, not a probability); evidence strength: sufficient.

## 3. What IT can do

No action suggested by this evidence.

## 4. Evidence

### Ranked causes

| Rank | Cause | Rule | Freezes | At freeze vs calm | Confidence |
|---|---|---|---|---|---|
| 1 | memory pressure | memory-pressure | 3 of 5 | commit 88.3% vs no baseline (n=3/0) | 0.5 |

### Freezes: value at freeze for each rule that was evaluated

| # | When | Freeze | Confirmed by | Largest in-scope load at freeze | memory-pressure | disk-stall |
|---|---|---|---|---|---|---|
| H1 | 10:00:16 | 1220 ms | your mark, input-response check | node.exe 6200 MB | 81.7% | no value stored (disproved) |
| H2 | 10:00:24 | 1380 ms | probe only | node.exe 6200 MB | 83.6% | no value stored (disproved) |
| H3 | 10:00:34 | 1580 ms | probe only | node.exe 6200 MB | 85.9% (fired) | no value stored (disproved) |
| H4 | 10:00:44 | 1780 ms | probe only | node.exe 6200 MB | 88.3% (fired) | no value stored (disproved) |
| H5 | 10:00:54 | 1980 ms | probe only | node.exe 6200 MB | 90.6% (fired) | no value stored (disproved) |

Rules that could not be evaluated: battery-power-plan: rate comparison not evaluated: single power source observed; power mode not evaluated: power mode / energy saver known at 0 hangs and 0 calm probes (needs 3 of each); commit-limit-pressure: mem.avail_mb not recorded at this hang (no value stored); cpu-saturation: cpu.pct_total not recorded at this hang (no value stored); database-memory-io: proc.group_mem_mb[database] not recorded at this hang (no value stored); disk-nearly-full: disk.relevant_free_pct not recorded at this hang (no value stored); free space of the system, pagefile and workload volumes is needed; driver-interrupt-storm: cpu.dpc_intr_pct not recorded at this hang (no value stored); gpu-contention: gpu.engine_util_pct not recorded at this hang (no value stored); hard-fault-thrash: mem.pages_out_per_s not recorded at this hang (no value stored); outside-scope: open scope; security-contention: security.cpu_pct_machine not recorded at this hang (no value stored); single-process-dominance: proc.group_mem_mb not recorded at this hang (no value stored); thermal-power-throttle: cpu.perf_pct not recorded at this hang (no value stored); no performance-limit signal either, so throttling is neither shown nor ruled out; vm-memory-dominance: proc.vm_host_mb not recorded at this hang (no value stored).

### Input-response check

This check is automatic and needs no action from you. A small separate helper notes when input happened and how long the foreground application took to answer a trivial liveness request; when it did not answer within 250 ms the moment is recorded as a stall. It records the fact and time of input only, never what was typed or clicked, window titles, clipboard contents or pointer positions, and names the foreground application only when it is in the declared scope. The thresholds are provisional.

1 input-response stall episode detected automatically.

| # | Start | Duration | Worst answer time | Foreground | Ended | Also seen by | Confidence |
|---|---|---|---|---|---|---|---|
| ep1 | 10:00:12 | 1412 ms | 1005 ms | code | answered | spawn-probe hang | 0.58 |

| Item | Value |
|---|---|
| Observed by the helper | 20 s |
| Evaluated (input recent) | 9 s |
| Idle (no recent input, never probed) | 11 s |
| Not evaluable | 0 s |
| Episodes also seen by | spawn-probe hang 1/1; Windows not-responding 0/1; your mark 0/1; workload probe 0/1; helper late period 0/1; nothing else 0/1 |
| Probe precision against felt stalls | 1/1 (1) - spawn-probe hangs during evaluated time that overlap a stall, join tolerance 2000 ms |
| Probe recall against felt stalls | 1/1 (1) - stalls that overlap a probe hang |
| Recall for stalls at least as long as the probe interval | not evaluated (no cases in evaluated time) |
| Probe hangs left out of precision | 0 while idle, 0 while not evaluable, 4 while unobserved |
| Probe hangs with no stall | none |
| Stalls with no probe hang | none |
| Flags | none |
| Calm baseline (answer time while no stall) | median 1 ms, 95th percentile 4 ms, maximum 6 ms over 12 measurements |
| Helper wake lateness (its own timer) | median 1 ms, 95th percentile 3 ms, maximum 9 ms; 0 late periods |
| Helper cost | not available (helper cost was not recorded) |

What this check cannot see:

- waits inside an application whose interface keeps answering (a database call, a network wait, a long job behind a responsive window)
- freezes of the operating system's own input thread (the check relies on the system reporting when input occurred)
- stalls while the user provides no input (the check asks only while input is recent)
- moments it declined to judge (higher-privilege foreground application, locked screen, secure desktop, remote session, suspend and resume, helper starved), listed under not-evaluable time
- an episode lasts at least as long as it was measured: the check stops asking once input has been quiet for the recent-input window, so long freezes are lower bounds
- the 250 ms stall threshold and the other settings are provisional and have not been calibrated against marks

### Storage

Per-drive disk data: not available (per-drive counters were not recorded in this report). The machine-total disk charts are unchanged.

Volume free space: not available (volume free-space counters were not recorded in this report).

### Run summary

| Item | Value |
|---|---|
| Probes and samples | 30 of 30 probes, 60 of 60 samples over 60.5 s |
| RAM used (average) | 87.2% |
| Commit (peak) | 92% |
| Lowest free memory | 1.0 GB |
| Paging (peak, pages/s) | 1170/s |
| Freeze-probe time (median / 95th / worst) | 190 ms / 1780 ms / 1980 ms (n=30) |
| Lowest CPU clock (% of maximum) | 100% |

### Charts

Charts (Freeze strip, Memory, CPU, Clock / thermal / power, Disk, Top in-scope processes) are drawn on one shared clock in sample-hanger.report.html. The values behind them are in the JSON report.

## 5. System profile

| Group | Fact | Value | Source |
|---|---|---|---|
| Identity | Hostname | <host> | os |
| Identity | Manufacturer | Synthetic Corp | firmware-system-info |
| Identity | Model | SX-1 Laptop | firmware-system-info |
| Identity | Serial | SYN0000001 | firmware-bios |
| Processor | Model | Synthetic CPU 8-thread | cpu-info |
| Processor | Physical cores | 4 cores | cpu-info |
| Processor | Logical processors (threads) | 8 threads | cpu-info |
| Processor | Base clock | 2400 MHz | cpu-info |
| Processor | Maximum clock | not available (max turbo clock not exposed at user tier) | cpu-info |
| Memory | Installed memory | 16 GB | physical-memory-info |
| Memory | Modules | Slot: Slot 1, Size gb: 16, Speed mts: 3200, Form factor: SODIMM | physical-memory-info |
| Memory | Memory slots used | 1 | physical-memory-info |
| Memory | Memory slots total | 2 | physical-memory-info |
| Storage | Disks | Model: Synthetic NVMe 512, Media type: SSD, Bus: NVMe, Capacity gb: 512, Health: Healthy | physical-disk-info |
| Storage | System volume | Volume: C:, Free gb: 190, Total gb: 460 | logical-disk-info |
| Firmware | BIOS vendor | Synthetic | firmware-bios |
| Firmware | BIOS version | SYN 1.02 | firmware-bios |
| Firmware | BIOS date | 2025-06-01 | firmware-bios |
| Operating system | Edition | Windows 11 Pro | os-info |
| Operating system | Version | 10.0.26200 | os-info |
| Operating system | Build | 26200 | os-info |
| Operating system | Uptime at start of run | 1234 min | os-info |
| Power | Power plan | Balanced | powercfg |
| Power | Power mode | Balanced | powercfg |
| Power | Battery design capacity | not available (requires admin) | battery-static-data |
| Virtual memory | Pagefiles | Location: C:pagefile.sys, Current mb: 2048, Initial mb: 4096, Max mb: 8192 | pagefile-info |
| Virtual memory | System managed | no | pagefile-info |
| Virtual memory | Commit limit gb | 24 GB | os-info |
| Security and management | Products | Name: Synthetic Defender, State: enabled | security-center |
| Security and management | Domain joined | no | domain-join-info |

## 6. Gaps and receipts

### Could not be measured

Every collector reported data.

### Not available in this run

- Admin-only signals: not collected because the run was not elevated.

### Receipts

| Item | Value |
|---|---|
| Not measurable without admin | battery design capacity |
| Scope | open (none); 2 in scope, 0 system, 0 outside scope |
| Anonymized | yes |
| Windows event reading | none-in-window |

## 7. Appendix

### In-scope culprit table (end of run)

| Name | Who it is | Total | Processes | Category |
|---|---|---|---|---|
| node.exe | Node.js runtime - Node.js runtime (4.8 GB at start, 6.2 GB at end) | 6349 MB | 14 |  |
| chrome.exe | Chrome browser - Browser (tabs share processes) | 2400 MB | 18 |  |

### Windows events during this run

- application not-responding events: 0
- application crash events: 0
- low-resource events: 0

### History before this run

- application not-responding events: 1 before this run, newest 2026-01-14
- application crash events: 0 before this run
- low-resource events: 0 before this run
- Windows Error Reporting archive: 3 application-hang reports of 12 (all-time); during this run: 0

### Method

- Freeze definition: a probe that starts a trivial program takes 800 ms or more (threshold source: default). It samples every 2 s.
- This test cannot see: freezes shorter than the probe interval.
- This test cannot see: UI input lag that does not delay process start.
- Usable probes: 26 (4 excluded). Minimum for any cause ranking: 10; for "sustained": 3.
- Rule thresholds, all provisional unless a source says otherwise: battery-power-plan 2 x AC rate (default; provisional (diagnosis-cause-rules design)); commit-limit-pressure 90% (default; provisional (diagnosis-cause-rules design)); cpu-saturation 90% (default; provisional); database-memory-io 25 % of RAM (default; provisional (diagnosis-cause-rules design)); disk-nearly-full 10% (default; provisional (diagnosis-cause-rules design)); disk-stall 25 ms (default; provisional); driver-interrupt-storm 10% (default; provisional (diagnosis-cause-rules design)); gpu-contention 90% (default; provisional (diagnosis-cause-rules design)); hard-fault-thrash 100/s (default; provisional (diagnosis-cause-rules design)); memory-pressure 85% (default; MS perf troubleshooting [derived]); outside-scope 85% (default; MS perf troubleshooting [derived]); security-contention 8% of machine (default; provisional); single-process-dominance 40 % of used memory (default; provisional (diagnosis-cause-rules design)); thermal-power-throttle 60 % of calm median (default; provisional (diagnosis-cause-rules design)); vm-memory-dominance 40 % of RAM (default; provisional (diagnosis-cause-rules design)).
- Continuous sampling: nominal 2 s, achieved median 2.05 s (n=29).
- Cost of this tool during the run: about 96 MB of memory; it is excluded from every culprit and rollup.
- Thresholds are provisional.

### Measured time lost (context only)

- Measured: 7.9 s frozen across 5 freezes in 60.5 s observed (mean 1.58 s per freeze).

### Files

| Item | Value |
|---|---|
| sample-hanger.json | sha256 aa90ccdfd55b3dc4d41e86eb75dd7b286ba0e55811e630b553070a7f6bd8a5f3 |
| sample-hanger.report.html | sha256 979347d4d0ba30a7108bab1251b1d6672bcbbcc327ba5d206e2cff6278c70c70 |
