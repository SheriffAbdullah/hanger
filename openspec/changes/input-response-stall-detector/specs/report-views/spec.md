## MODIFIED Requirements

### Requirement: Finding summary on the first page
The finding section SHALL state, in at most three lines, the freeze count at or above the hang threshold over the observed duration, how many freezes were confirmed by Windows, by user marks and by the automatic input-response check, the leading cause's at-hang versus calm values with n on each side, the top in-scope grower, what was checked and not observed, and the confidence with evidence strength. All of these SHALL be taken from the diagnosis output.

#### Scenario: Finding reproduces diagnosis output for a hang fixture
- **GIVEN** a trace fixture whose diagnosis output reports 5 hangs, 2 user-confirmed, leading cause memory pressure with commit 91% at hang versus 62% calm (n=5/180)
- **WHEN** the report is rendered
- **THEN** the finding section has at most three lines and contains "5", "2", "91", "62", "n=5/180" and the leading-cause label exactly as named in the diagnosis vocabulary

#### Scenario: Zero-hang run does not name a cause
- **GIVEN** a trace fixture with zero hangs and commit between 52% and 65%
- **WHEN** the report is rendered
- **THEN** the finding states that no freeze at or above the threshold was observed in the observed duration
- **AND** it names no cause class and no memory label

#### Scenario: Input-response confirmations appear in the finding
- **GIVEN** a fixture with 5 hangs of which 3 are confirmed by `input-stall`
- **WHEN** the report is rendered
- **THEN** the finding section still has at most three lines and contains "3" beside the words "input-response check"

#### Scenario: Detector unavailable in the finding
- **GIVEN** a fixture whose detector status is `unavailable`
- **WHEN** the report is rendered
- **THEN** the finding says the input-response check was not available instead of showing 0

### Requirement: Hang, mark, and workload annotations on every chart
Every chart panel SHALL draw, on the shared time axis, the hang windows, user marks, OS-confirmed hang markers, input-stall episodes, workload phase spans and lifecycle markers, AC versus battery periods, and recorded unobserved intervals, each present when the report contains it.

#### Scenario: Every panel carries the same hang bands
- **GIVEN** a fixture with 3 hang windows, 2 user marks, one AC-to-battery transition and one unobserved interval
- **WHEN** the HTML report is rendered
- **THEN** every chart panel contains 3 hang-band elements at the same x-positions
- **AND** every panel contains 2 mark elements, an AC/battery band boundary, and one unobserved-interval shading

#### Scenario: Workload markers are labelled
- **GIVEN** a fixture with a workload phase "docker compose up" and a container start marker
- **WHEN** the report is rendered
- **THEN** every panel shows the phase span with the label "docker compose up" and the start marker at its recorded wall-clock time

#### Scenario: Input-stall episodes are drawn on every panel
- **GIVEN** a fixture with 3 hang windows and 2 input-stall episodes
- **WHEN** the HTML report is rendered
- **THEN** every chart panel contains 2 input-stall elements at the same x-positions, visually distinct from the hang bands
- **AND** the chart key names them as automatically detected input-response stalls

#### Scenario: Episode without a probe hang is still drawn
- **GIVEN** an episode that overlaps no probe hang
- **WHEN** the report is rendered
- **THEN** the episode is drawn and the hang bands are unchanged

#### Scenario: No detector, no overlay and a stated reason
- **GIVEN** a fixture whose detector status is `unavailable`
- **WHEN** the report is rendered
- **THEN** no input-stall element is drawn and the chart key states that the input-response check was not available

## ADDED Requirements

### Requirement: Input-response check in the evidence section
The evidence section of every shareable view SHALL include an input-response check subsection that states it is automatic and shows episodes, evaluated and not-evaluable time, corroboration counts, probe agreement, detector flags, helper lateness, helper cost and blind spots. Every figure SHALL come from the report JSON. An unavailable value SHALL read "not available" with its reason, never zero. The subsection SHALL appear as a placeholder when the detector was unavailable or off.

#### Scenario: Subsection present with agreement metrics
- **GIVEN** a fixture with 4 episodes, 3 probe hangs and agreement precision 2/3 and recall 3/4
- **WHEN** the Markdown and HTML reports are rendered
- **THEN** both contain the input-response check subsection stating it is automatic
- **AND** both show "2/3" and "3/4" labelled as probe precision and recall against felt stalls

#### Scenario: Placeholders when unavailable
- **GIVEN** a fixture whose detector status is `unavailable` for reason "helper blocked by policy"
- **WHEN** the report is rendered
- **THEN** the subsection shows "Input-response check: not available (helper blocked by policy)"
- **AND** shows no zero for any episode or agreement count

#### Scenario: Placeholder when disabled
- **GIVEN** a fixture whose detector status is `not-requested`
- **WHEN** the report is rendered
- **THEN** the subsection says the check was turned off by the user

#### Scenario: Recall not evaluated is shown as such
- **GIVEN** a fixture with the detector running, probe hangs and no episodes
- **WHEN** the report is rendered
- **THEN** recall is shown as "not evaluated" with the reason

#### Scenario: Older report shows a placeholder
- **GIVEN** a frozen v2 report that has no `inputStall`
- **WHEN** the report is rendered
- **THEN** the subsection shows "not available (report predates the input-response check)"

#### Scenario: Out-of-scope episodes stay anonymous
- **GIVEN** a scoped fixture with out-of-scope episodes
- **WHEN** the report is rendered
- **THEN** the views show only their count and total duration
- **AND** no out-of-scope application name appears
