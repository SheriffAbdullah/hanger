# metrics Specification

## Purpose
Define the telltale metric contract: first-order OS and app/process sets, hang events, and self-load accounting. Every value emits `{id, value, unit, windowS, n, threshold?, conf?}`; first-order is never overwritten and thresholds are recorded per report.

## Requirements

### Requirement: OS first-order bundle via no-admin collectors
The system SHALL collect the OS first-order set (commit %, available memory, hard-fault rate, fault rates, CPU queue, CPU %, disk queue, security-software CPU, % max frequency, pagefile %) at a nominal 2 s cadence without elevation, and SHALL never read the security event log. Elevated-only collection, including whole-run kernel trace capture, SHALL be opt-in, skipped with a recorded reason when unelevated, and disclose its output path in the report.

#### Scenario: 2s bundle emits full OS set
- **GIVEN** an unelevated shell and an empty config file
- **WHEN** the user runs a 20 s trace
- **THEN** every probe in the JSON report carries numeric or null values for commit %, available memory, hard-fault rate, CPU queue, CPU %, disk queue, security-software CPU, % of maximum frequency, and pagefile usage %
- **AND** the report's tier is `user`

#### Scenario: Never uses admin or wmic collectors
- **WHEN** the collector source is searched for a query against the security event log, or for the deprecated WMI command-line tool
- **THEN** no match is found

#### Scenario: Kernel trace capture is skipped when unelevated
- **GIVEN** an unelevated shell
- **WHEN** the user runs a trace with the kernel-trace opt-in flag
- **THEN** the console states that the capture needs elevation and was skipped
- **AND** the report's kernel-trace output path is null

#### Scenario: Kernel trace capture is disclosed when elevated
- **GIVEN** an elevated shell
- **WHEN** the user runs a trace with the kernel-trace opt-in flag
- **THEN** the report records the path of the captured trace file
- **AND** the capture is stopped on normal exit, on interrupt, and on crash

### Requirement: OS healthy ranges and confounds recorded
The system SHALL record per-report healthy ranges and confounds for each OS metric (e.g. committed <75 ok / >85 stall-risk; pages/sec judged on 5s average; single spikes are never proof) and SHALL NOT treat any single-sample counter as stall proof.

#### Scenario: Single spike is not proof
- **GIVEN** one 2s bundle shows pages/sec >500 but the 5s average is <200
- **WHEN** the report judges paging pressure
- **THEN** it reports no sustained thrashing
- **AND** cites the single-sample confound

### Requirement: Power and backing-store alibis
The system SHALL record the active power plan (friendly name and identifier) once per run, and on every continuous sample SHALL record the power-mode overlay, the energy-saver state, turbo-aware processor performance, and paging-file usage percentage, so that throttle and backing-store conditions are available as hang evidence.

#### Scenario: Power-mode overlay visible without a plan change
- **GIVEN** the power plan stays the same throughout a run while the user switches the power mode from balanced to best power efficiency
- **WHEN** the samples are recorded
- **THEN** the power-mode value changes on the samples after the switch
- **AND** the power plan name is recorded once for the run

#### Scenario: Throttle alibi present in hang context
- **GIVEN** a hang occurs while processor performance is limited on AC power
- **WHEN** the hang row is recorded
- **THEN** the samples around the hang carry performance %, performance-limit %, power mode, and AC state with their values
- **AND** ranking throttling as a cause is left to the diagnosis rules

#### Scenario: Backing-store state present on every sample
- **WHEN** any continuous sample is recorded
- **THEN** it carries paging-file usage percentage, or null with a reason in `collection.failures[]`

### Requirement: App/process rollups with friendly names
The system SHALL roll up in-scope processes and system-set members into stable friendly group names, recording per group working-set MB, private (committed) MB, instance count, CPU as % of machine, and disk read/write rates; footprint ranking SHALL use working set, and commit attribution SHALL use private bytes.

#### Scenario: Verdict uses Private not WS
- **GIVEN** an in-scope group with 2,000 MB working set and flat 150 MB private bytes, and another with 600 MB working set and 1,800 MB private bytes
- **WHEN** the rollup ranks groups
- **THEN** the footprint ranking places the 2,000 MB working-set group first
- **AND** the commit attribution places the 1,800 MB private-bytes group first

