# Tasks

Conventions: run all commands from the repo root in Git Bash. `TT="$TMPDIR/tt"` is a scratch output directory, so pass `--out "$TT"` on every live run so `reports/` stays clean. Each task cites requirement names and finding IDs, never source line numbers.

## 1. Test harness and module seams

- [x] 1.1 Guard the CLI entry point so `require('./tools/telltale/telltale.js')` does not run `main()`. Verify: `node -e "require('./tools/telltale/telltale.js'); console.log('ok')"` prints `ok` and starts no trace. [v09-split]
- [x] 1.2 Create `tools/telltale/lib/` and move the pure helpers (number parsing, percentiles, tasklist parsing/rollup, anonymize) there **verbatim**, re-exported to `telltale.js`. Behavior does not change. Verify: `node tools/telltale/telltale.js --help` output is byte-identical to before (diff saved output). [v09-split]
- [x] 1.3 Create the zero-dependency harness `tools/telltale/test/` with one smoke test that requires every `lib/*.js`. Verify: `node --test tools/telltale/test/` exits 0. [v09-split]
- [x] 1.4 Add `tools/telltale/test/fixtures/build-fixtures.js`, which deterministically writes three synthetic v2 traces:
  - `sample-r03.json`: 5 probes, 0 hangs, commit 52-65%, first probe bundle 8849 ms.
  - `battery-1308.json`: 60 s, on battery, commit peak 92%, 5 stalls, node group growing 4.8→6.2 GB.
  - `loaded-78s.json`: 40 samples requested at 0.5 s, measured times spanning 78 s.

  Verify: running it twice gives identical SHA-256 hashes for each file (`sha256sum`). [R03-REC-1]
- [x] 1.5 Add `tools/telltale/test/helpers/validate-report.js <file>`. It parses the file, requires `schema`, `run`, `window`, `settings` and `summary`, and rejects `NaN`, `Infinity` and the string `"Infinity"` anywhere. It exits 0 or 1 with the reasons. Verify: exits 0 on each fixture and 1 on a hand-made file containing `{"a": Infinity}`. [R02-REC-1]
- [x] 1.6 Add `tools/telltale/test/helpers/grep-artifacts.js <dir> <needle...>`, which reports every file and line containing any needle (case-insensitive) and exits 1 on any hit. Verify: a unit test in `test/helpers.test.js` covers both a hit and a no-hit case.

## 2. Valid JSON and anonymization (evidence-persistence)

