## ADDED Requirements

### Requirement: Commit limit pressure rule
The system SHALL evaluate a commit-limit-pressure rule (cause class memory) at each hang. It fires when, on at least 3 usable probes in the hang window, commit is at least 90% of the commit limit, pagefile usage is rising, and available memory is below 5% of installed RAM. It SHALL report commit at the hang versus the calm mean, with n on each side.

#### Scenario: Commit limit pressure fires
- **GIVEN** a fixture with 16 GB RAM, commit at 93-96% of the limit on 4 usable probes around a hang, pagefile usage rising from 40% to 46%, and available memory 410-600 MB
- **WHEN** the diagnosis runs
- **THEN** the `commit-limit-pressure` result has `fired: true`, class `memory`, and `n` ≥ 3
- **AND** its inputs reference those 4 probes and its calm comparison carries the calm mean with its n

#### Scenario: Commit limit pressure does not fire on high commit alone
- **GIVEN** a fixture where commit is 92% of the limit at the hang but pagefile usage is flat and available memory is 3.1 GB of 16 GB
- **WHEN** the diagnosis runs
- **THEN** `commit-limit-pressure` has `fired: false`, and the unmet conditions are named in its result

#### Scenario: Commit limit pressure disproved
- **GIVEN** a fixture with 3 hangs where commit is below 80% of the limit at 2 of them
- **WHEN** the diagnosis runs
- **THEN** the rule's disprover result is `disproved`, and the rule is excluded from the ranked causes

### Requirement: Hard-fault thrash rule
The system SHALL evaluate a hard-fault-thrash rule (cause class memory) that fires only when, on at least 3 usable probes at the hang, pages written out per second are elevated, pagefile usage is rising, and the modified list is growing. Page reads alone SHALL never fire it, and the observer's own process launches SHALL be listed as a confound whenever observer cost was recorded.

#### Scenario: Real swap fires the rule
- **GIVEN** a fixture with pages output 350-900/s on 3 probes at a hang, pagefile usage from 30% to 35%, and the modified list growing from 400 to 520 MB
- **WHEN** the diagnosis runs
- **THEN** `hard-fault-thrash` has `fired: true` with class `memory`

#### Scenario: Image-load reads do not fire the rule
- **GIVEN** a fixture with pages input of 4513/s and pages output of 0/s at every probe, and pagefile usage flat at 8%
- **WHEN** the diagnosis runs
- **THEN** `hard-fault-thrash` has `fired: false`
- **AND** its confounds include image or mapped-file reads

#### Scenario: Observer confound listed
- **GIVEN** a fixture where the rule fires and the run recorded observer cost for the hang window
- **WHEN** the diagnosis runs
- **THEN** the rule's confounds include the observer's own process launches

### Requirement: Virtual machine memory dominance rule
The system SHALL evaluate a vm-memory-dominance rule (cause class memory) that fires when the virtualization host process group holds at least 40% of installed RAM on at least 3 usable probes at the hang, and the configured VM memory cap is absent or above 50% of RAM. The configured cap value or its absence SHALL be an input of the result.

#### Scenario: Uncapped VM dominates memory
- **GIVEN** a fixture with 16 GB RAM, a VM host group at 7.2-7.8 GB on 4 probes at a hang, and the configured VM cap recorded as absent
- **WHEN** the diagnosis runs
- **THEN** `vm-memory-dominance` has `fired: true`, with the VM share and "cap: absent" in its inputs

#### Scenario: Capped VM is disproved
- **GIVEN** the same fixture but with a configured VM cap of 6 GB (37.5% of RAM)
- **WHEN** the diagnosis runs
- **THEN** the rule's disprover result is `disproved`, citing the configured cap

#### Scenario: No VM present
- **GIVEN** a fixture with no virtualization host process group
- **WHEN** the diagnosis runs
- **THEN** `vm-memory-dominance` has `fired: false` and names the missing input

