# sampling Specification

## Purpose
Defines how Hanger schedules, budgets, and records its own observation, so that collection stays cheap and honest on a machine that is already starved. It covers cadence and gaps, observer cost, capture length, input capture, failures, number parsing, and stored precision.

## Requirements

### Requirement: Continuous sampling keeps its cadence under load
The system SHALL collect the continuous-tier signal set without launching any process per tick other than the hang probe. For every run it SHALL record the nominal interval and the achieved median and p95 interval between consecutive continuous samples. At a nominal 2 s interval on the reference loaded laptop, the achieved median SHALL be at most 2.5 s.

#### Scenario: No per-tick process launch in the continuous tier
- **GIVEN** a trace runs for 60 s at a nominal 2 s interval
- **WHEN** the observer meter counts process launches made by the tool
- **THEN** the launches attributed to the continuous tier are 0
- **AND** the launches attributed to the hang probe are at most 31

#### Scenario: Achieved cadence is recorded
- **GIVEN** a fake clock delivers continuous samples at 2.0, 2.1, 1.9, 6.0, and 2.0 s intervals
- **WHEN** the run summary is written
- **THEN** `sampling.cadence` records nominal 2 s, achieved median 2.0 s, achieved p95 6.0 s, and n=5

#### Scenario: Cadence target on a loaded machine
- **GIVEN** the reference laptop with commit at or above 85% throughout
- **WHEN** `node tools/hanger/hanger.js trace --duration 120` completes
- **THEN** the report's achieved median continuous interval is at most 2.5 s

### Requirement: Unobserved intervals are recorded
The system SHALL record every gap between consecutive continuous samples that exceeds twice the nominal interval as an unobserved interval with start time, end time, duration, and reason. It SHALL NOT interpolate, carry forward, or synthesize values for that interval. Rates and shares SHALL exclude unobserved time from the observed window.

#### Scenario: Long gap becomes an unobserved interval
- **GIVEN** a nominal 2 s interval and a fake clock that delivers no sample between 10.0 s and 17.0 s
- **WHEN** the run is persisted
- **THEN** `sampling.unobserved[]` contains one entry with start 10.0 s, end 17.0 s, duration 7.0 s, and a non-empty reason
- **AND** no stored sample has a measurement time strictly between 10.0 s and 17.0 s

#### Scenario: Short jitter is not a gap
- **GIVEN** a nominal 2 s interval and consecutive samples 3.9 s apart
- **WHEN** the run is persisted
- **THEN** `sampling.unobserved[]` contains no entry for that pair

### Requirement: Heavy collection runs on trigger within a budget
The system SHALL run heavy collectors (process enumeration, per-process GPU, OS queries) only on a hang trigger or on a declared schedule. Each SHALL have a declared time budget. A run that is skipped or exceeds its budget SHALL be recorded with collector id, trigger, elapsed time, budget, and reason. Heavy work SHALL NOT delay the continuous tier.

#### Scenario: Over-budget heavy work is recorded
- **GIVEN** a fake heavy collector with a 2000 ms budget that takes 5000 ms on a hang trigger
- **WHEN** the trigger completes
- **THEN** a record holds the collector id, trigger "hang", elapsed 5000 ms, budget 2000 ms, and reason "over-budget"
- **AND** the continuous samples taken during those 5000 ms keep their nominal interval within the cadence tolerance

#### Scenario: Heavy collector never runs per tick
- **GIVEN** a 60 s trace with no hang
- **WHEN** the run completes
- **THEN** each heavy collector ran only at its declared schedule points
- **AND** never once per continuous tick

#### Scenario: Calm-path collection is reachable under load
- **GIVEN** a hang trigger fires while commit is at or above 85% and continuous samples are on cadence
- **WHEN** the heavy tier runs
- **THEN** the on-hang snapshot is attempted within its budget
- **AND** it is not skipped merely because an earlier collection exceeded 1 s

### Requirement: Observer cost is measured per run
The system SHALL measure and report the tool's own cost for each run: CPU time, average CPU as a percent of one logical processor, peak private bytes, I/O bytes read and written, and process launches per minute, split by tier. Observer cost SHALL be stored separately from workload data and SHALL NOT be counted in any workload rollup or aggregate.

#### Scenario: Observer cost appears in the report
- **WHEN** any trace completes
- **THEN** `sampling.observer` contains CPU seconds, average CPU percent of one logical processor, peak private MB, I/O read and write MB, and launches per minute, each with unit and n

#### Scenario: Observer launches are not workload
- **GIVEN** the tool launched 30 hang-probe processes during the run
- **WHEN** process rollups and aggregates are computed
- **THEN** none of those processes or their resource use appear in any workload rollup or aggregate

