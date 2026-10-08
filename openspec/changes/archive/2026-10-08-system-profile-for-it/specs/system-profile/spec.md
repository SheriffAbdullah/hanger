## Purpose

Give an IT reader the static facts about the machine (hardware, firmware, OS, power, virtual memory, virtualization platform, security/management) needed to judge hang evidence. Every fact carries its source, collection tier and as-of time, or an explicit reason it is unavailable.

## ADDED Requirements

### Requirement: System profile collected once per run
The system SHALL collect a static system profile exactly once per `trace` or `record` run, before continuous sampling begins. The profile SHALL be stored in the report JSON under `systemProfile`, with its collection start time and total collection duration. The console run summary SHALL print a one-line digest of it.

#### Scenario: Profile present once in every trace report
- **GIVEN** a completed trace run
- **WHEN** the report JSON is parsed
- **THEN** it contains exactly one `systemProfile` object with `collectedAt` (ISO-8601) and `collectionMs` (number)
- **AND** `collectedAt` is earlier than the first sample's measurement time

#### Scenario: Console digest printed
- **WHEN** a trace run finishes
- **THEN** the console output contains one line starting with `[profile]` that names the model, processor, installed memory and OS build

### Requirement: Every fact has a value or an unavailable reason
Every leaf fact in the system profile SHALL be a record with `value`, `source`, `tier` and `asOf`. When the value cannot be obtained, `value` SHALL be null and `unavailableReason` SHALL state why. A fact SHALL NOT be an empty string, and SHALL NOT be zero to stand in for unknown.

#### Scenario: Failed source yields null with reason
- **GIVEN** canned collector output in which the firmware block is empty
- **WHEN** the profile parser processes it
- **THEN** `firmware.biosVersion.value` is null
- **AND** `firmware.biosVersion.unavailableReason` is a non-empty string
- **AND** no fact anywhere in the profile has an empty-string value

#### Scenario: Unknown is never zero
- **GIVEN** canned output that omits memory-module speed
- **WHEN** the profile is parsed
- **THEN** the module's speed is null with a reason, never `0`

#### Scenario: Every leaf carries provenance
- **WHEN** an automated test walks every leaf record of a parsed fixture profile
- **THEN** each leaf has non-empty `source`, `tier` in {`user`, `admin`, `user-input`}, and an ISO-8601 `asOf`

### Requirement: Processor facts
The profile SHALL record the processor model, physical core count, logical processor count, base clock and maximum clock. Each SHALL have a unit. Physical cores and logical processors SHALL be separate facts, and neither SHALL ever be labelled as the other.

#### Scenario: Cores and threads labelled correctly
- **GIVEN** canned output for a processor with 10 physical cores and 12 logical processors
- **WHEN** the profile is parsed and the console digest is printed
- **THEN** `processor.physicalCores.value` is 10 and `processor.logicalProcessors.value` is 12
- **AND** no output line contains the text "12 cores"

### Requirement: Memory facts
The profile SHALL record installed memory, module count, each module's size and speed, slots used and total slots, and the module form factor or a soldered indication when the platform exposes it.

#### Scenario: Two-module laptop
- **GIVEN** canned output describing two 8 GB modules at 3200 MT/s in a 2-slot array
- **WHEN** the profile is parsed
- **THEN** `memory.installedGB.value` is 16, `memory.modules.value` has 2 entries each with size 8 and speed 3200, `memory.slotsUsed.value` is 2 and `memory.slotsTotal.value` is 2

#### Scenario: Slot count not exposed
- **GIVEN** canned output with no memory-array information
- **WHEN** the profile is parsed
- **THEN** `memory.slotsTotal.value` is null with an unavailable reason, and the module list is still recorded

### Requirement: Storage facts
The profile SHALL record, for each physical disk, its model, media type (SSD, HDD or unspecified), bus type, capacity, and health status where readable at the current tier. It SHALL also record the system volume's free and total capacity.

#### Scenario: NVMe SSD recorded
- **GIVEN** canned output for one NVMe SSD of 512 GB reporting healthy
- **WHEN** the profile is parsed
- **THEN** `storage.disks.value[0]` has media type `SSD`, bus `NVMe`, capacity 512 GB and health `Healthy`
- **AND** `storage.systemVolume.value` has numeric `freeGB` and `totalGB`

#### Scenario: Health unreadable at user tier
- **GIVEN** an unelevated run where disk health is not readable
- **WHEN** the profile is parsed
- **THEN** the disk's health is null with a reason naming the tier, and its model, media type and capacity are still present

### Requirement: Graphics facts
The profile SHALL record each display adapter's name, dedicated memory, driver version and driver date. A dedicated-memory value known to be a lower bound SHALL be marked as such.

#### Scenario: Integrated adapter recorded
- **GIVEN** canned output for one integrated adapter with driver version and date
- **WHEN** the profile is parsed
- **THEN** `graphics.adapters.value[0]` has non-empty name, driver version and an ISO date

#### Scenario: Capped memory flagged
- **GIVEN** canned output reporting adapter memory at the 4 GB reporting ceiling
- **WHEN** the profile is parsed
- **THEN** the adapter's dedicated memory carries a `lowerBound: true` marker

