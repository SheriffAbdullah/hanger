# Orders Framework — telltale evidence ladder

## Zeroth order (no thresholds, no joins)

- **Zeroth-data (raw observed):** a single timestamped reading, e.g. `committed=97%` at 11:47:01. No inference.
- **Zeroth-analysis (direct inference):** one arithmetic fact from one reading, e.g. "3% from ceiling." No thresholds, no cross-signal joins.

## First-order logic (threshold crossings + named states)

Named states derived from zeroth inputs. Every rule records its threshold in the report.

| Rule | Zeroth inputs | Parameters (default / tweakable? / ideal TBD) |
|---|---|---|
| STALL | `spawn.ms` | `--hang 800` / yes / TBD-calibrate vs `user.marks[]` |
| PRESSURE_COMMIT | `mem.committed_pct` peak | `commit 85` (severe 90) / yes / TBD |
| PRESSURE_SUSTAINED | `used% > 85` duration | `over85 ≥ DURATION×0.3` / yes / TBD |
| LOW_FREE | `minFree GB` | `free 2.0` (severe 1.5) / yes / TBD |
| THRASH_PAGES | `mem.pages_per_sec` peak | `pages 500` / yes / TBD (5s-avg rule pending) |
| OS_HANG | App log 1002 rows | count > 0 / no / — |
| CPU_SAT | `cpu.queue_len` at hang | `queue 4` / yes / TBD |
| DISK_STALL | `disk.sec_per_transfer` + queue | `disk 0.025`, queue > 2 / yes / TBD |
| AV_ALIBI | `proc.alibi_defender_cpu` at hang | `defender 20` (%) / yes / TBD |
| LOOP_CONF (excluded from verdict) | `loop p95` | `loop 50` (ms) / yes / supporting-info only |
| RECOVERY_OK | next probe after HANG | `recovery 400` (ms) / yes / TBD |
| CONTEXT_WINDOW | slices around each HANG | `W ±10s` / yes / TBD |
| VERDICT RAM-BOUND | reasons[] | `≥2 reasons OR commit≥90 OR free<1.5` / yes / TBD |
| VERDICT RAM-PRESSURED | reasons[] | `exactly 1 reason` / yes / TBD |
| VERDICT OK | reasons[] | `0 reasons` / yes / TBD |

Example: `STALL at 11:47:03` fires from `spawn.ms=2100 ≥ --hang 800`. `PRESSURE` fires from `commit>85 sustained`.

## Second-order (computed over first-order)

Rates (`hang.rate_per_min`), `%frozen` full + excess-over-threshold, MTTR (median `recoveryMs`), pre/post deltas in W (`commitPreAvg→Post`, `pagesPreAvg→Post`, culprit ΔMB), correlations (`hang.ms ~ lagged metric`, r/n/lag, penalize n<5) [NOT IMPLEMENTED; see DEF-2 in openspec/IMPLEMENTATION-PLAN.md §6.5] culprit confidence (`0.4·share+0.3·co-occur+0.2·paging+0.1·event`, cap 0.95, never 1.0) [NOT IMPLEMENTED; see DEF-2 in openspec/IMPLEMENTATION-PLAN.md §6.5] [SUPERSEDED: confidence is now derived from recorded evidence components by the diagnosis engine (openspec/changes/diagnosis-engine-rebuild); correlation deferred, DEF-2] , calm baselines (`calmShare%`, green-window tops), cost (`hangs/hr × MTTR × hrs/day × $/hr`, params `--cost-min/--cost-rate`).

## Nth-order — EXPLICITLY OUT OF SCOPE

**"Cannot work on this stack" judgment (e.g. "this machine can never run Docker+Playwright") is OUT OF SCOPE.** Manifesto: numbers + reasons + RCA only, never deserving-hardware verdicts. Tripwires that would one day justify reopening: (1) calibrated thresholds validated against `user.marks[]` precision/recall ≥0.8 across ≥20 traces; (2) longitudinal `watch` baselines separating machine-capacity from transient load; (3) explicit owner request with cost model agreed. Until then, verdicts stop at RAM-BOUND / PRESSURED / OK per trace.

## Drill-down map

Any verdict → which first-order rules fired (`reasons[]`, e.g. `committed 97%, 3x STALL`) → which zeroth signals (`spawnProbes[].ms/committed/pages/cpuQ`, `samples[].usedPct/freeGB`, event rows) → which collectors (2s probe bundle `Get-Counter`, `tasklist`, `Get-Process PM`, `Get-WinEvent -MaxEvents 5`, `powercfg`, `docker ps`, stdin `user.marks[]`). JSON holds all three layers; recompute with recorded thresholds must reproduce.

## First-order parameter table (v0.6 externalized via CLI flags; ideals TBD)

| Param | Flag | Default | Tweakable | Ideal | Status |
|---|---|---|---|---|---|
| HANG_MS | --hang | 800ms | yes | TBD: calibrate vs user-marks precision/recall | provisional |
| TH.commit | --commit | 85% | yes | TBD | provisional |
| TH.minFreeGB | --min-free | 2.0GB | yes | TBD (scale by total RAM?) | provisional |
| TH.pages | --pages | 500/s | yes | TBD sustained-window | provisional |
| TH.queue | --queue | 4 | yes | TBD per-core normalization | provisional |
| TH.diskSec | --disk-sec | 0.025s | yes | TBD SSD vs HDD | provisional |
| TH.defender | --defender | 20% | yes | TBD | provisional |
| TH.recovery | --recovery | 400ms | yes | TBD | provisional |
| W (context) | fixed | ±10s | no (v0.6) | TBD | provisional |

