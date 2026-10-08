# tracking Specification

## Purpose
User-started usage-pattern tracking for Telltale: a light continuous `watch` log plus a deep `trace` mode for hang incidents. Every sample carries human process names, power truth, and both hang-linked and calm-linked evidence. Numbers + reasons + RCA, never verdicts.

## Requirements

### Requirement: Watch mode light continuous loop
The system SHALL provide a `watch` mode that samples RAM/commit/pages, top-group MB, and power/battery at a nominal 2s cadence and appends each sample to a JSONL watch log. A requested watch duration SHALL be measured in wall-clock seconds, and the achieved cadence SHALL be recorded.

#### Scenario: Watch writes 2s JSONL baseline
- **GIVEN** `watch` mode is started
- **WHEN** each 2s interval elapses
- **THEN** a sample with RAM, commit %, pages, top-group MB, and power/battery is appended as one JSONL line to the watch log
- **AND** collection overhead stays light (no spawn probes, no deep bundle)

#### Scenario: Watch duration is wall-clock
- **GIVEN** the user runs `watch --watch-secs 10` on a box where each sample takes about 6 s
- **WHEN** watch finishes
- **THEN** the elapsed wall-clock time is at most 10 s plus one sample period
- **AND** the watch log records the achieved median cadence

#### Scenario: Watch pressure hint after 3 hot intervals
- **GIVEN** `watch` mode is running
- **WHEN** commit > 85% or pages > 500/sec sustains for 3 consecutive intervals
- **THEN** watch prints a pressure hint suggesting a manual `trace` run
- **AND** watch keeps running; auto-trace happens only with explicit `--watch-trigger` (max one detached child per run)

### Requirement: Trace mode deep bundles
The system SHALL provide a `trace` mode that captures deep 2s bundles with spawn probes, persists them incrementally as they occur, and emits a HANG list. It is triggered manually or when the user accepts a watch pressure hint. A requested duration SHALL never be silently changed.

#### Scenario: Manual trace run
- **WHEN** the user runs `trace`
- **THEN** deep 2s bundles with spawn-probe timing are captured and appended to the run stream as they occur
- **AND** a HANG list is emitted from the bundles

#### Scenario: Watch-to-trace handoff stays manual
- **GIVEN** watch has printed a pressure hint
- **WHEN** the user accepts the hint
- **THEN** a `trace` run starts with the same bundle schema as a manual run

#### Scenario: Out-of-range duration is announced
- **GIVEN** the user requests a duration above the current maximum
- **WHEN** the trace starts
- **THEN** the console states the requested and effective durations
- **AND** the report's settings record both values with the reason

### Requirement: Zero unknown process names
The system SHALL resolve every in-scope and system-set process row to a human identity via the known-name map first, then file-description or service-name fallback, and flag anything still unidentified as `unresolved`, never silently listed. Out-of-scope processes are not named and contribute only to aggregates. Unresolved rows SHALL keep the executable name and the source tried, never a command line.

#### Scenario: KNOWN map hit
- **GIVEN** an in-scope or system-set process image matches a known-name map entry (e.g. node, Defender, vmmem)
- **WHEN** the row is rendered
- **THEN** the human label and its name source are shown

#### Scenario: FileDescription fallback
- **GIVEN** an in-scope process image has no known-name map entry but exposes a file description or a service name
- **WHEN** the row is rendered
- **THEN** the friendly name plus its source is shown

#### Scenario: Unresolved flag
- **GIVEN** neither the known-name map nor the fallback identifies an in-scope process
- **WHEN** the row is rendered
- **THEN** it is flagged `unresolved` with its executable name and the sources tried
- **AND** no command line is stored for it

#### Scenario: Out-of-scope rows are never resolved to names
- **GIVEN** a scoped run
- **WHEN** an out-of-scope process is present
- **THEN** no identity lookup result for it is written to any artifact
- **AND** it is counted only in the out-of-scope aggregate

### Requirement: Power truth per sample
The system SHALL record, on every watch sample and continuous trace sample, the AC/battery state, the battery charge percentage (numeric whenever a battery exists), and each value's as-of time; SHALL record each AC/battery transition with its time; SHALL record the power plan by friendly name with its identifier; and SHALL NOT state that no battery exists unless the platform reports none.

#### Scenario: Battery percentage parsed on a laptop
- **GIVEN** canned power-status output `line=Online;pct=99` on one line
- **WHEN** the power sample is parsed
- **THEN** the sample records AC true and battery 99 %
- **AND** neither value is null

