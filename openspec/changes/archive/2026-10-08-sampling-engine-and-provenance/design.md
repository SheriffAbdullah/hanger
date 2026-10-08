# Design: sampling-engine-and-provenance

## Context

See proposal.md (Why). The current trace loop (`tools/telltale/telltale.js`, `main()`) runs one synchronous loop. Each tick it takes an in-process RAM sample. Every 2 s it times a `node -e ""` spawn through a shell, then blocks on a freshly spawned PowerShell bundle of about 25 counters. On hang it blocks again on enumeration, the not-responding poll, and the GPU poll. Everything is synchronous, so a 14 s bundle also freezes key-press capture and timestamps. The `COLLECTORS` table declares weights, but only `gate()` and `melting()` read them, and the melting threshold (bundle > 1000 ms) is below the bundle's normal cost under load.

Change 2 (`fix-report-integrity`) provides:
- wall-clock measurement times;
- observed-window rates;
- incremental append-only persistence with an unfinished marker;
- null-not-zero;
- the test harness (`node --test tools/telltale/test/`, `test/helpers/validate-report.js`).

Change 3 (`software-inventory-and-scope`) provides the scope resolver. Both are prerequisites.

## Goals / Non-Goals

**Goals**
- A continuous tier that keeps its cadence on a starved machine, plus an on-trigger tier with budgets.
- Gaps, observer cost, and failures as first-class evidence.
- A per-value provenance record and a stored-precision rule.
- A registration contract stable enough for changes 6 and 7 to add collectors without touching the sampler core.

**Non-Goals**
- Adding new signals (changes 6 and 7).
- Defining a hang, marks' kinds and notes, or excluding observer-affected probes from inference (change 8 consumes the observer data defined here).
- Display rounding and chart rendering (change 10).
- Replacing the spawn-latency hang probe. It stays as the one allowed per-tick launch. Its validity is change 8's concern.

## Decisions

### D1. Two tiers plus "once", declared per collector
Every collector declares `tier: continuous | on-trigger | once`. The continuous tier reads from one long-lived session started at run start, so there is no per-tick launch. On-trigger collectors run on hang, schedule, or end, in a worker that never blocks the continuous tier.
*Alternatives:* keep the per-probe bundle but cache the shell (still blocks the loop, and still one launch per tick); sample everything in-process (the needed counters are not reachable from Node without a native dependency, which the zero-dependency rule forbids).

### D2. Budgets replace the melting gate
Each on-trigger collector has a `budgetMs`. The runner starts it, measures elapsed time, and kills or abandons it at budget. It records `{collector, trigger, elapsedMs, budgetMs, outcome: ok|over-budget|skipped|failed, reason}`. A collector may also declare `minIntervalS` to avoid back-to-back heavy work. Skipping is decided only by the collector's own budget and interval, never by the global "melting" state.
*Alternative:* retune the melting thresholds. Rejected: any global threshold either starves the calm path on loaded boxes (as today) or never trips.

### D3. Gaps are data, not interpolation
After each continuous sample, the scheduler compares its measurement time with the previous one. If the delta is greater than 2 × nominal, it appends an unobserved interval. Reason codes: `collector-late`, `session-restart`, `process-suspended`, `system-sleep`, `unknown`.
*Alternative:* resample to a fixed grid. Rejected: it fabricates values at exactly the stressed moments.

### D4. Observer meter is separate from workload
The meter samples the tool's own process tree (main process plus the sampler session plus probe children, identified by PID and creation time): CPU time, private bytes, I/O counts, and launch count by tier. Self-exclusion of these PIDs from culprits is change 2's requirement. This change supplies the authoritative PID set through `observer.pids()`.

### D5. Provenance record everywhere; one accessor for readers
Every stored value is `{v, unit, windowS, n, src, at, prec}`. Readers (renderers, trend, diagnosis) use one accessor, `val(x)`, that returns `x.v` for records and `x` for legacy numbers. This lets the renderers keep working through the migration.
*Alternative:* a parallel `provenance` side-table keyed by path. Rejected: it drifts from the values and is harder to validate.

### D6. Precision declared per unit
Default precision by unit:

| Unit | Precision |
|---|---|
| `%` | 0.1 |
| `MB` | 1 |
| `ms` | 1 |
| `s` | 0.001 |
| `count` | 1 |
| `/s` | 1 |
| `C` | 0.1 |

A collector may override the default for a unit. Rounding happens in the store function, never in the views.

### D7. Locale-safe parsing in one function
`parseNum(raw, {decimal})` normalizes the decimal separator and strips digit-group separators. A collector that emits invariant-culture text declares that; otherwise it declares the locale the output came in. Failure yields `null` plus a `parse` failure.

### D8. Input capture outside the blocking path
Key presses are read where they cannot be blocked by synchronous collector work. Each press is stamped at read time and handed to the main loop through a queue. Marks keep `{at, tSec}` only. Kinds and notes are added by change 8.

## Data / schema shape (additive `2.x` changelog section)

