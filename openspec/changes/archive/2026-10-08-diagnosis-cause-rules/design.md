# Design: diagnosis-cause-rules

## Context

See proposal.md (Why). After `diagnosis-engine-rebuild`, the `lib/diagnosis/` engine provides:
- a rule contract. A rule result is `{id, fired, at[], inputs[{ref, value, unit}], threshold{value, source}, n, calm{mean, n}, confidence, disprover{check, result}, confounds[], causeClass}`;
- the cause-class vocabulary: `memory | cpu | disk | thermal-power | gpu | security-software | outside-scope | undetermined`;
- calm windows, minimum n (at least 10 usable probes overall, at least 3 for "sustained"), exclusion of observer-affected probes, and derived confidence.

If the engine's archived spec names any of these differently, the engine wins. Rules adapt to it; the engine is not changed here.

Signal ids below are indicative. The authoritative ids are the ones `data-signals-completeness` and `workload-session-and-containers` record in the report JSON. Task 1.1 pins the mapping.

## Goals / Non-Goals

**Goals**
- Nine rules, each a pure function of the stored report JSON, so a stored report recomputes identically.
- Every rule produces three outcomes in tests: fires, does not fire, and disproved.
- A deterministic rule-to-action mapping, ordered cheapest first.

**Non-Goals**
- No new collectors or signal changes. A missing input yields `fired:false` with a reason.
- No engine changes: scoring, confidence formula, minimum n and calm-window definition are not touched.
- No rendering work (owned by `report-and-visualization`).
- No purchase or "deserves a new machine" output (manifesto, `evidence-surface` non-goals).

## Decisions

1. **Judge at the hang, never trace-wide** (R03-L3-7, R03-P0-3 pattern). Every condition is evaluated on the usable probes within the engine's hang window. "Sustained" means at least 3 qualifying probes in that window or across hangs. The trace-wide minimum or maximum is never an input.
   - Alternative rejected: trace-wide peaks. They blame every hang for a single excursion.