#### Scenario: Transition recorded with time
- **GIVEN** a run during which the charger is unplugged at a known wall-clock time
- **WHEN** the run completes
- **THEN** the run records one transition from AC to battery with a wall-clock time within one sampling interval of the unplug
- **AND** samples after the transition record AC false

#### Scenario: Every power value carries its as-of time
- **WHEN** any sample is recorded
- **THEN** the AC state and battery percentage each carry an as-of time no older than the sample's own sampling interval

#### Scenario: No false "no battery" statement
- **GIVEN** a laptop whose platform reports a battery at 99 %
- **WHEN** `check-stub` runs
- **THEN** its output reports the battery percentage
- **AND** it does not contain the text "no battery"

#### Scenario: Unplugged-vs-plugged claim is answerable
- **GIVEN** samples span AC and battery states
- **WHEN** a report is rendered
- **THEN** each sample window shows AC state, power plan name, power mode, battery %, and processor performance

### Requirement: Calm-linked evidence alongside hang evidence
The system SHALL emit calm-linked evidence (calm share, green windows with min/avg/max + top consumer) in the same pack as hang-linked evidence (stall time, commit %, top holder at stall).

#### Scenario: Pack answers both hang and calm questions
- **WHEN** a report pack is rendered
- **THEN** hang rows show stall duration with commit % and top holder at stall time
- **AND** green windows show min/avg/max with top consumer, AC state, and scheme

#### Scenario: Calm share is computed
- **WHEN** a baseline covers mixed calm and hang windows
- **THEN** the pack reports calm share (calm intervals / total intervals) with n and window recorded

### Requirement: WER AppHang history counts
The system SHALL read Windows Error Reporting archive history and report AppHang counts with the window that was searched, keeping counts from inside the run window separate from earlier history. Grouping by fault bucket is deferred (DEF-3).

#### Scenario: WER counts carry their window
- **GIVEN** 12 archived AppHang reports, of which 1 was written during the run
- **WHEN** the report is built
- **THEN** in-run AppHang count is 1 with the run window recorded
- **AND** history AppHang count is 12 labelled as all-time history

#### Scenario: WER history attached to HANG
- **GIVEN** WER archive entries exist for a hung executable
- **WHEN** a HANG row is emitted
- **THEN** the row includes the in-run and history AppHang counts with their searched windows and n

#### Scenario: No WER history is explicit
- **GIVEN** no WER archive entries match
- **WHEN** the report is built
- **THEN** it records zero matches with the searched window instead of omitting the field

### Requirement: OS-confirm via Responding poll
The system SHALL check, at each suspected hang, whether the OS reports any in-scope process as not responding, excluding suspended and background-only applications. It SHALL record the result, the poll time, and the matching in-scope process groups on that hang row. Results polled at another time SHALL NOT be copied onto the row.

#### Scenario: OS confirms hang
- **GIVEN** a spawn stall flags a suspected hang while an in-scope foreground process is reported not responding
- **WHEN** the not-responding check runs within 2 s of the hang
- **THEN** the HANG row is marked OS-confirmed with the poll time and the in-scope group name

#### Scenario: OS denies hang
- **GIVEN** a suspected hang is flagged
- **WHEN** the check finds every in-scope process responding
- **THEN** the row is marked unconfirmed with the poll result and poll time retained

#### Scenario: Suspended apps never confirm
- **GIVEN** the only processes reported not responding are suspended store apps (e.g. a notes app and a settings app)
- **WHEN** the check runs at a hang
- **THEN** the row is marked unconfirmed and neither app name is recorded

#### Scenario: Deferred poll is not back-filled
- **GIVEN** the check could not run at a hang because collection was over budget
- **WHEN** an end-of-run poll later succeeds
- **THEN** the hang row records `not-evaluated` with the reason, and the end-of-run result is not attached to it

### Requirement: User ground-truth marks
The system SHALL accept user ground-truth marks with a kind (`hung` or `fine`), the wall-clock time of the key press, and an optional note. It SHALL join each mark to the nearest probe within ±2 s and show it beside the matching hang or calm row.

#### Scenario: User marks a hang
- **WHEN** the user records a `hung` mark with a note at 10:00:06.5 and a hang probe exists at 10:00:05.0
- **THEN** the report joins the mark to that hang row and shows the note beside it

#### Scenario: User marks calm
- **WHEN** the user records a `fine` mark at a time whose nearest probe within ±2 s is calm
- **THEN** the report joins the mark to that calm probe as a calm anchor

