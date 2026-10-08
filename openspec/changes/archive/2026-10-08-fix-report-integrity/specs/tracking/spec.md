## ADDED Requirements

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

## MODIFIED Requirements

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