#### Scenario: Rollup carries CPU and I/O
- **WHEN** a rollup row is recorded for an in-scope group
- **THEN** it includes working-set MB, private MB, instance count, CPU as % of machine, and read and write bytes per second

### Requirement: Hang events with explicit threshold parameter
The system SHALL define `hang.count` as probes with `probes.ms >= HANG_MS`, where `HANG_MS` is an explicit per-report parameter (default `--hang 800`, provisional) recorded with its source, and SHALL compute `hang.rate_per_min` as count divided by the observed window in minutes.

#### Scenario: Threshold recorded per report
- **WHEN** a report is emitted with a non-default `--hang` value
- **THEN** the report records the HANG_MS value used and its source `flag`
- **AND** hang count and rate are computed against that value

#### Scenario: Rate divides by observed minutes
- **GIVEN** 3 hangs over an observed window of 120 s with a nominal duration of 60 s
- **WHEN** the rate is computed
- **THEN** `hang.rate_per_min` is 1.5

### Requirement: Frozen share, MTTR, and user ground truth
The system SHALL compute `hang.pct_frozen` as full-stall share (sum of hang ms over observed window ms) plus excess-over-threshold share, SHALL compute `hang.mttr_ms` as median next-OK probe latency plus wall gap with n reported, and SHALL accept `user.marks[]` keypress wall timestamps as ground truth for precision/recall against detected hangs.

#### Scenario: Frozen share reports both full and excess
- **GIVEN** a run with 3 hangs over a 60s observed window
- **WHEN** the summary is computed
- **THEN** `hang.pct_frozen` reports both the full-stall percentage and the excess-over-threshold percentage
- **AND** states the assumption used and that the window basis is observed

#### Scenario: Frozen share is not inflated by a nominal window
- **GIVEN** hangs totalling 6000 ms in a run with nominal 20 s and observed 78 s
- **WHEN** the full-stall share is computed
- **THEN** it is about 7.7%, not 30%

### Requirement: Hang context windows and lagged correlation
The system SHALL attach `hang.context[W=±10s]` pre/post arrays (RAM %, committed, pages, cpuQ, diskQ; culprit deltas where sampled, else an explicit null-with-reason) to each HANG row, with W=10s measured in wall-clock time around the hang's measured time and recorded. Lagged correlation is not part of this requirement (deferred, DEF-2).

#### Scenario: Context window attached per hang
- **WHEN** a HANG row is emitted
- **THEN** it includes ±10s pre/post slices of RAM, committed, pages, cpuQ, diskQ, and culprit deltas
- **AND** records W=10s

#### Scenario: Window uses wall-clock times
- **GIVEN** a loaded-box fixture where sample offsets are measured and spread over 78 s
- **WHEN** the context for a hang at measured offset 40 s is built
- **THEN** every included sample has a measured offset between 30 s and 50 s

### Requirement: Self-load accounting excluded from verdict
The system SHALL emit `bundleMs`, `snapMs`, and `slipS` self-load accounting per run and SHALL exclude loop-lag from the hang verdict. It SHALL exclude its own process and every process it spawned from culprits, rollups, and top-process lists, and SHALL report their resource use separately as observer cost.

#### Scenario: Loop lag excluded from verdict
- **GIVEN** a run where bundleMs is elevated but OS and app signals are flat
- **WHEN** the verdict is computed
- **THEN** self-load is reported in the accounting section only
- **AND** no hang or culprit is attributed to it

#### Scenario: Tool never names itself as culprit
- **GIVEN** a trace where the tool's own runtime process holds 2.6 GB
- **WHEN** culprits and top processes are built
- **THEN** no culprit, rollup, or top-process row contains the tool's own process IDs or a label naming the tool
- **AND** the observer section reports the tool's memory use

### Requirement: Capability-tiered collection
The system SHALL detect at startup whether it runs elevated, SHALL record the tier (`user` or `admin`) in every report, and SHALL skip admin-only signals in the user tier with a recorded reason, using the same report shape, never crashing and never zero-filling.

