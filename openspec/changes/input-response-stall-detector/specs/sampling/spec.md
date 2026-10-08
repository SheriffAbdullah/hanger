## ADDED Requirements

### Requirement: Independent input helper
The system SHALL run the input-response stall detector in a helper that is a separate operating-system process from the main process. The helper SHALL stamp each observation when it makes it, with a monotonic and a wall-clock reading, and the main process SHALL NOT re-stamp or back-fill it. The helper SHALL append observations to its own append-only file, flushed per record, and SHALL stop itself when the main process ends.

#### Scenario: Observation time comes from the helper, not the main process
- **GIVEN** the main process event loop is blocked for 10 s starting at t=20.0 s
- **WHEN** the helper observes an input-response stall at t=22.0 s
- **THEN** the stored observation carries a wall-clock time within 250 ms of 22.0 s and a monotonic reading from the helper
- **AND** the time the main process received the record, if stored at all, is stored under a separate field

#### Scenario: Helper file is flushed per record
- **GIVEN** a run in which the helper has observed two stall samples
- **WHEN** the helper is killed immediately after the second
- **THEN** its file parses line by line and contains both samples

#### Scenario: Helper does not outlive the run
- **WHEN** the main process exits normally, is interrupted, or is killed
- **THEN** within 5 s no helper process of that run remains
- **AND** the helper's file is closed with a final summary record when the exit was orderly

### Requirement: Input-response stall detection
The system SHALL automatically detect an input-response stall, meaning input occurred within a recent-input window (default 1000 ms) and the foreground application then fails to answer a trivial liveness request within a stall threshold (default 250 ms) or not at all. Both are configurable. It SHALL ask only while input is recent, and SHALL record each over-threshold measurement as a stall sample with helper timestamps, latency or timeout flag, and foreground classification.

#### Scenario: Typing into an application that does not answer
- **GIVEN** input occurred 300 ms ago and the foreground application takes 900 ms to answer the liveness request
- **WHEN** the detector evaluates that moment
- **THEN** a stall sample is recorded with latency 900 ms and the helper's wall-clock time

#### Scenario: Application answers within the threshold
- **GIVEN** input occurred 300 ms ago and the foreground application answers in 40 ms
- **WHEN** the detector evaluates that moment
- **THEN** no stall sample is recorded

#### Scenario: Idle user is never probed
- **GIVEN** the last input occurred 30 s ago and the foreground application is busy for 5 s
- **WHEN** the detector runs over that period
- **THEN** no liveness request is sent to the application
- **AND** no stall sample is recorded
- **AND** the period is counted as idle, not as evaluated calm time

#### Scenario: Application never answers
- **GIVEN** input occurred 100 ms ago and the foreground application does not answer within the request timeout
- **WHEN** the detector evaluates that moment
- **THEN** a stall sample is recorded with the timeout flag set and the timeout as its latency lower bound

#### Scenario: Thresholds are configurable and recorded
- **GIVEN** `telltale.config.json` sets the stall threshold to 400 ms and the recent-input window to 1500 ms
- **WHEN** a run completes
- **THEN** the report records both values with source `config`, and a measurement of 350 ms is not a stall sample

### Requirement: Stall episodes
The system SHALL merge adjacent stall samples into episodes with start, end, duration, worst latency, sample count and foreground classification. Samples no more than the merge gap apart (default 1000 ms, configurable) belong to one episode. An episode SHALL need two consecutive stall samples or one at or above twice the threshold; a lone shorter sample is a blip, not an episode. An episode open at run end or at a not-evaluable interval SHALL be closed there with its end reason recorded.

#### Scenario: Adjacent samples merge into one episode
- **GIVEN** stall samples at 10.0 s (400 ms), 10.3 s (700 ms), 10.6 s (1200 ms) and 12.5 s (300 ms) with a merge gap of 1.0 s
- **WHEN** episodes are built
- **THEN** the first three form one episode with start 10.0 s, worst latency 1200 ms and 3 samples
- **AND** the sample at 12.5 s is a blip, not an episode

