## ADDED Requirements

### Requirement: Container and WSL2 visibility over time
The system SHALL record, as time series at a bounded cadence, CPU % and memory used and limit for each in-scope container, and the virtual-machine host memory as seen by the host. Where visible, it SHALL also record the configured VM memory cap and guest-reported memory. Each collection call SHALL be time-bounded. When the platform is absent, stopped, or unresponsive, values SHALL be null with a plain-language reason.

#### Scenario: In-scope container series recorded
- **GIVEN** a running container named in the declared scope
- **WHEN** a 120 s trace completes
- **THEN** the report contains at least 6 timestamped samples for that container, each with CPU %, memory used MB, and memory limit MB, with unit, window, and source

#### Scenario: Out-of-scope containers contribute only aggregates
- **GIVEN** two running containers outside the declared scope
- **WHEN** container samples are recorded
- **THEN** each sample carries only the out-of-scope count, total CPU %, and total memory MB
- **AND** no out-of-scope container name or id appears in any artifact

#### Scenario: Container platform not installed
- **WHEN** a trace runs on a machine without the container platform
- **THEN** container values are null with reason "not installed"
- **AND** no raw shell error text appears in the report or any view

#### Scenario: Unresponsive container platform does not stall sampling
- **GIVEN** a container platform call that does not return
- **WHEN** the call exceeds its time budget
- **THEN** that sample is null with reason "unresponsive (timed out after N s)"
- **AND** the continuous sampler's achieved cadence for that run is unaffected beyond the recorded budget

#### Scenario: VM memory cap configured versus not configured
- **WHEN** the user's VM configuration sets a memory cap of 8 GB
- **THEN** the report records the configured cap as 8192 MB with its source
- **AND WHEN** no cap is configured, the report records null with reason "no cap configured (default applies)"

#### Scenario: Guest memory never forces the VM to start
- **GIVEN** the Linux VM is stopped
- **WHEN** a trace runs
- **THEN** guest memory is null with reason "VM not running"
- **AND** the VM is still stopped after the trace

### Requirement: Workload latency probe
The system SHALL run a workload latency probe only when the user declares it in the scope file. It SHALL record only the wall time and status class (ok, nonzero, timeout, not-found) per attempt, discard output, apply a timeout (default 5 s), never run it elevated or through a shell, and record timeouts as timeouts.

#### Scenario: Declared probe yields a latency series
- **GIVEN** a scope file declaring a probe every 5 s
- **WHEN** a 60 s trace runs
- **THEN** the report contains at least 10 attempts, each with wall-clock time, duration ms, and status class

#### Scenario: Timeout recorded as timeout
- **GIVEN** a declared probe whose command blocks longer than its timeout
- **WHEN** the probe runs
- **THEN** the attempt is recorded with status "timeout" and duration equal to the timeout
- **AND** the probe process has been terminated

#### Scenario: Output and command text are never persisted
- **GIVEN** a probe whose command prints a canary string and has a canary argument
- **WHEN** the trace completes
- **THEN** neither canary string appears in any persisted artifact or the console; only the probe name appears

#### Scenario: No probe without declaration
- **WHEN** the scope file declares no probes
- **THEN** no workload command is executed and the report states "no workload probe declared"

#### Scenario: Shell-string command is rejected
- **WHEN** a scope file declares a probe command as a single string instead of an argument list
- **THEN** the run refuses to start the probe and states the reason

### Requirement: Workload configuration facts
The system SHALL collect workload configuration facts only when declared in the scope file. These are database memory settings when the database is in scope and reachable without stored credentials, and the configured VM memory cap. Each fact SHALL be a value or an unavailable reason, with its source. The system SHALL never store credentials.

#### Scenario: Database settings recorded when reachable
- **GIVEN** an in-scope database declared under `config` and reachable without a password
- **WHEN** a trace runs
- **THEN** the report records the database's shared memory buffer size, per-operation work memory, and maximum connections, each with source "database settings"

#### Scenario: Authentication required
- **GIVEN** a declared database that requires a password
- **WHEN** the facts are collected
- **THEN** each database fact is null with reason "authentication required (credentials are never stored)"

#### Scenario: Secret-like keys rejected
- **WHEN** a scope file `config` entry contains a key named like password, pwd, or secret
- **THEN** the scope file is rejected at load with a message naming the key, and no run starts

#### Scenario: Database out of scope
- **GIVEN** a `config` entry for a database that is not in the declared scope
- **WHEN** a trace runs
- **THEN** no database query is made and the fact is null with reason "not declared in scope"
