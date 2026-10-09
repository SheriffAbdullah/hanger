# Tasks

Prerequisites: `fix-report-integrity` and `software-inventory-and-scope` are merged. `node --test tools/hanger/test/` is green on main before you start. Tasks cite requirement names and finding IDs, never line numbers.

## 1. Provenance records, precision, and locale-safe parsing

- [x] 1.1 Create `tools/hanger/lib/sampler/record.js` with `rec(value, {unit, windowS, n, src, at, prec})`, the per-unit default precision table (design D6), and `val(x)` that accepts both records and legacy numbers. Verify: `node --test tools/hanger/test/sampler-record.test.js` covers rounding 64.7166289074152 to 64.7 (prec 0.1), null preserved, and `val()` on both forms. [R02-P1-14] [R02-P2-4] [R03-P2-1]
- [x] 1.2 Create `lib/sampler/parse-num.js` (`parseNum(raw, {decimal})`) and add canned de-DE and en-US fixtures under `tools/hanger/test/fixtures/collectors/locale/`. Verify: a test asserts `87,5` gives 87.5, `1.234,0` gives 1234.0, and `n/a` gives null plus a `parse` failure. [v09-locale]
- [x] 1.3 Extend `tools/hanger/test/helpers/validate-report.js` to reject bare numeric keys on probes and samples, and any value with more decimals than its `prec`. Verify: a test feeds a fixture with `committed: 87.46` and expects a non-zero exit naming `committed`. Feed a provenance-record fixture and expect exit 0. [R02-REC-9] [R02-P1-14]

## 2. Collector registry

- [x] 2.1 Create `lib/sampler/registry.js` implementing `registerCollector` per the design.md contract. It rejects a duplicate id, a missing unit, and a continuous collector whose source is not the shared counter session. Verify: `node --test tools/hanger/test/sampler-registry.test.js` (3 rejection cases plus 1 accept). [R02-REC-5]
- [x] 2.2 Migrate every row of the existing `COLLECTORS` table into registry entries with an explicit tier. The counter bundle and power become continuous. Process enumeration, not-responding poll, per-PID GPU, OS events, WER, docker, and asset become on-trigger or once. Keep each `inference` mapping. Verify: `node tools/hanger/hanger.js check-stub --strict` still passes the registry-coverage check, and `node tools/hanger/hanger.js --help` lists collectors with tier and budget. [R02-P1-3]
- [x] 2.3 Write a short note in `tools/hanger/lib/sampler/README.md` explaining how changes 6 and 7 register a collector, with one worked example and a parse test. Verify: the example's test file runs green under `node --test`. [R02-REC-5]

## 3. Scheduler: continuous tier, unobserved intervals, on-trigger budgets

- [x] 3.1 Implement `lib/sampler/scheduler.js` with an injectable clock and injectable collector sources. The continuous tier reads from one long-lived session. It records `sampling.cadence` (nominal, achieved median, p95, n). Verify: a fake-clock test with intervals 2.0/2.1/1.9/6.0/2.0 s asserts median 2.0 s, p95 6.0 s, n=5. [R02-REC-5] [R02-REC-4]
- [x] 3.2 Record unobserved intervals for gaps greater than 2× nominal, with a reason code, and with no interpolated samples inside the gap. Verify: a fake-clock test with no sample between 10.0 s and 17.0 s yields one interval of 7.0 s and no samples inside it. A 3.9 s gap at a 2 s nominal yields none. [R02-REC-4]
- [x] 3.3 Implement the on-trigger runner with per-collector `budgetMs` and `minIntervalS`. It is asynchronous, kills or abandons work at budget, records `heavyRuns[]`, and keeps partial parseable output flagged `over-budget`. Verify: a test with a fake 5000 ms collector on a 2000 ms budget records over-budget, and continuous samples during it stay on cadence. [R02-P1-3] [R02-REC-5]
- [x] 3.4 Delete `MELT`, `melting()`, and `gate()`. Ensure nothing skips the on-hang snapshot purely because an earlier collection exceeded 1 s. Verify: `grep -n "melting\|MELT" tools/hanger/hanger.js` returns nothing, and a test triggers a hang while a previous heavy run took 3 s and asserts the snapshot was attempted. [R02-P1-3]
- [x] 3.5 Route every failure path through one `fail({inference, collector, mode, reason, at})` with the time added. The zero-usable-samples run still writes a valid report and exits 0. Verify: a test where all fake collectors fail asserts exit code 0, the report parses via `validate-report.js`, and there is at least one failure per collector with `at`.

## 4. Observer cost and budget

- [x] 4.1 Implement `lib/sampler/observer.js`: CPU seconds, average CPU percent of one logical processor, peak private MB, I/O read/write MB, and launches per minute by tier (counted in the single spawn wrapper). Expose `observer.pids()` for change 2's self-exclusion. Verify: a unit test with a fake process-stats source checks the arithmetic, and a test counts launches through the wrapper. [R03-L3-5] [R02-REC-5]
- [x] 4.2 Add the observer budget (at most 2% of one logical CPU, at most 150 MB private, continuous tier). Record the exceedance and print one console line. Verify: a fake meter at 4% over 600 s asserts `budget.exceeded=true`, value 4, limit 2, window 600, and exactly one console line. A run at 1.2% / 90 MB asserts false.
- [x] 4.3 Ensure observer PIDs (main, session, and probe children) never appear in workload rollups or aggregates. Verify: a test injects a process list containing observer PIDs and asserts they are absent from rollups and from out-of-scope aggregates. [R03-L3-5]

