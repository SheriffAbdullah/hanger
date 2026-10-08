# Proposal: fix-report-integrity

## Why

Telltale's evidence is broken before anyone reads it. With the shipped default `anonymize: true`, every trace JSON is invalid (R02-P0-1, R03-P0-1). Pack and trend then skip it silently and report "no trace" and $0. Nothing is written until the run ends, so a hang, a reboot or Ctrl+C loses everything (R02-P0-6). Under load, sample times are nominal rather than measured, so rates are overstated about 4x (R02-P0-7). The tool also blames itself ("Node: telltale.js") as the top culprit (R02-P1-5). Every later change (scope, signals, diagnosis, report) builds on this layer, so it has to be trustworthy first. This change also creates the test harness that every later change uses.

## What Changes

- **Test harness** (zero dependencies): `node --test tools/telltale/test/` with synthetic fixtures and helpers that validate reports and grep artifacts. Pure logic moves to `tools/telltale/lib/`, and `telltale.js` becomes requirable without running. This closes v09's open file-split item.
- **Valid JSON under anonymization.** Values are scrubbed before serialization, never in the serialized text. Every written report is parsed back, and the write fails loudly if the parse fails.
- **Broader anonymization:** forward-slash paths, other drive letters, hostname, encoded username fragments (`C--Users-<name>`), and OneDrive organization folder names. Command-line scrubbing is an interim measure; the scope change stops persisting raw command lines.
- **Loud readers.** Pack, trend and both renderers name each unreadable file and its parse error. Pack never reports "no trace" or $0 because a file was unreadable.
- **BREAKING:** the schema moves to `telltale-json/2` and `SCHEMA-CHANGELOG.md` gets a v2 section. Readers handle v1 as described in OQ-14.
- **Incremental, crash-safe persistence.** Each sample, probe and hang is appended to a stream as it happens, and the summary is written at the end. Interrupted runs stay parseable and are marked `unfinished`, and a `recover` path summarizes them.
- **Real timebase.** Each sample carries the wall-clock time of its measurement. Rates and shares (hang rate, % frozen, seconds over threshold, MTTR, cost inputs) use the observed window, and the nominal window is recorded next to it. Hang context windows are ±10 s of wall-clock time.
- **Null, not zero.** Missing peaks, averages and minimums are null with a reason. They are never 0 or Infinity.
- **Self-exclusion.** The tool's own process tree is excluded from culprits, rollups and top lists, and its cost is reported separately.
- **Event-log windowing.** Hang, crash and resource-exhaustion records are limited to the run window. Resource-exhaustion records are filtered to their source provider, and older records are labelled history. Zero matches is recorded as "none in window", not as a timeout. WER counts carry their searched window.
- **Effective settings with source.** Every setting that affects evidence (duration, interval, anonymize, scope, thresholds) is recorded with its source: flag, config or default. Any clamp is printed and recorded, and a requested duration is never silently clamped.
- **Recompute uses recorded thresholds.** Pack's discriminator uses the trace's recorded thresholds rather than current CLI values. Pack's window arithmetic is fixed.
- **Watch duration is wall-clock.** The watch JSONL is renamed "watch log" so the word "baseline" is free for the scope change's inventory.
- **Small honesty fixes:**
  - The scope receipt says "not recorded" instead of "never collected".
  - The print view says "unknown" instead of "Battery" when AC state is unknown.
  - The duplicate verdict line is removed.
- **Synthetic sample.** The shipped sample report is regenerated from a deterministic synthetic fixture.

## Capabilities

### New Capabilities
- `evidence-persistence`: how evidence is serialized, anonymized, versioned, persisted incrementally, and read back, so that every artifact parses and no reader fails silently.