#### Scenario: Lone mild sample is a blip
- **GIVEN** exactly one stall sample of 300 ms and no neighbour within the merge gap
- **WHEN** episodes are built
- **THEN** no episode is created and the blip count is 1

#### Scenario: Lone severe sample forms an episode
- **GIVEN** exactly one stall sample of 600 ms with a threshold of 250 ms
- **WHEN** episodes are built
- **THEN** one episode is created with 1 sample

#### Scenario: Episode cut short by a not-evaluable interval
- **GIVEN** an episode is open when the screen locks
- **WHEN** episodes are built
- **THEN** the episode ends at the lock time with end reason naming the not-evaluable cause
- **AND** no stall time is added for the locked interval

### Requirement: Detector declines to judge unjudgeable moments
The system SHALL classify any moment it cannot judge as not evaluable, with a reason, and SHALL NOT produce a stall sample or episode for it. Reasons SHALL include a higher-privilege foreground application, secure desktop, locked screen, remote-desktop session, suspend or resume, no foreground window, and a starved helper. Not-evaluable intervals SHALL be reported with start, end and reason and excluded from the evaluated time used by every rate and share.

#### Scenario: Elevated foreground application
- **GIVEN** the foreground application is elevated and the tool is not
- **WHEN** the user types and the application is slow
- **THEN** no stall sample is recorded
- **AND** the interval is reported not evaluable with reason `elevated-foreground`

#### Scenario: Locked screen and secure desktop
- **WHEN** the screen is locked or a user-account-control prompt owns the desktop
- **THEN** the interval is reported not evaluable with reason `locked` or `secure-desktop`
- **AND** no stall sample is recorded for it

#### Scenario: Suspend and resume
- **GIVEN** the machine slept for 10 min and resumed
- **WHEN** the detector wakes
- **THEN** the sleep interval and the first 5 s after resume are reported not evaluable with reason `suspend-resume`
- **AND** no episode spans the sleep

#### Scenario: Remote-desktop session
- **GIVEN** the interactive session is a remote-desktop session
- **WHEN** the detector runs
- **THEN** the whole session is reported not evaluable with reason `remote-session`
- **AND** the report states that input timing is network-mediated

#### Scenario: Helper starved
- **GIVEN** the helper woke 900 ms later than scheduled
- **WHEN** a liveness measurement spans that wake
- **THEN** the measurement is tagged `helper-late` and is not counted as evidence about the foreground application alone

### Requirement: False-positive guards and calm baseline
The system SHALL guard against reporting normal behavior as stalls. A foreground group over the threshold on at least half of at least 20 evaluated measurements SHALL be flagged chronically slow and SHALL NOT confirm a hang. Users MAY list in-scope groups to ignore, recorded with their ignored-sample counts. A measurement during which the foreground window changed SHALL be dropped. A calm baseline (n, median, p95, maximum, share over threshold) SHALL be recorded, and a noisy detector flagged.

#### Scenario: Chronically slow application is flagged
- **GIVEN** an in-scope group answered slower than the threshold on 30 of 40 evaluated measurements
- **WHEN** the run is summarized
- **THEN** that group is flagged `chronic-slow-app`
- **AND** its episodes are recorded but do not count as confirmations of any hang

#### Scenario: Ignored group is declared
- **GIVEN** the config lists group `slowtool` as ignored
- **WHEN** it is slow after input
- **THEN** no episode is created for it
- **AND** the report records `slowtool` as ignored with the count of ignored samples

#### Scenario: Foreground change during a measurement
- **GIVEN** the foreground window changes while a liveness request is pending
- **WHEN** the request completes
- **THEN** the measurement is dropped and counted under `foreground-changed`

#### Scenario: Calm run yields no episodes and a baseline
- **GIVEN** a 5-min fixture of input with all latencies between 1 and 30 ms
- **WHEN** the run is summarized
- **THEN** the episode list is empty
- **AND** the calm baseline records n, median, p95 and maximum with the share over the threshold at 0
- **AND** the detector is not flagged noisy

