# Proposal: diagnosis-cause-rules

## Why

After `diagnosis-engine-rebuild`, the engine ranks causes from one rule contract, but it ships only the five core rules: memory pressure at the hang, CPU saturation, disk stall, security-software contention, and the observer guard. Most common laptop hang causes still have no rule:
- commit-limit exhaustion versus real swap;
- Docker/WSL2 VM memory;
- a database or one application hoarding memory;
- thermal or power throttling;
- battery and power plan;
- driver interrupt storms;
- GPU contention.

The data to test them is already collected, or arrives with `data-signals-completeness` and `workload-session-and-containers`. Today the signals are collected and then dropped before inference (R03-L3-2). The throttle check uses the wrong statistic (R03-L3-7). The spec promises a throttle candidate that the code never evaluates (R01-P1-3a). IT also needs to know what to do, cheapest first, tied to the evidence (R03-O-3).

## What Changes

- Add nine cause rules to the `diagnosis` capability. Each implements the engine's rule contract: judged at each hang against calm windows, minimum n, excluded observer-affected probes, evaluated disprover, derived confidence, and evidence references.
  - Commit limit pressure (cause class `memory`)
  - Hard-fault thrash, meaning real swap rather than image-load reads (`memory`)
  - Virtual machine memory dominance, for Docker Desktop / WSL2 (`memory`)
  - Database memory and I/O (`memory` or `disk`, whichever its inputs support)
  - Single-process dominance and growth (`memory`)
  - Thermal and power throttling, turbo-aware and judged at the hang (`thermal-power`)
  - Battery and power plan, comparing the hang rate on AC and on battery (`thermal-power`)
  - Driver interrupt storm, from DPC and interrupt time (`cpu`)
  - GPU contention, only when GPU data exists (`gpu`)
- Add a fixed rule-to-action table. Every fired, non-disproved rule maps to one suggested IT action. Actions are ordered cheapest first and never phrased as purchase verdicts.
- No new collectors. A rule whose inputs are unavailable reports `fired: false` and names the missing input. It never infers from absence.

## Capabilities

### New Capabilities
- None. This change extends the `diagnosis` capability that `diagnosis-engine-rebuild` creates.

### Modified Capabilities
- `diagnosis`: ADDED requirements for nine cause rules and for suggested actions. No existing requirement is modified (see `openspec/IMPLEMENTATION-PLAN.md` §4).

## Impact

- Code: new `tools/hanger/lib/diagnosis/rules/*.js` (one file per rule), new `tools/hanger/lib/diagnosis/actions.js`, registration of the rules in the engine's rule list, and new fixtures and tests under `tools/hanger/test/`.
- Report JSON: each rule's results appear in the existing ranked cause list. A `suggestedActions[]` array is added (additive; recorded in `SCHEMA-CHANGELOG.md` as a 2.x section).
- Renderers: none required. `report-and-visualization` renders whatever ranked rules and actions exist.
- Depends on: `diagnosis-engine-rebuild` (rule contract, vocabulary, calm windows, minimum n), `data-signals-completeness` (signal ids), and `workload-session-and-containers` (VM cap, database configuration facts).

## Findings addressed

- R01-P1-3a: The spec says throttling is an RCA candidate, but the code has none.
- R02-P2-9: DPC/interrupt % and standby/modified data are collected but unused.
- R03-P1-7: Thermal data does not feed inference (the inference part; the collection part is owned by data-signals-completeness).
- R03-L3-2: Signals are dropped before inference: maxFreq/performance %, plug state.
- R03-L3-5: pages/sec counts image loads, and the tool's own spawns generate page-ins.
- R03-L3-7: The throttle disprover uses the trace-wide minimum, is ignored on battery, and is not an inference input.
- R03-ADD-1: Rule for commit limit pressure.
- R03-ADD-2: Rule for hard-fault thrash (real swap).
- R03-ADD-3: Rule for Docker Desktop / WSL2 VM memory dominance, with the configured cap.
- R03-ADD-4: Rule for Postgres memory/IO, with its memory settings.
- R03-ADD-5: Rule for one-process dominance and leak growth.
- R03-ADD-7: Rule for thermal/power throttling at the hang.
- R03-ADD-8: Rule for battery saver / power plan, comparing the AC and battery hang rates.
- R03-ADD-11: Rule for a DPC/ISR storm.
- R03-ADD-12: Rule for GPU contention.
- R03-REC-7: Add the §3 rules.
- R03-O-3: What IT can do, cheapest first, tied to rules (the action-mapping part).