#### Scenario: Mark with no probe nearby
- **GIVEN** a `hung` mark with no probe within ±2 s
- **WHEN** marks are joined
- **THEN** the mark is listed as `unmatched` with the gap to the nearest probe, and it counts against proxy recall

### Requirement: Multi-report trend and comparison
The system SHALL provide a trend mode that lists every trace report in the output directory, one row each (date, hang count, worst latency, commit %, paging rate, plug state), with deltas against the newest report. It SHALL also compare two named reports, or two tagged windows, as A-minus-B deltas that state their basis and use "unknown", never zero, for missing values.

#### Scenario: Trend table over stored reports
- **GIVEN** an output directory with at least two readable trace reports
- **WHEN** the user runs trend mode against that directory
- **THEN** a header states the report count and the newest file
- **AND** one row per readable report is printed with its delta columns versus the newest

#### Scenario: Two-report comparison
- **WHEN** the user runs trend mode with the compare option and two report names
- **THEN** the output names both files and prints A-minus-B deltas
- **AND** a basis line states that a positive delta means A was worse

#### Scenario: Missing comparison input is stated
- **WHEN** the user runs the compare option naming a file that does not exist
- **THEN** the output states that two readable reports are needed and names both requested files

### Requirement: Approval pack assembly
The system SHALL provide a pack mode that writes one JSON file combining the asset context, sustained evidence (from the watch log when it has at least 5 rows, otherwise the latest trace window labelled as single-window), hang summary, tier and filter audit, power, and recorded thresholds, plus a provenance block naming every source file.

#### Scenario: Pack names its sources
- **GIVEN** an output directory with one readable trace report and no watch log
- **WHEN** the user runs pack mode
- **THEN** a pack JSON file is written to the output directory
- **AND** its sustained section is labelled as a single trace window, not sustained
- **AND** its provenance block names the trace report file

#### Scenario: Pack with no inputs says so
- **GIVEN** an empty output directory
- **WHEN** the user runs pack mode
- **THEN** the pack's sustained section has source `none` with a note that no watch log and no trace report were available
- **AND** the pack's hang count is `unknown`, never 0

### Requirement: Sustained watch rollup
The system SHALL aggregate stored watch-log rows per calendar day into: row count, first-to-last window, median cadence, share of rows with commit at or above the commit threshold, commit peak, and paging-rate (pages per second) p95. Hangs per day SHALL be reported as not available from watch rows, never as zero.

#### Scenario: Per-day rollup rows
- **GIVEN** watch-log rows spanning two calendar days
- **WHEN** the user runs the watch rollup
- **THEN** two day rows are printed, each with n, window, cadence, and the commit-over-threshold share
- **AND** the hangs column reads `n/a`

#### Scenario: No watch rows
- **GIVEN** an output directory with no watch-log files
- **WHEN** the user runs the watch rollup
- **THEN** the output states that no rows were found and reports the file count as 0

### Requirement: OS event records windowed to the run
OS application-hang, application-crash, and resource-exhaustion records SHALL count as run evidence only if they fall within the run window (start minus a recorded lead, through end). Resource-exhaustion records SHALL come only from the OS resource-exhaustion source. Older records SHALL be labelled history, and zero matches SHALL be recorded as "none in window", not a timeout.

#### Scenario: Old event is history, not evidence
- **GIVEN** an application-hang record from the previous day and none during the run
- **WHEN** the trace report is built
- **THEN** the in-window application-hang list is empty
- **AND** the history section counts 1 record with its timestamp
- **AND** no summary reason or verdict input cites OS hang events

#### Scenario: Unrelated provider filtered
- **GIVEN** an event with the resource-exhaustion ID from a different provider, with the message "Successfully logged OS information"
- **WHEN** events are collected
- **THEN** it does not appear in the resource-exhaustion list

#### Scenario: No events is not a timeout
- **GIVEN** the event query returns zero records for the window
- **WHEN** the result is recorded
- **THEN** the events mode is `none-in-window`
- **AND** no collection failure with mode `timeout` is recorded for the events collector

## Deferred
(Dated 2026-10-07. Replaces the stale v0.5-era deferral block. Each item: see openspec/IMPLEMENTATION-PLAN.md §6.5.)
- DEF-3: per-fault-bucket WER grouping and per-HANG WER bucket rows (see IMPLEMENTATION-PLAN.md §6.5).
- DEF-2: lagged hang correlation and the culprit-confidence formula, not implemented (see IMPLEMENTATION-PLAN.md §6.5).
