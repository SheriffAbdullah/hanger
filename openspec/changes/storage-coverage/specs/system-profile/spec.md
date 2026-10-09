## MODIFIED Requirements

### Requirement: Storage facts
The profile SHALL record, for each physical disk, its model, media type (SSD, HDD or unspecified), bus type, capacity, and health status where readable at the current tier, together with its disk number so that per-drive series can be joined to it. It SHALL also record the system volume's free and total capacity.

#### Scenario: NVMe SSD recorded
- **GIVEN** canned output for one NVMe SSD of 512 GB reporting healthy
- **WHEN** the profile is parsed
- **THEN** `storage.disks.value[0]` has media type `SSD`, bus `NVMe`, capacity 512 GB and health `Healthy`
- **AND** `storage.systemVolume.value` has numeric `freeGB` and `totalGB`

#### Scenario: Health unreadable at user tier
- **GIVEN** an unelevated run where disk health is not readable
- **WHEN** the profile is parsed
- **THEN** the disk's health is null with a reason naming the tier, and its model, media type and capacity are still present

#### Scenario: Disk number recorded or its absence explained
- **GIVEN** canned output with a disk number for one disk and none for another
- **WHEN** the profile is parsed
- **THEN** the first disk has its number and the second has a null number with a reason

### Requirement: Virtual memory configuration facts
The profile SHALL record each pagefile's location, the drive it lives on, and current/maximum size, whether the pagefile is system-managed, and the commit limit, each with a unit.

#### Scenario: System-managed pagefile
- **GIVEN** canned output for a system-managed pagefile on the system drive
- **WHEN** the profile is parsed
- **THEN** `virtualMemory.systemManaged.value` is true, `virtualMemory.pagefiles.value` has one entry with a location and sizes in MB, and `virtualMemory.commitLimitGB.value` is a positive number

#### Scenario: Pagefile on a second drive
- **GIVEN** canned output for a pagefile at a path on drive D:
- **WHEN** the profile is parsed
- **THEN** the pagefile entry's drive is "D:"

#### Scenario: Pagefile location without a drive letter
- **GIVEN** canned output for a pagefile whose location has no drive letter
- **WHEN** the profile is parsed
- **THEN** the entry's drive is null with a reason

## ADDED Requirements

### Requirement: Drive placement of the pagefile and the workload
The report SHALL state, for each drive that has a recorded series, whether it hosts a pagefile (from the profile) and whether it hosts the monitored workload (only from drives the user declared in the scope file). Each answer SHALL be yes, no, or unknown with the reason. The tool SHALL NOT infer the workload drive from process activity.

#### Scenario: Pagefile on the slow drive, workload drive declared elsewhere
- **GIVEN** a profile with a pagefile on C: and a scope file declaring workload drive D:
- **WHEN** the placement for drives "0 C:" and "1 D:" is derived
- **THEN** C: hosts the pagefile (yes) and not the workload (no); D: hosts the workload (yes) and not the pagefile (no)

#### Scenario: Nothing declared
- **GIVEN** a profile without a pagefile record and a scope file without drives
- **WHEN** the placement is derived
- **THEN** both answers are unknown, with the reasons "pagefile not recorded" and "workload drive not declared"