### Modified Capabilities
- `metrics`: hang threshold/rate, frozen share/MTTR, hang context windows, and self-load accounting are redefined on the observed wall-clock window, with self-exclusion. Three requirements are added: wall-clock timebase, observed-window rates, and null-with-reason.
- `tracking`: watch duration is wall-clock and the output is renamed "watch log"; trace persists incrementally and is never silently clamped; WER counts are windowed. Added requirement: OS event records windowed to the run.
- `evidence-surface`: observation timestamps are measurement times, recompute uses recorded thresholds, and JSON parses after anonymization while views never invent values.

## Impact

- Code: `tools/telltale/telltale.js` (serialization, trace and watch loops, summary math, event queries, pack), new `tools/telltale/lib/{serialize,anonymize,timebase,persist,events,settings}.js`, `trend.js`, `render-print.js`, and `render-charts.js` (reader and power-line wording only).
- Docs: `tools/telltale/SCHEMA-CHANGELOG.md` (v2), README (watch log name, `recover`).
- Artifacts: `reports/sample-telltale.{json,md,html}` regenerated from the fixture. New `reports/telltale-<stamp>.jsonl` stream files.
- Consumers: v1 reports remain readable by `trend` but are labelled pre-fix. `pack` and the renderers require v2.
- Tests: new `tools/telltale/test/**`.

## Findings addressed

- R01-P1-3j: interim report wording changes to "not recorded / not persisted". Enforcement is in software-inventory-and-scope.
- R01-P1-6: duration clamps are printed and recorded rather than silent. Long capture lands in sampling-engine-and-provenance, and workload sessions in workload-session-and-containers.
- R01-P2-5: requirement "Effective settings recorded with their source".
- R02-P0-1: requirements "Reports are valid JSON after anonymization" and "Unreadable reports are reported, never skipped".
- R02-P0-6: requirements "Run evidence persists incrementally" and "Interrupted runs are marked unfinished".
- R02-P0-7: requirements "Every sample carries its measurement wall-clock time" and "Rates and shares use the observed window".
- R02-P1-2: requirement "OS event records windowed to the run".
- R02-P1-5: MODIFIED "Self-load accounting excluded from verdict" adds self-exclusion.
- R02-P1-9: no silent clamp, and the clamp is recorded. The cap itself is raised in sampling-engine-and-provenance.
- R02-P1-11: interim anonymization of extra path shapes in command-line text. Raw command lines stop being persisted in software-inventory-and-scope.
- R02-P1-14: schema bumped to v2 with a changelog. The per-value provenance contract is in sampling-engine-and-provenance.
- R02-P2-3: requirement "Absent data is null with a reason".
- R02-P2-6: watch duration measured in wall-clock time.
- R02-P2-8: WER counts carry their searched window, and in-run counts are separated from history.
- R02-REC-1: value-level scrubbing, parse-back self-check, and loud readers.
- R02-REC-3: append-only stream plus an unfinished marker.
- R02-REC-4: measurement wall-clock times and observed-window rates. Unobserved intervals and non-blocked marks are in sampling-engine-and-provenance.
- R02-REC-5: the self-exclusion part only. The sampler split is in sampling-engine-and-provenance.
- R02-REC-8: the windowed-events part only.
- R02-REC-9: the schema-bump part only.
- R03-P0-1: valid anonymized JSON, and renderers and trend report unreadable files.
- R03-P0-5: the print view's "unknown" AC state part only. Cost and canned text are in diagnosis-engine-rebuild, and legacy HTML in report-and-visualization.
- R03-P2-3: zero events are recorded as "none in window".
- R03-P2-4: duplicate verdict line removed.
- R03-P2-5: pack window derived from observed probe times.
- R03-L3-6: pack recompute uses recorded thresholds.
- R03-REM-6: events are windowed and provider-filtered, and history is labelled. Gating of inference is in diagnosis-engine-rebuild.
- R03-REC-1: object-level anonymization, regenerated synthetic sample, and parse self-check.
- R03-REC-4: event windowing and resource-exhaustion provider filter.
- R03-REC-5: the unknown-to-"Battery" fix only.
- v09-split: `lib/` module seams and the `require.main` guard close the v09 file-split open item.
