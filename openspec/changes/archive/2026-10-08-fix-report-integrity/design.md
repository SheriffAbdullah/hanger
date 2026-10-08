# Design: fix-report-integrity

## Context

See proposal.md for the motivation. Today's state:
- `telltale.js` is a 1,669-line script that runs `main()` when required, so nothing can be unit-tested.
- `anon()` runs regex replacements on the serialized JSON text. A replacement such as `C:\Users\<user>` inserts an invalid `\U` escape.
- The trace JSON is written once, after an end phase that takes about 90 s.
- RAM samples carry `tSec=(i+1)*INTERVAL`, and summary rates divide by `DURATION`, which is nominal. Under load, a nominal 20 s ran 78 s of wall-clock time.
- Readers (`latestTraceReport`, `trend.js`) swallow parse errors.
- Event-log queries take the last 5 events with no start time.
- The repo has no test infrastructure and no dependencies, and must stay that way.

## Goals / Non-Goals

**Goals**
- Every artifact Telltale writes parses, whether or not it is anonymized, and a parse failure is loud.
- Evidence survives interruption.
- Every time in the report is a measured wall-clock time, and every rate uses the observed window.
- A zero-dependency test harness exists that later changes extend.

**Non-Goals**
- The sampler rewrite, unobserved-gap intervals, the longer-duration cap, and per-value provenance. These belong to sampling-engine-and-provenance.
- Scope enforcement and raw command-line removal. These belong to software-inventory-and-scope. This change only improves interim scrubbing and wording.
- Diagnosis changes. The verdict logic is untouched except for the duplicate line and the inputs it receives, which now use the observed window.
- Visual redesign of the views.

## Decisions

1. **Scrub values, not text.** Anonymization walks the report object and rewrites string values (and object keys that are paths) before `JSON.stringify`. The text views (MD, HTML, console) apply the same scrubber to the strings they build. *Alternative:* escape replacement strings inside the serialized JSON. Rejected because it is fragile: any future pattern can break escaping again.
2. **Parse-back self-check.** After writing, the file is read and parsed. On failure the tool writes `<base>.json.invalid`, prints the error with the file name, exits non-zero, and does not render views from it. *Alternative:* validate only in tests. Rejected because the bug shipped despite review.
3. **Append-only JSONL stream plus final summary.** During the run, records `{type: run-start|sample|probe|hang|mark|failure|run-end, ...}` are appended to `telltale-<stamp>.jsonl` and flushed per record. At the end, the summary JSON (`telltale-<stamp>.json`, schema v2) is assembled from the in-memory state, which is identical to the stream. A run without `run-end` is *unfinished*. `telltale recover <stream>` builds the summary JSON from the stream with `run.status: "unfinished"` and `run.endReason`. Signal handlers (SIGINT, SIGHUP, SIGBREAK, uncaughtException) write `run-end{status:"interrupted"}` and then attempt a best-effort summary. *Alternative:* periodic full rewrites of the JSON. Rejected because of O(n²) I/O and the risk of a torn write during a hang.
4. **Timebase.** Each sample records `at` (ISO wall-clock time taken immediately after measurement) and `tSec = (at − runStart)/1000`. `window.observedS` is the last measured time minus `runStart`; `window.nominalS` is the requested duration. All rates and shares divide by `observedS`. Nominal-derived values are kept only in `window` for comparison.
5. **Self-exclusion by PID set.** The tool records its own PID and every child PID it spawns (probes, shells, collector helpers) in a set. Culprit, rollup and top-process builders drop those PIDs and attribute their working set, CPU and count to `observer` instead. Name-based exclusion was rejected because it would also hide the user's own `node.exe` workloads.
6. **Event windowing.** Queries are bounded by the run start time (minus a 60 s lead, recorded) through the run end. Older records are fetched separately only as `history` (count plus newest timestamp) and never reach the verdict reasons. Resource-exhaustion records are filtered to their detector provider. "No events" is a distinct result: `mode: "none-in-window"`.
7. **Effective settings.** A single `settings` object is built once at startup: `{name: {value, source: "flag"|"config"|"default", requested?, clamped?: {from, to, reason}}}`. It is written to the report and echoed on the console when any value is clamped.
8. **Schema v2.** Bump to `telltale-json/2`. Readers branch on `schema`. `trend` reads v1 but labels those rows "v1 (pre-fix; rates may be overstated)" (OQ-14). `pack` and the renderers refuse v1 with a message.
9. **Synthetic sample.** `test/fixtures/build-fixtures.js` deterministically emits the fixtures and the shipped `reports/sample-telltale.json`. The MD and HTML are rendered from it (OQ-16).

