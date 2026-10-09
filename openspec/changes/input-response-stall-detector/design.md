# Design

## Context

See proposal.md (Why). Constraints inherited from earlier changes:
- The sampler (`lib/sampler/`) owns scheduling, budgets and observer cost (`observer.js`: 2% of one logical CPU, 150 MB private). New work registers beside it and never edits the scheduler core.
- Every stored number is a provenance record `{v, unit, windowS, n, src, at, prec}` (`record.js`).
- `lib/scope.js` is the only authority on what may reach disk, console or logs. `test/canary-leak.js` is the check.
- The diagnosis context (`lib/diagnosis/context.js`) already joins marks, OS not-responding and workload probes to hangs, and `confidence.js` derives confidence from recorded components, capped at 0.95.
- Schema `hanger-json/2` is `frozen`: additive fields are dated `2.x` changelog entries; removal or rename bumps to `/3`.
- Key capture today is `keycap.js` plus `keycap-child.js` (a Node child that stamps keys at read time, terminal focus only). Review 04 measured that a compiled helper polling at 4 Hz costs under 0.1% of one CPU and about 12 MB, and that Windows PowerShell 5.1 can compile C# in-box. It did not measure sensitivity on a real freeze.

## Goals / Non-Goals

**Goals**
- An automatic, no-action detector of "user interacted, the foreground application did not answer in time".
- A helper wake-lateness self-signal.
- Numbers that show whether the spawn-probe hang definition matches felt stalls.
- A new diagnosis confirmation source and corroboration counts, overlays, an evidence subsection and an email line.
- Provable privacy: no content, no out-of-scope identity.
- A helper boundary that the later global shortcut can reuse.

**Non-Goals**
- The global shortcut, tray, click target, retro marks, or any user-triggered mark (`global-hang-marking`).
- A new cause rule that uses stall or lateness data.
- Detecting waits inside an application whose interface keeps answering (the report says so).
- Admin-tier kernel input-delay tracing.
- Cross-platform support (Windows only, like all collectors).
- Changing the spawn probe or the 800 ms hang threshold.

## Decisions

### 1. Schema: additive `2.x` under the freeze, no bump to `/3`

Everything this change adds is an optional root key or a widened enumeration: `inputStall`, `settings.inputStall`, `diagnosis.probeAgreement`, `diagnosis.inputStallCorroboration`, per-hang `helperLate`, and the label `input-stall` in `confirmedBy[]` and `diagnosis.finding.confirmations`. Nothing is renamed or removed. The freeze policy in `SCHEMA-CHANGELOG.md` says an additive field is a `2.x` entry and only a removal or rename bumps to `/3`.
- *Why not `/3`:* a bump would make `pack`, `trend` and every stored report unreadable by the new tool for no benefit; readers branch on the declared version.
- *Why not keep the detector out of the JSON (sidecar only):* the evidence rule is "JSON is truth, MD and HTML are views". The report must carry the episodes and the agreement numbers.
- *The risk in a widened enumeration* is a consumer that rejects an unknown label. Mitigation, and a task: renderers already fall back to showing the raw label (`render/sections.js`); `validate-report.js` is updated; a test renders a report containing `input-stall` through `pack`, `trend` and each renderer. Absence of the key means "predates the detector" and every reader shows a placeholder.
- Add a dated `2.x` section to `SCHEMA-CHANGELOG.md` (task 12).

### 2. Process model and the helper boundary

One long-lived helper process per run, separate from the main process and from `keycap-child`. Three duties, kept in separate modules so the later shortcut can add a fourth:
1. **clock**: reads a monotonic clock and the wall clock together and keeps an anchor, so any later conversion is checkable. Used by every duty.
2. **probe loop**: the periodic wake (default every 250 ms) that checks recent input, asks the foreground application for liveness, classifies the moment, and records lateness of its own wake.
3. **writer**: appends one JSON object per line to the helper file, flushed per line. It is the only writer.
- Control channel: the main process writes small commands to the helper's stdin (scope match list, settings, shutdown). The helper's stdin closing means "main process is gone": it writes a final summary record and exits. The helper's stdout is advisory (a live console line); the helper file is the evidence.
- Message vocabulary is namespaced `input-*` (`input-helper`, `input-stall-sample`, `input-late`, `input-skip`, `input-window`, `input-end`). `global-hang-marking` will add a hotkey duty in the same process and a `mark` record type in the same file, reusing the clock and writer. Nothing in this change should assume the helper only ever does stall detection: the writer takes any record, and the bridge dispatches by `type`.
- The helper never reads from or writes to the main process's stream file. The run stream gets only one `input-helper` record at start (status, how built, helper file name) so `recover` knows what to merge.

