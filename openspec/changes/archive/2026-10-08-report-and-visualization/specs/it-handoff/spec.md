## Purpose

Gives the user a ready-to-send message for IT that summarizes one run's evidence, generated only from the report JSON, honest about scope and gaps, and listing the attachments with hashes so IT can check what they received.

## ADDED Requirements

### Requirement: Ready-to-send email draft
Every completed trace SHALL write a plain-text email draft and SHALL include the same text as a copy block in the HTML report. The draft SHALL contain:
- a subject naming the machine model, serial and freeze count over the observed duration;
- the freeze summary with confirmations;
- the finding;
- the scope;
- the gaps;
- a machine summary;
- the suggested actions, cheapest first;
- the attachment list.

The tool SHALL NOT send, upload or transmit the draft.

#### Scenario: Draft written and embedded for every trace
- **WHEN** a trace fixture is rendered
- **THEN** a `.email.txt` file is written whose first line starts with "Subject: Freeze evidence - "
- **AND** the subject contains the model, the serial (or "serial unavailable") and "<N> freezes in <T> min" with N and T from the JSON
- **AND** the HTML report contains a copy block whose text equals the file content

#### Scenario: Zero-hang run still produces an honest draft
- **GIVEN** a fixture with zero hangs
- **WHEN** the draft is rendered
- **THEN** the subject states "0 freezes in <T> min"
- **AND** the body states that no freeze was observed and names no cause

#### Scenario: Nothing is transmitted
- **WHEN** a trace with report generation runs to completion with network access blocked
- **THEN** the run completes without error
- **AND** no network connection is attempted by the rendering step

### Requirement: Email content traces to report JSON
Every number and every identity string in the email draft SHALL equal a value in the report JSON (at display precision), or a count derivable from it. If the draft would contain any other number, rendering SHALL fail with an error naming that number.

#### Scenario: All numeric tokens match JSON values
- **GIVEN** each trace fixture
- **WHEN** the email draft is rendered and its numeric tokens (excluding dates and the run stamp) are extracted
- **THEN** every token equals a JSON numeric value formatted at its display precision or a count present in the JSON

#### Scenario: Unbacked number fails the render
- **GIVEN** a template binding that refers to a JSON path absent from the fixture
- **WHEN** the draft is rendered
- **THEN** the placeholder is rendered as "not available" and no number is invented
- **AND** a test-injected literal number not present in the JSON causes the render to fail with an error naming it

### Requirement: Email states scope and gaps
The email draft SHALL summarize the declared scope as recorded in the scope declaration, including the open-scope warning when no scope was declared. It SHALL list the signals that could not be measured at the run's collection tier and the reason for each.

#### Scenario: Open-scope run warns the reader
- **GIVEN** a fixture whose scope declaration mode is open
- **WHEN** the draft is rendered
- **THEN** it contains "OPEN SCOPE: names of all running software may appear in the attached report."

#### Scenario: Scoped run summarizes scope without naming excluded software
- **GIVEN** a scoped fixture with in-scope entries postgres and docker and an out-of-scope aggregate of 41 groups
- **WHEN** the draft is rendered
- **THEN** it names postgres and docker as monitored and states "41" groups not monitored
- **AND** it contains no out-of-scope process name

#### Scenario: Admin-only gaps are listed
- **GIVEN** a user-tier fixture with temperature unavailable for reason "requires admin"
- **WHEN** the draft is rendered
- **THEN** the "Not measurable without admin" line names temperature

### Requirement: Attachment manifest with hashes
The email draft and the HTML report appendix SHALL list each shareable attachment (the JSON report and the HTML report) by file name with the sha256 of the bytes written to disk. The software inventory artifact SHALL never be listed or attached.

#### Scenario: Hashes match files on disk
- **WHEN** a trace is rendered and the sha256 of the written `.json` and `.report.html` files is computed independently
- **THEN** the email draft lists both file names with hashes whose stated prefix matches the computed digests

#### Scenario: Inventory never listed
- **GIVEN** an inventory artifact exists in the local output directory
- **WHEN** a trace draft is rendered
- **THEN** neither the draft nor the HTML report mentions the inventory artifact's file name
