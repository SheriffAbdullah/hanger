# report-views Specification

## Purpose
Defines how a trace or pack report is presented to its reader, an IT engineer: the section order, the first-page finding, the charts, the formatting, and the files written. Every view renders only what the report JSON holds.

## Requirements

### Requirement: Shareable report section order
Every shareable view (Markdown and HTML, trace and pack) SHALL present these sections in this order: (1) header with asset identity, date, observed duration, collection tier and the scope declaration; (2) finding; (3) what IT can do; (4) evidence, meaning the hang table with at-hang versus calm values per rule, then charts; (5) system profile; (6) gaps and receipts; (7) appendix.

#### Scenario: Section headings appear in the fixed order in both formats
- **GIVEN** the scoped trace fixture with at least one hang
- **WHEN** the Markdown and the HTML report are rendered from it
- **THEN** the top-level section headings appear in the order header, finding, what IT can do, evidence, system profile, gaps and receipts, appendix in both outputs
- **AND** no per-process table appears before the finding section

#### Scenario: Header carries scope and run identity on page one
- **WHEN** any trace fixture is rendered to HTML
- **THEN** the header section contains the asset model and serial (or their unavailable reasons), the run date, the observed duration, the collection tier, and the scope declaration rendered per the `scope` capability's "Scope declaration leads every shareable view"

#### Scenario: Appendix holds the detail and the provenance of the file
- **WHEN** any trace fixture is rendered
- **THEN** the appendix contains the full in-scope culprit table, OS event records split into "during this run" and "history before this run", the method notes, and the JSON file name with its sha256

### Requirement: Finding summary on the first page
The finding section SHALL state, in at most three lines, the freeze count at or above the hang threshold over the observed duration, how many freezes were confirmed by Windows and by user marks, the leading cause's at-hang versus calm values with n on each side, the top in-scope grower, what was checked and not observed, and the confidence with evidence strength. All of these SHALL be taken from the diagnosis output.

#### Scenario: Finding reproduces diagnosis output for a hang fixture
- **GIVEN** a trace fixture whose diagnosis output reports 5 hangs, 2 user-confirmed, leading cause memory pressure with commit 91% at hang versus 62% calm (n=5/180)
- **WHEN** the report is rendered
- **THEN** the finding section has at most three lines and contains "5", "2", "91", "62", "n=5/180" and the leading-cause label exactly as named in the diagnosis vocabulary

#### Scenario: Zero-hang run does not name a cause
- **GIVEN** a trace fixture with zero hangs and commit between 52% and 65%
- **WHEN** the report is rendered
- **THEN** the finding states that no freeze at or above the threshold was observed in the observed duration
- **AND** it names no cause class and no memory label

### Requirement: System profile section
Every shareable view SHALL include a system profile section listing every fact in the report's system profile. Each fact SHALL appear with its value and unit, or with the text "not available" and its recorded reason. A fact SHALL never be blank or omitted.

#### Scenario: Unavailable facts are listed with reasons
- **GIVEN** a fixture whose system profile has the BIOS version present and the battery design capacity null with reason "requires admin"
- **WHEN** the report is rendered to Markdown and HTML
- **THEN** both outputs show the BIOS version value
- **AND** both show "Battery design capacity: not available (requires admin)"
- **AND** the number of fact rows equals the number of facts in the JSON system profile

### Requirement: Collection gaps in plain language
The gaps section SHALL describe every recorded collection failure, skipped tier and unobserved interval as a plain-language sentence naming the signal and the reason. Raw command output, shell error text and exit codes SHALL NOT appear in any shareable view.

#### Scenario: Missing container runtime is stated plainly
- **GIVEN** a fixture whose recorded failure for the container runtime has the reason "not installed"
- **WHEN** the report is rendered
- **THEN** the gaps section contains "Docker: not installed"
- **AND** neither output contains the text "is not recognized as an internal or external command"

#### Scenario: Every failure appears exactly once
- **WHEN** a fixture with N recorded collection failures is rendered
- **THEN** the gaps section contains N gap sentences, each naming its signal

### Requirement: Signal charts on one wall-clock axis
The HTML report SHALL contain small-multiple charts sharing one wall-clock time axis for these panels: freeze strip, memory, CPU, clock/thermal/power, disk, and top in-scope processes over time. A GPU panel SHALL be added only when GPU data exists or a GPU rule fired. Percent axes SHALL be fixed at 0-100. Every axis title SHALL carry its unit and every caption its sample count n.

#### Scenario: Required panels share one time domain
- **GIVEN** the full-signal trace fixture
- **WHEN** the HTML report is rendered
- **THEN** it contains chart panels titled freeze strip, memory, CPU, clock/thermal/power, disk and top in-scope processes
- **AND** every panel's x-domain start and end equal the run's first and last wall-clock sample times

#### Scenario: Percent axes are honest and labelled
- **WHEN** the full-signal fixture is rendered
- **THEN** every axis whose unit is percent spans 0 to 100
- **AND** every axis title includes a unit
- **AND** every chart caption includes "n="

