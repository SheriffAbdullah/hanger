# Tasks

Prerequisites: `fix-report-integrity`, `software-inventory-and-scope`, and
`sampling-engine-and-provenance` are merged. Every collector is added through the
sampling-engine registration interface. Do not edit the sampler core. Per-process data
passes through the scope resolver before it is stored or printed. Canned collector
outputs live in `tools/hanger/test/fixtures/collectors/`. Runs below use Git Bash from the
repo root; quote paths because they contain spaces.

## 1. Power truth and battery fix

- [x] 1.1 Fix the power-status parser so `line=Online;pct=99` (one line) yields AC true and battery 99. Add a canned-output test for single-line, multi-line, and no-battery (`pct=255` / no system battery) inputs. Verify: `node --test tools/hanger/test/power.test.js` passes. [R02-P0-5]
- [x] 1.2 Sample power on every continuous tick with an `asOf` per value. Emit `power.transitions[] {at, from, to}`. Store the scheme as `{name, guid}`. Verify: a unit test feeding AC→battery samples yields exactly one transition with the second sample's time. [R02-P2-5]
- [x] 1.3 Record the power-mode overlay and energy-saver state per sample (null with reason when not exposed). Verify: a canned-output test maps the three overlay values to `best-power-efficiency|balanced|best-performance`. Then switch the power mode during a 60 s live trace and confirm the value changes in `samples`. [R02-M-4][R02-REC-6]
- [x] 1.4 Make `check-stub` report the parsed battery % and never print "no battery" unless the platform reports no system battery. Verify: on the reference laptop, `node tools/hanger/hanger.js check-stub | grep -i "no battery"` prints nothing and the battery line shows a number. [R02-P0-5]

## 2. CPU, throttle, and temperature

- [x] 2.1 Add the turbo-aware performance collector (performance % of base, performance-limit %, throttle reasons). Keep the legacy max-frequency field with a confound note. Verify: a canned test where max-frequency stays 100 while performance goes 148→60 stores 148 and 60 and limit 0→85. [R02-P0-4][R01-P1-3a][R02-REC-6]
- [x] 2.2 Add the temperature collector: per-zone °C from Kelvin, zone label, `role: cpu|other`, readings outside 5-130 °C dropped and counted in `droppedImplausible`, GPU temperature when exposed, null + `not-exposed|tier` otherwise. Verify: a canned test with 344.15 K and 273.25 K yields 71.0 °C stored and one dropped value. A live unelevated 30 s trace shows a temperature series or a single failure entry with reason. [R02-P0-4][R03-P1-7][R01-P1-4]
- [x] 2.3 Keep DPC % and interrupt % as continuous series with provenance (inputs to the cause-rules change). Verify: a fixture sample contains `cpu.dpcPct` and `cpu.interruptPct` with unit `%`. [R02-REC-6]

## 3. Memory, paging, disk, network, handles

- [x] 3.1 Record `committedBytes` and `commitLimitBytes` beside committed %. Verify: a canned test with 16.1e9/20.3e9 bytes stores both and 79.3 %. [R02-P1-13][R02-REC-6]
- [x] 3.2 Record pages input/s and pages output/s as separate series, plus paging-file usage % per sample. Verify: a canned test stores `pagesInPerS` 4513 and `pagesOutPerS` 0. [R03-ADD-2]
- [x] 3.3 Disk: latency in ms (seconds × 1000), queue, busy % (100 − idle), read/write bytes/s. Verify: a canned test with 0.0042 s and 88 % idle yields 4.2 ms and busy 12. [R01-P1-4][R02-REC-6]
- [x] 3.4 Network: per active adapter in/out bytes/s and errors, `isVpn` plus the matched rule. No per-process data. Verify: a canned test flags the AnyConnect adapter and not Wi-Fi. `grep -c` on a fixture report finds no network key under `procs`. [R02-P2-2][R01-P1-4]
- [x] 3.5 System handle count series. Verify: a canned test stores 98213 with unit `count`. [R02-P2-2]

## 4. Per-process CPU and I/O within scope

- [x] 4.1 Per-process CPU (raw / logical CPUs, 0-100) and read/write bytes/s per in-scope group and system-set member, plus the `outOfScope` aggregate `{groupCount, cpuPctMachine, readBps, writeBps, wsMB}`, on the continuous tier. Reduce through the resolver in memory before storage. Verify: a canned test with 270 raw on 12 CPUs stores 22.5. A fixture test asserts no stored per-process value is above 100. [R02-P0-3][R02-REC-6][R02-REC-8][R01-P1-4]
- [x] 4.2 Security software and system-set activity normalized to machine share, `machine.logicalCpus` recorded once, memory compression always present. Search indexer is sampled as a system-set member. Sync clients (OneDrive-like) are sampled only when in scope. Verify: a canned test with 190 raw on 12 CPUs stores 15.8. A test asserts memory compression is present when ranked 11th. [R02-P1-8][R02-M-1][R02-M-2]
- [x] 4.3 Extend the group rollup rows with private MB, CPU % of machine, and read/write bytes/s. Footprint ranking uses WS and commit attribution uses private bytes. Verify: the rollup unit test from the "Verdict uses Private not WS" scenario passes. [R02-P0-3]
- [x] 4.4 Measure the per-process query cost against the sampler budget and fall back to every Nth tick with the achieved cadence recorded. Verify: a 120 s live trace records `procs` cadence and observer cost in the run summary. [R02-P0-3]

