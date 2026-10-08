# Sampling engine: how to register a collector

The sampler (`lib/sampler/`) owns scheduling, budgets, gaps, observer cost and provenance. Later changes
(`data-signals-completeness`, `workload-session-and-containers`) add collectors through `registerCollector`
and never edit the scheduler core.

## Tiers

| Tier | Runs | Process launches |
|---|---|---|
| `continuous` | every 2 s, read from the ONE shared counter session | none per tick (the session is launched once) |
| `probe` | every 2 s | the hang probe, the only per-tick launch |
| `on-trigger` | on a hang or a declared schedule, inside `budgetMs` | asynchronous, killed at budget |
| `once` | once per run (start or end) | one launch |

## Registering a continuous collector

See `example-collector.js` (it is also run by `test/sampler-registry.test.js`):

```js
registry.registerCollector({
  id: 'memory.pagesOut', inference: 'mem.thrashing', tier: 'continuous', unit: '/s', precision: 1,
  source: { kind: 'counter-session', paths: ['\\Memory\\Pages Output/sec'] },
});
```

1. Add the counter path to `source.paths`. The session validates every path once at start. A path that returns
   no samples is recorded as a `counter-missing` failure and left out; it never stops the run.
2. Add a row to `FIELDS` in `bundle.js` (key, unit, optional precision and byte scale). `parse` is pure, so test it on
   canned text under `test/fixtures/collectors/`, including a decimal-comma locale.
3. Values reach the report as provenance records `{v, unit, windowS, n, src, at, prec}`. Rounding happens at store
   time (`record.js`); readers use `plain()` / `val()`.

## Registering an on-trigger collector

Give it `budgetMs`, `triggers` (`hang`, `schedule`, `end`) and optionally `minIntervalS`. Run it through
`HEAVY.run({id, trigger, budgetMs, fn})`: `fn(ctx)` should launch children through `exec.js` (`EXEC.execA(..., {ctx})`),
which counts the launch by tier, kills the child at budget and keeps partial output. Over-budget, skipped and failed
runs are written to `sampling.heavyRuns[]` and `collection.failures[]` with the reason.

## Wildcard counters (processes, GPU engines, adapters)

A counter whose instances come and go is declared in `source.dynamic` as `{path, reducer}` (reducer `proc` sums instances by
process name, `gpu` sums per adapter and engine type, `raw` keeps every instance). The session reads them with one
`PdhGetFormattedCounterArray` per counter, so a new process appears without a restart. Give the collector `budgetMs`: the
session times each counter family and, when it stays over budget, reads it every 2nd, 4th or 8th tick and says so in a
`COST|<set>|<ms>|<every>` line (`signals.counterFamilies` in the report; a `skipped-overload` failure is recorded once).
Collectors that name processes must take the scope resolver and store only in-scope and system-set names plus an anonymous
aggregate (see `lib/collectors/procs.js`).

The session script is longer than a Windows command line allows, so it travels on stdin: `bootstrapArgs()` is a tiny
`-EncodedCommand` that reads stdin and runs it.

## Rules

- Scope-aware collectors receive the resolver and emit only in-scope identities plus anonymous aggregates.
- The registry rejects a duplicate id, a missing unit, and a continuous collector that is not on the counter session.
- Never carry a stale value forward. A gap is an unobserved interval, not an interpolated sample.

## Workload collectors (workload-session-and-containers)

`lib/workload/index.js` `registerCollectors(registry)` registers four collectors through the interface above and never edits the
scheduler: `workloadContainers` (on-trigger, schedule 10 s, budget 3.5 s, back-off doubling to 60 s), `workloadVm` (60 s, 4 s),
`workloadConfig` (once, 9 s) and `workloadProbe` (per-probe timers declared in the scope file; each attempt has its own timeout).
Polls run through `HEAVY.run`, so a call over budget is killed and recorded in `sampling.heavyRuns[]`; results are appended to the
run stream as `wl-*` records (which pass the scope guard like every other non-measurement record).
