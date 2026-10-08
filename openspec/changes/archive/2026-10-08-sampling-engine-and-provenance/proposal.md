# Proposal: sampling-engine-and-provenance

## Why

On the machines Telltale targets, the collector itself is the problem. Each 2 s probe launches a shell, a runtime process, and a full PowerShell session. On the reference loaded laptop (i7-1255U, 15.6 GB, commit 87-92%) a probe bundle took 2.5-14 s. The real cadence was about 5-8 s instead of 2 s. A "20 s" trace covered 78 s of wall time, and the event loop stalled for up to 14 s, so key-press marks were stamped late (R02 §1h). The "melting" gate trips whenever a bundle exceeds 1 s, which is below the bundle's own normal cost under load. As a result the calm path never runs (R02-P1-3). Trace length is capped at 300 s (R02-P1-9). Stored values carry no unit, window, n, or source (R02-P1-14), and some are kept with 15 decimals (R02-P2-4). The tool's own launches add page-ins that later read as memory thrash (R03-L3-5).

This change rebuilds sampling so that observation stays cheap and honest under load. It must land before the new signals (changes 6 and 7) and the diagnosis rebuild (change 8), because every one of them depends on trustworthy cadence, gap records, observer cost, and per-value provenance.

## What Changes

- **Continuous sampling tier.** Cheap, long-lived collection with no per-tick process launch other than the hang probe. The achieved median and p95 sampling interval are recorded for every run.
- **Unobserved intervals.** Any gap longer than 2× the nominal cadence is written as an explicit unobserved interval with start, end, and reason. Gaps are never interpolated.
- **On-trigger heavy tier.** Process enumeration, per-process GPU, and OS queries run only on a hang trigger or on a declared schedule. Each has a time budget. Skipped or over-budget work is recorded with its reason. **BREAKING:** the "melting" gate and its three-threshold heuristic are removed.
- **Observer cost.** The run measures the tool's own CPU time, peak private bytes, I/O bytes, and process launches per minute. Observer cost is reported separately, checked against a declared budget, and never counted as workload.
- **Long-duration capture.** Up to 8 hours (OQ-11). Memory stays bounded because samples go to incremental persistence (from change 2) rather than accumulating in memory. **BREAKING:** the 300 s trace cap is removed.
- **Non-blocking input capture.** Key-press marks are stamped within 250 ms of the press, even while heavy collection runs.
- **Collector failures as evidence.** The v07 cannot-observe behavior is back-filled as a requirement: every failure path records `{inference, collector, mode, reason, at}`.
- **Locale-independent parsing.** Collector output parses identically under de-DE and other locales. This closes v09's open "invariant-culture numbers" item.
- **Per-value provenance.** Every stored value carries `unit`, `windowS`, `n`, `source`, `measuredAt`, and `precision`. **BREAKING (schema 2.x additive section):** bare unitless keys such as `committed`, `pages`, `cpuQ`, `diskSec`, `defender`, and `maxFreq` are replaced by provenance records.
- **Stored precision.** Values are rounded at store time to the precision declared for their unit.
- **Collector registration interface.** A contract that lets changes 6 and 7 add collectors without editing the sampler core.

## Capabilities

### New Capabilities
- `sampling`: How Telltale schedules, budgets, and records its own observation. Covers the continuous vs on-trigger tiers, achieved cadence and unobserved gaps, observer cost and budget, long capture, non-blocking input capture, collector-failure evidence, locale-independent parsing, and stored precision.

### Modified Capabilities
- `evidence-surface`: "Number every metric" becomes a per-value provenance contract enforced in the stored JSON, not only in rendered views.

## Impact

- **Code:** new `tools/telltale/lib/sampler/` (scheduler, continuous session, trigger runner, observer meter, registry, provenance and precision helpers, locale-safe parser). The trace and watch loops in `tools/telltale/telltale.js` move onto the sampler. The `COLLECTORS` table and the `MELT`/`melting()`/`gate()` logic are replaced by the registry.
- **Schema:** additive `2.x` section in `tools/telltale/SCHEMA-CHANGELOG.md` covering provenance records, `sampling.cadence`, `sampling.unobserved[]`, `sampling.observer`, and `collection.failures[].at`. Probe-level bare keys are replaced, which the changelog records as a rename. The schema stays `telltale-json/2` because v2 is a draft until report-and-visualization freezes it (IMPLEMENTATION-PLAN §2).
- **Consumers:** `render-print.js`, `render-charts.js`, and `trend.js` read values through one accessor that understands provenance records. They keep reading v2 fields during the transition.
- **Dependencies:** none added (zero-dependency rule).
- **Depends on:** `fix-report-integrity` (wall-clock timebase, incremental persistence, test harness) and `software-inventory-and-scope` (scope resolver used by scope-aware collectors).
- **Unblocks:** `data-signals-completeness` and `workload-session-and-containers` (both register collectors), and `diagnosis-engine-rebuild` (uses unobserved intervals and observer cost).

## Findings addressed

- R01-P1-6: trace silently clamped to 300 s; long workload sessions need long, cheap capture.
- R02-P1-3: the melting gate makes the calm path dead code under load.
- R02-P1-9: trace capped at 300 s.
- R02-P1-14: the per-value unit/window/n/collector contract is not implemented.
- R02-P2-4: false precision (15-decimal values).
- R02-REC-4: unobserved intervals recorded; marks not blocked by collection.
- R02-REC-5: cheap continuous sampling split from heavy on-trigger work; observer measured; cap removed for the cheap tier.
- R02-REC-9: per-value contract implemented in the stored schema.
- R03-P2-1: unrounded numbers (fixed at store time; display rounding belongs to change 10).
- R03-L3-5: the tool's own spawns generate page-ins; observer launches are measured and reported per run.
- v09-locale: v09's open item "invariant-culture numbers".
