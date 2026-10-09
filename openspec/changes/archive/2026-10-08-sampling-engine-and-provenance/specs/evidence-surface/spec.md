# Spec Delta

## MODIFIED Requirements

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
- **WHEN** `node tools/hanger/test/helpers/validate-report.js` checks it
- **THEN** the validator exits non-zero and names the field `committed`
