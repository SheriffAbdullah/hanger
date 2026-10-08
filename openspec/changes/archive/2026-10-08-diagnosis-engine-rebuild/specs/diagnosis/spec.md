## Purpose

Turn timestamped run evidence into one ranked, traceable list of candidate causes per freeze and per run, with confidence derived from the evidence, honest outcomes when the cause is outside the declared scope or undetermined, and a single finding vocabulary used by every output.

## ADDED Requirements

### Requirement: Hang definition in user terms
The system SHALL define a hang as a hang-probe measurement (latency to start a trivial process) at or above a threshold (default 800 ms), SHALL record the probe kind and threshold in the report, and SHALL state in the report what the proxy cannot observe (UI input lag that does not delay process start, and freezes between probes).

#### Scenario: Hang definition recorded and disclosed
- **GIVEN** a run with `--hang 1200`
- **WHEN** the report is written
- **THEN** `diagnosis.hangDefinition` records the probe kind `process-start-latency`, `thresholdMs: 1200`, and its source `flag`
- **AND** it carries a non-empty `cannotSee` list that includes freezes shorter than the probe interval

#### Scenario: Probe below threshold is not a hang
- **GIVEN** the threshold is 800 ms
- **WHEN** a probe measures 799 ms
- **THEN** the probe is not counted as a hang

### Requirement: Hang confirmation sources
The system SHALL label every hang with its confirmation sources: `user-mark` (a hung mark within ±2 s), `os-not-responding` (an in-scope, non-suspended process reported not responding at that hang), or `workload-probe` (a declared workload latency probe exceeding its timeout within ±2 s). A hang with none of these SHALL be labelled `probe-only`.

#### Scenario: User mark confirms a hang
- **GIVEN** a hang at 10:00:05.0 and a `hung` user mark at 10:00:06.5
- **WHEN** confirmations are computed
- **THEN** that hang lists `user-mark` among its confirmation sources

#### Scenario: Unconfirmed hang is probe-only
- **GIVEN** a hang with no user mark within ±2 s, no in-scope not-responding process, and no workload probe timeout
- **WHEN** confirmations are computed
- **THEN** the hang is labelled `probe-only`
- **AND** the headline finding reports the count of probe-only hangs

### Requirement: Hang proxy validated against user marks
When at least one `hung` user mark exists, the system SHALL report the proxy's precision (detected hangs matched by a mark ÷ detected hangs) and recall (hung marks matched by a detected hang ÷ hung marks) with both counts. With no `hung` marks it SHALL report the proxy as `not validated`.

#### Scenario: Precision and recall with n
- **GIVEN** 4 detected hangs and 3 `hung` marks, of which 2 marks fall within ±2 s of a detected hang
- **WHEN** validation is computed
- **THEN** precision is reported as 2/4 = 0.50 and recall as 2/3 = 0.67, each with its numerator and denominator

#### Scenario: No marks means not validated
- **GIVEN** a run with 5 hangs and zero `hung` marks
- **WHEN** validation is computed
- **THEN** `diagnosis.proxyValidation.status` is `not validated` and no precision or recall number is emitted

### Requirement: Observer-affected probes excluded from inference
The system SHALL exclude from every cause rule any probe whose measurement was slowed by the tool itself: collection time over 2000 ms, slip over 1 s, or inside the startup window (the first probe and the first 10 s). It SHALL record each exclusion with its reason and SHALL report the excluded count beside every rate.

#### Scenario: Startup probe excluded
- **GIVEN** the first probe of a run has collection time 8849 ms and pages/sec 4513
- **WHEN** rules are evaluated
- **THEN** that probe is listed in `diagnosis.excludedProbes` with reason `startup-window` and `observer-slow`
- **AND** no rule uses its values as an input

#### Scenario: Excluded count disclosed
- **GIVEN** 30 probes, of which 4 are observer-affected
- **WHEN** the finding is rendered
- **THEN** it states 26 usable probes and 4 excluded

### Requirement: Calm windows
The system SHALL define calm probes as usable probes with latency below the recovery threshold (default 400 ms) that are not within 10 s of any hang. For every signal used by a rule, it SHALL compute the calm mean with its sample count n.

#### Scenario: Calm mean excludes hang neighbourhood
- **GIVEN** usable probes at t=10 s (300 ms), t=20 s (1500 ms, hang), t=26 s (350 ms), and t=40 s (200 ms)
- **WHEN** calm windows are computed
- **THEN** the probes at t=10 s and t=40 s are calm, the probe at t=26 s is not calm, and the calm n is 2

