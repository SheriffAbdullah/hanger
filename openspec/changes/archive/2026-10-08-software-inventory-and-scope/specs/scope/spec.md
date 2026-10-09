## Purpose

Defines how the user sees what is running locally, chooses what to monitor, and how that declared scope is enforced before anything is written or printed. Shareable evidence names only in-scope software and the system set, and reports everything else as anonymous aggregates.

## ADDED Requirements

### Requirement: Software inventory is a local-only artifact
The system SHALL provide an `inventory` mode that lists running software groups with friendly name, instance count, memory share, and category (user or system). It SHALL write that list only to a private local folder, mark it non-shareable, and exclude it from pack, attachments, and every shareable view. The inventory MAY be used to draft a scope file.

#### Scenario: Inventory written to the private folder only
- **WHEN** the user runs `inventory --out <dir>`
- **THEN** exactly one file `<dir>/private/inventory-<stamp>.json` is written with `"shareable": false`
- **AND** no other file under `<dir>` is created or modified

#### Scenario: Inventory never enters a shareable artifact
- **GIVEN** an inventory file exists under `<dir>/private/`
- **WHEN** the user runs `pack --out <dir>` and renders `--print` for the latest trace
- **THEN** no group name that appears only in the inventory file occurs in the pack JSON or the printed HTML
- **AND** pack refuses any input path under `private/` with a message naming the path

#### Scenario: Inventory drafts a scope file
- **WHEN** the user runs `inventory --write-scope`
- **THEN** a scope file is written listing every user-category group as an entry with `"enabled": false`
- **AND** no entry is enabled until the user edits the file

### Requirement: User-authored scope file
The system SHALL accept an allow-list authored by the user as a scope file, and SHALL record in every report the scope provenance: source (`file`, `template:<name>`, or `flag`), file path when present, and a SHA-256 hash of the file content. Presets SHALL only write a draft scope file. An invalid scope file SHALL stop the run with exit code 2 naming the path and the offending key.

#### Scenario: Provenance recorded from a scope file
- **GIVEN** a valid scope file `hanger.scope.json` with one entry `postgres`
- **WHEN** a trace runs with that scope
- **THEN** the report `scope.source` is `file`, `scope.path` names the file, and `scope.sha256` equals the SHA-256 of the file bytes

#### Scenario: Ad-hoc flag recorded as flag source
- **WHEN** a trace runs with `--only postgres` and no scope file
- **THEN** `scope.source` is `flag` and `scope.entries` lists exactly `postgres`

#### Scenario: Invalid scope file stops the run
- **GIVEN** a scope file containing an entry with the unknown key `regex`
- **WHEN** a trace starts
- **THEN** the process exits with code 2 and the message names the file path and `regex`
- **AND** no report file is written

### Requirement: Scope match semantics
The system SHALL match a scope entry only by case-insensitive executable name (with or without extension) or an explicit name pattern using `*` and `?`. It SHALL NOT match friendly labels or command-line text. Descendant processes SHALL be in scope only when the entry opts in, pinned by process id plus creation time. Any fallback to a narrower match SHALL be recorded with time and reason.

#### Scenario: Substring does not match
- **GIVEN** a scope entry `code`
- **WHEN** processes `code.exe`, `opencode.exe`, and `claude.exe` (friendly label "Claude Code CLI") are running
- **THEN** only `code.exe` is in scope

#### Scenario: Descendants only when opted in
- **GIVEN** a scope entry `node` without descendant opt-in, and a `node.exe` whose child is `cmd.exe`
- **WHEN** the resolver classifies the processes
- **THEN** `cmd.exe` is out of scope
- **AND** with `includeDescendants: true` the same `cmd.exe` is in scope

#### Scenario: Reused process id is not adopted
- **GIVEN** an opted-in descendant pinned as process id 4242 with creation time T1
- **WHEN** process id 4242 is later reused by an unrelated process with creation time T2
- **THEN** the new process is out of scope

#### Scenario: Fallback is reported, never widened
- **GIVEN** parent information is unavailable for one snapshot
- **WHEN** the resolver classifies processes
- **THEN** only exact entry names are in scope for that snapshot
- **AND** `scope.fallbacks[]` gains an item with its time and reason

### Requirement: Always-monitored system set
The system SHALL monitor a fixed, published system set by name regardless of the user's scope: operating-system components, security products registered with the OS, and virtualization host processes. The set SHALL never include user applications, and its list version and categories SHALL appear in every scope declaration.

#### Scenario: System set present in a narrow scope
- **GIVEN** scope `postgres` only
- **WHEN** a trace runs while the security product service and memory compression are active
- **THEN** both appear by name in the per-process data with category `system`
- **AND** `scope.systemSet.listVersion` and `scope.systemSet.categories` are recorded

#### Scenario: User application not in system set
- **GIVEN** scope `postgres` only
- **WHEN** a trace runs while a browser is running
- **THEN** the browser name appears in no persisted artifact

### Requirement: One scope resolver for every mode and output
The system SHALL classify every process-identifying datum as in-scope, system, or out-of-scope with one resolver and identical semantics in trace, watch, inventory, record, pack, renderers, console output, and log files.

