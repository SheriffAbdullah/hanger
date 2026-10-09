## Purpose

Guarantee that every evidence artifact Hanger writes is valid, versioned, anonymized without corruption, persisted while the run happens, and read back loudly, so that no reader ever acts on silently missing or broken evidence.

## ADDED Requirements

### Requirement: Reports are valid JSON after anonymization
The system SHALL write every JSON report so that it parses as valid JSON whether or not anonymization is enabled, SHALL read each report back after writing it, and SHALL treat a failed read-back as an error: it reports the file name and parse error, exits non-zero, and renders no view from that file.

#### Scenario: Anonymized trace parses
- **GIVEN** anonymization is enabled and the user profile path contains `C:\Users\Alice`
- **WHEN** a 30 s trace completes
- **THEN** parsing the written `hanger-<stamp>.json` succeeds
- **AND** the string `Alice` does not appear in the file

#### Scenario: Self-check catches a corrupt write
- **GIVEN** a test replaces the serializer output with text that is not valid JSON
- **WHEN** the report is written
- **THEN** the tool prints the file name and the parse error
- **AND** exits with a non-zero code
- **AND** no `.md` or `.html` view is produced from that file

### Requirement: Anonymization covers every path and identity shape
When anonymization is enabled, the system SHALL replace the hostname, the username, and every user-profile path shape with placeholders in every persisted or printed value. Shapes covered: backslash and forward-slash profile paths on any drive letter, home directories, encoded fragments such as `C--Users-<name>`, and organization-named sync folders.

#### Scenario: All path shapes are scrubbed
- **GIVEN** a fixture report whose values contain `D:\Users\alice\x`, `C:/Users/alice/y`, `C--Users-alice-repo`, `OneDrive - Contoso Ltd`, and the machine hostname
- **WHEN** the fixture is anonymized and serialized
- **THEN** a search of the output for `alice`, `Contoso`, and the hostname returns zero matches
- **AND** the output parses as valid JSON

#### Scenario: Text views are scrubbed with the same rules
- **WHEN** an anonymized trace writes its Markdown and HTML views and console summary
- **THEN** a search of those outputs for the username and hostname returns zero matches

### Requirement: Unreadable reports are reported, never skipped
Every component that reads stored reports (pack, trend, and all renderers) SHALL report each unreadable file by name together with its parse error. It SHALL NOT substitute a default such as "no trace found" or zero cost because a file could not be read.

#### Scenario: Pack names the unreadable trace
- **GIVEN** the newest `hanger-*.json` in the output directory is not valid JSON
- **WHEN** the user runs `pack`
- **THEN** the output names that file and its parse error
- **AND** the pack does not report "no trace report found" or a cost of 0 on account of that file

#### Scenario: Trend lists skipped files
- **GIVEN** three reports, one of which is invalid JSON
- **WHEN** the user runs `trend`
- **THEN** the table shows the two readable reports
- **AND** a line names the invalid file and its error

#### Scenario: Renderer refuses with the reason
- **WHEN** a renderer is given an invalid JSON file
- **THEN** it exits non-zero and prints the file name and parse error

### Requirement: Run evidence persists incrementally
During a trace, the system SHALL append each sample, probe, hang, user mark, and collection failure to an append-only stream file as it occurs, flushed record by record, and SHALL write the summary report at run end from the same records.

#### Scenario: Evidence on disk before the run ends
- **GIVEN** a trace of 60 s is running
- **WHEN** 20 s have elapsed
- **THEN** the stream file exists and every line parses as JSON
- **AND** it contains at least one probe record with a wall-clock time

#### Scenario: Summary matches the stream
- **WHEN** a trace completes normally
- **THEN** the number of probe records in the stream equals the number of probes in the summary report

### Requirement: Interrupted runs are marked unfinished
If a trace is interrupted (Ctrl+C, terminal closed, crash, or power loss), the evidence recorded so far SHALL remain parseable. The run SHALL be identifiable as unfinished, and the system SHALL be able to build a summary from the stream with a status of `unfinished` or `interrupted`.

#### Scenario: Ctrl+C mid-trace
- **GIVEN** a trace of 120 s
- **WHEN** the user presses Ctrl+C after 30 s
- **THEN** the stream file parses line by line
- **AND** it ends with a run-end record whose status is `interrupted`
- **AND** a summary report with `run.status` `interrupted` and an observed window of about 30 s is written

#### Scenario: Recover a stream without a run-end record
- **GIVEN** a stream file whose process was killed so that it has no run-end record
- **WHEN** the user runs `recover` on that stream
- **THEN** a summary report is written with `run.status` `unfinished`
- **AND** its probe count equals the number of probe records in the stream

### Requirement: Schema version declared and bumped on shape change
Every report SHALL declare its schema version and status (`draft` or `frozen`). Any added, renamed, or removed field SHALL be recorded in a dated schema changelog section. Once a version is frozen, a rename or removal SHALL bump the version. Readers SHALL branch on the declared version and SHALL NOT guess at an unknown one.

#### Scenario: Reports declare v2
- **WHEN** any trace report is written after this change
- **THEN** its root `schema` value is `hanger-json/2` and its `schemaStatus` is `draft`
- **AND** the schema changelog has a v2 section listing the new and changed fields

#### Scenario: Old and unknown versions handled explicitly
- **GIVEN** one report with schema `hanger-json/1` and one with `hanger-json/9`
- **WHEN** the user runs `trend`
- **THEN** the v1 row is shown labelled as pre-fix with rates that may be overstated
- **AND** the v9 file is reported as an unknown schema and not shown

#### Scenario: Pack requires v2
- **GIVEN** the only trace report has schema `hanger-json/1`
- **WHEN** the user runs `pack`
- **THEN** the output states that the report is v1 and must be re-captured

### Requirement: Effective settings recorded with their source
Each report SHALL record every setting that changes the evidence (duration, sample interval, anonymization, scope, and every threshold) with its effective value and its source (flag, config, or default). Any value the tool changed from what was requested SHALL be recorded with the requested value and the reason, and SHALL be printed on the console.

#### Scenario: Config-sourced interval recorded
- **GIVEN** the config file sets an interval of 500 and no flag is given
- **WHEN** a trace completes
- **THEN** the report records the interval as value 500 with source `config`

#### Scenario: Clamped duration is visible
- **GIVEN** the user requests `--duration 900` and the current maximum is 300
- **WHEN** the trace starts
- **THEN** the console prints that the duration was clamped from 900 to 300 and why
- **AND** the report records the requested value 900, the effective value 300, and the reason

### Requirement: Shipped sample report is synthetic and valid
The sample report shipped in the repository SHALL be generated deterministically from a synthetic fixture containing no real machine, user, or host data, and SHALL pass the same validation as any real report.

#### Scenario: Sample regenerates identically and validates
- **WHEN** the fixture builder is run twice
- **THEN** both runs produce byte-identical sample JSON
- **AND** the sample passes report validation with schema `hanger-json/2`