### Requirement: Minimum evidence before inference
The system SHALL NOT rank causes unless the run has at least 10 usable probes, and SHALL NOT call a condition "sustained" unless it holds on at least 3 probes. A single sample SHALL never be evidence. Below the minimum, the finding is `insufficient-evidence` (or `no-freeze-observed` when no hang occurred) with observations only.

#### Scenario: Short trace cannot be ranked
- **GIVEN** a run with 6 usable probes and 2 hangs
- **WHEN** the diagnosis is computed
- **THEN** the finding class is `insufficient-evidence`, the ranked list is empty, and the observations list the 2 hangs with their values

#### Scenario: One spike is not sustained
- **GIVEN** 12 usable probes where pages/sec exceeds 500 on exactly one probe
- **WHEN** any rule tests for sustained paging
- **THEN** the condition is reported as not sustained (1 of 12 probes, minimum 3)

### Requirement: Single ranked cause list
The system SHALL produce exactly one cause ranking per hang and one roll-up per run, phrased as "N of M usable hangs coincide with <cause>". Every other label (headline finding, hardware-versus-configuration signal, pack, print, charts, trend, email) SHALL be derived from this ranking, and no other inference path SHALL exist.

#### Scenario: Roll-up counts coinciding hangs
- **GIVEN** 5 usable hangs where the memory-pressure rule fired at 4 and the disk-stall rule at 1
- **WHEN** the run roll-up is computed
- **THEN** it reports "4 of 5 usable hangs coincide with memory pressure" ranked above "1 of 5 usable hangs coincide with disk stall"

#### Scenario: No parallel verdict exists
- **WHEN** a report is written
- **THEN** it contains no `summary.verdict`, `rca`, or standalone `discriminator` key outside `diagnosis`

### Requirement: Cause rule contract
Every cause rule SHALL emit, per hang, a result with: rule id, cause class, fired flag, input references, threshold with source, sample count n, calm mean with n, confidence, disprover check and result, and confounds. A rule that cannot evaluate because of missing data SHALL emit `fired: null` with a reason, never `false`.

#### Scenario: Complete rule result
- **WHEN** any rule is evaluated at a hang
- **THEN** its result contains `id`, `class`, `fired`, `inputs[]`, `threshold{value,source}`, `n`, `calm{mean,n}`, `confidence`, `disprover{check,result}`, and `confounds[]`

#### Scenario: Missing data is not a negative
- **GIVEN** the disk-latency signal is null with reason `counter-missing` at a hang
- **WHEN** the disk-stall rule is evaluated
- **THEN** its result has `fired: null` and a reason naming the missing signal

### Requirement: Confidence derived from evidence
The system SHALL compute each rule's confidence from recorded evidence components: threshold crossing at the hang, hang-versus-calm delta, co-occurrence share across usable hangs, confirmation share, and a confound penalty. It SHALL record the components and weights in the report, never use a fixed per-rule constant, and never exceed 0.95.

#### Scenario: Stronger evidence yields higher confidence
- **GIVEN** two fixtures identical except that the memory rule co-occurs with 5 of 5 hangs in one and 2 of 5 in the other
- **WHEN** confidences are computed
- **THEN** the 5-of-5 fixture reports a strictly higher memory-rule confidence
- **AND** both results list their component values and weights

#### Scenario: Confidence never reaches certainty
- **GIVEN** every component of a rule is at its maximum and every hang is confirmed by a user mark
- **WHEN** confidence is computed
- **THEN** the reported confidence is exactly 0.95 and never 1.0

### Requirement: Disprovers are evaluated
Each rule SHALL declare a disprover check computed from the same run's data. The result SHALL be one of `disproved`, `not-disproved`, or `not-evaluable`. A disproved rule SHALL be excluded from the ranking but listed with its disproving values.

#### Scenario: Memory rule disproved by calm values
- **GIVEN** a hang where commit is 62% and available memory is 4.1 GB at the hang and in the ±10 s around it
- **WHEN** the memory-pressure rule's disprover is evaluated
- **THEN** its result is `disproved` with those values
- **AND** memory pressure does not appear in that hang's ranking

### Requirement: Evidence traceable to data points
Every rule input SHALL reference the stored data point it came from: probe or sample index, measurement wall-clock time, value, and unit. A reader SHALL be able to locate every number in a finding in the first-order data of the same report.

#### Scenario: Input resolves to a stored probe
- **GIVEN** a rule result whose input is `{ref: "spawnProbes[17]", at: "2026-10-06T13:08:36.2Z", value: 91.0, unit: "%", signal: "mem.committed_pct"}`
- **WHEN** a test resolves the reference in the same JSON
- **THEN** `spawnProbes[17]` exists, its measurement time equals `at`, and its commit value equals 91.0

