## ADDED Requirements

### Requirement: On-hang process snapshot within declared scope
The system SHALL attach to each hang row a snapshot of the top in-scope and system-set process groups (memory, instance count, label), ranked within scope rather than taken from the overall top list and then filtered. It SHALL also attach the out-of-scope aggregate for the same moment. When the snapshot is skipped or degraded, the row SHALL record the reason.

#### Scenario: In-scope offender ranked below outsiders is kept
- **GIVEN** scope `postgres`, and at a hang the three largest groups are out of scope while `postgres` is fifth largest
- **WHEN** the hang row is written
- **THEN** `culpritsAtHang` contains the `postgres` group
- **AND** contains no out-of-scope group

#### Scenario: Skipped snapshot carries a reason
- **GIVEN** the snapshot at a hang is skipped because of the collection budget
- **WHEN** the hang row is written
- **THEN** `culpritsAtHang` is null and `snapshotSkippedReason` is a non-empty string

## REMOVED Requirements

### Requirement: Handles, threads, and tree snapshots (vNext — provisional: on-HANG tasklist + Private top groups ship now)
**Reason**: The requirement contradicts itself: its heading defers the process tree, while its scenario requires it. It also takes the on-hang snapshot from all processes, which violates declared scope.
**Migration**: The on-hang snapshot is specified by "On-hang process snapshot within declared scope". Per-process handles, threads, and the full process tree are deferred (IMPLEMENTATION-PLAN DEF-1). Docker state at a hang is specified by `workload-session-and-containers`.
