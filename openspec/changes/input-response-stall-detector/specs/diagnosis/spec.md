## MODIFIED Requirements

### Requirement: Hang confirmation sources
The system SHALL label every hang with its confirmation sources: `user-mark` (a hung mark within ±2 s), `os-not-responding` (an in-scope, non-suspended process reported not responding at that hang), `workload-probe` (a declared workload latency probe exceeding its timeout within ±2 s), or `input-stall` (an automatically detected input-response stall episode, whose foreground application is in scope or in the system set and which is not flagged as chronically slow, overlapping the hang's measured interval widened by ±2 s). A hang with none of these SHALL be labelled `probe-only`.

#### Scenario: User mark confirms a hang
- **GIVEN** a hang at 10:00:05.0 and a `hung` user mark at 10:00:06.5
- **WHEN** confirmations are computed
- **THEN** that hang lists `user-mark` among its confirmation sources

#### Scenario: Unconfirmed hang is probe-only
- **GIVEN** a hang with no user mark within ±2 s, no in-scope not-responding process, no workload probe timeout, and no input-stall episode overlapping it
- **WHEN** confirmations are computed
- **THEN** the hang is labelled `probe-only`
- **AND** the headline finding reports the count of probe-only hangs

#### Scenario: Input-stall episode confirms a hang
- **GIVEN** a hang whose measured interval is 10:00:05.0 to 10:00:06.2 and an input-stall episode in an in-scope foreground group from 10:00:04.6 to 10:00:06.0
- **WHEN** confirmations are computed
- **THEN** that hang lists `input-stall` among its confirmation sources

#### Scenario: Out-of-scope episode does not confirm
- **GIVEN** an overlapping episode whose foreground is `out-of-scope`
- **WHEN** confirmations are computed
- **THEN** the hang does not list `input-stall`
- **AND** the episode is counted in the agreement metrics under out-of-scope

#### Scenario: Chronically slow application does not confirm
- **GIVEN** an overlapping episode in a group flagged `chronic-slow-app`
- **WHEN** confirmations are computed
- **THEN** the hang does not list `input-stall`

#### Scenario: Several sources are all listed
- **GIVEN** a hang with a user mark within ±2 s and an overlapping eligible episode
- **WHEN** confirmations are computed
- **THEN** it lists both `user-mark` and `input-stall`

## ADDED Requirements

### Requirement: Episode corroboration is counted by source
The system SHALL report how many input-stall episodes were corroborated by each independent source: an overlapping spawn-probe hang (±2 s), Windows not-responding at that hang, a user mark, a workload probe timeout, and a helper late period. Each count SHALL carry its denominator, an episode MAY count under several sources, and episodes with no corroboration SHALL be counted. A helper late period is corroboration only, never a hang confirmation source.

#### Scenario: Corroboration counts with denominators
- **GIVEN** 5 episodes, of which 3 overlap a probe hang, 1 of those probe hangs is OS-confirmed, 1 episode has a user mark, and 1 episode overlaps nothing
- **WHEN** the diagnosis is computed
- **THEN** it reports probe hang 3/5, Windows not-responding 1/5, user mark 1/5, workload probe 0/5 and uncorroborated 1/5

#### Scenario: No episodes
- **GIVEN** a run with the detector running and no episodes
- **WHEN** the diagnosis is computed
- **THEN** every corroboration count is 0 of 0 and the output states that no input-response stall was observed
- **AND** it does not state that the machine did not freeze

#### Scenario: Detector unavailable
- **GIVEN** a run in which the detector was unavailable
- **WHEN** the diagnosis is computed
- **THEN** the corroboration section is `not evaluated` with the unavailability reason, and no count is emitted

### Requirement: Spawn probe agreement with felt stalls
The system SHALL cross-check the process-start hang definition against input-response stalls and report numerators, denominators and ratios, at a ±2 s join tolerance: precision (probe hangs overlapping an eligible episode ÷ probe hangs during evaluated time), recall (eligible episodes overlapping a probe hang ÷ eligible episodes), recall for episodes at least as long as the probe interval, and the unmatched probe hangs and episodes, each referencing its stored record.

#### Scenario: Precision and recall with n
- **GIVEN** 4 probe hangs during evaluated time, 5 eligible episodes, and 2 probe hangs that each overlap an episode (covering 3 episodes)
- **WHEN** agreement is computed
- **THEN** precision is 2/4 = 0.50 and recall is 3/5 = 0.60, each with numerator and denominator

#### Scenario: Probe hang with no felt stall
- **GIVEN** a probe hang at 10:05:00 during evaluated time with recent input and no episode within ±2 s
- **WHEN** agreement is computed
- **THEN** it is listed under probe hangs with no stall, and counts against precision

#### Scenario: Probe hang during idle time is excluded
- **GIVEN** a probe hang at a moment when no input occurred within the recent-input window
- **WHEN** agreement is computed
- **THEN** it is excluded from the precision denominator and counted under `idle`

#### Scenario: Episode shorter than the probe interval
- **GIVEN** an episode of 700 ms and a probe interval of 2 s with no probe hang near it
- **WHEN** agreement is computed
- **THEN** it counts against recall over all episodes
- **AND** is excluded from recall over episodes at least as long as the probe interval

#### Scenario: No episodes means recall not evaluated
- **GIVEN** a run with the detector running, 3 probe hangs and zero episodes
- **WHEN** agreement is computed
- **THEN** recall is `not evaluated` and precision is 0/3 with a note that the detector observed no stall in evaluated time

#### Scenario: Agreement references its inputs
- **WHEN** agreement is computed
- **THEN** every listed probe hang and episode carries a reference to its stored record

#### Scenario: Unavailable detector
- **GIVEN** a run in which the detector was unavailable
- **WHEN** agreement is computed
- **THEN** every agreement metric is `not evaluated` with the reason

### Requirement: Input-stall confirmation weight and episode confidence
The system SHALL record a weight per confirmation source for the confirmation-share component, and a hang confirmed only by `input-stall` SHALL carry a weight below that of a user mark. It SHALL derive each episode's confidence from recorded components (severity, sample count, corroboration, noisy-baseline penalty, guard penalty), record components and weights, never use a constant, and never exceed 0.95.

#### Scenario: Stronger episode has higher confidence
- **GIVEN** two episodes identical except that worst latency is 1500 ms in one and 300 ms in the other
- **WHEN** episode confidence is computed
- **THEN** the 1500 ms episode has strictly higher confidence
- **AND** both list their components and weights

#### Scenario: Guard flags lower confidence
- **GIVEN** two identical episodes, one overlapping a helper late period and one not
- **WHEN** confidence is computed
- **THEN** the overlapping one has strictly lower confidence

#### Scenario: Confidence never reaches certainty
- **GIVEN** an episode with every component at its maximum and corroborated by all sources
- **WHEN** confidence is computed
- **THEN** it is exactly 0.95 and never 1.0

#### Scenario: Input-stall-only confirmation is weighted below a user mark
- **GIVEN** two otherwise identical fixtures, one whose hangs are confirmed only by `input-stall` and one only by `user-mark`
- **WHEN** rule confidences are computed
- **THEN** the user-mark fixture reports a strictly higher confirmation-share component
- **AND** both record the per-source weights used

### Requirement: Detector blind spots are disclosed
The system SHALL record in the report what the input-response detector cannot see, including: waits inside an application whose interface keeps answering, freezes of the operating system's own input thread, stalls while the user provides no input, and the not-evaluable situations it declined to judge, with the evaluated and not-evaluable seconds. It SHALL state that the detector's threshold is provisional.

#### Scenario: Blind spots listed with evaluated time
- **WHEN** a report with the detector running is written
- **THEN** `inputStall.cannotSee` is a non-empty list including application waits with a responsive interface
- **AND** the report records evaluated seconds and not-evaluable seconds

### Requirement: Helper lateness at a hang
The system SHALL record, for each usable hang, whether a helper late period overlapped the hang's measured interval widened by ±2 s, as true, false or `not evaluated` (detector unavailable or the helper was not observing). It SHALL NOT use helper lateness as an input to any cause rule in this change.

#### Scenario: Late period overlaps a hang
- **GIVEN** a helper late period from 10:00:04.8 to 10:00:06.0 and a hang at 10:00:05.0
- **WHEN** the diagnosis is computed
- **THEN** that hang records `helperLate: true`

#### Scenario: Helper was not observing
- **GIVEN** a hang during an interval where the helper had exited
- **WHEN** the diagnosis is computed
- **THEN** that hang records `helperLate: not evaluated` with the reason