#### Scenario: User tier records skipped admin signals
- **GIVEN** an unelevated shell and an empty config file
- **WHEN** a 10 s trace completes
- **THEN** the JSON report has tier `user`
- **AND** the admin section states the signals were skipped because the process was not elevated
- **AND** the process exits with code 0

#### Scenario: Admin tier collects admin signals
- **GIVEN** an elevated shell
- **WHEN** a 10 s trace completes
- **THEN** the JSON report has tier `admin`
- **AND** the admin section contains thermal-zone, disk-health, and debug-privilege entries, each with a value or an explicit reason

### Requirement: Portability contract check
The system SHALL ship a contract file listing every OS-independent inference with its value shape, current collector, candidate probe for other platforms, and green condition, and SHALL provide a check mode that reports each inference as green or red on the current machine with a summary count. A strict variant SHALL fail when any contract entry has no registered collector.

#### Scenario: Check mode prints per-inference results
- **WHEN** the user runs the check mode on Windows
- **THEN** one GREEN or RED line is printed per contract entry
- **AND** a summary line states `<greens>/<total> green`
- **AND** the exit code is non-zero if any entry is red

#### Scenario: Strict mode rejects orphan contract entries
- **GIVEN** a contract entry whose collector id is not registered
- **WHEN** the user runs the check mode with the strict flag
- **THEN** the output names the orphan inference
- **AND** the exit code is 1

### Requirement: Every sample carries its measurement wall-clock time
Every sample and probe SHALL record the wall-clock time at which its value was measured, and its offset from run start SHALL be computed from that time, never from its index multiplied by the nominal interval.

#### Scenario: Slow loop yields measured offsets
- **GIVEN** a loaded-box fixture where 40 samples were requested at a nominal 0.5 s interval but measurements span 78 s
- **WHEN** the report is built
- **THEN** the last sample's offset is about 78 s, not 20 s
- **AND** every sample has an ISO wall-clock time that is non-decreasing

### Requirement: Rates and shares use the observed window
Hang rate, frozen share, time over a threshold, recovery time, and every cost input SHALL be computed over the observed window (first to last measurement). The report SHALL record both the observed and nominal windows and SHALL state which one the rates use.

#### Scenario: Rate uses the real window
- **GIVEN** a trace requested for 20 s that observed 78 s and detected 1 hang
- **WHEN** the summary is computed
- **THEN** the hang rate is about 0.77 per minute, not 3 per minute
- **AND** the report records nominal 20 s, observed 78 s, and basis `observed`

### Requirement: Absent data is null with a reason
When no measurement exists for a value (such as a peak, average, minimum, or percentile), the system SHALL record null together with a reason, and SHALL NOT substitute 0, Infinity, or any other default.

#### Scenario: No disk data
- **GIVEN** a run in which the disk counters returned no values
- **WHEN** the summary is built
- **THEN** the disk latency peak and disk queue peak are null
- **AND** each has a recorded reason

#### Scenario: No samples
- **GIVEN** a run with zero RAM samples
- **WHEN** the summary is built
- **THEN** minimum free memory is null with a reason, never Infinity or 0
- **AND** the report still parses as JSON

### Requirement: On-hang process snapshot within declared scope
The system SHALL attach to each hang row a snapshot of the top in-scope and system-set process groups (memory, instance count, label), ranked within scope rather than taken from the overall top list and then filtered. It SHALL also attach the out-of-scope aggregate for the same moment. When the snapshot is skipped or degraded, the row SHALL record the reason.

#### Scenario: In-scope offender ranked below outsiders is kept
- **GIVEN** scope `postgres`, and at a hang the three largest groups are out of scope while `postgres` is fifth largest
- **WHEN** the hang row is written
- **THEN** `culpritsAtHang` contains the `postgres` group
- **AND** contains no out-of-scope group

#### Scenario: Skipped snapshot carries a reason
- **GIVEN** the snapshot at a hang is skipped because of the collection budget
- **WHEN** the hang row is written
- **THEN** `culpritsAtHang` is null and `snapshotSkippedReason` is a non-empty string

### Requirement: Per-process CPU and disk I/O attribution
The system SHALL record, on the continuous sampling tier, CPU usage as a percentage of the whole machine (0-100) and disk read and write rates in bytes per second for each in-scope process group and each system-set member, plus one anonymous aggregate for all out-of-scope processes carrying only group count, CPU percentage, read and write rates, and working-set MB.