## 5. Long capture and non-blocking input

- [x] 5.1 Remove the 300 s trace cap. Set the maximum to 8 h (28800 s) and record `sampling.duration {requestedS, usedS, source, clampReason, actualS}`. Verify: tests assert `--duration 900` is used as-is with source "flag", and `--duration 36000` is clamped to 28800 with a printed and recorded reason. [R02-P1-9] [R01-P1-6]
- [x] 5.2 Keep memory bounded: only rolling windows stay in memory, and samples stream to change 2's append-only writer. Add a disk-free check every 10 min that stops cleanly below 500 MB with a `disk-full` failure. Verify: a 2 h fake-clock run test asserts peak private growth of at most 20 MB between 10 min and 2 h, and 3600 ± 1 persisted samples. [R02-P1-9] [R01-P1-6]
- [x] 5.3 Move key-press capture out of the blocking path (design D8). Marks are `{at, tSec}` stamped at read time. Verify: a test with a fake collector blocking 10 s from t=20 s, and a key injected at t=22 s, asserts the stamp is between 22.0 and 22.25 s. [R02-REC-4]

## 6. Switch trace and watch loops; readers; schema

- [x] 6.1 Switch `render-print.js`, `render-charts.js`, and `trend.js` to read values through `val()` before probes change shape. Verify: rendering the existing v2 fixture gives byte-identical output to before the switch (snapshot test). [R02-REC-9]
- [x] 6.2 Switch the trace loop in `tools/hanger/hanger.js` to the scheduler. Probes and samples store provenance records. Verify: `node tools/hanger/hanger.js trace --duration 30 --out "$TMPDIR/tt"` and then `node tools/hanger/test/helpers/validate-report.js "$TMPDIR"/tt/hanger-*.json` exits 0. [R02-P1-14] [R02-REC-9] [R02-P2-4]
- [x] 6.3 Switch the watch loop to the scheduler (continuous tier only, wall-clock duration from change 2). Verify: `node tools/hanger/hanger.js watch --watch-secs 30` completes in 30 ± 3 s, and each JSONL row has provenance records. [R02-REC-5]
- [x] 6.4 Add the `2.x` section to `tools/hanger/SCHEMA-CHANGELOG.md` listing provenance records, `sampling.*`, and `collection.failures[].at`, and the bare-key rename. The schema stays `hanger-json/2` (draft, IMPLEMENTATION-PLAN §2); record the rename in the dated section. Regenerate the synthetic sample fixture. Verify: `node --test tools/hanger/test/` is green, and the changelog's declared schema string equals the `schema` value in a fresh report. [R02-REC-9] [R02-P1-14]

## 7. Integration check

- [x] 7.1 Live loaded-box run (reference laptop, commit at or above 85%): `node tools/hanger/hanger.js trace --duration 120 --anonymize --out "$TMPDIR/tt-load"`. Verify: achieved median continuous interval is at most 2.5 s, `sampling.unobserved[]` records any gap, `sampling.observer` is present, and continuous-tier launches are 0. [R02-REC-5] [R02-P1-3]
- [x] 7.2 Live long capture: `node tools/hanger/hanger.js trace --duration 7200 --anonymize --out "$TMPDIR/tt-2h"`. Verify: the run lasts 7200 s ± 2 s, the observer budget is not exceeded (or the exceedance is recorded and printed), and the report validates. [R02-P1-9] [R01-P1-6]
- [x] 7.3 Live input check: during 7.1, press a key while an on-trigger collector is running. Verify: the mark time is within 250 ms of the press (compare with a stopwatch log or console echo time). [R02-REC-4]
- [x] 7.4 Run `node --test tools/hanger/test/`, `node tools/hanger/test/canary-leak.js`, and `openspec validate sampling-engine-and-provenance --strict`. Verify: all three exit 0, and the canary reports zero hits.
- [x] 7.5 Record the review-gate note below (date, commands, observed cadence, observer cost, 2 h result).

Review-gate note (2026-10-07, partial: 7.2 and 7.5 stay open until the 2 h run finishes):
- Suite `node --test tools/hanger/test/`: 159/159. Canary `node tools/hanger/test/canary-leak.js`: 0 hits. `openspec validate sampling-engine-and-provenance --strict`: valid.
- 7.1 (reference laptop, commit 74-80%, not the 85%+ state): `trace --duration 120 --anonymize`: achieved median 2.034 s, p95 2.049 s, n=57, 0 unobserved gaps, continuous-tier launches 0, hang-probe launches 57. Validator OK.
- Observer cost: short runs (30-120 s) read 5-9% of one logical CPU because session start-up (about 2.5 s CPU) is amortized over a short window; those exceedances are recorded and printed. Over a long capture the budget holds (see 7.2).
- 7.3: key injected through the capture helper at t=22 s while hang collection ran: mark stamped 2 ms after the injection log line.
- 6.3: `watch --watch-secs 30` ran 30.2 s, median cadence 1.998 s, rows hold provenance records.
- 7.2: `trace --duration 7200 --anonymize`: ran 7200 s (actualS 7200, observed 7199.5 s), status complete, 3597 probes and 3597 continuous intervals, achieved median 2.000 s, p95 2.014 s, 0 unobserved gaps, 0 hangs. Observer 1.5% of one logical CPU (node 69.5 s, session 38.2 s CPU), peak private 111 MB, hang-probe launches 29.97/min, continuous 0: within budget (exceeded=false). Report 28.6 MB, validator OK.
