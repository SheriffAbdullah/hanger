## MODIFIED Requirements

### Requirement: Disk latency, queue, utilization, and throughput
The system SHALL record on the continuous tier disk transfer latency in milliseconds, current queue length, busy percentage, and read and write throughput in bytes per second, as the machine total and, where the platform exposes them, per physical drive (see "Per-drive disk signals").

#### Scenario: Latency stored in milliseconds
- **GIVEN** canned collector output reporting a transfer time of 0.0042 seconds, idle time 88%, and queue 0.3
- **WHEN** the sample is recorded
- **THEN** it stores `latencyMs` 4.2, `busyPct` 12, and `queue` 0.3, each with its unit

## ADDED Requirements

### Requirement: Per-drive disk signals
The system SHALL record, per physical drive and on the continuous tier, transfer latency in milliseconds, queue length, busy percentage, and read and write throughput in bytes per second, each as a provenance record. Each drive SHALL be identified by a non-sensitive label made of its disk number and volume letters. The system SHALL NOT store a drive serial number. When per-drive data is not exposed, the per-drive set SHALL be null with a reason and the machine total SHALL still be recorded.

#### Scenario: Two drives recorded beside the machine total
- **GIVEN** canned counter output with a system drive at 4 ms latency and a second drive at 60 ms latency, plus the machine total
- **WHEN** the sample is recorded
- **THEN** the sample holds two drive entries, each with latency, queue, busy percentage and throughput records with unit, window and source
- **AND** the labels read "Disk 0 (C:)" and "Disk 1 (D:)" and contain no serial number
- **AND** the machine-total values are unchanged

#### Scenario: Per-drive counters not exposed
- **GIVEN** canned counter output with only the machine total
- **WHEN** the sample is recorded
- **THEN** the per-drive set is null with a reason
- **AND** a collection failure for per-drive disk data is recorded once

#### Scenario: One counter missing for one drive
- **GIVEN** canned output where one drive has no queue reading
- **WHEN** the sample is recorded
- **THEN** that drive's queue is null and its other values are present

### Requirement: Volume free space
The system SHALL record on the continuous tier, per volume letter, free space as a percent of the volume and in megabytes, each as a provenance record, and SHALL record null with a reason when volume counters are not exposed.

#### Scenario: Free space stored per volume
- **GIVEN** canned counter output for volume C: with 7.5 percent free and 18000 MB free
- **WHEN** the sample is recorded
- **THEN** the C: entry stores free percent 7.5 and free MB 18000, each with its unit

#### Scenario: Volume counters missing
- **GIVEN** canned counter output with no volume counters
- **WHEN** the sample is recorded
- **THEN** the volume set is null with a reason and the failure is recorded once