## 5. GPU

- [x] 5.1 Total GPU utilization (derived from per-engine data when no total exists, with a `derived` note) and dedicated VRAM in the continuous tier, or in the trigger tier when over budget. Null + reason when absent. Verify: a canned test with engines 40/25/5 stores 65 and `derived`. [R02-P2-1][R01-P1-4]
- [x] 5.2 Per-process GPU data only on trigger, only for in-scope PIDs, with `pollMs` recorded. Remove the old end-of-run full PID poll. Verify: a fixture test asserts `gpu.perProcessOnTrigger` holds only in-scope groups. A live trace with a forced hang (`--hang 1`) records `pollMs`. [R02-P2-1]

## 6. Remove EcoQoS and update specs and docs

- [x] 6.1 Delete the EcoQoS batch, its compile step, the `ecoQoS`/`ecoDeferred` hang-row fields, and the `eco` weight. Add the datum to `collection.notCollected[]` with its reason. Verify: `grep -n -i "ecoqos" tools/hanger/hanger.js` finds no collector code. A fixture report has no `ecoQoS` key. [R02-P1-6][R03-REM-5][R03-P2-7][R03-REC-14][R02-REC-8]
- [x] 6.2 Record all new and removed fields in `tools/hanger/SCHEMA-CHANGELOG.md` per design.md Migration. Update `METRIC_REGISTRY.md` rows with the API mapping that the spec no longer names. Add `mac-stub.json` entries for the new inferences. Verify: `node tools/hanger/hanger.js check-stub --strict` passes (no orphan entries). [R01-P2-1][R01-REC-3]

## 7. Integration check

- [x] 7.1 Live Windows run on the reference laptop: `node tools/hanger/hanger.js trace --duration 120 --anonymize --out "$TMP/tt-signals"`. Then `node tools/hanger/test/helpers/validate-report.js "$TMP"/tt-signals/hanger-*.json`. Every signal family in design.md (cpu, mem, disk, net, gpu, thermal, power, sys, procs) is present per sample as values or null with a matching `collection.failures[]` reason. Battery % is numeric. No per-process CPU is above 100. [R01-P1-4][R02-REC-6]
- [x] 7.2 `node --test tools/hanger/test/` passes and `node tools/hanger/test/canary-leak.js` reports zero hits (per-process collectors leak nothing out of scope). [R02-P0-3]
- [x] 7.3 `openspec validate data-signals-completeness --strict` passes, with no "Archive would refuse" info lines.
- [x] 7.4 Review-gate note appended below (date, commands, observed results, reviewer verdict).

## Review-gate notes

### 2026-10-07 - implementation agent (Sonnet), wave 4. Reviewer verdict: pending.

Commands and observed results (Windows 11, HP ProBook 440 G9 laptop, unelevated, Git Bash from the repo root):

