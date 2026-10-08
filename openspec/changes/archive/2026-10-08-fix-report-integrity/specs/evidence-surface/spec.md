## MODIFIED Requirements

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
