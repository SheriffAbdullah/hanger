## ADDED Requirements

### Requirement: Per-process CPU and disk I/O attribution
The system SHALL record, on the continuous sampling tier, CPU usage as a percentage of the whole machine (0-100) and disk read and write rates in bytes per second for each in-scope process group and each system-set member, plus one anonymous aggregate for all out-of-scope processes carrying only group count, CPU percentage, read and write rates, and working-set MB.

#### Scenario: In-scope group CPU is attributed as machine share
- **GIVEN** a 12-logical-CPU machine where the in-scope group `postgres` consumes 270% of one core in raw per-core units
- **WHEN** a continuous sample is recorded
- **THEN** the `postgres` series value for that sample is 22.5 with unit `% of machine`
- **AND** no stored per-process CPU value exceeds 100

#### Scenario: Out-of-scope load is aggregated without names
- **GIVEN** a scoped run declaring only `postgres` and an out-of-scope process `zz-canary.exe` using 30% of the machine
- **WHEN** the run's artifacts are written
- **THEN** the out-of-scope aggregate for that sample includes the 30% share in its CPU total
- **AND** the string `zz-canary` appears in no artifact or console output

#### Scenario: Disk rates attribute I/O to the in-scope writer
- **GIVEN** canned collector output in which the in-scope group `postgres` writes 8,000,000 bytes/s and reads 3,000,000 bytes/s
- **WHEN** the parser builds the sample
- **THEN** the `postgres` entry records `writeBps` 8000000 and `readBps` 3000000 with unit `bytes/s`

### Requirement: Security and system component activity normalized to machine share
The system SHALL record CPU activity of registered security software and other system-set members as a percentage of the whole machine (0-100), and SHALL record the machine's logical CPU count once per run beside it. Memory compression memory SHALL be recorded every sample regardless of its rank.

#### Scenario: Per-core-scaled security CPU is normalized
- **GIVEN** canned collector output reporting security-software CPU of 190 in per-core units on a 12-logical-CPU machine
- **WHEN** the sample is recorded
- **THEN** the stored security-software value is 15.8 (one decimal) with unit `% of machine`
- **AND** the run records `logicalCpus` 12

#### Scenario: Memory compression is always present
- **GIVEN** a sample in which memory compression holds 640 MB and ranks below the top ten processes by working set
- **WHEN** the sample is recorded
- **THEN** the system-set entry for memory compression records 640 MB

### Requirement: Temperature time series
The system SHALL record temperature in °C per labelled zone on the continuous tier at the user tier wherever the platform exposes it, SHALL drop readings below 5 °C or above 130 °C while counting them, SHALL record GPU temperature when exposed, and SHALL record null with a reason (`not-exposed` or `tier`) when no zone is readable.

#### Scenario: Zones are labelled and implausible values dropped
- **GIVEN** canned collector output with zones `CPU package` at 344.15 K and `ACPI zone 3` at 273.25 K
- **WHEN** the sample is parsed
- **THEN** the sample records zone `CPU package` with role `cpu` at 71.0 °C
- **AND** `ACPI zone 3` (0.1 °C) is not stored as a value and `droppedImplausible` is 1

#### Scenario: Unexposed temperature is null with reason
- **GIVEN** an unelevated run on a machine that exposes no thermal zones to the user tier
- **WHEN** the run completes
- **THEN** every sample's temperature is null, never 0
- **AND** `collection.failures[]` contains one entry for the temperature inference with reason `not-exposed`

### Requirement: Turbo-aware performance and throttle signals
The system SHALL record on the continuous tier the processor's actual performance as a percentage of base performance (values above 100 permitted), the percentage of time performance was limited, and throttle reasons when the platform exposes them, so that a turbo-capable processor clamped to base clock registers as limited.

#### Scenario: Clamp from turbo registers as limited
- **GIVEN** canned samples where the legacy maximum-frequency percentage reads 100 throughout while actual performance falls from 148 to 60 and performance-limit rises from 0 to 85
- **WHEN** the samples are recorded
- **THEN** the performance series stores 148 then 60 with unit `% of base`
- **AND** the performance-limit series stores 0 then 85

#### Scenario: Missing throttle reasons are null, not empty success
- **GIVEN** a machine that does not expose throttle reasons
- **WHEN** a sample is recorded
- **THEN** throttle reasons are null with a reason in `collection.failures[]`

### Requirement: Commit charge absolute values
The system SHALL record committed bytes and the commit limit in bytes on every continuous sample, alongside the committed percentage, so that a low commit limit can be distinguished from high commit use.

#### Scenario: Commit absolute values stored
- **GIVEN** canned collector output with committed 16,100,000,000 bytes and commit limit 20,300,000,000 bytes
- **WHEN** the sample is recorded
- **THEN** it stores `committedBytes` 16100000000 and `commitLimitBytes` 20300000000 with unit `bytes`
- **AND** the committed percentage stored with it is 79.3

### Requirement: Paging direction signals
The system SHALL record pages read from disk per second and pages written to disk per second as separate series, and SHALL record paging-file usage percentage on every continuous sample.