### Requirement: Firmware and OS facts
The profile SHALL record manufacturer, model, serial (from the firmware source), firmware vendor, version and date, OS edition, version and build, last boot time, uptime, and virtualization-based security and memory-integrity state. The serial SHALL be shown even when anonymized. The hostname SHALL be replaced under anonymization.

#### Scenario: Serial read from firmware
- **GIVEN** canned output where the system-information source has no serial but the firmware source has serial `5CD1234XYZ`
- **WHEN** the profile is parsed without a user-supplied serial
- **THEN** `identity.serial.value` is `5CD1234XYZ` with a firmware source

#### Scenario: User override recorded as user input
- **WHEN** the run is started with a user-supplied serial
- **THEN** `identity.serial.source` is `user-input`

#### Scenario: Anonymized run keeps serial, hides hostname
- **GIVEN** a run with anonymization enabled
- **WHEN** the report JSON is written
- **THEN** `identity.hostname.value` is `<host>` and `identity.serial.value` is the real serial

### Requirement: Power and battery facts
The profile SHALL record the active power plan's friendly name and the power-mode setting. On a machine with a battery, it SHALL record design capacity, full-charge capacity and the derived health percentage, or null with a reason when they are not readable. The plan SHALL never appear as only an identifier.

#### Scenario: Plan name not a bare identifier
- **GIVEN** canned output `Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)`
- **WHEN** the profile is parsed
- **THEN** `power.planName.value` is `Balanced`

#### Scenario: Battery health at user tier
- **GIVEN** canned output with design capacity 45000 mWh and full-charge capacity 40500 mWh
- **WHEN** the profile is parsed
- **THEN** `power.batteryHealthPct.value` is 90

#### Scenario: No battery
- **GIVEN** canned output for a machine reporting no battery
- **WHEN** the profile is parsed
- **THEN** the battery facts are null with reason "no battery present", never zero

### Requirement: Virtual memory configuration facts
The profile SHALL record each pagefile's location and current/maximum size, whether the pagefile is system-managed, and the commit limit, each with a unit.

#### Scenario: System-managed pagefile
- **GIVEN** canned output for a system-managed pagefile on the system drive
- **WHEN** the profile is parsed
- **THEN** `virtualMemory.systemManaged.value` is true, `virtualMemory.pagefiles.value` has one entry with a location and sizes in MB, and `virtualMemory.commitLimitGB.value` is a positive number

### Requirement: Virtualization platform facts
The profile SHALL record whether WSL is installed and its version, the virtual-machine platform state, and the installed container-platform version and its configured memory and CPU allocation. Values SHALL be read without starting containers or workloads. The workload's configured VM memory cap SHALL be referenced, not re-collected.

#### Scenario: WSL present, Docker absent
- **GIVEN** canned output with WSL version text and no container platform installed
- **WHEN** the profile is parsed
- **THEN** `virtualization.wslVersion.value` is the parsed version string
- **AND** `virtualization.dockerDesktopVersion.value` is null with reason "not installed"

#### Scenario: No workload started by profiling
- **WHEN** an automated test runs the profile collector with a recording shell stub
- **THEN** no recorded command starts, runs or queries a container or WSL distribution workload

### Requirement: Security and management facts
The profile SHALL record the names and reported state of security products registered with the OS, and the machine's domain-join and device-management enrollment state. It SHALL NOT list any other installed or running software.

#### Scenario: Registered security product named
- **GIVEN** canned output listing one registered antivirus product with an enabled state
- **WHEN** the profile is parsed
- **THEN** `security.products.value` contains that product name and its state

#### Scenario: No other software listed
- **WHEN** an automated test inspects the parsed profile of a fixture whose canned output also contains unrelated application names
- **THEN** none of those application names appears anywhere in `systemProfile`

### Requirement: Profile collection stays within the user tier by default
The system SHALL attempt only user-tier facts on an unelevated run. It SHALL record admin-only facts as null with reason "requires elevation" and `tier: admin`. On an elevated run it SHALL attempt admin-tier facts too and label each fact with the tier that produced it.

#### Scenario: Unelevated run labels admin facts
- **GIVEN** an unelevated run
- **WHEN** the profile is written
- **THEN** `systemProfile.tier` is `user`
- **AND** every admin-only fact has null value, `tier` `admin` and reason "requires elevation"

#### Scenario: Elevated run fills admin facts
- **GIVEN** an elevated run where an admin-only fact is readable
- **WHEN** the profile is written
- **THEN** that fact has a value and `tier` `admin`

### Requirement: Profile collection has a bounded cost
The system SHALL bound profile collection with a timeout per fact group and an overall timeout. A group that times out SHALL be recorded as null with reason `timeout after <N> ms`, while the other groups are kept. The total collection time SHALL be recorded.

#### Scenario: Slow group times out alone
- **GIVEN** a collector stub where the storage group exceeds its timeout and all others answer
- **WHEN** the profile is collected
- **THEN** storage facts are null with a reason starting `timeout after`
- **AND** processor, memory and firmware facts have values
- **AND** `systemProfile.collectionMs` is recorded

#### Scenario: Live cost recorded
- **WHEN** an unelevated trace runs on Windows
- **THEN** `systemProfile.collectionMs` is a positive number and the run's report still parses