### Requirement: Database memory and I/O rule
The system SHALL evaluate a database-memory-io rule for an in-scope database process group. Its memory variant (class memory) fires when the group's memory plus its configured memory settings reach at least 25% of RAM at the hang. Its I/O variant (class disk) fires when disk latency is at least 25 ms with queue at least 1 while the group performs I/O. Either variant requires at least 3 usable probes. A missing configuration SHALL be named, not assumed.

#### Scenario: Database I/O variant fires
- **GIVEN** a fixture with an in-scope database group showing disk I/O and disk latency of 31-48 ms with queue 2-3 on 3 probes at a hang
- **WHEN** the diagnosis runs
- **THEN** `database-memory-io` has `fired: true` with class `disk` and the database group named in its inputs

#### Scenario: Configuration unavailable degrades honestly
- **GIVEN** a fixture where the database group holds 4.5 GB of 16 GB RAM at the hang and no database configuration facts were collected
- **WHEN** the diagnosis runs
- **THEN** the memory variant is evaluated on group memory alone
- **AND** the result names the database configuration as a missing input

#### Scenario: No database in scope
- **GIVEN** a fixture whose declared scope contains no database process group
- **WHEN** the diagnosis runs
- **THEN** `database-memory-io` has `fired: false` with reason "no in-scope database group"

### Requirement: Single-process dominance and growth rule
The system SHALL evaluate a single-process-dominance rule (class memory) over in-scope and system-set groups. It fires when one group holds at least 40% of used memory on at least 3 usable probes at the hang, or when its memory grows monotonically across at least 3 snapshots with total growth of at least 10%. The result SHALL name the group and list its snapshot values.

#### Scenario: Growth fires the rule
- **GIVEN** a fixture where the in-scope group `node` grows 4.8 → 5.5 → 6.2 GB across 3 snapshots that span hangs
- **WHEN** the diagnosis runs
- **THEN** `single-process-dominance` has `fired: true`, naming `node`, with the 3 snapshot values and their times as inputs

#### Scenario: Balanced memory does not fire
- **GIVEN** a fixture where no group exceeds 22% of used memory and no group grows across snapshots
- **WHEN** the diagnosis runs
- **THEN** `single-process-dominance` has `fired: false`

#### Scenario: Out-of-scope groups are never named
- **GIVEN** a scoped fixture where the largest memory holder is outside the declared scope
- **WHEN** the diagnosis runs
- **THEN** this rule does not name that holder
- **AND** that load is left to the outside-scope cause

### Requirement: Thermal and power throttling rule
The system SHALL evaluate a thermal-power-throttle rule (class thermal-power) at each hang on AC and on battery. It fires when total CPU is at least 50% and either delivered performance is below 60% of the run's calm-window median or an active performance limit is reported, on at least 3 usable probes. A trace-wide minimum SHALL NOT be an input. Temperature is supporting evidence only when present.

#### Scenario: Turbo laptop clamped at the hang
- **GIVEN** a fixture with calm-median performance 148%, performance 71-80% at a hang with CPU 85%, a performance-limit reason "thermal", and power source battery
- **WHEN** the diagnosis runs
- **THEN** `thermal-power-throttle` has `fired: true`, with the power source and the limit reason among its inputs

#### Scenario: Idle dip is not throttling
- **GIVEN** a fixture where performance drops to 40% only on probes with CPU below 10%, and is 140-150% at every hang
- **WHEN** the diagnosis runs
- **THEN** `thermal-power-throttle` has `fired: false`