## Data / schema shape (v2 additions and changes)

```
{
  schema: "telltale-json/2",
  run: { status: "complete"|"unfinished"|"interrupted", endReason?, startedAt, endedAt,
         stream: "telltale-<stamp>.jsonl" },
  window: { nominalS, observedS, probesExpected, probesObserved, samplesExpected, samplesObserved },
  settings: { duration:{value,source,requested?,clamped?}, interval:{...}, anonymize:{...},
              scope:{...}, thresholds:{hang:{value,source}, ...} },
  observer: { pids:[...count only when anonymized], wsMB, cpuPctAvg|null, note },
  samples: [{ at, tSec, freeGB, usedPct }],                // tSec measured
  spawnProbes: [{ at, tSec, ms, ... }],                    // tSec measured
  summary: { hangRatePerMin, pctFrozenFull, pctFrozenExcess, secsOverRamHigh, mttrMs,
             windowBasis: "observed", ... ,
             nulls: { field: reason } },                   // null-with-reason registry
  events: { window: { from, to, leadS }, inWindow: { appHang:[], appCrash:[], resourceExhaustion:[] },
            history: { appHang:{count,newest}, ... }, mode: "ok"|"none-in-window"|"timeout"|"denied" },
  wer: { searchedWindow: { from, to }|"all-time", inRun:{...}, history:{...} },
  scope: { ..., recordingNote: "out-of-scope processes were not recorded" }
}
```

Stream records (`.jsonl`): one JSON object per line with `type`, `at`, and the same fields as the corresponding array element.

## Non-binding implementation hints

- Module seams: `lib/anonymize.js` (`scrubValue(v, ctx)`, `scrubObject(o, ctx)`, patterns for `[A-Z]:\\Users\\<name>`, `[A-Z]:/Users/<name>`, `/home/<name>`, `C--Users-<name>`, `OneDrive - <Org>`, hostname, username from `os.userInfo()`), `lib/serialize.js` (`writeJsonChecked(path, obj)`), `lib/persist.js` (`openStream`, `append`, `close`, `recover`), `lib/timebase.js` (`observedWindow`, `ratePerMin`), `lib/events.js` (query-builder strings and the parser), `lib/settings.js`.
- Guard: wrap the bottom `main()` call in `if (require.main === module)`. Module-level argument parsing can stay, but the `lib/` functions must take arguments rather than read globals.
- Event queries: `Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1002; StartTime=$t0}`. Resource exhaustion: `ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector'`. "No events were found" on stderr means none-in-window.
- WER: filter `.wer` files by `LastWriteTime >= runStart` for `inRun`. Keep all-time counts under `history`.
- Watch: loop `while (Date.now() - t0 < watchSecs*1000)`.
- Self PIDs: collect from `child_process` return values. Add `process.pid` and the probe children.
- Flush: `fs.appendFileSync` per record is acceptable at a 2 s cadence.
- `render-print.js` power line: three-way `plugged === true ? 'AC' : plugged === false ? 'Battery' : 'unknown'`.

## Risks / Trade-offs

- [Value-walking anonymization misses strings in nested raw blobs such as docker text] → the scrubber walks every string value, and a test greps a fixture whose raw blobs contain usernames and hostnames.
- [Per-record `appendFileSync` adds I/O on a starved box] → records are small (<1 KB). Write latency is measured and recorded in `observer`. sampling-engine-and-provenance may batch writes.
- [Signal handlers do not run on power loss or hard reboot] → the stream is already on disk up to the last flushed record, and `recover` covers that case.
- [The v2 bump breaks external consumers] → the changelog documents the change, and `trend` keeps v1 support.
- [Moving logic into `lib/` risks behavior drift] → move code verbatim first, check with fixture tests, then change behavior in separate tasks.

## Migration

- Existing v1 reports in `reports/` are left untouched. `trend` labels them, and `pack` and the renderers refuse them with a clear message.
- The README documents `recover`, the `.jsonl` stream, and the rename from "baseline" to "watch log". The `reports/baseline/` directory is renamed `reports/watch/`; the reader also checks the old path for one release.
- Rollback: revert the commit. The v1 code path is not retained.

## Open Questions

- OQ-14 (read old v1 reports): default applied. `trend` reads v1 with a label, and `pack` and the renderers require v2.
- OQ-16 (shipped sample): default applied. The sample is synthetic and deterministic.
- OQ-11 (durations): this change keeps the current maximum but makes clamping visible. sampling-engine-and-provenance raises the maximum.
