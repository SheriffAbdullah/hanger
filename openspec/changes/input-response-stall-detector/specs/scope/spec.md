## ADDED Requirements

### Requirement: Input observation is not content capture
The system SHALL observe input only as the fact and time that input occurred. It SHALL NOT read, derive, store or print which key or button was used, any typed text, window title, clipboard content, pointer position or per-event count, and SHALL NOT install any mechanism that receives other applications' keystrokes. Only timestamps of evaluated moments, per-moment input-recent flags or counts of such moments, and measured latencies MAY be stored.

#### Scenario: Typed text appears nowhere
- **GIVEN** a test window that has focus and a canary string `zzkeycanary<random>`
- **WHEN** the canary string is typed into the window during a run with induced stalls and every artifact and the captured console are searched case-insensitively
- **THEN** zero matches are found in the stream, the helper file, the report JSON, Markdown, HTML, email draft, console output and helper output

#### Scenario: Window title appears nowhere
- **GIVEN** the foreground test window has the title `zztitlecanary<random>`
- **WHEN** a run with induced stalls completes
- **THEN** that title appears in no artifact and not in captured console output

#### Scenario: No content-capturing hook exists
- **WHEN** the helper source and the bridge code are searched for keyboard hooks, keyboard raw-input registration, per-key state polling, clipboard access, microphone access and camera access
- **THEN** no match is found

#### Scenario: Only per-moment facts are stored
- **WHEN** the helper file of a run with input is inspected
- **THEN** no record contains a key identifier, character, button identifier, pointer coordinate or per-event counter
- **AND** input appears only as `inputRecent` booleans or counts of evaluated moments

### Requirement: Foreground identity follows the scope rule
The system SHALL classify the foreground application of every evaluated moment with the same semantics as the scope resolver and store only the in-scope or system-set group name, the literal `out-of-scope` with no name, or `unknown`. It SHALL NOT write or print the name, process id, command line, window title or metric of an out-of-scope foreground application. Where information is missing it SHALL classify narrower, never wider, and record the fallback in `scope.fallbacks[]`.

#### Scenario: Out-of-scope foreground is anonymous
- **GIVEN** a run scoped to `postgres` and an induced stall in a foreground application named `zzfgcanary<random>`
- **WHEN** the run completes
- **THEN** the episode records foreground `out-of-scope` with no name
- **AND** the canary name appears in no artifact and not in captured console output

#### Scenario: In-scope foreground is named by group
- **GIVEN** a run scoped to `code` and an induced stall in that application
- **WHEN** the run completes
- **THEN** the episode records the in-scope group name

#### Scenario: Classifier never widens scope
- **GIVEN** a scope entry that depends on descendant relationships the classifier cannot see for one moment
- **WHEN** that moment is classified
- **THEN** it is classified as out-of-scope or unknown
- **AND** `scope.fallbacks[]` gains an item with its time and reason

#### Scenario: Out-of-scope episodes are counted anonymously
- **GIVEN** a scoped run with 2 episodes in out-of-scope foreground applications
- **WHEN** the report is written
- **THEN** the report states the count of out-of-scope episodes and their total duration
- **AND** contains no per-application entry for them

### Requirement: Detector respects scope at collection time
The system SHALL decide membership of the foreground application inside the helper at collection time, before anything is written, so that out-of-scope identity exists only in the helper's memory for the duration of the decision. The helper file SHALL be subject to the same canary check as every other output.

#### Scenario: Helper file passes the canary check
- **WHEN** `node tools/hanger/test/canary-leak.js` runs with an out-of-scope foreground canary
- **THEN** the helper file is among the searched artifacts and reports zero hits
