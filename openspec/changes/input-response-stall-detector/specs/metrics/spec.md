## ADDED Requirements

### Requirement: Input-stall records carry provenance
The system SHALL store every numeric value of the detector (durations, latencies, counts, baseline and lateness statistics, evaluated and not-evaluable seconds, helper cost) as a provenance record in the format of the other stored metrics, with source `input-helper` for helper observations and `diagnosis` for derived values. Latencies and durations use unit `ms` (precision 1), times use `s` (precision 0.001), shares use `%` (precision 0.1). Absent values SHALL be null with a reason, never 0.

#### Scenario: Episode metrics are provenance records
- **GIVEN** an episode with worst latency 1203.6 ms over 5 stall samples
- **WHEN** the report is written
- **THEN** the episode's worst latency is stored with value 1204, unit "ms", windowS equal to the episode duration in seconds, n 5, source `input-helper`, an ISO-8601 measuredAt and precision 1

#### Scenario: Validator rejects a bare number
- **GIVEN** a report whose `inputStall.episodes[0].durationMs` is a bare number
- **WHEN** `node tools/hanger/test/helpers/validate-report.js` checks it
- **THEN** it exits non-zero and names the field

#### Scenario: No data is null with a reason
- **GIVEN** a run in which the detector observed no evaluated moment
- **WHEN** the calm baseline is written
- **THEN** its median, p95 and maximum are null, each with a reason, never 0

### Requirement: Input-stall report section
The system SHALL store the detector results under one optional root key `inputStall` containing: status (`running`, `unavailable` with reason and time, or `not-requested` with source), settings in force with source, helper identity, evaluated and not-evaluable time, `episodes[]`, blips, calm baseline, helper lateness, flags, anonymous out-of-scope counts and a cannot-see list. Absence of the key means the report predates the detector.

#### Scenario: Episode shape
- **WHEN** a report with one episode is written
- **THEN** the episode contains id, start, end, duration, worst latency, sample count, foreground, end reason, guard flags, corroboration, confidence with components and sample references

#### Scenario: Unavailable detector keeps the section
- **GIVEN** a run in which the helper could not start
- **WHEN** the report is written
- **THEN** `inputStall.status` is `unavailable` with a non-empty reason and time
- **AND** `episodes` is null with the same reason, not an empty list

#### Scenario: Detector running with no episodes
- **GIVEN** a run in which the detector ran and observed no stall
- **WHEN** the report is written
- **THEN** `inputStall.episodes` is an empty list and `evaluable.evaluatedS` is greater than 0

#### Scenario: Older report lacks the key
- **GIVEN** a stored report written before this change
- **WHEN** a reader needs `inputStall`
- **THEN** it treats the detector as `not evaluated: report predates the detector` and does not fail

#### Scenario: Episode carries its evidence
- **WHEN** a report with one episode is written
- **THEN** the episode also carries its guard flags, corroboration list, confidence with components, end reason and references to its stall samples

### Requirement: Agreement and corroboration metrics are stored as second-order values
The system SHALL store the probe agreement metrics and the corroboration counts under `diagnosis`, separate from the first-order episodes, with the join tolerance and the thresholds used, so that a stored report recomputes the same values from its stored first-order data.

#### Scenario: Recomputation reproduces agreement
- **GIVEN** a completed report with episodes, probes and recorded thresholds
- **WHEN** agreement is recomputed from the stored first-order data
- **THEN** the recomputed values equal the stored values

#### Scenario: Pack uses recorded thresholds
- **GIVEN** a report recorded with a 250 ms stall threshold
- **WHEN** `pack --stall-ms 500` runs
- **THEN** the pack's derived values use 250 and the pack records 250 as the threshold used