- [x] 2.1 Implement value-level anonymization in `lib/anonymize.js`. It walks objects and arrays (string values and path-like keys) and covers:
  - backslash and forward-slash profile paths on any drive;
  - `/home/<name>`;
  - `C--Users-<name>` fragments;
  - `OneDrive - <Org>` folder names;
  - the hostname and the username.

  Requirement "Anonymization covers every path and identity shape". Verify: `node --test tools/telltale/test/anonymize.test.js` (cases from the requirement's scenario, plus a check that the output parses). [R02-P0-1] [R02-P1-11] [R03-REC-1]
- [x] 2.2 Replace text-level `anon()` on serialized JSON with scrub-then-stringify. Apply the same scrubber to the MD, HTML and console strings. Verify: `node tools/telltale/telltale.js trace --duration 20 --anonymize --out "$TT"` and then `node tools/telltale/test/helpers/validate-report.js "$TT"/telltale-*.json` exits 0. Also, `node tools/telltale/test/helpers/grep-artifacts.js "$TT" "$USERNAME" "$(hostname)"` exits 0. [R02-P0-1] [R03-P0-1] [R03-REC-1]
- [x] 2.3 Add `lib/serialize.js` `writeJsonChecked`, which writes the file, reads it back and parses it. On failure it writes `<base>.json.invalid`, prints the file name and the error, exits non-zero, and skips the views. Requirement "Reports are valid JSON after anonymization". Verify: `node --test tools/telltale/test/serialize.test.js` uses an injected bad serializer and asserts exit code, message, and that no `.md` is produced. [R02-REC-1] [R03-REC-1]

## 3. Loud readers and schema v2

- [x] 3.1 Make every reader (pack's latest-trace finder, `trend.js`, `render-print.js`, `render-charts.js`) report unreadable files by name with the parse error. Pack must never say "no trace report found" or show $0 cost because a file failed to parse. Requirement "Unreadable reports are reported, never skipped". Verify: `node --test tools/telltale/test/readers.test.js` copies an invalid file and a valid fixture into a temp dir, runs `pack` and `trend` with `--out <tmp>`, and asserts the invalid file name appears in the output. [R02-P0-1] [R03-P0-1] [R02-REC-1]
- [x] 3.2 Set `schema: 'telltale-json/2'` and add `run`, `window`, `settings`, `observer`, `events.window/inWindow/history`, `wer.searchedWindow/inRun/history` as in design.md. Write a v2 section in `tools/telltale/SCHEMA-CHANGELOG.md` listing every added, renamed and moved field. Verify: `validate-report.js` passes on a fresh trace, and `grep -n "telltale-json/2" tools/telltale/SCHEMA-CHANGELOG.md` finds a match. [R02-P1-14] [R02-REC-9]
- [x] 3.3 Reader version handling per OQ-14:
  - `trend` shows v1 rows labelled "v1 (pre-fix; rates may be overstated)" and reports unknown versions as unreadable;
  - `pack` and the renderers refuse v1 with a re-capture message.

  Verify: `node --test tools/telltale/test/schema-version.test.js` uses fixtures with `/1` and `/9`. [R02-P1-14]

## 4. Incremental persistence and recovery

- [x] 4.1 Add `lib/persist.js`, an append-only JSONL stream (`telltale-<stamp>.jsonl`) flushed per record. Record types: run-start (with settings), sample, probe, hang, mark, failure, run-end. Wire it into the trace loop so every record is appended when it is measured. Requirement "Run evidence persists incrementally". Verify: start `node tools/telltale/telltale.js trace --duration 60 --out "$TT" &`, wait 20 s, then check that every line of `"$TT"/telltale-*.jsonl` parses (`node -e` loop) and that at least one `probe` record exists. [R02-P0-6] [R02-REC-3]
- [x] 4.2 Handle SIGINT, SIGHUP, SIGBREAK and uncaughtException: append `run-end{status:'interrupted'}` and write a best-effort summary with `run.status: 'interrupted'`. Verify: run a 120 s trace, send Ctrl+C after about 30 s, then check that `validate-report.js` passes on the summary, `run.status` is `interrupted`, and `window.observedS` is between 25 and 40. [R02-P0-6] [R02-REC-3]
- [x] 4.3 Add a `recover <stream.jsonl>` mode that builds a summary report with `run.status: 'unfinished'` from a stream that has no run-end record. Requirement "Interrupted runs are marked unfinished". Verify: `node --test tools/telltale/test/recover.test.js` truncates a fixture stream, recovers it, and asserts the status and that probe counts are equal. [R02-P0-6] [R02-REC-3]
- [x] 4.4 Document the stream file and `recover` in `README.md` and `--help`. Verify: `node tools/telltale/telltale.js --help | grep -c recover` is at least 1.

## 5. Timebase and observed-window rates (metrics)

- [x] 5.1 Give every RAM sample and probe its measured wall-clock `at`, with `tSec` computed from `at` minus run start (never `index*INTERVAL`). Requirement "Every sample carries its measurement wall-clock time". Verify: `node --test tools/telltale/test/timebase.test.js` uses the `loaded-78s` fixture inputs, and the last sample has `tSec ≈ 78`. [R02-P0-7] [R02-REC-4]
- [x] 5.2 Add `window {nominalS, observedS, probesExpected, probesObserved, samplesExpected, samplesObserved}`. Compute hang rate, % frozen (full and excess), seconds over the RAM threshold, MTTR and cost-v2 inputs over `observedS`, and set `summary.windowBasis: 'observed'`. Requirements "Rates and shares use the observed window", "Hang events with explicit threshold parameter", and "Frozen share, MTTR, and user ground truth". Verify: the timebase test asserts that 1 hang over observed 78 s gives a rate of 0.77/min ±0.01, and that 6000 ms of hangs gives ≈7.7% frozen. [R02-P0-7] [R02-REC-4]
- [x] 5.3 Build hang context windows from measured times (±10 s wall-clock). Requirement "Hang context windows and lagged correlation". Verify: a timebase test case asserts that every context sample lies within 30-50 s for a hang at 40 s. [R02-P0-7]
- [x] 5.4 Replace every 0/Infinity default for missing data (min-free, disk latency/queue peaks, pages average, empty percentiles) with `null` plus an entry in `summary.nulls`. Requirement "Absent data is null with a reason". Verify: `node --test tools/telltale/test/nulls.test.js` (no-disk and no-samples cases), plus `validate-report.js` on both outputs. [R02-P2-3]

## 6. Self-exclusion (metrics)

- [x] 6.1 Record the tool's own PID and every child PID it spawns. Drop them from culprits, rollups, `topProcesses`, `privateTop`, at-hang culprit lists and GPU maps, and report their summed working set as `observer`. Requirement "Self-load accounting excluded from verdict". Verify: `node --test tools/telltale/test/self-exclusion.test.js` (a canned tasklist containing the tool's PID gives no row with that PID), and on a live trace `grep -c "telltale.js" "$TT"/telltale-*.json` returns 0 matches inside `culprits`. [R02-P1-5] [R02-REC-5]

## 7. Event and WER windowing (tracking)

- [x] 7.1 Window the application-hang, application-crash and resource-exhaustion queries to run start minus a 60 s lead through run end, recording `events.window`. Filter resource-exhaustion records to the OS detector provider. Keep older records only as `history {count, newest}`, never as summary reasons. Requirement "OS event records windowed to the run". Verify: `node --test tools/telltale/test/events.test.js` parses canned outputs (an old event, a wrong provider, an empty result). On a live run, `summary` reasons contain no "OS hang events" when `events.inWindow.appHang` is empty. [R02-P1-2] [R03-REC-4] [R03-REM-6] [R02-REC-8]
- [x] 7.2 Record an empty event result as `mode: 'none-in-window'` and stop recording it as a `timeout` failure. Verify: events test asserts there is no `collection.failures` entry with `mode:'timeout'` for an empty result. [R03-P2-3] [R02-P1-2]
- [x] 7.3 Split WER counts into `inRun` (archive entries written during the run) and `history` (all-time), each with its searched window. Requirement "WER AppHang history counts". Verify: `node --test tools/telltale/test/wer.test.js` on canned listings with known dates. [R02-P2-8]

## 8. Watch, duration, and effective settings

- [x] 8.1 Make `watch --watch-secs N` a wall-clock bound, and record the achieved median cadence in the watch log. Rename "baseline" to "watch log" in code, help and README, and move the directory to `reports/watch/` while still reading `reports/baseline/` for one release. Requirement "Watch mode light continuous loop". Verify: `time node tools/telltale/telltale.js watch --watch-secs 10 --out "$TT"` shows real time ≤ 10 s plus one sample period, and the log has a cadence record. [R02-P2-6]
- [x] 8.2 Add `lib/settings.js`, which builds `settings` (duration, interval, anonymize, scope, every threshold) as `{value, source, requested?, clamped?}`. Print every clamp on the console. Requirement "Effective settings recorded with their source". Verify: `node --test tools/telltale/test/settings.test.js` (config interval 500 gives source `config`; `--duration 900` gives clamped 900→300 with reason), and a live run with `--duration 900 --out "$TT"` prints the clamp line (stop it with Ctrl+C after 20 s). [R01-P2-5] [R01-P1-6] [R02-P1-9]
- [x] 8.3 Ensure the trace mode never changes a requested duration silently, and that the report and console show requested vs effective values. Requirement "Trace mode deep bundles". Verify: covered by the 8.2 live run. Also check that `settings.duration` exists in the JSON. [R01-P1-6] [R02-P1-9]

## 9. Pack, views, and small honesty fixes

- [x] 9.1 Make pack's derived values (discriminator, cost inputs) use the thresholds recorded in the trace, and record them in the pack. Requirement "First-order data is never overwritten by second-order computation". Verify: `node --test tools/telltale/test/pack.test.js` (fixture recorded at commit 85, `pack --commit 50`, pack records 85). [R03-L3-6]
- [x] 9.2 Fix the pack window: derive `windowS` from the trace's `window.observedS`, not `granularityMs × probes`. Verify: the pack test asserts that `windowS` equals the fixture's `observedS`. [R03-P2-5]
- [x] 9.3 Make the print view power line three-way (AC / Battery / unknown). Requirement "JSON is truth, MD and HTML are views". Verify: `node --test tools/telltale/test/views.test.js` renders a fixture with `power.plugged: null` and asserts the output contains "unknown" and not "Battery (unplugged)". [R03-P0-5] [R03-REC-5]
- [x] 9.4 Remove the duplicate verdict assignment line. Verify: `grep -c "verdict = 'STATE: RAM-BOUND" tools/telltale/telltale.js` returns 1. [R03-P2-4]
- [x] 9.5 Interim honesty wording: the scope receipt in MD, JSON and console says "not recorded" or "not persisted" instead of "never collected", and the JSON adds `scope.recordingNote`. The full enforcement is in software-inventory-and-scope. Verify: `grep -rn "never collected" tools/telltale/` returns no matches. [R01-P1-3j]

## 10. Shipped sample

- [x] 10.1 Regenerate `reports/sample-telltale.json` from the fixture builder (OQ-16), and render `.md` and `.html` from it. Requirement "Shipped sample report is synthetic and valid". Verify: `node tools/telltale/test/helpers/validate-report.js reports/sample-telltale.json` exits 0. `grep-artifacts.js reports "$USERNAME" "$(hostname)"` restricted to the `sample-telltale.*` files finds no hits. [R03-REC-1]

## 11. Integration check

- [x] 11.1 Run the full unit suite. Verify: `node --test tools/telltale/test/` exits 0.
- [x] 11.2 Live anonymized trace on the reference laptop. Verify: `node tools/telltale/telltale.js trace --duration 30 --anonymize --print --out "$TT"`, then `validate-report.js` passes on the JSON, the `.print.html` exists, `grep-artifacts.js "$TT" "$USERNAME" "$(hostname)"` exits 0, and `window.observedS` ≥ 30. [R02-P0-1] [R03-P0-1] [R02-P0-7]
- [x] 11.3 Live interruption. Verify: a 120 s trace with Ctrl+C at about 30 s leaves an interrupted summary that `validate-report.js` passes, and the stream's lines all parse. [R02-P0-6]
- [x] 11.4 Live pack and trend against `"$TT"` with one deliberately corrupted copy. Verify: `node tools/telltale/telltale.js pack --out "$TT"` and `node tools/telltale/telltale.js trend --out "$TT"` both name the corrupted file, and pack shows a non-zero hang count when the valid trace has hangs. [R02-P0-1]
- [x] 11.5 Validate the change. Verify: `openspec validate fix-report-integrity --strict` passes with no "Archive would refuse" lines.
- [x] 11.6 Append a review-gate note below, as required by `openspec/config.yaml`: date, commands run (11.1-11.5), and observed results.

### Review-gate notes

Date: 2026-10-07. Environment: Windows 11, Node v24.21.0, unelevated, reference laptop (plugged in, no Docker, no GPU counters).

- 11.1 `node --test tools/telltale/test/` -> 45 tests, 45 pass, 0 fail. (Node 24 resolves a directory argument as a module, so `tools/telltale/test/index.js` loads every `*.test.js`; the command as written works.)
- 11.2 `trace --duration 30 --anonymize --print --out $TT` -> exit 0; `validate-report.js` OK; `.print.html` written; `grep-artifacts.js $TT "$USERNAME" "$(hostname)"` -> no hits; `window.observedS` = 59.85 (nominal 30: the loop really ran twice as long, and rates use 59.85). 2.2 earlier run: nominal 20 s, observed 43.65 s.
- 11.3 Interruption: a 120 s trace was interrupted at ~30 s by the same code path the signal handlers use (see deviations): stream lines all parse, last record `run-end{status:'interrupted'}`, summary `run.status: interrupted`, `window.observedS` 28.11, validate OK, exit code 130. A trace hard-killed (Stop-Process) at ~118 s left a parseable stream with no run-end; `recover` gave `run.status: unfinished`, 29 probes (equal to the stream), validate OK.
- 11.4 With the 30 s trace plus a corrupted `telltale-2099-01-01T00-00-00.json`: `pack` printed `UNREADABLE trace telltale-2099-...json: invalid JSON ...`, used the older valid trace, and did not say "no trace" or $0 for the bad file; `trend` listed the readable row and `SKIPPED telltale-2099-...json: invalid JSON`. Non-zero hang count from a trace with hangs is covered by `readers.test.js` (battery fixture, 5 hangs).
- 4.1 stream at ~22 s of a 120 s trace: 20 lines, all parse, 3 probe records. 4.4 `--help | grep -c recover` = 2. 8.1 `watch --watch-secs 10` took 10.8 s real, log ends with a `watch-end` record (cadence). 8.2/8.3 `--duration 900` printed "duration clamped from 900 to 300: ..." and the report has `settings.duration {value:300, requested:900, clamped:{...}}`.
- 9.4 `grep -c "verdict = 'STATE: RAM-BOUND"` = 1. 9.5 `grep -rn "never collected" tools/telltale/` -> no matches. 10.1 sample regenerated (battery fixture), validate OK, no host/user hits in `sample-telltale.*`.
- 11.5 `openspec validate fix-report-integrity --strict` -> "Change 'fix-report-integrity' is valid", no "Archive would refuse" lines.

Deviations and notes:
- Real Ctrl+C cannot be delivered to a background child on Windows, so live interruption was driven by the hidden env hook `TELLTALE_TEST_INTERRUPT_AFTER_S` (calls the same `interruptRun` the SIGINT/SIGHUP/SIGBREAK/uncaughtException handlers call). Raw-mode TTY Ctrl+C (byte 3) is routed to the same function but was not exercised interactively.
- Event queries are bounded to the last 90 days (`events.history.<kind>.horizonDays`). An unbounded query on an empty log took longer than the 20 s timeout, and PowerShell exits 1 when no events match, which is what produced the old "timeout" failure; the script now exits 0 and only real errors reach stderr.
- The tracking-spec scenario "WER history attached to HANG" (per-hang, per-executable counts) is not in tasks.md and was not implemented; WER counts are in `wer` and `summary.werArchive`.
- Legacy `summary.secsOver85` kept as an alias of `secsOverRamHigh`; `--charts`/`render-charts.js` only got reader fixes (unreadable/v1 handling, `tSec`, three-way power).
- `record` default duration (OQ-11 says 10 min) is unchanged; this change only makes clamping visible.
- `sh()` now spawns without cmd.exe (tokenized argv, falls back to shell on ENOENT) so child PIDs are known for self-exclusion; `detectTier()` runs inside `main()`, not at require time.
- Fixtures are committed under `test/fixtures/`; `fixtures.test.js` fails if they are stale.

## Workflow follow-up

- Archive after the review gate passes: `openspec archive fix-report-integrity`.
- Wave 2 changes (software-inventory-and-scope, system-profile-for-it) may then start from the merged main.
