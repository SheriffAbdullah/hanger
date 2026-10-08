## ADDED Requirements

### Requirement: Workload session phases
The system SHALL let the user tag workload phases (start and stop, with a label) during a run by a key press or at launch by a flag or scope-file entry, SHALL persist each phase bound with its wall-clock time as soon as it occurs, and SHALL compare idle and loaded phases per signal in the run summary with the sample count on each side.

#### Scenario: Key press opens and closes a labelled phase
- **GIVEN** a trace started with phase label "loaded"
- **WHEN** the user presses the phase key at 10:00:05 and again at 10:03:05
- **THEN** the report lists one phase labelled "loaded" with start 10:00:05 and end 10:03:05 (wall clock) and source "key"

#### Scenario: Phase bound survives an interrupted run
- **GIVEN** a phase was opened during a trace
- **WHEN** the run is killed before it finishes
- **THEN** the persisted run stream already contains the phase-start record with its wall-clock time
- **AND** the phase is shown with end "unfinished"

#### Scenario: Idle versus loaded comparison carries n per side
- **GIVEN** a run with an "idle" phase of 30 samples and a "loaded" phase of 45 samples of commit %
- **WHEN** the run summary is computed
- **THEN** the summary reports commit % mean and p95 for idle (n=30) and loaded (n=45) separately
- **AND** samples outside any phase are counted as untagged and are included in neither side

#### Scenario: No phases declared
- **WHEN** a run has no phase tags
- **THEN** the report states that no workload phases were declared and no idle-versus-loaded comparison is made

### Requirement: Workload lifecycle markers
The system SHALL record start and exit of in-scope processes and start and stop of in-scope containers as markers with wall-clock time, kind, and in-scope label, and SHALL NOT record any lifecycle event of an out-of-scope process or container.

#### Scenario: In-scope container start is marked
- **GIVEN** a container whose name is in the declared scope
- **WHEN** it starts during a trace
- **THEN** the report contains a "container-start" marker with its wall-clock time and the in-scope container label

#### Scenario: In-scope process exit is marked
- **GIVEN** an in-scope database process running at trace start
- **WHEN** the process exits during the trace
- **THEN** a "process-exit" marker is recorded with its wall-clock time

#### Scenario: Out-of-scope lifecycle is never recorded
- **GIVEN** a canary process and a canary container, both outside the declared scope
- **WHEN** both start and stop during a trace
- **THEN** no marker exists for either
- **AND** a search of every persisted artifact and the console output for the canary names finds zero matches