#### Scenario: In-scope group CPU is attributed as machine share
- **GIVEN** a 12-logical-CPU machine where the in-scope group `postgres` consumes 270% of one core in raw per-core units
- **WHEN** a continuous sample is recorded
- **THEN** the `postgres` series value for that sample is 22.5 with unit `% of machine`
- **AND** no stored per-process CPU value exceeds 100

#### Scenario: Out-of-scope load is aggregated without names
- **GIVEN** a scoped run declaring only `postgres` and an out-of-scope process `zz-canary.exe` using 30% of the machine
- **WHEN** the run's artifacts are written
- **THEN** the out-of-scope aggregate for that sample includes the 30% share in its CPU total
- **AND** the string `zz-canary` appears in no artifact or console output

#### Scenario: Disk rates attribute I/O to the in-scope writer
- **GIVEN** canned collector output in which the in-scope group `postgres` writes 8,000,000 bytes/s and reads 3,000,000 bytes/s
- **WHEN** the parser builds the sample
- **THEN** the `postgres` entry records `writeBps` 8000000 and `readBps` 3000000 with unit `bytes/s`

### Requirement: Security and system component activity normalized to machine share
The system SHALL record CPU activity of registered security software and other system-set members as a percentage of the whole machine (0-100), and SHALL record the machine's logical CPU count once per run beside it. Memory compression memory SHALL be recorded every sample regardless of its rank.

#### Scenario: Per-core-scaled security CPU is normalized
- **GIVEN** canned collector output reporting security-software CPU of 190 in per-core units on a 12-logical-CPU machine
- **WHEN** the sample is recorded
- **THEN** the stored security-software value is 15.8 (one decimal) with unit `% of machine`
- **AND** the run records `logicalCpus` 12

#### Scenario: Memory compression is always present
- **GIVEN** a sample in which memory compression holds 640 MB and ranks below the top ten processes by working set
- **WHEN** the sample is recorded
- **THEN** the system-set entry for memory compression records 640 MB

### Requirement: Temperature time series
The system SHALL record temperature in °C per labelled zone on the continuous tier at the user tier wherever the platform exposes it, SHALL drop readings below 5 °C or above 130 °C while counting them, SHALL record GPU temperature when exposed, and SHALL record null with a reason (`not-exposed` or `tier`) when no zone is readable.

#### Scenario: Zones are labelled and implausible values dropped
- **GIVEN** canned collector output with zones `CPU package` at 344.15 K and `ACPI zone 3` at 273.25 K
- **WHEN** the sample is parsed
- **THEN** the sample records zone `CPU package` with role `cpu` at 71.0 °C
- **AND** `ACPI zone 3` (0.1 °C) is not stored as a value and `droppedImplausible` is 1

#### Scenario: Unexposed temperature is null with reason
- **GIVEN** an unelevated run on a machine that exposes no thermal zones to the user tier
- **WHEN** the run completes
- **THEN** every sample's temperature is null, never 0
- **AND** `collection.failures[]` contains one entry for the temperature inference with reason `not-exposed`

### Requirement: Turbo-aware performance and throttle signals
The system SHALL record on the continuous tier the processor's actual performance as a percentage of base performance (values above 100 permitted), the percentage of time performance was limited, and throttle reasons when the platform exposes them, so that a turbo-capable processor clamped to base clock registers as limited.

#### Scenario: Clamp from turbo registers as limited
- **GIVEN** canned samples where the legacy maximum-frequency percentage reads 100 throughout while actual performance falls from 148 to 60 and performance-limit rises from 0 to 85
- **WHEN** the samples are recorded
- **THEN** the performance series stores 148 then 60 with unit `% of base`
- **AND** the performance-limit series stores 0 then 85

#### Scenario: Missing throttle reasons are null, not empty success
- **GIVEN** a machine that does not expose throttle reasons
- **WHEN** a sample is recorded
- **THEN** throttle reasons are null with a reason in `collection.failures[]`

### Requirement: Commit charge absolute values
The system SHALL record committed bytes and the commit limit in bytes on every continuous sample, alongside the committed percentage, so that a low commit limit can be distinguished from high commit use.

