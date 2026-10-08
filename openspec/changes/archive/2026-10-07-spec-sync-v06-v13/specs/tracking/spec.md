## ADDED Requirements

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