#### Scenario: Missing signal renders a reasoned placeholder
- **GIVEN** a fixture where temperature is null with reason "not exposed at user tier"
- **WHEN** the report is rendered
- **THEN** the clock/thermal/power panel shows "Temperature: not available (not exposed at user tier)" in place of a temperature series

#### Scenario: GPU panel is conditional
- **GIVEN** one fixture with no GPU data and no GPU rule fired, and another with GPU utilization series present
- **WHEN** both are rendered
- **THEN** only the second contains a GPU panel

#### Scenario: Out-of-scope load appears only as an aggregate band
- **GIVEN** a scoped fixture with out-of-scope aggregate memory recorded
- **WHEN** the top-processes panel is rendered
- **THEN** it shows at most five in-scope groups plus one band labelled as load outside the declared scope
- **AND** no out-of-scope process name appears in the HTML

### Requirement: Hang, mark, and workload annotations on every chart
Every chart panel SHALL draw, on the shared time axis, the hang windows, user marks, OS-confirmed hang markers, workload phase spans and lifecycle markers, AC versus battery periods, and recorded unobserved intervals, each present when the report contains it.

#### Scenario: Every panel carries the same hang bands
- **GIVEN** a fixture with 3 hang windows, 2 user marks, one AC-to-battery transition and one unobserved interval
- **WHEN** the HTML report is rendered
- **THEN** every chart panel contains 3 hang-band elements at the same x-positions
- **AND** every panel contains 2 mark elements, an AC/battery band boundary, and one unobserved-interval shading

#### Scenario: Workload markers are labelled
- **GIVEN** a fixture with a workload phase "docker compose up" and a container start marker
- **WHEN** the report is rendered
- **THEN** every panel shows the phase span with the label "docker compose up" and the start marker at its recorded wall-clock time

### Requirement: Charts render offline and in print
The HTML report SHALL be self-contained, with no reference to any network resource. It SHALL render its charts without script execution. Its print styles SHALL NOT hide any chart, so a printed or PDF copy contains every chart.

#### Scenario: No external references
- **WHEN** any fixture is rendered to HTML
- **THEN** the output contains no `http://` or `https://` URL in any `src`, `href`, `@import` or `url(` reference

#### Scenario: Charts survive print
- **WHEN** the HTML report's print style rules are evaluated
- **THEN** no rule applying under print media sets a chart element or any of its ancestors to hidden or not displayed

#### Scenario: Charts display without scripts
- **WHEN** the HTML report is parsed with script execution disabled
- **THEN** each chart panel already contains its drawn series in the markup

### Requirement: Display precision and units
Every number displayed in a shareable view SHALL carry its unit and be rounded to its recorded measurement precision, or else to the display default for its unit. A null value SHALL be displayed as "not available" with its reason, never as zero or blank.

#### Scenario: No over-precise numbers
- **GIVEN** a fixture containing commit 64.7166289074152% and pages/sec 18176.0803
- **WHEN** the Markdown and HTML reports are rendered
- **THEN** no number in either output has more than two decimal places
- **AND** commit is displayed as "64.7%"

#### Scenario: Null is never shown as zero
- **GIVEN** a fixture where disk latency is null with reason "counter missing"
- **WHEN** the report is rendered
- **THEN** disk latency is shown as "not available (counter missing)"

### Requirement: IT views exclude developer-only diagnostics
Shareable views SHALL NOT show event-loop lag, terminal-product or tool-specific "seen" rows, the tool's internal confound notes, or internal filter fingerprints. These values SHALL remain in the JSON. Any flag shown in more than one view SHALL be read from the same JSON field in each.

#### Scenario: Developer rows absent from views but present in JSON
- **GIVEN** a fixture containing loop-lag statistics and Warp/openspec seen values
- **WHEN** the Markdown and HTML reports are rendered
- **THEN** neither output contains "loop lag", "Warp" or "openspec"
- **AND** the fixture JSON still contains those fields unchanged

### Requirement: Output formats
A completed trace SHALL write exactly these files by default: the JSON report, the Markdown report, the self-contained HTML report with inline charts, and the email draft. The legacy HTML file and the separate charts file SHALL NOT be written. The former charts option SHALL act as an alias of the report option and print a deprecation notice.

#### Scenario: Default trace writes the four formats
- **WHEN** a trace completes with default options
- **THEN** the output directory gains exactly one `.json`, one `.md`, one `.report.html` and one `.email.txt` for that run stamp
- **AND** no `.html` file without the `.report` infix and no `.charts.html` file exists for that stamp

#### Scenario: Deprecated charts option still works
- **WHEN** a trace is run with the former charts option
- **THEN** the `.report.html` is written
- **AND** the console prints a deprecation notice naming the replacement option

#### Scenario: Pack renders with the same section order
- **WHEN** a pack JSON is rendered
- **THEN** its HTML uses the same section order as a trace report
- **AND** any section the pack lacks shows a line naming the trace file that holds it instead of being omitted
