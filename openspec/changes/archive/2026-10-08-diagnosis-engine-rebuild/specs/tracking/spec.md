## MODIFIED Requirements

### Requirement: OS-confirm via Responding poll
The system SHALL check, at each suspected hang, whether the OS reports any in-scope process as not responding, excluding suspended and background-only applications. It SHALL record the result, the poll time, and the matching in-scope process groups on that hang row. Results polled at another time SHALL NOT be copied onto the row.

#### Scenario: OS confirms hang
- **GIVEN** a spawn stall flags a suspected hang while an in-scope foreground process is reported not responding
- **WHEN** the not-responding check runs within 2 s of the hang
- **THEN** the HANG row is marked OS-confirmed with the poll time and the in-scope group name

#### Scenario: OS denies hang
- **GIVEN** a suspected hang is flagged
- **WHEN** the check finds every in-scope process responding
- **THEN** the row is marked unconfirmed with the poll result and poll time retained

#### Scenario: Suspended apps never confirm
- **GIVEN** the only processes reported not responding are suspended store apps (e.g. a notes app and a settings app)
- **WHEN** the check runs at a hang
- **THEN** the row is marked unconfirmed and neither app name is recorded

#### Scenario: Deferred poll is not back-filled
- **GIVEN** the check could not run at a hang because collection was over budget
- **WHEN** an end-of-run poll later succeeds
- **THEN** the hang row records `not-evaluated` with the reason, and the end-of-run result is not attached to it

### Requirement: User ground-truth marks
The system SHALL accept user ground-truth marks with a kind (`hung` or `fine`), the wall-clock time of the key press, and an optional note. It SHALL join each mark to the nearest probe within ±2 s and show it beside the matching hang or calm row.

#### Scenario: User marks a hang
- **WHEN** the user records a `hung` mark with a note at 10:00:06.5 and a hang probe exists at 10:00:05.0
- **THEN** the report joins the mark to that hang row and shows the note beside it

#### Scenario: User marks calm
- **WHEN** the user records a `fine` mark at a time whose nearest probe within ±2 s is calm
- **THEN** the report joins the mark to that calm probe as a calm anchor

#### Scenario: Mark with no probe nearby
- **GIVEN** a `hung` mark with no probe within ±2 s
- **WHEN** marks are joined
- **THEN** the mark is listed as `unmatched` with the gap to the nearest probe, and it counts against proxy recall
