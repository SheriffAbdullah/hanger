# Proposal

## Why

Telltale's only definition of a hang is a spawn-time probe: how long it takes to start a trivial process (at or above 800 ms). Its own report admits what that cannot see: UI input lag that does not delay process start, and freezes between probes (`diagnosis.hangDefinition.cannotSee`). The only check on the proxy is a user pressing a key in the terminal, which needs focus, needs the user to act during the stall, and has no end time (review 04, section 0). So today nobody can tell whether the tool's "hangs" are the freezes the user felt.

The owner wants a detector that needs no user action: when the user has just typed or clicked and the foreground application does not answer within about 250 ms, record a stall. It must also say when its own helper woke up late, and it must compare the spawn probe's hangs with what the user actually experienced, so the tool can see whether its hang definition matches felt hangs. Review 04 measured the passive approach on this laptop: about 0.0 ms CPU over 15 s and about 12 MB, with a 0 to 1 ms liveness round trip while calm. Its sensitivity on a real freeze is not yet measured.

## What Changes

- **Independent input helper.** A small separate process that watches for "input just happened" and asks the foreground application a trivial liveness question. It stamps each observation itself (monotonic and wall clock) and writes its own append-only file, so a stalled or dead main process cannot delay or lose it. It needs no administrator rights and degrades to "unavailable, with a reason" when a managed laptop blocks it.
- **Stall samples, episodes, and a calm baseline.** Slow answers after recent input become stall samples. Adjacent samples merge into episodes (start, end, duration, worst latency). A calm baseline and guards (idle after typing, chronically slow apps, sleep and resume, remote desktop, elevated or secure-desktop foreground, helper starved) keep normal behavior from being reported as stalls. Moments that cannot be judged are reported as "not evaluable" with a reason, never as stalls.
- **Helper wake-lateness self-signal.** How late the helper's own timer woke, independent of the main process's event-loop lag.
- **Agreement with the spawn probe.** Precision and recall of the probe's hangs against the felt stalls, the probe hangs with no stall, the stalls with no probe hang, and a recall that excludes stalls shorter than the probe interval.
- **A new confirmation source in the diagnosis.** `input-stall` sits beside `user-mark`, `os-not-responding` and `workload-probe`. The diagnosis also shows how many episodes were corroborated by the passive probe, Windows not-responding, user marks, and workload probes.
- **Outputs.** Chart overlay of episodes on every panel, an "input-response check" subsection in the evidence section (marked automatic), a line in the email draft, and placeholders whenever the check is unavailable or off.
- **Privacy.** Only "an input event occurred" and the scope group name of the foreground application (or `out-of-scope` with no name) are ever stored. No key, character, window title, clipboard, coordinates, or per-event counts. The canary test is extended to type a canary string into a test window.
- **Schema.** Additive `2.x` fields under the existing freeze (no bump to `/3`); see design decision 1.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `sampling`: ADDED "Independent input helper", "Input-response stall detection", "Stall episodes", "Detector declines to judge unjudgeable moments", "False-positive guards and calm baseline", "Helper wake-lateness self-signal", "Helper cost budget and graceful degradation", "Detector can be turned off and is announced".
- `scope`: ADDED "Input observation is not content capture", "Foreground identity follows the scope rule", "Detector respects scope at collection time".
- `diagnosis`: MODIFIED "Hang confirmation sources" (adds `input-stall`). ADDED "Episode corroboration is counted by source", "Spawn probe agreement with felt stalls", "Input-stall confirmation weight and episode confidence", "Detector blind spots are disclosed", "Helper lateness at a hang".
- `metrics`: ADDED "Input-stall records carry provenance", "Input-stall report section", "Agreement and corroboration metrics are stored as second-order values".
- `evidence-persistence`: ADDED "Helper evidence survives the main process", "Input-stall fields are additive under the schema freeze".
- `report-views`: MODIFIED "Finding summary on the first page", "Hang, mark, and workload annotations on every chart". ADDED "Input-response check in the evidence section".
- `it-handoff`: ADDED "Email states the input-response check".

## Impact

- New `tools/telltale/lib/input/` (helper bridge, pure episode builder, pure agreement calculator, report assembler) and helper source under `tools/telltale/lib/sampler/input-helper/`. No edits to the scheduler core; the helper is started and stopped beside the key-capture child.
- `tools/telltale/telltale.js`: start and stop the helper, settings and flags, merge the helper file at run end and in `recover`, add the `inputStall` key to report assembly.
- `tools/telltale/lib/diagnosis/context.js`, `engine.js`, `confidence.js`: confirmation source, corroboration, agreement, weights. Rules are untouched.
- `tools/telltale/lib/render/`: chart overlay, evidence subsection, finding count, email line.
- `tools/telltale/lib/settings.js` and `telltale.config.json` keys; `tools/telltale/lib/sampler/observer.js` reads the helper's process stats.
- `tools/telltale/SCHEMA-CHANGELOG.md`, `tools/telltale/test/helpers/validate-report.js`, `tools/telltale/test/canary-leak.js`, new fixtures and tests, `README.md`.
- Depends on the archived changes: sampling-engine-and-provenance (budget, provenance), software-inventory-and-scope (resolver and canary), diagnosis-engine-rebuild (confirmation sources, confidence), report-and-visualization (charts, email). Independent of the in-flight `workload-session-and-containers`; it reads `workload.probes` only if present.

## Follow-ups (out of scope)

- `global-hang-marking`: a global shortcut (and later tray, click target, retro CLI mark) that adds user marks from any application. It will reuse the same helper process and its append-only file; design.md records the boundary that makes this possible. The shortcut itself is not built here.
- Possible later: a cause rule that uses helper lateness; an admin-tier kernel input-delay source; calibration of the 250 ms threshold from user marks.

## Findings addressed

- Review 04 section 0 and recommendation rank 2 (passive input-without-response detector plus helper heartbeat lag): the proxy cannot be validated without an automatic felt-stall source.
- `diagnosis.hangDefinition.cannotSee` (UI input lag that does not delay process start): now partly observable and measured.
