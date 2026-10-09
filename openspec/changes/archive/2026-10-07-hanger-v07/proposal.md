# hanger v0.7 — weight policy in code + Mac stub + cannot-observe evidence

## Why

hanger v0.6 records `slipS/bundleMs/snapMs/ecoMs` but only one degrade path (tasklist → light fallback) actually reads them. Weight rules (light ≤300ms / heavy, run-always vs defer) live in `openspec/explorations/ontology.md`, not in code — a melting box still pays EcoQoS/WPR/admin costs it cannot afford. The 14 universal inferences from `portability-layer.md` have no machine-checkable form, so a future Mac port can silently drift the contract. And total collection failure (spawn timeout, counters missing, unelevated) is handled ad hoc per call site instead of as first-class evidence (`edge-observer.md`: "cannot observe at all IS the signal"). v0.7 closes all three gaps without adding new collectors.

## What Changes

1. **Weight policy enforced in code.** Every collector declares `{ weight: light|heavy, budgetMs, policy: run-always|calm-only|defer-post-trace|skip-with-reason }` in one registry table. The trace loop consults live `slipS/snapMs/bundleMs` each probe and auto-degrades (defer heavy, skip calm-only, record reason) — generalizing today's hardcoded tasklist switch. Each probe records per-collector `weightMs` accounting in JSON.
2. **Mac stub fixture + `check-stub` mode.** New `tools/hanger/mac-stub.json`: one entry per universal inference (~14) with `{ inference, type/shape, windows-collector, mac-probe (TBD candidate), green_when }`. New `node hanger.js check-stub` validates the current machine against the stub and prints per-inference green/red; all green on Windows = portability contract test (inferences unchanged, collectors swappable).
3. **Cannot-observe as evidence.** Every collector failure records `{ inference, collector, mode: skipped-overload|tier|timeout|counter-missing|disk-full, reason }` in a `collection.failures[]` array with the same schema on all paths; a run with zero usable samples still writes valid JSON+MD and exits 0, never crashes.
