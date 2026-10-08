## ADDED Requirements

### Requirement: Email states the input-response check
The email draft SHALL include one line about the automatic input-response check: the number of stall episodes, how many of the run's freezes the check also saw, and the probe agreement figures, all from the report JSON. When the check was unavailable or off, the line SHALL say so with the reason and contain no number for it. The line SHALL name no out-of-scope application.

#### Scenario: Line present with backed numbers
- **GIVEN** a fixture with 4 episodes, 5 freezes of which 3 overlap an episode, and the threshold 250 ms
- **WHEN** the draft is rendered
- **THEN** it contains one line giving 4 episodes, 3 of 5 freezes, and 250 ms
- **AND** every number in it equals a JSON value or a count derivable from the JSON

#### Scenario: Unavailable check is stated without numbers
- **GIVEN** a fixture whose detector status is `unavailable` for reason "helper blocked by policy"
- **WHEN** the draft is rendered
- **THEN** the line says the input-response check was not available and gives the reason
- **AND** the line contains no episode count

#### Scenario: Run with no episodes does not claim no freezes
- **GIVEN** a fixture with the detector running and zero episodes
- **WHEN** the draft is rendered
- **THEN** the line says no input-response stall was observed in the evaluated time
- **AND** it does not claim the machine did not freeze
