## MODIFIED Requirements

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