```jsonc
// per-value provenance record (replaces bare numeric keys on probes and samples)
{ "v": 87.5, "unit": "%", "windowS": 1, "n": 1, "src": "mem.committed_pct@counterSession",
  "at": "2026-10-07T13:08:16.120Z", "prec": 0.1 }

"sampling": {
  "cadence": { "nominalS": 2, "achievedMedianS": 2.1, "achievedP95S": 3.4, "n": 1799 },
  "unobserved": [ { "start": "…Z", "end": "…Z", "durationS": 7.0, "reason": "collector-late" } ],
  "heavyRuns": [ { "collector": "procEnum", "trigger": "hang", "at": "…Z", "elapsedMs": 5000,
                   "budgetMs": 2000, "outcome": "over-budget", "reason": "…" } ],
  "observer": {
    "cpuS": { "v": 41.2, "unit": "s", … }, "cpuPctOneLogical": { "v": 1.1, "unit": "%", … },
    "peakPrivateMB": { … }, "ioReadMB": { … }, "ioWriteMB": { … },
    "launchesPerMin": { "continuous": 0, "hangProbe": 30, "onTrigger": 0.4 },
    "budget": { "cpuPctLimit": 2, "privateMBLimit": 150, "exceeded": false, "items": [] }
  },
  "duration": { "requestedS": 900, "usedS": 900, "source": "flag", "clampReason": null, "actualS": 903.4 }
}
"collection.failures": [ { "inference": "…", "collector": "…", "mode": "timeout|tier|parse|skipped|over-budget|counter-missing", "reason": "…", "at": "…Z" } ]
```

### Collector registration contract (used by changes 6 and 7)

```js
registerCollector({
  id: 'cpu.perf_pct',            // stable id; becomes src prefix
  inference: 'cpu.throttle',     // inference it feeds (mac-stub mapping)
  tier: 'continuous' | 'on-trigger' | 'once',
  triggers: ['hang','end','schedule'],   // on-trigger only
  scheduleS: 60,                 // optional, on-trigger schedule
  budgetMs: 1500,                // on-trigger/once; continuous items have a per-read budget
  unit: '%', precision: 0.1,     // default for produced values
  scopeAware: true,              // receives resolver; must emit only in-scope identities + aggregates
  adminOnly: false,              // tier gating; skipped with mode 'tier' otherwise
  source: { kind: 'counter-session', paths: [...] } | { kind: 'oneshot', run: fn },
  parse: (raw, ctx) => ({ values: { key: number|null }, failures: [] }) // pure, unit-testable on canned text
});
```

Rules:
- `parse` is pure. All its tests use canned text in `tools/telltale/test/fixtures/collectors/`.
- Continuous collectors contribute counter paths to the one shared session. They never launch their own process.
- The registry rejects a duplicate `id`, a missing `unit`, or a continuous collector with `source.kind !== 'counter-session'`.
- `check-stub --strict` keeps working: each mac-stub inference must map to at least one registered collector.

## Non-binding implementation hints

These are the only API names in this change, and they are not normative.
- **Continuous session:** one long-lived `powershell.exe -NoProfile` process kept open with a read loop (`Get-Counter -Continuous -SampleInterval 2` or a stdin-driven loop that reads `PerformanceCounter` objects), or `typeperf -si 2 -f CSV` streaming to stdout. Parse lines as they arrive. Use the counter sample's own timestamp as `at`.
- **On-trigger work:** `child_process.spawn` (async), not `execSync`, with a kill timer at `budgetMs`. Alternatively a `worker_threads` worker for CPU-bound parsing.
- **Key capture:** a small child process (or a worker) that owns raw-mode stdin and posts `{at: Date.now()}` messages, so the main loop's synchronous work cannot delay the stamp.
- **Observer meter:** `process.cpuUsage()`, `process.memoryUsage()`, and `process.resourceUsage()` for the main process. For child sessions, read their `\Process(...)` counters by PID through the same continuous session. Launches are counted in the spawn wrapper.
- **Locale:** prefer `.ToString([cultureinfo]::InvariantCulture)` in PowerShell output. Still run everything through `parseNum` as a guard.
- **Bounded memory:** keep only rolling windows (for example the last 120 s for hang context) in memory. Everything else streams to change 2's append-only writer.

## Risks / Trade-offs

- [The long-lived session dies mid-run (killed or crashed)] → The scheduler restarts it at most 3 times per run, records a `session-restart` unobserved interval for each, and after 3 restarts records a failure and continues on the remaining collectors.
- [The counter session itself consumes CPU on weak machines] → It is measured by the observer meter and checked against the 2% budget. Exceedance is printed, so it is never hidden.
- [The hang probe's own launch causes Defender scans and page-ins (R03-L3-5)] → Launches are counted per tier, and the hang probe's launches are exposed so change 8 can treat observer-heavy probes as confounded. This change does not remove the probe.
- [Schema churn breaks renderers mid-migration] → The `val()` accessor reads both forms. The renderers switch to it in task group 6 before probes switch to records.
- [Budget kills lose partial heavy data] → Partial output that parses is kept, flagged `outcome: over-budget`.
- [8 h runs fill the disk] → The persisted stream is checked against free space every 10 min. Below 500 MB free, the run stops cleanly with a `disk-full` failure.

## Migration

1. Land the registry and record helpers with `val()`. Switch the readers to `val()`. There is no behavior change yet.
2. Move existing collectors into registry rows (bundle counters go into the continuous session; enumeration, GPU, and OS queries become on-trigger).
3. Switch the trace loop to the scheduler, then the watch loop. Delete `MELT`, `melting()`, and `gate()`.
4. Remove the 300 s clamp (change 2 already made any clamp visible).
5. Add the 2.x changelog section. Regenerate the synthetic sample fixture.

Rollback: revert the change. Reports written in the meantime still parse, because the readers keep `val()`.

## Open Questions

- **OQ-11 (owner).** Default and maximum duration. Default used: `trace` default 60 s, `record` default 10 min (set by change 2 or 7), maximum 8 h. Any clamp is printed and recorded. Changing the maximum only changes a constant and the clamp scenario's numbers.
- Whether the continuous interval should also be user-tunable below 2 s. Default: no. `--interval` keeps governing only the in-process RAM sample. This is deferrable and does not change the specs.
