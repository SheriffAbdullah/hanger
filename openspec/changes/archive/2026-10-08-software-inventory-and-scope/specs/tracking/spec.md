## MODIFIED Requirements

### Requirement: Zero unknown process names
The system SHALL resolve every in-scope and system-set process row to a human identity via the known-name map first, then file-description or service-name fallback, and flag anything still unidentified as `unresolved`, never silently listed. Out-of-scope processes are not named and contribute only to aggregates. Unresolved rows SHALL keep the executable name and the source tried, never a command line.

#### Scenario: KNOWN map hit
- **GIVEN** an in-scope or system-set process image matches a known-name map entry (e.g. node, Defender, vmmem)
- **WHEN** the row is rendered
- **THEN** the human label and its name source are shown

#### Scenario: FileDescription fallback
- **GIVEN** an in-scope process image has no known-name map entry but exposes a file description or a service name
- **WHEN** the row is rendered
- **THEN** the friendly name plus its source is shown

#### Scenario: Unresolved flag
- **GIVEN** neither the known-name map nor the fallback identifies an in-scope process
- **WHEN** the row is rendered
- **THEN** it is flagged `unresolved` with its executable name and the sources tried
- **AND** no command line is stored for it

#### Scenario: Out-of-scope rows are never resolved to names
- **GIVEN** a scoped run
- **WHEN** an out-of-scope process is present
- **THEN** no identity lookup result for it is written to any artifact
- **AND** it is counted only in the out-of-scope aggregate