#### Scenario: Watch and trace agree
- **GIVEN** the same scope file and the same running processes
- **WHEN** a watch sample and a trace snapshot are taken one second apart
- **THEN** the set of in-scope group names in the watch log line equals the set in the trace snapshot

#### Scenario: Resolver unit contract
- **WHEN** the resolver test suite runs with canned process rows
- **THEN** every output writer receives only resolved structures and the test fails if any writer receives a raw row

### Requirement: Out-of-scope identity is never persisted or printed
The system SHALL NOT write or print the name, process id, command line, window title, container name, or per-process metric of any out-of-scope process to any report, stream file, watch log, Markdown, HTML, console, or log. Out-of-scope identity MAY be held in memory only to decide membership. Reports SHALL state that names outside scope were not recorded.

#### Scenario: Canary absent from every artifact
- **GIVEN** an idle process named `zzcanary<random>.exe` is running
- **WHEN** trace, watch, pack, and `--print` run with `--only postgres` and console output is captured
- **THEN** a case-insensitive search for the canary name across every output file and the captured console finds zero matches

#### Scenario: Not-responding list is scoped
- **GIVEN** an out-of-scope application reports not-responding during a hang
- **WHEN** the hang row is written
- **THEN** the row contains no name of that application
- **AND** the row records only the count of out-of-scope not-responding processes

#### Scenario: Honest wording
- **WHEN** any shareable view of a scoped run is rendered
- **THEN** it contains the sentence "Names of software outside this scope were not recorded."
- **AND** it does not contain the phrase "never collected"

### Requirement: Out-of-scope load is recorded as anonymous aggregates
The system SHALL record, for the run and for every hang, the out-of-scope group count, process count, total memory, and total CPU share of the machine, together with the in-scope and system-set totals measured at the same moment. A metric that is not yet available SHALL be null with a reason.

#### Scenario: Aggregates at each hang
- **GIVEN** a scoped trace with 3 hangs
- **WHEN** the report is written
- **THEN** each hang row has `scopeShare` with `outOfScope.memMB`, `inScope.memMB`, `system.memMB`, and `measuredAt`

#### Scenario: Nothing in scope still yields evidence
- **GIVEN** scope `postgres` and no postgres process running
- **WHEN** a trace with at least one hang completes
- **THEN** every hang row has `scopeShare.inScope.memMB` equal to 0 and a numeric `scopeShare.outOfScope.memMB`
- **AND** `scope.counts.inScopeGroups` is 0

### Requirement: Scope declaration leads every shareable view
The system SHALL place a scope declaration before any per-process table in the Markdown, print HTML, pack, and console run summary. The declaration covers the allow-list as authored, match rule, system set, in-scope and out-of-scope counts, aggregate out-of-scope share, and the not-recorded statement. With no scope, it SHALL read "OPEN SCOPE".

#### Scenario: Declaration precedes culprit table
- **WHEN** the Markdown view of a scoped trace is generated
- **THEN** the "Scope" heading appears before the first per-process table
- **AND** it lists the entries, match rule, counts, and out-of-scope memory total

#### Scenario: Open scope declared
- **GIVEN** no scope file and no `--only`
- **WHEN** a trace completes
- **THEN** the first block of the Markdown, print HTML, and console summary contains "OPEN SCOPE: names of all running software may appear in this report"

### Requirement: No silent default filtering
The system SHALL NOT ship a default configuration that filters, hides, or collapses processes. The `--hide`, `--focus`, and `--extras` flags and their configuration keys SHALL be rejected with exit code 2 and a message pointing to the scope file.

#### Scenario: Retired flag rejected
- **WHEN** the user runs `trace --hide claude`
- **THEN** the process exits with code 2
- **AND** the message names the scope file as the replacement

#### Scenario: Committed defaults do not filter
- **WHEN** the repository default configuration is loaded
- **THEN** it contains none of the keys `hide`, `focus`, `extras`

### Requirement: Raw command lines are never persisted
The system SHALL NOT write any process command line to any artifact, console, or log. Command lines SHALL be read only for in-scope processes and only to derive an application label.

#### Scenario: Secret in command line does not leak
- **GIVEN** an in-scope process started with the argument `--password=hunter2`
- **WHEN** a trace with `--print` completes
- **THEN** the string `hunter2` occurs in no output file and not in captured console output

### Requirement: Application labels for in-scope processes
The system SHALL give each in-scope process group a derived application label (for example script base name, database name, or container name) and record the identifier of the fixed rule that produced it. When no rule applies, the label SHALL be the friendly name with rule `none`.

#### Scenario: Script label derived
- **GIVEN** an in-scope `node.exe` running `C:\work\api\server.js`
- **WHEN** the report is written
- **THEN** the group label is `Node: server.js` with rule `node-script`
- **AND** the path `C:\work\api` does not appear

### Requirement: Not a software-compliance scanner
The system SHALL NOT produce, in any shareable artifact, a list, count by name, signature status, or policy judgment of software outside the declared scope. Its legitimacy rests on declared scope plus anonymous aggregates.

#### Scenario: No out-of-scope inventory in pack
- **GIVEN** 100 out-of-scope groups were running during a scoped trace
- **WHEN** `pack` runs
- **THEN** the pack contains the out-of-scope group count and aggregate totals
- **AND** contains no per-group entry, signature field, or policy verdict for any out-of-scope group
