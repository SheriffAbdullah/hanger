## MODIFIED Requirements

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