#### Scenario: Missing performance data is not "no throttling"
- **GIVEN** a fixture where the performance signals are null with an unavailable reason
- **WHEN** the diagnosis runs
- **THEN** the rule has `fired: null` (not evaluated; the engine's value for "could not evaluate") with disprover result `not-evaluable`, naming the missing input
- **AND** no output states that throttling was ruled out

### Requirement: Battery and power-plan rule
The system SHALL evaluate a battery-power-plan rule (class thermal-power). It compares hang rates per observed minute on battery versus AC, requiring at least 3 hangs and at least 10 usable probes on each side. It fires when the battery rate is at least twice the AC rate, or when at least two thirds of hangs occur under an efficiency power mode or energy saver while fewer than one third of calm probes do.

#### Scenario: Battery doubles the hang rate
- **GIVEN** a fixture with 6 hangs over 12 observed minutes on battery (24 probes) and 3 hangs over 15 observed minutes on AC (30 probes)
- **WHEN** the diagnosis runs
- **THEN** `battery-power-plan` has `fired: true`
- **AND** the result reports both rates with their n and observed windows

#### Scenario: One power source only
- **GIVEN** a fixture where every probe is on AC
- **WHEN** the diagnosis runs
- **THEN** the rate comparison is recorded as not evaluated with reason "single power source observed"
- **AND** the rule fires only when the power-mode condition holds

#### Scenario: Equal rates disprove
- **GIVEN** a fixture with battery and AC hang rates of 0.40/min and 0.36/min, each side with at least 3 hangs and at least 10 probes
- **WHEN** the diagnosis runs
- **THEN** the disprover result is `disproved`

### Requirement: Driver interrupt storm rule
The system SHALL evaluate a driver-interrupt-storm rule (class cpu) that fires when the sum of deferred-procedure-call time and interrupt time is at least 10% of CPU on at least 3 usable probes at the hang. The result SHALL report that sum at the hang versus calm.

#### Scenario: Interrupt storm fires
- **GIVEN** a fixture with DPC 9% plus interrupt 4% on 3 probes at a hang, and a calm mean of 1.2%
- **WHEN** the diagnosis runs
- **THEN** `driver-interrupt-storm` has `fired: true`, with at-hang 13% and calm 1.2% (with n) as inputs

#### Scenario: Normal interrupt load disproves
- **GIVEN** a fixture where DPC plus interrupt stays below 3% at every hang
- **WHEN** the diagnosis runs
- **THEN** the disprover result is `disproved`

### Requirement: GPU contention rule
The system SHALL evaluate a gpu-contention rule (class gpu) only when GPU data exists for the hang window. It fires when the busiest GPU engine is at least 90% or dedicated GPU memory use is at least 95% of its total, on at least 3 usable probes at the hang. When GPU data is absent, the rule SHALL report it as not evaluated (`fired: null`) with the unavailable reason.

#### Scenario: GPU engine saturated
- **GIVEN** a fixture with the busiest GPU engine at 94-99% on 3 probes at a hang
- **WHEN** the diagnosis runs
- **THEN** `gpu-contention` has `fired: true` with class `gpu`

#### Scenario: No GPU data
- **GIVEN** a fixture whose GPU signals are null with reason "counters not exposed"
- **WHEN** the diagnosis runs
- **THEN** `gpu-contention` has `fired: null` (not evaluated), and its result carries "counters not exposed"

### Requirement: Suggested actions derive from fired rules
The system SHALL map each fired, non-disproved cause rule to one action from a fixed table. Actions are ordered by fixed cost rank, cheapest first: security-software exclusions, VM memory cap, power plan or AC, driver or firmware update, application memory fix, storage health check, memory capacity comparison. Each action SHALL cite its rule ids and hang counts. Action text SHALL contain no purchase verdict, and nothing fired yields an empty list.

#### Scenario: Actions ordered cheapest first
- **GIVEN** a fixture where `single-process-dominance`, `vm-memory-dominance` and `commit-limit-pressure` fire
- **WHEN** suggested actions are derived
- **THEN** `suggestedActions` lists the VM memory cap, then the application memory fix, then the memory capacity comparison
- **AND** each action cites its rule ids and `k/M` hangs

#### Scenario: Disproved rules give no action
- **GIVEN** a fixture where `driver-interrupt-storm` is disproved and no other rule fires
- **WHEN** suggested actions are derived
- **THEN** `suggestedActions` is an empty array

#### Scenario: No purchase language
- **WHEN** a test scans every action template
- **THEN** none contains the words "buy", "upgrade", "replace", "deserve" or "insufficient"
