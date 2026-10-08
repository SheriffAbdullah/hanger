## ADDED Requirements

### Requirement: Declared non-goals
The system SHALL NOT issue purchase or eligibility verdicts, act as a software-compliance scanner or report installed software to IT, operate as a fleet service, or upload reports anywhere. Reports SHALL stay on the local disk unless the user attaches them. Collectors SHALL be Windows-only, and other platforms SHALL exist only as a contract stub.

#### Scenario: No network upload path exists
- **WHEN** the tool source is searched for outbound network clients or HTTP requests made by the tool itself
- **THEN** no upload path is found
- **AND** every report file is written under the configured local output directory

#### Scenario: Reports stay out of version control
- **WHEN** the repository ignore rules are inspected
- **THEN** every file in the reports directory is ignored except the placeholder file, so a new report is never staged by `git add -A`

#### Scenario: Non-Windows platforms are stubs only
- **WHEN** the contract file is inspected
- **THEN** each non-Windows probe is listed as a candidate, not an implemented collector

### Requirement: Install and run contract
The system SHALL run on Windows 10 or later with Node.js 18 or later, SHALL need no dependency installation step, and SHALL collect its core signal set without elevation. Elevation SHALL only unlock the named extra signals (thermal zone, disk health, Sysmon state, system WER queue, debug-privilege details, kernel trace capture).

#### Scenario: Runs from a fresh clone with no install step
- **GIVEN** a fresh clone with no package manifest and no dependency folder
- **WHEN** the user runs the help command with Node.js 18 or later
- **THEN** the help text prints and the exit code is 0

#### Scenario: Core signals need no elevation
- **GIVEN** an unelevated shell
- **WHEN** the user runs a 10 s trace
- **THEN** the report is written and contains hang probes and OS first-order values
- **AND** only the named admin-only signals are marked skipped
