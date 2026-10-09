## ADDED Requirements

### Requirement: Email states storage findings
The email draft SHALL contain one storage line stating the slowest drive by label, its class, and whether it hosts the pagefile, and the lowest free space of a relevant volume, each traceable to the report JSON. When the data is not recorded the line SHALL read "Storage: not available (<reason>)". The line SHALL name no out-of-scope process.

#### Scenario: Storage line backed by JSON
- **GIVEN** a fixture with a slow drive hosting the pagefile and a volume at 6 percent free
- **WHEN** the draft is rendered
- **THEN** it contains a line starting "Storage:" naming the drive label and the pagefile placement
- **AND** every number in the line equals a JSON value at display precision

#### Scenario: No storage data
- **GIVEN** a fixture without per-drive or volume data
- **WHEN** the draft is rendered
- **THEN** the line reads "Storage: not available" followed by a reason and invents no number
