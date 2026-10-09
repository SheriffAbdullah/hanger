## MODIFIED Requirements

### Requirement: Disk stall rule
The disk-stall rule SHALL fire at a hang when disk latency exceeds 25 ms and queue length is at least 1, sustained on at least 3 usable probes within ±10 s of the hang. Where per-drive data exists, the rule SHALL also fire when a single drive meets the same condition although the machine total does not, SHALL name the slowest qualifying drive by its label, and SHALL state whether that drive hosts the pagefile and whether it hosts the declared workload, each as yes, no, or unknown with the reason. The disprover SHALL require every drive with readings, as well as the machine total, to be below its limits.

#### Scenario: Sustained disk stall
- **GIVEN** probes within ±10 s of a hang showing latency 41, 38, and 55 ms with queue length 2, 1, and 3
- **WHEN** the rule is evaluated
- **THEN** it fires with n=3 and references to the three probes

#### Scenario: Single slow probe does not fire
- **GIVEN** only one probe within ±10 s of a hang exceeding 25 ms
- **WHEN** the rule is evaluated
- **THEN** it does not fire

#### Scenario: One slow drive hidden by the machine total
- **GIVEN** a hang with two drives where the machine total stays under 25 ms and the second drive shows 70, 64 and 81 ms with queue 3, 2 and 4 within ±10 s
- **WHEN** the rule is evaluated
- **THEN** it fires with n=3, names the second drive by label, and references the per-drive probe values

#### Scenario: Slow drive hosts the pagefile
- **GIVEN** a firing result for a drive and a system profile whose pagefile lives on that drive's volume
- **WHEN** the result is read
- **THEN** it states that the slow drive hosts the pagefile
- **AND** when the workload drive was not declared it states "workload drive not declared" rather than yes or no

#### Scenario: Per-drive data absent
- **GIVEN** probes with only the machine total
- **WHEN** the rule is evaluated
- **THEN** it behaves as before and the drive fields read "per-drive data not recorded"

## ADDED Requirements

### Requirement: Disk nearly full rule
The disk-nearly-full rule SHALL be a drop-in rule of class disk, judged at hangs against calm per the cause rule contract. It SHALL fire when a relevant volume (system, pagefile, or declared workload drive) is below a provisional, configurable low-free-space limit on at least 3 usable probes within ±10 s of a hang, or below a higher warning limit while free space is falling. It SHALL emit `fired: null` with a reason when no relevant volume has a reading.

#### Scenario: Nearly full volume fires
- **GIVEN** the system volume at 6, 6 and 5 percent free on probes within ±10 s of a hang
- **WHEN** the rule is evaluated
- **THEN** it fires with n=3, references to the three probes, the free percent and megabytes in its extra, and a derived confidence not above 0.95

#### Scenario: Healthy volume does not fire
- **GIVEN** the system volume at 48 percent free on every probe
- **WHEN** the rule is evaluated
- **THEN** it does not fire and its reason states the observed free percent and the limit

#### Scenario: Falling free space widens the limit
- **GIVEN** a relevant volume at 13 percent free, falling from 31000 MB to 29500 MB across the run
- **WHEN** the rule is evaluated
- **THEN** it fires and its extra records the first and last free megabytes
- **AND** the same volume at 13 percent with flat free space does not fire

#### Scenario: Disproved by free space at most hangs
- **GIVEN** three hangs where free space is 40 percent at two of them
- **WHEN** the disprover is evaluated
- **THEN** its result is disproved with those values and the rule is excluded from the ranking

#### Scenario: Missing volume counters are not a negative
- **GIVEN** a report whose volume series is null with reason counter-missing
- **WHEN** the rule is evaluated
- **THEN** its result has `fired: null` and a reason naming the free-space signal

#### Scenario: Limits are configurable and recorded
- **GIVEN** a configuration that sets the low-free-space limit to 15
- **WHEN** a trace report is written
- **THEN** the recorded rule parameters show 15 with origin config
- **AND** the default run shows 10 with origin default and a provisional source

### Requirement: Disk culprit naming stays within scope
A firing disk rule SHALL name the process group that drove the I/O only when that group is in the declared scope or the fixed system set and holds at least half of the observed disk I/O at a provisional minimum rate. When the anonymous out-of-scope aggregate leads, the rule SHALL report only its rate and group count. When no per-process I/O was recorded, the result SHALL say so.

#### Scenario: In-scope process named
- **GIVEN** a firing disk stall where an in-scope database group reads and writes 90 MB/s and the out-of-scope aggregate 4 MB/s
- **WHEN** the result is read
- **THEN** it names the database group with its rate and share

#### Scenario: Out-of-scope culprit stays anonymous
- **GIVEN** a firing disk stall where the out-of-scope aggregate carries 120 MB/s across 31 groups and every in-scope group is under 2 MB/s
- **WHEN** the result is read and every artifact is scanned for the out-of-scope process names
- **THEN** it reports the aggregate rate and "31 groups" and names no process
- **AND** the privacy canary reports zero hits

#### Scenario: No per-process data
- **GIVEN** probes without per-process I/O
- **WHEN** the result is read
- **THEN** the culprit reads "per-process disk I/O not recorded"
