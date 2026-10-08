## MODIFIED Requirements

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

## ADDED Requirements

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
