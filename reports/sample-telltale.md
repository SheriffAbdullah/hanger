# Freeze evidence - SX-1 Laptop (SYN0000001)

_2026-01-15 10:00:00 UTC+00:00 - observed 19.5 s_

Ready-to-send email draft: `sample-telltale.email.txt` (a draft file only; nothing is sent).

## 1. Run and scope

> **SCOPE (OPEN)**
> OPEN SCOPE: names of all running software may appear in this report

| Item | Value |
|---|---|
| Machine | SX-1 Laptop |
| Serial | SYN0000001 |
| Run date | 2026-01-15 10:00:00 UTC+00:00 |
| Observed duration | 19.5 s |
| Collection tier | user |
| Run finished | yes |
| Report data | telltale-json/2 (sample-telltale.json) |
| Email draft | sample-telltale.email.txt (a draft file only; the tool never sends anything) |

## 2. Finding

**Finding: no freeze observed**

- No freeze of 800 ms or more was observed in 19.5 s of observation.
- No freeze observed: 0 of 4 usable probes reached 800 ms (slowest 211 ms); 1 probe(s) excluded as observer-affected. This is not evidence that the machine never freezes.

## 3. What IT can do

No action suggested by this evidence.

## 4. Evidence

No cause rule fired, so no cause is ranked.

### Freezes

No probe reached the freeze threshold, so there is no at-freeze versus calm comparison. The calm run is summarized below.

### Input-response check

This check is automatic and needs no action from you. A small separate helper notes when input happened and how long the foreground application took to answer a trivial liveness request; when it did not answer within 250 ms the moment is recorded as a stall. It records the fact and time of input only, never what was typed or clicked, window titles, clipboard contents or pointer positions, and names the foreground application only when it is in the declared scope. The thresholds are provisional.

1 input-response stall episode detected automatically.

| # | Start | Duration | Worst answer time | Foreground | Ended | Also seen by | Confidence |
|---|---|---|---|---|---|---|---|
| ep1 | 10:00:12 | 1412 ms | 1005 ms | code | answered | nothing else | 0.48 |

| Item | Value |
|---|---|
| Observed by the helper | 20 s |
| Evaluated (input recent) | 9 s |
| Idle (no recent input, never probed) | 11 s |
| Not evaluable | 0 s |
| Episodes also seen by | spawn-probe hang 0/1; Windows not-responding 0/1; your mark 0/1; workload probe 0/1; helper late period 0/1; nothing else 1/1 |
| Probe precision against felt stalls | not evaluated (no cases in evaluated time) - spawn-probe hangs during evaluated time that overlap a stall, join tolerance 2000 ms |
| Probe recall against felt stalls | 0/1 (0) - stalls that overlap a probe hang |
| Recall for stalls at least as long as the probe interval | not evaluated (no cases in evaluated time) |
| Probe hangs left out of precision | 0 while idle, 0 while not evaluable, 0 while unobserved |
| Probe hangs with no stall | none |
| Stalls with no probe hang | inputStall.episodes[0] at 10:00:12, 1412 ms |
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

### Run summary

| Item | Value |
|---|---|
| Probes and samples | 5 of 5 probes, 10 of 10 samples over 19.5 s |
| RAM used (average) | 68.1% |
| Commit (peak) | 64.8% |
| Lowest free memory | 4.9 GB |
| Paging (peak, pages/s) | 66/s |
| Freeze-probe time (median / 95th / worst) | 169 ms / 211 ms / 211 ms (n=5) |
| Lowest CPU clock (% of maximum) | 100% |

### Charts

Charts (Freeze strip, Memory, CPU, Clock / thermal / power, Disk, Top in-scope processes) are drawn on one shared clock in sample-telltale.report.html. The values behind them are in the JSON report.

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
| Scope | open (none); 1 in scope, 0 system, 0 outside scope |
| Anonymized | yes |
| Windows event reading | none-in-window |

## 7. Appendix

### In-scope culprit table (end of run)

| Name | Who it is | Total | Processes | Category |
|---|---|---|---|---|
| chrome.exe | Chrome browser - Browser (tabs share processes) | 2100 MB | 22 |  |

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

- Freeze definition: a probe that starts a trivial program takes 800 ms or more (threshold source: default). It samples every 3 s.
- This test cannot see: freezes shorter than the probe interval.
- This test cannot see: UI input lag that does not delay process start.
- Usable probes: 4 (1 excluded). Minimum for any cause ranking: 10; for "sustained": 3.
- 4 usable probes of 5 (1 excluded: startup-window).
- commit 55-65% across 4 usable probes.
- Continuous sampling: nominal 2 s, achieved median 2.05 s (n=29).
- Cost of this tool during the run: about 96 MB of memory; it is excluded from every culprit and rollup.
- Thresholds are provisional.

### Files

| Item | Value |
|---|---|
| sample-telltale.json | sha256 f8eb4d55f582813949134126467214d8a006ea485d3ff7bec7da21649395fc98 |
| sample-telltale.report.html | sha256 b4b88b5149b9bc7e1526dcd15dabdd1bbba41c230d5cb47e384d9c1b6c0dd5d3 |