2. **Absent input never fires and never disproves.** A rule with a missing required input reports `fired:null` (the engine's "could not evaluate"; implemented as the engine contract defines it), names the missing signal and the recorded collection failure in `reason`, and leaves `disprover.result` as `not-evaluable`. `fired:false` is kept for inputs that are present and below threshold, and for an entity that is absent from otherwise recorded data (no VM host group, no in-scope database group). Inferring "no throttling" from a missing performance counter is exactly the unsupported claim R02 handoff flagged.
3. **Thresholds are parameters with a recorded source.** Defaults come from the table below and are recorded in `summary.thresholds` like the existing `TH`. They are provisional until cited, per `evidence-surface`.
4. **VM memory dominance defaults: 40% of RAM, cap absent or above 50% of RAM.**
   - 40%: on a 16 GB laptop the VM then holds at least 6.4 GB, which leaves too little for the host IDE, browser and services that the observed hangs involve.
   - 50%: WSL2's documented default memory cap is 50% of host RAM (newer builds). A configured cap at or below 50% means the user already limited it. In that case the rule still reports the VM share but is disproved as "uncapped VM".
   - Alternative rejected: absolute GB thresholds. They do not scale across 8-32 GB machines.
5. **Single-process dominance: 40% of used memory, or monotonic growth.** Monotonic growth means at least 3 snapshots with each one larger than the previous and a total growth of at least 10% (e.g. 4.8→5.5→6.2 GB). Only in-scope or system-set groups are named. Out-of-scope load is the `outside-scope` rule's job (engine).
6. **Throttling is turbo-aware.**
   - Fires when, at the hang, the CPU is busy (total CPU at least 50%) **and** either the performance % is below 60% of the run's own calm-window median performance %, or the performance-limit flag/percentage indicates an active limit.
   - It is evaluated on AC and on battery. The power source is recorded as an input, not as a gate.
   - Temperature is a supporting input when present. It is never required.
   - Alternative rejected: `% of maximum frequency < 60`. It stays at 100 on turbo laptops (R02-P0-4).
7. **Battery and power plan compares rates, not states.**
   - Fires when the hang rate per observed minute on battery is at least 2 times the rate on AC, with at least 3 hangs and at least 10 usable probes on each side, **or** when at least 2/3 of hangs occur under an efficiency power mode or energy saver while calm windows mostly do not.
   - With only one power source observed, the rate comparison is not evaluated, and the reason is recorded.
8. **Hard-fault thrash requires write-out evidence.** It needs pages output/sec above threshold **and** a rising pagefile usage (at least +2 percentage points across the window) **and** a growing modified list.
   - Pages input alone (image and mapped-file reads) never fires it (R03-L3-5).
   - The observer's own process launches are listed in `confounds` whenever an observer-cost signal exists for the window.
9. **Actions come from a fixed table, in a fixed order.** The engine's ranking decides *which* rules fired. `actions.js` maps each fired, non-disproved rule to one action key and sorts by a fixed cost rank:

   | Cost rank | Action key | Text template | From rules |
   |---|---|---|---|
   | 1 | `security-exclusions` | Review security-software exclusions for the workload folders | security-software-contention (engine) |
   | 2 | `vm-memory-cap` | Set or lower the VM memory cap for the container platform | vm-memory-dominance |
   | 3 | `power-plan` | Use AC power / a balanced or performance power mode during the workload | battery-power-plan, thermal-power-throttle (when power-limited) |
   | 4 | `driver-firmware` | Check driver and firmware (BIOS) updates | driver-interrupt-storm, gpu-contention, thermal-power-throttle (when thermal) |
   | 5 | `app-memory` | Investigate the named application's memory use or configuration | single-process-dominance, database-memory-io (memory variant) |
   | 6 | `storage-health` | Check storage health and free space | database-memory-io (disk variant), disk-stall (engine) |
   | 7 | `memory-capacity` | Compare installed memory with the workload's commit need | commit-limit-pressure, hard-fault-thrash |

   Each action carries the rule ids, hang count `k/M`, and the confidence of its supporting rules. When nothing fired, `suggestedActions` is `[]`, and views say "no action suggested by this evidence".
   - Alternative rejected: ordering actions by confidence. IT asked for "cheapest first". Confidence is shown next to each action.
10. **Neutral wording.** Action text never contains "buy", "upgrade", "replace", "deserve" or "insufficient". A unit test greps the action table for these words. Rank 7 is phrased as a comparison, not a recommendation (manifesto, R01-P2-3).

### Per-rule table

| Rule id | Inputs (indicative signal ids) | At-hang condition (default) | Sustained n | Calm comparison | Disprover | Confounds | Class | Action |
|---|---|---|---|---|---|---|---|---|
| `commit-limit-pressure` | `mem.commit_bytes`, `mem.commit_limit_bytes`, `pagefile.use_pct`, `mem.available_MB`, `machine.ram_bytes` | commit ≥ 90% of limit **and** pagefile % rising (Δ ≥ +2 pp over the hang window) **and** available < 5% of RAM | ≥3 probes | commit % at hang vs calm mean, n each | commit < 80% of limit at ≥ 2/3 of hangs | pagefile capped by policy (limit near RAM); observer commit | memory | memory-capacity |
| `hard-fault-thrash` | `mem.pages_output_per_sec`, `mem.pages_input_per_sec`, `pagefile.use_pct`, `mem.modified_MB` | pages output/s ≥ 100 **and** pagefile % rising **and** modified list growing (Δ ≥ +5%) | ≥3 | pages output at hang vs calm | pages output < 20/s across all hang windows | image-load reads (input-only); observer process launches | memory | memory-capacity |
| `vm-memory-dominance` | VM host group memory (system set `vmmem*`), `container.vm_cap_bytes` (workload), `machine.ram_bytes` | VM memory ≥ 40% of RAM **and** (cap absent **or** cap > 50% of RAM) | ≥3 | VM share at hang vs calm | configured cap ≤ 50% of RAM, or VM share < 25% at ≥ 2/3 of hangs | guest page cache counted as host memory | memory | vm-memory-cap |
| `database-memory-io` | in-scope database group memory, `workload.config.db_memory_settings` (opt-in), `disk.latency_ms` on the data volume | (group memory + configured buffers) ≥ 25% of RAM, **or** disk latency ≥ 25 ms with queue ≥ 1 while the database group shows I/O | ≥3 | latency and memory at hang vs calm | latency < 10 ms **and** group memory < 10% RAM at all hangs | config unavailable (rule reports memory-only variant); other in-scope I/O | memory or disk | app-memory or storage-health |
| `single-process-dominance` | per-group memory snapshots (in-scope + system set), `mem.used_bytes` | one group ≥ 40% of used memory at hang, **or** monotonic growth over ≥3 snapshots with total growth ≥ 10% | ≥3 snapshots | group share at hang vs calm | share < 20% and no growth | WS vs private bytes (private preferred when present) | memory | app-memory |
| `thermal-power-throttle` | `cpu.performance_pct`, `cpu.performance_limit_pct`/throttle reasons, `cpu.pct_total`, `power.on_ac`, `thermal.*_c` (optional) | CPU ≥ 50% **and** (performance % < 60% of calm median **or** active performance limit) | ≥3 | performance % at hang vs calm median | performance % ≥ 90% of calm median at ≥ 2/3 of hangs | idle down-clocking (excluded by CPU-busy gate); power-mode overlay | thermal-power | power-plan or driver-firmware |
| `battery-power-plan` | `power.on_ac` per probe, `power.mode_overlay`, `power.energy_saver`, hang list | battery hang rate ≥ 2× AC rate (≥3 hangs and ≥10 usable probes per side), **or** ≥ 2/3 hangs under efficiency mode or energy saver vs < 1/3 of calm probes | per-side n as stated | rates per side, n each | battery and AC rates within 1.25× | workload differs between AC and battery periods | thermal-power | power-plan |
| `driver-interrupt-storm` | `cpu.dpc_pct`, `cpu.interrupt_pct` | DPC + interrupt ≥ 10% at hang | ≥3 | sum at hang vs calm | sum < 3% at all hangs | very high legitimate network/disk I/O | cpu | driver-firmware |
| `gpu-contention` | `gpu.engine_util_pct` (max engine), `gpu.dedicated_used_MB`, `gpu.dedicated_total_MB` | engine ≥ 90% **or** dedicated memory ≥ 95% of total, at hang; only evaluated when GPU data exists for the hang window | ≥3 | util at hang vs calm | engine < 50% and memory < 80% at all hangs | external display, video playback | gpu | driver-firmware |

## Non-binding implementation hints

- One module per rule exporting `{id, causeClass, defaults, evaluate(ctx)}`. `ctx` is the engine's per-hang view (usable probes, calm windows, thresholds, signal accessor). Register them in the engine's rule list. Do not edit scoring.
- Write the "rising" and "growing" checks once: a least-squares slope or first-vs-last delta over the probes in the window, sharing one helper (`lib/diagnosis/trend-helpers.js`).
- Fixtures: build synthetic v2 reports with the change-2 fixture builder (`test/fixtures/build.js` or equivalent). Name them `rule-<id>-{fires,quiet,disproved}.json`.
- Store `standby`/`modified` MB as already collected. `hard-fault-thrash` is their first consumer (R02-P2-9).
- Defaults go in `summary.thresholds.rules.<id>` with `source: 'provisional (diagnosis-cause-rules design)'`.

## Risks / Trade-offs

- [Thresholds are provisional and uncited] → They are recorded per report with source `provisional`, overridable by flag or config, and listed in `threshold-citations.md` follow-up.
- [Too many rules fire together, so the ranking is noisy] → The engine's derived confidence and calm-delta ranking decide the order. Rules only add candidates. A fixture with a memory-only case asserts that memory rules lead.
- [Signal ids drift between sibling changes] → Task 1.1 pins ids against the archived `data-signals-completeness` and `workload-session-and-containers` specs before any rule is written.
- [Battery comparison is confounded by different work on battery] → The confound is listed. The rule requires n per side and never fires on one side alone.
- [Database rule needs opt-in configuration facts] → Without them, the rule degrades to a memory-only or I/O-only variant and records the missing input.
- [Action text read as a purchase recommendation] → Fixed neutral templates, plus a banned-word test.

## Open Questions

- Should the rule thresholds become CLI flags (`--rule-<id>-<param>`) or config-only? Default here: config `rules.<id>.<param>` plus recorded source, with no new flags. The specs and tasks are unchanged either way.