### 3. Where scope is decided

The helper must classify the foreground application itself, because the main process may be stalled or dead and the helper file must be safe by itself. At start (and when the scope changes) the main process sends the helper the resolver's match data: in-scope executable names and patterns, the system set, and the currently pinned descendant process ids. The helper reads the foreground executable name in memory, compares it, and writes only `{kind: in-scope|system|out-of-scope|unknown, group}`. It never writes the process id or a name for out-of-scope, and never reads a window title.
- The classifier shares code with `lib/scope.js` (a pure `classifyName(matchData, name)` extracted or re-exported, tested against the resolver's contract tests) so the semantics do not drift. If descendants cannot be checked at a moment, the result is out-of-scope or unknown (narrower), and a fallback is recorded.
- *Alternative:* helper sends a process id to the parent over the pipe and the parent resolves it. Rejected: the parent may be stalled, so the sidecar would carry no classification, and unresolved ids would be on disk.

### 4. Detection algorithm (behavior, not API)

Each tick (default 250 ms):
1. Record this wake's lateness (actual minus scheduled, monotonic). Update lateness summary and late periods.
2. Determine whether the session is judgeable (locked, secure desktop, remote session, suspended-and-resumed within 5 s, no foreground window). If not, extend or open a not-evaluable span with that reason and stop.
3. Read the time of the last input (one value for keyboard, mouse and touch). If older than the recent-input window, count the tick as idle and stop. Otherwise count it as an input-recent evaluated moment.
4. Ask the foreground application for liveness with a timeout (default 1000 ms). If it cannot be asked (higher privilege), open a not-evaluable span `elevated-foreground`. If the foreground window changed during the request, drop and count `foreground-changed`.
5. Measure the round trip on the monotonic clock. If helper lateness at this tick exceeded the late threshold, tag `helper-late`. If the latency is at or above the stall threshold (or timed out), write a stall sample. Always add the latency to the 10 s window statistics.
6. Every 10 s write an `input-window` record: evaluated ticks, idle ticks, input-recent ticks, stall samples, latency median/p95/max, lateness median/p95/max, and a per-group count of evaluated measurements and over-threshold measurements. This is the denominator for the baseline and the chronic-slow check, and keeps the helper file small (an 8 h run is about 2900 window records plus stall samples).

The stall sample, the not-evaluable span and the late period are the only per-event records. No record is written per calm tick.

The main process (or `recover`) turns these records into the report with pure functions (suggested `lib/input/episodes.js`): merge samples into episodes (debounce: two consecutive samples, or one at or above twice the threshold; otherwise a blip), close episodes at not-evaluable spans, compute the baseline from the window records, flag chronic-slow groups, flag noisy detector, apply `ignoreGroups`, compute episode confidence, and compute `evaluable` seconds.

### 5. Episode confidence (derived, recorded, never constant)

Components, each in [0,1]: S severity = clamp((worst − threshold) / (3 × threshold)); L length = clamp(samples / 5); X corroboration = independent sources (probe hang, OS not-responding, user mark, workload probe) ÷ 4; N noisy-baseline penalty (0.15 when the detector is flagged noisy); G guard penalty (0.1 per flag among `helper-late`, `chronic-slow-app`, `foreground-changed-near`, at most 0.3).
`conf = min(0.95, (0.4 S + 0.2 L + 0.4 X) × (1 − N − G))`. Weights and components are stored with each episode. These weights are provisional and belong to the formula, like `confidence.js`. A fresh episode with no corroboration has a low but non-zero confidence by design: the detector alone is weak evidence and the report should look that way.
- Note the dependence: X uses the probe hang, which the agreement metrics also use. Agreement metrics use only overlap, not confidence, so there is no circularity in the numbers shown.

### 6. Confirmation weight

`input-stall` is an instrument, not a person. The diagnosis `K` component currently counts a hang as confirmed or not. This change records a weight per source (default: `user-mark` 1.0, `os-not-responding` 1.0, `workload-probe` 1.0, `input-stall` 0.5 when it is the only source) and uses the highest weight among a hang's sources. The weights are in the confidence components. Owner decision OQ-3.

### 7. Out-of-scope foreground

An episode whose foreground is out-of-scope is recorded (anonymously) and counted in the report, but it is not a hang confirmation, because the tool's job in a scoped run is to speak about the declared scope, and `os-not-responding` already works this way. It does appear in the agreement metrics as its own bucket. Owner decision OQ-4.

### 8. Agreement metrics

Computed in `diagnosis` from stored first-order data (episodes, probes, evaluable intervals). Join: a probe hang's measured interval widened by ±2 s overlaps an episode interval. Probe hangs during idle or not-evaluable time are excluded from the precision denominator and counted separately, because the detector had no right to see them. "Recall for episodes at least as long as the probe interval" separates "the probe is wrong" from "the probe was not looking".

### 9. Cost and degradation

- Budget: helper average CPU at most 0.5% of one logical CPU and private memory at most 40 MB for the compiled helper (100 MB if the PowerShell fallback is used, still within the 150 MB tool total). Both are measured through `observer.js` (new source role `input-helper`) and reported in `sampling.observer`, with an exceedance recorded like the existing budget.
- Build chain, in order: (a) cached compiled helper in `%LOCALAPPDATA%\hanger\bin\` named by source hash (outside OneDrive and outside `reports/`); (b) compile with the in-box .NET Framework C# compiler; (c) long-lived PowerShell fallback doing the same duties with in-memory compilation of the Win32 calls; (d) unavailable with the reason. Each step failure is recorded. A policy block (AppLocker, WDAC, EDR quarantine) produces `unavailable` and a plain reason; the run continues.
- The helper is lowest necessary priority except its timer thread, so it can notice starvation without competing for CPU. It keeps its working set small so it is less likely to be paged out in a memory-pressure stall.
- Disabling: `--no-input-stall` flag or `inputStall.enabled: false` in config; the report says `not-requested`.

### 10. Data shape (illustrative; field names are binding only as specs state)

```json
"inputStall": {
  "status": "running",                       // running | unavailable | not-requested
  "reason": null, "determinedAt": "…Z",
  "helper": { "build": "cached|compiled|powershell-fallback", "file": "hanger-<stamp>.input.jsonl", "badLines": 0 },
  "settings": { "stallMs": {"v":250,"unit":"ms","source":"default","provisional":true},
                "recentInputMs": {…}, "mergeGapMs": {…}, "lateMs": {…}, "ignoreGroups": {"v":[],"source":"default"} },
  "evaluable": { "observedS": {…}, "evaluatedS": {…}, "idleS": {…}, "notEvaluableS": {…},
                 "notEvaluable": [ { "from": "…Z", "to": "…Z", "durationS": {…}, "reason": "locked" } ] },
  "episodes": [ { "id": "ep1", "startAt": "…Z", "endAt": "…Z",
      "durationMs": {"v":1840,"unit":"ms","windowS":1.84,"n":7,"src":"input-helper","at":"…Z","prec":1},
      "worstLatencyMs": {…}, "samples": 7, "sampleRefs": [3,4,5,6,7,8,9],
      "foreground": {"kind":"in-scope","group":"code"},
      "endReason": "answered", "guards": [], "corroboratedBy": ["probe-hang","os-not-responding"],
      "confidence": {"value":0.62,"components":{"S":0.4,"L":1,"X":0.5,"N":0,"G":0},"weights":{"S":0.4,"L":0.2,"X":0.4}} } ],
  "blips": {"v":2,"unit":"count",…},
  "calmBaseline": { "n": {…}, "medianMs": {…}, "p95Ms": {…}, "maxMs": {…}, "overThresholdPct": {…}, "noisy": false },
  "helperLateness": { "tickMs": 250, "medianMs": {…}, "p95Ms": {…}, "maxMs": {…},
      "latePeriods": [ { "startAt": "…Z", "endAt": "…Z", "maxMs": {…} } ] },
  "flags": { "chronicSlowGroups": [], "ignored": [ {"group":"slowtool","samples":12} ], "foregroundChangedDropped": 3 },
  "outOfScope": { "episodes": {"v":2,"unit":"count",…}, "totalMs": {…} },
  "cannotSee": ["…"]
},
"diagnosis": {
  "probeAgreement": { "status": "evaluated", "toleranceMs": 2000,
     "precision": {"num":2,"den":4,"value":0.5}, "recall": {"num":3,"den":5,"value":0.6},
     "recallAtProbeResolution": {…}, "probeHangsWithoutStall": [ {"ref":"spawnProbes[17]","at":"…Z","reason":null} ],
     "stallsWithoutProbeHang": [ {"ref":"inputStall.episodes[3]","at":"…Z","durationMs":…} ],
     "excluded": {"idle": 1, "notEvaluable": 0}, "outOfScopeEpisodes": 2 },
  "inputStallCorroboration": { "episodes": 5, "probeHang": {"num":3,"den":5}, "osNotResponding": {…}, "userMark": {…}, "workloadProbe": {…}, "helperLate": {…}, "none": {…} },
  "hangs": [ { "confirmedBy": ["input-stall"], "helperLate": false } ]
}
```
Provenance format follows `record.js` (`v, unit, windowS, n, src, at, prec`). Where a block above shows `{…}` it is a record of that shape.

### 11. Output wiring

- `render/series.js` reads `inputStall.episodes` into `annotations.stalls`; `render/svg-charts.js` draws them in every panel as a distinct hatched band (different fill from the red freeze bands, and in the freeze-strip panel as its own row under the strip), and adds a key sentence.
- `render/sections.js` adds the "Input-response check" subsection after the hang table in the evidence section. Placeholders come from the status and reason.
- The finding line gains "by the input-response check"; the email gets one line with only JSON-backed numbers (`email.js` bindings).
- `diagnosis/context.js` reads `report.inputStall`; confirmations and the labels in `render` use a shared label map so an unknown label renders as-is.

## Implementation hints (non-binding)

- A compiled .NET Framework 4 console exe is the lowest-cost option measured: the periodic work is `GetLastInputInfo`, `GetForegroundWindow`, `SendMessageTimeout(WM_NULL, SMTO_ABORTIFHUNG | SMTO_BLOCK, timeout)`, and `GetWindowThreadProcessId` plus a process-image-name query for the in-memory scope match. Use `QueryPerformanceCounter` / `Stopwatch` for monotonic time and `GetSystemTimePreciseAsFileTime` for wall time. Recent-input age = `GetTickCount` minus `LASTINPUTINFO.dwTime`.
- Secure desktop and lock: opening the input desktop fails or the foreground window query returns nothing. Remote session: `GetSystemMetrics(SM_REMOTESESSION)`. Suspend and resume: wall clock advances much more than the monotonic clock, or `WTS` session notifications. Elevated foreground: the liveness call fails with access denied, or the target's token is higher integrity (unverified here: review 04 section 7).
- Avoid the techniques review 04 rejected: no `SetWindowsHookEx`, no raw-input keyboard sink, no `GetAsyncKeyState` loop, no clipboard, no window text reads.
- `IsHungAppWindow` can add a boolean "OS considers the window hung" to a stall sample (no name). Optional.
- Windows may replace a hung window with a ghost window that answers liveness requests. If the first live check shows episodes ending early because of this, record it in the review-gate note and in `cannotSee`.
- The helper source and a hash-named compiled copy: keep the source in `lib/sampler/input-helper/`; the bridge `lib/sampler/input-helper.js` follows the shape of `keycap.js` (spawn, parse lines, `stop()`, `child.on('error')` degrades).
- Test hooks follow the existing pattern (`HANGER_TEST_KEYS`): `HANGER_TEST_HELPER_FAIL=compile|start|exit@<sec>`, and a fake-clock constructor for the pure modules.

## Risks / Trade-offs

- **Sensitivity unverified.** The detector fired nothing in review 04's 15 s calm test; whether it fires on a real freeze is unknown. Mitigation: live task 14 with an induced stall, and the report states that the threshold is provisional.
- **Ghost windows and message-pumping apps** can hide real stalls (false negatives). Listed in `cannotSee`.
- **Chronically slow applications** inflate false positives. Mitigation: chronic-slow flag, ignore list, noisy-baseline flag.
- **EDR on a managed laptop** may block or flag an unsigned helper. Mitigation: no hooks, in-box compiler, a clear unavailable path, README note for IT. Signing is out of scope.
- **Helper CPU priority.** A high-priority timer thread must not itself become a cost. Measured in task 15.
- **Privacy review.** The detector sits close to keylogger territory in perception. Mitigations: static source check, the typed-canary test, a start-up console line, and the report's plain statement of what is and is not observed.

## Open questions (owner), with the default used

- **OQ-1 Default on or off?** Default: on, announced at start, `--no-input-stall` to disable.
- **OQ-2 Threshold:** 250 ms stall, 1000 ms recent-input window, 1000 ms merge gap, 200 ms late threshold, 250 ms tick. All provisional and configurable in `hanger.config.json` under `inputStall`.
- **OQ-3 Confirmation weight of `input-stall` alone:** 0.5 versus 1.0 for a user mark. Default 0.5.
- **OQ-4 Out-of-scope episodes confirm hangs?** Default no (shown anonymously, separate bucket).
- **OQ-5 Helper lateness as a confirmation source?** Default no; corroboration only.
- **OQ-6 PowerShell fallback** when the compiled helper is blocked (84 MB measured in review 04)? Default yes, counted against the 150 MB tool budget; unavailable if that also fails.
- **OQ-7 Is it acceptable that the helper reads the foreground executable name in memory** to decide scope membership? Default yes; never stored for out-of-scope.
