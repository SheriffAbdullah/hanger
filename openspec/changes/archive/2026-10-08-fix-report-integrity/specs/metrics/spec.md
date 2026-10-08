## ADDED Requirements

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

## MODIFIED Requirements

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
