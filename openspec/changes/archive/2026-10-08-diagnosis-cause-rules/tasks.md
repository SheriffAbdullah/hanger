# Tasks

Prerequisites: `diagnosis-engine-rebuild`, `data-signals-completeness` and `workload-session-and-containers` are archived. Fixtures use the synthetic report builder from `fix-report-integrity`. Every rule lives in `tools/hanger/lib/diagnosis/rules/<id>.js` and is registered in the engine's rule list. The engine's scoring is not edited.

## 1. Inputs and shared helpers

- [x] 1.1 Pin the signal-id mapping for every rule input against the archived `data-signals-completeness` and `workload-session-and-containers` specs and the v2 report JSON. Update the design.md per-rule table if any id differs. Verify: `node -e` script that loads a fresh v2 fixture and prints each mapped id with a non-undefined value or a null-with-reason. [R03-REC-7] [R03-L3-2]
- [x] 1.2 Add `lib/diagnosis/trend-helpers.js` (rising/growing/monotonic checks over the usable probes of a window, observer-excluded probes skipped). Verify: `node --test tools/hanger/test/trend-helpers.test.js` covers rising, flat, noisy-monotonic, and fewer-than-3-points cases. [R03-REC-7]
- [x] 1.3 Record rule defaults in `summary.thresholds.rules.<id>` with `source: 'provisional (diagnosis-cause-rules design)'`, overridable by config `rules.<id>.<param>`. Verify: a fixture test asserts the defaults appear in the computed report and that a config override changes one value. [R03-REC-7]

## 2. Memory rules: commit limit and hard-fault thrash

- [x] 2.1 Implement `commit-limit-pressure` per spec "Commit limit pressure rule". Verify: `node --test tools/hanger/test/rules/commit-limit-pressure.test.js` with fixtures fires / does-not-fire (high commit alone) / disproved (<80% at 2 of 3 hangs). [R03-ADD-1]
- [x] 2.2 Implement `hard-fault-thrash`: pages output, pagefile delta and modified-list growth required; pages input alone never fires; observer launches added to confounds; the modified/standby series is consumed as an input. Verify: `node --test tools/hanger/test/rules/hard-fault-thrash.test.js` with fires / image-load-only (the R03 sample numbers: input 4513/s, output 0, pagefile 8%) / observer-confound fixtures. [R03-ADD-2] [R03-L3-5] [R02-P2-9]

## 3. Virtualization and database rules

- [x] 3.1 Implement `vm-memory-dominance` (40% of RAM, cap absent or above 50%). Verify: `node --test tools/hanger/test/rules/vm-memory-dominance.test.js` with fires (uncapped 7.2-7.8 GB of 16 GB) / disproved (cap 6 GB) / no-VM fixtures. [R03-ADD-3]
- [x] 3.2 Implement `database-memory-io` with memory and I/O variants and the missing-configuration path. Verify: `node --test tools/hanger/test/rules/database-memory-io.test.js` with I/O-fires / config-unavailable / no-database-in-scope fixtures. [R03-ADD-4]

## 4. Single-process dominance and growth

- [x] 4.1 Implement `single-process-dominance` (≥ 40% of used memory, or monotonic growth over ≥ 3 snapshots with ≥ 10% total), restricted to in-scope and system-set groups. Verify: `node --test tools/hanger/test/rules/single-process-dominance.test.js` with growth-fires (node 4.8→5.5→6.2 GB) / balanced / out-of-scope-largest fixtures, the last asserting that no out-of-scope name appears anywhere in the rule result. [R03-ADD-5]

## 5. Thermal, power and battery rules

- [x] 5.1 Implement `thermal-power-throttle`: turbo-aware performance % against the calm median, the performance-limit reason, a CPU-busy gate, evaluation on AC and on battery, and temperature as an optional supporting input. Remove any use of the trace-wide minimum of `% of maximum frequency` from inference. Verify: `node --test tools/hanger/test/rules/thermal-power-throttle.test.js` with turbo-clamp-on-battery fires / idle-dip quiet / missing-data not-evaluated fixtures, plus `grep -n "maxFreqMin" tools/hanger/lib/diagnosis` returns nothing. [R03-ADD-7] [R03-L3-7] [R01-P1-3a] [R03-P1-7] [R03-L3-2]
- [x] 5.2 Implement `battery-power-plan`: per-source hang rates per observed minute with n, the efficiency-mode/energy-saver share, and the single-source path. Verify: `node --test tools/hanger/test/rules/battery-power-plan.test.js` with battery-doubles fires / AC-only / equal-rates disproved fixtures. [R03-ADD-8] [R03-L3-2]

