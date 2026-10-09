## ADDED Requirements

### Requirement: Sync clients are a confound only within scope
File-sync clients (for example OneDrive, including a synced repository folder) are a known confound for disk findings. A disk rule SHALL name the client as a confound only when its process group is in the declared scope or the fixed system set and shows disk I/O near the hang. A client outside the declared scope SHALL appear only in the anonymous aggregate. The user documentation SHALL state this confound.

#### Scenario: In-scope sync client recorded as a confound
- **GIVEN** a firing disk stall where an in-scope sync client group shows 12 MB/s of I/O near the hang
- **WHEN** the result is read
- **THEN** its confounds include the sync client by name, marked active

#### Scenario: Out-of-scope sync client is not named
- **GIVEN** the same stall with the sync client outside the declared scope
- **WHEN** every artifact is scanned for the client's name
- **THEN** no artifact contains it and the privacy canary reports zero hits

#### Scenario: Scope file declares workload drives
- **GIVEN** a scope file with `"drives": ["D:"]`
- **WHEN** it is loaded
- **THEN** the declared drives are recorded in the report
- **AND** a drive entry that is not a letter and colon is rejected with a message naming it