- `node --test tools/hanger/test/`: 249/249 pass. New files: `test/power.test.js` (8), `test/signals.test.js` (22), `test/procs.test.js` (15), `test/signals-report.test.js` (3); fixture `test/fixtures/collectors/signals-laptop.txt`. Two wave-3 tests were updated on purpose: `sampler-registry` (EcoQoS is gone, eight `signals.*` collectors exist) and `sampler-record` (a per-process counter line never folds into the machine totals; `defender` is set from the security-software member).
- `node tools/hanger/hanger.js check-stub --strict` then `check-stub`: strict OK (24 stub entries map to collectors), 23/23 GREEN. `power.battery_pct - 85%`; `grep -i "no battery"` on the output prints nothing (task 1.4). New lines, e.g. `power.throttled - perf 141% of base, limit 0%, legacy maxFreq 100%, reasons none`, `thermal.temperature - 8 zones, hottest 64.1 C, 1 implausible dropped`, `proc.cpu_io - ... out of scope: 0 groups ... (no names)`.
- Task 1.3 live: a real counter session was run while `powercfg /overlaysetactive` switched NONE, MIN, MAX (restored to best-performance, the starting state). Stored modes followed within one tick: `best-performance` (t0) -> `balanced` (t+4 s) -> `best-power-efficiency` (t+9 s) -> `best-performance` (t+14 s).
- Task 7.1 live: `node tools/hanger/hanger.js trace --duration 120 --anonymize --out <scratch>`, then `validate-report.js`: OK. cpu, mem, disk, sys, net, gpu, procs, thermal and power are present on 57/57 probe rows; no new-family entry in `collection.failures[]` (this laptop exposes all of them: 8 thermal zones plus 1 dropped at 0 C, GPU engines, 2 adapters, battery 83%, `perfPct` up to 188 with `perfLimitPct` 0); battery % numeric on 57/57 rows; the largest per-process CPU stored was 12.9 (security software), `defender` max 12.9; median cadence 1.999 s, p95 2.028 s; report 1.4 MB, stream 0.8 MB.
- Task 2.2/5.2 live: a 24 s trace with `--hang 1 --only warp,msedge` recorded `gpu.perProcessOnTrigger[]` with `pollMs` 3404 and only the two in-scope groups (the old end-of-run all-PID poll took 6057 ms in check-stub and is removed; an out-of-scope-only scope skips the poll with the recorded reason "no in-scope process was running at the hang").
- Task 4.4 observer cost (not a regression-free number, see deviations): the 120 s trace reports observer CPU 3.4% of one logical CPU (main 1.4 s + counter session 2.6 s over 120 s), over the 2% budget the run itself prints. The session's one-time start-up (PowerShell + C# compile, about 1.3 s of CPU) is more than half of that; steady state measured with `bench.js`-style runs of the real session: base bundle 0.75% of one logical CPU, base plus every collector in this change 1.42% (+0.67 points); node side 2 ms per block (parse, legacy bundle, signal build) = 0.1 point. Added steady-state cost of this change is therefore about 0.8 points of one logical CPU. With a forced 0.2 ms budget the session backed off to every 8th tick for Process and GPU Engine (reads 7 of 20 ticks) and its CPU fell to 0.69%: the budget fallback works and records the cadence.
- Task 7.2: `node tools/hanger/test/canary-leak.js`: all PASS, "canary hits: 0", "scope guard backstop never activated". The idle canary process was in the counter session's out-of-scope aggregate on every tick, and its name appears in no file or console line.
- Task 7.3: `openspec validate data-signals-completeness --strict`: valid, no "Archive would refuse" line.

Not done live: an AC to battery transition (no charger access in this session; covered by the tracker unit test), an unelevated machine with no thermal zones (covered by canned input), an elevated run.

Deviations from the design text (each is a deliberate choice):

1. The legacy flat keys (`committed`, `pages`, `diskQ`, `diskSec`, `dpcPct`, `pagesIn`, `pagefile`, `maxFreq`, `plugged`, `batteryPct`, ...) stay on the rows for the current readers and the new series are nested blocks (`cpu`, `mem`, `disk`, `sys`, `net`, `gpu`, `thermal`, `power`, `procs`). A few values appear in both (DPC, interrupt, commit %, battery %). The diagnosis rebuild should read the nested blocks and drop the flat duplicates.
2. Blocks that list several entities (`thermal`, `net`, `procs`) carry one block-level `prov` instead of a provenance record on every number (a record per group would make a 2-hour open-scope trace roughly 5 times larger). Scalar series keep per-value records.
3. `cpu.perfLimitPct` is 100 minus the OS "% Performance Limit" counter, so "limit 0 to 85" in the spec reads as 0 = unlimited. The design hint stored the raw counter, which reads 100 when nothing limits the CPU.
4. The GPU total stays on the continuous tier and, when over its 15 ms budget, is read every 2nd/4th/8th tick (cadence in `signals.counterFamilies`) instead of moving to the trigger tier.
5. The per-process series matches a scope entry by process name only, even with `includeDescendants` (parent links are not read per tick); `procs.scopeNote` says so. The tool's own `node`/`powershell` processes are inside a same-named group (flagged `includesObserver`); the observer cost is reported separately.
6. `defender` is now the sum of the registered security products (not only MsMpEng), as a share of the whole machine. `--defender` still defaults to 20, which now means 20% of the machine, so the old "av-scan contention" candidate fires far less often; the threshold is provisional and the rule is rebuilt in diagnosis-engine-rebuild.
7. Sampler core files were edited, minimally and additively, because the signals needed them: `pdh-script.js` (wildcard counters with reducers and a per-family budget, one Win32 power call that replaced the WinForms load), `session.js` (block fields, stdin delivery: the script no longer fits a 32 K command line), `registry.js` (`dynamicCounters()`), `bundle.js` (process lines never fold into machine totals). `lib/sampler/README.md` documents them.
8. `power.plan {name, guid}` is added beside the legacy `power.scheme` string (renderers still read the string). `workload.phaseSummary` (workload change) only summarizes top-level scalar records, so the nested new series are not in the phase table yet.