#### Scenario: Reads and writes are separated
- **GIVEN** canned collector output with pages input 4513/s and pages output 0/s
- **WHEN** the sample is recorded
- **THEN** it stores `pagesInPerS` 4513 and `pagesOutPerS` 0 as separate values
- **AND** paging-file usage percentage is present on the same sample

### Requirement: Disk latency, queue, utilization, and throughput
The system SHALL record on the continuous tier disk transfer latency in milliseconds, current queue length, busy percentage, and read and write throughput in bytes per second.

#### Scenario: Latency stored in milliseconds
- **GIVEN** canned collector output reporting a transfer time of 0.0042 seconds, idle time 88%, and queue 0.3
- **WHEN** the sample is recorded
- **THEN** it stores `latencyMs` 4.2, `busyPct` 12, and `queue` 0.3, each with its unit

### Requirement: Network activity aggregate
The system SHALL record per active network adapter the received and sent bytes per second and the error count on the continuous tier, and SHALL flag adapters identified as VPN adapters together with the rule that identified them. The system SHALL NOT record per-process network activity.

#### Scenario: VPN adapter flagged with its rule
- **GIVEN** canned adapter data listing `Wi-Fi` and `Cisco AnyConnect Virtual Miniport Adapter`
- **WHEN** a sample is recorded
- **THEN** the AnyConnect adapter has `isVpn` true and records the matching rule
- **AND** `Wi-Fi` has `isVpn` false

#### Scenario: No per-process network data
- **WHEN** any run completes
- **THEN** no artifact contains a network value keyed by process or process group

### Requirement: GPU activity when exposed
The system SHALL record total GPU utilization and dedicated GPU memory in use when the platform exposes them, deriving a total from per-engine data when no total exists, SHALL collect per-process GPU data only on trigger and only for in-scope processes with its collection time recorded, and SHALL record null with a reason when GPU data is not exposed.

#### Scenario: Total derived from engines
- **GIVEN** canned per-engine utilization of 3D 40% and 3D 25% on two engines and copy 5%, with no platform total
- **WHEN** the sample is recorded
- **THEN** total GPU utilization is stored as 65 with a note that it was derived from engines

#### Scenario: Per-process GPU limited to scope and costed
- **GIVEN** a scoped run declaring `postgres` and a hang trigger
- **WHEN** per-process GPU data is collected
- **THEN** the stored entries contain only in-scope groups
- **AND** the collection time in milliseconds is recorded with the entry

#### Scenario: Absent GPU data is null
- **GIVEN** a machine exposing no GPU utilization data
- **WHEN** the run completes
- **THEN** GPU values are null on every sample and `collection.failures[]` names the reason

### Requirement: System handle count
The system SHALL record the system-wide handle count on the continuous tier.

#### Scenario: Handle count recorded
- **GIVEN** canned collector output with a total handle count of 98213
- **WHEN** the sample is recorded
- **THEN** it stores `handleCount` 98213 with unit `count`

## MODIFIED Requirements

### Requirement: Power and backing-store alibis
The system SHALL record the active power plan (friendly name and identifier) once per run, and on every continuous sample SHALL record the power-mode overlay, the energy-saver state, turbo-aware processor performance, and paging-file usage percentage, so that throttle and backing-store conditions are available as hang evidence.

#### Scenario: Power-mode overlay visible without a plan change
- **GIVEN** the power plan stays the same throughout a run while the user switches the power mode from balanced to best power efficiency
- **WHEN** the samples are recorded
- **THEN** the power-mode value changes on the samples after the switch
- **AND** the power plan name is recorded once for the run

#### Scenario: Throttle alibi present in hang context
- **GIVEN** a hang occurs while processor performance is limited on AC power
- **WHEN** the hang row is recorded
- **THEN** the samples around the hang carry performance %, performance-limit %, power mode, and AC state with their values
- **AND** ranking throttling as a cause is left to the diagnosis rules

#### Scenario: Backing-store state present on every sample
- **WHEN** any continuous sample is recorded
- **THEN** it carries paging-file usage percentage, or null with a reason in `collection.failures[]`

### Requirement: App/process rollups with friendly names
The system SHALL roll up in-scope processes and system-set members into stable friendly group names, recording per group working-set MB, private (committed) MB, instance count, CPU as % of machine, and disk read/write rates; footprint ranking SHALL use working set, and commit attribution SHALL use private bytes.

#### Scenario: Verdict uses Private not WS
- **GIVEN** an in-scope group with 2,000 MB working set and flat 150 MB private bytes, and another with 600 MB working set and 1,800 MB private bytes
- **WHEN** the rollup ranks groups
- **THEN** the footprint ranking places the 2,000 MB working-set group first
- **AND** the commit attribution places the 1,800 MB private-bytes group first

#### Scenario: Rollup carries CPU and I/O
- **WHEN** a rollup row is recorded for an in-scope group
- **THEN** it includes working-set MB, private MB, instance count, CPU as % of machine, and read and write bytes per second