### Requirement: Observer cost stays within a declared budget
The system SHALL declare an observer budget for the continuous tier: at most 2% of one logical processor averaged over the run, and at most 150 MB peak private bytes. When a run exceeds the budget, the system SHALL record the exceedance with measured value, limit, and window, and SHALL print one line naming it.

#### Scenario: Budget exceedance is recorded and printed
- **GIVEN** a fake observer meter reporting 4% average CPU for the continuous tier over 600 s
- **WHEN** the run completes
- **THEN** `sampling.observer.budget` records exceeded true with value 4, limit 2, unit "% of one logical CPU", and window 600 s
- **AND** the console prints one line naming the exceeded budget

#### Scenario: Within budget
- **GIVEN** measured continuous-tier cost of 1.2% CPU and 90 MB peak private
- **WHEN** the run completes
- **THEN** `sampling.observer.budget.exceeded` is false

### Requirement: Long-duration capture
The system SHALL support continuous capture of up to 8 hours per run. It SHALL record the requested duration, the actual duration, and their source (flag, config, or default). Its own memory use SHALL remain bounded regardless of duration because samples are persisted incrementally rather than retained in memory. A requested duration above the maximum SHALL be clamped, printed, and recorded.

#### Scenario: Memory stays bounded over a long fake run
- **GIVEN** a fake clock driving a 2 h run at a 2 s interval with a fake collector
- **WHEN** the run ends
- **THEN** the tool's peak private bytes at 2 h exceed those at 10 min by no more than 20 MB
- **AND** the persisted stream contains 3600 ± 1 continuous samples

#### Scenario: Over-maximum duration is clamped visibly
- **WHEN** the user requests `--duration 36000` (10 h)
- **THEN** the run uses 28800 s
- **AND** the console and the report both record requested 36000 s, used 28800 s, and reason "maximum 8 h"

#### Scenario: Durations above 300 s are honored
- **WHEN** the user requests `--duration 900`
- **THEN** the run lasts 900 s ± one interval and records requested 900 s with source "flag"

### Requirement: Input capture is never blocked by collection
The system SHALL capture user key presses independently of collection work, so that each mark's timestamp is within 250 ms of the actual press even while heavy collection or a blocked collector is in progress.

#### Scenario: Mark during a blocking collector
- **GIVEN** a fake heavy collector that blocks for 10 s starting at t=20.0 s
- **WHEN** a key press is injected at t=22.0 s
- **THEN** the stored mark's timestamp is between 22.0 s and 22.25 s

### Requirement: Collector failures are recorded as evidence
The system SHALL record every collector failure, skip, timeout, or tier gap as `{inference, collector, mode, reason, at}` in one failures list, using the same shape on every code path. A run with zero usable samples SHALL still produce a valid, parseable report that lists its failures and exits with code 0.

#### Scenario: Timeout recorded with time
- **GIVEN** a fake collector that times out at t=14.0 s
- **WHEN** the run is persisted
- **THEN** the failures list contains an entry with that collector id, mode "timeout", a non-empty reason, and at 14.0 s

#### Scenario: Zero usable samples still yields a report
- **GIVEN** every registered collector fails on every attempt
- **WHEN** a 20 s trace completes
- **THEN** the process exits with code 0
- **AND** the report parses as JSON and lists at least one failure per collector

### Requirement: Locale-independent number parsing
The system SHALL parse every numeric value from collector output identically regardless of the operating system's display locale, including decimal-comma and non-breaking-space digit-group locales. A value that cannot be parsed SHALL be stored as null with a failure reason, never as zero.

#### Scenario: Decimal-comma output parses correctly
- **GIVEN** canned collector output captured under de-DE showing `87,5` for committed percent and `1.234,0` for pages per second
- **WHEN** the output is parsed
- **THEN** the stored values are 87.5 and 1234.0

#### Scenario: Unparsable value is null with reason
- **GIVEN** canned output containing `n/a` for a numeric field
- **WHEN** the output is parsed
- **THEN** the stored value is null
- **AND** a failure records mode "parse" and the field id

### Requirement: Stored precision matches measurement precision
The system SHALL round every stored value at store time to the precision declared for its unit (for example percent to 0.1, MB to 1, ms to 1, seconds to 0.001) and SHALL record that precision with the value. No stored numeric value SHALL carry more decimal places than its declared precision.

#### Scenario: Percent stored to declared precision
- **GIVEN** a raw committed-percent reading of 64.7166289074152
- **WHEN** the value is stored
- **THEN** the stored value is 64.7 with precision 0.1

#### Scenario: No over-precise values in a report
- **WHEN** `node tools/hanger/test/helpers/validate-report.js` checks any report produced by this change
- **THEN** it finds no numeric value with more decimal places than its declared precision
