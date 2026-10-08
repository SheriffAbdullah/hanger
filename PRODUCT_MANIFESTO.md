# Product Manifesto — machine-not-sufficient / telltale

## What this product is NOT
- It does NOT decide whether someone "deserves" another machine.
- It does NOT say "buy 32GB" as a verdict. Cost math is context, never the judgment.
- No presentation-layer persuasion. No verdict theater.

## What it IS
An evidence surface. It observes the machine, numbers every metric, explains every
number with a reason, and traces causes (RCA) from first-order data to second-order
insight — presented plainly so any developer, manager, or IT engineer can see the
same truth.

## The pipeline (data first, presentation last)
1. **Observe** — processes, memory, CPU, disk, GPU, power, events, app probes.
   Everything timestamped. Nothing averaged away before storage.
2. **Number** — every metric gets a number + unit + window + sample count.
   e.g. `spawn.p95.ms[120s,n=60]=1676`, `mem.committed.end%=80.7`, `hangs≥800ms=3`.
3. **Reason** — every number gets a reason: how sampled, at what cadence,
   what healthy looks like, what confounds it (AV scan, power throttle, timer granularity).
4. **RCA** — second-order computation: correlate hangs with commit/pages/culprit
   deltas in the same window. Rank candidate causes with confidence, never certainty.
   `HANG@11:47:03 ↔ committed 80% + pages 190/s + node 753MB ⇒ memory-pressure stall (conf 0.7)`.
5. **Present** — raw JSON first, then MD/HTML. Presentation is a renderer, not the product.

## Orders of data
- **First-order (observed):** free bytes, used%, per-process MB, counter values,
  spawn latency per probe, event rows, power scheme, disk free. (Cheap, factual.)
- **Second-order (computed):** p50/p95/max, hang events (threshold crossings),
  hang rate/min, %time-frozen, deltas around hangs, culprit rollups, correlations,
  cost/time-lost arithmetic. (Computed, versioned, threshold-explicit.)
- Rule: second-order never overwrites first-order. Thresholds (`--hang 800`) are
  recorded in the report. Recompute must reproduce.

## Metric discipline
- Every metric: `id, unit, cadence, n, window, collector, healthy-range, confounds`.
- No single-sample counters as proof. No dead branches. No swallowed stderr.
- `reports/` are evidence packs: JSON (truth) + MD/HTML (views).

## Current focus (v0.6/v1 + v10-v13)
Data + computation hold via weight policy, tiered collection, and review gates;
CLI is the primary surface (live tables, STATE card); presentation renders
printable + charts from frozen schemas. See openspec/changes/ for per-change scope.
Review loop: build → try → test → agent review → ideate → build. Ship numbers,
not judgments.