### Requirement: Load outside declared scope is a cause
In a scoped run, the system SHALL evaluate an `outside-scope` cause at each hang. It fires when machine-level pressure crossed its threshold (commit or CPU) while in-scope groups held less than 30% of committed memory or CPU. The finding SHALL then say in plain words that the load was held by processes outside the declared scope, with their aggregate share.

#### Scenario: Out-of-scope load is named as the cause
- **GIVEN** a run scoped to `postgres` and a hang with commit 92%, where in-scope groups hold 0.4 GB (5%) and out-of-scope groups hold 7.1 GB
- **WHEN** the diagnosis is computed
- **THEN** `outside-scope` fires at that hang
- **AND** the finding text states that the load at the freeze was held by processes outside the declared scope (7.1 GB, 23 groups not monitored)

#### Scenario: Not evaluable in open scope
- **GIVEN** a run in open scope
- **WHEN** rules are evaluated
- **THEN** the `outside-scope` rule result is `fired: null` with reason `open scope`

### Requirement: Undetermined is an allowed outcome
When at least one usable hang exists, minimum evidence is met, and no rule fired (or every fired rule was disproved), the system SHALL report the finding class `undetermined`. It SHALL list the rules checked and why each did not fire, and SHALL NOT substitute a guess.

#### Scenario: No rule fires
- **GIVEN** 12 usable probes with 3 hangs and every rule either not fired or disproved
- **WHEN** the finding is computed
- **THEN** the class is `undetermined` and the report lists every rule evaluated with its non-firing values

### Requirement: Headline finding derived from the leading cause
The system SHALL derive the headline finding from the top-ranked cause of the run roll-up. It is an association sentence ("N of M usable hangs coincide with X; calm value Y (n)") plus one class from the fixed vocabulary, with confirmation counts and evidence strength. The word "STATE" and causal certainty SHALL NOT appear.

#### Scenario: Finding names the leading class with numbers
- **GIVEN** a 60 s run with 26 usable probes and 5 hangs, where memory pressure fired at 5 of 5 with commit 90% at the hangs vs 62% calm (n=18)
- **WHEN** the finding is rendered
- **THEN** the class is `memory` and the sentence includes "5 of 5", "90%", "62%", and "n=18"
- **AND** the text contains no "STATE" token

#### Scenario: Zero hangs yields no-freeze-observed
- **GIVEN** a run with 5 probes, 0 hangs, commit 52-65%, and one startup probe excluded
- **WHEN** the finding is computed
- **THEN** the class is `no-freeze-observed`, the evidence strength is `insufficient (4 usable probes, minimum 10)`, and no memory class is emitted

### Requirement: One finding vocabulary across outputs
The system SHALL use one cause-class vocabulary: `memory`, `cpu`, `disk`, `thermal-power`, `gpu`, `security-software`, `outside-scope`, `undetermined`, `no-freeze-observed`, `insufficient-evidence`. Trace JSON, pack, printable view, charts, trend, and email draft SHALL use only these labels.

#### Scenario: Pack and trend reuse the trace class
- **GIVEN** a trace whose finding class is `disk`
- **WHEN** the pack, printable view, and trend table are produced from it
- **THEN** each shows the class `disk`, and none emits `STALL-OBSERVED`, `SUSTAINED-PRESSURE`, `RAM-BOUND`, or `PRESSURED`

### Requirement: No canned or assumed content
Diagnosis text SHALL be built only from fired rules and measured values. It SHALL NOT name software, workloads, or consequences that were not observed in the run, and SHALL NOT include any default-assumed quantity.

#### Scenario: Unobserved software is never named
- **GIVEN** a run in which no Docker, Playwright, or vmmem process was observed
- **WHEN** the finding and cause text are generated
- **THEN** they contain none of the strings "Docker", "Playwright", or "OOM"

### Requirement: Time-lost context uses measured inputs only
The system SHALL report time-lost context only when at least 1 usable hang exists. It is computed from the measured hang count, mean freeze duration, and observed window. User-supplied extrapolation parameters are labelled as user-supplied, and no default is assumed. It SHALL appear only in the appendix section.

#### Scenario: No hangs, no cost
- **GIVEN** a run with 0 hangs and no cost flags
- **WHEN** the report is written
- **THEN** it contains no time-lost or currency figure

#### Scenario: Measured window only without user inputs
- **GIVEN** 4 hangs with mean duration 2.5 s in an observed window of 600 s and no `--active-min` or `--cost-rate` flags
- **WHEN** time-lost is computed
- **THEN** it reports 10 s frozen in 600 s observed and no per-day or currency extrapolation