#### Scenario: Noisy baseline is disclosed
- **GIVEN** a fixture whose calm p95 is 180 ms with a 250 ms threshold
- **WHEN** the run is summarized
- **THEN** the detector is flagged noisy with the measured p95 and the limit

### Requirement: Helper wake-lateness self-signal
The system SHALL measure in the helper, on a monotonic clock, how late each periodic wake-up was relative to its schedule. It SHALL record a summary (count, median, p95, maximum) and a list of late periods, each a run of wake-ups late by at least the late threshold (default 200 ms, configurable), with start, end and maximum lateness. This self-signal SHALL be recorded whether or not input occurred and SHALL be independent of the main process event-loop lag.

#### Scenario: Late wake is recorded
- **GIVEN** the helper is scheduled to wake every 250 ms and a fixture delays one wake by 1100 ms
- **WHEN** the run is summarized
- **THEN** one late period is recorded with maximum lateness 850 ms and the wall-clock start and end

#### Scenario: Lateness recorded while idle
- **GIVEN** the user provides no input for the whole run
- **WHEN** the machine stalls and the helper wakes late
- **THEN** the late period is still recorded
- **AND** no stall sample is recorded

#### Scenario: Main-process lag does not become helper lateness
- **GIVEN** the main process event loop is blocked for 10 s and the helper is not delayed
- **WHEN** the run is summarized
- **THEN** the helper lateness summary shows no late period for that interval

### Requirement: Helper cost budget and graceful degradation
The system SHALL keep the helper within its own observer budget of at most 0.5% of one logical processor averaged over the run and a declared small peak memory, and SHALL report its CPU and private memory separately and within total observer cost. When the helper cannot be built, started or kept running, the run SHALL continue without it, SHALL NOT fail or hang, and SHALL record the detector as unavailable with a plain reason and time. The detector SHALL need no administrator rights.

#### Scenario: Helper cost reported
- **WHEN** a run with the helper completes
- **THEN** `sampling.observer` reports the helper's average CPU percent of one logical processor and peak private MB, each with unit and n
- **AND** states the helper limits and whether they were exceeded

#### Scenario: Helper over its budget
- **GIVEN** a fake meter reporting 0.9% average CPU for the helper over 600 s
- **WHEN** the run completes
- **THEN** the helper budget is recorded as exceeded with value 0.9, limit 0.5 and window 600 s
- **AND** the console prints one line naming it

#### Scenario: Helper cannot be started
- **GIVEN** the helper cannot be built or launched
- **WHEN** a trace runs
- **THEN** the trace completes with exit code 0 and every other signal is collected
- **AND** the report records the detector as unavailable with a non-empty reason and the time

#### Scenario: Helper dies mid-run
- **GIVEN** the helper exits unexpectedly at t=40 s
- **WHEN** the run completes
- **THEN** the interval after the helper's last observation is reported as an unobserved interval with reason `helper-exited`
- **AND** no stall is inferred for it

#### Scenario: No administrator rights needed
- **GIVEN** an unelevated shell
- **WHEN** a trace runs
- **THEN** the detector runs and the report's tier is `user`
- **AND** no signal is skipped for want of elevation on account of the detector

### Requirement: Detector can be turned off and is announced
The system SHALL run the detector by default, SHALL allow the user to disable it by flag or configuration, and SHALL state at run start on the console and in the report that the detector is active, what it observes and what it does not. When disabled, the report SHALL record it as not requested, not as unavailable.

#### Scenario: Announcement at start
- **WHEN** a trace starts with the detector enabled
- **THEN** the console prints one line stating that input timing is observed without recording what is typed or clicked

#### Scenario: Disabled by the user
- **WHEN** a trace starts with the detector disabled by flag
- **THEN** no helper process is launched
- **AND** the report records the detector as `not-requested` with source `flag`
