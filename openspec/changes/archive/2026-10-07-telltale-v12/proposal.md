# Change: telltale-v12 — persona pipelines (backend)

## Why
Three persona briefs (developer/IT/manager) demand pipelines, not more collectors:
hang→cause with basis, workload A/B, cost arithmetic with printed method,
sustained watch aggregates, asset context, RAM-vs-reimage discriminator, and a
filter/tier audit IT can reproduce. Most inputs exist; the computations and
assembled artifacts don't.

## What Changes (backend only, no presentation redesign)
- Asset block collector (model, RAM fitted, disk free %, OS build, warranty input
  via flag/config; occupancy, never silenzio on unknowns)
- Cost pipeline v2: lost-min/day = rate × freeze-mean × active-min with every
  input + flag printed; upgrade-vs-replace inputs (`--ram-cost`, `--laptop-cost`)
- `trend --compare A B` (two reports or tagged windows: delta commit/pages/hang-rate)
- `watch --rollup weekly` (JSONL → per-day sustained aggregates: %hours commit>85,
  pages p95/day, hangs/day, n/window/cadence per metric)
- RAM-vs-reimage discriminator row (signed identity + bloat-vs-pressure call,
  numbers only): `reimage-signal` vs `ram-signal` with supporting deltas
- Approval-pack assembly: `pack` mode emitting one JSON (truth: asset + sustained
  + hangs + audit) that the presentation layer renders printable