## 6. Driver interrupt storm and GPU contention

- [x] 6.1 Implement `driver-interrupt-storm` (DPC + interrupt ≥ 10%, sustained ≥ 3), consuming the already-collected DPC and interrupt series. Verify: `node --test tools/hanger/test/rules/driver-interrupt-storm.test.js` with fires (13% vs calm 1.2%) / quiet (2%) / disproved fixtures. [R03-ADD-11] [R02-P2-9]
- [x] 6.2 Implement `gpu-contention` (busiest engine ≥ 90% or dedicated memory ≥ 95%, only with GPU data). Verify: `node --test tools/hanger/test/rules/gpu-contention.test.js` with saturated fires / quiet (40%) / no-GPU-data fixtures. [R03-ADD-12]

## 7. Suggested actions

- [x] 7.1 Implement `lib/diagnosis/actions.js`: a fixed cost-rank table, one action per fired, non-disproved rule, deduplicated by action key, each citing rule ids, `k/M` hangs and confidence. Write `suggestedActions[]` into the report and add a dated 2.x section to `tools/hanger/SCHEMA-CHANGELOG.md`. Verify: `node --test tools/hanger/test/actions.test.js` with the three-rule ordering fixture, the disproved-only empty fixture, and a banned-word scan over all templates. [R03-O-3] [R03-REC-7]
- [x] 7.2 Add an end-to-end fixture with several rules firing (memory-led case). It asserts that every new rule result follows the engine's rule contract shape (id, fired, at, inputs, threshold, n, calm, confidence, disprover, confounds, causeClass) and that the memory rules rank above the non-firing rules. Verify: `node --test tools/hanger/test/rules/contract-shape.test.js`. [R03-REC-7]

## 8. Integration check

- [x] 8.1 Run the full suite. Verify: `node --test tools/hanger/test/` passes with zero failures.
- [x] 8.2 Do a live Windows run on the reference laptop with a declared scope. Verify (Git Bash): `node tools/hanger/hanger.js trace --duration 120 --anonymize --out "$TEMP/tt-rules"`, then `node tools/hanger/test/helpers/validate-report.js "$TEMP"/tt-rules/hanger-*.json`. Every new rule id appears in the ranked results (fired or not, each with a reason) and `suggestedActions` is present. [R03-REC-7]
- [x] 8.3 Run the privacy canary. Verify: `node tools/hanger/test/canary-leak.js` reports zero hits.
- [x] 8.4 Validate the change. Verify: `openspec validate diagnosis-cause-rules --strict` passes.
- [x] 8.5 Append a review-gate note below (date, commands run, observed results, reviewer), per `openspec/config.yaml`.

Review-gate note:
- 2026-10-08, implementation agent (Sonnet). `node --test tools/hanger/test/`: 409 pass, 0 fail (321 before wave 6 + 88 new). `node tools/hanger/test/canary-leak.js`: canary hits 0. `openspec validate diagnosis-cause-rules --strict`: valid.
- Live (8.2): `node tools/hanger/hanger.js trace --duration 120 --anonymize --scope <scope node,code,postgres> --out <scratchpad>` on Windows 11 wrote JSON/MD/report.html/email; `validate-report.js` OK; `summary.thresholds.rules` holds the 9 rules; `diagnosis.suggestedActions` present (empty: 0 hangs, 53 usable probes). With 0 hangs no per-hang rule list exists, so the nine rules were also replayed on the stored live report with its 4 slowest probes marked as hangs: all 9 appear with a reason or fire (memory-pressure fired; VM, database and thermal reported their missing or unmet inputs; real collector rows, no errors).
- Engine edits (minimal, justified): (1) `signals.js` gains `registerFamily()` and `totalMB` in `envOf` so group signals like `proc.group_mem_mb[node]` resolve in any process; (2) `engine.js` lets `evaluate()` return a per-hang `class` (database-memory-io is memory or disk, as the spec requires) and calls `deriveActions()` at the end of `diagnose()`; scoring, confidence, min-n and calm windows are untouched. `hanger.js`: one key (`summary.thresholds.rules`).
- Deviation: missing-signal scenarios report `fired: null` / `not-evaluable` (the engine contract) instead of the spec text `fired: false` / `not-evaluated`; the spec delta and design were reworded to match. memory-pressure, cpu-saturation and outside-scope have no action in the fixed table, so they add none.
- Tests that listed exactly five rules were updated to the fourteen; fixtures regenerated (they embed the diagnosis).

## Workflow follow-up

- Archive after `diagnosis-engine-rebuild` is archived, then verify `openspec/specs/diagnosis/spec.md` contains all ten ADDED requirements.
