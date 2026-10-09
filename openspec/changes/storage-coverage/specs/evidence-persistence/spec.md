## ADDED Requirements

### Requirement: Storage fields are additive under the frozen schema
The per-drive series, the volume series, the declared workload drives, the pagefile drive and the disk number SHALL be added as optional fields only. The report SHALL stay at schema `hanger-json/2` with status `frozen`, and the schema changelog SHALL carry a dated section listing the added fields. Validators and readers SHALL accept a report without these fields and SHALL ignore these fields when they do not understand them.

#### Scenario: Older report still reads
- **GIVEN** a report written before this change, with no per-drive, volume or storage fields
- **WHEN** it is rendered, diagnosed again, packed and trended
- **THEN** every step succeeds and the storage block shows its "not available" placeholder with a reason

#### Scenario: Changelog lists the fields
- **WHEN** the schema changelog is read
- **THEN** it has a dated 2.x section naming the per-drive, volume, storage, pagefile-drive, disk-number and declared-drive fields
- **AND** the schema value is still `hanger-json/2` and no field is renamed or removed

#### Scenario: Validator tolerates the new fields
- **GIVEN** a report that carries the new fields
- **WHEN** the report validator runs
- **THEN** it reports no unknown-field error for them
