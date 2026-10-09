# hanger.js split evaluation

Total: **1129 lines** (`tools/hanger/hanger.js`).

## Line counts (approx, by function)

| Section | Lines | Span |
|---|---|---|
| CLI/config/tier/banner/sparkline/stateCard | ~78 | 1–78 |
| Collectors: COLLECTORS registry + gate + FAILURES | ~32 | 79–110 |
| Modes: check-stub + help + TH + memExtra discovery | ~90 | 111–201 |
| Exec + parse: sh/ps/sleep/anon/parseTasklist/rollup | ~50 | 203–262 |
| Collectors: CIM/scope/cmdline/appLabel/KNOWN/friendly/filedesc/power/probeBundle/admin/ecoQoS | ~258 | 263–520 |
| Mode: watchMode | ~52 | 522–573 |
| Trace loop: WPR/main/probes/HANG snapshots/EcoQoS batch/OS-confirm | ~219 | 575–793 |
| Analysis/verdict/RCA: aggregates/hang ctx/frozen/MTTR/culprits/calm/WER/verdict/rca | ~167 | 836–1002 |
| Renderers: report object + JSON/MD/HTML/console + main() | ~125 | 1004–1129 |
| trend mode | 1 | 578 (`require('./trend')` — already split) |

Collectors ≈ 340; probes/loop ≈ 219; analysis/verdict/RCA ≈ 167; renderers ≈ 125; modes (watch+check-stub+help) ≈ 142.

## Verdict: split LATER

Rule: split at 1200–1500. At 1129, file is under threshold. `trend` already extracted. No split now; re-evaluate when >1200 or next collector added. Below is the pre-approved map for that point.

## If-split module map (no build, no deps, `node tools/hanger/hanger.js` keeps working)

`hanger.js` stays as CLI + loop + `require()` glue (~300 lines). CommonJS only, relative paths, Windows-safe `path.join(__dirname,…)`.

- `lib/exec.js` ← `sh/ps/sleep/cleanOut/num/anon` (~45 lines). No deps. Exports `{sh,ps,sleep,num}`.
- `lib/config.js` ← args/CFG/getArg/hasFlag/TH/HIDE/FOCUS/PRESET/ONLY/EXTRAS/OUTDIR/ANON (~65 lines). Deps: none.
- `lib/collectors.js` ← COLLECTORS/MELT/gate/FAILURES/probeBundle/memExtra/tasklist/rollup/CIM/scope/cmdline/power/admin/ecoQoS/filedesc/friendly/KNOWN (~330 lines). Deps: `exec.js`, `config.js`.
- `lib/analysis.js` ← aggregates/hang-ctx/frozen/MTTR/verdict/RCA/calm/WER pure fns (~170 lines). Deps: none (takes data + TH).
- `lib/render.js` ← banner/sparkline/stateCard/JSON/MD/HTML/console (~125 lines). Deps: none.
- `lib/modes.js` ← watchMode/checkStub/printHelp (~140 lines). Deps: `exec/collectors/render`.
- Direction: `hanger.js → modes/collectors/analysis/render → config/exec`. Never reverse; no cycles.

Order smallest-first, each with smoke check:
1. `exec.js` — `node -e "require('./tools/hanger/lib/exec.js')"` loads.
2. `config.js` — `node tools/hanger/hanger.js --help` identical output.
3. `render.js` — `node tools/hanger/hanger.js check-stub` passes as before.
4. `analysis.js` — unit-check verdict on fixture JSON (2 cases).
5. `collectors.js` — `check-stub` green count unchanged.
6. `modes.js` — `watch --watch-secs 6` writes JSONL; `trend` unchanged.

## Locale-proof numbers plan

Bug: `CookedValue` stringifies with current culture (`1,5` vs `1.5` under de-DE/fr-FR); `parseFloat` then misreads. Fix at emission, not parsing:
- Prefix every PowerShell script in `ps()` with invariant culture: `[System.Threading.Thread]::CurrentThread.CurrentCulture=[cultureinfo]::InvariantCulture; $PSCulture='en-US'`.
- Emit numerics explicitly invariant: `$_.CookedValue.ToString([cultureinfo]::InvariantCulture)` and WMI math via `([double]$x).ToString([cultureinfo]::InvariantCulture)`; dates via `.ToString('s')` (already), never locale long-date.
- Keep Node `num()` as `parseFloat` (now safe: input always `G`-invariant with `.`).
- Add one `check-stub` probe asserting `1.5` round-trips (catches regression on de-DE CI box).

## Risks

- Circular imports: `collectors↔config` (TH/gate) — keep TH in `config.js`, collectors read-only import.
- Windows path joins: always `path.join(__dirname,…)`; never string-concat `\`; quoted ETL/XML paths stay quoted for `wpr.exe/powercfg`.
- Test per module: `exec/config/render` load-test; `analysis` fixture-test (verdict matrix); `collectors` `check-stub` green-count parity; full `trace --duration 10` end-to-end before merge.
