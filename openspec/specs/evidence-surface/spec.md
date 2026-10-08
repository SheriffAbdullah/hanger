# evidence-surface Specification

## Purpose
Define the product contract for Telltale as an evidence surface: it observes, numbers, reasons, traces causes, and presents machine behavior truthfully — without ever rendering a verdict.

## Requirements

### Requirement: Evidence surface, never verdict-maker

The system SHALL present observed numbers, reasons, and candidate causes, and SHALL NOT declare whether the user deserves a new machine or prescribe a purchase.
The headline finding label SHALL be derived from the leading cause class of the
diagnosis ranking (fixed vocabulary), SHALL carry the run's scope and window, and
SHALL NOT use the word "STATE" or name a cause class whose rule did not fire.

#### Scenario: Report contains no purchase verdict

- **WHEN** a user opens any completed report in any view
- **THEN** the report presents metrics, reasons, and ranked candidate causes
- **AND** the report contains no purchase recommendation or eligibility verdict
- **AND** the headline finding states its run window and declared scope (never a bare machine claim)

#### Scenario: Cost context stays subordinate to evidence

- **GIVEN** a report includes time-lost arithmetic for context
- **WHEN** a user reads that section
- **THEN** the figures appear only in the appendix, labelled as derived context alongside their measured inputs
- **AND** no judgment about what the user should do is stated or implied

#### Scenario: Label cannot contradict the cause class

- **GIVEN** a run where only a disk-stall rule and a stall count fired and no memory rule fired
- **WHEN** the headline finding is produced
- **THEN** its class is `disk`
- **AND** no memory-named label (e.g. `RAM-BOUND`) appears anywhere in the report

### Requirement: Observe the machine with timestamps

The system SHALL observe processes, memory, CPU, disk, GPU, power, events, and application probes, and every observation SHALL carry the wall-clock timestamp at which it was measured.

#### Scenario: Observations are timestamped before any computation

- **WHEN** the system captures any first-order observation
- **THEN** each observation is stored with its measurement timestamp
- **AND** no averaging or aggregation removes the underlying timestamped values

#### Scenario: Timestamps are measured, not computed from the schedule

- **GIVEN** a trace in which the collection loop ran late by 14 s
- **WHEN** the stored samples are inspected
- **THEN** the sample timestamps show the 14 s gap rather than evenly spaced nominal times

### Requirement: Number every metric

The system SHALL express every reported metric as a number with an explicit unit, measurement window, and sample count. Every value stored in the report JSON SHALL be a provenance record carrying value, unit, window in seconds, n, source collector id, measurement wall-clock time, and precision. A bare unitless numeric key SHALL NOT appear in the stored report.

#### Scenario: Metric reading carries number, unit, window, and count

- **WHEN** a user reads any metric in a report
- **THEN** the metric shows its numeric value, unit, window, and sample count (e.g. `spawn.p95.ms[120s,n=60]=1676`)
- **AND** no reported metric appears as a bare number without that context

#### Scenario: Stored value is a provenance record

- **GIVEN** a probe that measured committed memory at 87.46% from the continuous counter collector
- **WHEN** the probe is persisted
- **THEN** the stored value has value 87.5, unit "%", windowS, n, source equal to the collector id, measuredAt as an ISO-8601 wall-clock time, and precision 0.1

#### Scenario: Report validator rejects bare keys

- **GIVEN** a report whose probe stores `committed: 87.46` as a bare number
- **WHEN** `node tools/telltale/test/helpers/validate-report.js` checks it
- **THEN** the validator exits non-zero and names the field `committed`

### Requirement: Reason every number

The system SHALL accompany every reported number with its reason: how it was sampled, at what cadence, what healthy looks like, and what confounds it.

#### Scenario: Metric reason is visible alongside the number

- **WHEN** a user inspects any reported metric
- **THEN** the sampling method and cadence are stated
- **AND** the healthy range and known confounds (e.g. antivirus scan, power throttle, timer granularity) are stated

### Requirement: Trace causes with ranked confidence, never certainty

The system SHALL correlate each hang with same-window evidence, meaning values measured at the hang compared against calm-window means with their sample counts, and SHALL rank candidate causes with a confidence derived from that evidence that is never stated as certainty.

#### Scenario: Hang event links to same-window evidence with confidence

- **GIVEN** a hang event was detected in a measurement window
- **WHEN** a user reads the cause analysis for that hang
- **THEN** each candidate cause shows its at-hang values beside the calm mean and n
- **AND** each candidate cause carries an explicit confidence score below certainty (at most 0.95)

#### Scenario: Trace-wide extremes are not same-window evidence

- **GIVEN** a run whose commit peak of 88% occurred 17 s before a hang where commit was 83%
- **WHEN** the cause analysis for that hang is produced
- **THEN** the 88% peak is not an input to any cause for that hang

### Requirement: First-order data is never overwritten by second-order computation

The system SHALL preserve first-order observations unchanged, and SHALL compute second-order derivations (percentiles, hang events, rates, deltas, rollups, correlations) as separate versioned values that reference their inputs and thresholds. Every recomputation, including the one in pack, SHALL use the thresholds recorded in the report, never current command-line values.

#### Scenario: Recomputation reproduces second-order values from stored inputs

- **GIVEN** a completed report with recorded thresholds and inputs
- **WHEN** second-order values are recomputed from the stored first-order data
- **THEN** the recomputed values match the reported values

#### Scenario: Pack ignores current threshold flags

- **GIVEN** a trace recorded with a commit threshold of 85
- **WHEN** the user runs `pack --commit 50`
- **THEN** the pack's derived values for that trace are computed with threshold 85
- **AND** the pack records 85 as the threshold used

### Requirement: Metric discipline on every metric

The system SHALL record `id, unit, cadence, n, window, collector, healthy-range, confounds` for every metric, and SHALL NOT present single-sample counters as proof.

#### Scenario: Metric carries full discipline metadata

- **WHEN** a user inspects any metric definition in a report
- **THEN** all of id, unit, cadence, sample count, window, collector, healthy range, and confounds are present

#### Scenario: Single samples are not presented as evidence

- **WHEN** only one sample exists for a counter-based claim
- **THEN** the system does not present it as proof of a condition

### Requirement: JSON is truth, MD and HTML are views

The system SHALL emit each evidence pack as raw JSON first, with Markdown and HTML rendered strictly as views of that JSON. A view SHALL state "unknown" for any value the JSON records as unknown or null and SHALL NOT substitute a definite value.

#### Scenario: Views match JSON truth

- **WHEN** a user compares the Markdown or HTML view against the JSON of the same report
- **THEN** every number and reason in the views traces to a value in the JSON
- **AND** the views introduce no numbers absent from the JSON

#### Scenario: Anonymized JSON parses and renders

- **GIVEN** a trace written with anonymization enabled
- **WHEN** the JSON is parsed and the print view is rendered from it
- **THEN** both succeed without error

#### Scenario: Unknown power state is not shown as battery

- **GIVEN** a report whose AC state is null
- **WHEN** the print view is rendered
- **THEN** the power line says the AC state is unknown
- **AND** does not contain "Battery (unplugged)"

### Requirement: Thresholds are recorded and provisional

The system SHALL record every threshold used in a derivation inside the report, and SHALL treat thresholds as provisional until cited.

#### Scenario: Report records the thresholds behind its derivations

- **WHEN** a user reads any threshold-derived value (e.g. a hang count)
- **THEN** the threshold that produced it (e.g. `--hang 800`) is recorded in the same report

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
