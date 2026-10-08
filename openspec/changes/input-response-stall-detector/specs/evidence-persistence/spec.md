## ADDED Requirements

### Requirement: Helper evidence survives the main process
The system SHALL keep helper observations in the helper's own append-only file beside the run stream, record that file's name in the stream at run start, and merge it into the summary at normal run end and in `recover`. The helper file SHALL be the single source of truth for helper observations. Unreadable lines SHALL be counted and reported, never fatal.

#### Scenario: Main process killed during a stall
- **GIVEN** a trace in which the helper recorded an episode and the main process is then killed without a run-end record
- **WHEN** the user runs `recover` on the stream
- **THEN** the summary report contains that episode in `inputStall.episodes`
- **AND** `run.status` is `unfinished`

#### Scenario: Helper file missing at recover
- **GIVEN** a stream whose helper file was deleted
- **WHEN** `recover` runs
- **THEN** `inputStall.status` is `unavailable` with reason naming the missing file
- **AND** the recovery otherwise succeeds

#### Scenario: Torn last line
- **GIVEN** a helper file whose last line is truncated
- **WHEN** the summary is built
- **THEN** all complete lines are used and the bad-line count is reported

#### Scenario: Normal end and recover agree
- **GIVEN** a completed run
- **WHEN** the same stream is recovered
- **THEN** the recovered `inputStall.episodes` equal those in the original report

### Requirement: Input-stall fields are additive under the schema freeze
The system SHALL add the detector's report fields as additive fields of `telltale-json/2`, record them in a dated `2.x` section of the schema changelog, and SHALL NOT rename or remove any existing field. `schemaStatus` SHALL remain `frozen`. Readers SHALL display an unknown confirmation label unchanged. The fields are `inputStall`, `settings.inputStall`, `diagnosis.probeAgreement`, `diagnosis.inputStallCorroboration`, per-hang `helperLate` and the `input-stall` label.

#### Scenario: Changelog records the fields
- **WHEN** this change is complete
- **THEN** `tools/telltale/SCHEMA-CHANGELOG.md` has a dated `2.x` section listing every added field
- **AND** the root `schema` of new reports is still `telltale-json/2` with `schemaStatus` `frozen`

#### Scenario: Existing consumers still read the report
- **GIVEN** a report with `input-stall` confirmations
- **WHEN** `pack`, `trend` and every renderer read it
- **THEN** each succeeds and shows the label

#### Scenario: Older reports still validate
- **GIVEN** a frozen v2 report written before this change
- **WHEN** `node tools/telltale/test/helpers/validate-report.js` checks it
- **THEN** it passes