### Requirement: Hardware-versus-configuration signal uses neutral vocabulary
The hardware-versus-configuration signal SHALL be derived from the ranking. Its values SHALL be one of `pressure-at-freezes`, `large-resident-without-pressure`, or `not-separable`, each with its supporting deltas and n per side. Neither the signal nor any finding text SHALL recommend buying, upgrading, replacing, or reimaging.

#### Scenario: Neutral signal with supporting deltas
- **GIVEN** a run where commit at hangs is 91% (n=5) vs 63% calm (n=20)
- **WHEN** the signal is computed
- **THEN** its value is `pressure-at-freezes` with both means and both n
- **AND** no output text matches `/\b(buy|upgrade|replace|purchase|reimage)\b/i`

### Requirement: OS event records enter inference only when windowed
OS event-log records (application hang, crash, resource exhaustion) SHALL be used as rule inputs or confirmations only when their timestamp falls inside the run's observed window and they come from the expected provider. All other records SHALL be shown as history only.

#### Scenario: Yesterday's event is history only
- **GIVEN** an application-hang record timestamped 20 hours before the run started
- **WHEN** the diagnosis is computed
- **THEN** no rule input or confirmation references it, and it appears only under history

### Requirement: Thresholds cite a source or are labelled provisional
Every threshold used by a cause rule SHALL be recorded in the report with its value and a source, either a citation key or the label `provisional`, plus whether it came from a flag or the default.

#### Scenario: Threshold provenance recorded
- **WHEN** the disk-stall rule uses its 25 ms latency threshold
- **THEN** the rule result records `threshold: {value: 25, unit: "ms", source: <citation key or "provisional">, origin: "default"}`

### Requirement: Memory pressure at the hang rule
The memory-pressure rule SHALL fire at a hang when committed memory at that hang is at or above the commit threshold (default 85%) or available memory is below the minimum-free threshold, judged on the probe nearest the hang and not on any run-wide peak or minimum, and the hang value exceeds the calm mean.

#### Scenario: Run-wide peak does not convict a calm hang
- **GIVEN** a run whose commit peaked at 88% at t=5 s, and a hang at t=22 s with commit 83% and pages/sec 292
- **WHEN** the memory-pressure rule is evaluated at that hang
- **THEN** it does not fire

#### Scenario: At-hang pressure fires
- **GIVEN** a hang with commit 91% and available memory 0.3 GB, against a calm mean of 62% (n=18)
- **WHEN** the rule is evaluated
- **THEN** it fires with inputs referencing the hang probe and calm `{mean: 62, n: 18}`

### Requirement: CPU saturation rule
The CPU-saturation rule SHALL fire at a hang when total CPU is above 90% and the processor queue length per logical processor is above 2 at the hang, and SHALL name the in-scope process groups with the highest CPU share at that hang.

#### Scenario: Queue normalized per logical processor
- **GIVEN** a 12-logical-processor machine at a hang with CPU 96% and queue length 30
- **WHEN** the rule is evaluated
- **THEN** it fires (queue per logical processor 2.5 > 2) and lists the top in-scope CPU groups

#### Scenario: Busy CPU with short queue does not fire
- **GIVEN** CPU 95% and queue length 12 on 12 logical processors
- **WHEN** the rule is evaluated
- **THEN** it does not fire

### Requirement: Disk stall rule
The disk-stall rule SHALL fire at a hang when disk latency exceeds 25 ms and queue length is at least 1, sustained on at least 3 usable probes within ±10 s of the hang.

#### Scenario: Sustained disk stall
- **GIVEN** probes within ±10 s of a hang showing latency 41, 38, and 55 ms with queue length 2, 1, and 3
- **WHEN** the rule is evaluated
- **THEN** it fires with n=3 and references to the three probes

#### Scenario: Single slow probe does not fire
- **GIVEN** only one probe within ±10 s of a hang exceeding 25 ms
- **WHEN** the rule is evaluated
- **THEN** it does not fire

### Requirement: Security-software contention rule
The security-software rule SHALL fire at a hang when the CPU of security products, normalized to machine share, is at least 2.5× its calm mean and at least 8% of machine capacity, while the memory-pressure rule did not fire. The rule SHALL always list "probe process starts may trigger scanning" as a confound.

#### Scenario: Normalized AV CPU convicts at a calm-memory hang
- **GIVEN** a 12-logical-processor machine where security CPU is 12% of machine at a hang vs 1.5% calm (n=15), with commit 60%
- **WHEN** the rule is evaluated
- **THEN** it fires and lists the observer-induced scanning confound

#### Scenario: Per-core raw value is never compared directly
- **GIVEN** a raw per-core security CPU value of 180 on 12 logical processors (15% of machine)
- **WHEN** the rule reads its input
- **THEN** the input value is 15 with unit `% of machine`, and no threshold is compared with 180