#### Scenario: Commit absolute values stored
- **GIVEN** canned collector output with committed 16,100,000,000 bytes and commit limit 20,300,000,000 bytes
- **WHEN** the sample is recorded
- **THEN** it stores `committedBytes` 16100000000 and `commitLimitBytes` 20300000000 with unit `bytes`
- **AND** the committed percentage stored with it is 79.3

### Requirement: Paging direction signals
The system SHALL record pages read from disk per second and pages written to disk per second as separate series, and SHALL record paging-file usage percentage on every continuous sample.

#### Scenario: Reads and writes are separated
- **GIVEN** canned collector output with pages input 4513/s and pages output 0/s
- **WHEN** the sample is recorded
- **THEN** it stores `pagesInPerS` 4513 and `pagesOutPerS` 0 as separate values
- **AND** paging-file usage percentage is present on the same sample

### Requirement: Disk latency, queue, utilization, and throughput
The system SHALL record on the continuous tier disk transfer latency in milliseconds, current queue length, busy percentage, and read and write throughput in bytes per second.

#### Scenario: Latency stored in milliseconds
- **GIVEN** canned collector output reporting a transfer time of 0.0042 seconds, idle time 88%, and queue 0.3
- **WHEN** the sample is recorded
- **THEN** it stores `latencyMs` 4.2, `busyPct` 12, and `queue` 0.3, each with its unit

### Requirement: Network activity aggregate
The system SHALL record per active network adapter the received and sent bytes per second and the error count on the continuous tier, and SHALL flag adapters identified as VPN adapters together with the rule that identified them. The system SHALL NOT record per-process network activity.

#### Scenario: VPN adapter flagged with its rule
- **GIVEN** canned adapter data listing `Wi-Fi` and `Cisco AnyConnect Virtual Miniport Adapter`
- **WHEN** a sample is recorded
- **THEN** the AnyConnect adapter has `isVpn` true and records the matching rule
- **AND** `Wi-Fi` has `isVpn` false

#### Scenario: No per-process network data
- **WHEN** any run completes
- **THEN** no artifact contains a network value keyed by process or process group

### Requirement: GPU activity when exposed
The system SHALL record total GPU utilization and dedicated GPU memory in use when the platform exposes them, deriving a total from per-engine data when no total exists, SHALL collect per-process GPU data only on trigger and only for in-scope processes with its collection time recorded, and SHALL record null with a reason when GPU data is not exposed.

#### Scenario: Total derived from engines
- **GIVEN** canned per-engine utilization of 3D 40% and 3D 25% on two engines and copy 5%, with no platform total
- **WHEN** the sample is recorded
- **THEN** total GPU utilization is stored as 65 with a note that it was derived from engines

#### Scenario: Per-process GPU limited to scope and costed
- **GIVEN** a scoped run declaring `postgres` and a hang trigger
- **WHEN** per-process GPU data is collected
- **THEN** the stored entries contain only in-scope groups
- **AND** the collection time in milliseconds is recorded with the entry

#### Scenario: Absent GPU data is null
- **GIVEN** a machine exposing no GPU utilization data
- **WHEN** the run completes
- **THEN** GPU values are null on every sample and `collection.failures[]` names the reason

### Requirement: System handle count
The system SHALL record the system-wide handle count on the continuous tier.

#### Scenario: Handle count recorded
- **GIVEN** canned collector output with a total handle count of 98213
- **WHEN** the sample is recorded
- **THEN** it stores `handleCount` 98213 with unit `count`

## Deferred
(Dated 2026-10-07. Replaces the stale v0.5-era deferral block. Each item: see openspec/IMPLEMENTATION-PLAN.md §6.5.)
- DEF-1: per-process handles/threads and a full process-tree snapshot (see IMPLEMENTATION-PLAN.md §6.5).
- DEF-2: lagged Pearson/Spearman hang correlation and the 0.4/0.3/0.2/0.1 culprit-confidence formula, not implemented (see IMPLEMENTATION-PLAN.md §6.5).
- DEF-3: per-fault-bucket WER grouping (see IMPLEMENTATION-PLAN.md §6.5).
